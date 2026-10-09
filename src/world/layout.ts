import { rng } from '../sim/math';
import { TOWN, terrainH } from './terrain';

export interface Pad { name: string; x: number; z: number; r: number; top: number; thick: number }
export interface Building { x: number; z: number; w: number; d: number; hw: number; hd: number; base: number; top: number; tint: number; windows: boolean }
export interface Tree { x: number; z: number; y: number; crownR: number; crownH: number; hue: number; sat: number; light: number; r: number; top: number }
export interface Layout { pads: Pad[]; buildings: Building[]; trees: Tree[] }

const TINTS = [0xffffff, 0xe8dccb, 0xd6dde4, 0xf1e6d0, 0xcfd4cc];

function building(x: number, z: number, w: number, d: number, h: number, tint: number, windows = true): Building {
  const gh = Math.min(terrainH(x - w / 2, z - d / 2), terrainH(x + w / 2, z + d / 2), terrainH(x, z));
  return { x, z, w, d, hw: w / 2, hd: d / 2, base: gh - 2, top: terrainH(x, z) + h, tint, windows };
}

/** The fixed, seeded map: three pads, a small town, a hangar and scattered trees. */
export function createLayout(): Layout {
  const pads: Pad[] = [], buildings: Building[] = [], trees: Tree[] = [];

  const r = rng(42);
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) {
    if (i === 0 && j === 0) continue;
    if (r() < 0.16) continue;
    const cx = TOWN.x + i * 48, cz = TOWN.z + j * 48;
    buildings.push(building(cx + (r() - 0.5) * 6, cz + (r() - 0.5) * 6, 16 + r() * 12, 16 + r() * 12, 7 + r() * 27, TINTS[(r() * TINTS.length) | 0]));
  }
  buildings.push(building(-48, 18, 26, 30, 9, 0xb7aa8c, false));             // hangar by Base

  pads.push({ name: 'Base', x: 0, z: 0, r: 9, top: 0.25, thick: 0.5 });
  const roof = building(TOWN.x, TOWN.z, 32, 32, 26, 0xdfe3e6);
  buildings.push(roof);
  pads.push({ name: 'Rooftop', x: TOWN.x, z: TOWN.z, r: 9, top: roof.top + 0.2, thick: 0.4 });
  {
    const hx = 420, hz = 150;
    let lo = Infinity, hi = -Infinity;
    for (let a = 0; a < 16; a++) for (const rr of [0, 5, 9.5]) {
      const h = terrainH(hx + Math.cos((a / 16) * 6.283) * rr, hz + Math.sin((a / 16) * 6.283) * rr);
      lo = Math.min(lo, h); hi = Math.max(hi, h);
    }
    pads.push({ name: 'Hilltop', x: hx, z: hz, r: 9, top: hi + 0.3, thick: hi + 0.3 - lo + 1.5 });
  }

  const t = rng(1234);
  while (trees.length < 340) {
    const a = t() * Math.PI * 2, d = 70 + Math.pow(t(), 0.7) * 1100, x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (Math.hypot(x - TOWN.x, z - TOWN.z) < 170) continue;
    if (pads.some(pd => Math.hypot(x - pd.x, z - pd.z) < 40)) continue;
    if (Math.hypot(x + 48, z - 18) < 40) continue;
    const y = terrainH(x, z), crownR = 1.8 + t() * 1.4, crownH = 6 + t() * 6;
    const hue = 0.27 + t() * 0.07, sat = 0.38 + t() * 0.15, light = 0.2 + t() * 0.1;
    trees.push({ x, z, y, crownR, crownH, hue, sat, light, r: crownR * 0.85, top: y + 1.8 + crownH * 0.9 });
  }
  return { pads, buildings, trees };
}
