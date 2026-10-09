import { Quaternion, Vector3 } from 'three';
import { AIRFRAME_SPHERES } from '../sim/fleet';

const _c = new Vector3(), _oc = new Vector3();

/** Distance along a unit ray to a sphere, or null. */
export function raySphere(o: Vector3, d: Vector3, c: Vector3, r: number, maxDist: number): number | null {
  _oc.copy(o).sub(c);
  const b = _oc.dot(d), cc = _oc.lengthSq() - r * r, disc = b * b - cc;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  return t >= 0 && t <= maxDist ? t : null;
}

/** Ray against a helicopter airframe at (pos, q). Returns the distance or null. */
export function rayAirframe(o: Vector3, d: Vector3, pos: Vector3, q: Quaternion, maxDist: number): number | null {
  if (raySphere(o, d, pos, 7, maxDist) === null) return null;          // cheap reject: whole airframe within 7 m
  let best: number | null = null;
  for (const s of AIRFRAME_SPHERES) {
    _c.copy(s.c).applyQuaternion(q).add(pos);
    const t = raySphere(o, d, _c, s.r, maxDist);
    if (t !== null && (best === null || t < best)) best = t;
  }
  return best;
}

/** Closest distance between point p and segment a→b. */
export function segmentPointDistance(a: Vector3, b: Vector3, p: Vector3): number {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const len2 = abx * abx + aby * aby + abz * abz;
  let t = len2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(a.x + abx * t - p.x, a.y + aby * t - p.y, a.z + abz * t - p.z);
}
