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

In the game: **Settings → Multiplayer** to create a room and copy its link. Rooms are a free-for-all deathmatch: kills and deaths show in the player list, destroyed aircraft respawn after 5 s (`R` respawns at once), and colliding with another aircraft destroys both. You spawn on one of the five easy pads (Base, Rooftop, Hilltop, FARP, Eastvale): the free one furthest from the other living pilots, so an empty room starts on Base. A room keeps the time of day its creator picked; the room link carries it.

**Deploying the server (Fly.io):**

1. `brew install flyctl && fly auth login`
2. `fly launch --no-deploy --copy-config` (keeps `fly.toml`; change `app` if the name is taken), then `fly deploy`
3. In the GitHub repo: add secret `FLY_API_TOKEN` (`fly tokens create deploy`) and variable `SERVER_URL` = `wss://<app>.fly.dev`

After that, server changes deploy automatically (`.github/workflows/deploy-server.yml`), and the Pages build points the game at `SERVER_URL`. Without `SERVER_URL` the published game is solo-only.

## Combat

`src/combat/` is shared by solo play (runs in the browser) and the server (authoritative in rooms). It has no DOM code and is covered by `tests/combat.test.ts`.

- **Miniguns:** 50 rounds/s from two pods, 3,000 rounds, 1.2 km range. Hits are instant ray checks against the airframe spheres. Online, the server rewinds the other aircraft to where your screen showed them (up to 250 ms), so you aim at what you see.
- **Missiles:** 4 carried. Hold a target in the ±6° seeker for 1.5 s to lock, then fire. They cruise at 180 m/s using proportional navigation with a 20 g limit, a 5 m proximity fuse, 75 % damage plus splash, and self-destruct after 12 s.
- **Flares:** 24, dropped in salvos of 6 (four salvos). A salvo ripples out over 0.4 s, alternating left and right. Each flare inside a missile's seeker has a 30 % chance to decoy it, so a salvo breaks most locks.
- **Rearm and repair** by sitting 5 s on any H pad.
- **Practice targets:** six parked trucks around the town and Hilltop, four trucks driving the East, West and South roads (about 40 km/h), and three drones flying figure-8s. They respawn after 20 s; a destroyed truck burns where it stopped.
- **Cover:** terrain, buildings, props and trees stop rounds and missiles and break a missile lock. Drop into a valley or behind a tree line to shake a lock.
- **Minimap:** heading-up, range 500 m / 1 km / 2 km (`M`). Shows the terrain, river, forests, roads, power lines, pilots, targets and missiles, and the map-edge warning line.

The old landing time trial and the target-pad beacon are gone; landings are still graded.

## World

`src/world/` is pure data (no DOM) shared by the browser and the server: `terrain.ts` (height), `layout.ts` (everything placed on it, seeded so every client and the server agree), `world.ts` (collision queries over a 32 m grid). `meshes.ts` draws it. Covered by `tests/world.test.ts`.

- **Core:** inside 700 m of the town–Base area the map is exactly the original: Base, the town, Hilltop and every tutorial route.
- **Outer ring:** rugged upland with 120–190 m ridgelines and dry valleys cut 30–50 m deep, which are the low routes out of the core. A river runs through a gorge round the west and south; touching the water is a crash ("Ditched"), and rotor wash over it throws spray. The map edge rises into a 250–400 m mountain rim.
- **Places:** the village of Eastvale (with a pad by the main street, and a tight **Tower** pad boxed in by taller towers), a **FARP** with sandbags and fuel bladders, a forest **Clearing** ringed by tall pines, an 8° **Slope** pad, two hamlets, and a radio mast on the north ridge with a blinking light. Every H pad rearms; only Base, Rooftop, Hilltop, FARP and Eastvale are spawn points.
- **Roads:** one network: a ring road round Base where every road out meets (no road runs onto the pad), streets through the town, east to Eastvale, west past the FARP over a bridge to a hamlet, south over a second bridge to a farm. You can fly under both bridges.
- **Power grid:** a main line from the south-east mountains to a substation by the East road, then lines along the roads to Eastvale, the FARP and the west hamlet, the south farm and the radio mast, through cleared corridors in the forests. Pylons are solid; the wires are only drawn.
- **Buildings:** glass offices over 22 m, plastered apartments with balconies and shopfronts below that, corrugated sheds with sliding doors. Every roof has a solid parapet; roofs without a pad carry a stair housing, AC units, water tanks, antennas and vents, all solid. The drawn detail is in `src/world/detail.ts`; collisions still use the plain boxes.
- **Forests:** about 5,000 pines and broadleaf trees in patches with open fields between. Trees are solid and give cover.
- **Map edge:** past 2.2 km on either axis a "Turn back" countdown runs; stay out 10 s and you're destroyed.
- **Graphics (Settings → Graphics):** High or Low quality (Low: one pixel per pixel, no tree shadows, less terrain detail and a shorter tree range), and the time of day: clear noon, golden hour, or overcast with haze to about 900 m. The weather is visual only; the flight model never sees it.

## Tutorial

Settings → Tutorial has ten solo lessons, flown through gates and markers in the world, with a step panel under the top-left buttons:

- **Basics:** lift-off and hover; pedal turns and hover-taxi.
- **Forward flight:** speed, banked turns and stopping without ballooning.
- **Landing:** Base from the south; the rooftop pad.
- **Combat:** shoot a truck with the miniguns, lock and fire a missile, then decoy a harmless training missile with flares (another follows if one gets through).
- **Assists:** one lesson each for stability, auto-hover, envelope limits and turn coordination. Each flies the same task twice, first with the assist on and then off, and compares the runs (wobble, height drift with the collective released, max pitch, sideslip).

A lesson sets the assists for each run; the assist keys are locked until you leave. A crash restarts the run, and `R` restarts it on demand. **Leave tutorial** (bottom of the menu, shown while a lesson is loaded) puts you back on Base with your own assists. Finished lessons are remembered in the browser. `src/tutorial/` holds the lessons and the runner (no DOM), covered by `tests/tutorial.test.ts`.

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

## Sound

Everything is synthesized with WebAudio (no audio files). Settings → Sound has master, helicopter, weapons and alerts volumes (0–150 %, saved in the browser). The minigun is fitted to a recording of a real AH-6 firing (spectrum and ~59 rounds/s rhythm), with its barrel motor spinning up and winding down and an outdoor echo after each burst; the rotor is quieter in third person.

## Credits

The AH-6 model is ["Helicopters MH-6 Little Bird"](https://sketchfab.com/3d-models/helicopters-mh-6-little-bird-69cb05db3fc3483cb729734262abf28e) by [mario low poly](https://sketchfab.com/mariogpymario117), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). It was compressed, rescaled and re-oriented for the game, with simplified glass; its stick, collective, pedals and minigun barrels are split out to move, the rocket tips in its pods are split out to show the missiles left, and drones are a recoloured copy without weapons. See `src/assets/little-bird.LICENSE.txt`. If the file fails to load, the game falls back to its built-in model.
