import * as THREE from 'three';
import type { HeliState } from '../sim/state';
import type { WorldQuery } from '../world/query';
import type { Pad } from '../world/layout';
import { COCKPIT_EYE } from '../sim/geometry';
import { clamp, DEG } from '../sim/math';
import type { FreeLook } from '../input/mouse';

export const CAMERA_MODES = ['Chase', 'Cockpit', 'Pad'] as const;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  mode = 0;
  private pos = new THREE.Vector3();
  private init = false;
  private t = new THREE.Vector3();
  private look = new THREE.Vector3();
  private eu = new THREE.Euler();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();

  constructor(private camera: THREE.PerspectiveCamera) {}

  cycle(): string { this.mode = (this.mode + 1) % CAMERA_MODES.length; this.init = false; return CAMERA_MODES[this.mode]; }
  snap(): void { this.init = false; }

  update(dt: number, s: HeliState, world: WorldQuery, targetPad: Pad, free: FreeLook): void {
    const cam = this.camera;
    this.eu.setFromQuaternion(s.q, 'YXZ');
    const yaw = this.eu.y + free.yaw;
    let fov = 62;
    if (this.mode === 0) {
      const el = 0.28 + free.pitch, d = 14;
      this.t.set(Math.sin(yaw) * Math.cos(el) * d, Math.sin(el) * d + 0.6, Math.cos(yaw) * Math.cos(el) * d).add(s.pos);
      if (!this.init) { this.pos.copy(this.t); this.init = true; }
      this.pos.lerp(this.t, 1 - Math.exp(-dt * (free.active ? 10 : 2.5)));
      this.pos.y = Math.max(this.pos.y, world.groundAt(this.pos.x, this.pos.z, this.pos.y) + 1.5);
      cam.position.copy(this.pos);
      cam.lookAt(this.look.set(s.pos.x + s.vel.x * 0.1, s.pos.y + 1.0, s.pos.z + s.vel.z * 0.1));
    } else if (this.mode === 1) {
      fov = 78;
      cam.position.copy(COCKPIT_EYE).applyQuaternion(s.q).add(s.pos);
      cam.quaternion.copy(s.q).multiply(this.q1.setFromAxisAngle(Y, free.yaw)).multiply(this.q2.setFromAxisAngle(X, -0.14 + free.pitch));
    } else {
      cam.position.set(targetPad.x - 32, targetPad.top + 14, targetPad.z + 36);
      fov = clamp(2 * Math.atan(16 / cam.position.distanceTo(s.pos)) * DEG, 6, 65);
      cam.lookAt(s.pos);
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
