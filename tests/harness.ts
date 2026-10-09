import { Euler } from 'three';
import { createLayout } from '../src/world/layout';
import { createWorld } from '../src/world/world';
import { createState, type AssistFlags, type HeliState, type PilotInput } from '../src/sim/state';
import { SIM_DT, step } from '../src/sim/step';
import { crashCheck } from '../src/sim/collisions';
import { params } from '../src/sim/params';
import { DEG } from '../src/sim/math';

export const world = createWorld(createLayout());
export const layout = createLayout();

export const ALL_ON: AssistFlags = { stability: true, autoHover: true, envelope: true, turnCoord: true };
export const ALL_OFF: AssistFlags = { stability: false, autoHover: false, envelope: false, turnCoord: false };
export const NEUTRAL: PilotInput = { pitch: 0, roll: 0, yaw: 0, collective: 0 };

export interface Run { s: HeliState; t: number; crash: string | null }

/** Fly for `seconds` with inputs from `input(t)`. Returns the final state and any crash reason. */
export function fly(s: HeliState, seconds: number, input: (t: number, s: HeliState) => Partial<PilotInput>, assists: AssistFlags = ALL_ON, t0 = 0, onStep?: (t: number, s: HeliState) => void): Run {
  let t = t0, crash: string | null = null;
  const n = Math.round(seconds / SIM_DT);
  for (let i = 0; i < n; i++) {
    step(s, { ...NEUTRAL, ...input(t, s) }, assists, world, SIM_DT, t, params);
    t += SIM_DT;
    if (i % 4 === 0 && !crash) { crash = crashCheck(s, world); if (crash) s.crashed = true; }
    onStep?.(t, s);
  }
  return { s, t, crash };
}

export const fresh = (): HeliState => createState();
export const kmh = (s: HeliState) => s.vel.length() * 3.6;
export function attitude(s: HeliState) {
  const e = new Euler().setFromQuaternion(s.q, 'YXZ');
  return { pitch: e.x * DEG, yaw: e.y * DEG, roll: e.z * DEG, heading: ((-e.y * DEG) % 360 + 360) % 360 };
}
export const rpmPct = (s: HeliState) => (s.omega / params.rotor.omegaNominal) * 100;
