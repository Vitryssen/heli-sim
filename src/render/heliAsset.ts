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
  return root;
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
