import { Quaternion, Vector3 } from 'three';
import type { Layout } from '../world/layout';
import { TOWN, terrainH } from '../world/terrain';
import { combatParams } from './params';

export type TargetKind = 'drone' | 'ground';

export interface PracticeTarget {
  id: number;
  kind: TargetKind;
  hp: number;
  alive: boolean;
  respawnIn: number;
  pos: Vector3;
  q: Quaternion;
  vel: Vector3;
  heading: number;
  /** drone path parameters / ground placement */
  cx: number; cz: number; alt: number; phase: number; size: number;
}

export const TARGET_ID_BASE = 10000;
const Y = new Vector3(0, 1, 0);

/** Six ground targets around the town edge and Hilltop, and three drones flying figure-8s. */
export function createTargets(layout: Layout): PracticeTarget[] {
  const out: PracticeTarget[] = [];
  const ground: [number, number, number][] = [
    [TOWN.x - 150, TOWN.z + 60, 0.4], [TOWN.x + 150, TOWN.z - 40, 2.1], [TOWN.x - 30, TOWN.z + 170, 1.2],
    [TOWN.x + 90, TOWN.z + 150, 2.8], [layout.pads[2].x - 40, layout.pads[2].z + 25, 0.9], [layout.pads[2].x + 35, layout.pads[2].z - 30, 2.4],
  ];
  for (const [x, z, h] of ground) {
    out.push({ id: TARGET_ID_BASE + out.length, kind: 'ground', hp: combatParams.targets.groundHp, alive: true, respawnIn: 0,
      pos: new Vector3(x, terrainH(x, z) + 1.3, z), q: new Quaternion().setFromAxisAngle(Y, h), vel: new Vector3(), heading: h,
      cx: x, cz: z, alt: 0, phase: 0, size: 3 });
  }
  const drones: [number, number, number, number][] = [[-250, -350, 60, 0], [600, -150, 80, 2], [-150, 300, 55, 4]];
  for (const [cx, cz, alt, phase] of drones) {
    out.push({ id: TARGET_ID_BASE + out.length, kind: 'drone', hp: combatParams.targets.droneHp, alive: true, respawnIn: 0,
      pos: new Vector3(), q: new Quaternion(), vel: new Vector3(), heading: 0, cx, cz, alt, phase, size: 1.6 });
  }
  for (const t of out) if (t.kind === 'drone') placeDrone(t, 0);
  return out;
}

/** Drones fly a slow figure-8 (about 30 m/s) that is a pure function of time, so clients can draw it without data. */
export function placeDrone(t: PracticeTarget, time: number): void {
  const w = 0.12, a = time * w + t.phase;
  const x = t.cx + 160 * Math.sin(a), z = t.cz + 80 * Math.sin(2 * a);
  const vx = 160 * w * Math.cos(a), vz = 160 * w * Math.cos(2 * a) * 2;
  const ground = Math.max(terrainH(x, z), 0);
  t.pos.set(x, ground + t.alt + 4 * Math.sin(a * 3), z);
  t.vel.set(vx, 12 * w * Math.cos(a * 3), vz);
  t.heading = Math.atan2(vx, -vz);
  t.q.setFromAxisAngle(Y, -t.heading);
}
