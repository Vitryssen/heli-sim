import { Vector3 } from 'three';
import type { HeliState } from './state';
import type { WorldQuery } from '../world/query';
import { PROBES } from './geometry';

const _p = new Vector3(), _up = new Vector3();
export const MAP_LIMIT = 2400;

/** Returns why the aircraft is destroyed this frame, or null. */
export function crashCheck(s: HeliState, world: WorldQuery): string | null {
  if (s.hit) return s.hit;
  world.focus(s.pos.x, s.pos.z);
  for (const pr of PROBES) {
    _p.copy(pr.v).applyQuaternion(s.q).add(s.pos);
    if (world.solidAt(_p.x, _p.y, _p.z)) return pr.kind;
  }
  _up.set(0, 1, 0).applyQuaternion(s.q);
  if (s.contacts > 0 && _up.y < 0.5) return 'Dynamic rollover';
  if (Math.max(Math.abs(s.pos.x), Math.abs(s.pos.z)) > MAP_LIMIT) return 'Left the map';
  return null;
}
