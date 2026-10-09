import * as THREE from 'three';
import type { TargetView } from '../combat/view';
import { buildHeliModel, type HeliModel } from './heliModel';
import type { Effects } from './effects';

interface Truck { group: THREE.Group; parts: THREE.Mesh[] }

/** Practice targets: olive trucks on the ground and sand-coloured drone helicopters. */
export class TargetModels {
  private trucks = new Map<number, Truck>();
  private drones = new Map<number, HeliModel>();
  private olive = new THREE.MeshLambertMaterial({ color: 0x5d6142 });
  private canvas = new THREE.MeshLambertMaterial({ color: 0x7a7556 });
  private tyre = new THREE.MeshLambertMaterial({ color: 0x1d1f20 });
  private charred = new THREE.MeshLambertMaterial({ color: 0x1f1d1b });

  constructor(private scene: THREE.Scene) {}

  update(list: TargetView[], dt: number, effects: Effects): void {
    for (const t of list) {
      if (t.kind === 'ground') {
        const truck = this.trucks.get(t.id) ?? this.buildTruck(t.id);
        truck.group.position.copy(t.pos).add(new THREE.Vector3(0, -1.3, 0));
        truck.group.quaternion.copy(t.q);
        for (const p of truck.parts) p.material = t.alive ? (p.userData.mat as THREE.Material) : this.charred;
        if (!t.alive) effects.burning(t.pos.x, t.pos.y, t.pos.z, dt);
      } else {
        let d = this.drones.get(t.id);
        if (!d) { d = buildHeliModel(this.scene, { bodyColor: 0xc9b26b, weapons: false }); this.drones.set(t.id, d); }
        d.root.visible = t.alive;
        d.root.position.copy(t.pos);
        d.root.quaternion.copy(t.q);
        d.mainRotor.rotation.y += 30 * dt;
        d.tailRotor.rotation.x += 70 * dt;
      }
    }
  }

  private buildTruck(id: number): Truck {
    const group = new THREE.Group();
    const parts: THREE.Mesh[] = [];
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(geo, mat);
      m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; m.userData.mat = mat;
      group.add(m); parts.push(m);
      return m;
    };
    add(new THREE.BoxGeometry(2.3, 1.1, 1.8), this.olive, 0, 1.35, -1.8);            // cab
    add(new THREE.BoxGeometry(2.4, 0.3, 5.6), this.olive, 0, 0.75, 0.2);              // chassis
    add(new THREE.BoxGeometry(2.4, 1.6, 3.6), this.canvas, 0, 1.75, 1.0);             // covered bed
    for (const z of [-1.9, 0.8, 2.1]) for (const x of [-1.1, 1.1]) add(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 12).rotateZ(Math.PI / 2), this.tyre, x, 0.5, z);
    this.scene.add(group);
    const t = { group, parts };
    this.trucks.set(id, t);
    return t;
  }
}
