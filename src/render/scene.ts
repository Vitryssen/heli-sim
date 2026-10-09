import * as THREE from 'three';

export const HORIZON = new THREE.Color('#b9cfdc');
export const SUN_DIR = new THREE.Vector3(-0.45, 1, 0.35).normalize();

export interface SceneKit {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  sky: THREE.Mesh;
  sun: THREE.DirectionalLight;
}

export function createScene(container: HTMLElement): SceneKit {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(HORIZON, 380, 1800);
  const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 5000);

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(3500, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { top: { value: new THREE.Color('#4f84b6') }, hor: { value: HORIZON } },
      vertexShader: 'varying vec3 vP;void main(){vP=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
      fragmentShader: 'uniform vec3 top;uniform vec3 hor;varying vec3 vP;void main(){float h=normalize(vP).y;gl_FragColor=vec4(mix(hor,top,pow(clamp(h,0.,1.),.5)),1.);\n#include <colorspace_fragment>\n}',
    }),
  );
  scene.add(sky);

  // three ≥ r155 uses physical light units; ×π keeps the prototype's look
  scene.add(new THREE.HemisphereLight(0xd6e8f4, 0x5d6b3c, 0.8 * Math.PI));
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
  return { renderer, scene, camera, sky, sun };
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
