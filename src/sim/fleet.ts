import { Vector3 } from 'three';
import type { HeliState } from './state';
import { HUB, ROTOR_RADIUS } from './geometry';

export const MAX_PLAYERS = 8;

export interface SpawnSlot { x: number; z: number; top: number; heading: number }

/**
 * One slot on each spawn pad (Base first), then a ring round the Base apron 22 m out for when every
 * pad is taken; parked rotor discs there are ≥ 19 m apart.
 */
export function spawnSlots(pads: readonly { x: number; z: number; top: number; spawn: boolean }[], terrainH: (x: number, z: number) => number): SpawnSlot[] {
  const slots: SpawnSlot[] = pads.filter(p => p.spawn).map(p => ({ x: p.x, z: p.z, top: p.top, heading: 0 }));
  const base = pads[0];
  for (let i = 0; i < MAX_PLAYERS - 1; i++) {
    const a = (i / (MAX_PLAYERS - 1)) * Math.PI * 2;
    const x = base.x + Math.sin(a) * 22, z = base.z - Math.cos(a) * 22;
    slots.push({ x, z, top: terrainH(x, z), heading: 0 });
  }
  return slots;
}

export interface Pilot { pos: Vector3; alive: boolean }

/**
 * The free slot (nobody within 12 m) furthest from every living pilot; ties go to the earlier slot,
 * so an empty room starts on Base. If every slot is taken, the one furthest from anyone.
 */
export function pickSlot(slots: SpawnSlot[], others: Pilot[]): number {
  let best = -1, bestGap = -1, fallback = 0, fallbackGap = -1;
  for (let i = 0; i < slots.length; i++) {
    const d = (p: Pilot) => Math.hypot(p.pos.x - slots[i].x, p.pos.z - slots[i].z);
    const nearest = others.reduce((m, p) => Math.min(m, d(p)), Infinity);
    if (nearest > fallbackGap) { fallbackGap = nearest; fallback = i; }
    if (nearest <= 12) continue;
    const gap = others.reduce((m, p) => (p.alive ? Math.min(m, d(p)) : m), Infinity);
    if (gap > bestGap) { bestGap = gap; best = i; }
  }
  return best >= 0 ? best : fallback;
}

/** Body collision spheres (body axes): cabin, boom, tail. Also the hit boxes for weapons. */
export const AIRFRAME_SPHERES: readonly { c: Vector3; r: number }[] = [
  { c: new Vector3(0, 0, 0), r: 1.0 },
  { c: new Vector3(0, 0.3, 2.6), r: 0.45 },
  { c: new Vector3(0, 0.42, 4.8), r: 0.45 },
];
const BODY = AIRFRAME_SPHERES;
const REACH = ROTOR_RADIUS + 5.5;   // farthest point of the airframe from the CG
const _a = new Vector3(), _b = new Vector3(), _ha = new Vector3(), _hb = new Vector3(), _na = new Vector3(), _nb = new Vector3(), _v = new Vector3();

function sphereHitsDisc(c: Vector3, r: number, hub: Vector3, n: Vector3): boolean {
  _v.copy(c).sub(hub);
  const h = _v.dot(n);
  if (Math.abs(h) > r + 0.15) return false;
  return _v.addScaledVector(n, -h).length() < ROTOR_RADIUS + r;
}

/** True if two airframes touch: bodies, a body in a rotor disc, or two rotor discs. */
export function aircraftTouch(a: HeliState, b: HeliState): boolean {
  if (a.pos.distanceTo(b.pos) > 2 * REACH) return false;
  _ha.copy(HUB).applyQuaternion(a.q).add(a.pos); _na.set(0, 1, 0).applyQuaternion(a.q);
  _hb.copy(HUB).applyQuaternion(b.q).add(b.pos); _nb.set(0, 1, 0).applyQuaternion(b.q);
  for (const sa of BODY) {
    _a.copy(sa.c).applyQuaternion(a.q).add(a.pos);
    if (sphereHitsDisc(_a, sa.r, _hb, _nb)) return true;
    for (const sb of BODY) {
      _b.copy(sb.c).applyQuaternion(b.q).add(b.pos);
      if (_a.distanceTo(_b) < sa.r + sb.r) return true;
    }
  }
  for (const sb of BODY) {
    _b.copy(sb.c).applyQuaternion(b.q).add(b.pos);
    if (sphereHitsDisc(_b, sb.r, _ha, _na)) return true;
  }
  // rotor against rotor: hubs closer than two radii with the discs nearly level with each other
  _v.copy(_hb).sub(_ha);
  const vert = Math.abs(_v.dot(_na));
  return vert < 0.5 && _v.addScaledVector(_na, -_v.dot(_na)).length() < 2 * ROTOR_RADIUS;
}

/** Index pairs of aircraft that touch this tick (wreck-on-wreck pairs are ignored). */
export function fleetContacts(states: HeliState[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
    if (states[i].crashed && states[j].crashed) continue;
    if (aircraftTouch(states[i], states[j])) out.push([i, j]);
  }
  return out;
}
