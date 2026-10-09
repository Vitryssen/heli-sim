import { Vector3, type Quaternion } from 'three';
import type { AssistFlags, HeliState, PilotInput } from './state';
import type { Params } from './params';
import { clamp, lerp, smooth, wrapPi } from './math';

/** Collective lever (spring-centred) → target blade pitch. Auto-hover flies it when the lever is neutral. */
export function collectivePitch(s: HeliState, input: PilotInput, assists: AssistFlags, up: Vector3, dt: number, p: Params): number {
  const r = p.rotor, a = p.assists, c = input.collective;
  if (s.crashed) return r.thetaFlat;
  if (s.grounded && c <= 0.05) { s.altHold = null; return r.thetaFlat; }           // bottomed on the ground
  if (assists.autoHover && Math.abs(c) < 0.05) {
    const tiltFF = 0.12 * (1 / Math.max(0.5, up.y) - 1);
    if (s.altHold === null) { s.altHold = s.pos.y + s.vel.y * 0.5; s.colI = clamp(s.theta - r.thetaNeutral - tiltFF, -0.12, 0.12); }
    const vzT = clamp(a.altitudeGain * (s.altHold - s.pos.y), -a.maxHoldClimb, a.maxHoldClimb);
    const err = vzT - s.vel.y;
    s.colI = clamp(s.colI + a.hoverKi * err * dt, -0.12, 0.12);
    return clamp(r.thetaNeutral + tiltFF + a.hoverKp * err + s.colI, r.thetaDown, r.thetaUp);
  }
  s.altHold = null;
  return c >= 0 ? lerp(r.thetaNeutral, r.thetaUp, c) : lerp(r.thetaNeutral, r.thetaDown, -c);
}

export interface ControlContext {
  pitch: number; yaw: number; roll: number;   // Euler YXZ
  qi: Quaternion;                             // world → body
  hs: number;                                 // horizontal speed, m/s
  auth: number;                               // rotor control authority 0..1
  torqueYaw: number;                          // rotor torque reaction, rad/s²
}

const _t = new Vector3();

/**
 * Cyclic and pedals → angular acceleration (adds to `out`).
 * Assisted modes work out pitch, roll and heading *rates*, then map them onto body rates so a
 * coordinated turn really yaws the aircraft. Raw mode applies the stick as torque.
 */
export function controlMoments(s: HeliState, input: PilotInput, assists: AssistFlags, c: ControlContext, p: Params, out: Vector3): void {
  const ct = p.control, a = p.assists, g = p.g;
  const { pitch, yaw, roll, hs, auth } = c;
  const P = input.pitch, R = input.roll, Yw = input.yaw;
  const neutral = Math.abs(input.collective) < 0.05;
  const hasCyc = Math.abs(P) > 0.04 || Math.abs(R) > 0.04;
  const yawAuth = Math.max(0.2, 1 / (1 + (hs / ct.yawSpeedFade) ** 2));     // tail rotor loses authority with speed
  const tame = Math.abs(pitch) < 1.2 && Math.abs(roll) < 1.3;
  const PL = a.envelopePitch, RL = a.envelopeRoll;
  const grounded = s.grounded;
  s.braking = false; s.envOn = false;

  const coordRate = assists.turnCoord && !grounded
    ? clamp((g * Math.tan(clamp(roll, -1.2, 1.2))) / Math.max(hs, 10), -1.2, 1.2) * smooth(8, 16, hs) : 0;
  s.coordOn = Math.abs(coordRate) > 0.03;
  const hoverActive = assists.autoHover && neutral && !hasCyc && !grounded && tame;

  if (hoverActive || assists.stability) {
    let thd: number, phd: number, psd: number;
    if (hoverActive) {
      // auto-hover: hands off, bleed speed with a gentle attitude
      const sy = Math.sin(yaw), cy = Math.cos(yaw), fx = -sy, fz = -cy, rx = cy, rz = -sy;
      let axc = -a.brakeGain * s.vel.x, azc = -a.brakeGain * s.vel.z;
      const am = Math.hypot(axc, azc), lim = a.brakeMaxG * g;
      if (am > lim) { axc *= lim / am; azc *= lim / am; }
      thd = clamp(2.5 * (-Math.atan((axc * fx + azc * fz) / g) - pitch), -1, 1);
      phd = clamp(2.5 * (-Math.atan((axc * rx + azc * rz) / g) - roll), -1, 1);
      s.attHold = null; s.braking = hs > 0.5;
    } else if (hasCyc || grounded || !tame) {
      thd = -P * ct.pitchRate; phd = -R * ct.rollRate; s.attHold = null;     // stick commands a rotation rate
    } else {
      if (!s.attHold) s.attHold = { p: pitch, r: roll };                       // letting go holds the attitude
      thd = clamp(ct.attitudeHoldGain * (s.attHold.p - pitch), -1, 1);
      phd = clamp(ct.attitudeHoldGain * (s.attHold.r - roll), -1, 1);
    }
    if (assists.envelope) {
      const t0 = thd, p0 = phd;
      thd = clamp(thd, -3 * Math.max(0, PL + pitch), 3 * Math.max(0, PL - pitch));
      phd = clamp(phd, -3 * Math.max(0, RL + roll), 3 * Math.max(0, RL - roll));
      if (thd !== t0 || phd !== p0) s.envOn = true;
    }
    if (Math.abs(Yw) > 0.04 || grounded) { psd = -Yw * ct.yawRate * yawAuth; s.hdgHold = null; }
    else if (s.coordOn) { psd = coordRate; s.hdgHold = null; }
    else {
      if (s.hdgHold === null && Math.abs(s.w.y) < 0.15) s.hdgHold = yaw;
      psd = s.hdgHold === null ? 0 : clamp(a.headingGain * wrapPi(s.hdgHold - yaw), -0.6, 0.6);
    }
    let wx: number, wy: number, wz: number;
    if (tame) {
      _t.set(0, psd, 0).applyQuaternion(c.qi);                                // world heading rate in body axes
      wx = thd * Math.cos(roll) + _t.x; wy = -thd * Math.sin(roll) + _t.y; wz = phd + _t.z;
    } else { wx = thd; wy = psd; wz = phd; }
    out.x += ct.rateGain * (wx - s.w.x) * auth;
    out.z += ct.rateGain * (wz - s.w.z) * auth;
    out.y += ct.yawGain * (wy - s.w.y) * auth - c.torqueYaw;                  // auto pedal trim cancels torque
  } else {
    let pp = P, rr = R;
    if (assists.envelope) {
      const sp = pp > 0 ? clamp((pitch + PL) / 0.35, 0, 1) : clamp((PL - pitch) / 0.35, 0, 1);
      const sr = rr > 0 ? clamp((roll + RL) / 0.35, 0, 1) : clamp((RL - roll) / 0.35, 0, 1);
      if (sp < 1 || sr < 1) s.envOn = Math.abs(pp) + Math.abs(rr) > 0.05;
      pp *= sp; rr *= sr;
    }
    out.x += -pp * ct.rawAuthority * auth;
    out.z += -rr * ct.rawAuthority * auth;
    out.y += -Yw * ct.rawYaw * yawAuth * auth;
    s.attHold = null; s.hdgHold = null;
    if (s.coordOn) out.y += 2.5 * (coordRate - s.w.y) * auth * (Math.abs(Yw) > 0.04 ? 0.3 : 1);
  }

  // envelope wall for overshoot
  if (assists.envelope) {
    if (pitch > PL) { out.x += -20 * (pitch - PL) - 6 * Math.max(0, s.w.x); s.envOn = true; }
    else if (pitch < -PL) { out.x += -20 * (pitch + PL) - 6 * Math.min(0, s.w.x); s.envOn = true; }
    if (roll > RL) { out.z += -20 * (roll - RL) - 6 * Math.max(0, s.w.z); s.envOn = true; }
    else if (roll < -RL) { out.z += -20 * (roll + RL) - 6 * Math.min(0, s.w.z); s.envOn = true; }
  }
}
