import { clamp } from '../sim/math';

/** Synthesized rotor thump (filtered brown noise chopped at blade-pass rate) plus turbine whine. */
export class RotorSound {
  on = false;
  private ctx: AudioContext | null = null;
  private nodes: { master: GainNode; lp: BiquadFilterNode; lfo: OscillatorNode; lfoAmt: GainNode; whine: OscillatorNode } | null = null;

  /** Must be called from a user gesture. Returns the new on/off state. */
  toggle(): boolean {
    if (!this.ctx && !this.init()) return false;
    this.on = !this.on;
    if (this.on) void this.ctx!.resume();
    return this.on;
  }

  update(loadG: number, rpm: number, engineOn: boolean): void {
    if (!this.ctx || !this.nodes) return;
    const t = this.ctx.currentTime, n = this.nodes, load = clamp(loadG, 0, 2);
    n.master.gain.setTargetAtTime(this.on ? (0.15 + 0.3 * load) * Math.min(1, rpm * 1.5) : 0, t, 0.08);
    n.lfoAmt.gain.setTargetAtTime(0.3 + 0.3 * load, t, 0.08);
    n.lp.frequency.setTargetAtTime(300 + 400 * load, t, 0.08);
    n.lfo.frequency.setTargetAtTime(23 * Math.max(0.05, rpm), t, 0.1);
    n.whine.frequency.setTargetAtTime(600 + 1750 * (engineOn ? Math.max(0.3, rpm) : rpm), t, 0.2);
  }

  private init(): boolean {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate), d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 500;
    const chop = ctx.createGain(); chop.gain.value = 0.5;
    const lfo = ctx.createOscillator(); lfo.type = 'triangle'; lfo.frequency.value = 23;
    const lfoAmt = ctx.createGain(); lfoAmt.gain.value = 0.5;
    lfo.connect(lfoAmt).connect(chop.gain);
    const master = ctx.createGain(); master.gain.value = 0;
    src.connect(lp).connect(chop).connect(master).connect(ctx.destination);
    const whine = ctx.createOscillator(); whine.frequency.value = 2350;
    const wg = ctx.createGain(); wg.gain.value = 0.01;
    whine.connect(wg).connect(master);
    src.start(); lfo.start(); whine.start();
    this.ctx = ctx;
    this.nodes = { master, lp, lfo, lfoAmt, whine };
    return true;
  }
}
