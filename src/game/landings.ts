import { Vector3 } from 'three';
import type { HeliState } from '../sim/state';
import type { Pad } from '../world/layout';
import { SKIDS } from '../sim/geometry';

export interface Notice { title: string; detail: string; kind: 'good' | 'info' | 'bad'; ttl: number }

const _p = new Vector3();

/** Pad-hopping: land on the target pad, get graded on touchdown, move on to the next one. */
export class Mission {
  targetIdx = 1;
  score = 0;
  private flightTime = 0;
  private landedEval = true;
  private settle = 0;

  constructor(readonly pads: Pad[]) {}

  get target(): Pad { return this.pads[this.targetIdx]; }

  onReset(): void { this.flightTime = 0; this.landedEval = true; this.settle = 0; }

  update(dt: number, s: HeliState): Notice | null {
    if (s.crashed) return null;
    if (s.contacts === 0) {
      this.flightTime += dt;
      if (this.flightTime > 0.6 && this.landedEval) { this.landedEval = false; s.impact = 0; }
    }
    const settled = s.contacts >= 4 && s.vel.length() < 0.4 && Math.abs(s.w.y) < 0.2;
    this.settle = settled ? this.settle + dt : 0;
    if (this.landedEval || this.settle <= 0.7) return null;
    this.landedEval = true; this.flightTime = 0;
    return this.grade(s);
  }

  private grade(s: HeliState): Notice {
    const v = -s.impact;
    const grade = v < 0.6 ? 'Butter' : v < 1.5 ? 'Smooth' : v < 3.5 ? 'Firm' : 'Hard';
    const pad = this.pads.find(p => SKIDS.every(sk => {
      _p.copy(sk).applyQuaternion(s.q).add(s.pos);
      return Math.hypot(_p.x - p.x, _p.z - p.z) <= p.r && Math.abs(_p.y - p.top) <= 0.4;
    }));
    const td = `${v.toFixed(1)} m/s touchdown · ${grade} · hull ${Math.round(s.hull)}%`;
    if (pad && pad === this.target) {
      this.score++;
      this.targetIdx = (this.targetIdx + 1) % this.pads.length;
      return { title: `${pad.name} pad`, detail: `${td}\nNext target: ${this.target.name}`, kind: 'good', ttl: 5 };
    }
    if (pad) return { title: `${pad.name} pad`, detail: `${td}\nTarget is ${this.target.name}`, kind: 'info', ttl: 4 };
    return { title: 'Off-pad landing', detail: td, kind: 'info', ttl: 3.5 };
  }
}
