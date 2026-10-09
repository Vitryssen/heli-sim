import type { HeliState } from './state';
import type { Params } from './params';
import { clamp } from './math';

/**
 * Turboshaft + governor driving the rotor: I_R·Ω̇ = Q_engine − Q_rotor − friction.
 * The starter ramps the governed target to nominal over `spoolTime`. The governor is a
 * PI loop through a first-order turbine lag, so a sudden collective pull droops rpm and a
 * hard flare (rotor torque dropping or reversing) lets rpm rise.
 */
export function engineStep(s: HeliState, dt: number, p: Params): void {
  const e = p.engine, r = p.rotor;
  const running = s.engineOn && !s.crashed;
  s.spoolTarget = running ? Math.min(r.omegaNominal, s.spoolTarget + (r.omegaNominal / e.spoolTime) * dt) : 0;

  let cmd = 0;
  if (running) {
    const err = s.spoolTarget - s.omega;
    // integrate only near the setpoint and while the turbine keeps up, so a spool-up doesn't wind up into an overspeed
    if (Math.abs(err) < e.integrateBand && Math.abs(s.engineTorque - (e.govKp * err + s.govI)) < e.maxTorque * 0.1)
      s.govI = clamp(s.govI + e.govKi * err * dt, 0, e.maxTorque);
    cmd = clamp(e.govKp * err + s.govI, 0, e.maxTorque);
  } else s.govI = 0;
  s.engineTorque += (cmd - s.engineTorque) * Math.min(1, dt / e.lag);

  const over = Math.max(0, s.omega - e.overspeedStart * r.omegaNominal);
  const friction = (s.crashed ? e.crashBrake : e.friction) * s.omega + e.overspeedDrag * over;
  s.omega = Math.max(0, s.omega + ((s.engineTorque - s.rotorTorque - friction) / r.inertia) * dt);
}

export const rpmFraction = (s: HeliState, p: Params): number => s.omega / p.rotor.omegaNominal;
