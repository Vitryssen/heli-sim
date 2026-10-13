/** Volume settings, 1 = the tuned default. */
export interface Volumes { master: number; rotor: number; weapons: number; alerts: number }

/**
 * Combat audio on two channels: weapons (minigun and its barrel motor, missile launch, explosions,
 * hit marker) and alerts (lock tones, missile warning, the tutorial's gate chime).
 * Synthesized with WebAudio; starts when the player switches sound on (a user gesture).
 */
export class CombatSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private weapons: GainNode | null = null;
  private alerts: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private gun: GainNode | null = null;
  private motor: { osc: OscillatorNode; bp: BiquadFilterNode; gain: GainNode; whirBp: BiquadFilterNode; whir: GainNode } | null = null;
  private tone: { osc: OscillatorNode; gain: GainNode } | null = null;
  private warn: { osc: OscillatorNode; gain: GainNode } | null = null;
  private on = false;
  private vol: Volumes = { master: 1, rotor: 1, weapons: 1, alerts: 1 };

  setEnabled(on: boolean): void {
    this.on = on;
    if (on && !this.ctx) this.init();
    if (this.ctx && on) void this.ctx.resume();
    this.applyVolumes();
  }

  setVolumes(v: Volumes): void { this.vol = { ...v }; this.applyVolumes(); }

  private applyVolumes(): void {
    if (!this.ctx || !this.master || !this.weapons || !this.alerts) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.on ? 0.6 * this.vol.master : 0, t, 0.05);
    this.weapons.gain.setTargetAtTime(this.vol.weapons, t, 0.05);
    this.alerts.gain.setTargetAtTime(this.vol.alerts, t, 0.05);
  }

  /** Continuous sounds, once per frame. `gunSpin` is how fast the barrels turn, 0..1. */
  update(gunFiring: boolean, gunSpin: number, lock: 'none' | 'search' | 'locked', missileMode: boolean, warning: 'none' | 'locked' | 'missile'): void {
    if (!this.ctx || !this.on || !this.gun || !this.motor || !this.tone || !this.warn) return;
    const t = this.ctx.currentTime;
    this.gun.gain.setTargetAtTime(gunFiring ? 0.5 : 0, t, 0.015);
    // barrel motor: an electric whine and the air whir of the barrels, rising with their speed
    const m = this.motor, hz = 90 + 520 * gunSpin;
    m.osc.frequency.setTargetAtTime(hz, t, 0.03);
    m.bp.frequency.setTargetAtTime(hz * 3, t, 0.03);
    m.gain.gain.setTargetAtTime(0.05 * gunSpin, t, 0.03);
    m.whirBp.frequency.setTargetAtTime(400 + 900 * gunSpin, t, 0.03);
    m.whir.gain.setTargetAtTime(0.09 * gunSpin, t, 0.03);
    // seeker: slow beeps while searching, steady high tone when locked
    let toneGain = 0;
    if (missileMode && lock === 'search') toneGain = (t * 5) % 1 < 0.5 ? 0.12 : 0;
    if (missileMode && lock === 'locked') toneGain = 0.14;
    this.tone.osc.frequency.setTargetAtTime(lock === 'locked' ? 1250 : 900, t, 0.01);
    this.tone.gain.gain.setTargetAtTime(toneGain, t, 0.008);
    // warning: someone locking you (slow), missile in the air (fast)
    const rate = warning === 'missile' ? 12 : 4;
    const warnGain = warning !== 'none' && (t * rate) % 1 < 0.5 ? 0.1 : 0;
    this.warn.gain.gain.setTargetAtTime(warnGain, t, 0.005);
  }

  launch(): void { this.burst(0.7, 1.1, 3200, 400); }

  /** `dist` in metres from the listener. */
  explosion(dist: number): void {
    const near = Math.max(0, 1 - dist / 1800);
    if (near > 0) this.burst(1.2 * near, 1.6, 600, 120);
  }

  hitMarker(): void {
    if (!this.ctx || !this.on || !this.weapons) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = 2200;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.weapons);
    o.start(t); o.stop(t + 0.06);
  }

  /** Rising two-note chime for flying through a tutorial gate. */
  gate(): void {
    if (!this.ctx || !this.on || !this.alerts) return;
    const t = this.ctx.currentTime;
    [[880, 0], [1320, 0.07]].forEach(([hz, at]) => {
      const o = this.ctx!.createOscillator(), g = this.ctx!.createGain();
      o.type = 'sine'; o.frequency.value = hz;
      g.gain.setValueAtTime(0.0001, t + at); g.gain.exponentialRampToValueAtTime(0.26, t + at + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.35);
      o.connect(g).connect(this.alerts!);
      o.start(t + at); o.stop(t + at + 0.4);
    });
  }

  private burst(level: number, seconds: number, fromHz: number, toHz: number): void {
    if (!this.ctx || !this.on || !this.weapons || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(fromHz, t); lp.frequency.exponentialRampToValueAtTime(toHz, t + seconds);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(lp).connect(g).connect(this.weapons);
    src.start(t); src.stop(t + seconds);
  }

  private init(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const weapons = ctx.createGain(), alerts = ctx.createGain();
    weapons.connect(master); alerts.connect(master);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    const { gate: gun, output: gunOut } = minigunVoice(ctx, noise);
    gun.gain.value = 0;
    gunOut.connect(weapons);

    const motorOsc = ctx.createOscillator(); motorOsc.type = 'sawtooth'; motorOsc.frequency.value = 90;
    const motorBp = ctx.createBiquadFilter(); motorBp.type = 'bandpass'; motorBp.Q.value = 4;
    const motorGain = ctx.createGain(); motorGain.gain.value = 0;
    motorOsc.connect(motorBp).connect(motorGain).connect(weapons);
    const whirSrc = ctx.createBufferSource(); whirSrc.buffer = noise; whirSrc.loop = true;
    const whirBp = ctx.createBiquadFilter(); whirBp.type = 'bandpass'; whirBp.Q.value = 1.5;
    const whir = ctx.createGain(); whir.gain.value = 0;
    whirSrc.connect(whirBp).connect(whir).connect(weapons);
    motorOsc.start(); whirSrc.start();

    const mkTone = (type: OscillatorType, hz: number) => {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = hz;
      const gain = ctx.createGain(); gain.gain.value = 0;
      osc.connect(gain).connect(alerts); osc.start();
      return { osc, gain };
    };
    this.ctx = ctx; this.master = master; this.weapons = weapons; this.alerts = alerts; this.noise = noise; this.gun = gun;
    this.motor = { osc: motorOsc, bp: motorBp, gain: motorGain, whirBp, whir };
    this.tone = mkTone('sine', 900);
    this.warn = mkTone('square', 1600);
    this.applyVolumes();
  }
}

/** Levels of the minigun's layers (linear gains, `bass` in dB). */
export interface MinigunTone {
  rate: number;    // rounds per second the sound is built on
  growl: number;   // noise under ~320 Hz, soft-chopped
  rasp: number;    // noise around 520 Hz
  buzz: number;    // sawtooth at the firing rate (its harmonics carry the low pitch on small speakers)
  body: number;    // each round's thump, under ~300 Hz
  peak: number;    // each round around 250 Hz, where a real M134 is loudest
  snap: number;    // each round's crack, 1.2–2.4 kHz
  bass: number;    // low shelf under ~220 Hz, dB
  echo: number;    // outdoor echo level
}

/**
 * Fitted to the 7–9 s burst of "AH-6 Little Bird Minigun In Action" (WarLeaks) by matching its
 * spectrum band by band and its rhythm at the firing rate: ~59 rounds/s, most energy at 50–300 Hz
 * peaking near 250 Hz, a small crack at 1.2–2.4 kHz, spectral centroid ~490 Hz (clip: 481).
 */
export const MINIGUN_TONE: MinigunTone = { rate: 59, growl: 1.99, rasp: 0.82, buzz: 0.091, body: 0.125, peak: 0.29, snap: 0.83, bass: 1.5, echo: 0.3 };

/**
 * The minigun: a low growl and a rasp of noise chopped at the firing rate (rounded edges), a buzz at
 * the firing rate, and a crack, a 250 Hz peak and a thump per round, slightly uneven so
 * it tears rather than buzzes; then an outdoor echo that rolls on after a burst. The caller opens
 * and closes `gate` (1 = full level) and connects `output`.
 */
export function minigunVoice(ctx: BaseAudioContext, noise: AudioBuffer, tone: Partial<MinigunTone> = {}): { gate: GainNode; output: AudioNode } {
  const k = { ...MINIGUN_TONE, ...tone };
  const gate = ctx.createGain();
  const shelf = ctx.createBiquadFilter(); shelf.type = 'lowshelf'; shelf.frequency.value = 220; shelf.gain.value = k.bass;
  shelf.connect(gate);
  const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
  const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = k.rate;
  const chopper = (soften: number) => {
    const chop = ctx.createGain(); chop.gain.value = 0.5;
    const amt = ctx.createGain(); amt.gain.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = soften;
    lfo.connect(lp).connect(amt).connect(chop.gain);
    chop.connect(shelf);
    return chop;
  };
  const filtered = (from: AudioNode, into: AudioNode, type: BiquadFilterType, hz: number, q: number, level: number) => {
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = hz; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = level;
    from.connect(f).connect(g).connect(into);
  };
  const soft = chopper(240);                                       // rounded edges: thumps, not clicks
  filtered(src, soft, 'lowpass', 320, 0.9, k.growl);
  filtered(src, soft, 'bandpass', 520, 0.8, k.rasp);
  const buzz = ctx.createOscillator(); buzz.type = 'sawtooth'; buzz.frequency.value = k.rate;
  filtered(buzz, shelf, 'lowpass', 420, 0.7, k.buzz);

  // the rounds themselves, slightly uneven in timing and strength
  const rounds = ctx.createBufferSource(); rounds.buffer = roundsBuffer(ctx, k.rate); rounds.loop = true;
  filtered(rounds, shelf, 'lowpass', 300, 0.7, k.body);
  filtered(rounds, shelf, 'bandpass', 250, 1, k.peak);
  const snapTop = ctx.createBiquadFilter(); snapTop.type = 'lowpass'; snapTop.frequency.value = 2600;   // the crack stops short of hiss
  filtered(rounds, snapTop, 'bandpass', 1700, 2, k.snap);
  snapTop.connect(shelf);

  // outdoor echo after the gate, so a burst rolls on after the trigger is released
  const output = ctx.createGain();
  gate.connect(output);
  const echo = ctx.createConvolver(); echo.buffer = echoResponse(ctx);
  const wet = ctx.createGain(); wet.gain.value = k.echo;
  gate.connect(echo).connect(wet).connect(output);

  src.start(); lfo.start(); buzz.start(); rounds.start();
  return { gate, output };
}

/** Two seconds of rounds at `rate`: a short crack (noise, ~2.5 ms) and a ~95 Hz thump each, jittered. */
function roundsBuffer(ctx: BaseAudioContext, rate: number): AudioBuffer {
  const sr = ctx.sampleRate, n = Math.round(rate * 2), buf = ctx.createBuffer(1, Math.round(sr * n / rate), sr), d = buf.getChannelData(0);
  for (let r = 0; r < n; r++) {
    const start = Math.round((r / rate + (r ? (Math.random() - 0.5) * 0.0012 : 0)) * sr), amp = 0.85 + Math.random() * 0.3;
    for (let i = 0; i < sr * 0.03 && start + i < d.length; i++) {
      const t = i / sr;
      d[start + i] += amp * ((Math.random() * 2 - 1) * Math.exp(-t / 0.0025) + 0.7 * Math.sin(2 * Math.PI * 95 * t) * Math.exp(-t / 0.012));
    }
  }
  return buf;
}

/** Impulse response for open ground: two terrain reflections, then a dark tail fading over ~1.5 s. */
function echoResponse(ctx: BaseAudioContext): AudioBuffer {
  const sr = ctx.sampleRate, len = Math.round(sr * 1.6), buf = ctx.createBuffer(1, len, sr), d = buf.getChannelData(0);
  let lp = 0;
  for (let i = 0; i < len; i++) {
    const t = i / sr;
    lp += 0.12 * ((Math.random() * 2 - 1) - lp);                                  // one-pole low-pass: distant, dull
    d[i] = lp * Math.exp(-t / 0.4) * Math.min(1, t / 0.02);
  }
  for (const [at, g] of [[0.09, 0.5], [0.21, 0.3]]) d[Math.round(at * sr)] += g;    // reflections off the ground and hills
  return buf;
}
