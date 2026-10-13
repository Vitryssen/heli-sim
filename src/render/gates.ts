import * as THREE from 'three';
import type { Tutorial } from '../tutorial/tutorial';

const Z = new THREE.Vector3(0, 0, 1), UP = new THREE.Vector3(0, 1, 0);

/**
 * Tutorial markers: rings to fly through (the next one bright and unfogged, later ones faint),
 * a ring and light beam over hover markers, and a ring around the pad to land on.
 */
export class GateMarkers {
  private rings: THREE.Mesh[] = [];
  private ringGeo = new THREE.TorusGeometry(1, 0.035, 8, 48);
  private next = new THREE.MeshBasicMaterial({ color: 0xffb547, fog: false, toneMapped: false });
  private later = new THREE.MeshBasicMaterial({ color: 0xe8eef2, transparent: true, opacity: 0.35, depthWrite: false });
  private ground: THREE.Mesh;
  private beam: THREE.Mesh;
  private t = 0;

  constructor(private scene: THREE.Scene) {
    this.ground = new THREE.Mesh(this.ringGeo, this.next);
    this.ground.quaternion.setFromUnitVectors(Z, UP);
    this.beam = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, 80, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffb547, transparent: true, opacity: 0.3, depthWrite: false, fog: false }));
    this.ground.visible = this.beam.visible = false;
    scene.add(this.ground, this.beam);
  }

  /** `at` is where the aircraft is drawn: the beam goes once you are over the spot, so it never runs through the cockpit. */
  update(tut: Tutorial, dt: number, at: THREE.Vector3): void {
    this.t += dt;
    const m = tut.markers();
    while (this.rings.length < m.gates.length) {
      const r = new THREE.Mesh(this.ringGeo, this.later);
      this.rings.push(r); this.scene.add(r);
    }
    this.rings.forEach((r, i) => {
      const g = m.gates[i];
      r.visible = !!g;
      if (!g) return;
      r.position.copy(g.pos);
      r.quaternion.setFromUnitVectors(Z, g.normal);
      const pulse = g.next ? 1 + Math.sin(this.t * 4) * 0.03 : 1;
      r.scale.set(g.r * pulse, g.r * pulse, 6);              // z only deepens the tube a little
      r.material = g.next ? this.next : this.later;
    });

    const spot = m.zone ? { x: m.zone.pos.x, y: m.zone.pos.y, z: m.zone.pos.z, r: m.zone.r } : m.pad ? { x: m.pad.x, y: m.pad.top, z: m.pad.z, r: m.pad.r + 1.5 } : null;
    this.ground.visible = !!spot;
    this.beam.visible = !!spot && Math.hypot(at.x - spot.x, at.z - spot.z) > spot.r + 4;
    if (spot) {
      this.ground.position.set(spot.x, spot.y + 0.3, spot.z);
      this.ground.scale.set(spot.r, spot.r, 6);
      this.beam.position.set(spot.x, spot.y + 40, spot.z);
    }
  }
}
