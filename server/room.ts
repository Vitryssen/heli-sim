import { Quaternion, Vector3 } from 'three';
import { createState, placeOnGround, type HeliState } from '../src/sim/state';
import { crashCheck } from '../src/sim/collisions';
import { fleetContacts, MAX_PLAYERS, pickSlot, spawnSlots, type SpawnSlot } from '../src/sim/fleet';
import type { WorldQuery } from '../src/world/query';
import type { Layout } from '../src/world/layout';
import { Combat, type Pose } from '../src/combat/combat';
import { combatParams } from '../src/combat/params';
import { NO_WEAPON, type WeaponInput } from '../src/combat/loadout';
import { Landings } from '../src/game/landings';
import { NET_DT, packCombat, serializeState, SNAPSHOT_EVERY, type InputMsg, type PlayerSnap, type ServerMsg } from '../src/net/protocol';
import { simulateTick } from '../src/net/tick';

export interface Peer { send(msg: ServerMsg): void }

export interface Player {
  id: number;
  name: string;
  peer: Peer;
  state: HeliState;
  queue: InputMsg[];
  last: InputMsg | null;
  lastSeq: number;        // highest seq applied (acked)
  starved: number;        // ticks in a row with no fresh input
  respawns: number;
  reason: string | null;  // why the current airframe crashed
}

const MAX_QUEUE = 8;       // inputs buffered per player; older ones are dropped so lag can't pile up
const STARVE_NEUTRAL = 15; // after this many empty ticks, stop repeating the last input
const HISTORY = 60;        // ticks of state kept for lag-compensated hit checks

let nextId = 1;

/**
 * One match: authoritative flight and combat for every aircraft. Fixed 60 Hz ticks, 20 Hz snapshots,
 * free-for-all deathmatch with practice targets.
 */
export class Room {
  tick = 0;
  readonly players = new Map<number, Player>();
  /** Ring buffer of serialized states per tick, for rewinding to a shooter's view time. */
  readonly history: { tick: number; states: Map<number, number[]> }[] = [];
  readonly combat: Combat;
  private slots: SpawnSlot[];
  private landings: Landings;
  private poses = new Map<number, Pose>();

  constructor(readonly name: string, private world: WorldQuery, layout: Layout) {
    this.slots = spawnSlots(layout.pads[0], world.terrainH);
    this.combat = new Combat(world, layout);
    this.landings = new Landings(layout.pads);
  }

  get empty(): boolean { return this.players.size === 0; }
  get full(): boolean { return this.players.size >= MAX_PLAYERS; }

  join(name: string, peer: Peer): Player | null {
    if (this.full) return null;
    const p: Player = { id: nextId++, name, peer, state: createState(), queue: [], last: null, lastSeq: 0, starved: 0, respawns: 0, reason: null };
    this.spawn(p);
    this.players.set(p.id, p);
    this.combat.add(p.id, name, p.state);
    peer.send({ type: 'welcome', id: p.id, tick: this.tick, room: this.name });
    this.broadcast({ type: 'event', kind: 'join', id: p.id, name: p.name });
    peer.send(this.snapshot());
    return p;
  }

  leave(id: number): void {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    this.combat.remove(id);
    this.broadcast({ type: 'event', kind: 'leave', id, name: p.name });
  }

  input(id: number, msg: InputMsg): void {
    const p = this.players.get(id);
    if (!p) return;
    const newest = p.queue.length ? p.queue[p.queue.length - 1].seq : p.lastSeq;
    if (msg.seq <= newest) return;                       // duplicate or out of order
    p.queue.push(msg);
    while (p.queue.length > MAX_QUEUE) p.queue.shift();
  }

  /** Advance one net tick: flight, crashes, collisions, then weapons. */
  step(): void {
    const weapons = new Map<number, WeaponInput>();
    const viewTicks = new Map<number, number>();
    for (const p of this.players.values()) {
      let msg = p.queue.shift();
      if (msg) { p.starved = 0; p.lastSeq = msg.seq; p.last = msg; }
      else if (p.last) {
        // nothing arrived in time: keep flying the last input briefly, then let go of the controls
        p.starved++;
        msg = { ...p.last, buttons: { reset: false }, weapon: { ...p.last.weapon, flare: false } };
        if (p.starved > STARVE_NEUTRAL) { msg.input = { pitch: 0, roll: 0, yaw: 0, collective: 0 }; msg.weapon = { ...NO_WEAPON, mode: p.last.weapon.mode }; }
      }
      if (!msg) continue;
      weapons.set(p.id, msg.weapon);
      viewTicks.set(p.id, msg.viewTick);
      if (msg.buttons.reset && p.starved === 0) { this.respawn(p); continue; }
      simulateTick(p.state, msg, this.world);
      if (!p.state.crashed) {
        const reason = crashCheck(p.state, this.world);
        if (reason) this.crash(p, reason);
      }
    }
    const list = [...this.players.values()];
    for (const [i, j] of fleetContacts(list.map(p => p.state))) {
      this.crash(list[i], `Mid-air collision with ${list[j].name}`);
      this.crash(list[j], `Mid-air collision with ${list[i].name}`);
    }

    const events = this.combat.tick(NET_DT, weapons, {
      poseFor: (shooter, victim) => this.poseAt(viewTicks.get(shooter), victim),
      padUnder: s => this.landings.padUnder(s),
      respawn: id => { const p = this.players.get(id); if (p) this.respawn(p); },
    });
    for (const p of list) if (p.state.crashed && !p.reason && p.state.hit) p.reason = p.state.hit;
    if (events.length) this.broadcast({ type: 'combat', events });

    this.tick++;
    this.history.push({ tick: this.tick, states: new Map(list.map(p => [p.id, serializeState(p.state)])) });
    if (this.history.length > HISTORY) this.history.shift();
    if (this.tick % SNAPSHOT_EVERY === 0) this.broadcast(this.snapshot());
  }

  snapshot(): ServerMsg {
    const acks: Record<number, number> = {};
    const players: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      acks[p.id] = p.lastSeq;
      const m = this.combat.members.get(p.id)!;
      players.push({ id: p.id, name: p.name, respawns: p.respawns, reason: p.reason, s: serializeState(p.state), c: packCombat(m, this.combat.warning(p.id)) });
    }
    const r = (v: number) => Math.round(v * 100) / 100;
    return {
      type: 'snapshot', tick: this.tick, acks, players, ct: this.combat.time,
      missiles: this.combat.missiles.map(m => [m.id, m.owner, r(m.pos.x), r(m.pos.y), r(m.pos.z), r(m.vel.x), r(m.vel.y), r(m.vel.z)]),
      flares: this.combat.flares.map(f => [f.id, r(f.pos.x), r(f.pos.y), r(f.pos.z), r(f.vel.x), r(f.vel.y), r(f.vel.z)]),
      targets: this.combat.targets.map(t => +t.alive),
    };
  }

  /** Where `victim` was at the shooter's view tick (clamped to the rewind limit), from the state history. */
  private poseAt(viewTick: number | undefined, victim: number): Pose | null {
    if (viewTick === undefined) return null;
    const t = Math.max(this.tick - combatParams.maxRewindTicks, Math.min(this.tick, viewTick));
    const h = this.history.find(e => e.tick === t);
    const s = h?.states.get(victim);
    if (!s) return null;
    let pose = this.poses.get(victim);
    if (!pose) { pose = { pos: new Vector3(), q: new Quaternion() }; this.poses.set(victim, pose); }
    pose.pos.set(s[0], s[1], s[2]);
    pose.q.set(s[6], s[7], s[8], s[9]);
    return pose;
  }

  private crash(p: Player, reason: string): void {
    if (p.state.crashed) return;
    p.state.crashed = true;
    p.state.hdgHold = p.state.altHold = p.state.attHold = null;
    p.reason = reason;
    this.broadcast({ type: 'event', kind: 'crash', id: p.id, name: p.name, detail: reason });
  }

  private respawn(p: Player): void {
    this.spawn(p);
    p.respawns++;
    this.combat.revive(p.id);
  }

  private spawn(p: Player): void {
    const others = [...this.players.values()].filter(o => o !== p).map(o => o.state.pos);
    const slot = this.slots[pickSlot(this.slots, others)];
    placeOnGround(p.state, slot.x, slot.top, slot.z, slot.heading);
    p.reason = null;
  }

  private broadcast(msg: ServerMsg): void { for (const p of this.players.values()) p.peer.send(msg); }
}
