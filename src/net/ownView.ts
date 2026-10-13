import { Quaternion, Vector3 } from 'three';

interface Pose { pos: Vector3; q: Quaternion }

const SNAP = 8;               // m: a correction this big is drawn as a jump, not glided
const _b = new Vector3(), _bq = new Quaternion(), _d = new Quaternion(), _id = new Quaternion();

/**
 * Where to draw your own aircraft in multiplayer. Prediction moves it in 60 Hz steps and server
 * corrections move it whenever a snapshot lands. Drawn between its last two steps (like solo),
 * it moves on every frame of a faster screen; a correction is kept as an offset from where it was
 * drawn and blended out over ~100 ms, so it never pops.
 */
export class OwnView {
  readonly pos = new Vector3();
  readonly q = new Quaternion();
  private prevPos = new Vector3();
  private prevQ = new Quaternion();
  private hasPrev = false;
  private offPos = new Vector3();
  private offQ = new Quaternion();
  private alpha = 1;

  /** Just before each prediction step. */
  beforeStep(s: Pose): void { this.prevPos.copy(s.pos); this.prevQ.copy(s.q); this.hasPrev = true; }

  /** Per frame. `alpha` is how far the clock is into the next step, 0..1. */
  update(s: Pose, dt: number, alpha: number): void {
    this.alpha = alpha;
    const k = Math.exp(-dt * 12);
    this.offPos.multiplyScalar(k);
    this.offQ.slerp(_id, 1 - k);
    this.base(s, this.pos, this.q);
    this.pos.add(this.offPos);
    this.q.premultiply(this.offQ);
  }

  /**
   * A snapshot moved the predicted aircraft from `before` to `s`. Both ends of the step being drawn
   * move with it and the offset takes the same move back, so the drawing stays put this frame and
   * then glides onto the corrected path. `snap` (first sync, respawn) jumps straight there.
   */
  corrected(before: Pose, s: Pose, snap: boolean): void {
    if (snap) { this.offPos.set(0, 0, 0); this.offQ.identity(); this.beforeStep(s); this.base(s, this.pos, this.q); return; }
    _b.copy(s.pos).sub(before.pos);
    _d.copy(s.q).multiply(_bq.copy(before.q).invert());
    this.prevPos.add(_b);
    this.prevQ.premultiply(_d);
    this.offPos.sub(_b);
    this.offQ.multiply(_d.invert());
    if (this.offPos.length() > SNAP) { this.offPos.set(0, 0, 0); this.offQ.identity(); }
  }

  private base(s: Pose, pos: Vector3, q: Quaternion): void {
    if (!this.hasPrev) { pos.copy(s.pos); q.copy(s.q); return; }
    pos.copy(this.prevPos).lerp(s.pos, this.alpha);
    q.copy(this.prevQ).slerp(s.q, this.alpha);
  }
}
