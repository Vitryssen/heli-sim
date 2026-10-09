import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { Combat, type CombatEvent, type TickContext } from '../src/combat/combat';
import { combatParams as P } from '../src/combat/params';
import type { WeaponInput } from '../src/combat/loadout';
import { Landings } from '../src/game/landings';
import { createState, placeInFlight, placeOnGround, type HeliState } from '../src/sim/state';
import { NET_DT } from '../src/net/protocol';
import { layout, world } from './harness';

const landings = new Landings(layout.pads);
const down = Math.tan(P.gun.boresightDown);
const north = new Quaternion();
const south = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);

function setup(opts: { targets?: boolean; seed?: number } = {}) {
  const combat = new Combat(world, layout, { targets: false, ...opts });
  const respawned: number[] = [];
  // like the real game: respawning puts a fresh aircraft back on the Base pad
  const base = layout.pads[0];
  const ctx: TickContext = {
    padUnder: s => landings.padUnder(s),
    respawn: id => { respawned.push(id); placeOnGround(combat.members.get(id)!.state, base.x, base.top, base.z); },
  };
  return { combat, ctx, respawned };
}

function aircraft(x: number, y: number, z: number, q = north): HeliState {
  const s = createState();
  placeInFlight(s, x, y, z, 0);
  s.q.copy(q);
  return s;
}

/** Run combat for `seconds` of net ticks; `each` can move things between ticks. */
function run(c: Combat, ctx: TickContext, seconds: number, inputs: Record<number, Partial<WeaponInput>>, each?: (t: number) => void): CombatEvent[] {
  const all: CombatEvent[] = [];
  for (let t = 0; t < seconds - 1e-9; t += NET_DT) {
    each?.(t);
    const m = new Map<number, WeaponInput>();
    for (const [id, i] of Object.entries(inputs)) m.set(Number(id), { fire: false, mode: 'gun', flare: false, ...i });
    all.push(...c.tick(NET_DT, m, ctx));
  }
  return all;
}

describe('miniguns', () => {
  test('hit a hovering aircraft 300 m ahead along the boresight', () => {
    const { combat, ctx } = setup();
    const a = combat.add(1, 'A', aircraft(0, 200, 0));
    const b = combat.add(2, 'B', aircraft(0, 200 - 300 * down, -300));
    const ev = run(combat, ctx, 0.5, { 1: { fire: true } });
    expect(b.state.hull).toBeLessThan(100);
    expect(ev.some(e => e.kind === 'hit' && e.victim === 2 && e.weapon === 'gun')).toBe(true);
    expect(a.loadout.ammo).toBeGreaterThanOrEqual(P.gun.ammo - 26);
    expect(a.loadout.ammo).toBeLessThanOrEqual(P.gun.ammo - 24);
  });

  test('miss an aircraft 30 m off the line', () => {
    const { combat, ctx } = setup();
    combat.add(1, 'A', aircraft(0, 200, 0));
    const b = combat.add(2, 'B', aircraft(30, 200 - 300 * down, -300));
    run(combat, ctx, 1, { 1: { fire: true } });
    expect(b.state.hull).toBe(100);
  });

  test('ammo drains at 50 rounds per second', () => {
    const { combat, ctx } = setup();
    const a = combat.add(1, 'A', aircraft(0, 300, 0));
    run(combat, ctx, 2, { 1: { fire: true } });
    expect(Math.abs(P.gun.ammo - a.loadout.ammo - 100)).toBeLessThanOrEqual(1);
  });

  test('lag compensation: hits where the target was on the shooter’s screen', () => {
    const { combat, ctx } = setup();
    combat.add(1, 'A', aircraft(0, 200, 0));
    const b = combat.add(2, 'B', aircraft(50, 200 - 300 * down, -300));   // has already moved 50 m right
    const seen = { pos: new Vector3(0, 200 - 300 * down, -300), q: new Quaternion() };
    run(combat, { ...ctx, poseFor: (_s, v) => (v === 2 ? seen : null) }, 0.5, { 1: { fire: true } });
    expect(b.state.hull).toBeLessThan(100);
  });

  test('about 40 hits shoot an aircraft down, credit the kill, then respawn after 5 s', () => {
    const { combat, ctx, respawned } = setup();
    const a = combat.add(1, 'A', aircraft(0, 200, 0));
    const b = combat.add(2, 'B', aircraft(0, 200 - 150 * down, -150));
    const ev = run(combat, ctx, 3, { 1: { fire: true } });
    expect(b.state.crashed).toBe(true);
    expect(b.state.hit).toBe('Shot down by A');
    expect(ev).toContainEqual({ kind: 'kill', killer: 1, victim: 2, weapon: 'gun' });
    expect(a.kills).toBe(1);
    expect(b.deaths).toBe(1);
    run(combat, ctx, P.respawn + 0.1, {});
    expect(respawned).toEqual([2]);
    expect(b.dead).toBe(false);
    expect(b.loadout.ammo).toBe(P.gun.ammo);
  });
});

describe('kill credit for crashes', () => {
  test('crashing within 10 s of being hit gives the shooter the kill', () => {
    const { combat, ctx } = setup();
    const a = combat.add(1, 'A', aircraft(0, 200, 0));
    const b = combat.add(2, 'B', aircraft(0, 200 - 300 * down, -300));
    run(combat, ctx, 0.3, { 1: { fire: true } });
    run(combat, ctx, 4, {});
    b.state.crashed = true;                       // flew into a hill while escaping
    const ev = run(combat, ctx, NET_DT, {});
    expect(ev).toContainEqual({ kind: 'kill', killer: 1, victim: 2, weapon: 'crash' });
    expect(a.kills).toBe(1);
  });

  test('crashing long after the last hit is just a death', () => {
    const { combat, ctx } = setup();
    const a = combat.add(1, 'A', aircraft(0, 200, 0));
    const b = combat.add(2, 'B', aircraft(0, 200 - 300 * down, -300));
    run(combat, ctx, 0.3, { 1: { fire: true } });
    run(combat, ctx, P.killCredit + 1, {});
    b.state.crashed = true;
    const ev = run(combat, ctx, NET_DT, {});
    expect(ev).toContainEqual({ kind: 'kill', killer: null, victim: 2, weapon: 'crash' });
    expect(a.kills).toBe(0);
    expect(b.deaths).toBe(1);
  });
});

describe('missile lock', () => {
  test('locks after 1.5 s in the cone and drops once the target leaves it', () => {
    const { combat, ctx } = setup();
    const a = combat.add(1, 'A', aircraft(0, 300, 0));
    const b = combat.add(2, 'B', aircraft(0, 300, -800));
    run(combat, ctx, 1.4, { 1: { mode: 'missile' } });
    expect(a.loadout.lock.targetId).toBe(2);
    expect(a.loadout.lock.locked).toBe(false);
    expect(combat.warning(2)).toBe('locked');
    run(combat, ctx, 0.2, { 1: { mode: 'missile' } });
    expect(a.loadout.lock.locked).toBe(true);
    b.state.pos.set(300, 300, -800);                // ~20° off the nose
    run(combat, ctx, 0.5, { 1: { mode: 'missile' } });
    expect(a.loadout.lock.targetId).toBeNull();
  });

  test('cannot lock through a hill', () => {
    const { combat, ctx } = setup();
    const hill = layout.pads[2];                    // Hilltop: ~62 m high
    const a = combat.add(1, 'A', aircraft(hill.x, 25, hill.z - 500, south));
    combat.add(2, 'B', aircraft(hill.x, 25, hill.z + 500));
    run(combat, ctx, 2, { 1: { mode: 'missile' } });
    expect(a.loadout.lock.targetId).toBeNull();
  });
});

describe('missiles and flares', () => {
  /** A locks B (crossing at `speed` m/s), fires, and the missile flies until it is gone. */
  function engagement(seed: number, flareAt: number | null, speed = 40) {
    const { combat, ctx } = setup({ seed });
    const a = combat.add(1, 'A', aircraft(0, 300, 0));
    const b = combat.add(2, 'B', aircraft(0, 300, -800));
    b.state.vel.set(speed, 0, 0);
    const move = () => { b.state.pos.addScaledVector(b.state.vel, NET_DT); };
    run(combat, ctx, 1.6, { 1: { mode: 'missile' } }, move);
    expect(a.loadout.lock.locked).toBe(true);
    const events: CombatEvent[] = [];
    events.push(...run(combat, ctx, NET_DT, { 1: { mode: 'missile', fire: true } }, move));
    expect(combat.missiles).toHaveLength(1);
    expect(combat.warning(2)).toBe('missile');
    let t = 0, decoyed = false;
    while (combat.missiles.length && t < 10) {
      const ms = combat.missiles[0];
      const dropNow = flareAt !== null && ms.pos.distanceTo(b.state.pos) < flareAt;
      events.push(...run(combat, ctx, NET_DT, { 1: { mode: 'missile' }, 2: { flare: dropNow } }, move));
      if (ms.flareId !== null) decoyed = true;
      t += NET_DT;
    }
    return { a, b, events, decoyed };
  }

  test('a locked missile hits a crossing target', () => {
    const { b, events, a } = engagement(1, null);
    expect(events.some(e => e.kind === 'hit' && e.victim === 2 && e.weapon === 'missile' && e.damage >= P.missile.damage)).toBe(true);
    expect(b.state.hull).toBeLessThanOrEqual(100 - P.missile.damage);
    expect(a.loadout.missiles).toBe(P.missile.count - 1);
  });

  test('flares decoy roughly three missiles in four', () => {
    let decoys = 0;
    const trials = 200;
    for (let i = 0; i < trials; i++) if (engagement(1000 + i, 400).decoyed) decoys++;
    expect(decoys / trials).toBeGreaterThan(0.6);
    expect(decoys / trials).toBeLessThan(0.9);
  });

  test('a missile with nothing to chase self-destructs after 8 s', () => {
    const { combat, ctx } = setup();
    const a = combat.add(1, 'A', aircraft(0, 1500, 0));
    const b = combat.add(2, 'B', aircraft(0, 1500, -600));
    run(combat, ctx, 1.6, { 1: { mode: 'missile' } });
    run(combat, ctx, NET_DT, { 1: { mode: 'missile', fire: true } });
    b.state.crashed = true;                         // target gone: the missile flies on unguided
    b.state.pos.set(5000, 1500, 0);
    let t = 0;
    while (combat.missiles.length && t < 12) { run(combat, ctx, NET_DT, {}); t += NET_DT; }
    expect(t).toBeGreaterThan(P.missile.life - 0.1);
    expect(t).toBeLessThan(P.missile.life + 0.2);
    expect(a.loadout.missiles).toBe(P.missile.count - 1);
  });
});

describe('practice targets and rearming', () => {
  test('drones can be shot down and come back after 20 s', () => {
    const { combat, ctx } = setup({ targets: true });
    const drone = combat.targets.find(t => t.kind === 'drone')!;
    // park the shooter right behind the drone, looking at it
    const s = aircraft(0, 0, 0);
    const a = combat.add(1, 'A', s);
    let downs = 0;
    for (let i = 0; i < 300 && drone.alive; i++) {
      s.pos.copy(drone.pos).add(new Vector3(0, 40 * down, 40));
      const ev = run(combat, ctx, NET_DT, { 1: { fire: true } });
      downs += ev.filter(e => e.kind === 'targetDown').length;
    }
    expect(drone.alive).toBe(false);
    expect(downs).toBe(1);
    expect(a.targetKills).toBe(1);
    run(combat, ctx, P.targets.respawn + 0.1, {});
    expect(drone.alive).toBe(true);
  });

  test('sitting 5 s on a pad refills weapons and repairs the hull', () => {
    const { combat, ctx } = setup();
    const s = createState();
    const pad = layout.pads[1];
    placeOnGround(s, pad.x, pad.top, pad.z);
    const a = combat.add(1, 'A', s);
    a.loadout.ammo = 10; a.loadout.missiles = 0; a.loadout.flares = 2; s.hull = 40;
    let ev = run(combat, ctx, 4.5, {});
    expect(a.loadout.ammo).toBe(10);
    ev = run(combat, ctx, 0.6, {});
    expect(ev).toContainEqual({ kind: 'rearmed', id: 1 });
    expect(a.loadout.ammo).toBe(P.gun.ammo);
    expect(a.loadout.missiles).toBe(P.missile.count);
    expect(s.hull).toBe(100);
  });
});
