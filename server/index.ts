import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { createLayout } from '../src/world/layout';
import { createWorld } from '../src/world/world';
import { decodeClient, encode, NET_DT, paramsHash, PROTOCOL_VERSION, type ServerMsg } from '../src/net/protocol';
import { Room, type Player } from './room';

export interface ServerOptions {
  port?: number;
  lag?: number;      // ms one-way delay added to every message (simulated latency is 2× this round trip)
  jitter?: number;   // ms of random extra delay; order is preserved, like TCP
  log?: boolean;
}

export interface RunningServer { port: number; close(): Promise<void>; rooms: Map<string, Room> }

/** WebSocket game server with a /health route. Rooms are created on first join and removed when empty. */
export function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const layout = createLayout();
  const world = createWorld(layout);
  const rooms = new Map<string, Room>();
  const hash = paramsHash();
  const log = (...a: unknown[]) => { if (opts.log) console.log(new Date().toISOString(), ...a); };

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      const players = [...rooms.values()].reduce((n, r) => n + r.players.size, 0);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, rooms: rooms.size, players, version: PROTOCOL_VERSION }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('Littlebird Pad Hopper game server\n');
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: 4096 });

  /** Delivers in order after lag + jitter, so local testing feels like a real connection. */
  const delayed = () => {
    let last = 0;
    return (fn: () => void) => {
      const lag = opts.lag ?? 0, jitter = opts.jitter ?? 0;
      if (!lag && !jitter) { fn(); return; }
      const at = Math.max(last, Date.now() + lag + Math.random() * jitter);
      last = at;
      setTimeout(fn, at - Date.now());
    };
  };

  wss.on('connection', ws => {
    const out = delayed(), inbound = delayed();
    let room: Room | null = null, player: Player | null = null;
    const send = (msg: ServerMsg) => out(() => { if (ws.readyState === WebSocket.OPEN) ws.send(encode(msg)); });

    ws.on('message', raw => inbound(() => {
      const msg = decodeClient(raw);
      if (!msg) return;
      if (msg.type === 'ping') { send({ type: 'pong', t: msg.t }); return; }
      if (msg.type === 'join') {
        if (player) return;
        if (msg.version !== PROTOCOL_VERSION || msg.paramsHash !== hash) {
          send({ type: 'reject', reason: 'Your game version differs from the server. Reload the page to update.' });
          return;
        }
        room = rooms.get(msg.room) ?? new Room(msg.room, world, layout);
        rooms.set(msg.room, room);
        player = room.join(msg.name, { send });
        if (!player) { send({ type: 'reject', reason: `Room "${msg.room}" is full.` }); if (room.empty) rooms.delete(msg.room); return; }
        log(`join ${player.name}#${player.id} → ${room.name} (${room.players.size})`);
        return;
      }
      if (player && room) room.input(player.id, msg);
    }));

    ws.on('close', () => {
      if (!room || !player) return;
      room.leave(player.id);
      log(`leave ${player.name}#${player.id} ← ${room.name} (${room.players.size})`);
      if (room.empty) rooms.delete(room.name);
    });
  });

  // fixed 60 Hz tick for every room, catching up after timer hiccups
  let next = performance.now();
  const timer = setInterval(() => {
    const now = performance.now();
    if (now - next > 250) next = now;                    // too far behind (e.g. laptop slept): skip ahead
    while (now >= next) {
      for (const r of rooms.values()) r.step();
      next += NET_DT * 1000;
    }
  }, 4);

  return new Promise(resolve => {
    httpServer.listen(opts.port ?? 8787, () => {
      const addr = httpServer.address();
      const port = typeof addr === 'object' && addr ? addr.port : opts.port ?? 8787;
      log(`listening on :${port}${opts.lag ? ` (lag ${opts.lag} ms, jitter ${opts.jitter ?? 0} ms)` : ''}`);
      resolve({
        port, rooms,
        close: () => new Promise<void>(done => {
          clearInterval(timer);
          for (const c of wss.clients) c.terminate();
          wss.close(() => httpServer.close(() => done()));
        }),
      });
    });
  });
}

function arg(name: string): number | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? Number(process.argv[i + 1]) : undefined;
}

// run directly: `npm run server -- --lag 60 --jitter 20`
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain || process.env.HELI_SERVER_MAIN === '1') {
  void startServer({ port: Number(process.env.PORT) || arg('port') || 8787, lag: arg('lag'), jitter: arg('jitter'), log: true });
}
