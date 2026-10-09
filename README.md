# Littlebird Pad Hopper

A light-helicopter combat sim in the browser (MH-6 / AH-6 class), built with Vite, TypeScript and three.js. A Wardogs-style flight model (spring-centred collective, rate-based cyclic, lots of momentum, four assists you can switch off one at a time) with twin miniguns and lock-on missiles. Practise on ground targets and drones solo, or fight a free-for-all in a multiplayer room.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173/heli-sim/
npm test           # flight-scenario tests (Vitest)
npm run typecheck
npm run build      # static site in dist/
```

Every push to `main` runs the typecheck and tests, then deploys `dist/` to GitHub Pages.

## Multiplayer

Up to 8 pilots per room fly in the same world. The server in `server/` is authoritative: it runs the same `src/sim` flight model at 60 ticks per second and sends snapshots 20 times a second. Your own aircraft is predicted locally and reconciled against the server, so it feels the same as solo. Other aircraft are interpolated 100 ms behind.

```sh
npm run server                          # ws://localhost:8787, health at /health
npm run server -- --lag 60 --jitter 20  # simulate a 120 ms round trip with jitter
npm run dev                             # open two windows on http://localhost:5173/heli-sim/?room=test
```

In the game: **Settings → Multiplayer** to create a room and copy its link. Rooms are a free-for-all deathmatch: kills and deaths show in the player list, destroyed aircraft respawn after 5 s (`R` respawns at once), and colliding with another aircraft destroys both.

**Deploying the server (Fly.io):**

1. `brew install flyctl && fly auth login`
2. `fly launch --no-deploy --copy-config` (keeps `fly.toml`; change `app` if the name is taken), then `fly deploy`
3. In the GitHub repo: add secret `FLY_API_TOKEN` (`fly tokens create deploy`) and variable `SERVER_URL` = `wss://<app>.fly.dev`

After that, server changes deploy automatically (`.github/workflows/deploy-server.yml`), and the Pages build points the game at `SERVER_URL`. Without `SERVER_URL` the published game is solo-only.

## Combat

`src/combat/` is shared by solo play (runs in the browser) and the server (authoritative in rooms). It has no DOM code and is covered by `tests/combat.test.ts`.

- **Miniguns:** 50 rounds/s from two pods, 3,000 rounds, 1.2 km range. Hits are instant ray checks against the airframe spheres. Online, the server rewinds the other aircraft to where your screen showed them (up to 250 ms), so you aim at what you see.
- **Missiles:** 4 carried. Hold a target in the ±6° seeker for 1.5 s to lock, then fire. They use proportional navigation with a 20 g limit, a 5 m proximity fuse, 75 % damage plus splash, and self-destruct after 8 s.
- **Flares:** 30, dropped in salvos of 4. Each flare inside a missile's seeker has a 30 % chance to decoy it, so a salvo breaks most locks.
- **Rearm and repair** by sitting 5 s on any H pad.
- **Practice targets:** six trucks around the town and Hilltop, and three drones flying figure-8s. They respawn after 20 s.
- **Minimap:** heading-up, range 500 m / 1 km / 2 km (`M`). Shows pilots, targets and missiles.

The old landing time trial and the target-pad beacon are gone; landings are still graded.

## Controls (defaults, rebindable under Settings → Controls)

| Control | Keys |
| --- | --- |
| Collective up / down | Left Shift / Left Ctrl |
| Pitch / roll | W S / A D, or the mouse after clicking the view |
| Pedals | ← → |
| Fire · switch guns/missiles · flares | Left mouse · Q · V |
| Minimap range | M |
| Assists | 1 stability · 2 auto-hover · 3 envelope limits · 4 turn coordination |
| Camera · reset · sound | C · R · N |
| Free look | hold Left Alt or the right mouse button |
| Zoom | mouse wheel (cockpit: field of view, chase: distance) |
| Settings | F1 |

**Fly fullscreen** uses the Keyboard Lock API, so Ctrl+W lowers the collective instead of closing the tab in Chrome and Edge. In other browsers, or in a window, the page asks before leaving while the engine runs.

## Flight model

`src/sim/` has no DOM or WebGL dependencies and runs at a fixed 240 Hz.

- **Rotor** (`rotor.ts`): blade-element thrust with uniform momentum-theory inflow. Pulling up at speed sends air up through the disc, so thrust rises and the aircraft climbs as it slows. Heave damping, translational lift and Cheeseman–Bennett ground effect fall out of the same model. Blade loading is capped at the stall limit (C_T/σ = 0.12).
- **Engine** (`engine.ts`): a turboshaft (≈ 485 kW) with a PI governor drives rotor rpm. Raising the collective starts it; rpm droops on a hard pull and rises in a flare.
- **Assists** (`assists.ts`): stability (rate command, attitude hold, heading hold, torque trim), auto-hover (flies the collective to hold altitude; never touches the cyclic), envelope limits (35° pitch, 50° bank) and turn coordination.

All tunables live in `src/sim/params.ts`. In `npm run dev`, press **F2** for a live tuning panel; it isn't included in production builds.

`prototype/index.html` is the original single-file version, kept for reference.
