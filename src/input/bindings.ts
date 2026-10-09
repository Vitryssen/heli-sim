export const ACTIONS = [
  { id: 'collectiveUp', label: 'Collective up', group: 'Flight' },
  { id: 'collectiveDown', label: 'Collective down', group: 'Flight' },
  { id: 'pitchForward', label: 'Pitch forward (nose down)', group: 'Flight' },
  { id: 'pitchBack', label: 'Pitch back (nose up)', group: 'Flight' },
  { id: 'rollLeft', label: 'Roll left', group: 'Flight' },
  { id: 'rollRight', label: 'Roll right', group: 'Flight' },
  { id: 'yawLeft', label: 'Pedal left', group: 'Flight' },
  { id: 'yawRight', label: 'Pedal right', group: 'Flight' },
  { id: 'toggleStability', label: 'Stability assist', group: 'Assists' },
  { id: 'toggleAutoHover', label: 'Auto-hover', group: 'Assists' },
  { id: 'toggleEnvelope', label: 'Envelope limits', group: 'Assists' },
  { id: 'toggleTurnCoord', label: 'Turn coordination', group: 'Assists' },
  { id: 'freeLook', label: 'Free look (hold)', group: 'View & game' },
  { id: 'camera', label: 'Cycle camera', group: 'View & game' },
  { id: 'reset', label: 'Reset to Base', group: 'View & game' },
  { id: 'sound', label: 'Sound on/off', group: 'View & game' },
  { id: 'invertY', label: 'Invert mouse Y', group: 'View & game' },
  { id: 'sensDown', label: 'Mouse sensitivity down', group: 'View & game' },
  { id: 'sensUp', label: 'Mouse sensitivity up', group: 'View & game' },
  { id: 'settings', label: 'Settings menu', group: 'View & game' },
] as const;

export type Action = (typeof ACTIONS)[number]['id'];

export const DEFAULT_BINDINGS: Readonly<Record<Action, string>> = {
  collectiveUp: 'ShiftLeft', collectiveDown: 'ControlLeft',
  pitchForward: 'KeyW', pitchBack: 'KeyS', rollLeft: 'KeyA', rollRight: 'KeyD',
  yawLeft: 'ArrowLeft', yawRight: 'ArrowRight',
  toggleStability: 'Digit1', toggleAutoHover: 'Digit2', toggleEnvelope: 'Digit3', toggleTurnCoord: 'Digit4',
  freeLook: 'AltLeft', camera: 'KeyC', reset: 'KeyR', sound: 'KeyN', invertY: 'KeyI',
  sensDown: 'BracketLeft', sensUp: 'BracketRight', settings: 'F1',
};

const STORAGE_KEY = 'heli-sim.bindings.v1';

export interface KeyValueStore { getItem(k: string): string | null; setItem(k: string, v: string): void }

export function browserStore(): KeyValueStore | null {
  try { return typeof localStorage !== 'undefined' ? localStorage : null; } catch { return null; }
}

/** One key per action, saved in the browser. Binding a key that is in use swaps the two actions' keys. */
export class Bindings {
  private map: Record<Action, string> = { ...DEFAULT_BINDINGS };

  constructor(private store: KeyValueStore | null = browserStore()) { this.load(); }

  key(a: Action): string { return this.map[a]; }

  action(code: string): Action | undefined {
    return (Object.keys(this.map) as Action[]).find(a => this.map[a] === code);
  }

  /** Returns the action that gave up the key, if any. */
  bind(a: Action, code: string): Action | null {
    const other = this.action(code);
    if (other === a) return null;
    if (other) this.map[other] = this.map[a];
    this.map[a] = code;
    this.save();
    return other ?? null;
  }

  resetDefaults(): void { this.map = { ...DEFAULT_BINDINGS }; this.save(); }

  private load(): void {
    try {
      const raw = this.store?.getItem(STORAGE_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw) as Partial<Record<Action, string>>;
      for (const a of Object.keys(DEFAULT_BINDINGS) as Action[]) if (typeof saved[a] === 'string') this.map[a] = saved[a]!;
    } catch { /* unreadable or blocked storage: keep defaults */ }
  }

  private save(): void {
    try { this.store?.setItem(STORAGE_KEY, JSON.stringify(this.map)); } catch { /* storage blocked */ }
  }
}

const NAMED: Record<string, string> = {
  ShiftLeft: 'Left Shift', ShiftRight: 'Right Shift', ControlLeft: 'Left Ctrl', ControlRight: 'Right Ctrl',
  AltLeft: 'Left Alt', AltRight: 'Right Alt', MetaLeft: 'Left Cmd', MetaRight: 'Right Cmd',
  ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓', Space: 'Space', Enter: 'Enter', Tab: 'Tab',
  BracketLeft: '[', BracketRight: ']', Backquote: '`', Minus: '-', Equal: '=', Semicolon: ';', Quote: "'",
  Comma: ',', Period: '.', Slash: '/', Backslash: '\\', CapsLock: 'Caps Lock', Backspace: 'Backspace',
};

export function keyLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return 'Num ' + code.slice(6);
  return code;
}
