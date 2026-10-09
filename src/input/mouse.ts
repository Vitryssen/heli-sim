import { clamp } from '../sim/math';

export interface FreeLook { yaw: number; pitch: number; active: boolean }

/**
 * Pointer-locked mouse as a cyclic that springs back to centre, plus free look while the
 * free-look key or the right button is held.
 */
export class Mouse {
  readonly stick = { pitch: 0, roll: 0 };
  readonly look: FreeLook = { yaw: 0, pitch: 0, active: false };
  sensitivity = 1;
  invertY = false;
  private rightDown = false;

  constructor(private canvas: HTMLCanvasElement, private freeLookHeld: () => boolean, onLockChange: (locked: boolean) => void, private canLock: () => boolean) {
    canvas.addEventListener('click', () => { if (this.canLock()) this.lock(); });
    canvas.addEventListener('mousedown', e => { if (e.button === 2) this.rightDown = true; });
    addEventListener('mouseup', e => { if (e.button === 2) this.rightDown = false; });
    addEventListener('blur', () => { this.rightDown = false; });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    document.addEventListener('pointerlockchange', () => onLockChange(this.locked));
    addEventListener('mousemove', e => this.move(e));
  }

  get locked(): boolean { return document.pointerLockElement === this.canvas; }

  lock(): void {
    try {
      const r = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
      r?.catch?.(() => {});
    } catch { /* pointer lock unavailable */ }
  }

  unlock(): void { if (this.locked) document.exitPointerLock(); }

  update(dt: number): void {
    const decay = Math.exp(-dt * 5);
    this.stick.pitch *= decay; this.stick.roll *= decay;
    this.look.active = this.rightDown || this.freeLookHeld();
    if (!this.look.active) { const d = Math.exp(-dt * 3); this.look.yaw *= d; this.look.pitch *= d; }
  }

  private move(e: MouseEvent): void {
    const dx = e.movementX || 0, dy = e.movementY || 0;
    if (this.look.active || this.rightDown) {
      this.look.yaw -= dx * 0.005;
      this.look.pitch = clamp(this.look.pitch - dy * 0.004, -0.5, 1.0);
      return;
    }
    if (!this.locked) return;
    const s = 0.0045 * this.sensitivity;
    this.stick.roll = clamp(this.stick.roll + dx * s, -1, 1);
    this.stick.pitch = clamp(this.stick.pitch + (this.invertY ? -dy : dy) * s, -1, 1);
  }
}
