import { smooth } from '../sim/math';

export const TOWN = { x: 240, z: -330 };
export const ELEVATION = 85;   // base pad elevation above sea level, m

const HILLS = [
  { x: 420, z: 150, r: 190, h: 62 }, { x: -380, z: -180, r: 150, h: 40 }, { x: -200, z: 480, r: 200, h: 34 },
  { x: 60, z: -780, r: 260, h: 85 }, { x: 720, z: -520, r: 220, h: 50 }, { x: -760, z: 300, r: 260, h: 72 },
  { x: 900, z: 520, r: 300, h: 95 },
];

/** Terrain height: gaussian hills plus gentle undulation, flattened around Base and the town. */
export function terrainH(x: number, z: number): number {
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
