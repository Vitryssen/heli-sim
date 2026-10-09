import * as THREE from 'three';
import { HUB, ROTOR_RADIUS } from '../sim/geometry';

export interface HeliModel {
  root: THREE.Group;
  rotorTilt: THREE.Group;
  mainRotor: THREE.Group;
  tailRotor: THREE.Group;
  disc: THREE.Mesh<THREE.CircleGeometry, THREE.MeshBasicMaterial>;
  /** Minigun barrel clusters; spin them about z while firing. */
  guns: THREE.Group[];
  /** Missiles on the rails, outermost first; hide them as they are fired. */
  missiles: THREE.Mesh[];
}

/** MH-6-style egg fuselage, tail boom, T-tail, skids, six-blade main rotor, gun pods and missile rails. */
export function buildHeliModel(scene: THREE.Scene, opts: { bodyColor?: number; weapons?: boolean } = {}): HeliModel {
  const root = new THREE.Group();
  const body = new THREE.MeshPhongMaterial({ color: opts.bodyColor ?? 0x2c3137, shininess: 45, specular: 0x3a434b });
  const dark = new THREE.MeshPhongMaterial({ color: 0x1b1e22, shininess: 20 });
  const metal = new THREE.MeshPhongMaterial({ color: 0x7f878e, shininess: 60 });
  const glass = new THREE.MeshPhongMaterial({ color: 0x1c3a4e, shininess: 120, specular: 0xa8c6d8, transparent: true, opacity: 0.62 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = root) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z); m.castShadow = true; parent.add(m);
    return m;
  };
  const tube = (a: THREE.Vector3, b: THREE.Vector3, r1: number, r2: number, mat: THREE.Material) => {
    const m = add(new THREE.CylinderGeometry(r2, r1, a.distanceTo(b), 10), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  };
  const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

  add(new THREE.SphereGeometry(1, 32, 20), body, 0, 0, 0).scale.set(0.78, 0.82, 1.35);
  const can = add(new THREE.SphereGeometry(1, 32, 20, Math.PI + 0.35, Math.PI - 0.7, 0.18 * Math.PI, 0.52 * Math.PI), glass, 0, 0, 0);
  can.scale.set(0.8, 0.84, 1.37); can.castShadow = false;
  add(new THREE.SphereGeometry(1, 20, 12), body, 0, 0.72, 0.55).scale.set(0.42, 0.32, 0.75);
  add(new THREE.CylinderGeometry(0.07, 0.09, 0.55, 10), metal, 0, 1.25, 0.05);
  tube(V(0, 0.2, 1.0), V(0, 0.42, 5.4), 0.24, 0.11, body);
  add(new THREE.BoxGeometry(1.7, 0.05, 0.42), dark, 0, 0.42, 4.95);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.05, 0.55, 0.4), dark, s * 0.85, 0.5, 5.0);
  add(new THREE.BoxGeometry(0.06, 0.9, 0.55), dark, 0, 0.85, 5.25).rotation.x = 0.35;
  add(new THREE.BoxGeometry(0.06, 0.5, 0.4), dark, 0, 0.08, 5.3).rotation.x = -0.35;
  for (const s of [-1, 1]) {
    tube(V(s * 0.95, -1.25, -1.45), V(s * 0.95, -1.25, 1.5), 0.045, 0.045, metal);
    tube(V(s * 0.95, -1.25, -1.45), V(s * 0.95, -1.05, -1.78), 0.045, 0.045, metal);
    tube(V(s * 0.95, -1.25, -0.7), V(s * 0.48, -0.55, -0.55), 0.045, 0.045, metal);
    tube(V(s * 0.95, -1.25, 0.8), V(s * 0.48, -0.55, 0.65), 0.045, 0.045, metal);
  }

  const rotorTilt = new THREE.Group(); rotorTilt.position.copy(HUB); root.add(rotorTilt);
  const mainRotor = new THREE.Group(); rotorTilt.add(mainRotor);
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.14, 12), metal, 0, 0, 0, mainRotor);
  const bladeGeo = new THREE.BoxGeometry(ROTOR_RADIUS - 0.15, 0.035, 0.2).translate((ROTOR_RADIUS - 0.15) / 2 + 0.15, 0, 0);
  for (let k = 0; k < 6; k++) add(bladeGeo, dark, 0, 0, 0, mainRotor).rotation.y = (k * Math.PI) / 3;
  const disc = new THREE.Mesh(new THREE.CircleGeometry(ROTOR_RADIUS, 48).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0x15191d, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide }));
  rotorTilt.add(disc);

  const tailRotor = new THREE.Group(); tailRotor.position.set(-0.16, 0.6, 5.35); root.add(tailRotor);
  add(new THREE.BoxGeometry(0.03, 1.4, 0.11), dark, 0, 0, 0, tailRotor);
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.12, 8).rotateZ(Math.PI / 2), metal, 0.04, 0, 0, tailRotor);

  // weapons: a pylon through the cabin floor, an M134 pod on each end, two missiles under each pylon
  const guns: THREE.Group[] = [];
  const missiles: THREE.Mesh[] = [];
  if (opts.weapons !== false) {
    add(new THREE.BoxGeometry(2.5, 0.07, 0.32), dark, 0, -0.42, -0.4);
    const missileGeo = new THREE.CylinderGeometry(0.065, 0.065, 1.5, 10).rotateX(Math.PI / 2);
    const missileMat = new THREE.MeshPhongMaterial({ color: 0x8a8f7a, shininess: 30 });
    for (const s of [-1, 1]) {
      add(new THREE.CylinderGeometry(0.11, 0.11, 0.7, 12).rotateX(Math.PI / 2), dark, s * 1.15, -0.38, -0.3);   // pod body
      const barrels = new THREE.Group();
      barrels.position.set(s * 1.15, -0.38, -0.85);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        add(new THREE.CylinderGeometry(0.018, 0.018, 0.55, 6).rotateX(Math.PI / 2), metal, Math.cos(a) * 0.05, Math.sin(a) * 0.05, -0.1, barrels);
      }
      root.add(barrels);
      guns.push(barrels);
      add(new THREE.BoxGeometry(0.06, 0.1, 0.9), dark, s * 1.35, -0.5, -0.3);                                     // rail
      for (const dy of [0, -0.16]) missiles.push(add(missileGeo, missileMat, s * 1.35, -0.6 + dy, -0.3));
    }
  }

  scene.add(root);
  return { root, rotorTilt, mainRotor, tailRotor, disc, guns, missiles };
}
