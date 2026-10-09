import * as THREE from 'three';
import type { Pad } from '../world/layout';

/** Amber light column and pulsing ring over the target pad. */
export class Beacon {
  private column = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 700, 16, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.22, depthWrite: false, fog: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
  private ring = new THREE.Mesh(new THREE.RingGeometry(9.7, 10.6, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));

  constructor(scene: THREE.Scene) { scene.add(this.column, this.ring); }

  update(pad: Pad, now: number): void {
    this.column.position.set(pad.x, pad.top + 350, pad.z);
    this.ring.position.set(pad.x, pad.top + 0.06, pad.z);
    this.ring.material.opacity = 0.45 + 0.4 * Math.sin(now * 0.004);
  }
}
