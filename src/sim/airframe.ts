import type { Vector3 } from 'three';
import type { HeliState } from './state';
import type { Params } from './params';
import { smooth } from './math';

/** Fuselage and rotor aero moments that act whatever the pilot does. Adds to `out` (rad/s²). */
export function airframeMoments(s: HeliState, vb: Vector3, torqueYaw: number, t: number, p: Params, out: Vector3): void {
  const a = p.aero, w = s.w, vbm = vb.length();
  out.x += -a.damping.pitch * w.x + a.flapback * -vb.z;                       // flapback: speed pitches the nose up
  out.y += -a.damping.yaw * w.y - a.weathervaneLin * vb.x - a.weathervaneQuad * vb.x * vbm + torqueYaw;
  out.z += -a.damping.roll * w.z + a.flapback * vb.x;
  if (!s.crashed) {
    const turb = a.turbulence * smooth(1, 6, s.agl) * Math.min(1, s.omega / p.rotor.omegaNominal);
    out.x += turb * (Math.sin(t * 1.7) + Math.sin(t * 2.9 + 1)) * 0.5;
    out.z += turb * (Math.sin(t * 2.3 + 2) + Math.sin(t * 3.7)) * 0.5;
  }
}

/** Fuselage drag, per unit mass. Low on purpose: the aircraft carries a lot of momentum. */
export function airframeDrag(vel: Vector3, p: Params, out: Vector3): void {
  const a = p.aero, vm = vel.length();
  out.x += -a.dragQuad * vm * vel.x - a.dragLin * vel.x;
  out.z += -a.dragQuad * vm * vel.z - a.dragLin * vel.z;
  out.y += -a.vertDragQuad * vm * vel.y - a.vertDragLin * vel.y;
}
