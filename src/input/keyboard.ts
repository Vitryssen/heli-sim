import type { Action, Bindings } from './bindings';
import type { PilotInput } from '../sim/state';

/** True for text inputs, text areas and editable elements, where key presses are text, not controls. */
export function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  if (el.isContentEditable || el.tagName === 'TEXTAREA') return true;
  if (el.tagName !== 'INPUT') return false;
  const type = (el as HTMLInputElement).type;
  return !['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'color', 'file'].includes(type);
}

/** Actions that are held (polled each frame); every other action fires once per key press. */
const HELD: ReadonlySet<Action> = new Set<Action>([
  'collectiveUp', 'collectiveDown', 'pitchForward', 'pitchBack', 'rollLeft', 'rollRight', 'yawLeft', 'yawRight', 'freeLook', 'fire',
]);

export class Keyboard {
  /** While set, the next key press goes here instead of to the game (used for rebinding). */
  capture: ((code: string) => void) | null = null;
  private down = new Set<string>();
  private axes = { pitch: 0, roll: 0, yaw: 0, collective: 0 };

  /**
   * Mouse buttons count as keys ("Mouse0" = left) only while `mouseActive()` says so, normally when the
   * pointer is captured, so the click that captures the mouse never fires a weapon.
   */
  constructor(private bindings: Bindings, private onAction: (a: Action) => void, private mouseActive: () => boolean = () => true) {
    addEventListener('keydown', e => this.keydown(e));
    addEventListener('keyup', e => { this.down.delete(e.code); });
    addEventListener('blur', () => this.down.clear());
    addEventListener('mousedown', e => this.press(`Mouse${e.button}`, e));
    addEventListener('mouseup', e => { this.down.delete(`Mouse${e.button}`); });
  }

  private press(code: string, e: MouseEvent): void {
    if (this.capture) {
      if ((e.target as HTMLElement | null)?.closest?.('button.bind')) return;     // the click that started rebinding
      e.preventDefault();
      const cb = this.capture; this.capture = null; cb(code);
      return;
    }
    if (!this.mouseActive()) return;
    this.down.add(code);
    const a = this.bindings.action(code);
    if (a && !HELD.has(a)) this.onAction(a);
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
    // typing in a text field (pilot name, room code): the keys belong to the field, not the aircraft
    if (isTyping(e.target)) return;
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
