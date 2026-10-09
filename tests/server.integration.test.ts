import { afterAll, beforeAll, expect, test } from 'vitest';
import WebSocket from 'ws';
import { startServer, type RunningServer } from '../server/index';
import { decodeServer, encode, paramsHash, PROTOCOL_VERSION, type ServerMsg, type SnapshotMsg } from '../src/net/protocol';
import { ALL_ON } from './harness';

let server: RunningServer;
beforeAll(async () => { server = await startServer({ port: 0 }); });
afterAll(async () => { await server.close(); });

function client(name: string, room: string, version = PROTOCOL_VERSION) {
  const ws = new WebSocket(`ws://localhost:${server.port}`);
  const inbox: ServerMsg[] = [];
  ws.on('message', raw => { const m = decodeServer(raw.toString()); if (m) inbox.push(m); });
  const open = new Promise<void>(r => ws.on('open', () => { ws.send(encode({ type: 'join', name, room, version, paramsHash: paramsHash() })); r(); }));
  return { ws, inbox, open, id: () => (inbox.find(m => m.type === 'welcome') as { id: number } | undefined)?.id };
}
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const until = async (f: () => boolean, ms = 3000) => { const end = Date.now() + ms; while (!f() && Date.now() < end) await wait(20); return f(); };

test('/health reports rooms and players', async () => {
  const res = await fetch(`http://localhost:${server.port}/health`);
  expect(await res.json()).toMatchObject({ ok: true, version: PROTOCOL_VERSION });
});

test('two clients share a room: one spools up and lifts off, the other sees it', async () => {
  const a = client('Alpha', 'itest'), b = client('Bravo', 'itest');
  await Promise.all([a.open, b.open]);
  expect(await until(() => !!a.id() && !!b.id())).toBe(true);
  const aId = a.id()!;
  const startY = (b.inbox.filter((m): m is SnapshotMsg => m.type === 'snapshot').pop()!.players.find(p => p.id === aId)!).s[1];

  // Alpha holds the collective up for 5 s worth of ticks, sent in real time
  for (let seq = 1; seq <= 300; seq++) {
    a.ws.send(encode({ type: 'input', seq, input: { pitch: 0, roll: 0, yaw: 0, collective: 1 }, assists: ALL_ON, buttons: { reset: false }, weapon: { fire: false, mode: 'gun', flare: false }, viewTick: 0 }));
    await wait(16.7);
  }
  await wait(200);
  const last = b.inbox.filter((m): m is SnapshotMsg => m.type === 'snapshot').pop()!;
  const alpha = last.players.find(p => p.id === aId)!;
  expect(last.players).toHaveLength(2);
  expect(alpha.s[14]).toBeGreaterThan(40);          // rotor omega (rad/s) spooled up
  expect(alpha.s[1] - startY).toBeGreaterThan(2);   // and it climbed
  expect(last.acks[aId]).toBeGreaterThan(250);

  a.ws.close();
  expect(await until(() => b.inbox.some(m => m.type === 'event' && m.kind === 'leave' && m.id === aId))).toBe(true);
  b.ws.close();
  expect(await until(() => server.rooms.size === 0)).toBe(true);
}, 15000);

test('one client shoots another down: both hear the hits and the kill', async () => {
  const a = client('Gunner', 'itest3'), b = client('Target', 'itest3');
  await Promise.all([a.open, b.open]);
  expect(await until(() => !!a.id() && !!b.id())).toBe(true);
  const aId = a.id()!, bId = b.id()!;
  // line the target up 150 m in front of the gunner's guns, inside the server's room
  const room = server.rooms.get('itest3')!;
  const gunner = room.players.get(aId)!.state, target = room.players.get(bId)!.state;
  const down = Math.tan((2 * Math.PI) / 180);
  for (const s of [gunner, target]) { s.contacts = 0; s.grounded = false; s.skidContact = [false, false, false, false]; }
  const hold = () => {
    gunner.pos.set(0, 300, 0); gunner.vel.set(0, 0, 0); gunner.q.set(0, 0, 0, 1); gunner.w.set(0, 0, 0);
    target.pos.set(0, 300 - 150 * down, -150); target.vel.set(0, 0, 0); target.q.set(0, 0, 0, 1); target.w.set(0, 0, 0);
  };
  for (let seq = 1; seq <= 180 && !target.crashed; seq++) {
    hold();
    a.ws.send(encode({ type: 'input', seq, input: { pitch: 0, roll: 0, yaw: 0, collective: 0 }, assists: ALL_ON, buttons: { reset: false }, weapon: { fire: true, mode: 'gun', flare: false }, viewTick: 0 }));
    await wait(16.7);
  }
  const combat = (m: ServerMsg[]) => m.flatMap(x => (x.type === 'combat' ? x.events : []));
  expect(await until(() => combat(b.inbox).some(e => e.kind === 'kill' && e.killer === aId && e.victim === bId))).toBe(true);
  expect(combat(a.inbox).some(e => e.kind === 'hit' && e.shooter === aId && e.victim === bId)).toBe(true);
  const kills = () => a.inbox.filter((m): m is SnapshotMsg => m.type === 'snapshot').pop()?.players.find(p => p.id === aId)?.c[7];
  expect(await until(() => kills() === 1)).toBe(true);           // the scoreboard catches up within a snapshot or two
  a.ws.close(); b.ws.close();
}, 15000);

test('a client with a different version is turned away', async () => {
  const c = client('Old', 'itest2', PROTOCOL_VERSION + 99);
  await c.open;
  expect(await until(() => c.inbox.some(m => m.type === 'reject'))).toBe(true);
  c.ws.close();
});
