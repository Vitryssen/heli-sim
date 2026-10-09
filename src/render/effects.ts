import * as THREE from 'three';
import type { WorldQuery } from '../world/query';
import { canvasTexture } from './scene';
import { combatParams } from '../combat/params';

interface ParticleOpts { color: number; max: number; additive?: boolean; gravity?: number; drag?: number; grow?: number }

/** Pooled point particles with per-particle size and fade (Points + a tiny shader). */
class Particles {
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private size0: Float32Array;
  private alpha0: Float32Array;
  private aSize: Float32Array;
  private aAlpha: Float32Array;
  private geo = new THREE.BufferGeometry();
  private mat: THREE.ShaderMaterial;
  private cursor = 0;

  constructor(scene: THREE.Scene, sprite: THREE.Texture, private o: ParticleOpts) {
    const n = o.max;
    this.pos = new Float32Array(n * 3).fill(-1e5);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.aSize = new Float32Array(n);
    this.aAlpha = new Float32Array(n);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('aSize', new THREE.BufferAttribute(this.aSize, 1));
    this.geo.setAttribute('aAlpha', new THREE.BufferAttribute(this.aAlpha, 1));
    this.mat = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(o.color) }, map: { value: sprite }, scale: { value: 400 } },
      vertexShader: `attribute float aSize; attribute float aAlpha; uniform float scale; varying float vA;
        void main(){ vA = aAlpha; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * scale / max(-mv.z, 0.1); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform vec3 color; uniform sampler2D map; varying float vA;
        void main(){ float a = texture2D(map, gl_PointCoord).a * vA; if (a < 0.01) discard; gl_FragColor = vec4(color, a);
        #include <colorspace_fragment>
        }`,
      transparent: true, depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const pts = new THREE.Points(this.geo, this.mat);
    pts.frustumCulled = false;
    scene.add(pts);
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, alpha = 1): void {
    const i = this.cursor, j = i * 3;
    this.cursor = (this.cursor + 1) % this.o.max;
    this.pos[j] = x; this.pos[j + 1] = y; this.pos[j + 2] = z;
    this.vel[j] = vx; this.vel[j + 1] = vy; this.vel[j + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size0[i] = size; this.alpha0[i] = alpha;
  }

  update(dt: number, scale: number): void {
    const { pos, vel, life, maxLife, size0, alpha0, aSize, aAlpha, o } = this;
    const drag = Math.pow(o.drag ?? 0.5, dt), g = (o.gravity ?? 0) * dt, grow = o.grow ?? 1;
    for (let i = 0; i < o.max; i++) {
      if (life[i] <= 0) { aAlpha[i] = 0; continue; }
      life[i] -= dt;
      const j = i * 3;
      vel[j] *= drag; vel[j + 1] = vel[j + 1] * drag - g; vel[j + 2] *= drag;
      pos[j] += vel[j] * dt; pos[j + 1] += vel[j + 1] * dt; pos[j + 2] += vel[j + 2] * dt;
      const t = 1 - Math.max(0, life[i]) / maxLife[i];
      aSize[i] = size0[i] * (1 + (grow - 1) * t);
      aAlpha[i] = alpha0[i] * (1 - t) * Math.min(1, t * 12 + 0.2);
    }
    this.mat.uniforms.scale.value = scale;
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.aSize.needsUpdate = true;
    this.geo.attributes.aAlpha.needsUpdate = true;
  }
}

interface Tracer { x: number; y: number; z: number; dx: number; dy: number; dz: number; left: number; impact: boolean }

const TRACER_LEN = 14, MAX_TRACERS = 160;

/**
 * Everything that flies, burns or smokes: tracers, muzzle flashes, impacts, missiles with smoke
 * trails, flares, explosions and wrecks. Purely visual; the combat simulation decides what hits.
 */
export class Effects {
  private smoke: Particles;
  private darkSmoke: Particles;
  private fire: Particles;
  private sparks: Particles;
  private dust: Particles;
  private glow: Particles;
  private tracers: Tracer[] = [];
  private tracerGeo = new THREE.BufferGeometry();
  private tracerPos = new Float32Array(MAX_TRACERS * 6);
  private missiles = new Map<number, THREE.Group>();
  private missileGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8).rotateX(Math.PI / 2);
  private finGeo = new THREE.BoxGeometry(0.4, 0.02, 0.18);
  private missileMat = new THREE.MeshLambertMaterial({ color: 0xe6e6dc });
  private gunAcc = new Map<number, number>();
  private gunRound = new Map<number, number>();
  private _v = new THREE.Vector3();
  private _d = new THREE.Vector3();
  private Z = new THREE.Vector3(0, 0, 1);

  constructor(private scene: THREE.Scene, renderer: THREE.WebGLRenderer, private world: WorldQuery) {
    const sprite = canvasTexture(renderer, 64, 64, g => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.45, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
    this.smoke = new Particles(scene, sprite, { color: 0x8a8d90, max: 900, drag: 0.6, gravity: -0.6, grow: 4 });
    this.darkSmoke = new Particles(scene, sprite, { color: 0x2b2b2c, max: 600, drag: 0.7, gravity: -2.5, grow: 5 });
    this.fire = new Particles(scene, sprite, { color: 0xff9a3a, max: 500, additive: true, drag: 0.3, gravity: -1, grow: 1.8 });
    this.sparks = new Particles(scene, sprite, { color: 0xffd27a, max: 500, additive: true, drag: 0.5, gravity: 9.81 });
    this.dust = new Particles(scene, sprite, { color: 0xbfae88, max: 400, drag: 0.4, gravity: 2, grow: 3 });
    this.glow = new Particles(scene, sprite, { color: 0xfff1c4, max: 300, additive: true, drag: 0.2, grow: 0.6 });
    this.tracerPos.fill(-1e5);
    this.tracerGeo.setAttribute('position', new THREE.BufferAttribute(this.tracerPos, 3));
    const lines = new THREE.LineSegments(this.tracerGeo, new THREE.LineBasicMaterial({ color: 0xffc46b, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    lines.frustumCulled = false;
    scene.add(lines);
  }

  /**
   * One aircraft firing its guns this frame: muzzle flashes, and a tracer every fifth round flying out
   * at muzzle speed to whatever it would hit. `id` keeps the round counter per shooter.
   */
  gunfire(id: number, pos: THREE.Vector3, q: THREE.Quaternion, vel: THREE.Vector3, dt: number): void {
    const g = combatParams.gun;
    let acc = (this.gunAcc.get(id) ?? 0) + g.rate * dt;
    let round = this.gunRound.get(id) ?? 0;
    while (acc >= 1) {
      acc -= 1;
      const m = g.mounts[round % g.mounts.length];
      const muzzle = this._v.set(m[0], m[1], m[2] - 0.45).applyQuaternion(q).add(pos);
      if (round % 2 === 0) this.fire.emit(muzzle.x, muzzle.y, muzzle.z, vel.x, vel.y, vel.z, 0.05, 0.9, 0.9);
      if (round % g.tracerEvery === 0) {
        const sx = (Math.random() * 2 - 1) * g.spread, sy = (Math.random() * 2 - 1) * g.spread;
        const d = this._d.set(sx, -Math.sin(g.boresightDown) + sy, -Math.cos(g.boresightDown)).normalize().applyQuaternion(q);
        const hit = this.world.raycast(muzzle.x, muzzle.y, muzzle.z, d.x, d.y, d.z, g.range);
        if (this.tracers.length < MAX_TRACERS) this.tracers.push({ x: muzzle.x, y: muzzle.y, z: muzzle.z, dx: d.x, dy: d.y, dz: d.z, left: hit ?? g.range, impact: hit !== null });
      }
      round++;
    }
    this.gunAcc.set(id, acc);
    this.gunRound.set(id, round);
  }

  /** Rounds striking an aircraft or a target. */
  hit(x: number, y: number, z: number, heavy = false): void {
    for (let i = 0; i < (heavy ? 14 : 5); i++) {
      this.sparks.emit(x, y, z, (Math.random() - 0.5) * 18, Math.random() * 10, (Math.random() - 0.5) * 18, 0.25 + Math.random() * 0.3, 0.35);
    }
    this.smoke.emit(x, y, z, 0, 1, 0, 1.2, 1.2, 0.5);
  }

  explosion(x: number, y: number, z: number, size: number): void {
    for (let i = 0; i < 26; i++) {
      const s = size * (0.6 + Math.random() * 0.8);
      this.fire.emit(x, y, z, (Math.random() - 0.5) * s * 2.2, (Math.random() - 0.3) * s * 2, (Math.random() - 0.5) * s * 2.2, 0.45 + Math.random() * 0.4, size * 0.9, 1);
    }
    for (let i = 0; i < 30; i++) this.sparks.emit(x, y, z, (Math.random() - 0.5) * 40, Math.random() * 30, (Math.random() - 0.5) * 40, 0.6 + Math.random() * 0.8, 0.45);
    for (let i = 0; i < 18; i++) this.darkSmoke.emit(x, y, z, (Math.random() - 0.5) * size, Math.random() * size * 0.6, (Math.random() - 0.5) * size, 2.5 + Math.random() * 2, size * 0.8, 0.85);
    this.glow.emit(x, y, z, 0, 0, 0, 0.18, size * 3, 1);
  }

  /** Smoke rising from a wreck or a destroyed target; call every frame. */
  burning(x: number, y: number, z: number, dt: number): void {
    if (Math.random() < dt * 14) this.darkSmoke.emit(x + (Math.random() - 0.5), y + 0.5, z + (Math.random() - 0.5), (Math.random() - 0.5) * 1.5, 3, (Math.random() - 0.5) * 1.5, 3.5, 2.2, 0.8);
    if (Math.random() < dt * 10) this.fire.emit(x, y + 0.3, z, 0, 1.5, 0, 0.4, 1.4, 0.8);
  }

  /** Bring missile models in line with the simulation (or snapshots) and lay smoke behind them. */
  syncMissiles(list: { id: number; pos: THREE.Vector3; vel: THREE.Vector3 }[], dt: number): void {
    const seen = new Set<number>();
    for (const m of list) {
      seen.add(m.id);
      let g = this.missiles.get(m.id);
      if (!g) {
        g = new THREE.Group();
        g.add(new THREE.Mesh(this.missileGeo, this.missileMat));
        for (let k = 0; k < 4; k++) { const f = new THREE.Mesh(this.finGeo, this.missileMat); f.position.z = 0.65; f.rotation.z = (k * Math.PI) / 2; g.add(f); }
        this.scene.add(g);
        this.missiles.set(m.id, g);
      }
      g.position.copy(m.pos);
      if (m.vel.lengthSq() > 1) g.quaternion.setFromUnitVectors(this.Z, this._d.copy(m.vel).normalize().negate());
      const tail = this._v.copy(m.vel).normalize().multiplyScalar(-0.9).add(m.pos);
      this.glow.emit(tail.x, tail.y, tail.z, 0, 0, 0, 0.05, 1.6, 1);
      const puffs = Math.max(1, Math.round(dt * 90));
      for (let i = 0; i < puffs; i++) {
        const f = i / puffs;
        this.smoke.emit(tail.x - m.vel.x * dt * f, tail.y - m.vel.y * dt * f, tail.z - m.vel.z * dt * f, (Math.random() - 0.5) * 1.5, 0.5, (Math.random() - 0.5) * 1.5, 2.5, 0.9, 0.6);
      }
    }
    for (const [id, g] of this.missiles) if (!seen.has(id)) { this.scene.remove(g); this.missiles.delete(id); }
  }

  syncFlares(list: { pos: THREE.Vector3 }[], dt: number): void {
    for (const f of list) {
      this.glow.emit(f.pos.x, f.pos.y, f.pos.z, 0, 0, 0, 0.06, 3.2, 1);
      if (Math.random() < dt * 30) this.smoke.emit(f.pos.x, f.pos.y, f.pos.z, 0, 0.3, 0, 1.6, 0.8, 0.5);
    }
  }

  update(dt: number, camera: THREE.PerspectiveCamera, viewportHeight: number): void {
    // tracers fly at muzzle speed and leave a puff where they land
    const speed = combatParams.gun.muzzleSpeed;
    for (let i = this.tracers.length - 1; i >= 0; i--) {
      const t = this.tracers[i];
      const step = Math.min(speed * dt, t.left);
      t.x += t.dx * step; t.y += t.dy * step; t.z += t.dz * step;
      t.left -= step;
      if (t.left <= 0) {
        if (t.impact) {
          for (let k = 0; k < 3; k++) this.dust.emit(t.x, t.y, t.z, (Math.random() - 0.5) * 6, 3 + Math.random() * 4, (Math.random() - 0.5) * 6, 0.8, 1.4, 0.7);
          this.sparks.emit(t.x, t.y, t.z, (Math.random() - 0.5) * 8, 5, (Math.random() - 0.5) * 8, 0.25, 0.3);
        }
        this.tracers.splice(i, 1);
      }
    }
    const p = this.tracerPos;
    p.fill(-1e5);
    this.tracers.forEach((t, i) => {
      const j = i * 6;
      p[j] = t.x; p[j + 1] = t.y; p[j + 2] = t.z;
      p[j + 3] = t.x - t.dx * TRACER_LEN; p[j + 4] = t.y - t.dy * TRACER_LEN; p[j + 5] = t.z - t.dz * TRACER_LEN;
    });
    this.tracerGeo.attributes.position.needsUpdate = true;

    const scale = viewportHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const ps of [this.smoke, this.darkSmoke, this.fire, this.sparks, this.dust, this.glow]) ps.update(dt, scale);
  }
}
