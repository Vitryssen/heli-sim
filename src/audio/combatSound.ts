/**
 * Combat audio: minigun, missile launch, explosions, lock tones and the missile warning.
 * Synthesized with WebAudio; starts when the player switches sound on (a user gesture).
 */
export class CombatSound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private gun: GainNode | null = null;
  private tone: { osc: OscillatorNode; gain: GainNode } | null = null;
  private warn: { osc: OscillatorNode; gain: GainNode } | null = null;
  private on = false;

  setEnabled(on: boolean): void {
    this.on = on;
    if (on && !this.ctx) this.init();
    if (this.ctx && on) void this.ctx.resume();
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.6 : 0, this.ctx.currentTime, 0.05);
  }

  /** Continuous sounds, once per frame. */
  update(gunFiring: boolean, lock: 'none' | 'search' | 'locked', missileMode: boolean, warning: 'none' | 'locked' | 'missile'): void {
    if (!this.ctx || !this.on || !this.gun || !this.tone || !this.warn) return;
    const t = this.ctx.currentTime;
    this.gun.gain.setTargetAtTime(gunFiring ? 0.5 : 0, t, 0.015);
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
    if (!this.ctx || !this.on || !this.master) return;
    const t = this.ctx.currentTime, o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = 'square'; o.frequency.value = 2200;
    g.gain.setValueAtTime(0.06, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.06);
  }

  private burst(level: number, seconds: number, fromHz: number, toHz: number): void {
    if (!this.ctx || !this.on || !this.master || !this.noise) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource(); src.buffer = this.noise;
    const lp = this.ctx.createBiquadFilter(); lp.type = 'lowpass';
    lp.frequency.setValueAtTime(fromHz, t); lp.frequency.exponentialRampToValueAtTime(toHz, t + seconds);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(level, t); g.gain.exponentialRampToValueAtTime(0.0001, t + seconds);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t); src.stop(t + seconds);
  }

  private init(): void {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const master = ctx.createGain(); master.gain.value = 0; master.connect(ctx.destination);
    const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    // minigun: band-passed noise chopped at the firing rate
    const src = ctx.createBufferSource(); src.buffer = noise; src.loop = true;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 700; bp.Q.value = 0.8;
    const chop = ctx.createGain(); chop.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'square'; lfo.frequency.value = 50;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.5; lfo.connect(lfoAmt).connect(chop.gain);
    const gun = ctx.createGain(); gun.gain.value = 0;
    src.connect(bp).connect(chop).connect(gun).connect(master);
    src.start(); lfo.start();

    const mkTone = (type: OscillatorType, hz: number) => {
      const osc = ctx.createOscillator(); osc.type = type; osc.frequency.value = hz;
      const gain = ctx.createGain(); gain.gain.value = 0;
      osc.connect(gain).connect(master); osc.start();
      return { osc, gain };
    };
    this.ctx = ctx; this.master = master; this.noise = noise; this.gun = gun;
    this.tone = mkTone('sine', 900);
    this.warn = mkTone('square', 1600);
  }
}
