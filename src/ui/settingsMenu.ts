import { ACTIONS, keyLabel, type Action, type Bindings } from '../input/bindings';
import type { Keyboard } from '../input/keyboard';
import type { Prefs } from '../game/prefs';
import type { AssistFlags } from '../sim/state';

export type Tab = 'help' | 'controls' | 'assists' | 'mouse';

export interface MenuHooks {
  onAssist(k: keyof AssistFlags, v: boolean): void;
  onMouse(sensitivity: number, invertY: boolean): void;
  onFly(): void;          // fullscreen + keyboard lock
  onClose(): void;
}

const ASSIST_ROWS: { k: keyof AssistFlags; label: string; detail: string }[] = [
  { k: 'stability', label: 'Stability assist', detail: 'Damps rotation and holds the attitude you release at. Trims out rotor torque and holds heading.' },
  { k: 'autoHover', label: 'Auto-hover', detail: 'Neutral collective holds altitude. Hands off the stick and it brakes to a hover.' },
  { k: 'envelope', label: 'Envelope limits', detail: 'Caps pitch at 35° and bank at 50°.' },
  { k: 'turnCoord', label: 'Turn coordination', detail: 'Yaws the nose into banked turns above about 30 km/h.' },
];

/** Settings overlay: help, key rebinding, assists and mouse. Pauses the game while open. */
export class SettingsMenu {
  open = false;
  private root = document.getElementById('menu')!;
  private body = document.getElementById('menuBody')!;
  private tab: Tab = 'help';
  private note = '';

  constructor(private bindings: Bindings, private keyboard: Keyboard, private prefs: Prefs, private hooks: MenuHooks) {
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.onclick = () => this.show(b.dataset.tab as Tab);
    document.getElementById('menuFly')!.onclick = () => this.hooks.onFly();
    document.getElementById('menuWindow')!.onclick = () => this.close();
    this.root.addEventListener('click', e => { if (e.target === this.root) this.close(); });
    addEventListener('keydown', e => { if (this.open && e.code === 'Escape' && !this.keyboard.capture) this.close(); });
  }

  show(tab: Tab = this.tab): void {
    this.tab = tab;
    this.open = true;
    this.root.hidden = false;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    this.render();
  }

  close(): void {
    if (this.keyboard.capture) this.keyboard.capture = null;
    this.open = false;
    this.root.hidden = true;
    this.note = '';
    this.hooks.onClose();
  }

  toggle(): void { if (this.open) this.close(); else this.show(); }

  refresh(): void { if (this.open) this.render(); }

  private render(): void {
    const k = (a: Action) => `<kbd>${keyLabel(this.bindings.key(a))}</kbd>`;
    if (this.tab === 'help') {
      this.body.innerHTML = `
        <p>Hold ${k('collectiveUp')} to start the engine and keep holding while the rotor spools up until the skids lift. Fly to the pad under the <b>amber beacon</b> and set it down. Touch down under 3.5 m/s vertical and 50 km/h forward for a clean landing with no damage.</p>
        <div class="keys">
          <span class="h">Control</span><span class="h">Keys</span>
          <span>Collective</span><span>${k('collectiveUp')} up · ${k('collectiveDown')} down (springs back to neutral)</span>
          <span>Pitch</span><span>${k('pitchForward')} ${k('pitchBack')} or mouse ↕</span>
          <span>Roll</span><span>${k('rollLeft')} ${k('rollRight')} or mouse ↔</span>
          <span>Pedals</span><span>${k('yawLeft')} ${k('yawRight')}</span>
          <span>Free look</span><span>hold ${k('freeLook')} or right mouse</span>
          <span>Assists</span><span>${k('toggleStability')} ${k('toggleAutoHover')} ${k('toggleEnvelope')} ${k('toggleTurnCoord')}</span>
          <span>Camera · Reset</span><span>${k('camera')} · ${k('reset')}</span>
          <span>Settings</span><span>${k('settings')} · Esc closes</span>
        </div>
        <p><b>Fly fullscreen</b> captures the keyboard, so Ctrl+W lowers the collective instead of closing the tab (Chrome and Edge). In a window, the browser asks before leaving while the engine runs.</p>
        <p><b>It carries momentum.</b> Pitch and roll set a rotation rate, so the aircraft keeps turning after you let go. Neutral collective only just holds you up. Pull the nose up at speed and the rotor bites: you climb as you slow. Never brake, turn and descend at the same time.</p>
        <p><b>Mouse:</b> click the view to capture the mouse; Esc releases it. ${k('sensDown')} ${k('sensUp')} change sensitivity.</p>`;
    } else if (this.tab === 'controls') {
      const groups = [...new Set(ACTIONS.map(a => a.group))];
      this.body.innerHTML = groups.map(g => `<h3>${g}</h3><div class="binds">${ACTIONS.filter(a => a.group === g).map(a =>
        `<span>${a.label}</span><button class="bind" data-action="${a.id}">${keyLabel(this.bindings.key(a.id))}</button>`).join('')}</div>`).join('')
        + `<div class="menu-row"><button class="tg" id="bindReset">Reset to defaults</button><span class="note" role="status">${this.note}</span></div>`;
      for (const b of this.body.querySelectorAll<HTMLButtonElement>('button.bind')) b.onclick = () => this.capture(b, b.dataset.action as Action);
      document.getElementById('bindReset')!.onclick = () => { this.bindings.resetDefaults(); this.note = 'Default keys restored'; this.render(); };
    } else if (this.tab === 'assists') {
      this.body.innerHTML = ASSIST_ROWS.map(r => `
        <label class="check"><input type="checkbox" id="as-${r.k}" ${this.prefs.assists[r.k] ? 'checked' : ''}>
          <span><b>${r.label}</b> ${k(({ stability: 'toggleStability', autoHover: 'toggleAutoHover', envelope: 'toggleEnvelope', turnCoord: 'toggleTurnCoord' } as const)[r.k])}<br><small>${r.detail}</small></span></label>`).join('');
      for (const r of ASSIST_ROWS) (document.getElementById(`as-${r.k}`) as HTMLInputElement).onchange = e => this.hooks.onAssist(r.k, (e.target as HTMLInputElement).checked);
    } else {
      this.body.innerHTML = `
        <label class="range"><span>Sensitivity <output id="sensOut">${Math.round(this.prefs.sensitivity * 100)}%</output></span>
          <input type="range" id="sens" min="0.3" max="3" step="0.05" value="${this.prefs.sensitivity}"></label>
        <label class="check"><input type="checkbox" id="inv" ${this.prefs.invertY ? 'checked' : ''}><span><b>Invert Y</b><br><small>On: pull back to raise the nose. Off: push forward to raise the nose.</small></span></label>`;
      const sens = document.getElementById('sens') as HTMLInputElement, inv = document.getElementById('inv') as HTMLInputElement;
      sens.oninput = () => { document.getElementById('sensOut')!.textContent = Math.round(+sens.value * 100) + '%'; this.hooks.onMouse(+sens.value, inv.checked); };
      inv.onchange = () => this.hooks.onMouse(+sens.value, inv.checked);
    }
  }

  private capture(btn: HTMLButtonElement, a: Action): void {
    btn.textContent = 'Press a key…';
    btn.classList.add('listening');
    this.keyboard.capture = code => {
      if (code === 'Escape') { this.note = 'Cancelled'; this.render(); return; }
      const moved = this.bindings.bind(a, code);
      const label = (id: Action) => ACTIONS.find(x => x.id === id)!.label;
      this.note = moved ? `${label(moved)} moved to ${keyLabel(this.bindings.key(moved))}` : `${label(a)}: ${keyLabel(code)}`;
      this.render();
    };
  }
}
