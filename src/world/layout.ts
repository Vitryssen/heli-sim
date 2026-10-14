import { rng } from '../sim/math';
import { CORE, TOWN, polylineDistance, riverMask, terrainH, vnoise, WATER_Y } from './terrain';

/** A landing pad. `slope` tilts the top: surface height rises by gx per metre east and gz per metre south. */
export interface Pad { name: string; x: number; z: number; r: number; top: number; thick: number; spawn: boolean; slope: { gx: number; gz: number } | null }
/** A solid box, turned `rot` radians about the vertical (three.js rotation.y); hw/hd are half-sizes along its own x/z. */
export interface Box { x: number; z: number; hw: number; hd: number; base: number; top: number; rot: number }
export interface Building extends Box { w: number; d: number; tint: number; windows: boolean; pad: boolean }
export type PropKind = 'ac' | 'tank' | 'antenna' | 'vent' | 'penthouse' | 'parapet' | 'sandbag' | 'bladder' | 'tent' | 'pylon' | 'mast' | 'deck' | 'pier' | 'transformer' | 'fence';
export interface Prop extends Box { kind: PropKind }
export interface Tree { x: number; z: number; y: number; crownR: number; crownH: number; hue: number; sat: number; light: number; r: number; top: number; kind: 'pine' | 'broad' }
/** A road sampled every few metres; `y` is the driving surface (terrain, or the deck on a bridge), `s` the distance along it. */
export interface RoadPt { x: number; y: number; z: number; s: number }
export interface Road { name: string; pts: RoadPt[]; length: number; width: number }
export interface Pylon { x: number; z: number; y: number; rot: number }
export interface PowerLine { pylons: Pylon[] }
export interface Layout { pads: Pad[]; buildings: Building[]; props: Prop[]; trees: Tree[]; roads: Road[]; powerLines: PowerLine[] }

type Pt = [number, number];
const TINTS = [0xffffff, 0xe8dccb, 0xd6dde4, 0xf1e6d0, 0xcfd4cc];
export const PYLON_H = 28, MAST_H = 110;
/** Rooftop clutter sizes (half-width, half-depth, height); the drawn models are made to these. */
export const ROOF_KIT: Record<'ac' | 'tank' | 'antenna' | 'vent' | 'penthouse', [number, number, number]> = {
  ac: [1.2, 0.8, 1.5], tank: [1.5, 1.5, 3.4], antenna: [0.3, 0.3, 6], vent: [0.35, 0.35, 1.2], penthouse: [2.2, 1.6, 3],
};
export const PARAPET_T = 0.35;   // parapet wall thickness, inside the building's footprint

/** Building style, from its size: glass offices over 22 m, plastered apartments below, corrugated metal sheds without windows. */
export function buildingStyle(b: Building): 'office' | 'apartment' | 'shed' {
  if (!b.windows) return 'shed';
  return b.top - terrainH(b.x, b.z) > 22 ? 'office' : 'apartment';
}
export const parapetHeight = (b: Building): number => ({ office: 1.1, apartment: 0.8, shed: 0.5 })[buildingStyle(b)];

/** Height of a pad's landing surface at (x, z). */
export function padSurface(p: Pad, x: number, z: number): number {
  return p.slope ? p.top + p.slope.gx * (x - p.x) + p.slope.gz * (z - p.z) : p.top;
}

/** (x, z) in a box's own frame. */
export function toLocal(b: Box, x: number, z: number): { lx: number; lz: number } {
  const dx = x - b.x, dz = z - b.z, c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { lx: dx * c - dz * s, lz: dx * s + dz * c };
}

function corners(x: number, z: number, hw: number, hd: number, rot: number): Pt[] {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, lz]) => [x + lx * c + lz * s, z - lx * s + lz * c] as Pt);
}

function building(x: number, z: number, w: number, d: number, h: number, tint: number, windows = true, rot = 0): Building {
  const gh = rot === 0
    ? Math.min(terrainH(x - w / 2, z - d / 2), terrainH(x + w / 2, z + d / 2), terrainH(x, z))
    : Math.min(terrainH(x, z), ...corners(x, z, w / 2, d / 2, rot).map(([cx, cz]) => terrainH(cx, cz)));
  return { x, z, w, d, hw: w / 2, hd: d / 2, base: gh - 2, top: terrainH(x, z) + h, tint, windows, pad: false, rot };
}

function prop(kind: PropKind, x: number, z: number, hw: number, hd: number, base: number, top: number, rot = 0): Prop {
  return { kind, x, z, hw, hd, base, top, rot };
}

/** Lowest ground under a footprint, so props sit in the slope rather than float. */
function groundUnder(x: number, z: number, hw: number, hd: number, rot: number): number {
  return Math.min(terrainH(x, z), ...corners(x, z, hw, hd, rot).map(([cx, cz]) => terrainH(cx, cz)));
}

/** A flat pad on the ground: top just above the highest terrain under it, deep enough to reach the lowest. */
function groundPad(name: string, x: number, z: number, spawn: boolean): Pad {
  let lo = Infinity, hi = -Infinity;
  for (let a = 0; a < 16; a++) for (const rr of [0, 5, 9.5]) {
    const h = terrainH(x + Math.cos((a / 16) * 6.283) * rr, z + Math.sin((a / 16) * 6.283) * rr);
    lo = Math.min(lo, h); hi = Math.max(hi, h);
  }
  return { name, x, z, r: 9, top: hi + 0.3, thick: hi + 0.3 - lo + 1.5, spawn, slope: null };
}

/** A closed circle round the origin, sampled every `step` metres (the last point closes the loop). */
function ringLine(r: number, step: number): { x: number; z: number; s: number }[] {
  const n = Math.round((2 * Math.PI * r) / step);
  return Array.from({ length: n + 1 }, (_, k) => {
    const a = (k / n) * Math.PI * 2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, s: (k / n) * 2 * Math.PI * r };
  });
}

/** Rounds a polyline's corners (Chaikin), then samples it every `step` metres. */
function sampleLine(ctrl: Pt[], step: number): { x: number; z: number; s: number }[] {
  let p = ctrl;
  for (let k = 0; k < 3; k++) {
    const q: Pt[] = [p[0]];
    for (let i = 0; i + 1 < p.length; i++) {
      const [ax, az] = p[i], [bx, bz] = p[i + 1];
      q.push([ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25], [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  const out: { x: number; z: number; s: number }[] = [{ x: p[0][0], z: p[0][1], s: 0 }];
  let s = 0, carry = 0;
  for (let i = 0; i + 1 < p.length; i++) {
    const [ax, az] = p[i], [bx, bz] = p[i + 1], L = Math.hypot(bx - ax, bz - az);
    let t = step - carry;
    while (t <= L) { out.push({ x: ax + (bx - ax) * (t / L), z: az + (bz - az) * (t / L), s: s + t }); t += step; }
    carry = L - (t - step);
    s += L;
  }
  const [lx, lz] = p[p.length - 1];
  out.push({ x: lx, z: lz, s });
  return out;
}

/** Radius of the ring road round Base: clear of the apron (±40 m) and the hangar (out to 69 m). */
export const BASE_RING = 80;

/**
 * The road network. A ring road circles Base (no road runs onto the pad); the roads out (`fromRing`)
 * start at its outer edge, heading for their first point. Everything else branches off a road.
 */
const ROADS: { name: string; pts: Pt[]; width: number; fromRing?: boolean }[] = [
  { name: 'Base ring', pts: [], width: 7 },
  { name: 'Town road', pts: [[40, -120], [120, -190], [TOWN.x - 24, TOWN.z + 120]], width: 7, fromRing: true },
  // streets through the town, between the rows of buildings
  { name: 'Town street W', pts: [[TOWN.x - 24, TOWN.z + 120], [TOWN.x - 24, TOWN.z - 120]], width: 7 },
  { name: 'Town street E', pts: [[TOWN.x + 24, TOWN.z + 120], [TOWN.x + 24, TOWN.z - 120]], width: 7 },
  { name: 'Town street S', pts: [[TOWN.x - 120, TOWN.z + 24], [TOWN.x + 120, TOWN.z + 24]], width: 7 },
  { name: 'Town street N', pts: [[TOWN.x - 120, TOWN.z - 24], [TOWN.x + 120, TOWN.z - 24]], width: 7 },
  { name: 'East road', fromRing: true, pts: [[250, 300], [600, 330], [800, 230], [1000, 220], [1250, 220], [1420, 205], [1680, 190]], width: 7 },
  { name: 'West road', fromRing: true, pts: [[-250, -120], [-450, -320], [-1000, -700], [-1250, -780], [-1450, -840], [-1660, -900]], width: 7 },
  { name: 'FARP spur', pts: [[-982, -699], [-994, -756]], width: 6 },
  { name: 'South road', fromRing: true, pts: [[60, 300], [200, 620], [350, 1100], [430, 1400], [470, 1600], [560, 1760]], width: 7 },
];

/** Where the grid comes in from the mountains and splits up. */
const SUBSTATION = { x: 760, z: 330 };
/**
 * The power grid: a main line from the south-east mountains into the substation, and lines out of it
 * to everything that needs power. Each ends at a transformer, so no line stops in the middle of nowhere.
 */
const POWER_LINES: { pts: Pt[]; feeds: Pt | null }[] = [
  { pts: [[2650, 1250], [1900, 1000], [1350, 760], [900, 520], [SUBSTATION.x + 30, SUBSTATION.z + 22]], feeds: null },
  { pts: [[SUBSTATION.x + 32, SUBSTATION.z - 18], [1000, 300], [1250, 290], [1405, 290]], feeds: [1412, 302] },                    // Eastvale
  { pts: [[SUBSTATION.x - 32, SUBSTATION.z + 22], [620, 760], [0, 840], [-560, 720], [-880, 300], [-940, -380], [-1030, -730]], feeds: [-1036, -742] },   // the FARP
  { pts: [[-1030, -730], [-1200, -805], [-1430, -860], [-1640, -905]], feeds: [-1648, -912] },                                       // the west hamlet
  { pts: [[0, 840], [300, 1100], [450, 1300], [520, 1580], [575, 1745]], feeds: [583, 1752] },                                       // the south farm
  { pts: [[SUBSTATION.x - 10, SUBSTATION.z - 28], [900, -150], [820, -600], [1000, -1000], [750, -1400], [626, -1586]], feeds: null },   // the radio mast
];

/** Forest patches (centre and rough radius); the edges wander with noise. */
const FORESTS: [number, number, number][] = [
  [-150, 1250, 230], [950, -950, 200], [-850, -1150, 240], [1550, 750, 220], [-1150, 450, 200], [700, 1350, 170],
  [1700, -700, 200], [-450, -1550, 180], [1100, -1500, 160], [-1650, -300, 200], [300, -1150, 170], [-1700, 1100, 180],
];

/**
 * The fixed, seeded map. The core (Base, town, Hilltop) is the original layout; around it are the
 * village of Eastvale, the FARP, three challenge pads, roads with bridges, power lines, a radio mast and forests.
 */
export function createLayout(): Layout {
  const pads: Pad[] = [], buildings: Building[] = [], props: Prop[] = [], trees: Tree[] = [], roads: Road[] = [], powerLines: PowerLine[] = [];

  // ---- the original core, generated exactly as before
  const r = rng(42);
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    if (i === 0 && j === 0) continue;
    if (r() < 0.16) continue;
    const cx = TOWN.x + i * 48, cz = TOWN.z + j * 48;
    buildings.push(building(cx + (r() - 0.5) * 6, cz + (r() - 0.5) * 6, 16 + r() * 12, 16 + r() * 12, 7 + r() * 27, TINTS[(r() * TINTS.length) | 0]));
  }
  buildings.push(building(-48, 18, 26, 30, 9, 0xb7aa8c, false));             // hangar by Base

  pads.push({ name: 'Base', x: 0, z: 0, r: 9, top: 0.25, thick: 0.5, spawn: true, slope: null });
  const roof = building(TOWN.x, TOWN.z, 32, 32, 26, 0xdfe3e6);
  roof.pad = true;
  buildings.push(roof);
  pads.push({ name: 'Rooftop', x: TOWN.x, z: TOWN.z, r: 9, top: roof.top + 0.2, thick: 0.4, spawn: true, slope: null });
  pads.push(groundPad('Hilltop', 420, 150, true));

  // ---- FARP: a forward rearm pad in the west valley, ringed by sandbags
  const farp = groundPad('FARP', -1000, -770, true);
  pads.push(farp);
  for (let k = 0; k < 10; k++) {
    if (k === 2 || k === 7) continue;                                     // gaps to taxi out
    const a = (k / 10) * Math.PI * 2, x = farp.x + Math.cos(a) * 17, z = farp.z + Math.sin(a) * 17, rot = Math.atan2(Math.cos(a), Math.sin(a)) + Math.PI / 2;
    const g = groundUnder(x, z, 4, 0.7, rot);
    props.push(prop('sandbag', x, z, 4, 0.7, g - 0.5, g + 1.2, rot));
  }
  for (const [dx, dz] of [[-34, 14], [-34, -6]]) { const x = farp.x + dx, z = farp.z + dz, g = groundUnder(x, z, 5, 2.4, 0); props.push(prop('bladder', x, z, 5, 2.4, g - 0.3, g + 1.3)); }
  for (const [dx, dz] of [[30, 18], [32, -6]]) { const x = farp.x + dx, z = farp.z + dz, g = groundUnder(x, z, 3.5, 3, 0); props.push(prop('tent', x, z, 3.5, 3, g - 0.3, g + 3.2)); }

  // ---- Eastvale: houses along the main street, a pad by the road, a tight pad among towers
  const village = { x: 1500, z: 200 };
  pads.push(groundPad('Eastvale', 1430, 140, true));
  const tower = building(1580, 250, 20, 20, 40, 0xd6dde4);
  tower.pad = true;
  pads.push({ name: 'Tower', x: tower.x, z: tower.z, r: 8.5, top: tower.top + 0.2, thick: 0.4, spawn: false, slope: null });
  buildings.push(tower,
    building(1553, 250, 20, 22, 52, 0xe8dccb), building(1607, 250, 20, 22, 55, 0xcfd4cc),
    building(1580, 223, 22, 20, 48, 0xf1e6d0), building(1580, 277, 22, 20, 50, 0xffffff));
  const vr = rng(314);
  for (let x = village.x - 70; x <= village.x + 170; x += 34) for (let z = village.z - 130; z <= village.z + 130; z += 34) {
    const hx = x + (vr() - 0.5) * 8, hz = z + (vr() - 0.5) * 8, w = 10 + vr() * 7, d = 10 + vr() * 7, h = 6 + vr() * 7, rot = (vr() - 0.5) * 0.3, keep = vr();
    const tint = TINTS[(vr() * TINTS.length) | 0];
    if (keep < 0.25) continue;
    if (Math.abs(hz - (205 - (hx - 1420) * 0.06)) < 18) continue;          // main street
    if (Math.hypot(hx - 1430, hz - 140) < 32) continue;                     // Eastvale pad
    if (Math.abs(hx - 1580) < 52 && Math.abs(hz - 250) < 52) continue;      // the towers
    buildings.push(building(hx, hz, w, d, h, tint, true, rot));
  }

  // ---- the three challenge landings
  pads.push(groundPad('Clearing', -150, 1250, false));
  pads.push(slopePad('Slope', 1000, -1350));

  // ---- roads: draped on the ground, on a deck where they cross the gorge
  for (const def of ROADS) {
    let ctrl = def.pts;
    if (def.name === 'FARP spur') {                                          // branch off wherever the smoothed West road actually runs
      const west = roads.find(r => r.name === 'West road')!, [ex, ez] = ctrl[1];
      const from = west.pts.reduce((m, p) => (Math.hypot(p.x - ex, p.z - ez) < Math.hypot(m.x - ex, m.z - ez) ? p : m));
      ctrl = [[from.x, from.z], ctrl[1]];
    }
    if (def.fromRing) {
      const [x, z] = ctrl[0], d = Math.hypot(x, z), r = BASE_RING + def.width / 2;
      ctrl = [[(x / d) * r, (z / d) * r], ...ctrl];
    }
    const pts: RoadPt[] = (def.name === 'Base ring' ? ringLine(BASE_RING, 5) : sampleLine(ctrl, 5)).map(p => ({ ...p, y: terrainH(p.x, p.z) }));
    for (let i = 0; i < pts.length; i++) {
      if (riverMask(pts[i].x, pts[i].z) <= 0.02) continue;
      let j = i;
      while (j + 1 < pts.length && riverMask(pts[j + 1].x, pts[j + 1].z) > 0.02) j++;
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, j + 1)];
      const deck = Math.min(a.y, b.y) + 0.4;
      bridge(props, a, b, deck, def.width);
      for (let k = i; k <= j; k++) pts[k].y = deck;
      i = j;
    }
    roads.push({ name: def.name, pts, length: pts[pts.length - 1].s, width: def.width });
  }

  // ---- the power grid: a pylon at every corner and about every 180 m between, none in the river; the wires are only drawn
  {
    const sx = SUBSTATION.x, sz = SUBSTATION.z, g = groundUnder(sx, sz, 22, 16, 0);
    for (const [dx, dz] of [[-9, -4], [0, -4], [9, -4]]) props.push(prop('transformer', sx + dx, sz + dz, 1.6, 1.3, g - 0.3, g + 3.2));
    buildings.push(building(sx, sz + 9, 12, 6, 4, 0xb7aa8c, false));
    for (const [x, z, hw, hd] of [[sx, sz - 16, 22, 0.1], [sx, sz + 16, 22, 0.1], [sx - 22, sz, 0.1, 16], [sx + 22, sz, 0.1, 16]]) props.push(prop('fence', x, z, hw, hd, g - 0.3, g + 2.4));
  }
  const allPylons: Pylon[] = [];
  for (const line of POWER_LINES) {
    const pylons: Pylon[] = [];
    const pts = line.pts;
    const add = (x: number, z: number, dx: number, dz: number, must: boolean) => {
      if (!must && riverMask(x, z) > 0) return;                                 // a long span across the gorge instead
      const shared = allPylons.find(pp => Math.hypot(pp.x - x, pp.z - z) < 25);   // where lines meet, they share a pylon
      if (shared) { pylons.push(shared); return; }
      const rot = Math.atan2(-dz, dx), y = groundUnder(x, z, 2.4, 2.4, rot);
      const py = { x, z, y, rot };
      pylons.push(py); allPylons.push(py);
      props.push(prop('pylon', x, z, 2.4, 2.4, y - 1, y + PYLON_H, rot));
    };
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i], [bx, bz] = pts[i + 1], L = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(L / 180));
      // corners face halfway between the two spans that meet there
      const [px, pz] = pts[Math.max(0, i - 1)];
      add(ax, az, (bx - ax) / L + (i > 0 ? (ax - px) / Math.hypot(ax - px, az - pz) : 0), (bz - az) / L + (i > 0 ? (az - pz) / Math.hypot(ax - px, az - pz) : 0), true);
      for (let k = 1; k < n; k++) add(ax + (bx - ax) * (k / n), az + (bz - az) * (k / n), bx - ax, bz - az, false);
      if (i + 2 === pts.length) add(bx, bz, bx - ax, bz - az, true);
    }
    if (line.feeds) { const [fx, fz] = line.feeds, g = groundUnder(fx, fz, 1.2, 1, 0); props.push(prop('transformer', fx, fz, 1.2, 1, g - 0.3, g + 2.6)); }
    powerLines.push({ pylons });
  }

  // ---- radio mast on the highest point of the north ridge near (600, -1580)
  {
    let bx = 600, bz = -1580, bh = -Infinity;
    for (let x = 450; x <= 750; x += 10) for (let z = -1730; z <= -1430; z += 10) { const h = terrainH(x, z); if (h > bh) { bh = h; bx = x; bz = z; } }
    props.push(prop('mast', bx, bz, 0.9, 0.9, bh - 1, bh + MAST_H));
    const hut = groundUnder(bx + 9, bz + 6, 2.5, 2, 0);
    props.push(prop('tent', bx + 9, bz + 6, 2.5, 2, hut - 0.3, hut + 2.8));
  }

  // ---- a hamlet past each bridge
  buildings.push(building(-1690, -930, 14, 11, 7, 0xe8dccb, true, 0.25), building(-1660, -960, 10, 9, 6, 0xf1e6d0, true, 0.1), building(-1700, -880, 18, 12, 8, 0xb7aa8c, false, 0.2));
  buildings.push(building(590, 1785, 14, 10, 7, 0xd6dde4, true, -0.3), building(560, 1810, 20, 12, 8, 0xb7aa8c, false, -0.25));

  // ---- roofs: a parapet round every one; on roofs without a pad, a stair housing and clutter
  const cr = rng(77);
  for (const b of buildings) {
    const c = Math.cos(b.rot), s = Math.sin(b.rot), T = PARAPET_T / 2, ph = parapetHeight(b);
    const at = (lx: number, lz: number) => ({ x: b.x + lx * c + lz * s, z: b.z - lx * s + lz * c });
    for (const [lx, lz, hw, hd] of [[0, b.hd - T, b.hw, T], [0, -b.hd + T, b.hw, T], [b.hw - T, 0, T, b.hd - 2 * T], [-b.hw + T, 0, T, b.hd - 2 * T]]) {
      const p = at(lx, lz);
      props.push(prop('parapet', p.x, p.z, hw, hd, b.top - 0.1, b.top + ph, b.rot));
    }
    if (b.pad || !b.windows) continue;
    const roofProps: Prop[] = [];
    const place = (kind: PropKind, lx: number, lz: number) => {
      const [hw, hd, h] = ROOF_KIT[kind as keyof typeof ROOF_KIT], p = at(lx, lz);
      if (roofProps.some(o => Math.hypot(o.x - p.x, o.z - p.z) < Math.max(o.hw, o.hd) + Math.max(hw, hd) + 1.2)) return;
      roofProps.push(prop(kind, p.x, p.z, hw, hd, b.top - 0.1, b.top + h, b.rot));
    };
    if (b.hw > 7 && b.hd > 7) {                                              // stairs up to the roof, in a corner
      const [hw, hd] = ROOF_KIT.penthouse;
      place('penthouse', (cr() < 0.5 ? -1 : 1) * (b.hw - hw - 1.4), (cr() < 0.5 ? -1 : 1) * (b.hd - hd - 1.4));
    }
    const n = 1 + Math.floor(cr() * Math.min(5, (b.w * b.d) / 90));
    for (let k = 0; k < n * 4 && roofProps.length < n + 1; k++) {
      const pick = cr(), kind: PropKind = pick < 0.4 ? 'ac' : pick < 0.6 ? 'tank' : pick < 0.75 ? 'antenna' : 'vent';
      const [hw, hd] = ROOF_KIT[kind as keyof typeof ROOF_KIT];
      if (b.hw < hw + 2.5 || b.hd < hd + 2.5) continue;
      place(kind, (cr() * 2 - 1) * (b.hw - hw - 2), (cr() * 2 - 1) * (b.hd - hd - 2));
    }
    props.push(...roofProps);
  }

  // ---- trees: the original 340 inside the core, then forests and a light scatter outside it
  const t = rng(1234);
  const core: Tree[] = [];
  while (core.length < 340) {
    const a = t() * Math.PI * 2, d = 70 + Math.pow(t(), 0.7) * 1100, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 170) continue;
    if (pads.slice(0, 3).some(pd => Math.hypot(x - pd.x, z - pd.z) < 40)) continue;
    if (Math.hypot(x + 48, z - 18) < 40) continue;
    const y = terrainH(x, z), crownR = 1.8 + t() * 1.4, crownH = 6 + t() * 6;
    const hue = 0.27 + t() * 0.07, sat = 0.38 + t() * 0.15, light = 0.2 + t() * 0.1;
    core.push({ x, z, y, crownR, crownH, hue, sat, light, r: crownR * 0.85, top: y + 1.8 + crownH * 0.9, kind: 'pine' });
  }
  // (the few that stood where the roads now run are left out)
  const roadLines = roads.map(r => ({ pts: r.pts.map(p => [p.x, p.z] as Pt), clear: r.width / 2 + 2.5 }));
  trees.push(...core.filter(tr => Math.hypot(tr.x - CORE.x, tr.z - CORE.z) < CORE.r - 20 && roadLines.every(l => polylineDistance(l.pts, tr.x, tr.z) > l.clear + tr.crownR)));

  const clear = treeClearance(pads, buildings, props, roads, powerLines);
  const f = rng(2024);
  const tryTree = (x: number, z: number, forest: boolean): void => {
    if (Math.hypot(x - CORE.x, z - CORE.z) < CORE.r + 30) return;
    const y = terrainH(x, z);
    if (y < WATER_Y + 1.5 || riverMask(x, z) > 0.6) return;
    const slope = Math.hypot(terrainH(x + 3, z) - terrainH(x - 3, z), terrainH(x, z + 3) - terrainH(x, z - 3)) / 6;
    if (slope > 0.85 || !clear(x, z)) return;
    const pine = y > 70 ? f() < 0.85 : f() < (forest ? 0.45 : 0.3);
    const crownR = pine ? 1.8 + f() * 1.5 : 2.6 + f() * 1.8, crownH = pine ? 7 + f() * 8 : 5 + f() * 4;
    const hue = pine ? 0.3 + f() * 0.06 : 0.2 + f() * 0.09, sat = 0.35 + f() * 0.2, light = pine ? 0.17 + f() * 0.08 : 0.24 + f() * 0.1;
    const trunk = pine ? 1.8 : 2.4;
    trees.push({ x, z, y, crownR, crownH, hue, sat, light, r: crownR * 0.85, top: y + trunk + crownH * 0.9, kind: pine ? 'pine' : 'broad' });
  };
  const CELL = 17;
  for (const [fx, fz, fr] of FORESTS) {
    for (let x = fx - fr * 1.3; x <= fx + fr * 1.3; x += CELL) for (let z = fz - fr * 1.3; z <= fz + fr * 1.3; z += CELL) {
      const jx = x + (f() - 0.5) * CELL * 0.9, jz = z + (f() - 0.5) * CELL * 0.9;
      const edge = fr * (0.7 + 0.6 * vnoise(jx / 90, jz / 90, 5));
      if (Math.hypot(jx - fx, jz - fz) > edge) continue;
      tryTree(jx, jz, true);
    }
  }
  // the clearing: a tight ring of tall pines round the pad, so you come straight down into it
  const glade = pads.find(p => p.name === 'Clearing')!;
  for (let k = 0; k < 14; k++) {
    const a = (k / 14) * Math.PI * 2 + f() * 0.2, d = 11.5 + f() * 2.5, x = glade.x + Math.cos(a) * d, z = glade.z + Math.sin(a) * d, y = terrainH(x, z);
    const crownR = 1.9 + f() * 0.5, crownH = 13 + f() * 5;
    trees.push({ x, z, y, crownR, crownH, hue: 0.31 + f() * 0.04, sat: 0.4, light: 0.17 + f() * 0.05, r: crownR * 0.85, top: y + 1.8 + crownH * 0.9, kind: 'pine' });
  }
  for (let k = 0; k < 900; k++) {
    const x = (f() * 2 - 1) * 2300, z = (f() * 2 - 1) * 2300;
    if (vnoise(x / 200, z / 200, 9) < 0.45) continue;                          // scattered copses, not an even sprinkle
    tryTree(x, z, false);
  }
  return { pads, buildings, props, trees, roads, powerLines };
}

/** An 8° pad where the hillside comes closest to that slope; it tilts the same way as the ground. */
function slopePad(name: string, cx: number, cz: number): Pad {
  const want = Math.tan(8 * Math.PI / 180);
  let best = { x: cx, z: cz, gx: 0, gz: want, err: Infinity };
  for (let x = cx - 250; x <= cx + 250; x += 10) for (let z = cz - 250; z <= cz + 250; z += 10) {
    if (riverMask(x, z) > 0) continue;
    const gx = (terrainH(x + 6, z) - terrainH(x - 6, z)) / 12, gz = (terrainH(x, z + 6) - terrainH(x, z - 6)) / 12;
    const err = Math.abs(Math.hypot(gx, gz) - want) + Math.hypot(x - cx, z - cz) * 1e-4;
    if (err < best.err) best = { x, z, gx, gz, err };
  }
  const g = Math.hypot(best.gx, best.gz) || 1;
  const slope = { gx: (best.gx / g) * want, gz: (best.gz / g) * want };
  // the surface clears the ground everywhere under the disc; the platform reaches down to its lowest point
  let lift = -Infinity, lo = Infinity;
  for (let a = 0; a < 16; a++) for (const rr of [0, 5, 9.5]) {
    const x = best.x + Math.cos((a / 16) * 6.283) * rr, z = best.z + Math.sin((a / 16) * 6.283) * rr, h = terrainH(x, z);
    lift = Math.max(lift, h - slope.gx * (x - best.x) - slope.gz * (z - best.z));
    lo = Math.min(lo, h);
  }
  const top = lift + 0.3;
  return { name, x: best.x, z: best.z, r: 9, top, thick: top + 9.5 * want - lo + 1.5, spawn: false, slope };
}

/** A deck from bank to bank with two piers standing in the river. */
function bridge(props: Prop[], a: RoadPt, b: RoadPt, deck: number, width: number): void {
  const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz), rot = Math.atan2(-dz, dx);
  const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
  props.push(prop('deck', mx, mz, L / 2 + 4, width / 2 + 1, deck - 1.3, deck, rot));
  for (const f of [1 / 3, 2 / 3]) {
    const x = a.x + dx * f, z = a.z + dz * f;
    props.push(prop('pier', x, z, 1.4, width / 2 + 1, WATER_Y - 8, deck - 1.3, rot));
  }
}

/** True where a tree may stand: off roads, clear of pads, buildings and props. */
function treeClearance(pads: Pad[], buildings: Building[], props: Prop[], roads: Road[], lines: PowerLine[]): (x: number, z: number) => boolean {
  const solids: Box[] = [...buildings, ...props];
  // power lines run through a cut corridor
  const corridors = lines.map(l => ({ pts: l.pylons.map(p => [p.x, p.z] as Pt), half: 14 }));
  const roadLines = roads.map(r => {
    const pts = r.pts.map(p => [p.x, p.z] as Pt), half = r.width / 2 + 4;
    const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
    return { pts, half, minX: Math.min(...xs) - half, maxX: Math.max(...xs) + half, minZ: Math.min(...zs) - half, maxZ: Math.max(...zs) + half };
  });
  return (x, z) => {
    for (const p of pads) if (Math.hypot(x - p.x, z - p.z) < (p.name === 'Clearing' ? 13 : 30)) return false;
    for (const b of solids) {
      const reach = b.hw + b.hd + 5;
      if (Math.abs(x - b.x) > reach || Math.abs(z - b.z) > reach) continue;
      const { lx, lz } = toLocal(b, x, z);
      if (Math.abs(lx) < b.hw + 5 && Math.abs(lz) < b.hd + 5) return false;
    }
    if (Math.hypot(x - 1500, z - 200) < 210) return false;                    // Eastvale stays open ground
    if (Math.hypot(x + 1000, z + 770) < 60) return false;                     // FARP
    for (const c of corridors) if (polylineDistance(c.pts, x, z) < c.half) return false;
    for (const r of roadLines) {
      if (x < r.minX || x > r.maxX || z < r.minZ || z > r.maxZ) continue;
      if (polylineDistance(r.pts, x, z) < r.half) return false;
    }
    return true;
  };
}
