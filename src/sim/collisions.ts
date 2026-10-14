import { Vector3 } from 'three';
import type { HeliState } from './state';
import type { WorldQuery } from '../world/query';
import { PROBES, SKIDS } from './geometry';

const _p = new Vector3(), _up = new Vector3();
const WET: readonly Vector3[] = [...PROBES.map(p => p.v), ...SKIDS];   // any of these under the surface is a ditching
/** Past EDGE_WARN (on either axis) a countdown of EDGE_GRACE seconds starts; MAP_LIMIT destroys at once. */
export const EDGE_WARN = 2200, EDGE_GRACE = 10, MAP_LIMIT = 2700;

/** True while the aircraft is out past the warning line. */
export const outsideArea = (s: HeliState): boolean => Math.max(Math.abs(s.pos.x), Math.abs(s.pos.z)) > EDGE_WARN;

/**
 * Advances the time spent past the warning line (back to 0 once inside) and returns it.
 * The caller destroys the aircraft when it reaches EDGE_GRACE.
 */
export function edgeTimer(outside: number, s: HeliState, dt: number): number {
  return outsideArea(s) && !s.crashed ? outside + dt : 0;
}

/** Returns why the aircraft is destroyed this frame, or null. */
export function crashCheck(s: HeliState, world: WorldQuery): string | null {
  if (s.hit) return s.hit;
  for (const v of WET) {
    _p.copy(v).applyQuaternion(s.q).add(s.pos);
    const w = world.water(_p.x, _p.z);
    if (w !== null && _p.y < w) return 'Ditched in the river';
  }
  for (const pr of PROBES) {
    _p.copy(pr.v).applyQuaternion(s.q).add(s.pos);
    if (world.solidAt(_p.x, _p.y, _p.z)) return pr.kind;
  }
  _up.set(0, 1, 0).applyQuaternion(s.q);
  if (s.contacts > 0 && _up.y < 0.5) return 'Dynamic rollover';
  if (Math.max(Math.abs(s.pos.x), Math.abs(s.pos.z)) > MAP_LIMIT) return 'Left the map';
  return null;
}
