/** What the flight model needs to know about the world. */
export interface WorldQuery {
  terrainH(x: number, z: number): number;
  /** Height of the surface a skid at height y would rest on (terrain, pad, roof or prop). Water is not a surface. */
  groundAt(x: number, z: number, y: number): number;
  /** True if the point is inside terrain, a building, a prop, a pad or a tree. */
  solidAt(x: number, y: number, z: number): boolean;
  /** The water surface height at (x, z), or null where there is no water. */
  water(x: number, z: number): number | null;
  /** Distance along a unit direction to the first terrain, water, building, prop, pad or tree surface, or null within maxDist. */
  raycast(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxDist: number): number | null;
}
