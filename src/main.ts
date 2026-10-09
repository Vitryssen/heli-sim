import './style.css';
import { Vector3 } from 'three';
import { createScene, SUN_DIR } from './render/scene';
import { buildHeliModel } from './render/heliModel';
import { Dust } from './render/dust';
import { Beacon } from './render/beacon';
import { CameraRig } from './render/camera';
import { createLayout } from './world/layout';
import { createWorld } from './world/world';
import { buildWorldMeshes } from './world/meshes';
import { createState, type AssistFlags, type PilotInput } from './sim/state';
import { params } from './sim/params';
import { SIM_DT, step } from './sim/step';
import { HUB } from './sim/geometry';
import { clamp, smooth } from './sim/math';
import { Mission } from './game/mission';
import { Session } from './game/session';
import { loadPrefs, savePrefs } from './game/prefs';
import { Bindings, keyLabel, type Action } from './input/bindings';
import { Keyboard } from './input/keyboard';
import { Mouse } from './input/mouse';
import { enterFlightMode, setLeaveGuard } from './input/keyboardLock';
import { Hud } from './ui/hud';
import { Messages } from './ui/messages';
import { SettingsMenu } from './ui/settingsMenu';
import { RotorSound } from './audio/rotorSound';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

// ---- world & rendering
const layout = createLayout();
const world = createWorld(layout);
const kit = createScene($('view'));
buildWorldMeshes(kit.scene, kit.renderer, layout);
const heli = buildHeliModel(kit.scene);
const dust = new Dust(kit.scene, kit.renderer);
const beacon = new Beacon(kit.scene);
const rig = new CameraRig(kit.camera);

// ---- game state
const s = createState();
const mission = new Mission(layout.pads);
const session = new Session(s, world, mission);
const prefs = loadPrefs();
const bindings = new Bindings();
const messages = new Messages($('msg'), $('m1'), $('m2'));
const hud = new Hud();
const sound = new RotorSound();

// ---- input & menus
const keyboard = new Keyboard(bindings, onAction);
const mouse = new Mouse(kit.renderer.domElement, () => keyboard.held('freeLook'), locked => {
  $('bMouse').setAttribute('aria-pressed', String(locked));
  if (locked) info('Mouse control on', 'Esc releases the mouse', 1.6);
}, () => !menu.open);
mouse.sensitivity = prefs.sensitivity;
mouse.invertY = prefs.invertY;

const menu = new SettingsMenu(bindings, keyboard, prefs, {
  onAssist: (k, v) => setAssist(k, v),
  onMouse: (sens, inv) => { prefs.sensitivity = mouse.sensitivity = sens; prefs.invertY = mouse.invertY = inv; savePrefs(prefs); },
  onFly: () => void flyFullscreen(),
  onClose: () => syncKeyLabels(),
});

function info(title: string, detail: string, ttl: number): void { messages.show({ title, detail, kind: 'info', ttl }); }

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
    case 'camera': $('bCam').firstElementChild!.textContent = 'Cam: ' + rig.cycle(); break;
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

function reset(): void { messages.show(session.reset()); rig.snap(); }
function toggleSound(): void { $('bSound').setAttribute('aria-pressed', String(sound.toggle())); }

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
$('bFly').onclick = () => void flyFullscreen();
$('bMouse').onclick = () => { if (mouse.locked) mouse.unlock(); else mouse.lock(); };
$('bCam').onclick = () => onAction('camera');
$('bReset').onclick = reset;
$('bSound').onclick = toggleSound;
$('bSettings').onclick = () => menu.show();
// buttons keep focus after a click; stop Space/Enter from re-triggering them mid-flight
for (const b of document.querySelectorAll('button')) b.addEventListener('keydown', e => { if (e.code === 'Space' || e.code === 'Enter') e.preventDefault(); });

// ---- loop
const _hub = new Vector3();
let last = performance.now(), accum = 0, simT = 0;

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

  if (!menu.open) {
    const wasOn = s.engineOn;
    accum += dt;
    while (accum >= SIM_DT) { step(s, input, prefs.assists, world, SIM_DT, simT, params); simT += SIM_DT; accum -= SIM_DT; }
    if (!wasOn && s.engineOn) info('Engine start', 'Keep holding until the skids lift', 2.5);
    const n = session.update(dt);
    if (n && !(n.title === 'Leaving the area' && messages.busy)) messages.show(n);
    setLeaveGuard(s.engineOn && !s.crashed);
  } else accum = 0;

  // aircraft
  const rpm = s.omega / params.rotor.omegaNominal;
  heli.root.position.copy(s.pos);
  heli.root.quaternion.copy(s.q);
  heli.mainRotor.rotation.y += rpm * 30 * dt;
  heli.tailRotor.rotation.x += rpm * 70 * dt;
  heli.rotorTilt.rotation.x = -input.pitch * 0.06 * Math.min(1, rpm);
  heli.rotorTilt.rotation.z = -input.roll * 0.06 * Math.min(1, rpm);
  heli.disc.material.opacity = 0.14 * smooth(0.3, 0.9, rpm);

  // rotor wash
  _hub.copy(HUB).applyQuaternion(s.q).add(s.pos);
  const gy = world.groundAt(_hub.x, _hub.z, _hub.y);
  const loadG = s.thrust / (params.mass * params.g);
  dust.update(dt, _hub.x, _hub.z, gy, Math.min(1, rpm) * smooth(0.5, 1.0, loadG) * (1 - smooth(4, 15, _hub.y - gy)));

  beacon.update(mission.target, now);
  rig.update(dt, s, world, mission.target, mouse.look);
  kit.sky.position.copy(kit.camera.position);
  kit.sun.position.copy(s.pos).addScaledVector(SUN_DIR, 150);
  kit.sun.target.position.copy(s.pos);

  hud.update(now, s, input, prefs.assists, mission.target, mission.score, params);
  sound.update(loadG, rpm, s.engineOn);
  messages.tick(dt);
  kit.renderer.render(kit.scene, kit.camera);
}

syncButtons();
syncKeyLabels();
reset();
menu.show('help');
if (import.meta.env.DEV) void import('./dev/tuningPanel').then(m => m.installTuningPanel(params));
requestAnimationFrame(t => { last = t; frame(t); });
