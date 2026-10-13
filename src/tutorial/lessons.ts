import { Vector3 } from 'three';
import type { AssistFlags, HeliState } from '../sim/state';
import type { Layout, Pad } from '../world/layout';
import { createTargets } from '../combat/targets';
import { terrainH } from '../world/terrain';

/** What a lesson reports at the end of each run. */
export type Metric = 'time' | 'wobble' | 'drift' | 'collective' | 'maxPitch' | 'maxBank' | 'slip' | 'touchdown';

/** Where a run starts. Without `agl` the aircraft sits cold on the ground (or on `top`). */
export interface Start { x: number; z: number; heading: number; agl?: number; speed?: number; top?: number }   // heading °, speed km/h

/** Solo combat as the HUD shows it, for the weapons lesson. `threat` is the training missile's fate. */
export interface CombatProbe { mode: 'gun' | 'missile'; lock: 'none' | 'search' | 'locked'; targetKills: number; threat: 'none' | 'inbound' | 'decoyed' | 'hit' }
export const NO_COMBAT: CombatProbe = { mode: 'gun', lock: 'none', targetKills: 0, threat: 'none' };

/** Flight data a step's condition can look at; `since` is the combat state when the step began. */
export interface Probe { s: HeliState; heading: number; hspeed: number; combat: CombatProbe; since: CombatProbe }   // heading 0..360°, horizontal speed m/s

export type Step =
  | { kind: 'do'; text: string; done: (p: Probe) => boolean; hold?: number; measure?: boolean; handsOff?: boolean; incoming?: boolean }   // handsOff: only counts with the collective centred; incoming: a training missile is fired at you when the step starts (and again if one gets through)
  | { kind: 'gate'; text: string; pos: Vector3; normal: Vector3; r: number }
  | { kind: 'zone'; text: string; pos: Vector3; r: number; hold: number; maxSpeed: number }
  | { kind: 'land'; text: string; pad: Pad };

/** One pass through the steps with a given set of assists. Assist lessons fly two. */
export interface Run { label: string; assists: AssistFlags; intro: string }

export interface Lesson {
  id: string;
  group: 'Basics' | 'Forward flight' | 'Landing' | 'Assists' | 'Combat';
  title: string;
  summary: string;
  start: Start;
  runs: Run[];
  steps: Step[];
  metrics: Metric[];
}

const ALL_ON: AssistFlags = { stability: true, autoHover: true, envelope: true, turnCoord: true };
const without = (k: keyof AssistFlags): AssistFlags => ({ ...ALL_ON, [k]: false });
const allOn = (intro: string): Run[] => [{ label: 'All assists on', assists: ALL_ON, intro }];

/** Signed difference between two headings in degrees, -180..180. */
export const headingError = (a: number, b: number): number => ((a - b + 540) % 360) - 180;

/** Gates, markers and pads in flying order; each gate faces the way you arrive from the previous point. */
function course(x0: number, z0: number) {
  let last = new Vector3(x0, 0, z0);
  const ground = (x: number, z: number, r: number) => {
    let h = terrainH(x, z);
    for (let a = 0; a < 8; a++) h = Math.max(h, terrainH(x + Math.cos(a * Math.PI / 4) * r, z + Math.sin(a * Math.PI / 4) * r));
    return h;
  };
  return {
    gate(text: string, x: number, z: number, height: { agl: number } | { y: number }, r = 9): Step {
      const pos = new Vector3(x, 'y' in height ? height.y : ground(x, z, r) + height.agl, z);
      const normal = new Vector3(x - last.x, 0, z - last.z).normalize();
      last = pos;
      return { kind: 'gate', text, pos, normal, r };
    },
    zone(text: string, x: number, z: number, r: number, hold: number, maxSpeed = 1.5): Step {
      last = new Vector3(x, terrainH(x, z), z);
      return { kind: 'zone', text, pos: last, r, hold, maxSpeed };
    },
    land(text: string, pad: Pad): Step {
      last = new Vector3(pad.x, pad.top, pad.z);
      return { kind: 'land', text, pad };
    },
  };
}

/**
 * The tutorial. Step text can name keys as {action}; the panel swaps in the player's bindings.
 * Courses use the fixed map, so tests can check every gate and start point is clear.
 */
export function buildLessons(layout: Layout): Lesson[] {
  const [base, roof] = layout.pads;
  const trucks = createTargets(layout).filter(t => t.kind === 'ground');
  const near = (p: Probe, x: number, z: number, r: number) => Math.hypot(p.s.pos.x - x, p.s.pos.z - z) < r;
  const lessons: Lesson[] = [];

  {
    const c = course(base.x, base.z);
    lessons.push({
      id: 'liftoff', group: 'Basics', title: 'Lift-off and hover',
      summary: 'Start the engine, lift off, hover, and set down again.',
      start: { x: base.x, z: base.z, heading: 0, top: base.top },
      runs: allOn('The collective lever ({collectiveUp} {collectiveDown}) springs back to neutral when you let go.'),
      steps: [
        { kind: 'do', text: 'Hold {collectiveUp} to start the engine. Keep holding.', done: p => p.s.engineOn },
        { kind: 'do', text: 'Keep holding {collectiveUp} while the rotor spools up, until the skids lift.', done: p => !p.s.grounded && p.s.agl > 0.5 },
        { kind: 'do', text: 'Climb to 5–10 m, then let go. Auto-hover holds the height for you.', done: p => p.s.agl >= 5 && p.s.agl <= 10 },
        { kind: 'do', text: 'Hold a steady hover at 5–10 m for 5 s. Small taps of {pitchForward} {pitchBack} {rollLeft} {rollRight} stop any drift.', hold: 5, done: p => p.s.agl >= 4 && p.s.agl <= 11 && p.hspeed < 1.5 },
        c.land('Hold {collectiveDown} to come down slowly and settle on the pad.', base),
      ],
      metrics: ['time', 'touchdown'],
    });
  }
  {
    const c = course(base.x, base.z);
    lessons.push({
      id: 'pedals', group: 'Basics', title: 'Pedal turns and hover-taxi',
      summary: 'Turn on the spot, creep through a low gate, and land back on the pad.',
      start: { x: base.x, z: base.z, heading: 0, agl: 6, speed: 0 },
      runs: allOn('The pedals ({yawLeft} {yawRight}) turn the nose. The heading readout is at the bottom of the HUD.'),
      steps: [
        { kind: 'do', text: 'Hold {yawLeft} to turn left until you face west (heading 270), toward the hangar.', done: p => Math.abs(headingError(p.heading, 270)) < 12 },
        { kind: 'do', text: 'Now hold {yawRight} and turn all the way round to east (090).', done: p => Math.abs(headingError(p.heading, 90)) < 12 },
        { kind: 'do', text: 'Turn back to face north (000).', done: p => Math.abs(headingError(p.heading, 0)) < 12 },
        c.gate('Nudge {pitchForward} to creep forward through the low gate. It keeps moving after you let go, so use small inputs.', base.x, base.z - 30, { agl: 6.5 }, 5),
        c.zone('Tap {pitchBack} to stop, then hover over the marker for 3 s.', base.x, base.z - 60, 6, 3),
        c.land('Turn round with the pedals, hover-taxi back, and land on the Base pad.', base),
      ],
      metrics: ['time', 'touchdown'],
    });
  }
  {
    const c = course(base.x, base.z);
    lessons.push({
      id: 'cruise', group: 'Forward flight', title: 'Speed, turns and stopping',
      summary: 'Pick up speed, bank through a course of gates, and stop without ballooning.',
      start: { x: base.x, z: base.z, heading: 0, agl: 20, speed: 0 },
      runs: allOn('The aircraft carries momentum: speed builds slowly and keeps going after you level off.'),
      steps: [
        c.gate('Push {pitchForward} to tilt forward and pick up speed. Fly through the gate.', 0, -150, { agl: 20 }),
        c.gate('Keep going. Level off with {pitchBack} once you are fast enough.', 0, -320, { agl: 25 }),
        c.gate('Bank left with {rollLeft}: roll in, then let go. The bank holds and the nose follows round.', -150, -420, { agl: 30 }),
        c.gate('Roll out with {rollRight} when you line up with the next gate.', -200, -280, { agl: 30 }),
        c.gate('Turn left again, back toward Base.', -130, -150, { agl: 25 }),
        c.zone('Stop over the marker. Raise the nose with {pitchBack} to slow down; if you start climbing, ease the collective down with {collectiveDown}.', 0, -60, 12, 2, 2),
      ],
      metrics: ['time', 'maxBank'],
    });
  }
  {
    const c = course(0, 400);
    lessons.push({
      id: 'landing', group: 'Landing', title: 'Landing on a pad',
      summary: 'Approach Base from the south and touch down on the H.',
      start: { x: 0, z: 400, heading: 0, agl: 30, speed: 60 },
      runs: allOn('A good approach is slow and steady: lose speed early, then come straight down.'),
      steps: [
        c.gate('Fly toward Base and ease down through the approach gate.', 0, 180, { agl: 16 }),
        { kind: 'do', text: 'Slow to walking pace as you reach the pad: raise the nose with {pitchBack}, then level off.', done: p => near(p, base.x, base.z, 30) && p.hspeed < 3 },
        c.land('Hover over the H, then hold {collectiveDown} gently and settle. Under 1.5 m/s is a smooth touchdown.', base),
      ],
      metrics: ['time', 'touchdown'],
    });
  }
  {
    const c = course(roof.x, -60);
    lessons.push({
      id: 'rooftop', group: 'Landing', title: 'Rooftop landing',
      summary: 'Land on the small pad on top of the tallest building in town.',
      start: { x: roof.x, z: -60, heading: 0, agl: 45, speed: 40 },
      runs: allOn('The rooftop pad is the same size as Base, but there is nothing around it to catch a mistake.'),
      steps: [
        c.gate('Head for the town and fly through the gate, well above the rooftops.', roof.x, -200, { y: roof.top + 20 }),
        { kind: 'do', text: 'Slow down and hover above the rooftop H.', done: p => near(p, roof.x, roof.z, 10) && p.hspeed < 1.5 && !p.s.grounded },
        c.land('Come down slowly onto the roof, keeping the H centred under you.', roof),
      ],
      metrics: ['time', 'touchdown'],
    });
  }
  {
    const c = course(0, 200);
    lessons.push({
      id: 'stability', group: 'Assists', title: 'Stability assist',
      summary: 'Hover, fly a short leg and stop: once with stability on, once with it off.',
      start: { x: 0, z: 200, heading: 0, agl: 20, speed: 0 },
      runs: [
        { label: 'Stability on', assists: ALL_ON, intro: 'The stick sets how fast the aircraft rotates, and it holds whatever attitude you let go at. It also cancels rotor torque and holds your heading.' },
        { label: 'Stability off', assists: without('stability'), intro: 'Now the stick shoves the aircraft into a rotation that keeps going until you stop it, and rotor torque swings the nose. Use small, short inputs and catch each one with the opposite input.' },
      ],
      steps: [
        c.zone('Hover over the marker for 8 s.', 0, 200, 10, 8, 2.5),
        c.gate('Fly through the gate ahead.', 0, 110, { agl: 20 }),
        c.zone('Stop and hover over the next marker for 2 s.', 0, 30, 12, 2, 2),
      ],
      metrics: ['time', 'wobble'],
    });
  }
  {
    lessons.push({
      id: 'autohover', group: 'Assists', title: 'Auto-hover',
      summary: 'Climb, hold a height and descend: once with auto-hover on, once with it off.',
      start: { x: 0, z: 200, heading: 0, agl: 15, speed: 0 },
      runs: [
        { label: 'Auto-hover on', assists: ALL_ON, intro: 'Auto-hover flies the collective for you: let go of it and the aircraft holds its height.' },
        { label: 'Auto-hover off', assists: without('autoHover'), intro: 'Now neutral collective does not quite hold the weight, so you slowly sink. Make small collective corrections and watch the V/S readout on the right.' },
      ],
      steps: [
        { kind: 'do', text: 'Climb to 35–45 m with {collectiveUp} and level off there.', hold: 1, done: p => p.s.agl >= 35 && p.s.agl <= 45 && Math.abs(p.s.vel.y) < 0.5 },
        { kind: 'do', text: 'Let go of the collective completely for 6 s and watch the height.', hold: 6, handsOff: true, done: () => true },
        { kind: 'do', text: 'Get back to 35–45 m and hold it there for 8 s.', hold: 8, measure: true, done: p => p.s.agl >= 35 && p.s.agl <= 45 && p.hspeed < 3 },
        { kind: 'do', text: 'Descend to 10–15 m with {collectiveDown} and hold it for 3 s.', hold: 3, measure: true, done: p => p.s.agl >= 10 && p.s.agl <= 15 && p.hspeed < 3 },
      ],
      metrics: ['time', 'drift', 'collective'],
    });
  }
  {
    const c = course(0, 520);
    lessons.push({
      id: 'envelope', group: 'Assists', title: 'Envelope limits',
      summary: 'Stop hard from speed: once with the limits on, once with them off.',
      start: { x: 0, z: 520, heading: 0, agl: 25, speed: 120 },
      runs: [
        { label: 'Envelope limits on', assists: ALL_ON, intro: 'Envelope limits stop the nose at 35° of pitch and the bank at 50°, however hard you pull.' },
        { label: 'Envelope limits off', assists: without('envelope'), intro: 'Now nothing stops the nose. Pull too hard and you balloon upward or flip over, so ease the stick back yourself.' },
      ],
      steps: [
        c.gate('Keep your speed up and fly through the gate.', 0, 380, { agl: 25 }),
        c.zone('Stop as quickly as you can with {pitchBack}, then hover over the marker for 2 s.', 0, 220, 15, 2, 2),
      ],
      metrics: ['time', 'maxPitch'],
    });
  }
  {
    const c = course(0, 520);
    lessons.push({
      id: 'turncoord', group: 'Assists', title: 'Turn coordination',
      summary: 'Slalom through gates: once with turn coordination on, once with it off.',
      start: { x: 0, z: 520, heading: 0, agl: 30, speed: 100 },
      runs: [
        { label: 'Turn coordination on', assists: ALL_ON, intro: 'Above about 30 km/h, turn coordination swings the nose into a banked turn, so the stick alone is enough.' },
        { label: 'Turn coordination off', assists: without('turnCoord'), intro: 'Now banking alone leaves the nose pointing straight while the aircraft skids sideways. Add pedal toward the bank ({yawLeft} in a left bank, {yawRight} in a right bank) to keep the nose lined up.' },
      ],
      steps: [
        c.gate('Bank right with {rollRight} through the first gate.', 50, 380, { agl: 30 }, 10),
        c.gate('Bank left with {rollLeft} for the next one.', -50, 250, { agl: 30 }, 10),
        c.gate('Right again.', 50, 120, { agl: 30 }, 10),
        c.gate('And left through the last gate.', -50, -10, { agl: 30 }, 10),
      ],
      metrics: ['time', 'slip'],
    });
  }
  {
    const truck = trucks[0];                                     // west of the town, open ground to the south
    lessons.push({
      id: 'weapons', group: 'Combat', title: 'Guns, missiles and flares',
      summary: 'Shoot a truck with the miniguns, lock and fire a missile, and decoy an incoming one with flares.',
      start: { x: truck.pos.x, z: truck.pos.z + 350, heading: 0, agl: 30, speed: 0 },
      runs: allOn('Practice targets are orange on the minimap: trucks on the ground and drones in the air. Click the view first so the mouse buttons fire.'),
      steps: [
        { kind: 'do', text: 'Put the small amber ring on the truck ahead and hold {fire} to fire the miniguns. Destroy it.', done: p => p.combat.targetKills > p.since.targetKills },
        { kind: 'do', text: 'Press {weaponToggle} to switch to missiles.', done: p => p.combat.mode === 'missile' },
        { kind: 'do', text: 'Turn toward another truck and hold it inside the dashed circle until the box turns red and says LOCK.', done: p => p.combat.mode === 'missile' && p.combat.lock === 'locked' },
        { kind: 'do', text: 'Fire with {fire} and watch the missile find its target.', done: p => p.combat.targetKills > p.since.targetKills },
        { kind: 'do', text: 'Missile warning! A training missile is coming for you. Drop flares with {flares} to decoy it.', incoming: true, done: p => p.combat.threat === 'decoyed' },
        { kind: 'do', text: 'Switch back to the guns with {weaponToggle}.', done: p => p.combat.mode === 'gun' },
      ],
      metrics: ['time'],
    });
  }
  return lessons;
}
