import * as THREE from 'three';
import type { HeliState, PilotInput } from '../sim/state';
import type { Params } from '../sim/params';
import { canvasTexture } from './scene';
import { clamp, DEG } from '../sim/math';

/** What the stores page shows (a combat Loadout fits this shape). */
export interface StoresView {
  mode: 'gun' | 'missile';
  ammo: number;
  missiles: number;
  flares: number;
  lock: 'none' | 'search' | 'locked';
  warning: 'none' | 'locked' | 'missile';
}

/** Inner canopy surface: ellipsoid just inside the exterior glass. θ from the top, φ from the nose (+ = right). */
const R = new THREE.Vector3(0.776, 0.815, 1.33);
const P = (th: number, ph: number) => new THREE.Vector3(R.x * Math.sin(th) * Math.sin(ph), R.y * Math.cos(th), -R.z * Math.sin(th) * Math.cos(ph));

const ROOF = 0.34, SILL = 1.95, FLOOR = 2.45, A_PILLAR = 0.95, B_PILLAR = 1.75;

/** SphereGeometry segment in canopy coordinates: φ range measured from the nose, θ range from the top. */
function shell(ph0: number, ph1: number, th0: number, th1: number, segs = 32): THREE.SphereGeometry {
  // SphereGeometry puts the nose (-z) at phi = 3π/2 and the right side at phi = π
  const g = new THREE.SphereGeometry(1, segs, 16, (3 * Math.PI) / 2 - ph1, ph1 - ph0, th0, th1 - th0);
  g.scale(R.x * 1.01, R.y * 1.01, R.z * 1.01);
  return g;
}

/**
 * MD 500 / MH-6 cabin seen from the right (pilot) seat: framed bubble canopy, doors off,
 * chin windows, centre console with two live displays, and the controls moving with your inputs.
 */
export class Cockpit {
  readonly group = new THREE.Group();
  private cyclic = new THREE.Group();
  private collective = new THREE.Group();
  private pedalL = new THREE.Group();
  private pedalR = new THREE.Group();
  private pfd: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D };
  private eng: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D };
  private lastDraw = 0;

  constructor(renderer: THREE.WebGLRenderer) {
    const g = this.group;
    const frame = new THREE.MeshLambertMaterial({ color: 0x2b3036 });
    const trim = new THREE.MeshLambertMaterial({ color: 0x2d3238, side: THREE.BackSide });
    const matte = new THREE.MeshLambertMaterial({ color: 0x1e2226 });
    const panel = new THREE.MeshLambertMaterial({ color: 0x41464c });
    const seatMat = new THREE.MeshLambertMaterial({ color: 0x3b3f2f });
    const steel = new THREE.MeshLambertMaterial({ color: 0x6b7178 });
    const grip = new THREE.MeshLambertMaterial({ color: 0x121416 });

    // canopy frame
    const tube = (pts: THREE.Vector3[], r = 0.022) => g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 6), frame));
    const meridian = (ph: number, th0: number, th1: number) => Array.from({ length: 12 }, (_, i) => P(th0 + ((th1 - th0) * i) / 11, ph));
    const ring = (th: number, ph0: number, ph1: number) => Array.from({ length: 16 }, (_, i) => P(th, ph0 + ((ph1 - ph0) * i) / 15));
    tube(meridian(0, ROOF, SILL), 0.011);                                      // windscreen centre post
    for (const s of [-1, 1]) {
      tube(meridian(s * A_PILLAR, ROOF, FLOOR), 0.028);                        // door front frames
      tube(meridian(s * B_PILLAR, ROOF, FLOOR), 0.03);                         // door rear frames
      tube(ring(FLOOR, s * A_PILLAR, s * B_PILLAR));                           // door sills
    }
    tube(ring(ROOF, -B_PILLAR, B_PILLAR), 0.03);                                // roof arch
    tube(ring(SILL, -A_PILLAR, A_PILLAR), 0.02);                                // chin window top edge
    tube(ring(FLOOR, -A_PILLAR, A_PILLAR), 0.02);                               // chin window bottom edge

    // headliner, rear bulkhead and floor
    g.add(new THREE.Mesh(shell(-Math.PI, Math.PI, 0, ROOF), trim));
    g.add(new THREE.Mesh(shell(B_PILLAR, 2 * Math.PI - B_PILLAR, ROOF, Math.PI), trim));
    g.add(new THREE.Mesh(shell(-B_PILLAR, B_PILLAR, FLOOR, Math.PI), trim));
    // faint inside of the windscreen, so you feel the glass
    g.add(new THREE.Mesh(shell(-A_PILLAR, A_PILLAR, ROOF, SILL),
      new THREE.MeshBasicMaterial({ color: 0xa9cadb, transparent: true, opacity: 0.05, side: THREE.BackSide, depthWrite: false })));

    // centre console with glareshield and two displays
    const console_ = new THREE.Group();
    console_.position.set(0.02, -0.22, -1.04);
    console_.rotation.x = -0.45;
    console_.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.26, 0.12), panel));
    const shield = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.018, 0.09), matte);
    shield.position.set(0, 0.135, 0.04);
    console_.add(shield);
    const screen = (x: number) => {
      const c = { tex: null as unknown as THREE.CanvasTexture, g: null as unknown as CanvasRenderingContext2D };
      c.tex = canvasTexture(renderer, 256, 256, ctx => { c.g = ctx; });
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.19, 0.19), new THREE.MeshBasicMaterial({ map: c.tex, toneMapped: false }));
      m.position.set(x, 0.0, 0.068);
      console_.add(m);
      const bezel = new THREE.Mesh(new THREE.BoxGeometry(0.215, 0.215, 0.006), matte);
      bezel.position.set(x, 0.0, 0.062);
      console_.add(bezel);
      return c;
    };
    this.pfd = screen(0.115);
    this.eng = screen(-0.115);
    g.add(console_);
    const pedestal = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.4, 0.28), panel);
    pedestal.position.set(0.02, -0.55, -0.86);
    g.add(pedestal);

    // seats (pilot right, empty seat left)
    for (const x of [0.3, -0.3]) {
      const pan = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.09, 0.44), seatMat);
      pan.position.set(x, -0.42, -0.3);
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.09), seatMat);
      back.position.set(x, -0.08, -0.06);
      back.rotation.x = -0.12;
      g.add(pan, back);
    }

    // cyclic between the pilot's knees
    this.cyclic.position.set(0.3, -0.66, -0.62);
    const stick = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.018, 0.48, 8).translate(0, 0.24, 0), steel);
    const head = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.024, 0.11, 10).translate(0, 0.53, 0), grip);
    head.rotation.x = 0.15;
    const boot = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.07, 0.06, 10), matte);
    this.cyclic.add(stick, head, boot);
    g.add(this.cyclic);

    // collective at the pilot's left hand, pivoting at the rear
    this.collective.position.set(0.06, -0.5, -0.12);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.5, 8).rotateX(Math.PI / 2).translate(0, 0, -0.25), steel);
    const twist = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.14, 10).rotateX(Math.PI / 2).translate(0, 0, -0.46), grip);
    this.collective.add(lever, twist);
    g.add(this.collective);

    // pedals in the chin
    for (const [grp, x] of [[this.pedalL, 0.2], [this.pedalR, 0.4]] as const) {
      grp.position.set(x, -0.62, -1.02);
      const pad = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.13, 0.02), steel);
      pad.position.y = 0.06;
      grp.add(pad);
      g.add(grp);
    }

    g.traverse(o => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false; } });
  }

  update(now: number, s: HeliState, input: PilotInput, p: Params, stores: StoresView): void {
    this.cyclic.rotation.set(-input.pitch * 0.22, 0, -input.roll * 0.22);
    this.collective.rotation.x = 0.06 + input.collective * 0.16;
    this.pedalL.position.z = -1.02 + input.yaw * 0.05;
    this.pedalR.position.z = -1.02 - input.yaw * 0.05;
    if (now - this.lastDraw < 100) return;
    this.lastDraw = now;
    this.drawPfd(s);
    this.drawEngine(s, p, stores);
  }

  private eu = new THREE.Euler();

  /** Primary flight display: attitude, speed, altitude, vertical speed, heading. */
  private drawPfd(s: HeliState): void {
    const g = this.pfd.g, W = 256;
    this.eu.setFromQuaternion(s.q, 'YXZ');
    const pitch = this.eu.x * DEG, roll = this.eu.z * DEG, hdg = ((-this.eu.y * DEG) % 360 + 360) % 360;
    g.fillStyle = '#05080a'; g.fillRect(0, 0, W, W);
    // attitude: sky/ground and a full pitch ladder (every 10°, 5° minor marks, zenith/nadir at ±90°)
    const PX = 3;                                               // pixels per degree
    g.save();
    g.beginPath(); g.rect(40, 34, 176, 168); g.clip();
    g.translate(128, 118); g.rotate((roll * Math.PI) / 180); g.translate(0, pitch * PX);
    g.fillStyle = '#2f6fa3'; g.fillRect(-400, -600, 800, 600);
    g.fillStyle = '#6b4a2b'; g.fillRect(-400, 0, 800, 600);
    g.strokeStyle = '#f2f2ee'; g.fillStyle = '#f2f2ee';
    g.lineWidth = 2; g.beginPath(); g.moveTo(-400, 0); g.lineTo(400, 0); g.stroke();
    g.font = '11px monospace';
    for (let d = -85; d <= 85; d += 5) {
      if (d === 0) continue;
      const y = -d * PX, major = d % 10 === 0, w = major ? (d % 30 === 0 ? 34 : 24) : 10;
      g.lineWidth = major ? 1.6 : 1;
      g.setLineDash(d < 0 && major ? [5, 3] : []);
      g.beginPath(); g.moveTo(-w, y); g.lineTo(w, y); g.stroke();
      if (major) {
        g.textAlign = 'right'; g.fillText(String(Math.abs(d)), -w - 4, y + 4);
        g.textAlign = 'left'; g.fillText(String(Math.abs(d)), w + 4, y + 4);
      }
    }
    g.setLineDash([]);
    g.lineWidth = 2;
    g.beginPath(); g.arc(0, -90 * PX, 8, 0, Math.PI * 2); g.stroke();              // zenith
    g.beginPath(); g.arc(0, 90 * PX, 8, 0, Math.PI * 2); g.stroke();               // nadir
    g.beginPath(); g.moveTo(-6, 90 * PX - 6); g.lineTo(6, 90 * PX + 6); g.moveTo(6, 90 * PX - 6); g.lineTo(-6, 90 * PX + 6); g.stroke();
    g.restore();
    // bank scale across the top of the attitude window, pointer turns with the horizon
    g.save(); g.translate(128, 118);
    g.strokeStyle = '#f2f2ee'; g.lineWidth = 1.5;
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
      const r = (a * Math.PI) / 180, r1 = 72, r2 = a % 30 === 0 ? 81 : 77;
      g.beginPath(); g.moveTo(Math.sin(r) * r1, -Math.cos(r) * r1); g.lineTo(Math.sin(r) * r2, -Math.cos(r) * r2); g.stroke();
    }
    g.rotate((roll * Math.PI) / 180);
    g.fillStyle = '#ffb547';
    g.beginPath(); g.moveTo(0, -71); g.lineTo(-5, -62); g.lineTo(5, -62); g.closePath(); g.fill();
    g.restore();
    g.strokeStyle = '#ffb547'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(92, 118); g.lineTo(116, 118); g.lineTo(122, 126); g.moveTo(164, 118); g.lineTo(140, 118); g.lineTo(134, 126); g.stroke();
    g.fillStyle = '#ffb547'; g.fillRect(126, 116, 4, 4);
    // tapes
    g.fillStyle = 'rgba(0,0,0,.7)'; g.fillRect(0, 100, 50, 36); g.fillRect(206, 100, 50, 36);
    g.fillStyle = '#f2f2ee'; g.font = 'bold 18px monospace';
    g.textAlign = 'left'; g.fillText(String(Math.round(s.vel.length() * 3.6)), 4, 125);
    g.textAlign = 'right'; g.fillText(String(Math.round(s.agl)), 252, 125);
    g.font = '10px monospace'; g.fillStyle = '#9fb1bd';
    g.textAlign = 'left'; g.fillText('KM/H', 4, 96);
    g.textAlign = 'right'; g.fillText('AGL M', 252, 96);
    g.fillText(`VS ${(s.vel.y >= 0 ? '+' : '') + s.vel.y.toFixed(1)}`, 252, 150);
    g.textAlign = 'center'; g.fillStyle = '#f2f2ee'; g.font = 'bold 16px monospace';
    g.fillText(String(Math.round(hdg) % 360).padStart(3, '0') + '°', 128, 26);
    g.font = '10px monospace'; g.fillStyle = '#9fb1bd'; g.fillText('PFD', 128, 246);
    this.pfd.tex.needsUpdate = true;
  }

  /** Engine and stores page: rotor rpm, torque, hull, and the weapons state. */
  private drawEngine(s: HeliState, p: Params, st: StoresView): void {
    const g = this.eng.g, W = 256;
    g.fillStyle = '#05080a'; g.fillRect(0, 0, W, W);
    const bar = (x: number, label: string, value: number, max: number, lo: number, hi: number, text: string) => {
      const h = 130, y0 = 40, f = clamp(value / max, 0, 1);
      g.strokeStyle = '#3c4a54'; g.lineWidth = 1; g.strokeRect(x, y0, 26, h);
      g.fillStyle = 'rgba(142,224,166,.18)'; g.fillRect(x + 1, y0 + h * (1 - hi / max), 24, h * ((hi - lo) / max));
      const ok = value >= lo && value <= hi;
      g.fillStyle = ok ? '#8ee0a6' : '#ffb547'; g.fillRect(x + 3, y0 + h * (1 - f), 20, h * f);
      g.fillStyle = '#9fb1bd'; g.font = '10px monospace'; g.textAlign = 'center'; g.fillText(label, x + 13, 32);
      g.fillStyle = '#f2f2ee'; g.font = 'bold 13px monospace'; g.fillText(text, x + 13, 188);
    };
    const rpm = (s.omega / p.rotor.omegaNominal) * 100;
    const tq = (s.engineTorque / p.engine.maxTorque) * 100;
    bar(12, 'NR %', rpm, 120, 95, 105, rpm.toFixed(0));
    bar(52, 'TQ %', tq, 110, 0, 85, tq.toFixed(0));
    bar(92, 'HULL', s.hull, 100, 50, 100, s.hull.toFixed(0));
    // stores
    const x0 = 136;
    g.textAlign = 'left'; g.font = '10px monospace'; g.fillStyle = '#9fb1bd'; g.fillText('STORES', x0, 32);
    const row = (y: number, label: string, value: string, active: boolean) => {
      g.fillStyle = active ? '#ffb547' : '#9fb1bd'; g.font = (active ? 'bold ' : '') + '12px monospace'; g.fillText(label, x0, y);
      g.textAlign = 'right'; g.fillStyle = '#f2f2ee'; g.font = 'bold 13px monospace'; g.fillText(value, 246, y); g.textAlign = 'left';
    };
    row(60, (st.mode === 'gun' ? '▶ ' : '  ') + 'GUN', String(st.ammo), st.mode === 'gun');
    row(84, (st.mode === 'missile' ? '▶ ' : '  ') + 'MSL', String(st.missiles), st.mode === 'missile');
    row(108, '  FLR', String(st.flares), false);
    if (st.mode === 'missile') {
      g.font = 'bold 14px monospace'; g.textAlign = 'center';
      g.fillStyle = st.lock === 'locked' ? '#8ee0a6' : st.lock === 'search' ? '#ffb547' : '#3c4a54';
      g.fillText(st.lock === 'locked' ? 'LOCK' : st.lock === 'search' ? 'SEEK' : 'NO TGT', 191, 140);
    }
    if (st.warning !== 'none') {
      g.fillStyle = '#ff6b5e'; g.fillRect(x0, 156, 110, 26);
      g.fillStyle = '#05080a'; g.font = 'bold 14px monospace'; g.textAlign = 'center';
      g.fillText(st.warning === 'missile' ? 'MISSILE' : 'LOCKED', 191, 174);
    }
    g.fillStyle = s.engineOn ? '#8ee0a6' : '#9fb1bd'; g.font = '10px monospace'; g.textAlign = 'center';
    g.fillText(s.engineOn ? 'ENG RUN' : 'ENG OFF', 128, 226);
    g.fillStyle = '#9fb1bd'; g.fillText('ENGINE · STORES', 128, 246);
    this.eng.tex.needsUpdate = true;
  }
}
