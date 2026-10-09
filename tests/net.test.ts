import { describe, expect, test } from 'vitest';
import { Vector3 } from 'three';
import { createState, placeInFlight } from '../src/sim/state';
import { params } from '../src/sim/params';
import { ROTOR_RADIUS } from '../src/sim/geometry';
import { aircraftTouch, fleetContacts, MAX_PLAYERS, pickSlot, spawnSlots } from '../src/sim/fleet';
import { applyState, decodeClient, NET_DT, paramsHash, serializeState, SNAPSHOT_EVERY, type InputMsg, type ServerMsg, type SnapshotMsg } from '../src/net/protocol';
import { simulateTick } from '../src/net/tick';
import { Predictor } from '../src/net/predictor';
import { Room } from '../server/room';
import { ALL_ON, layout, world } from './harness';

const msg = (seq: number, input: Partial<InputMsg['input']> = {}, reset = false): InputMsg => ({
  type: 'input', seq, input: { pitch: 0, roll: 0, yaw: 0, collective: 0, ...input }, assists: { ...ALL_ON }, buttons: { reset },
  weapon: { fire: false, mode: 'gun', flare: false }, viewTick: 0,
});

describe('protocol', () => {
  test('serialized state reproduces the next 240 ticks exactly', () => {
    const a = createState(); placeInFlight(a, 0, 150, 0, 30);
    for (let i = 1; i <= 60; i++) simulateTick(a, msg(i, { pitch: 0.3, roll: Math.sin(i * 0.1), collective: 0.2 }), world);
    const b = createState();
    applyState(b, serializeState(a));
    for (let i = 61; i <= 300; i++) {
      const m = msg(i, { pitch: Math.cos(i * 0.05), roll: -0.4, yaw: 0.2 });
      simulateTick(a, m, world); simulateTick(b, m, world);
    }
    expect(serializeState(b)).toEqual(serializeState(a));
  });

  test('client input is clamped and sanitized', () => {
    const m = decodeClient(JSON.stringify({ type: 'input', seq: 5, input: { pitch: 9, roll: 'x', yaw: -Infinity, collective: null }, assists: { stability: 1 }, buttons: { reset: true },
      weapon: { fire: 'yes', mode: 'nuke', flare: true }, viewTick: -40 }));
    expect(m).toMatchObject({ type: 'input', seq: 5, input: { pitch: 1, roll: 0, yaw: 0, collective: 0 }, assists: { stability: false }, buttons: { reset: true },
      weapon: { fire: false, mode: 'gun', flare: true }, viewTick: 0 });
    expect(decodeClient('{"type":"hack"}')).toBeNull();
    expect(decodeClient('not json')).toBeNull();
    const j = decodeClient(JSON.stringify({ type: 'join', name: '<script>Maverick</script>!!', room: 'My Room!' }));
    expect(j).toMatchObject({ name: 'scriptMavericksc', room: 'myroom' });
  });

  test('params hash changes when the flight model changes', () => {
    const h = paramsHash();
    params.rotor.thetaUp += 0.01;
    expect(paramsHash()).not.toBe(h);
    params.rotor.thetaUp -= 0.01;
    expect(paramsHash()).toBe(h);
  });
});

describe('fleet', () => {
  const slots = spawnSlots(layout.pads[0], world.terrainH);

  test('spawn slots keep parked rotors well apart and sit on the ground', () => {
    expect(slots).toHaveLength(MAX_PLAYERS);
    for (let i = 0; i < slots.length; i++) for (let j = i + 1; j < slots.length; j++)
      expect(Math.hypot(slots[i].x - slots[j].x, slots[i].z - slots[j].z)).toBeGreaterThan(2 * ROTOR_RADIUS + 5);
    for (const s of slots) expect(world.solidAt(s.x, s.top + 1, s.z)).toBe(false);
  });

  test('pickSlot avoids occupied slots', () => {
    const taken = [new Vector3(slots[0].x, 0, slots[0].z), new Vector3(slots[1].x, 0, slots[1].z)];
    expect(pickSlot(slots, taken)).toBe(2);
  });

  test('touching airframes and overlapping rotors are detected', () => {
    const a = createState(), b = createState();
    placeInFlight(a, 0, 100, 0, 0);
    placeInFlight(b, 30, 100, 0, 0);
    expect(aircraftTouch(a, b)).toBe(false);
    b.pos.set(7, 100, 0);                       // discs overlap (2R = 8.3 m), same height
    expect(aircraftTouch(a, b)).toBe(true);
    b.pos.set(7, 103, 0);                       // 3 m higher: discs and bodies clear
    expect(aircraftTouch(a, b)).toBe(false);
    b.pos.set(0.5, 100.5, 0);
    expect(fleetContacts([a, b])).toEqual([[0, 1]]);
    a.crashed = b.crashed = true;
    expect(fleetContacts([a, b])).toEqual([]);
  });
});

function fakePeer() { const inbox: ServerMsg[] = []; return { inbox, send: (m: ServerMsg) => void inbox.push(m) }; }

describe('room', () => {
  test('join sends welcome and a snapshot; players spawn apart', () => {
    const room = new Room('t', world, layout), a = fakePeer(), b = fakePeer();
    const pa = room.join('A', a)!, pb = room.join('B', b)!;
    expect(a.inbox[0]).toMatchObject({ type: 'welcome', id: pa.id });
    expect(a.inbox.some(m => m.type === 'snapshot')).toBe(true);
    expect(a.inbox.some(m => m.type === 'event' && m.kind === 'join' && m.id === pb.id)).toBe(true);
    expect(pa.state.pos.distanceTo(pb.state.pos)).toBeGreaterThan(12);
  });

  test('inputs apply in order, duplicates are ignored, acks advance', () => {
    const room = new Room('t', world, layout), peer = fakePeer();
    const p = room.join('A', peer)!;
    room.input(p.id, msg(1, { collective: 1 }));
    room.input(p.id, msg(2, { collective: 1 }));
    room.input(p.id, msg(2, { collective: -1 }));
    room.input(p.id, msg(1));
    room.step(); expect(p.lastSeq).toBe(1);
    room.step(); expect(p.lastSeq).toBe(2);
    room.step();
    const snaps = peer.inbox.filter((m): m is SnapshotMsg => m.type === 'snapshot');
    expect(snaps[snaps.length - 1].acks[p.id]).toBe(2);
    expect(p.state.engineOn).toBe(true);
  });

  test('starved inputs repeat briefly, then the controls are released', () => {
    const room = new Room('t', world, layout);
    const p = room.join('A', fakePeer())!;
    placeInFlight(p.state, 0, 200, 0, 0);
    room.input(p.id, msg(1, { collective: 1 }));
    room.step();
    for (let i = 0; i < 5; i++) room.step();
    expect(p.state.theta).toBeGreaterThan(params.rotor.thetaNeutral + 0.02);   // still pulling
    for (let i = 0; i < 60; i++) room.step();
    expect(p.state.theta).toBeLessThan(params.rotor.thetaNeutral + 0.02);      // let go
  });

  test('a lagging client cannot queue up more than 8 ticks of delay', () => {
    const room = new Room('t', world, layout);
    const p = room.join('A', fakePeer())!;
    for (let i = 1; i <= 30; i++) room.input(p.id, msg(i));
    room.step();
    expect(p.lastSeq).toBe(23);
  });

  test('reset respawns the aircraft on the ground', () => {
    const room = new Room('t', world, layout);
    const p = room.join('A', fakePeer())!;
    placeInFlight(p.state, 100, 80, 100, 20);
    room.input(p.id, msg(1, {}, true));
    room.step();
    expect(p.respawns).toBe(1);
    expect(p.state.pos.y).toBeLessThan(3);
    expect(p.state.engineOn).toBe(false);
  });

  test('mid-air collision crashes both aircraft and tells everyone', () => {
    const room = new Room('t', world, layout), a = fakePeer();
    const pa = room.join('A', a)!, pb = room.join('B', fakePeer())!;
    placeInFlight(pa.state, 0, 100, 0, 0);
    placeInFlight(pb.state, 6, 100, 0, 0);
    room.input(pa.id, msg(1)); room.input(pb.id, msg(1));
    room.step();
    expect(pa.state.crashed && pb.state.crashed).toBe(true);
    expect(pa.reason).toMatch(/Mid-air collision with B/);
    expect(a.inbox.filter(m => m.type === 'event' && m.kind === 'crash')).toHaveLength(2);
  });

  test('room is full at 8 players', () => {
    const room = new Room('t', world, layout);
    for (let i = 0; i < MAX_PLAYERS; i++) expect(room.join(`P${i}`, fakePeer())).not.toBeNull();
    expect(room.join('late', fakePeer())).toBeNull();
  });
});

describe('prediction and reconciliation', () => {
  test('with 120 ms round trip, predictions match the server within 1 cm', () => {
    const ONE_WAY = 4;                                    // ticks ≈ 67 ms each way
    const room = new Room('t', world, layout);
    const c2s: { at: number; m: InputMsg }[] = [], s2c: { at: number; m: ServerMsg }[] = [];
    let now = 0;
    const p = room.join('A', { send: m => void s2c.push({ at: now + ONE_WAY, m }) })!;
    const local = createState();
    const predictor = new Predictor(local, world);
    const predicted = new Map<number, Vector3>();
    let synced = false, maxErr = 0, reconciles = 0;

    for (now = 0; now < 600; now++) {
      // client: handle arrived snapshots, then predict this tick
      while (s2c.length && s2c[0].at <= now) {
        const m = s2c.shift()!.m;
        if (m.type !== 'snapshot') continue;
        const me = m.players.find(x => x.id === p.id)!;
        const ack = m.acks[p.id];
        if (synced && ack > 0) {
          const before = predicted.get(ack)!;
          const server = new Vector3(me.s[0], me.s[1], me.s[2]);
          maxErr = Math.max(maxErr, server.distanceTo(before));
          reconciles++;
        }
        predictor.reconcile(me.s, ack);
        synced = true;
      }
      if (synced) {
        const t = predictor.seq * NET_DT;
        const input = { collective: t < 6.5 ? 1 : 0, pitch: t > 5 ? 0.2 * Math.sin(t) : 0, roll: t > 6 ? 0.3 : 0, yaw: Math.sin(t * 0.7) * 0.3 };
        const m = predictor.next(input, ALL_ON, { reset: false });
        predicted.set(m.seq, local.pos.clone());
        c2s.push({ at: now + ONE_WAY, m });
      }
      // server
      while (c2s.length && c2s[0].at <= now) room.input(p.id, c2s.shift()!.m);
      room.step();
    }
    expect(reconciles).toBeGreaterThan(100);
    expect(maxErr).toBeLessThan(0.01);
    expect(local.pos.y).toBeGreaterThan(5);            // it really flew
    expect(SNAPSHOT_EVERY).toBe(3);
  });

  test('a starved server tick is corrected by reconciliation', () => {
    const room = new Room('t', world, layout);
    const peer = fakePeer();
    const p = room.join('A', peer)!;
    const local = createState();
    const predictor = new Predictor(local, world);
    predictor.reconcile(serializeState(p.state), 0);
    // the client sends nothing for 10 ticks while the server repeats; then catches up
    for (let i = 0; i < 30; i++) { room.input(p.id, predictor.next({ pitch: 0, roll: 0, yaw: 0, collective: 1 }, ALL_ON, { reset: false })); room.step(); }
    for (let i = 0; i < 10; i++) room.step();
    predictor.reconcile(serializeState(p.state), p.lastSeq);
    expect(local.pos.distanceTo(p.state.pos)).toBeLessThan(1e-9);
  });
});
