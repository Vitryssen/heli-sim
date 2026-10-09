import { Vector3, type Quaternion } from 'three';
import type { WorldQuery } from '../world/query';
import type { Lock } from './loadout';
import { combatParams } from './params';

export interface LockCandidate { id: number; pos: Vector3 }

const _f = new Vector3(), _d = new Vector3();

/** Angle (rad) between the shooter's nose and the candidate, and the distance to it. */
function aim(pos: Vector3, q: Quaternion, target: Vector3): { angle: number; dist: number } {
  _f.set(0, 0, -1).applyQuaternion(q);
  _d.copy(target).sub(pos);
  const dist = _d.length();
  return { angle: dist > 0 ? Math.acos(Math.max(-1, Math.min(1, _f.dot(_d) / dist))) : 0, dist };
}

function visible(world: WorldQuery, from: Vector3, to: Vector3, dist: number): boolean {
  _d.copy(to).sub(from).divideScalar(dist);
  return world.raycast(from.x, from.y, from.z, _d.x, _d.y, _d.z, dist - 3) === null;
}

/**
 * Missile seeker. Holding a target inside the lock cone for `lockTime` locks it. A lock
 * survives inside the wider keep cone and drops after `keepGrace` outside it, or behind terrain.
 * Shared by the server (authoritative) and the client (instant tones and boxes).
 */
export function updateLock(lock: Lock, pos: Vector3, q: Quaternion, candidates: LockCandidate[], world: WorldQuery, dt: number, p = combatParams.missile): void {
  if (lock.targetId !== null) {
    const cur = candidates.find(c => c.id === lock.targetId);
    const a = cur ? aim(pos, q, cur.pos) : null;
    const held = !!cur && !!a && a.dist <= p.lockRange && a.angle <= p.keepHalfAngle && visible(world, pos, cur.pos, a.dist);
    if (held) {
      lock.lostFor = 0;
      if (!lock.locked && a!.angle <= p.lockHalfAngle) {
        lock.progress = Math.min(p.lockTime, lock.progress + dt);
        if (lock.progress >= p.lockTime) lock.locked = true;
      }
      return;
    }
    lock.lostFor += dt;
    if (lock.lostFor <= p.keepGrace) return;
    clearLock(lock);
  }
  let best: LockCandidate | null = null, bestAngle = p.lockHalfAngle;
  for (const c of candidates) {
    const a = aim(pos, q, c.pos);
    if (a.dist > p.lockRange || a.angle > bestAngle) continue;
    if (!visible(world, pos, c.pos, a.dist)) continue;
    best = c; bestAngle = a.angle;
  }
  if (best) { lock.targetId = best.id; lock.progress = 0; lock.locked = false; lock.lostFor = 0; }
}

export function clearLock(lock: Lock): void { lock.targetId = null; lock.progress = 0; lock.locked = false; lock.lostFor = 0; }
