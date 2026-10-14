import * as THREE from 'three';
import type { SkyId } from '../world/sky';

export const HORIZON = new THREE.Color('#b9cfdc');

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
  hemi: THREE.HemisphereLight;
  /** Unit vector toward the sun; the shadow-casting light follows the aircraft along it. */
  sunDir: THREE.Vector3;
}

interface SkyLook {
  top: string; horizon: string; sunDir: [number, number, number]; sunColor: number; sun: number;
  hemiSky: number; hemiGround: number; hemi: number; fogNear: number; fogFar: number; glow: number;
}

// three ≥ r155 uses physical light units; ×π keeps the prototype's look
const LOOKS: Record<SkyId, SkyLook> = {
  noon: { top: '#4f84b6', horizon: '#b9cfdc', sunDir: [-0.45, 1, 0.35], sunColor: 0xfff1dc, sun: 0.95, hemiSky: 0xd6e8f4, hemiGround: 0x5d6b3c, hemi: 0.8, fogNear: 450, fogFar: 2500, glow: 0.25 },
  golden: { top: '#47699a', horizon: '#efc290', sunDir: [-0.86, 0.17, 0.48], sunColor: 0xffb46e, sun: 1.15, hemiSky: 0xb4c2da, hemiGround: 0x5b4a30, hemi: 0.5, fogNear: 350, fogFar: 2300, glow: 0.9 },
  overcast: { top: '#8c959c', horizon: '#adb4b9', sunDir: [-0.3, 1, 0.2], sunColor: 0xdfe4e8, sun: 0.22, hemiSky: 0xc9d1d8, hemiGround: 0x5f6656, hemi: 1.05, fogNear: 120, fogFar: 950, glow: 0 },
};

export function createScene(container: HTMLElement): SceneKit {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON.clone(), 450, 2500);
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 6000);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(4500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: {
        top: { value: new THREE.Color('#4f84b6') }, hor: { value: HORIZON.clone() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xffffff) }, glow: { value: 0 },
      },
      vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: `uniform vec3 top;uniform vec3 hor;uniform vec3 sunDir;uniform vec3 sunCol;uniform float glow;varying vec3 vP;
        void main(){vec3 d=normalize(vP);float h=d.y;vec3 c=mix(hor,top,pow(clamp(h,0.,1.),.5));
        float s=max(dot(d,sunDir),0.);c+=sunCol*glow*(pow(s,8.)*.35+pow(s,300.)*1.2);
        gl_FragColor=vec4(c,1.);\n#include <colorspace_fragment>\n}`,
    }),
  );
  scene.add(sky);

  const hemi = new THREE.HemisphereLight(0xd6e8f4, 0x5d6b3c, 0.8 * Math.PI);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 0.95 * Math.PI);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 400 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });
  const kit: SceneKit = { renderer, scene, camera, sky, sun, hemi, sunDir: new THREE.Vector3() };
  applySky(kit, 'noon');
  return kit;
}

/** Sky colours, sun angle and colour, ambient light and fog for a time of day. */
export function applySky(kit: SceneKit, id: SkyId): void {
  const L = LOOKS[id];
  kit.sunDir.set(...L.sunDir).normalize();
  const u = (kit.sky.material as THREE.ShaderMaterial).uniforms;
  u.top.value.set(L.top); u.hor.value.set(L.horizon);
  u.sunDir.value.copy(kit.sunDir); u.sunCol.value.setHex(L.sunColor); u.glow.value = L.glow;
  kit.sun.color.setHex(L.sunColor); kit.sun.intensity = L.sun * Math.PI;
  kit.hemi.color.setHex(L.hemiSky); kit.hemi.groundColor.setHex(L.hemiGround); kit.hemi.intensity = L.hemi * Math.PI;
  const fog = kit.scene.fog as THREE.Fog;
  fog.color.set(L.horizon); fog.near = L.fogNear; fog.far = L.fogFar;
}

/** How far the world is drawn under a sky (beyond the fog there is nothing to see). */
export const fogFar = (kit: SceneKit): number => (kit.scene.fog as THREE.Fog).far;

/** Graphics quality: pixel density and shadow resolution here; terrain and tree detail in the world view. */
export function applyQuality(kit: SceneKit, high: boolean): void {
  kit.renderer.setPixelRatio(high ? Math.min(window.devicePixelRatio || 1, 2) : 1);
  kit.renderer.setSize(innerWidth, innerHeight);
  const size = high ? 2048 : 1024;
  if (kit.sun.shadow.mapSize.x !== size) {
    kit.sun.shadow.mapSize.set(size, size);
    kit.sun.shadow.map?.dispose();
    kit.sun.shadow.map = null;
  }
}

export function canvasTexture(renderer: THREE.WebGLRenderer, w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}
