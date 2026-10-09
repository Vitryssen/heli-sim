import { Vector3, type Quaternion } from 'three';
import type { HeliState } from './state';
import type { Params } from './params';
import type { WorldQuery } from '../world/query';
import { SKIDS } from './geometry';

const _r = new Vector3(), _p = new Vector3(), _vp = new Vector3(), _F = new Vector3(), _tau = new Vector3(), _wW = new Vector3();

function damage(s: HeliState, d: number): void {
  s.hull = Math.max(0, s.hull - d);
  s.hurt += d;
  if (s.hull <= 0) s.hit = 'Airframe destroyed';
}

/**
 * Skid points as spring-dampers with friction. Adds per-unit-mass force to `acc` and angular
 * acceleration to `alpha`. Each new touchdown is checked for damage.
 */
export function skidContacts(s: HeliState, world: WorldQuery, p: Params, acc: Vector3, alpha: Vector3, qi: Quaternion): void {
  const c = p.contact, dm = p.damage, I = p.gyration, live = !s.crashed;
  let n = 0;
  _wW.copy(s.w).applyQuaternion(s.q);
  for (let i = 0; i < SKIDS.length; i++) {
    _r.copy(SKIDS[i]).applyQuaternion(s.q);
    _p.copy(s.pos).add(_r);
    const pen = world.groundAt(_p.x, _p.z, _p.y) - _p.y;
    if (pen <= 0) { s.skidContact[i] = false; continue; }
    n++;
    _vp.crossVectors(_wW, _r).add(s.vel);
    if (!s.skidContact[i]) {
      s.skidContact[i] = true;
      if (live) {
        const vv = -_vp.y, vh = Math.hypot(_vp.x, _vp.z);
        if (vv > dm.destroyVertical) s.hit = `Skids collapsed at ${vv.toFixed(1)} m/s`;
        else {
          let d = 0;
          if (vv > dm.safeVertical) d += (vv - dm.safeVertical) * dm.perVertical;
          if (vh > dm.safeHorizontal) d += (vh - dm.safeHorizontal) * dm.perHorizontal;
          if (d > 0) damage(s, d);
        }
      }
    }
    s.impact = Math.min(s.impact, _vp.y);
    const Fn = Math.max(0, c.stiffness * pen - c.damping * _vp.y);
    const vt = Math.hypot(_vp.x, _vp.z), Ft = Math.min(c.friction * Fn, c.viscous * vt);
    _F.set(vt > 1e-6 ? (-_vp.x / vt) * Ft : 0, Fn, vt > 1e-6 ? (-_vp.z / vt) * Ft : 0);
    acc.add(_F);
    _tau.crossVectors(_r, _F).applyQuaternion(qi);
    alpha.x += _tau.x / I.pitch; alpha.y += _tau.y / I.yaw; alpha.z += _tau.z / I.roll;
  }
  s.contacts = n;
  s.grounded = n >= 2;
}
