import { Euler } from 'three';
import type { AssistFlags, HeliState, PilotInput } from '../sim/state';
import type { Params } from '../sim/params';
import type { Pad } from '../world/layout';
import { ELEVATION } from '../world/terrain';
import { SKID_DROP } from '../sim/geometry';
import { clamp, DEG } from '../sim/math';

const NS = 'http://www.w3.org/2000/svg';
const $ = (id: string) => document.getElementById(id)!;

function svg(tag: string, attrs: Record<string, string | number>, parent: Element): SVGElement {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  parent.appendChild(e);
  return e;
}

/** Helmet-style centre HUD: horizon and pitch ladder, bank scale, pitch arrows, collective, readouts, tags. */
export class Hud {
  private eu = new Euler();
  private last = 0;
  private el = {
    hz: $('horizon'), bank: $('bankPtr'), pl: $('pArrL'), pr: $('pArrR'), col: $('colBar'), thr: $('thrTick'),
    spd: $('tSpd'), agl: $('tAgl'), asl: $('tAsl'), vs: $('tVs'), hdg: $('tHdg'), rpm: $('tRpm'), hull: $('tHull'), bankT: $('tBank'),
    tName: $('tName'), tDist: $('tDist'), arrow: $('tArrow'), score: $('score'),
    ige: $('tagIge'), etl: $('tagEtl'), alt: $('tagAlt'), att: $('tagAtt'), brk: $('tagBrk'), crd: $('tagCrd'), env: $('tagEnv'),
  };

  constructor() {
    const hz = this.el.hz;
    svg('line', { x1: -400, y1: 0, x2: -48, y2: 0, class: 'st' }, hz);
    svg('line', { x1: 48, y1: 0, x2: 400, y2: 0, class: 'st' }, hz);
    for (const d of [-30, -20, -10, 10, 20, 30]) {
      const y = -d * 4, a: Record<string, string> = { class: 'st thin' };
      if (d < 0) a['stroke-dasharray'] = '5 4';
      svg('line', { ...a, x1: -62, y1: y, x2: -30, y2: y }, hz);
      svg('line', { ...a, x1: 30, y1: y, x2: 62, y2: y }, hz);
      svg('text', { x: -68, y: y + 4, 'text-anchor': 'end', class: 'sm' }, hz).textContent = String(Math.abs(d));
    }
    const bs = $('bankScale');
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r = (a * Math.PI) / 180, r1 = 128, r2 = a % 30 === 0 ? 140 : 135;
      svg('line', { class: 'st thin', x1: Math.sin(r) * r1, y1: -Math.cos(r) * r1, x2: Math.sin(r) * r2, y2: -Math.cos(r) * r2 }, bs);
    }
    const ps = $('pitchScale');
    for (const side of [-1, 1]) for (const d of [-30, -20, -10, 0, 10, 20, 30]) {
      const y = -d * 3;
      svg('line', { class: d === 0 ? 'st' : 'st thin', x1: side * 146, y1: y, x2: side * (d === 0 ? 132 : 138), y2: y }, ps);
    }
  }

  update(now: number, s: HeliState, input: PilotInput, assists: AssistFlags, target: Pad, score: number, p: Params): void {
    const e = this.el;
    this.eu.setFromQuaternion(s.q, 'YXZ');
    const pd = this.eu.x * DEG, rd = this.eu.z * DEG;
    e.hz.setAttribute('transform', `rotate(${rd.toFixed(2)}) translate(0 ${(pd * 4).toFixed(1)})`);
    e.bank.setAttribute('transform', `rotate(${clamp(rd, -70, 70).toFixed(2)})`);
    const py = clamp(-pd * 3, -110, 110).toFixed(1);
    e.pl.setAttribute('transform', `translate(0 ${py})`);
    e.pr.setAttribute('transform', `translate(0 ${py})`);
    const c = input.collective;
    e.col.setAttribute('y', String(c > 0 ? -c * 80 : 0));
    e.col.setAttribute('height', String(Math.abs(c) * 80));
    const ty = (-clamp((s.thrust / (p.mass * p.g) - 1) / 0.95, -1, 1) * 80).toFixed(1);
    e.thr.setAttribute('y1', ty); e.thr.setAttribute('y2', ty);

    if (now - this.last < 60) return;
    this.last = now;
    const hdg = ((-this.eu.y * DEG) % 360 + 360) % 360;
    e.spd.textContent = String(Math.round(s.vel.length() * 3.6));
    e.agl.textContent = s.agl < 10 ? s.agl.toFixed(1) : String(Math.round(s.agl));
    e.asl.textContent = String(Math.round(s.pos.y - SKID_DROP + ELEVATION));
    e.vs.textContent = (s.vel.y >= 0 ? '+' : '') + s.vel.y.toFixed(1);
    e.hdg.textContent = String(Math.round(hdg) % 360).padStart(3, '0');
    const rpm = (s.omega / p.rotor.omegaNominal) * 100;
    e.rpm.textContent = Math.round(rpm) + '%';
    e.rpm.classList.toggle('warn', s.engineOn && !s.crashed && (rpm < 95 && rpm > 60 || rpm > 106));
    e.hull.textContent = Math.round(s.hull) + '%';
    e.hull.classList.toggle('warn', s.hull < 50);
    e.bankT.textContent = Math.round(Math.abs(rd)) + '°';
    const dx = target.x - s.pos.x, dz = target.z - s.pos.z;
    e.tName.textContent = target.name;
    e.tDist.textContent = Math.round(Math.hypot(dx, dz)) + ' m';
    e.arrow.style.transform = `rotate(${(Math.atan2(dx, -dz) * DEG - hdg).toFixed(0)}deg)`;
    e.score.textContent = String(score);
    const air = !s.grounded && !s.crashed;
    e.ige.classList.toggle('on', air && s.groundEffect > 1.02);
    e.etl.classList.toggle('on', air && s.mu > 0.06);
    e.alt.classList.toggle('on', air && assists.autoHover && s.altHold !== null);
    e.att.classList.toggle('on', air && assists.stability && !!s.attHold);
    e.brk.classList.toggle('on', air && s.braking);
    e.crd.classList.toggle('on', air && s.coordOn);
    e.env.classList.toggle('on', air && s.envOn);
  }
}
