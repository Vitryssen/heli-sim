import * as THREE from 'three';
import { canvasTexture } from './scene';

const N = 180;

/** Rotor-wash dust: particles thrown outward from the ground under the hub. */
export class Dust {
  private pos = new Float32Array(N * 3).fill(-9999);
  private vel = new Float32Array(N * 3);
  private life = new Float32Array(N);
  private geo = new THREE.BufferGeometry();

  constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer) {
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    const sprite = canvasTexture(renderer, 64, 64, g => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
    const pts = new THREE.Points(this.geo, new THREE.PointsMaterial({ color: 0xd8cba8, size: 1.3, transparent: true, opacity: 0.38, depthWrite: false, map: sprite }));
    pts.frustumCulled = false;
    scene.add(pts);
  }

  /** `wash` 0..1 is how hard the downwash hits the ground at (hx, groundY, hz). */
  update(dt: number, hx: number, hz: number, groundY: number, wash: number): void {
    const { pos, vel, life } = this;
    let spawn = Math.round(wash * 5);
    for (let i = 0; i < N; i++) {
      const j = i * 3;
      if (life[i] <= 0) {
        if (spawn > 0) {
          spawn--;
          const a = Math.random() * Math.PI * 2, r = 2.5 + Math.random() * 2.5, sp = (7 + Math.random() * 7) * (0.5 + wash);
          pos[j] = hx + Math.cos(a) * r; pos[j + 1] = groundY + 0.3; pos[j + 2] = hz + Math.sin(a) * r;
          vel[j] = Math.cos(a) * sp; vel[j + 1] = 0.6 + Math.random() * 1.6; vel[j + 2] = Math.sin(a) * sp;
          life[i] = 0.9 + Math.random() * 0.8;
        } else pos[j + 1] = -9999;
        continue;
      }
      life[i] -= dt;
      const drag = 1 - 1.4 * dt;
      vel[j] *= drag; vel[j + 1] *= drag; vel[j + 2] *= drag;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
    }
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
  }
}
