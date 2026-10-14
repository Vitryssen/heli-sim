import * as THREE from 'three';
import { buildingStyle, PARAPET_T, parapetHeight, ROOF_KIT, type Layout } from './layout';
import { terrainH } from './terrain';
import { canvasTexture } from '../render/scene';
import { rng } from '../sim/math';

const GROUND_FLOOR = 4.2, FLOOR = 3.4, BAY = 4;

/** Collects quads in some local frame and hands back one geometry with normals, uvs and vertex colours. */
class Builder {
  pos: number[] = []; nor: number[] = []; uv: number[] = []; col: number[] = [];
  constructor(private toWorld: (x: number, y: number, z: number) => [number, number, number] = (x, y, z) => [x, y, z],
    private turn: (x: number, z: number) => [number, number] = (x, z) => [x, z]) {}

  /** a→b→c→d round the quad; flipped if needed so it faces along n. */
  quad(a: number[], b: number[], c: number[], d: number[], n: number[], uv: number[][], color: THREE.Color): void {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const cx = e1[1] * e2[2] - e1[2] * e2[1], cy = e1[2] * e2[0] - e1[0] * e2[2], cz = e1[0] * e2[1] - e1[1] * e2[0];
    const flip = cx * n[0] + cy * n[1] + cz * n[2] < 0;
    const order = flip ? [0, 2, 1, 0, 3, 2] : [0, 1, 2, 0, 2, 3];
    const v = [a, b, c, d], [nx, nz] = this.turn(n[0], n[2]);
    for (const i of order) {
      this.pos.push(...this.toWorld(v[i][0], v[i][1], v[i][2]));
      this.nor.push(nx, n[1], nz);
      this.uv.push(uv[i][0], uv[i][1]);
      this.col.push(color.r, color.g, color.b);
    }
  }

  /** An upright box: four sides and a top (and a bottom if asked). */
  box(cx: number, cz: number, hx: number, hz: number, y0: number, y1: number, color: THREE.Color, bottom = false): void {
    const x0 = cx - hx, x1 = cx + hx, z0 = cz - hz, z1 = cz + hz, f = [[0, 0], [1, 0], [1, 1], [0, 1]];
    this.quad([x1, y0, z0], [x1, y0, z1], [x1, y1, z1], [x1, y1, z0], [1, 0, 0], f, color);
    this.quad([x0, y0, z1], [x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [-1, 0, 0], f, color);
    this.quad([x1, y0, z1], [x0, y0, z1], [x0, y1, z1], [x1, y1, z1], [0, 0, 1], f, color);
    this.quad([x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0], [0, 0, -1], f, color);
    this.quad([x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1], [0, 1, 0], f, color);
    if (bottom) this.quad([x0, y0, z1], [x1, y0, z1], [x1, y0, z0], [x0, y0, z0], [0, -1, 0], f, color);
  }

  /** An upright cylinder or cone (r0 at the bottom, r1 at the top), with a top cap. */
  cylinder(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, color: THREE.Color, seg = 12): void {
    const f = [[0, 0], [1, 0], [1, 1], [0, 1]], slope = (r0 - r1) / Math.max(1e-6, y1 - y0);
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2, am = (a0 + a1) / 2;
      const p = (a: number, r: number, y: number) => [cx + Math.cos(a) * r, y, cz + Math.sin(a) * r];
      const nl = Math.hypot(1, slope);
      this.quad(p(a0, r0, y0), p(a1, r0, y0), p(a1, r1, y1), p(a0, r1, y1), [Math.cos(am) / nl, slope / nl, Math.sin(am) / nl], f, color);
      if (r1 > 0.01) this.quad([cx, y1, cz], p(a1, r1, y1), p(a0, r1, y1), [cx, y1, cz], [0, 1, 0], f, color);
    }
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const col = (hex: number | string, k = 1) => new THREE.Color(hex).multiplyScalar(k);

// ---------------------------------------------------------------- facade textures (light, so the tint shows through)
type Tex = (renderer: THREE.WebGLRenderer) => THREE.CanvasTexture;

/** 4 bays × 3 floors of curtain wall: tinted glass between concrete spandrels, a few blinds down. */
const officeUpper: Tex = r => canvasTexture(r, 512, 384, g => {
  const R = rng(21);
  g.fillStyle = '#e4e6e7'; g.fillRect(0, 0, 512, 384);
  for (let fy = 0; fy < 3; fy++) for (let bx = 0; bx < 4; bx++) {
    const x = bx * 128, y = fy * 128;
    const gr = g.createLinearGradient(x, y + 24, x + 128, y + 124);
    gr.addColorStop(0, '#2f4658'); gr.addColorStop(0.55, '#4f6d82'); gr.addColorStop(1, '#30485a');
    g.fillStyle = gr; g.fillRect(x + 4, y + 24, 120, 100);
    g.fillStyle = 'rgba(255,255,255,.08)'; g.beginPath(); g.moveTo(x + 30, y + 24); g.lineTo(x + 60, y + 24); g.lineTo(x + 20, y + 124); g.lineTo(x + 4, y + 124); g.closePath(); g.fill();
    if (R() < 0.3) { g.fillStyle = 'rgba(214,210,196,.75)'; g.fillRect(x + 4, y + 24, 120, 18 + R() * 50); }
    g.fillStyle = '#9aa3a8'; g.fillRect(x + 62, y + 24, 4, 100); g.fillRect(x + 4, y + 70, 120, 3);
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(x + 4, y + 24, 120, 3);
  }
  g.fillStyle = '#b9bec1'; for (let bx = 0; bx <= 4; bx++) g.fillRect(bx * 128 - 3, 0, 6, 384);   // fins between bays
});

/** 4 bays × 3 floors of plastered wall: framed windows with sills, curtains here and there, a balcony now and then. */
const apartmentUpper: Tex = r => canvasTexture(r, 512, 384, g => {
  const R = rng(33);
  g.fillStyle = '#f1ece4'; g.fillRect(0, 0, 512, 384);
  for (let i = 0; i < 2500; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '0,0,0' : '255,255,255'},${0.03 + R() * 0.04})`; g.fillRect(R() * 512, R() * 384, 2, 2); }
  for (let fy = 0; fy < 3; fy++) for (let bx = 0; bx < 4; bx++) {
    const x = bx * 128, y = fy * 128, balcony = R() < 0.18;
    g.fillStyle = 'rgba(0,0,0,.12)'; g.fillRect(x + 30, y + 26, 68, 6);                              // lintel shadow
    g.fillStyle = '#fbfaf7'; g.fillRect(x + 32, y + 30, 64, balcony ? 90 : 66);                      // frame
    g.fillStyle = '#2d3a44'; g.fillRect(x + 37, y + 35, 54, balcony ? 80 : 56);                      // glass
    g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(x + 37, y + 35, 18, balcony ? 80 : 56);
    g.fillStyle = '#fbfaf7'; g.fillRect(x + 62, y + 35, 4, balcony ? 80 : 56);                       // mullion
    if (R() < 0.35) { g.fillStyle = R() < 0.5 ? 'rgba(226,214,186,.85)' : 'rgba(196,206,214,.8)'; g.fillRect(x + 37, y + 35, 25, 30 + R() * 26); }
    if (balcony) {
      g.fillStyle = '#6d7275'; g.fillRect(x + 22, y + 92, 84, 4); for (let k = 0; k < 9; k++) g.fillRect(x + 24 + k * 10, y + 96, 2, 26);
      g.fillStyle = '#8b9093'; g.fillRect(x + 20, y + 122, 88, 6);
    } else {
      g.fillStyle = '#d7d2c9'; g.fillRect(x + 28, y + 96, 72, 6); g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(x + 28, y + 102, 72, 3);   // sill
    }
  }
});

/** One office bay at street level: a stone plinth, a framed glass shopfront and a fascia. */
const officeGround: Tex = r => canvasTexture(r, 128, 128, g => {
  g.fillStyle = '#c9c6c0'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#3e4a52'; g.fillRect(0, 0, 128, 20);                                                  // fascia
  const gr = g.createLinearGradient(0, 22, 0, 112); gr.addColorStop(0, '#3b5263'); gr.addColorStop(1, '#22313c');
  g.fillStyle = gr; g.fillRect(6, 24, 116, 88);
  g.fillStyle = '#7e868b'; g.fillRect(6, 24, 116, 3); g.fillRect(62, 24, 4, 88); g.fillRect(6, 64, 116, 2);
  g.fillStyle = 'rgba(255,255,255,.1)'; g.fillRect(14, 28, 16, 80);
  g.fillStyle = '#6e6a64'; g.fillRect(0, 112, 128, 16);                                                // plinth
});

/** Two apartment bays at street level: a shop with an awning, then a front door. */
const apartmentGround: Tex = r => canvasTexture(r, 256, 128, g => {
  g.fillStyle = '#ece6dc'; g.fillRect(0, 0, 256, 128);
  g.fillStyle = '#2b3740'; g.fillRect(14, 40, 100, 70);                                                 // shop window
  g.fillStyle = '#f7f5f1'; g.fillRect(14, 40, 100, 4); g.fillRect(62, 40, 4, 70);
  for (let k = 0; k < 6; k++) { g.fillStyle = k % 2 ? '#f2efe8' : '#8b3b32'; g.fillRect(8 + k * 19, 22, 19, 16); }   // awning
  g.fillStyle = 'rgba(0,0,0,.2)'; g.fillRect(8, 38, 114, 4);
  g.fillStyle = '#5b3b28'; g.fillRect(170, 46, 44, 66);                                                 // door
  g.fillStyle = '#2b3740'; g.fillRect(178, 54, 28, 22);
  g.fillStyle = '#cfc9bf'; g.fillRect(164, 40, 56, 6);
  g.fillStyle = '#7a756d'; g.fillRect(0, 112, 256, 16);                                                // plinth
});

/** Corrugated cladding, a little weathered. */
const shed: Tex = r => canvasTexture(r, 128, 128, g => {
  const R = rng(5);
  for (let x = 0; x < 128; x += 8) {
    const gr = g.createLinearGradient(x, 0, x + 8, 0);
    gr.addColorStop(0, '#d9d6cf'); gr.addColorStop(0.5, '#f4f2ed'); gr.addColorStop(1, '#bdb9b0');
    g.fillStyle = gr; g.fillRect(x, 0, 8, 128);
  }
  for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(120,96,70,${0.05 + R() * 0.08})`; g.fillRect(R() * 128, 100 + R() * 28, 2 + R() * 6, 4 + R() * 20); }
  g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, 128, 3);
});

/** Bitumen roof membrane with seams and a little gravel. */
const roofTex: Tex = r => canvasTexture(r, 128, 128, g => {
  const R = rng(9);
  g.fillStyle = '#85878a'; g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(${R() < 0.5 ? '40,42,44' : '190,190,186'},${0.12 + R() * 0.2})`; g.fillRect(R() * 128, R() * 128, 1 + R() * 2, 1 + R() * 2); }
  g.fillStyle = 'rgba(30,32,34,.35)'; for (let y = 0; y < 128; y += 32) g.fillRect(0, y, 128, 2);
});

const repeat = (t: THREE.CanvasTexture, clampT = false) => { t.wrapS = THREE.RepeatWrapping; t.wrapT = clampT ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping; return t; };

/**
 * Every building as a handful of merged meshes: a distinct street level, framed upper floors with ledges,
 * a parapet round a membrane roof. The drawn walls stay on the collision box; only ledges stand 0.1–0.25 m proud.
 */
export function buildBuildings(scene: THREE.Scene, renderer: THREE.WebGLRenderer, layout: Layout): void {
  const mat = (t: THREE.CanvasTexture | null) => new THREE.MeshLambertMaterial({ map: t, vertexColors: true });
  const M = {
    officeUp: mat(repeat(officeUpper(renderer))), officeGround: mat(repeat(officeGround(renderer), true)),
    aptUp: mat(repeat(apartmentUpper(renderer))), aptGround: mat(repeat(apartmentGround(renderer), true)),
    shed: mat(repeat(shed(renderer))), roof: mat(repeat(roofTex(renderer))), trim: mat(null),
  };
  const parts = new Map<THREE.Material, Builder[]>();
  const add = (m: THREE.Material, b: Builder) => { const l = parts.get(m) ?? []; l.push(b); parts.set(m, l); };

  for (const b of layout.buildings) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot), g = terrainH(b.x, b.z), style = buildingStyle(b);
    const toWorld = (lx: number, y: number, lz: number): [number, number, number] => [b.x + lx * c + lz * s, y, b.z - lx * s + lz * c];
    const turn = (nx: number, nz: number): [number, number] => [nx * c + nz * s, -nx * s + nz * c];
    const make = () => new Builder(toWorld, turn);
    const tint = col(b.tint), trimC = col(b.tint, 0.86), white = col(0xffffff);
    const { hw, hd } = b;
    // the four walls, each from corner p0 along t for its width
    const walls = [
      { p0: [-hw, hd], t: [1, 0], W: 2 * hw, n: [0, 0, 1] }, { p0: [hw, -hd], t: [-1, 0], W: 2 * hw, n: [0, 0, -1] },
      { p0: [hw, hd], t: [0, -1], W: 2 * hd, n: [1, 0, 0] }, { p0: [-hw, -hd], t: [0, 1], W: 2 * hd, n: [-1, 0, 0] },
    ];
    const wallBand = (bld: Builder, y0: number, y1: number, v: (y: number) => number, uScale: number) => {
      for (const w of walls) {
        const bays = Math.max(1, Math.round(w.W / BAY)), u1 = bays * uScale;
        const a = [w.p0[0], y0, w.p0[1]], bb = [w.p0[0] + w.t[0] * w.W, y0, w.p0[1] + w.t[1] * w.W];
        bld.quad(a, bb, [bb[0], y1, bb[2]], [a[0], y1, a[2]], w.n, [[0, v(y0)], [u1, v(y0)], [u1, v(y1)], [0, v(y1)]], tint);
      }
    };
    const ring = (bld: Builder, y0: number, y1: number, out: number, color: THREE.Color) => {
      bld.box(0, hd + out / 2, hw + out, out / 2, y0, y1, color, true);
      bld.box(0, -hd - out / 2, hw + out, out / 2, y0, y1, color, true);
      bld.box(hw + out / 2, 0, out / 2, hd, y0, y1, color, true);
      bld.box(-hw - out / 2, 0, out / 2, hd, y0, y1, color, true);
    };

    if (style === 'shed') {
      const w = make();
      wallBand(w, b.base, b.top, y => (y - g) / FLOOR, 1);
      add(M.shed, w);
      // a big sliding door on the side facing Base, in panels, with a guide rail over it
      const toBase = [-b.x, -b.z], face = walls.reduce((m, f) => {
        const [nx, nz] = turn(f.n[0], f.n[2]), d = nx * toBase[0] + nz * toBase[1];
        return d > m.d ? { f, d } : m;
      }, { f: walls[0], d: -Infinity }).f;
      const doorW = face.W * 0.62, doorH = Math.min(7, (b.top - g) * 0.78), panels = Math.max(2, Math.round(doorW / 3));
      const along = [face.t[0], face.t[1]], mid = [face.p0[0] + along[0] * face.W / 2, face.p0[1] + along[1] * face.W / 2];
      const out = [face.n[0], face.n[2]], door = make();
      for (let k = 0; k < panels; k++) {
        const o = -doorW / 2 + (k + 0.5) * (doorW / panels);
        const cx = mid[0] + along[0] * o + out[0] * 0.08, cz = mid[1] + along[1] * o + out[1] * 0.08;
        const half = doorW / panels / 2 - 0.06, hx = Math.abs(along[0]) * half + Math.abs(out[0]) * 0.06, hz = Math.abs(along[1]) * half + Math.abs(out[1]) * 0.06;
        door.box(cx, cz, hx, hz, g - 0.2, g + doorH, col(k % 2 ? 0x5d6560 : 0x59615c));
      }
      const rail = [mid[0] + out[0] * 0.2, mid[1] + out[1] * 0.2];
      door.box(rail[0], rail[1], Math.abs(along[0]) * (doorW / 2 + 1) + Math.abs(out[0]) * 0.18, Math.abs(along[1]) * (doorW / 2 + 1) + Math.abs(out[1]) * 0.18, g + doorH, g + doorH + 0.35, col(0x3f4447), true);
      add(M.trim, door);
    } else {
      const top = g + GROUND_FLOOR, upH = b.top - top, floors = Math.max(1, Math.round(upH / FLOOR));
      const ground = make(), upper = make(), trim = make();
      // street level: one texture tile is the ground floor; below grade the plinth row stretches down
      wallBand(ground, b.base, top, y => (y - g) / GROUND_FLOOR, style === 'office' ? 1 : 0.5);
      // upper floors: the texture holds 4 bays × 3 floors
      wallBand(upper, top, b.top, y => ((y - top) / upH) * floors / 3, 0.25);
      ring(trim, top - 0.2, top + 0.18, 0.25, trimC);                                                  // cornice over the street level
      if (style === 'apartment') for (let k = 1; k < floors; k++) { const y = top + (upH * k) / floors; ring(trim, y - 0.08, y + 0.08, 0.12, trimC); }
      add(style === 'office' ? M.officeGround : M.aptGround, ground);
      add(style === 'office' ? M.officeUp : M.aptUp, upper);
      add(M.trim, trim);
    }
    // roof: membrane inside the parapet, the parapet itself with a lighter coping
    const roof = make(), T = PARAPET_T, ph = parapetHeight(b), trim = make();
    roof.quad([-hw, b.top, -hd], [hw, b.top, -hd], [hw, b.top, hd], [-hw, b.top, hd], [0, 1, 0], [[-hw / 6, -hd / 6], [hw / 6, -hd / 6], [hw / 6, hd / 6], [-hw / 6, hd / 6]], white);
    add(M.roof, roof);
    const wallC = style === 'shed' ? col(b.tint, 0.8) : trimC, coping = col(b.tint, 1.04);
    for (const [cx, cz, hx, hz] of [[0, hd - T / 2, hw, T / 2], [0, -hd + T / 2, hw, T / 2], [hw - T / 2, 0, T / 2, hd - T], [-hw + T / 2, 0, T / 2, hd - T]]) {
      trim.box(cx, cz, hx, hz, b.top - 0.05, b.top + ph - 0.08, wallC);
      trim.box(cx, cz, hx + 0.04, hz + 0.04, b.top + ph - 0.08, b.top + ph, coping);
    }
    add(M.trim, trim);
  }

  for (const [m, list] of parts) {
    const merged = new Builder();
    for (const b of list) { merged.pos.push(...b.pos); merged.nor.push(...b.nor); merged.uv.push(...b.uv); merged.col.push(...b.col); }
    const mesh = new THREE.Mesh(merged.geometry(), m);
    mesh.castShadow = mesh.receiveShadow = true;
    scene.add(mesh);
  }
}

/** Rooftop clutter models, in metres, standing on y = 0 and centred, made to the ROOF_KIT sizes. */
export function roofKitGeometry(kind: keyof typeof ROOF_KIT): THREE.BufferGeometry {
  const b = new Builder(), [hw, hd, h] = ROOF_KIT[kind];
  const dark = col(0x3a3e41), steel = col(0x8e9599), light = col(0xc4c8cb);
  if (kind === 'ac') {
    b.box(0, 0, hw, hd, 0, 0.15, dark);                                                             // frame
    b.box(0, 0, hw - 0.06, hd - 0.06, 0.15, h - 0.15, light);                                       // casing
    for (let k = 0; k < 6; k++) for (const side of [-1, 1]) b.box(0, side * (hd - 0.05), hw - 0.25, 0.03, 0.35 + k * 0.13, 0.4 + k * 0.13, col(0x8d9295));   // louvres
    for (const fx of [-0.55, 0.55]) {
      b.cylinder(fx, 0, 0.5, 0.5, h - 0.15, h - 0.02, dark, 14);                                    // fan shroud
      b.cylinder(fx, 0, 0.42, 0.42, h - 0.02, h, col(0x25282a), 14);                                // grille
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2 + fx; b.box(fx + Math.cos(a) * 0.2, Math.sin(a) * 0.2, 0.2 * Math.abs(Math.cos(a)) + 0.03, 0.2 * Math.abs(Math.sin(a)) + 0.03, h, h + 0.02, steel); }
      b.cylinder(fx, 0, 0.07, 0.07, h, h + 0.04, light, 8);                                         // hub
    }
  } else if (kind === 'tank') {
    const legs = hw - 0.4, tank = col(0x86939a);
    for (const x of [-legs, legs]) for (const z of [-legs, legs]) b.box(x, z, 0.08, 0.08, 0, 1, dark);
    b.box(0, 0, legs + 0.12, legs + 0.12, 1, 1.1, dark, true);                                       // deck
    b.cylinder(0, 0, hw - 0.2, hw - 0.2, 1.1, h - 0.4, tank, 18);
    for (const y of [1.6, 2.4]) b.cylinder(0, 0, hw - 0.16, hw - 0.16, y, y + 0.08, col(0x6d777c), 18);   // bands
    b.cylinder(0, 0, hw - 0.15, 0.12, h - 0.4, h, col(0x7a868c), 18);                              // cone roof
    b.box(legs + 0.1, 0, 0.03, 0.25, 0, h - 0.5, steel);                                            // ladder rails
  } else if (kind === 'antenna') {
    b.box(0, 0, hw, hd, 0, 0.08, dark);
    b.cylinder(0, 0, 0.06, 0.04, 0.08, h, steel, 6);
    for (const [y, L] of [[3.6, 0.6], [4.6, 0.45], [5.5, 0.3]]) { b.box(0, 0, L, 0.025, y, y + 0.05, steel); b.box(0, 0, 0.025, L, y + 0.1, y + 0.15, steel); }
    b.box(0, 0, 0.07, 0.07, h - 0.05, h + 0.1, col(0xc8392e));                                       // warning light
  } else if (kind === 'vent') {
    b.cylinder(0, 0, 0.22, 0.22, 0, 0.08, dark, 10);
    b.cylinder(0, 0, 0.13, 0.13, 0.08, h - 0.3, steel, 10);
    b.cylinder(0, 0, hw, 0.05, h - 0.3, h, col(0x9aa1a5), 10);                                       // rain cap
  } else {
    const wall = col(0xd2cdc4);
    b.box(0, 0, hw, hd, 0, h - 0.2, wall);
    b.box(0, 0, hw + 0.15, hd + 0.15, h - 0.2, h, col(0x8e9092), true);                              // roof slab
    b.box(0.4, -hd - 0.02, 0.5, 0.03, 0, 2.1, col(0x5b3b28));                                        // door
    b.box(-1.2, -hd - 0.02, 0.35, 0.03, 1.6, 2.2, col(0x2d3a44));                                    // window
  }
  return b.geometry();
}
