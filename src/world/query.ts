/** What the flight model needs to know about the world. */
export interface WorldQuery {
  terrainH(x: number, z: number): number;
  /** Height of the surface a skid at height y would rest on (terrain, pad or roof). */
  groundAt(x: number, z: number, y: number): number;
  /** True if the point is inside terrain, a building, a pad or a tree. */
  solidAt(x: number, y: number, z: number): boolean;
  /** Narrow tree checks to the neighbourhood of (x, z) before calling solidAt. */
  focus(x: number, z: number): void;
}
