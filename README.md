# Littlebird Pad Hopper

A light-helicopter flight sim in the browser (MH-6 class), built with Vite, TypeScript and three.js. Fly between three landing pads with a Wardogs-style flight model: spring-centred collective, rate-based cyclic, lots of momentum, and four assists you can switch off one at a time.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173/heli-sim/
npm test           # flight-scenario tests (Vitest)
npm run typecheck
npm run build      # static site in dist/
```

Every push to `main` runs the typecheck and tests, then deploys `dist/` to GitHub Pages.

## Controls (defaults, rebindable under Settings → Controls)

| Control | Keys |
| --- | --- |
| Collective up / down | Left Shift / Left Ctrl |
| Pitch / roll | W S / A D, or the mouse after clicking the view |
| Pedals | ← → |
| Assists | 1 stability · 2 auto-hover · 3 envelope limits · 4 turn coordination |
| Camera · reset · sound | C · R · N |
| Free look | hold Left Alt or the right mouse button |
| Settings | F1 |

**Fly fullscreen** uses the Keyboard Lock API, so Ctrl+W lowers the collective instead of closing the tab in Chrome and Edge. In other browsers, or in a window, the page asks before leaving while the engine runs.

## Flight model

`src/sim/` has no DOM or WebGL dependencies and runs at a fixed 240 Hz.

- **Rotor** (`rotor.ts`): blade-element thrust with uniform momentum-theory inflow. Pulling up at speed sends air up through the disc, so thrust rises and the aircraft climbs as it slows. Heave damping, translational lift and Cheeseman–Bennett ground effect fall out of the same model. Blade loading is capped at the stall limit (C_T/σ = 0.12).
- **Engine** (`engine.ts`): a turboshaft (≈ 485 kW) with a PI governor drives rotor rpm. Raising the collective starts it; rpm droops on a hard pull and rises in a flare.
- **Assists** (`assists.ts`): stability (rate command, attitude hold, heading hold, torque trim), auto-hover (altitude hold, hands-off braking), envelope limits (35° pitch, 50° bank) and turn coordination.

All tunables live in `src/sim/params.ts`. In `npm run dev`, press **F2** for a live tuning panel; it isn't included in production builds.

`prototype/index.html` is the original single-file version, kept for reference.
