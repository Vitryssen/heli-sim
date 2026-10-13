import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { buildLessons, headingError, type Lesson } from '../src/tutorial/lessons';
import { crossedGate, Tutorial, type TutorialEvent } from '../src/tutorial/tutorial';
import { placeInFlight, placeOnGround, type AssistFlags, type HeliState, type PilotInput } from '../src/sim/state';
import { SIM_DT, step } from '../src/sim/step';
import { crashCheck, MAP_LIMIT } from '../src/sim/collisions';
import { params } from '../src/sim/params';
import { NET_DT, SUBSTEPS } from '../src/net/protocol';
import { Landings } from '../src/game/landings';
import { clamp } from '../src/sim/math';
import { fresh, layout, NEUTRAL, world } from './harness';

const lessons = buildLessons(layout);
const lesson = (id: string) => lessons.find(l => l.id === id)!;
const landings = new Landings(layout.pads);

/** Puts the aircraft where the tutorial says. */
function place(s: HeliState, e: TutorialEvent): void {
  if (e.kind !== 'place') return;
  const a = e.at;
  if (a.cold) placeOnGround(s, a.x, a.y, a.z, a.heading);
  else placeInFlight(s, a.x, a.y, a.z, a.speed, a.heading, params.rotor.omegaNominal);
}

/** Flies a lesson at 60 Hz with scripted inputs until it ends or `seconds` pass. */
function fly(l: Lesson, seconds: number, input: (s: HeliState, t: Tutorial) => Partial<PilotInput>) {
  const s = fresh(), tut = new Tutorial(st => landings.padUnder(st));
  place(s, tut.start(l));
  const events: TutorialEvent[] = [];
  let simT = 0;
  for (let t = 0; t < seconds && tut.phase !== 'done'; t += NET_DT) {
    const assists = tut.assists!;
    const i = { ...NEUTRAL, ...input(s, tut) };
    for (let k = 0; k < SUBSTEPS; k++) { step(s, i, assists, world, SIM_DT, simT, params); simT += SIM_DT; }
    if (!s.crashed) { const c = crashCheck(s, world); if (c) s.crashed = true; }
    for (const e of tut.tick(NET_DT, s, i)) { events.push(e); place(s, e); }
  }
  return { s, tut, events };
}

describe('lesson courses', () => {
  test('ids are unique and every lesson has steps and runs', () => {
    expect(new Set(lessons.map(l => l.id)).size).toBe(lessons.length);
    for (const l of lessons) { expect(l.steps.length).toBeGreaterThan(0); expect(l.runs.length).toBeGreaterThan(0); }
    for (const l of lessons.filter(x => x.group === 'Assists')) expect(l.runs.map(r => Object.values(r.assists).filter(v => !v).length)).toEqual([0, 1]);
  });

  test('every gate ring, marker and start point is clear of terrain, buildings and trees', () => {
    const solid = (p: Vector3) => { world.focus(p.x, p.z); return world.solidAt(p.x, p.y, p.z); };
    for (const l of lessons) {
      const tut = new Tutorial(() => null);
      const at = (tut.start(l) as Extract<TutorialEvent, { kind: 'place' }>).at;
      if (!at.cold) {
        for (const d of [[0, 0], [5, 0], [-5, 0], [0, 5], [0, -5]]) expect(solid(new Vector3(at.x + d[0], at.y, at.z + d[1])), `${l.id} start`).toBe(false);
        expect(at.y - world.groundAt(at.x, at.z, at.y), `${l.id} start height`).toBeGreaterThan(4);
      }
      for (const st of l.steps) {
        if (st.kind === 'gate') {
          const side = new Vector3(0, 1, 0).cross(st.normal).normalize();
          for (let a = 0; a < 24; a++) {
            const ang = (a / 24) * Math.PI * 2;
            const p = st.pos.clone().addScaledVector(side, Math.cos(ang) * st.r).add(new Vector3(0, Math.sin(ang) * st.r, 0));
            expect(solid(p), `${l.id} gate at ${st.pos.x},${st.pos.z}`).toBe(false);
          }
          expect(st.pos.y - st.r - world.groundAt(st.pos.x, st.pos.z, st.pos.y), `${l.id} gate clearance`).toBeGreaterThan(-0.01);
        }
        const p = st.kind === 'land' ? st.pad : 'pos' in st ? st.pos : null;
        if (p) expect(Math.max(Math.abs(p.x), Math.abs(p.z))).toBeLessThan(MAP_LIMIT - 600);
      }
    }
  });

  test('a gate counts only when flown through forwards and inside the ring', () => {
    const pos = new Vector3(0, 20, -100), n = new Vector3(0, 0, -1);
    expect(crossedGate(new Vector3(2, 21, -99), new Vector3(2, 21, -101), pos, n, 9)).toBe(true);
    expect(crossedGate(new Vector3(2, 21, -101), new Vector3(2, 21, -99), pos, n, 9)).toBe(false);   // backwards
    expect(crossedGate(new Vector3(12, 20, -99), new Vector3(12, 20, -101), pos, n, 9)).toBe(false);  // outside the ring
    const tut = new Tutorial(() => null), s = fresh(), first = lesson('cruise').steps[0];
    place(s, tut.start(lesson('cruise')));
    if (first.kind !== 'gate') throw new Error('cruise should open with a gate');
    s.pos.copy(first.pos).addScaledVector(first.normal, -1);
    expect(tut.tick(NET_DT, s, NEUTRAL)).toEqual([]);
    s.pos.copy(first.pos).addScaledVector(first.normal, 1);
    expect(tut.tick(NET_DT, s, NEUTRAL)).toEqual([{ kind: 'gate' }]);       // the chime cue
    expect(tut.step).toBe(1);
    expect(headingError(350, 10)).toBe(-20);
    expect(headingError(10, 350)).toBe(20);
  });
});

describe('markers', () => {
  test('a step with no place of its own points at the pad or marker it leads up to', () => {
    const tut = new Tutorial(() => null), s = fresh();
    for (const id of ['landing', 'rooftop']) {
      place(s, tut.start(lesson(id)));
      expect(tut.markers().pad).toBeNull();                         // first the approach gate
      tut.step = 1;                                                 // "slow down over the pad"
      const pad = (lesson(id).steps.at(-1) as Extract<Lesson['steps'][number], { kind: 'land' }>).pad;
      expect(tut.markers().pad).toBe(pad);
      expect(tut.target()?.x).toBe(pad.x);
    }
    place(s, tut.start(lesson('pedals')));                          // pedal turns lead to a gate, not a pad
    expect(tut.markers().pad).toBeNull();
    expect(tut.target()).toBeNull();
  });
});

describe('flying lessons', () => {
  test('lift-off and hover can be flown start to finish', () => {
    const { tut, events } = fly(lesson('liftoff'), 60, (s, t) => {
      if (t.step <= 2) return { collective: s.agl < 7 ? 1 : 0 };
      if (t.step === 3) return {};
      return { collective: clamp((-0.6 - s.vel.y) * 0.4, -0.5, 0.3) };   // sink at about 0.6 m/s
    });
    expect(tut.phase).toBe('done');
    expect(events.at(-1)).toMatchObject({ kind: 'complete' });
    expect(tut.results).toHaveLength(1);
    expect(tut.results[0].touchdown).toBeLessThan(1.5);
  });

  test('auto-hover: the same climb-hold-descend task, flown with and then without the assist', () => {
    // a simple height-hold autopilot on the collective; with auto-hover on it lets go once in the band
    const target = (t: Tutorial) => (t.step === 3 ? 12.5 : 40);
    const { tut, events } = fly(lesson('autohover'), 120, (s, t) => {
      const err = target(t) - s.agl;
      if (t.step === 1) return {};                                     // the hands-off step
      const band = t.step === 3 ? [10, 15] : [35, 45];
      if (t.assists?.autoHover) return { collective: s.agl > band[0] + 1 && s.agl < band[1] - 1 ? 0 : clamp(err * 0.2, -0.6, 1) };
      return { collective: clamp(err * 0.08 - s.vel.y * 0.25, -0.6, 1) };
    });
    expect(tut.phase).toBe('done');
    expect(events.filter(e => e.kind === 'place')).toHaveLength(1);        // the second run
    expect(tut.results.map(r => r.label)).toEqual(['Auto-hover on', 'Auto-hover off']);
    expect(tut.results[0].drift).toBeLessThan(1);                    // hands off, the height holds
    expect(tut.results[1].drift).toBeGreaterThan(Math.max(2, 5 * tut.results[0].drift));   // hands off, it sinks
  });

  test('a crash restarts the run where it began', () => {
    const l = lesson('stability');
    let crashes = 0;
    const { s, tut, events } = fly(l, 4, st => { if (crashes++ === 30) st.crashed = true; return {}; });
    expect(events.filter(e => e.kind === 'place')).toHaveLength(1);
    expect(tut.run).toBe(0);
    expect(s.crashed).toBe(false);
    expect(Math.hypot(s.pos.x - l.start.x, s.pos.z - l.start.z)).toBeLessThan(1);
  });
});

describe('weapons lesson', () => {
  test('steps follow the combat state; a missile that gets through is sent again', () => {
    const l = lesson('weapons'), tut = new Tutorial(() => null), s = fresh();
    place(s, tut.start(l));
    const c = { mode: 'gun' as const, lock: 'none' as const, targetKills: 0, threat: 'none' as const };
    const tick = (combat: object) => tut.tick(NET_DT, s, NEUTRAL, { ...c, ...combat });
    tick({});                                                    // step 1 begins
    tick({ targetKills: 1 }); expect(tut.step).toBe(1);          // truck down with the guns
    tick({ targetKills: 1, mode: 'missile' }); expect(tut.step).toBe(2);
    tick({ targetKills: 1, mode: 'missile', lock: 'search' }); expect(tut.step).toBe(2);
    tick({ targetKills: 1, mode: 'missile', lock: 'locked' }); expect(tut.step).toBe(3);
    tick({ targetKills: 1, mode: 'missile' }); expect(tut.step).toBe(3);        // a kill from before this step doesn't count
    tick({ targetKills: 2, mode: 'missile' }); expect(tut.step).toBe(4);
    expect(tick({ targetKills: 2, mode: 'missile' })).toEqual([{ kind: 'incoming' }]);          // flare step: here it comes
    expect(tick({ targetKills: 2, mode: 'missile', threat: 'inbound' })).toEqual([]);
    expect(tick({ targetKills: 2, mode: 'missile', threat: 'hit' })).toEqual([{ kind: 'incoming' }]);   // got through: again
    tick({ targetKills: 2, mode: 'missile', threat: 'inbound' });
    tick({ targetKills: 2, mode: 'missile', threat: 'decoyed' }); expect(tut.step).toBe(5);
    expect(tick({ targetKills: 2, mode: 'gun', threat: 'decoyed' })).toMatchObject([{ kind: 'complete' }]);
  });
});

describe('what the assist runs show', () => {
  /** Flies one run of a lesson for `seconds` with fixed inputs and returns its measurements so far. */
  function sample(id: string, assists: AssistFlags, seconds: number, input: (s: HeliState, t: number) => Partial<PilotInput>) {
    const l = { ...lesson(id), runs: [{ label: 'x', assists, intro: '' }], steps: [{ kind: 'do' as const, text: '', done: () => false }] };
    let time = 0;
    const r = fly(l, seconds, s => input(s, (time += NET_DT)));
    return { ...(r.tut as unknown as { acc: { pitch: number; slip: number; slipT: number } }).acc, s: r.s, y0: placementY(l) };
  }
  const placementY = (l: Lesson) => (new Tutorial(() => null).start(l) as Extract<TutorialEvent, { kind: 'place' }>).at.y;
  const on: AssistFlags = { stability: true, autoHover: true, envelope: true, turnCoord: true };

  test('auto-hover holds the height hands-off; without it the aircraft sinks', () => {
    const a = sample('autohover', on, 10, () => ({})), b = sample('autohover', { ...on, autoHover: false }, 10, () => ({}));
    expect(Math.abs(a.s.pos.y - a.y0)).toBeLessThan(1);
    expect(b.y0 - b.s.pos.y).toBeGreaterThan(5);
  });

  test('envelope limits cap the pitch of a hard stop', () => {
    const stop = () => ({ pitch: -1 });
    expect(sample('envelope', on, 2.5, stop).pitch).toBeLessThan(37);
    expect(sample('envelope', { ...on, envelope: false }, 2.5, stop).pitch).toBeGreaterThan(45);
  });

  test('turn coordination keeps the nose lined up in a banked turn', () => {
    const turn = (_s: HeliState, t: number) => ({ roll: t < 0.6 ? 1 : 0 });
    const a = sample('turncoord', on, 4, turn), b = sample('turncoord', { ...on, turnCoord: false }, 4, turn);
    expect(b.slip / b.slipT).toBeGreaterThan(2 * (a.slip / a.slipT));
  });
});
