import GUI from 'lil-gui';
import type { Params } from '../sim/params';

type Tree = { [k: string]: number | Tree };

/** Dev-only live editor for the flight model. F2 toggles it. Never shipped in production builds. */
export function installTuningPanel(p: Params): void {
  const gui = new GUI({ title: 'Flight model · F2' });
  const addAll = (folder: GUI, obj: Tree) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'number') folder.add(obj, k).step(Math.abs(v) >= 100 ? 10 : Math.abs(v) >= 1 ? 0.05 : 0.001);
      else addAll(folder.addFolder(k).close(), v);
    }
  };
  addAll(gui, p as unknown as Tree);
  gui.add({ copy: () => void navigator.clipboard?.writeText(JSON.stringify(p, null, 2)) }, 'copy').name('Copy params as JSON');
  let visible = false;
  gui.hide();
  addEventListener('keydown', e => {
    if (e.code !== 'F2') return;
    e.preventDefault();
    visible = !visible;
    if (visible) gui.show(); else gui.hide();
  });
}
