import { Euler, Quaternion, Vector3 } from 'three';
import type { AssistFlags, HeliState, PilotInput } from './state';
import { params as defaultParams, type Params } from './params';
import type { WorldQuery } from '../world/query';
import { HUB, SKID_DROP } from './geometry';
import { clamp, smooth } from './math';
import { rotorAero } from './rotor';
import { engineStep } from './engine';
import { airframeDrag, airframeMoments } from './airframe';
import { collectivePitch, controlMoments } from './assists';
import { skidContacts } from './contacts';

export const SIM_DT = 1 / 240;

const _up = new Vector3(), _hub = new Vector3(), _vb = new Vector3(), _acc = new Vector3(), _al = new Vector3(), _ax = new Vector3();
const _qi = new Quaternion(), _dq = new Quaternion(), _eu = new Euler();

/** Advance the aircraft by one fixed step. */
export function step(s: HeliState, input: PilotInput, assists: AssistFlags, world: WorldQuery, dt: number, t: number, p: Params = defaultParams): void {
  const q = s.q;
  _qi.copy(q).invert();
  _up.set(0, 1, 0).applyQuaternion(q);
  _eu.setFromQuaternion(q, 'YXZ');
  const pitch = _eu.x, yaw = _eu.y, roll = _eu.z;
  const live = !s.crashed;
  if (live && !s.engineOn && input.collective > 0.3) s.engineOn = true;     // raising the collective starts the engine

  // collective → blade pitch → rotor → rpm
  _hub.copy(HUB).applyQuaternion(q).add(s.pos);
  const hubHeight = _hub.y - world.groundAt(_hub.x, _hub.z, _hub.y);
  const thetaT = collectivePitch(s, input, assists, _up, dt, p);
  s.theta += clamp(thetaT - s.theta, -p.rotor.thetaRate * dt, p.rotor.thetaRate * dt);
  rotorAero(s, s.theta, _up, s.vel, hubHeight, p);
  engineStep(s, dt, p);

  const rpm = Math.min(1, s.omega / p.rotor.omegaNominal);
  const thrustAcc = s.thrust / p.mass;
  // rotor moment scales with rpm and with disc loading (little authority at flat pitch on the ground)
  const fp = p.control.flatPitchAuthority;
  const auth = live ? (0.15 + 0.85 * rpm * rpm) * (fp + (1 - fp) * smooth(0.35, 0.9, thrustAcc / p.g)) : 0;
  const torqueYaw = live ? (-p.torque.yawAccel * (s.rotorTorque - p.torque.trim * rpm * rpm)) / p.torque.trim : 0;

  // moments
  _vb.copy(s.vel).applyQuaternion(_qi);
  _al.set(0, 0, 0);
  airframeMoments(s, _vb, torqueYaw, t, p, _al);
  if (live) controlMoments(s, input, assists, { pitch, yaw, roll, qi: _qi, hs: Math.hypot(s.vel.x, s.vel.z), auth, torqueYaw }, p, _al);

  // forces: thrust along the mast
  _acc.copy(_up).multiplyScalar(thrustAcc);
  _acc.y -= p.g;
  airframeDrag(s.vel, p, _acc);
  skidContacts(s, world, p, _acc, _al, _qi);

  // integrate
  s.vel.addScaledVector(_acc, dt);
  s.pos.addScaledVector(s.vel, dt);
  s.w.addScaledVector(_al, dt);
  const wm = s.w.length();
  if (wm > 1e-9) { _ax.copy(s.w).divideScalar(wm); _dq.setFromAxisAngle(_ax, wm * dt); s.q.multiply(_dq).normalize(); }
  const skidY = s.pos.y - SKID_DROP;
  s.agl = Math.max(0, skidY - world.groundAt(s.pos.x, s.pos.z, skidY));

  // a wreck comes to rest on whatever it hit (the skid model can't hold an upside-down airframe)
  if (s.crashed) {
    const g = world.groundAt(s.pos.x, s.pos.z, s.pos.y) + 0.4;
    if (s.pos.y < g) {
      s.pos.y = g; s.vel.y = Math.max(0, s.vel.y);
      const k = Math.pow(0.85, dt * 60); s.vel.x *= k; s.vel.z *= k; s.w.multiplyScalar(Math.pow(0.9, dt * 60));
    }
  }
}
