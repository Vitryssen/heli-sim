import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { ALL_OFF, ALL_ON, attitude, fly, fresh, kmh, layout, rpmPct, world } from './harness';
import { placeInFlight, placeOnGround, type HeliState } from '../src/sim/state';
import { params } from '../src/sim/params';
import { SKID_DROP } from '../src/sim/geometry';

const STAB_ONLY = { ...ALL_OFF, stability: true };
const base = layout.pads[0];
const up = (s: HeliState) => new Vector3(0, 1, 0).applyQuaternion(s.q).y;

function onBase(): HeliState { const s = fresh(); placeOnGround(s, base.x, base.top, base.z); return s; }
function running(s: HeliState): HeliState { s.engineOn = true; s.omega = s.spoolTarget = params.rotor.omegaNominal; return s; }

describe('engine and rotor', () => {
  test('holding collective up from cold lifts off in 2–4 s', () => {
    const s = onBase();
    let lift = -1;
    fly(s, 6, () => ({ collective: 1 }), ALL_ON, 0, (t, st) => { if (lift < 0 && st.pos.y > base.top + SKID_DROP + 0.3) lift = t; });
    expect(lift).toBeGreaterThan(2);
    expect(lift).toBeLessThan(4);
  });

  test('governor settles without overspeed after a spool-up', () => {
    for (const release of [0.8, 1.5, 2.5]) {
      const s = onBase();
      let high = 0;
      fly(s, 8, t => ({ collective: t < release ? 1 : 0 }), ALL_ON, 0, (_t, st) => { high = Math.max(high, rpmPct(st)); });
      expect(high).toBeLessThan(102.5);
      expect(rpmPct(s)).toBeGreaterThan(99);
    }
  });

  test('full collective gives a bounded climb rate', () => {
    const s = fresh(); placeInFlight(s, 0, 200, 0, 0);
    fly(s, 8, () => ({ collective: 1 }), STAB_ONLY);
    expect(s.vel.y).toBeGreaterThan(6);
    expect(s.vel.y).toBeLessThan(14);
  });

  test('rpm droops on a collective pull, rises in a flare, and the governor recovers', () => {
    const s = fresh(); placeInFlight(s, 0, 300, 0, 0);
    let low = 200;
    fly(s, 1.5, () => ({ collective: 1 }), STAB_ONLY, 0, (_t, st) => { low = Math.min(low, rpmPct(st)); });
    expect(low).toBeLessThan(99);
    fly(s, 6, () => ({}), STAB_ONLY);
    expect(rpmPct(s)).toBeGreaterThan(99.5);

    const f = fresh(); placeInFlight(f, 0, 300, 0, 200 / 3.6);
    f.q.setFromAxisAngle(new Vector3(1, 0, 0), -0.3);
    let high = 0;
    fly(f, 2, () => ({ pitch: -1 }), STAB_ONLY, 0, (_t, st) => { high = Math.max(high, rpmPct(st)); });
    expect(high).toBeGreaterThan(102);
  });
});

describe('flight model', () => {
  test('pulling up at speed climbs and slows (zoom climb)', () => {
    const s = fresh(); placeInFlight(s, 0, 150, 0, 200 / 3.6);
    s.q.setFromAxisAngle(new Vector3(1, 0, 0), -0.3);
    const y0 = s.pos.y, v0 = kmh(s);
    fly(s, 1, () => ({ pitch: -1 }), STAB_ONLY);
    fly(s, 2, () => ({}), STAB_ONLY);
    expect(s.pos.y - y0).toBeGreaterThan(15);
    expect(kmh(s)).toBeLessThan(v0 - 50);
  });

  test('flare load stays under the blade-stall limit', () => {
    const s = fresh(); placeInFlight(s, 0, 150, 0, 250 / 3.6);
    let peak = 0, rpm = 0;
    fly(s, 3, () => ({ pitch: -1 }), STAB_ONLY, 0, (_t, st) => { peak = Math.max(peak, st.thrust / (params.mass * params.g)); rpm = Math.max(rpm, rpmPct(st)); });
    expect(peak).toBeGreaterThan(1.5);
    expect(peak).toBeLessThan(2.6);
    expect(rpm).toBeLessThan(115);
  });

  test('neutral collective with auto-hover holds altitude within ±0.5 m', () => {
    const s = fresh(); placeInFlight(s, 0, 120, 0, 0);
    fly(s, 4, () => ({}), ALL_ON);
    const y0 = s.pos.y;
    let dev = 0;
    fly(s, 10, () => ({}), ALL_ON, 4, (_t, st) => { dev = Math.max(dev, Math.abs(st.pos.y - y0)); });
    expect(dev).toBeLessThan(0.5);
  });

  test('neutral collective without auto-hover slowly sinks', () => {
    const s = fresh(); placeInFlight(s, 0, 200, 0, 0);
    fly(s, 6, () => ({}), STAB_ONLY);
    expect(s.vel.y).toBeLessThan(-0.3);
    expect(s.vel.y).toBeGreaterThan(-3);
  });

  test('translational lift: holding 60 km/h needs less collective than hovering', () => {
    const hover = fresh(); placeInFlight(hover, 0, 200, 0, 0);
    fly(hover, 12, () => ({}), ALL_ON);
    const cruise = fresh(); placeInFlight(cruise, 0, 200, 0, 60 / 3.6);
    // fly it like a pilot: pick a nose-down attitude from the speed error and steer the stick to it
    const hold = (_t: number, st: HeliState) => {
      const target = -Math.max(0, Math.min(20, 6 + (60 - kmh(st)) * 0.6));
      return { pitch: Math.max(-1, Math.min(1, (attitude(st).pitch - target) * 0.15)) };
    };
    fly(cruise, 20, hold, ALL_ON);
    expect(Math.abs(kmh(cruise) - 60)).toBeLessThan(10);
    expect(cruise.theta).toBeLessThan(hover.theta - 0.005);
  });

  test('a 30° bank at 150 km/h with turn coordination turns at least 5°/s', () => {
    const s = fresh(); placeInFlight(s, 0, 300, 0, 150 / 3.6);
    fly(s, 3, (_t, st) => ({ roll: attitude(st).roll > -30 ? 1 : 0 }), { ...ALL_ON, autoHover: false });
    const h0 = attitude(s).heading;
    fly(s, 4, () => ({}), { ...ALL_ON, autoHover: false });
    const turned = ((attitude(s).heading - h0) + 360) % 360;
    expect(turned / 4).toBeGreaterThan(5);
  });

  test('envelope limits cap pitch and bank', () => {
    const s = fresh(); placeInFlight(s, 0, 300, 0, 30);
    let maxP = 0, maxR = 0;
    fly(s, 3, () => ({ pitch: 1, roll: 1 }), { ...ALL_OFF, envelope: true }, 0, (_t, st) => {
      const a = attitude(st); maxP = Math.max(maxP, -a.pitch); maxR = Math.max(maxR, -a.roll);
    });
    expect(maxP).toBeLessThan(45);
    expect(maxR).toBeLessThan(62);   // 50° limit; raw momentum carries a little past it
  });
});

describe('ground handling and recovery', () => {
  test('full cyclic on the skids at flat pitch does not tip the aircraft', () => {
    const s = running(onBase());
    const r = fly(s, 3, () => ({ pitch: 1 }), ALL_ON);
    expect(r.crash).toBeNull();
    expect(Math.abs(attitude(s).pitch)).toBeLessThan(10);
  });

  test('auto-hover braking from 150 km/h at 8 m above ground stays upright', () => {
    // pick a heading with a clear 600 m corridor
    let heading = 0;
    for (let h = 0; h < 360; h += 5) {
      const rad = (h * Math.PI) / 180, dx = Math.sin(rad), dz = -Math.cos(rad);
      const clear = layout.trees.every(t => { const along = t.x * dx + t.z * dz, across = Math.abs(t.x * dz - t.z * dx); return along < 0 || along > 600 || across > 15; })
        && layout.buildings.every(b => { const along = b.x * dx + b.z * dz, across = Math.abs(b.x * dz - b.z * dx); return along < 0 || along > 600 || across > 40; });
      if (clear) { heading = rad; break; }
    }
    const s = fresh(); placeInFlight(s, 0, world.terrainH(0, 0) + 8 + SKID_DROP, 0, 150 / 3.6, heading);
    let minUp = 1;
    const r = fly(s, 15, () => ({}), ALL_ON, 0, (_t, st) => { minUp = Math.min(minUp, up(st)); });
    expect(r.crash).toBeNull();
    expect(minUp).toBeGreaterThan(0.8);
    expect(kmh(s)).toBeLessThan(15);
  });
});

describe('landing damage', () => {
  function drop(sink: number) {
    const s = fresh(); placeInFlight(s, base.x, base.top + SKID_DROP + 0.02, base.z, 0);
    s.vel.y = -sink;
    return fly(s, 2, () => ({ collective: -1 }), ALL_ON);
  }
  test('2 m/s touchdown is clean', () => { const r = drop(2); expect(r.crash).toBeNull(); expect(r.s.hull).toBe(100); });
  test('6 m/s touchdown damages the airframe', () => { const r = drop(6); expect(r.crash).toBeNull(); expect(r.s.hull).toBeLessThan(100); });
  test('9 m/s touchdown destroys it', () => { const r = drop(9); expect(r.crash).toMatch(/collapsed/); });
});
