import type { AssistFlags } from '../sim/state';
import { browserStore, type KeyValueStore } from '../input/bindings';
import type { Volumes } from '../audio/combatSound';

export interface Prefs { assists: AssistFlags; sensitivity: number; invertY: boolean; name: string; lessons: string[]; volume: Volumes }   // lessons: ids completed

const KEY = 'heli-sim.prefs.v1';
export const DEFAULT_PREFS: Prefs = {
  assists: { stability: true, autoHover: true, envelope: true, turnCoord: true },
  sensitivity: 1,
  invertY: false,
  name: '',
  lessons: [],
  volume: { master: 1, rotor: 1, weapons: 1, alerts: 1 },
};

export function loadPrefs(store: KeyValueStore | null = browserStore()): Prefs {
  const p: Prefs = { ...DEFAULT_PREFS, assists: { ...DEFAULT_PREFS.assists }, lessons: [], volume: { ...DEFAULT_PREFS.volume } };
  try {
    const saved = JSON.parse(store?.getItem(KEY) ?? 'null') as Partial<Prefs> | null;
    if (saved?.assists) Object.assign(p.assists, saved.assists);
    if (typeof saved?.sensitivity === 'number') p.sensitivity = saved.sensitivity;
    if (typeof saved?.invertY === 'boolean') p.invertY = saved.invertY;
    if (typeof saved?.name === 'string') p.name = saved.name;
    if (Array.isArray(saved?.lessons)) p.lessons = saved.lessons.filter(x => typeof x === 'string');
    for (const k of Object.keys(p.volume) as (keyof Volumes)[]) { const v = saved?.volume?.[k]; if (typeof v === 'number' && v >= 0 && v <= 1.5) p.volume[k] = v; }
  } catch { /* defaults */ }
  return p;
}

export function savePrefs(p: Prefs, store: KeyValueStore | null = browserStore()): void {
  try { store?.setItem(KEY, JSON.stringify(p)); } catch { /* storage blocked */ }
}
