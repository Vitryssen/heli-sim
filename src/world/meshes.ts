import * as THREE from 'three';
import type { Layout } from './layout';
import { terrainH } from './terrain';
import { canvasTexture } from '../render/scene';
import { lerp, rng, smooth } from '../sim/math';

const SIZE = 5000, SEG = 220;

/** Builds the visible world from the layout data. */
export function buildWorldMeshes(scene: THREE.Scene, renderer: THREE.WebGLRenderer, layout: Layout): void {
  // terrain
  const grass = canvasTexture(renderer, 256, 256, (g, w, h) => {
    g.fillStyle = '#6f8c4a'; g.fillRect(0, 0, w, h);
    const r = rng(7);
    for (let i = 0; i < 6000; i++) {
      g.fillStyle = r() < 0.5 ? `rgba(46,72,28,${0.08 + r() * 0.14})` : `rgba(170,186,110,${0.06 + r() * 0.12})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 3, 1 + r() * 3);
    }
    g.strokeStyle = 'rgba(52,72,30,.28)'; g.lineWidth = 2; g.strokeRect(0, 0, w, h);
  });
  grass.wrapS = grass.wrapT = THREE.RepeatWrapping;
  grass.repeat.set(SIZE / 30, SIZE / 30);
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG).rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute, col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), h = terrainH(x, z);
    pos.setY(i, h);
    const n = 0.86 + 0.14 * Math.sin(x * 0.006 + Math.cos(z * 0.008) * 2.2) * Math.cos(z * 0.005 - x * 0.002);
    const dry = smooth(25, 80, h);
    col[i * 3] = n * lerp(1, 1.18, dry); col[i * 3 + 1] = n * lerp(1, 1.02, dry); col[i * 3 + 2] = n * lerp(1, 0.86, dry);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ map: grass, vertexColors: true }));
  ground.receiveShadow = true;
  scene.add(ground);
  const apron = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x6c7175, polygonOffset: true, polygonOffsetFactor: -2 }));
  apron.position.y = 0.03; apron.receiveShadow = true;
  scene.add(apron);

  // buildings
  const wallTex = canvasTexture(renderer, 64, 64, g => {
    g.fillStyle = '#c9c3b8'; g.fillRect(0, 0, 64, 64);
    g.fillStyle = '#3d4d5a'; g.fillRect(10, 14, 44, 30);
    g.fillStyle = 'rgba(255,255,255,.12)'; g.fillRect(10, 14, 44, 6);
  });
  wallTex.wrapS = wallTex.wrapT = THREE.RepeatWrapping;
  const roofMat = new THREE.MeshLambertMaterial({ color: 0x77797a });
  for (const b of layout.buildings) {
    let side: THREE.Material;
    if (b.windows) {
      const t = wallTex.clone(); t.needsUpdate = true;
      t.repeat.set(Math.max(1, Math.round(b.w / 4)), Math.max(1, Math.round((b.top - b.base) / 3.6)));
      side = new THREE.MeshLambertMaterial({ map: t, color: b.tint });
    } else side = new THREE.MeshLambertMaterial({ color: b.tint });
    const m = new THREE.Mesh(new THREE.BoxGeometry(b.w, b.top - b.base, b.d), [side, side, roofMat, roofMat, side, side]);
    m.position.set(b.x, (b.top + b.base) / 2, b.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
  }

  // pads
  const padTop = canvasTexture(renderer, 256, 256, g => {
    g.fillStyle = '#7d8185'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#3a3e43'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f2c230'; g.lineWidth = 9; g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f4f4f0'; g.fillRect(84, 70, 20, 116); g.fillRect(152, 70, 20, 116); g.fillRect(104, 118, 48, 20);
  });
  const padSide = new THREE.MeshLambertMaterial({ color: 0x6d7175 });
  const padTopMat = new THREE.MeshLambertMaterial({ map: padTop });
  for (const p of layout.pads) {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(9, 9.4, p.thick, 48), [padSide, padTopMat, padSide]);
    m.position.set(p.x, p.top - p.thick / 2, p.z);
    m.receiveShadow = m.castShadow = true;
    scene.add(m);
  }

  // trees
  const N = layout.trees.length;
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.32, 1, 6).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0x5b4632 }), N);
  const crowns = new THREE.InstancedMesh(new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0), new THREE.MeshLambertMaterial({ color: 0xffffff }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color();
  layout.trees.forEach((t, i) => {
    trunks.setMatrixAt(i, m.compose(p.set(t.x, t.y, t.z), q, s.set(1, 2.2, 1)));
    crowns.setMatrixAt(i, m.compose(p.set(t.x, t.y + 1.8, t.z), q, s.set(t.crownR, t.crownH, t.crownR)));
    crowns.setColorAt(i, c.setHSL(t.hue, t.sat, t.light));
  });
  trunks.castShadow = crowns.castShadow = true;
  crowns.receiveShadow = true;
  scene.add(trunks, crowns);
}
