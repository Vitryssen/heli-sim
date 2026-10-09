import { Quaternion, Vector3 } from 'three';
import type { AssistFlags, HeliState, PilotInput } from '../sim/state';
import type { WorldQuery } from '../world/query';
import type { Layout } from '../world/layout';
import { decodeServer, encode, NET_DT, paramsHash, PROTOCOL_VERSION, unpackCombat, type Buttons, type PackedCombat, type ServerMsg, type SnapshotMsg } from './protocol';
import { Predictor } from './predictor';
import type { CombatEvent } from '../combat/combat';
import type { Lock, WeaponInput } from '../combat/loadout';
import { createTargets, placeDrone, type PracticeTarget } from '../combat/targets';
import type { CombatView, ProjectileView } from '../combat/view';

export type NetStatus = 'connecting' | 'connected' | 'closed' | 'rejected';
export type NetEvent = Extract<ServerMsg, { type: 'event' }>;

export interface RemoteView { id: number; name: string; pos: Vector3; q: Quaternion; omega: number; crashed: boolean }

export interface NetHandlers {
  onStatus(status: NetStatus, detail?: string): void;
  onEvent(e: NetEvent): void;
  onCombat(events: CombatEvent[]): void;
  onRespawn(): void;
  onCrash(reason: string): void;
}

interface Projectile extends ProjectileView { at: number; base: Vector3 }

const NO_COMBAT: PackedCombat = {
  mode: 'gun', ammo: 0, missiles: 0, flares: 0, lockId: null, lockProgress: 0, locked: false,
  kills: 0, deaths: 0, firing: false, warning: 'none', dead: false, respawnIn: 0, targetKills: 0,
};

interface Sample { t: number; pos: Vector3; q: Quaternion; omega: number; crashed: boolean }

const INTERP_DELAY = 0.1;     // s: render others this far in the past so there are always two snapshots to blend
const SNAP_DISTANCE = 30;     // m: a jump this big is a respawn, don't glide across the map

/**
 * Multiplayer connection. Your own aircraft is predicted locally and reconciled with server
 * snapshots (small corrections are blended out over ~100 ms). Everyone else is interpolated.
 */
export class NetSession {
  status: NetStatus = 'connecting';
  id = -1;
  ping = 0;
  readonly predictor: Predictor;
  readonly viewPos = new Vector3();
  readonly viewQ = new Quaternion();
  private ws: WebSocket;
  private remotes = new Map<number, { name: string; samples: Sample[] }>();
  private names = new Map<number, string>();
  private clockOffset: number | null = null;
  private synced = false;
  private respawns = -1;
  private wasCrashed = false;
  private offPos = new Vector3();
  private offQ = new Quaternion();
  private pingTimer: ReturnType<typeof setInterval>;
  private _v = new Vector3();
  private _q = new Quaternion();
  private _qi = new Quaternion();
  // combat, as last reported by the server
  private combat = new Map<number, PackedCombat>();
  private missiles: Projectile[] = [];
  private flares: Projectile[] = [];
  private combatTime = 0;
  private combatAt = 0;
  readonly targets: PracticeTarget[];

  constructor(url: string, readonly room: string, readonly name: string, readonly state: HeliState, world: WorldQuery, layout: Layout, private h: NetHandlers) {
    this.predictor = new Predictor(state, world);
    this.targets = createTargets(layout);
    this.ws = new WebSocket(url);
    this.ws.onopen = () => this.ws.send(encode({ type: 'join', name, room, version: PROTOCOL_VERSION, paramsHash: paramsHash() }));
    this.ws.onmessage = e => { const m = decodeServer(e.data); if (m) this.onMessage(m); };
    this.ws.onclose = () => {
      if (this.status === 'rejected' || this.status === 'closed') return;
      this.setStatus('closed', this.id < 0 ? 'Could not reach the game server' : 'Connection to the server was lost');
    };
    this.pingTimer = setInterval(() => { if (this.ws.readyState === WebSocket.OPEN) this.ws.send(encode({ type: 'ping', t: performance.now() })); }, 2000);
  }

  /** True once the server has placed our aircraft and we can fly. */
  get ready(): boolean { return this.status === 'connected' && this.synced; }

  /** Everyone in the room, you included. */
  get roster(): { id: number; name: string; self: boolean }[] {
    return [...this.names].map(([id, name]) => ({ id, name, self: id === this.id }));
  }

  /** One 60 Hz input tick: flight applied locally straight away; flight and weapons sent to the server. */
  tick(input: PilotInput, assists: AssistFlags, buttons: Buttons, weapon: WeaponInput): void {
    if (!this.ready || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(encode(this.predictor.next(input, assists, buttons, weapon, this.viewTick())));
  }

  /** The server tick we are currently showing other aircraft at (tells the server where to rewind them). */
  private viewTick(): number {
    if (this.clockOffset === null) return 0;
    return Math.max(0, Math.round((performance.now() / 1000 + this.clockOffset - INTERP_DELAY) / NET_DT));
  }

  /**
   * Combat as the screen should show it. Your own lock comes from `localLock` (the client's own
   * seeker, for instant tones); ammo, score and warnings come from the server.
   */
  combatView(localLock: Lock): CombatView {
    const now = performance.now() / 1000;
    const mine = this.combat.get(this.id) ?? NO_COMBAT;
    for (const t of this.targets) if (t.kind === 'drone') placeDrone(t, this.combatTime + (now - this.combatAt));
    const fly = (list: Projectile[]) => list.map(p => {
      const dt = Math.min(0.25, now - p.at);
      p.pos.copy(p.base).addScaledVector(p.vel, dt);
      return p;
    });
    return {
      self: {
        mode: mine.mode, ammo: mine.ammo, missiles: mine.missiles, flares: mine.flares, lock: localLock, firing: mine.firing,
        warning: mine.warning, kills: mine.kills, deaths: mine.deaths, targetKills: mine.targetKills, dead: mine.dead, respawnIn: mine.respawnIn,
      },
      targets: this.targets,
      missiles: fly(this.missiles),
      flares: fly(this.flares),
      firing: new Set([...this.combat].filter(([id, c]) => id !== this.id && c.firing).map(([id]) => id)),
      scores: [...this.combat].map(([id, c]) => ({ id, name: this.names.get(id) ?? '?', kills: c.kills, deaths: c.deaths, self: id === this.id })),
    };
  }

  /** Server-confirmed lock target of our own aircraft (missiles only launch on this). */
  get serverLock(): number | null { return this.combat.get(this.id)?.lockId ?? null; }

  /** Per frame: blend out the last correction and return the smoothed pose of our aircraft. */
  updateView(dt: number): void {
    const k = Math.exp(-dt * 12);
    this.offPos.multiplyScalar(k);
    this.offQ.slerp(this._q.identity(), 1 - k);
    this.viewPos.copy(this.state.pos).add(this.offPos);
    this.viewQ.copy(this.offQ).multiply(this.state.q);
  }

  remoteViews(): RemoteView[] {
    if (this.clockOffset === null) return [];
    const t = performance.now() / 1000 + this.clockOffset - INTERP_DELAY;
    const out: RemoteView[] = [];
    for (const [id, r] of this.remotes) {
      const ss = r.samples;
      if (!ss.length) continue;
      let i = ss.length - 1;
      while (i > 0 && ss[i - 1].t > t) i--;
      const b = ss[i], a = ss[Math.max(0, i - 1)];
      const f = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 1;
      out.push({ id, name: r.name, pos: a.pos.clone().lerp(b.pos, f), q: a.q.clone().slerp(b.q, f), omega: a.omega + (b.omega - a.omega) * f, crashed: b.crashed });
    }
    return out;
  }

  close(): void {
    clearInterval(this.pingTimer);
    this.status = 'closed';
    this.ws.close();
  }

  private setStatus(s: NetStatus, detail?: string): void { this.status = s; this.h.onStatus(s, detail); }

  private onMessage(m: ServerMsg): void {
    switch (m.type) {
      case 'welcome': this.id = m.id; this.setStatus('connected'); break;
      case 'reject': this.status = 'rejected'; this.h.onStatus('rejected', m.reason); this.ws.close(); break;
      case 'pong': this.ping = performance.now() - m.t; break;
      case 'event': this.h.onEvent(m); break;
      case 'combat': this.h.onCombat(m.events); break;
      case 'snapshot': this.onSnapshot(m); break;
    }
  }

  private onSnapshot(m: SnapshotMsg): void {
    const now = performance.now() / 1000, serverT = m.tick * NET_DT;
    // track the earliest-arriving snapshots: they carry the least network delay
    const sample = serverT - now;
    this.clockOffset = this.clockOffset === null || sample > this.clockOffset ? sample : this.clockOffset + (sample - this.clockOffset) * 0.01;

    // combat: scores and weapons per pilot, missiles and flares to extrapolate, which targets are up
    this.combatTime = m.ct ?? 0;
    this.combatAt = now;
    this.combat.clear();
    for (const p of m.players) if (p.c) this.combat.set(p.id, unpackCombat(p.c));
    const proj = (rows: number[][] | undefined, off: number): Projectile[] => (rows ?? []).map(r => {
      const base = new Vector3(r[off], r[off + 1], r[off + 2]);
      return { id: r[0], base, pos: base.clone(), vel: new Vector3(r[off + 3], r[off + 4], r[off + 5]), at: now };
    });
    this.missiles = proj(m.missiles, 2);
    this.flares = proj(m.flares, 1);
    (m.targets ?? []).forEach((alive, i) => { if (this.targets[i]) this.targets[i].alive = alive === 1; });

    const seen = new Set<number>();
    this.names.clear();
    for (const p of m.players) {
      this.names.set(p.id, p.name);
      if (p.id === this.id) { this.reconcileOwn(p.s, m.acks[p.id] ?? 0, p.respawns, p.reason); continue; }
      seen.add(p.id);
      let r = this.remotes.get(p.id);
      if (!r) this.remotes.set(p.id, (r = { name: p.name, samples: [] }));
      const s = p.s;
      const sm: Sample = { t: serverT, pos: new Vector3(s[0], s[1], s[2]), q: new Quaternion(s[6], s[7], s[8], s[9]), omega: s[14], crashed: s[s.length - 1] === 1 };
      const last = r.samples[r.samples.length - 1];
      if (last && last.pos.distanceTo(sm.pos) > SNAP_DISTANCE) r.samples.length = 0;
      r.samples.push(sm);
      while (r.samples.length > 2 && r.samples[1].t < serverT - 1) r.samples.shift();
    }
    for (const id of this.remotes.keys()) if (!seen.has(id)) this.remotes.delete(id);
  }

  private reconcileOwn(s: number[], ack: number, respawns: number, reason: string | null): void {
    // remember where we were drawing the aircraft, so the correction can be blended rather than popped
    this._v.copy(this.state.pos).add(this.offPos);
    this._q.copy(this.offQ).multiply(this.state.q);
    this.predictor.reconcile(s, ack);
    const respawned = this.respawns !== -1 && respawns !== this.respawns;
    if (!this.synced || respawned) { this.offPos.set(0, 0, 0); this.offQ.identity(); }
    else {
      this.offPos.copy(this._v).sub(this.state.pos);
      this.offQ.copy(this._q).multiply(this._qi.copy(this.state.q).invert());
      if (this.offPos.length() > 8) { this.offPos.set(0, 0, 0); this.offQ.identity(); }
    }
    if (!this.synced) { this.synced = true; this.wasCrashed = this.state.crashed; }
    if (respawned) this.h.onRespawn();
    this.respawns = respawns;
    if (this.state.crashed && !this.wasCrashed) this.h.onCrash(reason ?? 'Crashed');
    this.wasCrashed = this.state.crashed;
  }
}
