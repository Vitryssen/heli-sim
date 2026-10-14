import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildBuildings, roofKitGeometry } from './detail';
import { MAST_H, PYLON_H, ROOF_KIT, type Layout, type Pad, type Prop, type PropKind, type Road, type Tree } from './layout';
import { terrainH, WATER_Y } from './terrain';
import { canvasTexture } from '../render/scene';
import { clamp, lerp, rng, smooth } from '../sim/math';

const HALF = 3200, TILE = 640, NT = (HALF * 2) / TILE;
const LOD_SEGS = [64, 32, 16];                       // 10 m, 20 m and 40 m between vertices
const SKIRT = 18;                                    // m: tile edges hang down this far to hide cracks between detail levels

interface Quality { near: number; mid: number; trees: number; treeShadows: boolean }
const QUALITY: Record<'high' | 'low', Quality> = {
  high: { near: 1000, mid: 2000, trees: 1900, treeShadows: true },
  low: { near: 600, mid: 1300, trees: 1150, treeShadows: false },
};

/** The drawn world. `update` picks terrain detail and hides far tiles each frame. */
export interface WorldView {
  update(camera: THREE.Camera, viewDist: number, time: number): void;
  setQuality(high: boolean): void;
}

/** Builds the visible world from the layout data. */
export function buildWorldMeshes(scene: THREE.Scene, renderer: THREE.WebGLRenderer, layout: Layout): WorldView {
  let q = QUALITY.high;

  // ---------------------------------------------------------------- terrain
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
  const groundMat = new THREE.MeshLambertMaterial({ map: grass, vertexColors: true });
  const tiles: { cx: number; cz: number; group: THREE.Group; levels: (THREE.Group | null)[]; level: number }[] = [];
  for (let j = 0; j < NT; j++) for (let i = 0; i < NT; i++) {
    const group = new THREE.Group();
    const cx = -HALF + (i + 0.5) * TILE, cz = -HALF + (j + 0.5) * TILE;
    group.position.set(cx, 0, cz);
    scene.add(group);
    tiles.push({ cx, cz, group, levels: [null, null, null], level: -1 });
  }

  const apron = new THREE.Mesh(new THREE.PlaneGeometry(80, 80).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: 0x6c7175, polygonOffset: true, polygonOffsetFactor: -2 }));
  apron.position.y = 0.03; apron.receiveShadow = true;
  scene.add(apron);

  // ---------------------------------------------------------------- water
  const ripples = canvasTexture(renderer, 128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    const r = rng(11);
    for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(150,180,190,${0.15 + r() * 0.25})`; g.fillRect(r() * w, r() * h, 4 + r() * 14, 1 + r() * 1.5); }
  });
  ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
  ripples.repeat.set(HALF / 12, HALF / 12);
  const water = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2).rotateX(-Math.PI / 2),
    new THREE.MeshPhongMaterial({ color: 0x46707c, map: ripples, specular: 0x8aa4ae, shininess: 70, transparent: true, opacity: 0.9 }));
  water.position.y = WATER_Y;
  water.receiveShadow = true;
  scene.add(water);

  // ---------------------------------------------------------------- roads
  // the same asphalt with and without markings; the bare one is laid over junctions
  const asphalt = (markings: boolean) => {
    const t = canvasTexture(renderer, 64, 128, (g, w, h) => {
      g.fillStyle = '#5d6063'; g.fillRect(0, 0, w, h);
      const r = rng(3);
      for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '30,32,34' : '140,140,136'},${0.1 + r() * 0.15})`; g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2); }
      if (!markings) return;
      g.fillStyle = 'rgba(232,226,200,.85)'; g.fillRect(3, 0, 2, h); g.fillRect(w - 5, 0, 2, h);
      g.fillStyle = 'rgba(240,206,90,.85)'; g.fillRect(w / 2 - 1, 0, 2, h * 0.55);
    });
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    return new THREE.MeshLambertMaterial({ map: t, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  };
  const roadMats = [asphalt(true), asphalt(false)];
  const roadPieces = roadSegmentsByTile(layout);

  // ---------------------------------------------------------------- buildings
  buildBuildings(scene, renderer, layout);

  // ---------------------------------------------------------------- props
  const unitBox = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0);
  const PROP_LOOK: Partial<Record<PropKind, { geo: THREE.BufferGeometry; color: number }>> = {
    sandbag: { geo: unitBox, color: 0xa3946b },
    bladder: { geo: new THREE.CylinderGeometry(0.5, 0.5, 1, 12).rotateZ(Math.PI / 2).translate(0, 0.5, 0), color: 0x2f3427 },
    // a ridge tent: a triangular prism along x, apex up, scaled to a unit footprint
    tent: { geo: new THREE.CylinderGeometry(1, 1, 1, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).translate(0, 0.5, 0).scale(1, 1 / 1.5, 1 / Math.sqrt(3)), color: 0x6b6a49 },
    deck: { geo: unitBox, color: 0x8a8c8d },
    pier: { geo: unitBox, color: 0x7b7e80 },
    transformer: { geo: unitBox, color: 0x5d6a62 },
    fence: { geo: unitBox, color: 0xa7adb1 },
  };
  const byKind = new Map<PropKind, Prop[]>();
  for (const p of layout.props) byKind.set(p.kind, [...(byKind.get(p.kind) ?? []), p]);
  const mtx = new THREE.Matrix4(), quat = new THREE.Quaternion(), scl = new THREE.Vector3(), at = new THREE.Vector3(), Y = new THREE.Vector3(0, 1, 0);
  // rooftop kit: modelled to size, so only placed and turned
  for (const kind of Object.keys(ROOF_KIT) as (keyof typeof ROOF_KIT)[]) {
    const list = byKind.get(kind) ?? [];
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(roofKitGeometry(kind), new THREE.MeshLambertMaterial({ vertexColors: true }), list.length);
    list.forEach((p, i) => im.setMatrixAt(i, mtx.compose(at.set(p.x, p.base + 0.1, p.z), quat.setFromAxisAngle(Y, p.rot), scl.set(1, 1, 1))));
    im.castShadow = im.receiveShadow = true;
    scene.add(im);
  }
  for (const [kind, list] of byKind) {
    const look = PROP_LOOK[kind];
    if (!look) continue;
    const im = new THREE.InstancedMesh(look.geo, new THREE.MeshLambertMaterial({ color: look.color }), list.length);
    list.forEach((p, i) => {
      quat.setFromAxisAngle(Y, p.rot);
      im.setMatrixAt(i, mtx.compose(at.set(p.x, p.base, p.z), quat, scl.set(p.hw * 2, p.top - p.base, p.hd * 2)));
    });
    im.castShadow = im.receiveShadow = true;
    scene.add(im);
  }

  // pylons: steel lattice towers, wires sagging between them (wires are only drawn)
  const steel = new THREE.MeshLambertMaterial({ color: 0x8e9396 });
  const pylonGeo = latticeTower(PYLON_H, 2.4, 0.8, 5);
  const pylons = layout.powerLines.flatMap(l => l.pylons);
  const pim = new THREE.InstancedMesh(pylonGeo, steel, pylons.length);
  pylons.forEach((p, i) => pim.setMatrixAt(i, mtx.compose(at.set(p.x, p.y - 0.5, p.z), quat.setFromAxisAngle(Y, p.rot), scl.set(1, 1, 1))));
  pim.castShadow = true;
  scene.add(pim);
  const wire: number[] = [];
  const attach = (p: { x: number; y: number; z: number; rot: number }, oz: number, h: number) => {
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    return new THREE.Vector3(p.x + oz * s, p.y - 0.5 + h, p.z + oz * c);
  };
  for (const l of layout.powerLines) for (let i = 0; i + 1 < l.pylons.length; i++) {
    for (const [oz, h] of [[-5, PYLON_H - 3.5], [5, PYLON_H - 3.5], [0, PYLON_H]] as const) {
      const a = attach(l.pylons[i], oz, h), b = attach(l.pylons[i + 1], oz, h);
      const sag = a.distanceTo(b) * 0.035;
      let prev = a;
      for (let k = 1; k <= 16; k++) {
        const f = k / 16, p = a.clone().lerp(b, f);
        p.y -= sag * 4 * f * (1 - f);
        wire.push(prev.x, prev.y, prev.z, p.x, p.y, p.z);
        prev = p;
      }
    }
  }
  const wireGeo = new THREE.BufferGeometry();
  wireGeo.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
  scene.add(new THREE.LineSegments(wireGeo, new THREE.LineBasicMaterial({ color: 0x2b2e31 })));

  // radio mast: a slim lattice with guy wires and a blinking red light on top
  const mast = layout.props.find(p => p.kind === 'mast');
  let beacon: THREE.Sprite | null = null;
  if (mast) {
    const m = new THREE.Mesh(latticeTower(MAST_H, 0.9, 0.9, 0), new THREE.MeshLambertMaterial({ color: 0xc9cdd0 }));
    m.position.set(mast.x, mast.base + 1, mast.z);
    m.castShadow = true;
    scene.add(m);
    const guys: number[] = [];
    for (let k = 0; k < 3; k++) for (const h of [0.45, 0.8]) {
      const a = (k / 3) * Math.PI * 2 + 0.3, gx = mast.x + Math.cos(a) * 48, gz = mast.z + Math.sin(a) * 48;
      guys.push(mast.x, mast.base + 1 + MAST_H * h, mast.z, gx, terrainH(gx, gz), gz);
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute('position', new THREE.Float32BufferAttribute(guys, 3));
    scene.add(new THREE.LineSegments(gg, new THREE.LineBasicMaterial({ color: 0x55595c })));
    const glow = canvasTexture(renderer, 64, 64, g => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,90,70,1)'); gr.addColorStop(0.25, 'rgba(255,60,40,.6)'); gr.addColorStop(1, 'rgba(255,40,30,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    });
    beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
    beacon.position.set(mast.x, mast.base + 1 + MAST_H + 0.6, mast.z);
    beacon.scale.setScalar(7);
    scene.add(beacon);
  }

  // ---------------------------------------------------------------- pads
  const padTop = canvasTexture(renderer, 256, 256, g => {
    g.fillStyle = '#7d8185'; g.fillRect(0, 0, 256, 256);
    g.fillStyle = '#3a3e43'; g.beginPath(); g.arc(128, 128, 126, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#f2c230'; g.lineWidth = 9; g.beginPath(); g.arc(128, 128, 108, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#f4f4f0'; g.fillRect(84, 70, 20, 116); g.fillRect(152, 70, 20, 116); g.fillRect(104, 118, 48, 20);
  });
  const padSide = new THREE.MeshLambertMaterial({ color: 0x6d7175 });
  const padTopMat = new THREE.MeshLambertMaterial({ map: padTop });
  for (const p of layout.pads) scene.add(padMesh(p, padSide, padTopMat));

  // ---------------------------------------------------------------- trees, grouped by tile so far tiles can be skipped
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x5b4632 });
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1, 6).translate(0, 0.5, 0);
  const pineGeo = new THREE.ConeGeometry(1, 1, 7).translate(0, 0.5, 0);
  const broadGeo = new THREE.IcosahedronGeometry(1, 1).scale(1, 0.5, 1).translate(0, 0.5, 0);
  const forest: { cx: number; cz: number; meshes: THREE.InstancedMesh[] }[] = [];
  const buckets = new Map<number, Tree[]>();
  for (const t of layout.trees) {
    const i = clamp(Math.floor((t.x + HALF) / TILE), 0, NT - 1), j = clamp(Math.floor((t.z + HALF) / TILE), 0, NT - 1);
    const k = j * NT + i;
    let list = buckets.get(k);
    if (!list) buckets.set(k, (list = []));
    list.push(t);
  }
  const col = new THREE.Color();
  for (const [k, list] of buckets) {
    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, list.length);
    const pines = list.filter(t => t.kind === 'pine'), broads = list.filter(t => t.kind === 'broad');
    const meshes: THREE.InstancedMesh[] = [trunks];
    list.forEach((t, i) => trunks.setMatrixAt(i, mtx.compose(at.set(t.x, t.y, t.z), quat.identity(), scl.set(1, t.kind === 'pine' ? 2.2 : 2.8, 1))));
    for (const [group, geo, lift] of [[pines, pineGeo, 1.8], [broads, broadGeo, 2.4]] as const) {
      if (!group.length) continue;
      const crowns = new THREE.InstancedMesh(geo, crownMat, group.length);
      group.forEach((t, i) => {
        crowns.setMatrixAt(i, mtx.compose(at.set(t.x, t.y + lift, t.z), quat.setFromAxisAngle(Y, t.x * 0.37), scl.set(t.crownR, t.crownH, t.crownR)));
        crowns.setColorAt(i, col.setHSL(t.hue, t.sat, t.light));
      });
      crowns.receiveShadow = true;
      meshes.push(crowns);
    }
    for (const m of meshes) { m.computeBoundingSphere(); scene.add(m); }
    forest.push({ cx: -HALF + ((k % NT) + 0.5) * TILE, cz: -HALF + (Math.floor(k / NT) + 0.5) * TILE, meshes });
  }

  const rectDist = (x: number, z: number, cx: number, cz: number) => Math.hypot(Math.max(0, Math.abs(x - cx) - TILE / 2), Math.max(0, Math.abs(z - cz) - TILE / 2));
  const setTreeShadows = () => { for (const f of forest) for (const m of f.meshes) m.castShadow = q.treeShadows; };
  setTreeShadows();

  return {
    update(camera, viewDist, time) {
      const x = camera.position.x, z = camera.position.z;
      for (const t of tiles) {
        const d = rectDist(x, z, t.cx, t.cz);
        t.group.visible = d < viewDist + 400;
        if (!t.group.visible) continue;
        const level = d < q.near ? 0 : d < q.mid ? 1 : 2;
        if (level === t.level) continue;
        if (!t.levels[level]) {
          // the ground and the roads on it, both built from the same triangles so roads never sink into coarse ground
          const g = new THREE.Group(), m = new THREE.Mesh(tileGeometry(t.cx, t.cz, LOD_SEGS[level]), groundMat);
          m.receiveShadow = true;
          g.add(m);
          const segs = roadPieces.get(tiles.indexOf(t));
          if (segs) { const r = new THREE.Mesh(roadGeometry(segs, t.cx, t.cz, LOD_SEGS[level], level), roadMats); r.receiveShadow = true; g.add(r); }
          t.levels[level] = g;
        }
        t.group.clear();
        t.group.add(t.levels[level]!);
        t.level = level;
      }
      const treeDist = Math.min(q.trees, viewDist + 200);
      for (const f of forest) { const vis = rectDist(x, z, f.cx, f.cz) < treeDist; for (const m of f.meshes) m.visible = vis; }
      ripples.offset.set((time * 0.004) % 1, (time * 0.0025) % 1);
      if (beacon) beacon.visible = time % 1.5 < 0.75;
    },
    setQuality(high) {
      q = high ? QUALITY.high : QUALITY.low;
      for (const t of tiles) t.level = -1;            // re-pick detail on the next update
      setTreeShadows();
    },
  };
}

/** `plain`: bare asphalt with no markings (laid over junctions). */
interface RoadSample { x: number; z: number; y: number; nx: number; nz: number; s: number; deck: boolean; hw: number; order: number; plain?: boolean }

/**
 * Road pieces about 2.5 m long, grouped by the terrain tile their middle falls in. Where roads meet, the
 * joining road carries on bare (no markings) to the other's centre line, which breaks that road's edge line
 * just there, and its own edge lines stop at the joint.
 */
function roadSegmentsByTile(layout: Layout): Map<number, [RoadSample, RoadSample][]> {
  const out = new Map<number, [RoadSample, RoadSample][]>();
  const file = (a: RoadSample, b: RoadSample) => {
    const i = clamp(Math.floor(((a.x + b.x) / 2 + HALF) / TILE), 0, NT - 1), j = clamp(Math.floor(((a.z + b.z) / 2 + HALF) / TILE), 0, NT - 1);
    const key = j * NT + i;
    let list = out.get(key);
    if (!list) out.set(key, (list = []));
    list.push([a, b]);
  };
  const bare = bareStretches(layout.roads);
  layout.roads.forEach((road, order) => {
    const src = road.pts, dense: RoadSample[] = [];
    const ranges = bare.get(road) ?? [];
    const isBare = (s: number) => ranges.some(([a, b]) => s >= a - 1e-6 && s <= b + 1e-6);
    const sample = (x: number, z: number, y: number, s: number, deck: boolean, i: number) => {
      const a = src[Math.max(0, i - 1)], b = src[Math.min(src.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1;
      dense.push({ x, z, y, nx: -dz / L, nz: dx / L, s, deck, hw: road.width / 2, order });
    };
    const onDeck = (p: { x: number; y: number; z: number }) => Math.abs(p.y - terrainH(p.x, p.z)) > 0.5;
    for (let i = 0; i < src.length; i++) {
      const p = src[i];
      sample(p.x, p.z, p.y, p.s, onDeck(p), i);
      const q = src[i + 1];
      if (q) sample((p.x + q.x) / 2, (p.z + q.z) / 2, (p.y + q.y) / 2, (p.s + q.s) / 2, onDeck(p) && onDeck(q), i);
    }
    for (let k = 0; k + 1 < dense.length; k++) {
      const a = dense[k], b = dense[k + 1], plain = isBare((a.s + b.s) / 2);
      file(plain ? { ...a, plain } : a, plain ? { ...b, plain } : b);
    }
    // past an end that meets another road: carry on to its centre line
    for (const [a, b] of ranges) for (const [from, to] of [[a, Math.min(b, 0)], [Math.max(a, road.length), b]]) {
      if (to - from < 0.2) continue;
      const ext: RoadSample[] = [];
      const n = Math.ceil((to - from) / 1.25);
      for (let k = 0; k <= n; k++) { const u = from + ((to - from) * k) / n, p = pointAt(road, u)!; ext.push({ ...p, s: u, deck: false, hw: road.width / 2, order, plain: true }); }
      for (let k = 0; k + 1 < ext.length; k++) file(ext[k], ext[k + 1]);
    }
  });
  return out;
}

/** Stretches of each road (in metres along it, possibly past its ends) drawn without markings. */
function bareStretches(roads: Road[]): Map<Road, [number, number][]> {
  const out = new Map<Road, [number, number][]>();
  const add = (r: Road, a: number, b: number) => { const l = out.get(r) ?? []; l.push([a, b]); out.set(r, l); };
  for (const j of roadJunctions(roads)) for (const e of j.roads) {
    const others = j.roads.filter(o => o !== e), hw = Math.max(...others.map(o => o.road.width / 2));
    const meetsEnd = others.some(o => o.end);
    if (e.end) {
      const inward = meetsEnd ? hw : 1;                                        // a corner: both ends bare across the other's width
      if (e.s < 1) add(e.road, -e.d, inward);
      else add(e.road, e.road.length - inward, e.road.length + e.d);
    } else if (!meetsEnd && others.every(o => roads.indexOf(o.road) < roads.indexOf(e.road))) {
      add(e.road, e.s - hw - 0.3, e.s + hw + 0.3);                              // a crossing: the road on top goes bare across the other
    }
  }
  return out;
}

const closed = (r: Road) => Math.hypot(r.pts[0].x - r.pts[r.pts.length - 1].x, r.pts[0].z - r.pts[r.pts.length - 1].z) < 0.5;

/**
 * Where roads meet: a road ending on (or at the end of) another, or two roads crossing. Each lists the
 * roads involved and how far along each the meeting point is.
 */
interface JunctionRoad { road: Road; s: number; end: boolean; d: number }   // d: from this road's end to the other road's centre line
function roadJunctions(roads: Road[]): { roads: JunctionRoad[] }[] {
  const out: { x: number; z: number; roads: JunctionRoad[] }[] = [];
  const nearest = (r: Road, x: number, z: number) => r.pts.reduce((m, p) => { const d = Math.hypot(p.x - x, p.z - z); return d < m.d ? { d, s: p.s } : m; }, { d: Infinity, s: 0 });
  const isEnd = (r: Road, s: number) => !closed(r) && (s < 1 || s > r.length - 1);
  const add = (x: number, z: number, list: JunctionRoad[]) => {
    if (out.some(j => Math.hypot(j.x - x, j.z - z) < 10 && list.every(l => j.roads.some(o => o.road === l.road)))) return;
    out.push({ x, z, roads: list });
  };
  for (const a of roads) {
    if (closed(a)) continue;
    for (const e of [a.pts[0], a.pts[a.pts.length - 1]]) for (const b of roads) {
      if (b === a) continue;
      const n = nearest(b, e.x, e.z);
      if (n.d < b.width / 2 + 1) add(e.x, e.z, [{ road: a, s: e.s, end: true, d: n.d }, { road: b, s: n.s, end: isEnd(b, n.s), d: 0 }]);
    }
  }
  roads.forEach((a, ia) => roads.slice(ia + 1).forEach(b => {
    for (const p of a.pts) {
      if (p.s < 8 || p.s > a.length - 8) continue;
      const n = nearest(b, p.x, p.z);
      if (n.d < 2 && n.s > 8 && n.s < b.length - 8) add(p.x, p.z, [{ road: a, s: p.s, end: false, d: 0 }, { road: b, s: n.s, end: false, d: 0 }]);
    }
  }));
  return out;
}

/** Position and sideways normal `s` metres along a road: past its ends it carries straight on, a closed road wraps. */
function pointAt(road: Road, s: number): { x: number; z: number; y: number; nx: number; nz: number } | null {
  const pts = road.pts, L = road.length;
  if (closed(road)) s = ((s % L) + L) % L;
  const u = clamp(s, 0, L);
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (pts[m].s <= u) lo = m; else hi = m; }
  const a = pts[lo], b = pts[hi], seg = Math.hypot(b.x - a.x, b.z - a.z) || 1, dx = (b.x - a.x) / seg, dz = (b.z - a.z) / seg;
  const f = (u - a.s) / ((b.s - a.s) || 1), over = s - u;
  return { x: a.x + (b.x - a.x) * f + dx * over, z: a.z + (b.z - a.z) * f + dz * over, y: a.y + (b.y - a.y) * f, nx: -dz, nz: dx };
}

/** Height of the drawn terrain at (x, z) for a detail level: the same two triangles per quad as tileGeometry. */
function meshHeight(segs: number, x: number, z: number): number {
  const step = TILE / segs, gx = (x + HALF) / step, gz = (z + HALF) / step;
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
  const h = (a: number, b: number) => terrainH(-HALF + a * step, -HALF + b * step);
  const ha = h(i, j), hb = h(i + 1, j), hc = h(i, j + 1);
  if (u + v <= 1) return ha + u * (hb - ha) + v * (hc - ha);
  const hd = h(i + 1, j + 1);
  return hd + (1 - u) * (hc - hd) + (1 - v) * (hb - hd);
}

/** The road pieces in one tile, laid on that tile's terrain at `segs` detail (left edge, crown, right edge). Group 0 is marked road, group 1 bare junction asphalt. */
function roadGeometry(segs: [RoadSample, RoadSample][], cx: number, cz: number, lod: number, level: number): THREE.BufferGeometry {
  const lift = [0.12, 0.3, 0.6][level];
  const pos: number[] = [], uv: number[] = [], marked: number[] = [], bare: number[] = [];
  for (const pair of segs) {
    const idx = pair[0].plain ? bare : marked;
    const base = pos.length / 3;
    for (const p of pair) for (const f of [-1, 0, 1]) {
      const x = p.x + p.nx * p.hw * f, z = p.z + p.nz * p.hw * f;
      // where roads overlap at a junction, the later one sits 2 cm higher so the two never flicker
      pos.push(x - cx, (p.deck ? p.y + 0.03 : meshHeight(lod, x, z) + lift) + p.order * 0.02, z - cz);
      uv.push((f + 1) / 2, p.s / 14);
    }
    for (const c of [0, 1]) { const a = base + c, b = base + c + 1, d = base + 3 + c, e = base + 3 + c + 1; idx.push(a, b, d, b, e, d); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex([...marked, ...bare]);
  geo.addGroup(0, marked.length, 0);
  geo.addGroup(marked.length, bare.length, 1);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

/** One terrain tile at `segs` × `segs` quads, centred on (cx, cz), with a skirt round its edge. */
function tileGeometry(cx: number, cz: number, segs: number): THREE.BufferGeometry {
  const n = segs + 1, step = TILE / segs, e = 4;
  const pos: number[] = [], nor: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [];
  const vertex = (lx: number, lz: number, drop: number) => {
    const x = cx + lx, z = cz + lz, h = terrainH(x, z);
    const gx = (terrainH(x + e, z) - terrainH(x - e, z)) / (2 * e), gz = (terrainH(x, z + e) - terrainH(x, z - e)) / (2 * e);
    const nl = Math.hypot(gx, 1, gz);
    pos.push(lx, h - drop, lz);
    nor.push(-gx / nl, 1 / nl, -gz / nl);
    uv.push(x / 30, -z / 30);
    // grass, drier up high, rock on steep slopes, sand and mud down by the river
    const nz = 0.86 + 0.14 * Math.sin(x * 0.006 + Math.cos(z * 0.008) * 2.2) * Math.cos(z * 0.005 - x * 0.002);
    const dry = smooth(25, 80, h), rock = smooth(0.55, 0.95, Math.hypot(gx, gz)) * 0.85, high = smooth(150, 260, h) * 0.5;
    const sand = 1 - smooth(WATER_Y + 1.5, WATER_Y + 5, h);
    let r = nz * lerp(1, 1.18, dry), g = nz * lerp(1, 1.02, dry), b = nz * lerp(1, 0.86, dry);
    const rk = Math.max(rock, high);
    r = lerp(r, 1.35, rk); g = lerp(g, 1.0, rk); b = lerp(b, 1.7, rk);
    r = lerp(r, 1.45, sand); g = lerp(g, 1.08, sand); b = lerp(b, 1.5, sand);
    col.push(r, g, b);
  };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) vertex(-TILE / 2 + i * step, -TILE / 2 + j * step, 0);
  for (let j = 0; j < segs; j++) for (let i = 0; i < segs; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    idx.push(a, c, b, b, c, d);
  }
  // skirt: a copy of the border ring hanging down, stitched to it
  const ring: number[] = [];
  for (let i = 0; i < segs; i++) ring.push(i);
  for (let j = 0; j < segs; j++) ring.push(j * n + segs);
  for (let i = segs; i > 0; i--) ring.push(segs * n + i);
  for (let j = segs; j > 0; j--) ring.push(j * n);
  const base = pos.length / 3;
  for (const v of ring) {
    const lx = pos[v * 3], lz = pos[v * 3 + 2];
    vertex(lx, lz, SKIRT);
  }
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k], b = ring[(k + 1) % ring.length], sa = base + k, sb = base + ((k + 1) % ring.length);
    idx.push(a, b, sa, b, sb, sa, a, sa, b, b, sa, sb);   // both windings, so it shows from either side
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** A pad: a disc of `thick` metres with the H on top; a sloped pad is tilted to its surface. */
function padMesh(p: Pad, side: THREE.Material, top: THREE.Material): THREE.Object3D {
  const g = new THREE.Group();
  const m = new THREE.Mesh(new THREE.CylinderGeometry(p.r, p.r + 0.4, p.thick, 48), [side, top, side]);
  m.position.y = -p.thick / 2;
  m.receiveShadow = m.castShadow = true;
  g.add(m);
  g.position.set(p.x, p.top, p.z);
  if (p.slope) g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(-p.slope.gx, 1, -p.slope.gz).normalize());
  return g;
}

/** A square lattice tower `h` tall, `base` half-width at the foot tapering to `topW`, with `arm` m crossarms (0 for none). */
function latticeTower(h: number, base: number, topW: number, arm: number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const strut = (a: THREE.Vector3, b: THREE.Vector3, w: number) => {
    const len = a.distanceTo(b), g = new THREE.BoxGeometry(w, len, w);
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()));
    g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
    parts.push(g);
  };
  const corner = (y: number, sx: number, sz: number) => { const w = lerp(base, topW, y / h); return new THREE.Vector3(sx * w, y, sz * w); };
  const C = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  for (const [sx, sz] of C) strut(corner(0, sx, sz), corner(h, sx, sz), 0.22);
  const levels = Math.max(3, Math.round(h / 7));
  for (let k = 0; k < levels; k++) {
    const y0 = (k / levels) * h, y1 = ((k + 1) / levels) * h;
    for (let c = 0; c < 4; c++) {
      const [ax, az] = C[c], [bx, bz] = C[(c + 1) % 4];
      strut(corner(y0, ax, az), corner(y1, bx, bz), 0.1);
      strut(corner(y1, ax, az), corner(y1, bx, bz), 0.1);
    }
  }
  if (arm > 0) {
    for (const y of [h - 3.5, h]) strut(new THREE.Vector3(0, y, -arm - 0.5), new THREE.Vector3(0, y, arm + 0.5), 0.3);
  }
  const merged = mergeGeometries(parts.map(g => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  return merged;
}
