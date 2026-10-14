import { ACTIONS, keyLabel, type Action, type Bindings } from '../input/bindings';
import type { Keyboard } from '../input/keyboard';
import type { Prefs } from '../game/prefs';
import type { AssistFlags } from '../sim/state';
import type { Lesson } from '../tutorial/lessons';
import type { Volumes } from '../audio/combatSound';
import { SKIES, SKY_LABEL, skyId, type SkyId } from '../world/sky';

export type Tab = 'help' | 'controls' | 'assists' | 'mouse' | 'sound' | 'graphics' | 'multiplayer' | 'tutorial';

export interface MultiplayerView {
  configured: boolean;
  status: 'solo' | 'connecting' | 'connected' | 'closed' | 'rejected';
  detail: string;
  room: string;
  players: { name: string; self: boolean }[];
  ping: number;
}

export interface MenuHooks {
  onAssist(k: keyof AssistFlags, v: boolean): void;
  onMouse(sensitivity: number, invertY: boolean): void;
  onFly(): void;          // fullscreen + keyboard lock
  onClose(): void;
  multiplayer(): MultiplayerView;
  /** `sky` only matters if the room is new: an existing room keeps its own. */
  onJoin(room: string, name: string, sky: SkyId): void;
  onLeave(): void;
  defaultName(): string;
  tutorial(): { lessons: Lesson[]; done: string[]; current: Lesson | null };   // current: loaded, flying or finished
  onLesson(id: string): void;
  onLessonRestart(): void;
  onLeaveTutorial(): void;
  soundOn(): boolean;
  onSoundToggle(): void;
  onVolume(v: Volumes): void;
  /** Your sky setting, and the room's while you're in one (it overrides yours). */
  graphics(): { high: boolean; sky: SkyId; roomSky: SkyId | null };
  onQuality(high: boolean): void;
  onSky(sky: SkyId): void;
}

const ASSIST_ROWS: { k: keyof AssistFlags; label: string; detail: string }[] = [
  { k: 'stability', label: 'Stability assist', detail: 'Damps rotation and holds the attitude you release at. Trims out rotor torque and holds heading.' },
  { k: 'autoHover', label: 'Auto-hover', detail: 'Flies the collective for you: neutral holds altitude. It never tilts the aircraft, so you still stop it yourself.' },
  { k: 'envelope', label: 'Envelope limits', detail: 'Caps pitch at 35° and bank at 50°.' },
  { k: 'turnCoord', label: 'Turn coordination', detail: 'Yaws the nose into banked turns above about 30 km/h.' },
];

/** Settings overlay: help, key rebinding, assists, mouse, sound, graphics, multiplayer and the tutorial. Pauses the game while open. */
export class SettingsMenu {
  open = false;
  private root = document.getElementById('menu')!;
  private body = document.getElementById('menuBody')!;
  private tab: Tab = 'help';
  private note = '';
  private roomDraft = '';
  private skyDraft: SkyId;

  constructor(private bindings: Bindings, private keyboard: Keyboard, private prefs: Prefs, private hooks: MenuHooks) {
    this.skyDraft = prefs.sky;
    for (const b of this.root.querySelectorAll<HTMLButtonElement>('[data-tab]')) b.onclick = () => this.show(b.dataset.tab as Tab);
    document.getElementById('menuFly')!.onclick = () => this.hooks.onFly();
    document.getElementById('menuWindow')!.onclick = () => this.close();
    document.getElementById('menuLeaveTut')!.onclick = () => { this.hooks.onLeaveTutorial(); this.close(); };
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

  /** Prefill the room field and its time of day (from a ?room= link). */
  setRoom(room: string, sky?: SkyId): void { this.roomDraft = room; if (sky) this.skyDraft = sky; }

  refresh(): void { if (this.open) this.render(); }

  private render(): void {
    const k = (a: Action) => `<kbd>${keyLabel(this.bindings.key(a))}</kbd>`;
    document.getElementById('menuLeaveTut')!.hidden = !this.hooks.tutorial().current;
    if (this.tab === 'help') {
      this.body.innerHTML = `
        <p>Hold ${k('collectiveUp')} until the skids lift. Hunt the orange targets on the minimap, or other pilots in a multiplayer room.</p>
        <div class="keys">
          <span>Collective</span><span>${k('collectiveUp')} up · ${k('collectiveDown')} down</span>
          <span>Pitch · Roll</span><span>${k('pitchForward')} ${k('pitchBack')} · ${k('rollLeft')} ${k('rollRight')} or mouse</span>
          <span>Pedals</span><span>${k('yawLeft')} ${k('yawRight')}</span>
          <span>Fire · Switch · Flares</span><span>${k('fire')} · ${k('weaponToggle')} · ${k('flares')}</span>
        </div>
        <p><b>Missiles:</b> hold a target in the dashed circle until LOCK, then fire. Warning tone means flares. Sit still on an <b>H</b> pad for 5 s to rearm.</p>
        <p><b>It carries momentum:</b> the aircraft keeps turning after you let go, and pulling the nose up at speed makes you climb.</p>
        <p>New to helicopters? The Tutorial tab teaches the basics step by step. Fly fullscreen so Ctrl+W can't close the tab. Every key is listed under Controls.</p>
        <p class="credit">AH-6 model: <a href="https://sketchfab.com/3d-models/helicopters-mh-6-little-bird-69cb05db3fc3483cb729734262abf28e" target="_blank" rel="noopener">“Helicopters MH-6 Little Bird”</a> by mario low poly, <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>.</p>`;
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
    } else if (this.tab === 'multiplayer') {
      this.renderMultiplayer();
    } else if (this.tab === 'tutorial') {
      this.renderTutorial();
    } else if (this.tab === 'sound') {
      this.renderSound();
    } else if (this.tab === 'graphics') {
      this.renderGraphics();
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

  private renderSound(): void {
    const on = this.hooks.soundOn(), v = this.prefs.volume;
    const rows: [keyof Volumes, string, string][] = [
      ['master', 'Master', 'Everything at once'],
      ['rotor', 'Helicopter', 'Rotor and engine (quieter still in third person)'],
      ['weapons', 'Weapons', 'Miniguns, missile launches, explosions, hit marker'],
      ['alerts', 'Alerts', 'Lock tones, missile warning, tutorial chimes'],
    ];
    this.body.innerHTML = `
      <div class="menu-row"><button class="tg" id="sndToggle" aria-pressed="${on}"><span class="led"></span>Sound ${on ? 'on' : 'off'}</button>
        <span class="note">${on ? '' : 'Volumes apply once sound is on'}</span></div>
      ${rows.map(([k, label, detail]) => `
        <label class="range"><span>${label} <output id="out-${k}">${Math.round(v[k] * 100)}%</output> <small>${detail}</small></span>
          <input type="range" id="vol-${k}" min="0" max="1.5" step="0.05" value="${v[k]}"></label>`).join('')}
      <div class="menu-row"><button class="tg" id="sndReset">Reset to defaults</button></div>`;
    document.getElementById('sndToggle')!.onclick = () => { this.hooks.onSoundToggle(); this.render(); };
    for (const [k] of rows) {
      const input = document.getElementById(`vol-${k}`) as HTMLInputElement;
      input.oninput = () => {
        v[k] = +input.value;
        document.getElementById(`out-${k}`)!.textContent = Math.round(v[k] * 100) + '%';
        this.hooks.onVolume(v);
      };
    }
    document.getElementById('sndReset')!.onclick = () => { for (const [k] of rows) v[k] = 1; this.hooks.onVolume(v); this.render(); };
  }

  private renderGraphics(): void {
    const g = this.hooks.graphics(), shown = g.roomSky ?? g.sky;
    const SKY_NOTE: Record<SkyId, string> = { noon: 'High sun, long view.', golden: 'Low sun from the west, long shadows across the valleys.', overcast: 'Flat grey light; the haze closes in to about 900 m, so you see others late.' };
    this.body.innerHTML = `
      <h3>Quality</h3>
      <div class="lessons">
        <button class="tg" id="gfxHigh" aria-pressed="${g.high}"><span class="led"></span>High</button><span>Sharp on high-density screens, tree shadows, full terrain detail out to 1 km.</span>
        <button class="tg" id="gfxLow" aria-pressed="${!g.high}"><span class="led"></span>Low</button><span>For laptops: one pixel per pixel, no tree shadows, less terrain detail and trees drawn to about 1.1 km.</span>
      </div>
      <h3>Time of day</h3>
      ${g.roomSky ? `<p class="note">Set by the room: ${SKY_LABEL[g.roomSky]}. Everyone in a room flies in the same weather.</p>` : ''}
      <div class="lessons">${SKIES.map(id => `
        <button class="tg" data-sky="${id}" aria-pressed="${shown === id}" ${g.roomSky ? 'disabled' : ''}><span class="led"></span>${SKY_LABEL[id]}</button><span>${SKY_NOTE[id]}</span>`).join('')}
      </div>`;
    document.getElementById('gfxHigh')!.onclick = () => { this.hooks.onQuality(true); this.render(); };
    document.getElementById('gfxLow')!.onclick = () => { this.hooks.onQuality(false); this.render(); };
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('[data-sky]')) b.onclick = () => { this.hooks.onSky(b.dataset.sky as SkyId); this.render(); };
  }

  private renderTutorial(): void {
    const t = this.hooks.tutorial(), mp = this.hooks.multiplayer();
    const inRoom = mp.status === 'connecting' || mp.status === 'connected';
    const groups = [...new Set(t.lessons.map(l => l.group))];
    this.body.innerHTML = `
      <p>Short lessons with gates to fly through. Each assist lesson flies the same task twice, first with the assist on and then off, and compares the two runs. ${inRoom ? '<b>Lessons are solo only:</b> leave the room to fly one.' : ''}</p>
      ${t.current ? `<div class="menu-row"><span class="note">Lesson: ${t.current.title}</span><button class="tg" id="tutRestart">Restart lesson</button></div>` : ''}
      ${groups.map(g => `<h3>${g}</h3><div class="lessons">${t.lessons.filter(l => l.group === g).map(l => `
        <button class="tg" data-lesson="${l.id}" aria-pressed="${t.done.includes(l.id)}" ${inRoom ? 'disabled' : ''}><span class="led"></span>${l.title}</button><span>${l.summary}</span>`).join('')}</div>`).join('')}
      <p class="note">${t.done.length} of ${t.lessons.length} lessons completed</p>`;
    for (const b of this.body.querySelectorAll<HTMLButtonElement>('[data-lesson]')) b.onclick = () => this.hooks.onLesson(b.dataset.lesson!);
    const restart = document.getElementById('tutRestart');
    if (restart) restart.onclick = () => this.hooks.onLessonRestart();
  }

  private renderMultiplayer(): void {
    const mp = this.hooks.multiplayer();
    const esc = (t: string) => t.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
    if (!mp.configured) {
      this.body.innerHTML = '<p>Multiplayer needs a game server, and this build isn\u2019t connected to one. Run <kbd>npm run server</kbd> and <kbd>npm run dev</kbd> locally, or set <kbd>VITE_SERVER_URL</kbd> when building.</p>';
      return;
    }
    if (mp.status === 'connecting' || mp.status === 'connected') {
      const sky = this.hooks.graphics().roomSky;
      const link = `${location.origin}${location.pathname}?room=${encodeURIComponent(mp.room)}${sky ? `&sky=${sky}` : ''}`;
      this.body.innerHTML = `
        <p>${mp.status === 'connecting' ? 'Connecting to' : 'Flying in'} room <b>${esc(mp.room)}</b>${mp.status === 'connected' ? ` · ping ${Math.round(mp.ping)} ms` : ''}</p>
        <div class="menu-row"><input class="field" id="mpLink" readonly value="${esc(link)}" aria-label="Room link"><button class="tg" id="mpCopy">Copy link</button></div>
        <h3>Pilots</h3>
        <ul class="roster">${mp.players.map(p => `<li>${esc(p.name)}${p.self ? ' <small>(you)</small>' : ''}</li>`).join('') || '<li><small>Waiting for the server…</small></li>'}</ul>
        <div class="menu-row"><button class="tg" id="mpLeave">Leave room and fly solo</button><span class="note" role="status">${this.note}</span></div>`;
      document.getElementById('mpCopy')!.onclick = () => {
        const field = document.getElementById('mpLink') as HTMLInputElement;
        navigator.clipboard?.writeText(link).then(() => { this.note = 'Link copied'; this.render(); }, () => { field.select(); this.note = 'Press Ctrl+C to copy'; this.render(); });
      };
      document.getElementById('mpLeave')!.onclick = () => { this.note = ''; this.hooks.onLeave(); this.render(); };
      return;
    }
    const problem = mp.status === 'closed' || mp.status === 'rejected' ? `<p class="warn">${esc(mp.detail)}</p>` : '';
    this.body.innerHTML = `${problem}
      <p>Fly in the same world as your friends. Create a room and send them the link, or type the code of a room someone shared. Up to 8 pilots per room.</p>
      <label class="range"><span>Your name</span><input class="field" id="mpName" maxlength="16" value="${esc(this.hooks.defaultName())}"></label>
      <label class="range"><span>Room code</span><input class="field" id="mpRoom" maxlength="24" placeholder="e.g. friday-flight" value="${esc(this.roomDraft)}"></label>
      <label class="range"><span>Time of day <small>for a new room; an existing room keeps its own</small></span>
        <select class="field" id="mpSky">${SKIES.map(id => `<option value="${id}" ${id === this.skyDraft ? 'selected' : ''}>${SKY_LABEL[id]}</option>`).join('')}</select></label>
      <div class="menu-row"><button class="go" id="mpJoin">Join room</button><button class="tg" id="mpCreate">Create new room</button></div>`;
    const name = () => (document.getElementById('mpName') as HTMLInputElement).value;
    const roomField = document.getElementById('mpRoom') as HTMLInputElement;
    roomField.oninput = () => { this.roomDraft = roomField.value; };
    const skyField = document.getElementById('mpSky') as HTMLSelectElement;
    skyField.onchange = () => { this.skyDraft = skyId(skyField.value); };
    const join = () => { if (roomField.value.trim()) this.hooks.onJoin(roomField.value, name(), this.skyDraft); else roomField.focus(); };
    document.getElementById('mpJoin')!.onclick = join;
    for (const id of ['mpName', 'mpRoom']) (document.getElementById(id) as HTMLInputElement).onkeydown = e => { if (e.key === 'Enter') join(); };
    document.getElementById('mpCreate')!.onclick = () => {
      const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), b => 'abcdefghjkmnpqrstuvwxyz23456789'[b % 31]).join('') + '-' + Math.floor(10 + Math.random() * 90);
      this.roomDraft = code;
      this.hooks.onJoin(code, name(), this.skyDraft);
    };
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
