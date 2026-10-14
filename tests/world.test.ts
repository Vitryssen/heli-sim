import { describe, expect, test } from 'vitest';
import { Quaternion, Vector3 } from 'three';
import { fly, fresh, layout, NEUTRAL, world } from './harness';
import { CORE, terrainH, TOWN, WATER_Y } from '../src/world/terrain';
import { BASE_RING, padSurface, PYLON_H } from '../src/world/layout';
import { placeInFlight, placeOnGround } from '../src/sim/state';
import { crashCheck, EDGE_GRACE, EDGE_WARN } from '../src/sim/collisions';
import { Landings } from '../src/game/landings';
import { Session } from '../src/game/session';
import { createLoadout } from '../src/combat/loadout';
import { updateLock } from '../src/combat/lock';
import { createTargets, placeTarget } from '../src/combat/targets';
import { ALL_ON } from './harness';

const pad = (name: string) => layout.pads.find(p => p.name === name)!;
const props = (kind: string) => layout.props.filter(p => p.kind === kind);

describe('terrain', () => {
  test('the core is exactly the original map', () => {
    const HILLS = [
      { x: 420, z: 150, r: 190, h: 62 }, { x: -380, z: -180, r: 150, h: 40 }, { x: -200, z: 480, r: 200, h: 34 },
      { x: 60, z: -780, r: 260, h: 85 }, { x: 720, z: -520, r: 220, h: 50 }, { x: -760, z: 300, r: 260, h: 72 },
      { x: 900, z: 520, r: 300, h: 95 },
    ];
    const smooth = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    const original = (x: number, z: number) => {
      let h = 0;
      for (const k of HILLS) h += k.h * Math.exp(-((x - k.x) ** 2 + (z - k.z) ** 2) / (k.r * k.r));
      h += 1.4 * Math.sin(x * 0.012 + 1.3) * Math.cos(z * 0.01) + 0.6 * Math.sin(x * 0.029 + z * 0.023);
      return h * smooth(30, 110, Math.hypot(x, z)) * smooth(150, 230, Math.hypot(x - TOWN.x, z - TOWN.z));
    };
    for (let x = -700; x <= 900; x += 37) for (let z = -800; z <= 700; z += 41) {
      if (Math.hypot(x - CORE.x, z - CORE.z) >= CORE.r) continue;
      expect(terrainH(x, z)).toBe(original(x, z));
    }
  });

  test('rugged outer ring: valley floors near Base level, ridges 120–200 m, a gorge below the water, a high rim', () => {
    expect(terrainH(1100, -1050)).toBeLessThan(8);           // north-east valley floor
    expect(terrainH(250, -1450)).toBeGreaterThan(120);       // north ridge
    expect(terrainH(250, -1450)).toBeLessThan(220);
    expect(terrainH(-1350, -600)).toBeLessThan(WATER_Y);     // river
    expect(terrainH(2350, 300)).toBeGreaterThan(200);        // mountain rim
    // the gorge walls are steep: 40 m or more within 70 m of the water
    expect(terrainH(-1350 + 75, -600) - terrainH(-1350, -600)).toBeGreaterThan(40);
  });
});

describe('collisions', () => {
  test('trees stop bullets and break missile locks', () => {
    const t = layout.trees.find(tr => tr.kind === 'broad' && tr.top - tr.y > 8 && Math.hypot(tr.x, tr.z) > 1200)!;
    const y = t.y + 3, from = new Vector3(t.x - 40, y, t.z);
    const d = world.raycast(from.x, from.y, from.z, 1, 0, 0, 80);
    expect(d).not.toBeNull();
    expect(d!).toBeLessThanOrEqual(40 - t.r + 0.01);
    const lock = createLoadout().lock;
    const behind = new Vector3(t.x + 40, y, t.z);
    const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -Math.PI / 2);   // nose east (+x)
    for (let k = 0; k < 120; k++) updateLock(lock, from, q, [{ id: 7, pos: behind }], world, 1 / 60);
    expect(lock.targetId).toBeNull();
  });

  test('pylons and the mast are solid; the wires between pylons are not', () => {
    const line = layout.powerLines.find(l => l.pylons.length > 3)!;
    const [a, b] = line.pylons;
    expect(world.solidAt(a.x, a.y + 10, a.z)).toBe(true);
    const mid = { x: (a.x + b.x) / 2, z: (a.z + b.z) / 2 };
    const wireY = (a.y + b.y) / 2 + PYLON_H - 3.5 - 2;
    if (wireY > terrainH(mid.x, mid.z) + 1) expect(world.solidAt(mid.x, wireY, mid.z)).toBe(false);
    const mast = props('mast')[0];
    expect(world.solidAt(mast.x, mast.base + 60, mast.z)).toBe(true);
  });

  test('a turned box is solid along its own axes, not its bounding square', () => {
    const p = layout.powerLines.flatMap(l => l.pylons).find(pp => Math.abs(Math.sin(2 * pp.rot)) > 0.5)!;
    const c = Math.cos(p.rot), s = Math.sin(p.rot);
    const local = (lx: number, lz: number) => ({ x: p.x + lx * c + lz * s, z: p.z - lx * s + lz * c });
    const inside = local(2.2, 2.2), outside = local(3.2, 0);
    expect(world.solidAt(inside.x, p.y + 5, inside.z)).toBe(true);
    expect(world.solidAt(outside.x, p.y + 5, outside.z)).toBe(false);
  });

  test('you can fly under a bridge between its piers; the deck is solid', () => {
    for (const deck of props('deck')) {
      expect(world.solidAt(deck.x, deck.top - 0.5, deck.z)).toBe(true);
      const gap = (deck.base + WATER_Y) / 2;
      expect(deck.base - WATER_Y).toBeGreaterThan(6);                                  // room for a Littlebird
      expect(world.solidAt(deck.x, gap, deck.z)).toBe(false);
      expect(world.water(deck.x, deck.z)).toBe(WATER_Y);
    }
  });

  test('touching the river is a ditching, flying over it is fine', () => {
    const s = fresh();
    placeInFlight(s, -1350, WATER_Y + 6, -600, 0);
    expect(crashCheck(s, world)).toBeNull();
    s.pos.y = WATER_Y + 0.6;                                     // skids 1.25 m below the CG: in the water
    expect(crashCheck(s, world)).toBe('Ditched in the river');
  });

  test('raycasts agree with a fine march through the solid world', () => {
    let seed = 3;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const places = [[1500, 200], [-150, 1250], [950, -950], [240, -330], [-1000, -770]];
    for (let i = 0; i < 150; i++) {
      const [px, pz] = places[i % places.length];
      const o = new Vector3(px + (rnd() - 0.5) * 200, 0, pz + (rnd() - 0.5) * 200);
      o.y = Math.max(terrainH(o.x, o.z), WATER_Y) + 3 + rnd() * 40;
      if (world.solidAt(o.x, o.y, o.z)) continue;
      const a = rnd() * Math.PI * 2, e = -0.25 + rnd() * 0.3;
      const d = new Vector3(Math.cos(a) * Math.cos(e), Math.sin(e), Math.sin(a) * Math.cos(e));
      const hit = world.raycast(o.x, o.y, o.z, d.x, d.y, d.z, 250);
      let march: number | null = null;
      for (let t = 0.1; t <= 250; t += 0.1) {
        const p = o.clone().addScaledVector(d, t);
        const w = world.water(p.x, p.z);
        // solidAt forgives 5 cm under the terrain (resting skids); a ray doesn't, which matters at grazing angles
        if (world.solidAt(p.x, p.y, p.z) || p.y < terrainH(p.x, p.z) || (w !== null && p.y < w)) { march = t; break; }
      }
      if (march === null) expect(hit).toBeNull();
      else { expect(hit).not.toBeNull(); expect(Math.abs(hit! - march)).toBeLessThan(0.6); }
    }
  });
});

describe('pads and places', () => {
  test('pads are clear above, and the spawn pads are the five easy ones', () => {
    expect(layout.pads.slice(0, 3).map(p => p.name)).toEqual(['Base', 'Rooftop', 'Hilltop']);
    for (const p of layout.pads) for (let a = 0; a < 12; a++) for (const r of [0, p.r * 0.6]) for (const h of [1, 3, 6]) {
      const x = p.x + Math.cos(a * 0.52) * r, z = p.z + Math.sin(a * 0.52) * r;
      expect(world.solidAt(x, padSurface(p, x, z) + h, z), `${p.name} at ${h} m`).toBe(false);
    }
  });

  test('the forest clearing leaves room for the rotor, and the tower pad is boxed in by taller towers', () => {
    const c = pad('Clearing');
    const nearest = Math.min(...layout.trees.map(t => Math.hypot(t.x - c.x, t.z - c.z) - t.r));
    expect(nearest).toBeGreaterThan(6);                      // rotor radius 4.15 m
    expect(nearest).toBeLessThan(13);
    const tower = pad('Tower');
    const around = layout.buildings.filter(b => b !== layout.buildings.find(x => x.pad && Math.hypot(x.x - tower.x, x.z - tower.z) < 1) && Math.hypot(b.x - tower.x, b.z - tower.z) < 30);
    expect(around).toHaveLength(4);
    for (const b of around) expect(b.top).toBeGreaterThan(tower.top + 3);
  });

  test('the slope pad tilts 8° and an aircraft parked on it stays put and is recognised', () => {
    const p = pad('Slope');
    expect(Math.atan(Math.hypot(p.slope!.gx, p.slope!.gz)) * 180 / Math.PI).toBeCloseTo(8, 1);
    const s = fresh();
    const down = new Vector3(-p.slope!.gx, 0, -p.slope!.gz).normalize();
    const heading = Math.atan2(down.z, down.x);            // skids across the slope
    placeOnGround(s, p.x, p.top + 0.3, p.z, heading);
    const start = s.pos.clone();
    const run = fly(s, 6, () => NEUTRAL, ALL_ON);
    expect(run.crash).toBeNull();
    expect(Math.hypot(s.pos.x - start.x, s.pos.z - start.z)).toBeLessThan(0.5);
    expect(new Landings(layout.pads).padUnder(s)?.name).toBe('Slope');
  });

  test('every roof has a parapet round its edge, inside the footprint and clear of the pads', () => {
    for (const b of layout.buildings) {
      const walls = layout.props.filter(p => p.kind === 'parapet' && Math.hypot(p.x - b.x, p.z - b.z) <= Math.max(b.hw, b.hd) + 0.01 && Math.abs(p.base - b.top + 0.1) < 0.01);
      expect(walls).toHaveLength(4);
      for (const w of walls) expect(w.top - b.top).toBeGreaterThan(0.4);
    }
    for (const p of layout.pads.filter(pd => pd.name === 'Rooftop' || pd.name === 'Tower'))
      for (let a = 0; a < 16; a++) {
        const x = p.x + Math.cos(a * 0.39) * p.r, z = p.z + Math.sin(a * 0.39) * p.r;
        expect(world.solidAt(x, p.top + 0.5, z), `${p.name} rim`).toBe(false);
      }
  });

  test('rooftop clutter only on roofs without a pad, nothing built in the river', () => {
    for (const pr of layout.props.filter(x => ['ac', 'tank', 'antenna', 'vent', 'penthouse'].includes(x.kind))) {
      const roof = layout.buildings.find(b => Math.abs(b.top - pr.base - 0.1) < 0.01 && Math.hypot(b.x - pr.x, b.z - pr.z) < b.hw + b.hd);
      expect(roof).toBeDefined();
      expect(roof!.pad).toBe(false);
    }
    for (const b of [...layout.buildings, ...layout.props.filter(x => x.kind !== 'pier' && x.kind !== 'deck')]) expect(world.water(b.x, b.z)).toBeNull();
    for (const t of layout.trees) expect(world.water(t.x, t.z)).toBeNull();
  });
});

describe('networks', () => {
  test('the roads form one network reaching out from the Base ring', () => {
    const roads = layout.roads;
    const meet = (a: typeof roads[number], b: typeof roads[number]) => a.pts.some(p => b.pts.some(q => Math.hypot(p.x - q.x, p.z - q.z) < 6));
    const reached = new Set(roads.filter(r => r.name === 'Base ring'));
    for (let grew = true; grew;) {
      grew = false;
      for (const r of roads) if (!reached.has(r) && [...reached].some(o => meet(o, r))) { reached.add(r); grew = true; }
    }
    expect(roads.filter(r => !reached.has(r)).map(r => r.name)).toEqual([]);
  });

  test('roads out of Base meet on the ring road, and none runs onto the apron', () => {
    const ring = layout.roads.find(r => r.name === 'Base ring')!;
    expect(Math.hypot(ring.pts[0].x - ring.pts[ring.pts.length - 1].x, ring.pts[0].z - ring.pts[ring.pts.length - 1].z)).toBeLessThan(0.01);   // closed
    for (const name of ['Town road', 'East road', 'West road', 'South road']) {
      const p = layout.roads.find(r => r.name === name)!.pts[0];
      expect(Math.abs(Math.hypot(p.x, p.z) - BASE_RING - 3.5), name).toBeLessThan(0.5);
    }
    const onApron = layout.roads.filter(r => r.pts.some(p => Math.abs(p.x) <= 41 && Math.abs(p.z) <= 41)).map(r => r.name);
    expect(onApron).toEqual([]);
    const hangar = layout.buildings.find(b => b.x === -48 && b.z === 18)!;
    for (const p of ring.pts) expect(Math.abs(p.x - hangar.x) > hangar.hw + 3.5 || Math.abs(p.z - hangar.z) > hangar.hd + 3.5).toBe(true);
  });

  test('power lines join up: each starts at the substation or on another line, and ends at what it feeds', () => {
    const lines = layout.powerLines;
    const sub = layout.props.filter(p => p.kind === 'transformer').slice(0, 3);
    const feeds = [...layout.props.filter(p => p.kind === 'transformer').slice(3), ...props('mast')];
    for (const [i, l] of lines.entries()) {
      const ends = [l.pylons[0], l.pylons[l.pylons.length - 1]];
      const atSub = ends.some(e => sub.some(t => Math.hypot(t.x - e.x, t.z - e.z) < 60));
      const shared = ends.some(e => lines.some((o, j) => j !== i && o.pylons.includes(e)));
      expect(atSub || shared, `line ${i} start`).toBe(true);
      const fed = ends.some(e => feeds.some(t => Math.hypot(t.x - e.x, t.z - e.z) < 30));
      expect(fed || i === 0, `line ${i} end`).toBe(true);                      // line 0 comes in over the mountains
      for (let k = 0; k + 1 < l.pylons.length; k++) expect(Math.hypot(l.pylons[k + 1].x - l.pylons[k].x, l.pylons[k + 1].z - l.pylons[k].z)).toBeLessThan(400);
    }
    expect(Math.max(...lines[0].pylons.map(p => Math.max(Math.abs(p.x), Math.abs(p.z))))).toBeGreaterThan(2400);
  });

  test('no tree stands under a power line', () => {
    for (const l of layout.powerLines) for (let k = 0; k + 1 < l.pylons.length; k++) {
      const a = l.pylons[k], b = l.pylons[k + 1];
      for (const t of layout.trees) {
        const ex = b.x - a.x, ez = b.z - a.z, L2 = ex * ex + ez * ez;
        const f = Math.max(0, Math.min(1, ((t.x - a.x) * ex + (t.z - a.z) * ez) / L2));
        if (Math.hypot(t.x - a.x - ex * f, t.z - a.z - ez * f) < 8) throw new Error(`tree at ${t.x.toFixed(0)},${t.z.toFixed(0)} under a line`);
      }
    }
  });
});

describe('road traffic', () => {
  test('four trucks drive the roads at about 40 km/h, on the road surface, and stop when destroyed', () => {
    const trucks = createTargets(layout).filter(t => t.road);
    expect(trucks).toHaveLength(4);
    for (const t of trucks) {
      placeTarget(t, 60);
      const a = t.pos.clone();
      placeTarget(t, 61);
      expect(t.pos.distanceTo(a)).toBeGreaterThan(9);
      expect(t.pos.distanceTo(a)).toBeLessThan(12);
      const road = t.road!;
      const near = road.pts.reduce((m, p) => Math.min(m, Math.hypot(p.x - t.pos.x, p.z - t.pos.z)), Infinity);
      expect(near).toBeLessThan(3);
      expect(t.pos.y - 1.3).toBeGreaterThan(Math.min(terrainH(t.pos.x, t.pos.z), WATER_Y) - 0.5);
      t.alive = false;
      const wreck = t.pos.clone();
      placeTarget(t, 80);
      expect(t.pos.equals(wreck)).toBe(true);
    }
  });
});

describe('map edge', () => {
  test('past 2.2 km a 10 s countdown runs; turning back clears it, staying out destroys you', () => {
    const s = fresh();
    const session = new Session(s, world, new Landings(layout.pads));
    placeInFlight(s, EDGE_WARN + 50, 400, 0, 0);
    let n = null;
    for (let t = 0; t < EDGE_GRACE - 1; t += 0.1) n = session.update(0.1);
    expect(s.crashed).toBe(false);
    expect(n?.title).toBe('Turn back');
    s.pos.x = EDGE_WARN - 50;
    expect(session.update(0.1)).toBeNull();
    s.pos.x = EDGE_WARN + 50;
    let crash = null;
    for (let t = 0; t < EDGE_GRACE + 0.2; t += 0.1) { n = session.update(0.1); if (n?.title === 'Crashed') crash = n; }
    expect(s.crashed).toBe(true);
    expect(crash?.detail).toContain('Left the map');
  });
});
