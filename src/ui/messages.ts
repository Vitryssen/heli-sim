import type { Notice } from '../game/landings';

/** Centre-screen banner. A ttl of 0 keeps it up until replaced (crashes). */
export class Messages {
  private timer = 0;
  private sticky = false;
  private busyUntilIdle = false;

  constructor(private el: HTMLElement, private title: HTMLElement, private detail: HTMLElement) {}

  show(n: Notice | null): void {
    if (!n) return;
    this.title.textContent = n.title;
    this.detail.textContent = n.detail;
    this.el.className = `hud ${n.kind}${n.title ? ' show' : ''}`;
    this.timer = n.ttl;
    this.sticky = !n.ttl;
    this.busyUntilIdle = true;
  }

  clear(): void { this.el.classList.remove('show'); this.timer = 0; this.sticky = false; this.busyUntilIdle = false; }

  /** True while a timed banner is showing (lets low-priority notices wait their turn). */
  get busy(): boolean { return this.busyUntilIdle; }

  tick(dt: number): void {
    if (this.timer <= 0) return;
    this.timer -= dt;
    if (this.timer <= 0 && !this.sticky) { this.el.classList.remove('show'); this.busyUntilIdle = false; }
  }
}
