import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { HUB, SKID_DROP } from '../sim/geometry';
import url from '../assets/little-bird.glb?url';

/**
 * The AH-6 model: "Helicopters MH-6 Little Bird" by mario low poly (sketchfab.com/mariogpymario117),
 * CC BY 4.0. Rescaled, re-oriented, meshopt-compressed, and its glass simplified; see
 * src/assets/little-bird.LICENSE.txt.
 */
const SCALE = 0.9;                       // the model is ~10 % larger than a real MH-6 (8.3 m rotor)
export const MAIN_ROTOR = 'helice_1_3';  // node names after GLTFLoader's sanitising
export const TAIL_ROTOR = 'helice_2_2';

/** A flat display in body axes: centre, facing direction, size in metres. */
export interface ScreenSpot { center: THREE.Vector3; normal: THREE.Vector3; w: number; h: number }

/**
 * The model's cabin, measured in body axes after `prepare`: the pilot's eye in the right seat, and
 * the two large panel displays (right one in front of the pilot) that get the live pages.
 */
export const CABIN = {
  eye: new THREE.Vector3(0.37, 0.76, -0.8),
  pfd: { center: new THREE.Vector3(0.299, 0.408, -1.463), normal: new THREE.Vector3(0, 0.226, 0.974).normalize(), w: 0.172, h: 0.138 },
  eng: { center: new THREE.Vector3(-0.302, 0.408, -1.463), normal: new THREE.Vector3(0, 0.226, 0.974).normalize(), w: 0.172, h: 0.138 },
} satisfies { eye: THREE.Vector3; pfd: ScreenSpot; eng: ScreenSpot };

/** The palette swatch the model paints its (static) screens with, in texture UVs; dimmed so only the live pages glow. */
const SCREEN_SWATCH = { u0: 0.245, u1: 0.478, v0: 0.53, v1: 1 };

let asset: THREE.Group | null = null;

/** Loads and prepares the model once. Until (or unless) it succeeds, `heliAsset()` is null. */
export async function loadHeliAsset(): Promise<void> {
  const gltf = await new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
  asset = prepare(gltf.scene);
}

export const heliAsset = (): THREE.Group | null => asset;

/** Into body axes (x right, y up, nose toward -z, origin at the centre of mass): hub over the physics hub, skids on the skid plane. */
function prepare(model: THREE.Group): THREE.Group {
  model.rotation.y = Math.PI;
  model.scale.setScalar(SCALE);
  model.updateMatrixWorld(true);
  const hub = model.getObjectByName(MAIN_ROTOR)!.getWorldPosition(new THREE.Vector3());
  const box = new THREE.Box3().setFromObject(model);
  model.position.set(HUB.x - hub.x, -SKID_DROP - box.min.y, HUB.z - hub.z);

  // the glass uses KHR_materials_transmission, which re-renders the scene behind it; plain transparency is enough here
  const glass = new THREE.MeshStandardMaterial({ color: 0x9fb4c0, roughness: 0.1, metalness: 0, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide });
  model.traverse(o => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.castShadow = true;
    if ((m.material as THREE.Material).name === 'vidrio') { m.material = glass; m.castShadow = false; }
  });
  dimScreens(model);
  const root = new THREE.Group();
  root.add(model);
  root.updateMatrixWorld(true);
  rigControls(root);
  rigWeapons(root);
  return root;
}

/** Names of the control pivots `rigControls` adds (a suffix _L/_R per seat). */
export const CONTROL = { cyclic: 'ctl_cyclic', collective: 'ctl_collective', pedalL: 'ctl_pedalL', pedalR: 'ctl_pedalR' } as const;
/** Spinning minigun barrels (suffix _L/_R) and the missiles on the launchers, in the order they are fired from the end. */
export const GUN = 'wpn_gun', MISSILE = 'wpn_missile';
/** Where the model's minigun muzzles are, in body axes (tracers start here). */
export const MUZZLES: readonly [number, number, number][] = [[-0.945, -0.595, -1.01], [0.945, -0.595, -1.01]];

interface Piece { tris: number[]; box: THREE.Box3 }

/** The mesh drawn with material `name`, split into its connected pieces (boxes in `root`'s axes, i.e. body axes). */
function pieces(root: THREE.Group, name: string): { mesh: THREE.Mesh; pieces: Piece[] } | null {
  let found: THREE.Mesh | null = null;
  root.traverse(o => { const m = o as THREE.Mesh; if (m.isMesh && (m.material as THREE.Material).name === name) found = m; });
  const mesh = found as THREE.Mesh | null;
  if (!mesh?.geometry.index) return null;
  const pos = mesh.geometry.attributes.position, index = mesh.geometry.index;
  // weld vertices that share a position (UV seams split them), then union triangles
  const weld = new Map<string, number>(), vid = new Int32Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    const k = `${Math.round(pos.getX(i) * 1e4)},${Math.round(pos.getY(i) * 1e4)},${Math.round(pos.getZ(i) * 1e4)}`;
    if (!weld.has(k)) weld.set(k, weld.size);
    vid[i] = weld.get(k)!;
  }
  const parent = Array.from({ length: weld.size }, (_, i) => i);
  const find = (a: number): number => { while (parent[a] !== a) a = parent[a] = parent[parent[a]]; return a; };
  for (let t = 0; t < index.count; t += 3) {
    const a = find(vid[index.getX(t)]);
    parent[find(vid[index.getX(t + 1)])] = a;
    parent[find(vid[index.getX(t + 2)])] = a;
  }
  const out = new Map<number, Piece>(), v = new THREE.Vector3();
  root.updateMatrixWorld(true);
  for (let t = 0; t < index.count; t += 3) {
    const r = find(vid[index.getX(t)]);
    let p = out.get(r);
    if (!p) out.set(r, p = { tris: [], box: new THREE.Box3() });
    p.tris.push(t);
    for (let j = 0; j < 3; j++) p.box.expandByPoint(v.fromBufferAttribute(pos, index.getX(t + j)).applyMatrix4(mesh.matrixWorld));
  }
  return { mesh, pieces: [...out.values()] };
}

/** A geometry drawing only `tris` of `geo` (attributes shared). */
function subset(geo: THREE.BufferGeometry, tris: number[]): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry(), index = geo.index!;
  for (const [k, a] of Object.entries(geo.attributes)) g.setAttribute(k, a);
  g.setIndex(tris.flatMap(t => [index.getX(t), index.getX(t + 1), index.getX(t + 2)]));
  return g;
}

/**
 * Moves the pieces of `mesh` that `groups` names onto pivots under `root` (in body axes, so a plain
 * rotation or slide moves them) and leaves the rest of `keep` drawn by `mesh`.
 */
function hang(root: THREE.Group, mesh: THREE.Mesh, keep: number[], groups: Map<string, { piece: Piece; pivot: (b: THREE.Box3) => THREE.Vector3 }[]>): void {
  const geo = mesh.geometry;
  mesh.geometry = subset(geo, keep);
  for (const [name, list] of groups) {
    const box = new THREE.Box3(), tris: number[] = [];
    for (const { piece } of list) { box.union(piece.box); tris.push(...piece.tris); }
    const pivot = new THREE.Group();
    pivot.name = name;
    pivot.position.copy(list[0].pivot(box));
    pivot.userData.z0 = pivot.position.z;
    root.add(pivot);
    const part = new THREE.Mesh(subset(geo, tris), mesh.material);
    part.castShadow = mesh.castShadow;
    mesh.parent!.add(part);
    part.position.copy(mesh.position); part.quaternion.copy(mesh.quaternion); part.scale.copy(mesh.scale);
    root.updateMatrixWorld(true);
    pivot.attach(part);
  }
}

/**
 * The model's stick, collective and pedals are one static mesh. Pick out the moving pieces by where
 * they sit in the cabin (measured on this model, both seats): the cyclic pivots at its base, the
 * collective at its rear end, the pedals slide along the floor.
 */
function rigControls(root: THREE.Group): void {
  const found = pieces(root, 'controles');
  if (!found) return;
  const v = new THREE.Vector3();
  const base = (b: THREE.Box3) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, (b.min.z + b.max.z) / 2);
  const rear = (b: THREE.Box3) => new THREE.Vector3((b.min.x + b.max.x) / 2, b.min.y, b.max.z);
  const centre = (b: THREE.Box3) => b.getCenter(new THREE.Vector3());
  const groups = new Map<string, { piece: Piece; pivot: (b: THREE.Box3) => THREE.Vector3 }[]>(), keep: number[] = [];
  for (const piece of found.pieces) {
    const b = piece.box, c = b.getCenter(v), side = c.x > 0 ? 'R' : 'L', ax = Math.abs(c.x);
    let name: string | null = null, pivot = centre;
    if (c.z < -0.95 && c.z > -1.25 && ax > 0.25 && ax < 0.45 && c.y > -0.15) { name = CONTROL.cyclic; pivot = base; }
    else if (c.z < -0.9 && c.z > -1.25 && ax < 0.15 && c.y > -0.05) { name = CONTROL.collective; pivot = rear; }
    else if (c.z < -1.4 && c.z > -1.75 && c.y > -0.3 && c.y < -0.18 && b.max.y - b.min.y < 0.1 && b.max.z - b.min.z > 0.2) {
      name = c.x < Math.sign(c.x) * 0.395 ? CONTROL.pedalL : CONTROL.pedalR;     // each seat's pedal pair straddles its centre line
    }
    if (!name) { keep.push(...piece.tris); continue; }
    const key = `${name}_${side}`;
    groups.set(key, [...(groups.get(key) ?? []), { piece, pivot }]);
  }
  hang(root, found.mesh, keep, groups);
}

/**
 * Weapons: the six barrels of each minigun (and the clamps round them) go on a pivot along the
 * barrel axis so they can spin. The rocket pods come off; the game fires four lock-on missiles, so
 * each side gets a two-missile launcher in their place, close to where missiles launch from.
 */
function rigWeapons(root: THREE.Group): void {
  const found = pieces(root, 'armas');
  if (!found) return;
  const v = new THREE.Vector3();
  const axis = (b: THREE.Box3) => b.getCenter(new THREE.Vector3());
  const groups = new Map<string, { piece: Piece; pivot: (b: THREE.Box3) => THREE.Vector3 }[]>(), keep: number[] = [];
  for (const piece of found.pieces) {
    const c = piece.box.getCenter(v), ax = Math.abs(c.x);
    if (ax > 1.2 && ax < 1.7) continue;                                         // rocket pod and its rockets
    if (ax > 0.82 && ax < 1.08 && c.z < -0.3 && c.y > -0.75 && c.y < -0.45) {
      const key = `${GUN}_${c.x > 0 ? 'R' : 'L'}`;
      groups.set(key, [...(groups.get(key) ?? []), { piece, pivot: axis }]);
      continue;
    }
    keep.push(...piece.tris);
  }
  hang(root, found.mesh, keep, groups);

  const rail = new THREE.MeshStandardMaterial({ color: 0x1b1e22, roughness: 0.8 });
  const body = new THREE.MeshStandardMaterial({ color: 0x8a8f7a, roughness: 0.7 });
  const missileGeo = new THREE.CylinderGeometry(0.085, 0.085, 1.6, 12).rotateX(Math.PI / 2);
  const noseGeo = new THREE.SphereGeometry(0.085, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2).rotateX(-Math.PI / 2).translate(0, 0, -0.8);
  let n = 0;
  for (const s of [-1, 1]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.1, 1.1), rail);
    r.position.set(s * 1.42, -0.55, -0.1);
    r.userData.weapon = true; r.castShadow = true;
    root.add(r);
    for (const dy of [0, -0.19]) {
      const m = new THREE.Mesh(missileGeo, body);
      m.add(new THREE.Mesh(noseGeo, body));
      m.position.set(s * 1.42, -0.69 + dy, -0.1);
      m.name = `${MISSILE}_${n++}`;
      m.userData.weapon = true; m.castShadow = true;
      root.add(m);
    }
  }
}

/** Repaints the bright green screen swatch of the palette texture a dark, unlit display colour. */
function dimScreens(model: THREE.Group): void {
  const maps = new Set<THREE.Texture>();
  model.traverse(o => { const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined; if (m?.map) maps.add(m.map); });
  const first = [...maps][0], img = first?.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!img) return;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const sw = SCREEN_SWATCH;
  g.fillStyle = '#0b1a16';
  g.fillRect(sw.u0 * c.width, sw.v0 * c.height, (sw.u1 - sw.u0) * c.width, (sw.v1 - sw.v0) * c.height);
  for (const t of maps) { t.image = c; t.needsUpdate = true; }
}
