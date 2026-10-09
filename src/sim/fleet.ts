import { Vector3 } from 'three';
import type { HeliState } from './state';
import { HUB, ROTOR_RADIUS } from './geometry';

export const MAX_PLAYERS = 8;

export interface SpawnSlot { x: number; z: number; top: number; heading: number }

/** Slot 0 is the Base pad; the rest ring the apron 22 m out, so parked rotor discs are ≥ 19 m apart. */
export function spawnSlots(base: { x: number; z: number; top: number }, terrainH: (x: number, z: number) => number): SpawnSlot[] {
  const slots: SpawnSlot[] = [{ x: base.x, z: base.z, top: base.top, heading: 0 }];
  for (let i = 0; i < MAX_PLAYERS - 1; i++) {
    const a = (i / (MAX_PLAYERS - 1)) * Math.PI * 2;
    const x = base.x + Math.sin(a) * 22, z = base.z - Math.cos(a) * 22;
    slots.push({ x, z, top: terrainH(x, z), heading: 0 });
  }
  return slots;
}

/** First slot with nobody within 12 m; otherwise the one furthest from everyone. */
export function pickSlot(slots: SpawnSlot[], occupied: Vector3[]): number {
  let best = 0, bestGap = -1;
  for (let i = 0; i < slots.length; i++) {
    const gap = occupied.reduce((m, p) => Math.min(m, Math.hypot(p.x - slots[i].x, p.z - slots[i].z)), Infinity);
    if (gap > 12) return i;
    if (gap > bestGap) { bestGap = gap; best = i; }
  }
  return best;
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
