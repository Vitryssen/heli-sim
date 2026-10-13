import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { OwnView } from '../src/net/ownView';
import { NET_DT } from '../src/net/protocol';

/**
 * Drives OwnView like main.ts does: the aircraft moves along x at `speed` in 60 Hz steps, frames
 * come at `hz`, and `correct(t)` can move the predicted aircraft between frames like a snapshot.
 * Returns the drawn x of every frame.
 */
function render(hz: number, seconds: number, speed: number, correct?: (t: number) => number) {
  const view = new OwnView(), s = { pos: new Vector3(), q: new Quaternion() };
  view.corrected(s, s, true);
  const xs: number[] = [];
  let accum = 0, t = 0, shift = 0;
  for (let f = 0; f < seconds * hz; f++) {
    const dt = 1 / hz;
    t += dt; accum += dt;
    while (accum >= NET_DT) { view.beforeStep(s); s.pos.x += speed * NET_DT; accum -= NET_DT; }
    const jump = correct?.(t) ?? 0;
    if (jump) {
      const before = { pos: s.pos.clone(), q: s.q.clone() };
      s.pos.x += jump; shift += jump;
      view.corrected(before, s, false);
    }
    view.update(s, dt, accum / NET_DT);
    xs.push(view.pos.x);
  }
  return { xs, s, shift };
}
const steps = (xs: number[]) => xs.slice(1).map((x, i) => x - xs[i]);

describe('own aircraft view in multiplayer', () => {
  test.each([120, 144])('moves evenly every frame at %i Hz', hz => {
    const d = steps(render(hz, 2, 30).xs).slice(10);
    const ideal = 30 / hz;
    for (const x of d) expect(Math.abs(x - ideal)).toBeLessThan(ideal * 0.02);
  });

  test('a server correction never pops and is blended out within half a second', () => {
    const hz = 144, speed = 30, ideal = speed / hz;
    const { xs, s } = render(hz, 1.5, speed, t => (Math.abs(t - 0.7) < 0.5 / hz ? 0.6 : 0));    // 60 cm correction at 0.7 s
    for (const x of steps(xs).slice(10)) expect(Math.abs(x - ideal)).toBeLessThan(ideal * 0.6);
    expect(Math.abs(xs.at(-1)! - s.pos.x)).toBeLessThan(0.3);     // drawn back on the corrected path (one step behind at most)
  });

  test('a respawn jumps straight to the new spot', () => {
    const view = new OwnView(), s = { pos: new Vector3(), q: new Quaternion() };
    view.corrected(s, s, true);
    view.update(s, 1 / 60, 0.5);
    const before = { pos: s.pos.clone(), q: s.q.clone() };
    s.pos.set(500, 10, -300);
    view.corrected(before, s, true);
    view.update(s, 1 / 60, 0.5);
    expect(view.pos.distanceTo(s.pos)).toBeLessThan(1e-9);
  });
});
