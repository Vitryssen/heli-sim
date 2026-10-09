import { Euler } from 'three';
import type { AssistFlags, HeliState, PilotInput } from '../sim/state';
import type { Params } from '../sim/params';
import { ELEVATION } from '../world/terrain';
import { SKID_DROP } from '../sim/geometry';
import { clamp, DEG } from '../sim/math';

const $ = (id: string) => document.getElementById(id)!;

/** Centre HUD: collective gauge, flight readouts and assist tags. */
export class Hud {
  private eu = new Euler();
  private last = 0;
  private el = {
    col: $('colBar'), thr: $('thrTick'),
    spd: $('tSpd'), agl: $('tAgl'), asl: $('tAsl'), vs: $('tVs'), hdg: $('tHdg'), rpm: $('tRpm'), hull: $('tHull'), bankT: $('tBank'),
    ige: $('tagIge'), etl: $('tagEtl'), alt: $('tagAlt'), att: $('tagAtt'), crd: $('tagCrd'), env: $('tagEnv'),
  };

  update(now: number, s: HeliState, input: PilotInput, assists: AssistFlags, p: Params): void {
    const e = this.el;
    const c = input.collective;
    e.col.setAttribute('y', String(c > 0 ? -c * 80 : 0));
    e.col.setAttribute('height', String(Math.abs(c) * 80));
    const ty = (-clamp((s.thrust / (p.mass * p.g) - 1) / 0.95, -1, 1) * 80).toFixed(1);
    e.thr.setAttribute('y1', ty); e.thr.setAttribute('y2', ty);

    if (now - this.last < 60) return;
    this.last = now;
    this.eu.setFromQuaternion(s.q, 'YXZ');
    const rd = this.eu.z * DEG;
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
    const air = !s.grounded && !s.crashed;
    e.ige.classList.toggle('on', air && s.groundEffect > 1.02);
    e.etl.classList.toggle('on', air && s.mu > 0.06);
    e.alt.classList.toggle('on', air && assists.autoHover && s.altHold !== null);
    e.att.classList.toggle('on', air && assists.stability && !!s.attHold);
    e.crd.classList.toggle('on', air && s.coordOn);
    e.env.classList.toggle('on', air && s.envOn);
  }
}
