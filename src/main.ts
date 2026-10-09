import './style.css';
import { Euler, Vector3 } from 'three';
import { createScene, SUN_DIR } from './render/scene';
import { buildHeliModel } from './render/heliModel';
import { Dust } from './render/dust';
import { CameraRig } from './render/camera';
import { Cockpit } from './render/cockpit';
import { Effects } from './render/effects';
import { TargetModels } from './render/targets';
import { RemoteFleet } from './render/remotes';
import { createLayout } from './world/layout';
import { createWorld } from './world/world';
import { buildWorldMeshes } from './world/meshes';
import { createState, type AssistFlags, type HeliState, type PilotInput } from './sim/state';
import { params } from './sim/params';
import { SIM_DT, step } from './sim/step';
import { HUB } from './sim/geometry';
import { clamp, smooth } from './sim/math';
import { Landings } from './game/landings';
import { Session } from './game/session';
import { loadPrefs, savePrefs } from './game/prefs';
import { Combat, type CombatEvent } from './combat/combat';
import { createLoadout, type WeaponInput, type WeaponMode } from './combat/loadout';
import { clearLock, updateLock, type LockCandidate } from './combat/lock';
import { soloView, type CombatView } from './combat/view';
import { Bindings, keyLabel, type Action } from './input/bindings';
import { Keyboard } from './input/keyboard';
import { Mouse } from './input/mouse';
import { enterFlightMode, setLeaveGuard } from './input/keyboardLock';
import { Hud } from './ui/hud';
import { AimHud } from './ui/aim';
import { Minimap, type MapBlip } from './ui/minimap';
import { KillFeed, escapeHtml } from './ui/killFeed';
import { Messages } from './ui/messages';
import { SettingsMenu, type MultiplayerView } from './ui/settingsMenu';
import { RotorSound } from './audio/rotorSound';
import { CombatSound } from './audio/combatSound';
import { NetSession, type NetEvent, type NetStatus, type RemoteView } from './net/client';
import { NET_DT, roomCode, SUBSTEPS } from './net/protocol';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- world & rendering
const layout = createLayout();
const world = createWorld(layout);
const kit = createScene($('view'));
buildWorldMeshes(kit.scene, kit.renderer, layout);
const heli = buildHeliModel(kit.scene);
const cockpit = new Cockpit(kit.renderer);
heli.root.add(cockpit.group);
const dust = new Dust(kit.scene, kit.renderer);
const effects = new Effects(kit.scene, kit.renderer, world);
const targetModels = new TargetModels(kit.scene);
const rig = new CameraRig(kit.camera);
const remotes = new RemoteFleet(kit.scene, kit.renderer);

// ---- game state
const s = createState();
const landings = new Landings(layout.pads);
const session = new Session(s, world, landings);
const prefs = loadPrefs();
const bindings = new Bindings();
const messages = new Messages($('msg'), $('m1'), $('m2'));
const hud = new Hud();
const aim = new AimHud();
const minimap = new Minimap($<HTMLCanvasElement>('minimap'), layout, $('mapRange'));
const feed = new KillFeed($('feed'));
const sound = new RotorSound();
const combatSound = new CombatSound();

// solo: the browser is the authority for weapons and practice targets
const SOLO_ID = 1;
const soloCombat = new Combat(world, layout);
soloCombat.add(SOLO_ID, 'You', s);
let weaponMode: WeaponMode = 'gun';
let flareRequested = false;
const netLock = createLoadout().lock;   // client-side seeker in multiplayer, for instant tones and boxes

// ---- multiplayer
const SERVER_URL: string = import.meta.env.VITE_SERVER_URL || (import.meta.env.DEV ? `ws://${location.hostname}:8787` : '');
const NEUTRAL: PilotInput = { pitch: 0, roll: 0, yaw: 0, collective: 0 };
let net: NetSession | null = null;
let netStatus: { status: MultiplayerView['status']; detail: string; room: string } = { status: 'solo', detail: '', room: '' };
let resetRequested = false;
let tuning: { lock(): void } | null = null;

// ---- input & menus
const mouse: Mouse = new Mouse(kit.renderer.domElement, (): boolean => keyboard.held('freeLook'), locked => {
  $('bMouse').setAttribute('aria-pressed', String(locked));
  if (locked) info('Mouse control on', 'Esc releases the mouse', 1.6);
}, (): boolean => !menu.open);
const keyboard: Keyboard = new Keyboard(bindings, onAction, (): boolean => mouse.locked && !menu.open);
mouse.sensitivity = prefs.sensitivity;
mouse.invertY = prefs.invertY;

const menu: SettingsMenu = new SettingsMenu(bindings, keyboard, prefs, {
  onAssist: (k, v) => setAssist(k, v),
  onMouse: (sens, inv) => { prefs.sensitivity = mouse.sensitivity = sens; prefs.invertY = mouse.invertY = inv; savePrefs(prefs); },
  onFly: () => void flyFullscreen(),
  onClose: () => syncKeyLabels(),
  multiplayer: () => ({ configured: !!SERVER_URL, ...netStatus, players: net?.roster ?? [], ping: net?.ping ?? 0 }),
  onJoin: (room, name) => joinRoom(room, name),
  onLeave: () => leaveRoom(),
  defaultName: () => prefs.name,
});

function joinRoom(rawRoom: string, rawName: string): void {
  if (!SERVER_URL) return;
  const room = roomCode(rawRoom), name = rawName.trim().slice(0, 16) || 'Pilot';
  prefs.name = name; savePrefs(prefs);
  net?.close();
  remotes.clear();
  clearLock(netLock);
  netStatus = { status: 'connecting', detail: '', room };
  net = new NetSession(SERVER_URL, room, name, s, world, layout, {
    onStatus: (status: NetStatus, detail?: string) => {
      netStatus = { status, detail: detail ?? '', room };
      if (status === 'connected') { landings.onReset(); rig.snap(); info(`Joined ${room}`, 'Share the room link from Settings → Multiplayer', 3); }
      if (status === 'closed' || status === 'rejected') { messages.show({ title: status === 'rejected' ? 'Can’t join' : 'Disconnected', detail: (detail ?? '') + '\nYou are flying solo', kind: 'bad', ttl: 5 }); dropToSolo(); }
      menu.refresh();
    },
    onEvent: (e: NetEvent) => {
      if (e.id === net?.id) return;
      if (e.kind === 'join') feed.push(`<b>${escapeHtml(e.name)}</b> joined`);
      else if (e.kind === 'leave') feed.push(`<b>${escapeHtml(e.name)}</b> left`);
      menu.refresh();
    },
    onCombat: events => onCombat(events, net?.id ?? -1, id => net?.roster.find(p => p.id === id)?.name ?? '?'),
    onRespawn: () => { landings.onReset(); rig.snap(); messages.clear(); info('Respawned', 'Raise the collective to start the engine', 2.5); },
    onCrash: reason => crashed(reason),
  });
  history.replaceState(null, '', `?room=${encodeURIComponent(room)}`);
  tuning?.lock();
  menu.refresh();
}

/** Back to the offline game, keeping the reason on screen. */
function dropToSolo(): void {
  net?.close();
  net = null;
  remotes.clear();
  session.reset();
  soloCombat.revive(SOLO_ID);
  rig.snap();
}

function leaveRoom(): void {
  dropToSolo();
  netStatus = { status: 'solo', detail: '', room: '' };
  history.replaceState(null, '', location.pathname);
  messages.show(session.reset());
}

function info(title: string, detail: string, ttl: number): void { messages.show({ title, detail, kind: 'info', ttl }); }

function crashed(reason: string): void {
  messages.show({ title: 'Destroyed', detail: `${reason}\nRespawning in 5 s · ${keyLabel(bindings.key('reset'))} to respawn now`, kind: 'bad', ttl: 0 });
}

/** Hits, kills and explosions from whichever side is the authority (this browser or the server). */
function onCombat(events: CombatEvent[], selfId: number, nameOf: (id: number) => string): void {
  const name = (id: number) => (id === selfId ? 'You' : escapeHtml(nameOf(id)));
  for (const e of events) {
    switch (e.kind) {
      case 'hit':
        effects.hit(e.x, e.y, e.z, e.weapon === 'missile');
        if (e.shooter === selfId && e.victim !== selfId) { aim.hit(performance.now()); combatSound.hitMarker(); }
        break;
      case 'explosion':
        effects.explosion(e.x, e.y, e.z, e.size);
        combatSound.explosion(kit.camera.position.distanceTo(new Vector3(e.x, e.y, e.z)));
        break;
      case 'launch':
        if (e.shooter === selfId) combatSound.launch();
        break;
      case 'kill': {
        const how = e.weapon === 'gun' ? 'gunned down' : e.weapon === 'missile' ? 'shot down' : 'forced down';
        if (e.killer !== null) feed.push(`<b>${name(e.killer)}</b> <i>${how}</i> <b>${name(e.victim)}</b>`, e.killer === selfId ? 'self' : 'kill');
        else feed.push(`<b>${name(e.victim)}</b> crashed`, 'kill');
        break;
      }
      case 'targetDown':
        if (e.shooter === selfId) feed.push(e.target >= 0 && soloCombat.targets.find(t => t.id === e.target)?.kind === 'drone' ? 'Drone destroyed' : 'Ground target destroyed', 'self', 4);
        break;
      case 'rearmed':
        if (e.id === selfId) info('Rearmed and repaired', '', 2);
        break;
      case 'flare':
        break;
    }
  }
}

const ASSIST_LABEL: Record<keyof AssistFlags, string> = { stability: 'Stability assist', autoHover: 'Auto-hover', envelope: 'Envelope limits', turnCoord: 'Turn coordination' };
function setAssist(k: keyof AssistFlags, v: boolean): void {
  prefs.assists[k] = v;
  savePrefs(prefs);
  s.altHold = s.hdgHold = s.attHold = null;
  syncButtons();
  menu.refresh();
  if (!s.crashed) info(`${ASSIST_LABEL[k]} ${v ? 'on' : 'off'}`, '', 1.4);
}

function onAction(a: Action): void {
  if (a === 'settings') { menu.toggle(); return; }
  if (menu.open) return;
  switch (a) {
    case 'toggleStability': setAssist('stability', !prefs.assists.stability); break;
    case 'toggleAutoHover': setAssist('autoHover', !prefs.assists.autoHover); break;
    case 'toggleEnvelope': setAssist('envelope', !prefs.assists.envelope); break;
    case 'toggleTurnCoord': setAssist('turnCoord', !prefs.assists.turnCoord); break;
    case 'weaponToggle': weaponMode = weaponMode === 'gun' ? 'missile' : 'gun'; clearLock(netLock); break;
    case 'flares': flareRequested = true; break;
    case 'mapRange': minimap.cycleRange(); break;
    case 'camera': $('bCam').firstElementChild!.textContent = 'Cam: ' + rig.cycle(); syncCameraView(); break;
    case 'reset': reset(); break;
    case 'sound': toggleSound(); break;
    case 'invertY':
      prefs.invertY = mouse.invertY = !prefs.invertY; savePrefs(prefs);
      info(`Invert Y ${prefs.invertY ? 'on' : 'off'}`, prefs.invertY ? 'Pull back to raise the nose' : 'Push forward to raise the nose', 1.4);
      break;
    case 'sensUp': case 'sensDown':
      prefs.sensitivity = mouse.sensitivity = clamp(prefs.sensitivity * (a === 'sensUp' ? 1.25 : 0.8), 0.3, 3); savePrefs(prefs);
      info('Mouse sensitivity', Math.round(prefs.sensitivity * 100) + '%', 1.2);
      break;
  }
}

function reset(): void {
  if (net) { resetRequested = true; return; }          // the server respawns us; onRespawn follows
  messages.show(session.reset());
  soloCombat.revive(SOLO_ID);
  rig.snap();
}
function syncCameraView(): void { $('vignette').hidden = rig.mode !== 'Cockpit'; }
function toggleSound(): void {
  const on = sound.toggle();
  combatSound.setEnabled(on);
  $('bSound').setAttribute('aria-pressed', String(on));
}

async function flyFullscreen(): Promise<void> {
  const locked = await enterFlightMode();
  menu.close();
  mouse.lock();
  info(locked ? 'Keyboard captured' : 'Fullscreen', locked ? 'Hold Esc to leave fullscreen' : 'This browser can’t capture Ctrl+W; it will ask before leaving instead', 2.5);
}

function syncButtons(): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-assist]')) b.setAttribute('aria-pressed', String(prefs.assists[b.dataset.assist as keyof AssistFlags]));
}
function syncKeyLabels(): void {
  for (const k of document.querySelectorAll<HTMLElement>('kbd[data-key]')) k.textContent = keyLabel(bindings.key(k.dataset.key as Action));
}

for (const b of document.querySelectorAll<HTMLButtonElement>('[data-assist]')) {
  const k = b.dataset.assist as keyof AssistFlags;
  b.onclick = () => setAssist(k, !prefs.assists[k]);
}
// scroll zooms the current view; one notch ≈ 12 %
kit.renderer.domElement.addEventListener('wheel', e => {
  e.preventDefault();
  if (menu.open) return;
  const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
  rig.zoom(clamp(px / 100, -3, 3));
}, { passive: false });
$('bFly').onclick = () => void flyFullscreen();
$('bMouse').onclick = () => { if (mouse.locked) mouse.unlock(); else mouse.lock(); };
$('bCam').onclick = () => onAction('camera');
$('bReset').onclick = reset;
$('bSound').onclick = toggleSound;
$('bSettings').onclick = () => menu.show();
// buttons keep focus after a click; stop Space/Enter from re-triggering them mid-flight
for (const b of document.querySelectorAll('button')) b.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); });

// ---- loop
const _hub = new Vector3(), _eu = new Euler();
let last = performance.now(), accum = 0, simT = 0, lastPanel = 0, lastMap = 0;

function frame(now: number): void {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  mouse.update(dt);
  const kb = keyboard.read(dt);
  const input: PilotInput = {
    pitch: clamp(kb.pitch + mouse.stick.pitch, -1, 1),
    roll: clamp(kb.roll + mouse.stick.roll, -1, 1),
    yaw: kb.yaw,
    collective: kb.collective,
  };
  const weapon: WeaponInput = { fire: !menu.open && keyboard.held('fire'), mode: weaponMode, flare: flareRequested };

  // solo pauses under the menu; a room can't, so we keep sending neutral inputs instead
  const live = net ? net.ready : !menu.open;
  if (live) {
    const wasOn = s.engineOn, wasCrashed = s.crashed;
    accum += dt;
    while (accum >= NET_DT) {
      if (net) {
        net.tick(menu.open ? NEUTRAL : input, prefs.assists, { reset: resetRequested }, weapon);
        resetRequested = false;
      } else {
        for (let k = 0; k < SUBSTEPS; k++) { step(s, input, prefs.assists, world, SIM_DT, simT, params); simT += SIM_DT; }
        const events = soloCombat.tick(NET_DT, new Map([[SOLO_ID, weapon]]), {
          padUnder: st => landings.padUnder(st),
          respawn: () => { session.reset(); rig.snap(); messages.clear(); info('Respawned', 'Raise the collective to start the engine', 2.5); },
        });
        onCombat(events, SOLO_ID, () => 'You');
      }
      weapon.flare = flareRequested = false;
      accum -= NET_DT;
    }
    if (!wasOn && s.engineOn) info('Engine start', 'Keep holding until the skids lift', 2.5);
    const n = session.update(dt, !net);
    if (n && n.title === 'Crashed') crashed(n.detail.split('\n')[0]);
    else if (n && !(n.title === 'Leaving the area' && messages.busy)) messages.show(n);
    else if (!net && !wasCrashed && s.crashed && s.hit) crashed(s.hit);
    setLeaveGuard(s.engineOn && !s.crashed);
  } else accum = 0;

  // our aircraft is drawn at the smoothed pose in multiplayer, so corrections never pop
  let viewState: HeliState = s;
  if (net) { net.updateView(dt); viewState = { ...s, pos: net.viewPos, q: net.viewQ }; }
  const remoteViews: RemoteView[] = net ? net.remoteViews() : [];
  remotes.update(remoteViews, dt);

  // combat as the screen shows it; in multiplayer our seeker runs locally for instant feedback
  if (net) {
    if (weaponMode === 'missile' && !s.crashed) {
      const cands: LockCandidate[] = remoteViews.filter(r => !r.crashed).map(r => ({ id: r.id, pos: r.pos }));
      for (const t of net.targets) if (t.alive) cands.push({ id: t.id, pos: t.pos });
      updateLock(netLock, viewState.pos, viewState.q, cands, world, dt);
    } else clearLock(netLock);
  }
  const cv: CombatView = net ? net.combatView(netLock) : soloView(soloCombat, SOLO_ID);
  const alive = !s.crashed && !cv.self.dead;
  const localFiring = alive && weapon.fire && weaponMode === 'gun' && cv.self.ammo > 0;
  const lockPos = (id: number | null): Vector3 | null => {
    if (id === null) return null;
    return remoteViews.find(r => r.id === id)?.pos ?? cv.targets.find(t => t.id === id && t.alive)?.pos ?? null;
  };

  // aircraft
  const rpm = s.omega / params.rotor.omegaNominal;
  heli.root.position.copy(viewState.pos);
  heli.root.quaternion.copy(viewState.q);
  heli.mainRotor.rotation.y += rpm * 30 * dt;
  heli.tailRotor.rotation.x += rpm * 70 * dt;
  heli.rotorTilt.rotation.x = -input.pitch * 0.06 * Math.min(1, rpm);
  heli.rotorTilt.rotation.z = -input.roll * 0.06 * Math.min(1, rpm);
  heli.disc.material.opacity = 0.14 * smooth(0.3, 0.9, rpm);
  for (const g of heli.guns) if (localFiring) g.rotation.z += 60 * dt;
  heli.missiles.forEach((m, i) => { m.visible = i < cv.self.missiles; });

  // weapons, targets and smoke
  if (localFiring) effects.gunfire(-1, viewState.pos, viewState.q, s.vel, dt);
  for (const r of remoteViews) {
    if (cv.firing.has(r.id) && !r.crashed) effects.gunfire(r.id, r.pos, r.q, new Vector3(), dt);
    if (r.crashed) effects.burning(r.pos.x, r.pos.y, r.pos.z, dt);
  }
  if (s.crashed) effects.burning(viewState.pos.x, viewState.pos.y, viewState.pos.z, dt);
  effects.syncMissiles(cv.missiles, dt);
  effects.syncFlares(cv.flares, dt);
  targetModels.update(cv.targets, dt, effects);

  // rotor wash
  _hub.copy(HUB).applyQuaternion(viewState.q).add(viewState.pos);
  const gy = world.groundAt(_hub.x, _hub.z, _hub.y);
  const loadG = s.thrust / (params.mass * params.g);
  dust.update(dt, _hub.x, _hub.z, gy, Math.min(1, rpm) * smooth(0.5, 1.0, loadG) * (1 - smooth(4, 15, _hub.y - gy)));

  const lk = cv.self.lock;
  const stores = { mode: weaponMode, ammo: cv.self.ammo, missiles: cv.self.missiles, flares: cv.self.flares, lock: lk.locked ? 'locked' as const : lk.targetId !== null ? 'search' as const : 'none' as const, warning: cv.self.warning };
  cockpit.update(now, viewState, input, params, stores);
  rig.update(dt, viewState, world, mouse.look, rpm);
  kit.sky.position.copy(kit.camera.position);
  kit.sun.position.copy(viewState.pos).addScaledVector(SUN_DIR, 150);
  kit.sun.target.position.copy(viewState.pos);
  effects.update(dt, kit.camera, innerHeight);

  hud.update(now, s, input, prefs.assists, params);
  aim.update(now, kit.camera, viewState.pos, viewState.q, { ...cv.self, mode: weaponMode }, lockPos(cv.self.lock.targetId), !menu.open);
  if (now - lastMap > 33) { lastMap = now; drawMap(viewState, remoteViews, cv); }
  if (now - lastPanel > 500) { lastPanel = now; updatePanels(cv); }
  sound.update(loadG, rpm, s.engineOn);
  combatSound.update(localFiring, stores.lock, weaponMode === 'missile', cv.self.warning);
  feed.tick(now);
  messages.tick(dt);
  kit.renderer.render(kit.scene, kit.camera);
}

function drawMap(v: HeliState, others: RemoteView[], cv: CombatView): void {
  _eu.setFromQuaternion(v.q, 'YXZ');
  const lockId = cv.self.lock.targetId;
  const blips: MapBlip[] = [];
  for (const r of others) {
    const e = new Euler().setFromQuaternion(r.q, 'YXZ');
    blips.push({ x: r.pos.x, z: r.pos.z, heading: -e.y, kind: 'player', name: r.name, dead: r.crashed, locked: r.id === lockId });
  }
  for (const t of cv.targets) {
    if (t.kind === 'ground') blips.push({ x: t.pos.x, z: t.pos.z, heading: 0, kind: 'ground', dead: !t.alive, locked: t.id === lockId });
    else if (t.alive) { const e = new Euler().setFromQuaternion(t.q, 'YXZ'); blips.push({ x: t.pos.x, z: t.pos.z, heading: -e.y, kind: 'drone', locked: t.id === lockId }); }
  }
  for (const m of cv.missiles) blips.push({ x: m.pos.x, z: m.pos.z, heading: 0, kind: 'missile' });
  minimap.draw(v.pos.x, v.pos.z, -_eu.y, blips);
}

function updatePanels(cv: CombatView): void {
  $('mpPanel').hidden = !net;
  $('soloPanel').hidden = !!net;
  if (!net) { $('soloScore').textContent = String(cv.self.targetKills); return; }
  $('mpRoomName').textContent = net.room;
  $('mpPing').textContent = net.ready ? `${Math.round(net.ping)} ms` : net.status === 'connecting' ? 'connecting…' : '';
  const rows = [...cv.scores].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
  const table = $('mpList');
  table.replaceChildren(...rows.map(r => {
    const tr = document.createElement('tr');
    if (r.self) tr.className = 'self';
    const cell = (text: string, cls = '') => { const td = document.createElement('td'); td.textContent = text; if (cls) td.className = cls; return td; };
    tr.append(cell(r.self ? `${r.name} (you)` : r.name), cell(`${r.kills} K`, 'n'), cell(`${r.deaths} D`, 'n'));
    return tr;
  }));
}

syncButtons();
syncKeyLabels();
syncCameraView();
reset();
const linkRoom = new URLSearchParams(location.search).get('room');
if (linkRoom && SERVER_URL) { menu.setRoom(roomCode(linkRoom)); menu.show('multiplayer'); }
else menu.show('help');
if (import.meta.env.DEV) void import('./dev/tuningPanel').then(m => { tuning = m.installTuningPanel(params); if (net) tuning.lock(); });
requestAnimationFrame(t => { last = t; frame(t); });
