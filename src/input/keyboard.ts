import type { Action, Bindings } from './bindings';
import type { PilotInput } from '../sim/state';

/** Actions that are held (polled each frame); every other action fires once per key press. */
const HELD: ReadonlySet<Action> = new Set<Action>([
  'collectiveUp', 'collectiveDown', 'pitchForward', 'pitchBack', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'freeLook',
]);

export class Keyboard {
  /** While set, the next key press goes here instead of to the game (used for rebinding). */
  capture: ((code: string) => void) | null = null;
  private down = new Set<string>();
  private axes = { pitch: 0, roll: 0, yaw: 0, collective: 0 };

  constructor(private bindings: Bindings, private onAction: (a: Action) => void) {
    addEventListener('keydown', e => this.keydown(e));
    addEventListener('keyup', e => { this.down.delete(e.code); });
    addEventListener('blur', () => this.down.clear());
  }

  held(a: Action): boolean { return this.down.has(this.bindings.key(a)); }

  /** Smoothed axes: keys ramp in and out, collective springs back to neutral. */
  read(dt: number): PilotInput {
    const k = this.axes, ax = (pos: Action, neg: Action) => (this.held(pos) ? 1 : 0) - (this.held(neg) ? 1 : 0);
    const sm = 1 - Math.exp(-dt * 8), smc = 1 - Math.exp(-dt * 6);
    k.pitch += (ax('pitchForward', 'pitchBack') - k.pitch) * sm;
    k.roll += (ax('rollRight', 'rollLeft') - k.roll) * sm;
    k.yaw += (ax('yawRight', 'yawLeft') - k.yaw) * sm;
    k.collective += (ax('collectiveUp', 'collectiveDown') - k.collective) * smc;
    return { ...k };
  }

  private keydown(e: KeyboardEvent): void {
    if (this.capture) {
      e.preventDefault();
      const cb = this.capture; this.capture = null;
      cb(e.code);
      return;
    }
    const a = this.bindings.action(e.code);
    // keep browser shortcuts (Ctrl+S, Ctrl+D, Alt menu focus, arrow scrolling) out of the way while flying
    if (a || e.ctrlKey || e.altKey || e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    this.down.add(e.code);
    if (!a || e.repeat || HELD.has(a)) return;
    this.onAction(a);
  }
}
