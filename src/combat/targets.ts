import { Quaternion, Vector3 } from 'three';
import type { Layout, Road } from '../world/layout';
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
  /** A truck driving a road: there and back at `speed`, starting `phase` metres along it. */
  road?: Road; speed?: number;
}

export const TARGET_ID_BASE = 10000;
const Y = new Vector3(0, 1, 0);

/** Six parked trucks round the town edge and Hilltop, three drones flying figure-8s, and four trucks driving the roads out of Base. */
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
  const convoys: [string, number][] = [['East road', 300], ['East road', 1300], ['West road', 800], ['South road', 500]];
  for (const [name, phase] of convoys) {
    const road = layout.roads.find(r => r.name === name);
    if (!road) continue;
    out.push({ id: TARGET_ID_BASE + out.length, kind: 'ground', hp: combatParams.targets.groundHp, alive: true, respawnIn: 0,
      pos: new Vector3(), q: new Quaternion(), vel: new Vector3(), heading: 0, cx: 0, cz: 0, alt: 0, phase, size: 3, road, speed: 11 });
  }
  for (const t of out) placeTarget(t, 0);
  return out;
}

/** Puts a moving target where it is at `time`: drones on their figure-8, trucks along their road. Parked trucks stay put. */
export function placeTarget(t: PracticeTarget, time: number): void {
  if (t.kind === 'drone') placeDrone(t, time);
  else if (t.road && t.alive) placeTruck(t, t.road, time);            // a wreck stays where it burned
}

/** Trucks drive a road end to end and back (about 40 km/h), a pure function of time like the drones. */
function placeTruck(t: PracticeTarget, road: Road, time: number): void {
  const L = road.length, speed = t.speed ?? 11;
  const u = ((t.phase + time * speed) % (2 * L) + 2 * L) % (2 * L);
  const back = u > L, s = back ? 2 * L - u : u;
  const pts = road.pts;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s <= s) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], f = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
  t.pos.set(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f + 1.3, a.z + (b.z - a.z) * f);
  const len = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) || 1, dir = back ? -1 : 1;
  t.vel.set(((b.x - a.x) / len) * speed * dir, ((b.y - a.y) / len) * speed * dir, ((b.z - a.z) / len) * speed * dir);
  t.heading = Math.atan2(-t.vel.x, -t.vel.z);                // the model's cab faces -z
  t.q.setFromAxisAngle(Y, t.heading);
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
