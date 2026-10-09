import { Vector3 } from 'three';

/** Airframe geometry in body axes: x right, y up, z aft. Origin at the centre of mass. */
export const SKIDS: readonly Vector3[] = [
  new Vector3(-0.95, -1.25, -1.15), new Vector3(0.95, -1.25, -1.15),
  new Vector3(-0.95, -1.25, 1.15), new Vector3(0.95, -1.25, 1.15),
];
export const SKID_DROP = 1.25;
export const HUB = new Vector3(0, 1.55, 0.05);
export const ROTOR_RADIUS = 4.15;
export const COCKPIT_EYE = new Vector3(0.3, 0.3, -0.55);

export interface Probe { v: Vector3; kind: string }
export const PROBES: readonly Probe[] = [
  { v: new Vector3(0, -0.15, -1.4), kind: 'Nose strike' },
  { v: new Vector3(0, 0.42, 5.55), kind: 'Tail strike' },
  { v: new Vector3(-0.2, 0.6, 5.35), kind: 'Tail rotor strike' },
  ...Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2;
    return { v: new Vector3(HUB.x + Math.cos(a) * ROTOR_RADIUS, HUB.y, HUB.z + Math.sin(a) * ROTOR_RADIUS), kind: 'Rotor strike' };
  }),
];
