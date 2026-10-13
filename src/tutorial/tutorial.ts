import { Euler, Vector3 } from 'three';
import type { AssistFlags, HeliState, PilotInput } from '../sim/state';
import type { Pad } from '../world/layout';
import { terrainH } from '../world/terrain';
import { SKID_DROP } from '../sim/geometry';
import { DEG } from '../sim/math';
import type { Lesson, Probe, Run, Start, Step } from './lessons';

/** Where to put the aircraft: cold on a surface at height `y`, or flying with its skids `y` above sea level… see `placement`. */
export interface Placement { cold: boolean; x: number; y: number; z: number; heading: number; speed: number }   // heading rad, speed m/s

export interface RunResult { label: string; time: number; wobble: number; drift: number; collective: number; maxPitch: number; maxBank: number; slip: number; touchdown: number }

export type TutorialEvent =
  | { kind: 'place'; at: Placement; run: Run; first: boolean }
  | { kind: 'gate' }
  | { kind: 'complete'; lesson: Lesson };

export type Phase = 'flying' | 'crashed' | 'between' | 'done';

const CRASH_PAUSE = 2.5;     // s on the wreck before the run restarts
const BETWEEN_PAUSE = 6;     // s to read the next run's briefing
const SETTLE = 0.7;          // s still on the pad to count as landed

const _eu = new Euler(), _a = new Vector3(), _b = new Vector3(), _nose = new Vector3();

export function headingOf(s: HeliState): number {
  _eu.setFromQuaternion(s.q, 'YXZ');
  return ((-_eu.y * DEG) % 360 + 360) % 360;
}

/** True when the segment p0 → p1 passes forward through the ring at `pos` facing `normal`. */
export function crossedGate(p0: Vector3, p1: Vector3, pos: Vector3, normal: Vector3, r: number): boolean {
  const d0 = _a.copy(p0).sub(pos).dot(normal), d1 = _b.copy(p1).sub(pos).dot(normal);
  if (!(d0 < 0 && d1 >= 0)) return false;
  return _a.copy(p0).lerp(p1, d0 / (d0 - d1)).distanceTo(pos) <= r;
}

export function placement(st: Start, skidDrop = SKID_DROP): Placement {
  const heading = st.heading / DEG, speed = (st.speed ?? 0) / 3.6;
  if (st.agl === undefined) return { cold: true, x: st.x, y: st.top ?? terrainH(st.x, st.z), z: st.z, heading, speed: 0 };
  return { cold: false, x: st.x, y: Math.max(terrainH(st.x, st.z), st.top ?? -Infinity) + st.agl + skidDrop, z: st.z, heading, speed };
}

interface Acc { t: number; wob: number; drift: number; col: number; colT: number; pitch: number; bank: number; slip: number; slipT: number; touchdown: number }
const emptyAcc = (): Acc => ({ t: 0, wob: 0, drift: 0, col: 0, colT: 0, pitch: 0, bank: 0, slip: 0, slipT: 0, touchdown: 0 });

/**
 * Runs one lesson at a time against the solo aircraft: checks the current step every tick,
 * measures each run, restarts a run after a crash and moves on to the next run when one ends.
 * Knows nothing about the screen; `main` places the aircraft when told to.
 */
export class Tutorial {
  lesson: Lesson | null = null;
  run = 0;
  step = 0;
  hold = 0;                  // s the current step's condition has held
  phase: Phase = 'flying';
  countdown = 0;             // s left of a crash or between-runs pause
  results: RunResult[] = [];
  private acc = emptyAcc();
  private prev = new Vector3();
  private hasPrev = false;

  constructor(private padUnder: (s: HeliState) => Pad | null) {}

  /** A lesson is being flown (not finished). */
  get active(): boolean { return this.lesson !== null && this.phase !== 'done'; }
  /** The assists the current run flies with, or null to use the player's own. */
  get assists(): AssistFlags | null { return this.active ? this.lesson!.runs[this.run].assists : null; }
  get currentStep(): Step | null { return this.active && this.phase !== 'between' ? this.lesson!.steps[this.step] ?? null : null; }

  start(lesson: Lesson): TutorialEvent { this.lesson = lesson; this.results = []; return this.begin(0); }

  /** Start the current run again (or the whole lesson once it is finished). */
  restart(): TutorialEvent | null {
    if (!this.lesson) return null;
    if (this.phase === 'done') { this.results = []; return this.begin(0); }
    return this.begin(this.phase === 'between' ? this.run + 1 : this.run);
  }

  stop(): void { this.lesson = null; this.phase = 'flying'; this.results = []; }

  private begin(run: number): TutorialEvent {
    const L = this.lesson!;
    this.run = run; this.step = 0; this.hold = 0; this.phase = 'flying'; this.countdown = 0;
    this.acc = emptyAcc(); this.hasPrev = false;
    if (this.results.length > run) this.results.length = run;   // a restarted run replaces its old result
    return { kind: 'place', at: placement(L.start), run: L.runs[run], first: run === 0 };
  }

  /** One fixed tick (after the flight model has stepped). */
  tick(dt: number, s: HeliState, input: PilotInput): TutorialEvent[] {
    const L = this.lesson;
    if (!L || this.phase === 'done') return [];
    if (this.phase === 'crashed' || this.phase === 'between') {
      if ((this.countdown -= dt) > 0) return [];
      return [this.restart()!];
    }
    if (s.crashed) { this.phase = 'crashed'; this.countdown = CRASH_PAUSE; return []; }

    const hspeed = Math.hypot(s.vel.x, s.vel.z);
    const probe: Probe = { s, heading: headingOf(s), hspeed };
    this.measure(dt, s, hspeed);

    const out: TutorialEvent[] = [];
    const step = L.steps[this.step];
    if (this.passes(step, probe, input, dt)) {
      if (step.kind === 'land') this.acc.touchdown = -s.impact;
      if (step.kind === 'gate') out.push({ kind: 'gate' });
      this.step++; this.hold = 0;
      if (this.step >= L.steps.length) out.push(...this.finishRun());
    }
    this.prev.copy(s.pos); this.hasPrev = true;
    return out;
  }

  private passes(st: Step, p: Probe, input: PilotInput, dt: number): boolean {
    const s = p.s;
    const held = (ok: boolean, need: number, decay = 2) => {
      this.hold = ok ? this.hold + dt : Math.max(0, this.hold - decay * dt);
      return this.hold >= need;
    };
    switch (st.kind) {
      case 'do': {
        const ok = st.done(p) && (!st.handsOff || Math.abs(input.collective) < 0.05);
        if (ok && st.handsOff) this.acc.drift += Math.abs(s.vel.y) * dt;
        if (ok && st.measure) { this.acc.col += Math.abs(input.collective) * dt; this.acc.colT += dt; }
        return st.hold ? held(ok, st.hold) : ok;
      }
      case 'gate': return this.hasPrev && crossedGate(this.prev, s.pos, st.pos, st.normal, st.r);
      case 'zone': {
        const ok = Math.hypot(s.pos.x - st.pos.x, s.pos.z - st.pos.z) < st.r && p.hspeed < st.maxSpeed && !s.grounded && s.agl > 2;
        return held(ok, st.hold);
      }
      case 'land': {
        const ok = s.contacts >= 4 && s.vel.length() < 0.4 && Math.abs(s.w.y) < 0.2 && this.padUnder(s) === st.pad;
        return held(ok, SETTLE, 1e9);
      }
    }
  }

  private measure(dt: number, s: HeliState, hspeed: number): void {
    const a = this.acc;
    a.t += dt;
    a.wob += s.w.length() * DEG * dt;
    _eu.setFromQuaternion(s.q, 'YXZ');
    a.pitch = Math.max(a.pitch, Math.abs(_eu.x * DEG));
    a.bank = Math.max(a.bank, Math.abs(_eu.z * DEG));
    if (hspeed > 10) {
      _nose.set(0, 0, -1).applyQuaternion(s.q);
      const slip = Math.abs(Math.atan2(_nose.x * s.vel.z - _nose.z * s.vel.x, _nose.x * s.vel.x + _nose.z * s.vel.z)) * DEG;
      a.slip += slip * dt; a.slipT += dt;
    }
  }

  private finishRun(): TutorialEvent[] {
    const L = this.lesson!, a = this.acc;
    this.results[this.run] = {
      label: L.runs[this.run].label, time: a.t, wobble: a.wob / Math.max(a.t, 1e-6), drift: a.drift, collective: a.colT ? a.col / a.colT : 0,
      maxPitch: a.pitch, maxBank: a.bank, slip: a.slipT ? a.slip / a.slipT : 0, touchdown: a.touchdown,
    };
    if (this.run + 1 < L.runs.length) { this.phase = 'between'; this.countdown = BETWEEN_PAUSE; return []; }
    this.phase = 'done';
    return [{ kind: 'complete', lesson: L }];
  }

  /**
   * The step whose place to show: the current one, or for an instruction with no place of its own
   * ("slow down…") the hover marker or pad it leads up to.
   */
  private goal(): Step | null {
    const L = this.lesson;
    if (!L || (this.phase !== 'flying' && this.phase !== 'crashed')) return null;
    const cur = L.steps[this.step];
    if (cur?.kind !== 'do') return cur ?? null;
    const next = L.steps.slice(this.step).find(st => st.kind !== 'do');
    return next && (next.kind === 'zone' || next.kind === 'land') ? next : null;
  }

  /** Gates still to fly in this run (the next one first), and the marker or pad you are heading for. */
  markers(): { gates: { pos: Vector3; normal: Vector3; r: number; next: boolean }[]; zone: { pos: Vector3; r: number } | null; pad: Pad | null } {
    if (!this.lesson || (this.phase !== 'flying' && this.phase !== 'crashed')) return { gates: [], zone: null, pad: null };
    const steps = this.lesson.steps.slice(this.step);
    const gates = steps.flatMap(st => (st.kind === 'gate' ? [{ pos: st.pos, normal: st.normal, r: st.r }] : []))
      .map((g, i) => ({ ...g, next: i === 0 && steps[0].kind === 'gate' }));
    const goal = this.goal();
    return { gates, zone: goal?.kind === 'zone' ? { pos: goal.pos, r: goal.r } : null, pad: goal?.kind === 'land' ? goal.pad : null };
  }

  /** Where you are heading, for distance and direction hints. */
  target(): Vector3 | null {
    const st = this.goal();
    if (!st || st.kind === 'do') return null;
    if (st.kind === 'land') return _a.set(st.pad.x, st.pad.top, st.pad.z);
    return st.pos;
  }
}
