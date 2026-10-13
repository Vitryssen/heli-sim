import type { HeliState } from '../sim/state';
import type { Metric } from '../tutorial/lessons';
import { headingOf, type RunResult, type Tutorial } from '../tutorial/tutorial';

const METRICS: Record<Metric, { label: string; fmt: (r: RunResult) => string }> = {
  time: { label: 'Time', fmt: r => `${r.time.toFixed(0)} s` },
  wobble: { label: 'Wobble', fmt: r => `${r.wobble.toFixed(1)}°/s` },
  drift: { label: 'Drift, hands off', fmt: r => `${r.drift.toFixed(1)} m` },
  collective: { label: 'Collective use', fmt: r => `${Math.round(r.collective * 100)} %` },
  maxPitch: { label: 'Max pitch', fmt: r => `${r.maxPitch.toFixed(0)}°` },
  maxBank: { label: 'Max bank', fmt: r => `${r.maxBank.toFixed(0)}°` },
  slip: { label: 'Sideslip', fmt: r => `${r.slip.toFixed(0)}°` },
  touchdown: { label: 'Touchdown', fmt: r => `${r.touchdown.toFixed(1)} m/s` },
};
const ARROWS = ['↑', '↗', '→', '↘', '↓', '↙', '←', '↖'];

/** HUD card for the lesson being flown: the current step, a hold timer, and results at the end. */
export class TutorialPanel {
  private el = document.getElementById('tut')!;
  private last = 0;
  private html = '';

  /** `keys` turns step text with {action} names into the player's key labels. */
  constructor(private keys: (text: string) => string) {}

  update(now: number, tut: Tutorial, s: HeliState): void {
    if (now - this.last < 100) return;
    this.last = now;
    const L = tut.lesson;
    this.el.hidden = !L;
    if (!L) return;
    const run = L.runs[tut.run], two = L.runs.length > 1;
    const head = `<div class="lbl">Tutorial · ${L.title}${two ? ` · run ${tut.run + 1} of ${L.runs.length}` : ''}</div>`;
    let body: string;
    if (tut.phase === 'done') {
      body = `<p class="tut-step"><b>Lesson complete.</b> Press {reset} to fly it again, or open the menu ({settings}) for the next lesson or to leave the tutorial.</p>${this.table(L.metrics, tut.results)}`;
    } else if (tut.phase === 'between') {
      const next = L.runs[tut.run + 1];
      body = `${this.table(L.metrics, tut.results)}<p class="tut-step"><b>Next: ${next.label}</b> in ${Math.ceil(tut.countdown)} s. Same task, from the same start.</p><p class="tut-intro">${next.intro}</p>`;
    } else if (tut.phase === 'crashed') {
      body = `<p class="tut-step"><b>Crashed.</b> Restarting the run…</p>`;
    } else {
      const st = L.steps[tut.step];
      const need = st.kind === 'zone' ? st.hold : st.kind === 'do' ? st.hold ?? 0 : 0;
      const bar = need ? `<div class="tut-bar"><span style="width:${Math.min(100, (tut.hold / need) * 100).toFixed(0)}%"></span></div>` : '';
      body = `${two || tut.step === 0 ? `<p class="tut-intro"><b>${run.label}.</b> ${run.intro}</p>` : ''}
        <p class="tut-step"><span class="tut-n">${tut.step + 1}/${L.steps.length}</span> ${st.text}</p>${bar}${this.where(tut, s)}`;
    }
    const foot = tut.phase === 'done' ? '' : `<div class="lbl tut-foot">{reset} restarts the run · {settings} menu to leave</div>`;
    const html = this.keys(head + body + foot);
    if (html !== this.html) { this.el.innerHTML = html; this.html = html; }
  }

  /** Distance and a heading-relative arrow to the current gate, marker or pad. */
  private where(tut: Tutorial, s: HeliState): string {
    const t = tut.target();
    if (!t) return '';
    const dx = t.x - s.pos.x, dz = t.z - s.pos.z, d = Math.hypot(dx, dz);
    if (d < 15) return '';
    const bearing = (Math.atan2(dx, -dz) * 180) / Math.PI;
    const rel = ((bearing - headingOf(s)) % 360 + 360) % 360;
    return `<div class="lbl tut-where">${ARROWS[Math.round(rel / 45) % 8]} ${d < 1000 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`}</div>`;
  }

  private table(metrics: Metric[], results: RunResult[]): string {
    if (!results.length) return '';
    const cols = results.map(r => `<th>${r.label}</th>`).join('');
    const rows = metrics.map(m => `<tr><td>${METRICS[m].label}</td>${results.map(r => `<td class="n">${METRICS[m].fmt(r)}</td>`).join('')}</tr>`).join('');
    return `<table class="tut-results"><tr><th></th>${cols}</tr>${rows}</table>`;
  }
}
