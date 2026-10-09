import type { Vector3 } from 'three';
import type { HeliState } from './state';
import type { Params } from './params';
import { clamp } from './math';

/**
 * Main rotor: blade-element thrust with uniform momentum-theory inflow.
 *
 *   C_T = (σa/2)·[θ₀(1/3 + μ²/2) − λ/2]          (untwisted blades, linear lift, no tip loss)
 *   λ   = λ_i + w/ΩR      (w = hub velocity along the shaft; λ > 0 means air flows down through the disc)
 *   λ_i = C_T / (2·√(μ² + λ²))                     (Glauert)
 *   C_Q = C_T·λ + (σ·C_d0/8)(1 + 4.6μ²)
 *
 * Pulling the nose up at speed makes w negative, air comes up through the disc, λ drops and
 * thrust rises: the aircraft climbs and slows. Climbing raises λ (heave damping) and forward
 * speed lowers λ_i (translational lift). C_T is capped at the blade-stall loading limit.
 */
export function rotorAero(s: HeliState, theta: number, up: Vector3, vel: Vector3, hubHeight: number, p: Params): void {
  const r = p.rotor;
  const tip = s.omega * r.radius;
  if (tip < 1) { s.thrust = 0; s.rotorTorque = 0; s.lambdaI = 0; s.mu = 0; s.groundEffect = 1; return; }

  const sigma = (r.blades * r.chord) / (Math.PI * r.radius);
  const k = (sigma * r.liftSlope) / 2;
  const w = vel.dot(up);
  const mu = Math.sqrt(Math.max(0, vel.lengthSq() - w * w)) / tip;
  const lc = w / tip;
  const bladeTerm = theta * (1 / 3 + (mu * mu) / 2);

  const ctMax = r.ctSigmaMax * sigma;
  let li = s.lambdaI, lam = 0, ct = 0;
  for (let i = 0; i < 6; i++) {
    lam = li + lc;
    ct = Math.min(ctMax, k * (bladeTerm - lam / 2));
    const denom = Math.max(Math.sqrt(mu * mu + lam * lam), r.inflowFloor);
    li = 0.5 * li + 0.5 * (ct / (2 * denom));
  }
  lam = li + lc;
  const ctFree = k * (bladeTerm - lam / 2);
  ct = Math.min(ctMax, ctFree);
  // past the stall limit the blades make drag instead of lift, which also caps rotor overspeed
  const stall = ctFree > ctMax ? ctFree / ctMax - 1 : 0;
  s.lambdaI = li;
  s.mu = mu;

  // Cheeseman–Bennett ground effect
  const z = Math.max(hubHeight, 0.3 * r.radius);
  const rz = r.radius / (4 * z);
  s.groundEffect = clamp(1 / (1 - rz * rz), 1, r.groundEffectMax);

  const area = Math.PI * r.radius * r.radius;
  const qDyn = r.rho * area * tip * tip;
  s.thrust = ct * qDyn * s.groundEffect;
  const cq = ct * lam + ((sigma * r.cd0 * (1 + r.stallDrag * stall)) / 8) * (1 + 4.6 * mu * mu);
  s.rotorTorque = cq * qDyn * r.radius;
}
