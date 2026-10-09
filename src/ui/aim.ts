import { Vector3, type PerspectiveCamera, type Quaternion } from 'three';
import type { SelfCombat } from '../combat/view';
import { combatParams } from '../combat/params';

const $ = (id: string) => document.getElementById(id)!;

/**
 * Aiming aids drawn over the 3D view: the gun pipper, the missile seeker circle and lock box,
 * the missile warning, a hit marker, and the weapon readout. (The attitude lines stay removed.)
 */
export class AimHud {
  private pip = $('pipper');
  private seeker = $('seeker');
  private box = $('lockBox');
  private ring = document.getElementById('lockRing') as unknown as SVGCircleElement;
  private warn = $('warn');
  private hitMark = $('hitMark');
  private wGun = $('wGun');
  private wMsl = $('wMsl');
  private wFlr = $('wFlr');
  private hitUntil = 0;
  private _v = new Vector3();
  private lastText = '';

  hit(now: number): void { this.hitUntil = now + 140; }

  update(now: number, camera: PerspectiveCamera, pos: Vector3, q: Quaternion, self: SelfCombat, lockTarget: Vector3 | null, visible: boolean): void {
    const g = combatParams.gun, mp = combatParams.missile;
    const gunMode = self.mode === 'gun';
    const show = visible && !self.dead;

    // gun pipper: where the guns point 600 m ahead
    const pip = show && gunMode ? this.project(this._v.set(0, -0.38, -0.55).addScaledVector(new Vector3(0, -Math.sin(g.boresightDown), -Math.cos(g.boresightDown)), 600).applyQuaternion(q).add(pos), camera) : null;
    this.place(this.pip, pip);
    this.place(this.hitMark, pip && now < this.hitUntil ? pip : null);

    // missile seeker: a circle the size of the lock cone around the nose, a box on the candidate
    const nose = show && !gunMode ? this.project(this._v.set(0, 0, -1000).applyQuaternion(q).add(pos), camera) : null;
    this.place(this.seeker, nose);
    if (nose) {
      const r = (Math.tan(mp.lockHalfAngle) / Math.tan((camera.fov * Math.PI) / 360)) * (innerHeight / 2);
      this.seeker.style.width = this.seeker.style.height = `${(r * 2).toFixed(0)}px`;
    }
    const box = show && !gunMode && lockTarget ? this.project(lockTarget, camera) : null;
    this.place(this.box, box);
    if (box) {
      this.box.classList.toggle('locked', self.lock.locked);
      const c = 2 * Math.PI * 20;
      this.ring.style.strokeDasharray = `${((self.lock.progress / mp.lockTime) * c).toFixed(1)} ${c.toFixed(1)}`;
    }

    // warning
    const w = visible ? self.warning : 'none';
    this.warn.hidden = w === 'none';
    if (w !== 'none') {
      this.warn.textContent = w === 'missile' ? 'MISSILE' : 'LOCKED ON';
      this.warn.classList.toggle('blink', w === 'missile' ? now % 250 < 125 : now % 600 < 300);
    }

    // readout
    const text = `${self.mode}|${self.ammo}|${self.missiles}|${self.flares}`;
    if (text !== this.lastText) {
      this.lastText = text;
      this.wGun.textContent = `GUN ${self.ammo}`;
      this.wMsl.textContent = `MSL ${self.missiles}`;
      this.wFlr.textContent = `FLR ${self.flares}`;
      this.wGun.classList.toggle('on', gunMode);
      this.wMsl.classList.toggle('on', !gunMode);
      this.wGun.classList.toggle('empty', self.ammo === 0);
      this.wMsl.classList.toggle('empty', self.missiles === 0);
      this.wFlr.classList.toggle('empty', self.flares === 0);
    }
  }

  private project(p: Vector3, camera: PerspectiveCamera): { x: number; y: number } | null {
    const v = p.clone().project(camera);
    if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) return null;
    return { x: ((v.x + 1) / 2) * innerWidth, y: ((1 - v.y) / 2) * innerHeight };
  }

  private place(el: HTMLElement, at: { x: number; y: number } | null): void {
    el.hidden = !at;
    if (at) el.style.transform = `translate(${at.x.toFixed(1)}px, ${at.y.toFixed(1)}px) translate(-50%, -50%)`;
  }
}
