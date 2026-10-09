interface KeyboardLockApi { lock(keys?: string[]): Promise<void>; unlock(): void }
const keyboardApi = (): KeyboardLockApi | undefined => (navigator as Navigator & { keyboard?: KeyboardLockApi }).keyboard;

/**
 * Fullscreen plus the Keyboard Lock API, so Chromium browsers hand Ctrl+W, Ctrl+T and friends to
 * the game instead of closing the tab. Returns whether the keyboard is actually locked.
 */
export async function enterFlightMode(): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
  } catch { return false; }
  const kb = keyboardApi();
  if (!kb) return false;
  try { await kb.lock(); return true; } catch { return false; }
}

export const keyboardLockSupported = (): boolean => !!keyboardApi() && !!document.documentElement.requestFullscreen;

/** While enabled, closing or reloading the tab asks first (catches Ctrl+W outside keyboard lock). */
export function setLeaveGuard(on: boolean): void {
  window.onbeforeunload = on ? (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; return ''; } : null;
}
