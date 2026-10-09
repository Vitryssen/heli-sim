import { describe, expect, test } from 'vitest';
import { Bindings, DEFAULT_BINDINGS, keyLabel, type KeyValueStore } from '../src/input/bindings';
import { loadPrefs, savePrefs, DEFAULT_PREFS } from '../src/game/prefs';

const memStore = (): KeyValueStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return { data, getItem: k => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
};

describe('bindings', () => {
  test('defaults match the requested layout', () => {
    const b = new Bindings(memStore());
    expect(b.key('collectiveUp')).toBe('ShiftLeft');
    expect(b.key('collectiveDown')).toBe('ControlLeft');
    expect([b.key('pitchForward'), b.key('rollLeft'), b.key('pitchBack'), b.key('rollRight')]).toEqual(['KeyW', 'KeyA', 'KeyS', 'KeyD']);
    expect([b.key('yawLeft'), b.key('yawRight')]).toEqual(['ArrowLeft', 'ArrowRight']);
  });

  test('every default key is unique', () => {
    const keys = Object.values(DEFAULT_BINDINGS);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('rebinding persists across instances', () => {
    const store = memStore();
    new Bindings(store).bind('collectiveDown', 'KeyZ');
    expect(new Bindings(store).key('collectiveDown')).toBe('KeyZ');
  });

  test('binding a key in use swaps the two actions', () => {
    const b = new Bindings(memStore());
    const moved = b.bind('yawLeft', 'KeyW');
    expect(moved).toBe('pitchForward');
    expect(b.key('yawLeft')).toBe('KeyW');
    expect(b.key('pitchForward')).toBe('ArrowLeft');
  });

  test('reset restores defaults and corrupt storage is ignored', () => {
    const store = memStore();
    const b = new Bindings(store);
    b.bind('reset', 'KeyP');
    b.resetDefaults();
    expect(new Bindings(store).key('reset')).toBe('KeyR');
    store.data.set('heli-sim.bindings.v1', '{not json');
    expect(new Bindings(store).key('reset')).toBe('KeyR');
  });

  test('key labels are readable', () => {
    expect(keyLabel('ShiftLeft')).toBe('Left Shift');
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('ArrowLeft')).toBe('←');
    expect(keyLabel('Digit3')).toBe('3');
  });
});

describe('prefs', () => {
  test('round-trip and defaults', () => {
    const store = memStore();
    expect(loadPrefs(store)).toEqual(DEFAULT_PREFS);
    savePrefs({ assists: { stability: false, autoHover: true, envelope: false, turnCoord: true }, sensitivity: 1.5, invertY: true, name: 'Ace' }, store);
    const p = loadPrefs(store);
    expect(p.assists.stability).toBe(false);
    expect(p.sensitivity).toBe(1.5);
    expect(p.invertY).toBe(true);
  });
});
