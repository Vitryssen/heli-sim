import type { WorldQuery } from './query';
import type { Layout, Tree } from './layout';
import { terrainH } from './terrain';

/** Collision and ground queries over a layout. Pure data: no meshes, so tests can use it. */
export function createWorld(layout: Layout): WorldQuery {
  const { pads, buildings, trees } = layout;
  let near: Tree[] = [];
  return {
    terrainH,
    groundAt(x, z, y) {
      let g = terrainH(x, z);
      for (const p of pads) if (y > p.top - 2 && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) g = Math.max(g, p.top);
      for (const b of buildings) if (y > b.top - 1.5 && Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd) g = Math.max(g, b.top);
      return g;
    },
    solidAt(x, y, z) {
      if (y < terrainH(x, z) - 0.05) return true;
      for (const b of buildings) if (y < b.top - 0.02 && y > b.base && Math.abs(x - b.x) < b.hw && Math.abs(z - b.z) < b.hd) return true;
      for (const p of pads) if (y < p.top - 0.05 && y > p.top - p.thick && (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r) return true;
      for (const t of near) if (y < t.top && (x - t.x) ** 2 + (z - t.z) ** 2 < t.r * t.r) return true;
      return false;
    },
    focus(x, z) {
      near = trees.filter(t => Math.abs(t.x - x) < 22 && Math.abs(t.z - z) < 22);
    },
  };
}
