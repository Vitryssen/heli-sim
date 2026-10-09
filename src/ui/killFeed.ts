/** Short-lived lines under the minimap: kills, hits on targets, joins. */
export class KillFeed {
  private items: { el: HTMLLIElement; until: number }[] = [];

  constructor(private list: HTMLElement) {}

  push(html: string, kind: 'kill' | 'self' | 'info' = 'info', seconds = 7): void {
    const el = document.createElement('li');
    el.className = kind;
    el.innerHTML = html;
    this.list.prepend(el);
    this.items.unshift({ el, until: performance.now() + seconds * 1000 });
    while (this.items.length > 5) this.items.pop()!.el.remove();
  }

  tick(now: number): void {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (now > it.until) { it.el.remove(); this.items.splice(i, 1); }
      else it.el.style.opacity = String(Math.min(1, (it.until - now) / 1000));
    }
  }
}

export const escapeHtml = (t: string): string => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
