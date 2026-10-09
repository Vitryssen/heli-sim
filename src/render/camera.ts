import * as THREE from 'three';
import type { HeliState } from '../sim/state';
import type { WorldQuery } from '../world/query';
import { COCKPIT_EYE } from '../sim/geometry';
import { clamp } from '../sim/math';
import type { FreeLook } from '../input/mouse';

export const CAMERA_MODES = ['Cockpit', 'Chase'] as const;
export type CameraMode = (typeof CAMERA_MODES)[number];
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0);

export class CameraRig {
  private index = 0;
  private head = new THREE.Vector3();
  private headTarget = new THREE.Vector3();
  private prevVel = new THREE.Vector3();
  private hasPrev = false;
  private qi = new THREE.Quaternion();
  private q1 = new THREE.Quaternion();
  private q2 = new THREE.Quaternion();
  private chasePos = new THREE.Vector3();
  private chaseInit = false;
  private t = new THREE.Vector3();
  private look = new THREE.Vector3();
  private eu = new THREE.Euler();
  // scroll zoom, kept per view: cockpit field of view (deg) and chase distance (m)
  private fov = { now: 75, target: 75 };
  private dist = { now: 14, target: 14 };

  constructor(private camera: THREE.PerspectiveCamera) {}

  get mode(): CameraMode { return CAMERA_MODES[this.index]; }
  cycle(): CameraMode { this.index = (this.index + 1) % CAMERA_MODES.length; this.snap(); return this.mode; }
  /** Positive steps zoom out. */
  zoom(steps: number): void {
    const f = Math.exp(steps * 0.12);
    if (this.mode === 'Cockpit') this.fov.target = clamp(this.fov.target * f, 25, 95);
    else this.dist.target = clamp(this.dist.target * f, 6, 45);
  }

  snap(): void { this.hasPrev = false; this.head.set(0, 0, 0); this.chaseInit = false; }

  update(dt: number, s: HeliState, world: WorldQuery, free: FreeLook, rpm: number): void {
    const cam = this.camera;
    let fov: number;
    const ease = 1 - Math.exp(-dt * 10);
    this.fov.now += (this.fov.target - this.fov.now) * ease;
    this.dist.now += (this.dist.target - this.dist.now) * ease;
    if (this.mode === 'Cockpit') {
      fov = this.fov.now;
      // the pilot's head lags accelerations a little and buzzes with the rotor
      if (this.hasPrev && dt > 0) {
        this.qi.copy(s.q).invert();
        this.headTarget.copy(s.vel).sub(this.prevVel).divideScalar(dt).applyQuaternion(this.qi).multiplyScalar(-0.004);
        this.headTarget.set(clamp(this.headTarget.x, -0.05, 0.05), clamp(this.headTarget.y, -0.05, 0.05), clamp(this.headTarget.z, -0.05, 0.05));
      }
      this.prevVel.copy(s.vel); this.hasPrev = true;
      this.head.lerp(this.headTarget, 1 - Math.exp(-dt * 5));
      const buzz = s.crashed ? 0 : 0.0012 * Math.min(1, rpm);
      cam.position.set(
        COCKPIT_EYE.x + this.head.x + (Math.random() - 0.5) * buzz,
        COCKPIT_EYE.y + this.head.y + (Math.random() - 0.5) * buzz,
        COCKPIT_EYE.z + this.head.z,
      ).applyQuaternion(s.q).add(s.pos);
      cam.quaternion.copy(s.q).multiply(this.q1.setFromAxisAngle(Y, free.yaw)).multiply(this.q2.setFromAxisAngle(X, -0.16 + free.pitch));
    } else {
      // third person: trails behind the heading, free look orbits it
      fov = 62;
      this.eu.setFromQuaternion(s.q, 'YXZ');
      const yaw = this.eu.y + free.yaw, el = 0.28 + free.pitch, d = this.dist.now;
      this.t.set(Math.sin(yaw) * Math.cos(el) * d, Math.sin(el) * d + 0.6 * (d / 14), Math.cos(yaw) * Math.cos(el) * d).add(s.pos);
      if (!this.chaseInit) { this.chasePos.copy(this.t); this.chaseInit = true; }
      this.chasePos.lerp(this.t, 1 - Math.exp(-dt * (free.active ? 10 : 2.5)));
      this.chasePos.y = Math.max(this.chasePos.y, world.groundAt(this.chasePos.x, this.chasePos.z, this.chasePos.y) + 1.5);
      cam.position.copy(this.chasePos);
      cam.lookAt(this.look.set(s.pos.x + s.vel.x * 0.1, s.pos.y + 1.0, s.pos.z + s.vel.z * 0.1));
    }
    if (Math.abs(cam.fov - fov) > 0.01) { cam.fov = fov; cam.updateProjectionMatrix(); }
  }
}
