import type { WorldQuery } from './query';
import { padSurface, toLocal, type Box, type Layout, type Pad, type Tree } from './layout';
import { isWater, terrainH, WATER_Y } from './terrain';

const CELL = 32, HALF = 3200, N = (HALF * 2) / CELL;

/** Objects bucketed by the grid cells their footprint touches, stored flat (CSR) to keep lookups allocation-free. */
class Grid {
  private start = new Int32Array(N * N + 1);
  private items: Int32Array;

  constructor(count: number, bounds: (i: number) => { x: number; z: number; r: number }) {
    const span = (i: number) => {
      const b = bounds(i);
      return [cellOf(b.x - b.r), cellOf(b.x + b.r), cellOf(b.z - b.r), cellOf(b.z + b.r)];
    };
    const counts = new Int32Array(N * N);
    for (let i = 0; i < count; i++) { const [x0, x1, z0, z1] = span(i); for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) counts[cz * N + cx]++; }
    for (let c = 0; c < N * N; c++) this.start[c + 1] = this.start[c] + counts[c];
    this.items = new Int32Array(this.start[N * N]);
    const fill = this.start.slice(0, N * N);
    for (let i = 0; i < count; i++) { const [x0, x1, z0, z1] = span(i); for (let cz = z0; cz <= z1; cz++) for (let cx = x0; cx <= x1; cx++) this.items[fill[cz * N + cx]++] = i; }
  }

  /** Highest `top(i)` of anything in each cell (-Infinity if empty), so rays passing above can skip it. */
  tops(top: (i: number) => number): Float32Array {
    const out = new Float32Array(N * N).fill(-Infinity);
    for (let c = 0; c < N * N; c++) for (let k = this.start[c]; k < this.start[c + 1]; k++) out[c] = Math.max(out[c], top(this.items[k]));
    return out;
  }

  /** Calls fn for every object in the cell; stops early if fn returns true. */
  each(cx: number, cz: number, fn: (i: number) => boolean | void): boolean {
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) return false;
    const c = cz * N + cx;
    for (let k = this.start[c]; k < this.start[c + 1]; k++) if (fn(this.items[k])) return true;
    return false;
  }
}

const cellOf = (v: number): number => Math.max(0, Math.min(N - 1, Math.floor((v + HALF) / CELL)));

function insideBox(b: Box, x: number, z: number, margin = 0): boolean {
  if (b.rot === 0) return Math.abs(x - b.x) < b.hw + margin && Math.abs(z - b.z) < b.hd + margin;
  const { lx, lz } = toLocal(b, x, z);
  return Math.abs(lx) < b.hw + margin && Math.abs(lz) < b.hd + margin;
}

/** Entry distance of a ray into a (turned) box, or null. A ray starting inside hits at 0. */
function rayBox(b: Box, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number | null {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  const rx = ox - b.x, rz = oz - b.z;
  const lox = rx * c - rz * s, loz = rx * s + rz * c, ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  let t0 = 0, t1 = maxT;
  const slab = (o: number, d: number, lo: number, hi: number): boolean => {
    if (Math.abs(d) < 1e-9) return o > lo && o < hi;
    let a = (lo - o) / d, b2 = (hi - o) / d;
    if (a > b2) { const tmp = a; a = b2; b2 = tmp; }
    t0 = Math.max(t0, a); t1 = Math.min(t1, b2);
    return t0 <= t1;
  };
  if (!slab(lox, ldx, -b.hw, b.hw) || !slab(loz, ldz, -b.hd, b.hd) || !slab(oy, dy, b.base, b.top)) return null;
  return t0;
}

/** Entry distance of a ray into a tree's vertical cylinder (ground to crown top), or null. */
function rayTree(t: Tree, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number): number | null {
  let t0 = 0, t1 = maxT;
  const rx = ox - t.x, rz = oz - t.z, a = dx * dx + dz * dz, b = rx * dx + rz * dz, c = rx * rx + rz * rz - t.r * t.r;
  if (a < 1e-12) { if (c > 0) return null; }
  else {
    const disc = b * b - a * c;
    if (disc < 0) return null;
    const q = Math.sqrt(disc);
    t0 = Math.max(t0, (-b - q) / a); t1 = Math.min(t1, (-b + q) / a);
  }
  if (Math.abs(dy) < 1e-9) { if (oy < t.y || oy > t.top) return null; }
  else {
    let ya = (t.y - oy) / dy, yb = (t.top - oy) / dy;
    if (ya > yb) { const tmp = ya; ya = yb; yb = tmp; }
    t0 = Math.max(t0, ya); t1 = Math.min(t1, yb);
  }
  return t0 <= t1 ? t0 : null;
}

const inPad = (p: Pad, x: number, z: number): boolean => (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r;

/**
 * Collision and ground queries over a layout. Pure data: no meshes, so tests and the server can use it.
 * Buildings, props and trees are found through a 32 m grid.
 */
export function createWorld(layout: Layout): WorldQuery {
  const { pads, trees } = layout;
  const boxes: Box[] = [...layout.buildings, ...layout.props];
  const boxGrid = new Grid(boxes.length, i => ({ x: boxes[i].x, z: boxes[i].z, r: Math.hypot(boxes[i].hw, boxes[i].hd) }));
  const treeGrid = new Grid(trees.length, i => ({ x: trees[i].x, z: trees[i].z, r: trees[i].r }));
  const boxSeen = new Int32Array(boxes.length), treeSeen = new Int32Array(trees.length);
  const boxTop = boxGrid.tops(i => boxes[i].top), treeTop = treeGrid.tops(i => trees[i].top);
  let stamp = 0;

  // highest terrain or pad in each cell, worked out the first time a ray needs it: 9 × 9 samples plus
  // a margin for what the steepest step between them could hide
  const groundTop = new Float32Array(N * N).fill(NaN);
  const groundCap = (x: number, z: number): number => {
    const cx = cellOf(x), cz = cellOf(z), c = cz * N + cx;
    let top = groundTop[c];
    if (top === top) return top;
    const x0 = -HALF + cx * CELL, z0 = -HALF + cz * CELL, S = 8, n = CELL / S + 1;
    let hi = -Infinity, steep = 0;
    const h: number[] = [];
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const v = terrainH(x0 + i * S, z0 + j * S);
      h.push(v); hi = Math.max(hi, v);
      if (i > 0) steep = Math.max(steep, Math.abs(v - h[h.length - 2]));
      if (j > 0) steep = Math.max(steep, Math.abs(v - h[h.length - 1 - n]));
    }
    top = hi + steep + 1;
    for (const p of pads) if (Math.abs(p.x - (x0 + CELL / 2)) < CELL / 2 + p.r && Math.abs(p.z - (z0 + CELL / 2)) < CELL / 2 + p.r) top = Math.max(top, p.top + p.r * 0.2);
    groundTop[c] = top;
    return top;
  };

  // terrain and pads, for the marching part of the raycast
  const hard = (x: number, y: number, z: number): boolean => {
    if (y > groundCap(x, z)) return false;
    if (y < terrainH(x, z)) return true;
    for (const p of pads) if (inPad(p, x, z)) { const top = padSurface(p, x, z); if (y < top && y > top - p.thick) return true; }
    return false;
  };

  const water = (x: number, z: number): number | null => (isWater(x, z) ? WATER_Y : null);

  return {
    terrainH,
    water,
    groundAt(x, z, y) {
      let g = terrainH(x, z);
      for (const p of pads) if (inPad(p, x, z)) { const top = padSurface(p, x, z); if (y > top - 2) g = Math.max(g, top); }
      boxGrid.each(cellOf(x), cellOf(z), i => {
        const b = boxes[i];
        if (y > b.top - 1.5 && b.top > g && insideBox(b, x, z)) g = b.top;
      });
      return g;
    },
    solidAt(x, y, z) {
      if (y < terrainH(x, z) - 0.05) return true;
      for (const p of pads) if (inPad(p, x, z)) { const top = padSurface(p, x, z); if (y < top - 0.05 && y > top - p.thick) return true; }
      const cx = cellOf(x), cz = cellOf(z);
      if (boxGrid.each(cx, cz, i => { const b = boxes[i]; return y < b.top - 0.02 && y > b.base && insideBox(b, x, z); })) return true;
      return treeGrid.each(cx, cz, i => { const t = trees[i]; return y < t.top && (x - t.x) ** 2 + (z - t.z) ** 2 < t.r * t.r; });
    },
    raycast(ox, oy, oz, dx, dy, dz, maxDist) {
      // terrain and pads: march in 6 m steps, then bisect the step that went solid
      let best = maxDist;
      const STEP = 6;
      let prev = 0;
      for (let d = STEP; prev < best; d += STEP) {
        const t = Math.min(d, best);
        if (hard(ox + dx * t, oy + dy * t, oz + dz * t)) {
          let lo = prev, hi = t;
          for (let i = 0; i < 8; i++) { const m = (lo + hi) / 2; if (hard(ox + dx * m, oy + dy * m, oz + dz * m)) hi = m; else lo = m; }
          best = hi;
          break;
        }
        prev = t;
      }
      // water: the plane, where the river is
      if (dy < 0 && oy > WATER_Y) {
        const t = (WATER_Y - oy) / dy;
        if (t < best && isWater(ox + dx * t, oz + dz * t)) best = t;
      }
      // boxes and trees: walk the grid cells the ray crosses, nearest first
      stamp++;
      let cx = cellOf(ox), cz = cellOf(oz);
      const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
      const tdx = Math.abs(dx) > 1e-9 ? CELL / Math.abs(dx) : Infinity, tdz = Math.abs(dz) > 1e-9 ? CELL / Math.abs(dz) : Infinity;
      const edgeX = -HALF + (cx + (sx > 0 ? 1 : 0)) * CELL, edgeZ = -HALF + (cz + (sz > 0 ? 1 : 0)) * CELL;
      let tmx = Math.abs(dx) > 1e-9 ? (edgeX - ox) / dx : Infinity, tmz = Math.abs(dz) > 1e-9 ? (edgeZ - oz) / dz : Infinity;
      let tCell = 0;
      const test = (i: number): void => {
        if (boxSeen[i] === stamp) return;
        boxSeen[i] = stamp;
        const t = rayBox(boxes[i], ox, oy, oz, dx, dy, dz, best);
        if (t !== null && t < best) best = t;
      };
      const testTree = (i: number): void => {
        if (treeSeen[i] === stamp) return;
        treeSeen[i] = stamp;
        const t = rayTree(trees[i], ox, oy, oz, dx, dy, dz, best);
        if (t !== null && t < best) best = t;
      };
      for (let guard = 0; guard < 4 * N && tCell <= best; guard++) {
        // the lowest the ray gets inside this cell; skip what it passes over
        const tOut = Math.min(tmx, tmz, best), low = Math.min(oy + dy * tCell, oy + dy * tOut), c = cz * N + cx;
        if (low < boxTop[c]) boxGrid.each(cx, cz, test);
        if (low < treeTop[c]) treeGrid.each(cx, cz, testTree);
        if (tmx < tmz) { tCell = tmx; tmx += tdx; cx += sx; } else { tCell = tmz; tmz += tdz; cz += sz; }
        if (cx < 0 || cz < 0 || cx >= N || cz >= N) break;
      }
      return best < maxDist ? best : null;
    },
  };
}
