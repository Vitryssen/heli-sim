import * as THREE from 'three';
import type { RemoteView } from '../net/client';
import { buildHeliModel, type HeliModel } from './heliModel';
import { canvasTexture } from './scene';
import { smooth } from '../sim/math';
import { params } from '../sim/params';

interface Remote { model: HeliModel; tag: THREE.Sprite; name: string; crashed: boolean }

/** Other players' helicopters with floating name tags. */
export class RemoteFleet {
  private remotes = new Map<number, Remote>();

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {}

  update(views: RemoteView[], dt: number): void {
    const seen = new Set<number>();
    for (const v of views) {
      seen.add(v.id);
      let r = this.remotes.get(v.id);
      if (!r) { r = { model: buildHeliModel(this.scene), tag: this.makeTag(v.name, false), name: v.name, crashed: false }; this.scene.add(r.tag); this.remotes.set(v.id, r); }
      if (r.name !== v.name || r.crashed !== v.crashed) this.retag(r, v.name, v.crashed);
      const rpm = v.omega / params.rotor.omegaNominal;
      r.model.root.position.copy(v.pos);
      r.model.root.quaternion.copy(v.q);
      r.model.mainRotor.rotation.y += rpm * 30 * dt;
      r.model.tailRotor.rotation.x += rpm * 70 * dt;
      r.model.disc.material.opacity = 0.14 * smooth(0.3, 0.9, rpm);
      r.tag.position.set(v.pos.x, v.pos.y + 3.2, v.pos.z);
    }
    for (const [id, r] of this.remotes) if (!seen.has(id)) { this.dispose(r); this.remotes.delete(id); }
  }

  clear(): void { for (const r of this.remotes.values()) this.dispose(r); this.remotes.clear(); }

  private makeTag(name: string, crashed: boolean): THREE.Sprite {
    const tex = canvasTexture(this.renderer, 256, 64, g => {
      g.font = '600 30px "Barlow Condensed", "Arial Narrow", sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const w = Math.min(250, g.measureText(name).width + 28);
      g.fillStyle = 'rgba(13,19,25,.72)';
      g.beginPath(); g.roundRect(128 - w / 2, 10, w, 44, 6); g.fill();
      g.fillStyle = crashed ? '#ff6b5e' : '#ffb547';
      g.fillText(name, 128, 33);
    });
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthWrite: false, fog: false }));
    sprite.scale.set(0.16, 0.04, 1);
    sprite.renderOrder = 10;
    return sprite;
  }

  private retag(r: Remote, name: string, crashed: boolean): void {
    this.scene.remove(r.tag);
    r.tag.material.map?.dispose(); r.tag.material.dispose();
    r.tag = this.makeTag(name, crashed); r.name = name; r.crashed = crashed;
    this.scene.add(r.tag);
  }

  private dispose(r: Remote): void {
    this.scene.remove(r.model.root, r.tag);
    r.model.root.traverse(o => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose()); } });
    r.tag.material.map?.dispose(); r.tag.material.dispose();
  }
}
