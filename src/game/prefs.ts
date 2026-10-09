import type { AssistFlags } from '../sim/state';
import { browserStore, type KeyValueStore } from '../input/bindings';

export interface Prefs { assists: AssistFlags; sensitivity: number; invertY: boolean; name: string }

const KEY = 'heli-sim.prefs.v1';
export const DEFAULT_PREFS: Prefs = {
  assists: { stability: true, autoHover: true, envelope: true, turnCoord: true },
  sensitivity: 1,
  invertY: false,
  name: '',
};

export function loadPrefs(store: KeyValueStore | null = browserStore()): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS, assists: { ...DEFAULT_PREFS.assists } };
  try {
    const saved = JSON.parse(store?.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    if (saved?.assists) Object.assign(p.assists, saved.assists);
    if (typeof saved?.sensitivity === 'number') p.sensitivity = saved.sensitivity;
    if (typeof saved?.invertY === 'boolean') p.invertY = saved.invertY;
    if (typeof saved?.name === 'string') p.name = saved.name;
  } catch { /* defaults */ }
  return p;
}

export function savePrefs(p: Prefs, store: KeyValueStore | null = browserStore()): void {
  try { store?.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
