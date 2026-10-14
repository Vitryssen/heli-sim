import { clamp, lerp, smooth } from '../sim/math';

export const TOWN = { x: 240, z: -330 };
export const ELEVATION = 85;   // base pad elevation above sea level, m
/** The river's surface. Only the carved gorge goes below it. */
export const WATER_Y = -6;
/** Inside `r` of this point the terrain is exactly the original map (Base, town, Hilltop, the lessons); new terrain blends in by `blend`. */
export const CORE = { x: 120, z: -40, r: 700, blend: 950 };

type Pt = [number, number];

const HILLS = [
  { x: 420, z: 150, r: 190, h: 62 }, { x: -380, z: -180, r: 150, h: 40 }, { x: -200, z: 480, r: 200, h: 34 },
  { x: 60, z: -780, r: 260, h: 85 }, { x: 720, z: -520, r: 220, h: 50 }, { x: -760, z: 300, r: 260, h: 72 },
  { x: 900, z: 520, r: 300, h: 95 },
];

/** The original map: gaussian hills plus gentle undulation, flattened around Base and the town. */
function coreH(x: number, z: number): number {
  let h = 0;
  for (const k of HILLS) {
    const dx = x - k.x, dz = z - k.z;
    h += k.h * Math.exp(-(dx * dx + dz * dz) / (k.r * k.r));
  }
  h += 1.4 * Math.sin(x * 0.012 + 1.3) * Math.cos(z * 0.01) + 0.6 * Math.sin(x * 0.029 + z * 0.023);
  h *= smooth(30, 110, Math.hypot(x, z));
  h *= smooth(150, 230, Math.hypot(x - TOWN.x, z - TOWN.z));
  return h;
}

// ---------------------------------------------------------------- the outer ring
const PLATEAU = 38;            // rolling upland between the ridges
const FLOOR = 4;               // valley floors, about level with Base
const RIVER_BED = WATER_Y - 5;

/** Ridgelines: a gaussian cross-section `w` wide, peaking at about `h`. */
const RIDGES: { pts: Pt[]; h: number; w: number }[] = [
  { pts: [[-250, -1150], [250, -1450], [800, -1650], [1300, -1950]], h: 160, w: 190 },
  { pts: [[1150, -650], [1250, 0], [1200, 650]], h: 140, w: 170 },
  { pts: [[700, 1000], [1300, 1100], [1800, 850]], h: 150, w: 180 },
  { pts: [[-800, 250], [-1000, -200], [-1050, -380]], h: 130, w: 160 },
  { pts: [[-300, 1050], [-650, 1150]], h: 120, w: 150 },
  { pts: [[1650, -400], [1900, -900]], h: 120, w: 160 },
];

/** Dry valleys with flat floors `floor` wide (half-width) and walls `wall` wide, cut through ridges and the plateau. */
export const VALLEYS: { pts: Pt[]; floor: number; wall: number }[] = [
  { pts: [[550, -560], [1100, -1050], [1500, -1250], [1850, -1350]], floor: 45, wall: 80 },
  { pts: [[600, 190], [1000, 220], [1250, 220], [1700, 180], [2050, -150]], floor: 50, wall: 85 },
  { pts: [[-450, -320], [-1000, -700], [-1330, -780], [-1660, -900]], floor: 50, wall: 80 },
  { pts: [[200, 620], [350, 1100], [430, 1420], [470, 1600], [570, 1780]], floor: 45, wall: 75 },
  { pts: [[-120, -800], [-350, -1300], [-640, -1820]], floor: 40, wall: 75 },
  { pts: [[-480, 520], [-900, 850], [-1320, 900]], floor: 45, wall: 80 },
];

/** Flat basins for the village and the FARP: radius `r`, walls `wall` wide. */
const BASINS = [
  { x: 1500, z: 200, r: 230, wall: 90 },
  { x: -1000, z: -720, r: 110, wall: 70 },
];

/** The river, from the north edge round the west and south to the south-east edge. */
export const RIVER: Pt[] = [
  [-500, -2900], [-650, -1900], [-1150, -1300], [-1350, -600], [-1250, 100], [-1350, 800],
  [-950, 1400], [-250, 1550], [450, 1400], [1150, 1550], [1700, 1950], [2250, 2900],
];
export const RIVER_HALF = 22, RIVER_WALL = 48;

/** Squared-distance-free polyline distance, with a bounding box so far-away lines cost one compare. */
interface Line { pts: Pt[]; minX: number; maxX: number; minZ: number; maxZ: number }
function line(pts: Pt[], pad: number): Line {
  const xs = pts.map(p => p[0]), zs = pts.map(p => p[1]);
  return { pts, minX: Math.min(...xs) - pad, maxX: Math.max(...xs) + pad, minZ: Math.min(...zs) - pad, maxZ: Math.max(...zs) + pad };
}

export function polylineDistance(pts: readonly Pt[], x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const ex = bx - ax, ez = bz - az, L2 = ex * ex + ez * ez;
    const t = L2 > 0 ? clamp(((x - ax) * ex + (z - az) * ez) / L2, 0, 1) : 0;
    const dx = x - ax - ex * t, dz = z - az - ez * t;
    best = Math.min(best, dx * dx + dz * dz);
  }
  return Math.sqrt(best);
}

function lineDist(l: Line, x: number, z: number): number {
  if (x < l.minX || x > l.maxX || z < l.minZ || z > l.maxZ) return Infinity;
  return polylineDistance(l.pts, x, z);
}

/** Integer hash → [0, 1). No Math.sin, so every JS engine agrees. */
function hash(ix: number, iz: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iz, 668265263) + Math.imul(seed, 1442695041)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function vnoise(x: number, z: number, seed: number): number {
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const u = fx * fx * (3 - 2 * fx), v = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz, seed), b = hash(ix + 1, iz, seed), c = hash(ix, iz + 1, seed), d = hash(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, u), lerp(c, d, u), v);
}

/** Fractal noise in about [-1, 1]. */
function fbm(x: number, z: number, seed: number, octaves: number): number {
  let sum = 0, amp = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += (vnoise(x, z, seed + o * 17) * 2 - 1) * amp;
    norm += amp; amp *= 0.5; x *= 2.03; z *= 2.03;
  }
  return sum / norm;
}

const ridgeLines = RIDGES.map(r => ({ ...r, l: line(r.pts, r.w * 2.6) }));
const valleyLines = VALLEYS.map(v => ({ ...v, l: line(v.pts, v.floor + v.wall) }));
const riverLine = line(RIVER, RIVER_HALF + RIVER_WALL + 260);

/** How far into the river channel (x, z) is: 1 on the water, 0 at the top of a plateau-height gorge wall (walls are wider through high ground). */
export function riverMask(x: number, z: number): number {
  return 1 - smooth(RIVER_HALF, RIVER_HALF + RIVER_WALL, lineDist(riverLine, x, z));
}

/** Rugged upland: plateau, ridges, the mountain rim at the map edge, then valleys, basins and the gorge cut into it. */
function outerH(x: number, z: number): number {
  let h = PLATEAU + fbm(x / 380, z / 380, 1, 4) * 24;
  let ridge = 0;
  for (const r of ridgeLines) {
    const d = lineDist(r.l, x, z);
    if (d === Infinity) continue;
    ridge = Math.max(ridge, r.h * (0.72 + 0.4 * vnoise(x / 150, z / 150, 7)) * Math.exp(-(d * d) / (r.w * r.w)));
  }
  h += ridge;
  const e = Math.pow(Math.pow(Math.abs(x), 6) + Math.pow(Math.abs(z), 6), 1 / 6);   // rounded-square distance from the centre
  h += smooth(1850, 2450, e) * (210 + 150 * vnoise(x / 260, z / 260, 11));

  const floor = FLOOR + fbm(x / 120, z / 120, 21, 2) * 1.5;
  for (const v of valleyLines) {
    const d = lineDist(v.l, x, z);
    if (d === Infinity) continue;
    const m = 1 - smooth(v.floor, v.floor + v.wall, d);
    if (m > 0) h = Math.min(h, lerp(h, floor, m));
  }
  for (const b of BASINS) {
    const m = 1 - smooth(b.r, b.r + b.wall, Math.hypot(x - b.x, z - b.z));
    if (m > 0) h = Math.min(h, lerp(h, FLOOR, m));
  }
  // the gorge: walls widen with the height they cut through, so the rim gets a canyon, not a sheer wall
  const d = lineDist(riverLine, x, z);
  if (d < Infinity) {
    const wall = RIVER_WALL + Math.max(0, h - PLATEAU) * 0.9;
    const rm = 1 - smooth(RIVER_HALF, RIVER_HALF + wall, d);
    if (rm > 0) h = Math.min(h, lerp(h, RIVER_BED, rm));
  }
  return h;
}

// the outer field is costly, so it is sampled once onto a 10 m grid and read back bilinearly
export const FIELD_HALF = 3200, FIELD_CELL = 10;
const FN = FIELD_HALF * 2 / FIELD_CELL + 1;
let field: Float32Array | null = null;

function buildField(): Float32Array {
  const f = new Float32Array(FN * FN);
  for (let j = 0; j < FN; j++) {
    const z = -FIELD_HALF + j * FIELD_CELL;
    for (let i = 0; i < FN; i++) {
      const x = -FIELD_HALF + i * FIELD_CELL;
      f[j * FN + i] = outerWeight(x, z) > 0 ? outerH(x, z) : 0;
    }
  }
  return f;
}

function fieldH(x: number, z: number): number {
  const f = field ?? (field = buildField());
  const gx = clamp((x + FIELD_HALF) / FIELD_CELL, 0, FN - 1.0001), gz = clamp((z + FIELD_HALF) / FIELD_CELL, 0, FN - 1.0001);
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j, o = j * FN + i;
  return lerp(lerp(f[o], f[o + 1], u), lerp(f[o + FN], f[o + FN + 1], u), v);
}

function outerWeight(x: number, z: number): number {
  return smooth(CORE.r, CORE.blend, Math.hypot(x - CORE.x, z - CORE.z));
}

/** Terrain height: the original map in the core, rugged hills, valleys and the river gorge outside it. */
export function terrainH(x: number, z: number): number {
  const w = outerWeight(x, z);
  const c = w < 1 ? coreH(x, z) : 0;
  return w > 0 ? lerp(c, fieldH(x, z), w) : c;
}

/** True where the river covers the ground. */
export function isWater(x: number, z: number): boolean {
  return terrainH(x, z) < WATER_Y;
}
