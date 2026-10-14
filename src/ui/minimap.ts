import type { Layout } from '../world/layout';
import { terrainH, WATER_Y } from '../world/terrain';
import { EDGE_WARN } from '../sim/collisions';
import { clamp, smooth } from '../sim/math';

export type BlipKind = 'player' | 'drone' | 'ground' | 'missile' | 'goal';   // goal: the tutorial's next gate or pad
export interface MapBlip { x: number; z: number; heading: number; kind: BlipKind; name?: string; dead?: boolean; locked?: boolean }

const WORLD = 2400;                 // the base map covers ±2.4 km
export const MAP_RANGES = [500, 1000, 2000] as const;

/**
 * Heading-up transform: world offset (dx east, dz south) from your aircraft → map pixels from
 * the centre (x right, y down), with your heading pointing straight up.
 */
export function worldToMap(dx: number, dz: number, heading: number, range: number, radius: number): { x: number; y: number; inside: boolean } {
  const c = Math.cos(heading), s = Math.sin(heading), k = radius / range;
  let x = (dx * c + dz * s) * k, y = (-dx * s + dz * c) * k;
  const d = Math.hypot(x, y), inside = d <= radius;
  if (!inside) { x *= radius / d; y *= radius / d; }
  return { x, y, inside };
}

/** Round radar-style minimap: hill-shaded terrain, the river, roads, towns, pads, and everything that flies. */
export class Minimap {
  private base: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private rangeIdx = 1;

  constructor(private canvas: HTMLCanvasElement, layout: Layout, private label: HTMLElement) {
    this.g = canvas.getContext('2d')!;
    this.base = renderBaseMap(layout);
    this.label.textContent = this.rangeText();
  }

  get range(): number { return MAP_RANGES[this.rangeIdx]; }

  cycleRange(): string { this.rangeIdx = (this.rangeIdx + 1) % MAP_RANGES.length; this.label.textContent = this.rangeText(); return this.rangeText(); }

  draw(px: number, pz: number, heading: number, blips: MapBlip[]): void {
    const g = this.g, W = this.canvas.width, R = W / 2 - 4, range = this.range, k = R / range;
    g.clearRect(0, 0, W, W);
    g.save();
    g.beginPath(); g.arc(W / 2, W / 2, R, 0, Math.PI * 2); g.clip();
    g.fillStyle = '#20301f'; g.fillRect(0, 0, W, W);
    g.translate(W / 2, W / 2); g.scale(k, k); g.rotate(-heading); g.translate(-px, -pz);
    g.imageSmoothingEnabled = true;
    g.drawImage(this.base, -WORLD, -WORLD, WORLD * 2, WORLD * 2);
    g.restore();

    // range rings
    g.strokeStyle = 'rgba(232,238,242,.18)'; g.lineWidth = 1;
    for (const f of [0.5, 1]) { g.beginPath(); g.arc(W / 2, W / 2, R * f - (f === 1 ? 1 : 0), 0, Math.PI * 2); g.stroke(); }

    const scale = W / 200;   // canvas px per CSS px
    for (const b of blips) {
      const m = worldToMap(b.x - px, b.z - pz, heading, range, R - 6 * scale);
      const x = W / 2 + m.x, y = W / 2 + m.y;
      g.save(); g.translate(x, y);
      if (b.kind === 'goal') {
        g.strokeStyle = '#ffb547'; g.lineWidth = 2 * scale; g.beginPath(); g.arc(0, 0, 5 * scale, 0, Math.PI * 2); g.stroke();
      } else if (b.kind === 'missile') {
        g.fillStyle = '#ff6b5e'; g.beginPath(); g.arc(0, 0, 2.5 * scale, 0, Math.PI * 2); g.fill();
      } else if (b.kind === 'ground') {
        g.fillStyle = b.dead ? 'rgba(148,166,179,.5)' : '#ff9a6a'; g.fillRect(-3 * scale, -3 * scale, 6 * scale, 6 * scale);
      } else {
        g.rotate(b.heading - heading);
        g.fillStyle = b.dead ? 'rgba(148,166,179,.6)' : b.kind === 'drone' ? '#ff9a6a' : '#ffb547';
        g.beginPath(); g.moveTo(0, -6 * scale); g.lineTo(4.5 * scale, 5 * scale); g.lineTo(0, 2.5 * scale); g.lineTo(-4.5 * scale, 5 * scale); g.closePath(); g.fill();
        if (!m.inside) g.globalAlpha = 0.7;
      }
      g.restore();
      if (b.locked) { g.strokeStyle = '#ff6b5e'; g.lineWidth = 1.5 * scale; g.beginPath(); g.arc(x, y, 8 * scale, 0, Math.PI * 2); g.stroke(); }
      if (b.name && m.inside) {
        g.font = `600 ${10 * scale}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center';
        g.fillStyle = 'rgba(8,12,16,.7)'; g.fillText(b.name, x + 0.6 * scale, y - 8 * scale + 0.6 * scale);
        g.fillStyle = '#e8eef2'; g.fillText(b.name, x, y - 8 * scale);
      }
    }

    // you
    g.fillStyle = '#e8eef2'; g.strokeStyle = 'rgba(8,12,16,.8)'; g.lineWidth = scale;
    g.beginPath(); g.moveTo(W / 2, W / 2 - 7 * scale); g.lineTo(W / 2 + 5 * scale, W / 2 + 6 * scale); g.lineTo(W / 2, W / 2 + 3 * scale); g.lineTo(W / 2 - 5 * scale, W / 2 + 6 * scale); g.closePath(); g.fill(); g.stroke();

    // north on the bezel
    const n = worldToMap(0, -1, heading, 1, R - 9 * scale);
    g.font = `700 ${11 * scale}px "Barlow Condensed", "Arial Narrow", sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#ffb547'; g.fillText('N', W / 2 + n.x, W / 2 + n.y);
    g.textBaseline = 'alphabetic';
  }

  private rangeText(): string { const r = this.range; return r >= 1000 ? `${r / 1000} km` : `${r} m`; }
}

/** One-off 1024² render of the whole map: hill shading, river, forests, roads, power lines, buildings and rearm pads. */
function renderBaseMap(layout: Layout): HTMLCanvasElement {
  const N = 1024, mpp = (WORLD * 2) / N;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d')!;
  const img = g.createImageData(N, N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -WORLD + (i + 0.5) * mpp, z = -WORLD + (j + 0.5) * mpp;
    const h = terrainH(x, z), hx = terrainH(x + mpp, z) - h, hz = terrainH(x, z + mpp) - h;
    const shade = clamp(0.78 + (-hx * 0.5 + -hz * 0.35) * 0.9, 0.45, 1.15);
    const dry = smooth(25, 80, h), high = smooth(140, 260, h) * 0.6;
    const o = (j * N + i) * 4;
    if (h < WATER_Y) { img.data[o] = 52; img.data[o + 1] = 98; img.data[o + 2] = 128; img.data[o + 3] = 255; continue; }
    img.data[o] = clamp((74 + dry * 60 + high * 40) * shade, 0, 255);
    img.data[o + 1] = clamp((104 + dry * 20 + high * 10) * shade, 0, 255);
    img.data[o + 2] = clamp((58 + dry * 10 + high * 50) * shade, 0, 255);
    img.data[o + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  g.setTransform(1 / mpp, 0, 0, 1 / mpp, WORLD / mpp, WORLD / mpp);   // world metres → pixels
  g.fillStyle = 'rgba(28,48,24,.55)';
  for (const t of layout.trees) { g.beginPath(); g.arc(t.x, t.z, 4, 0, Math.PI * 2); g.fill(); }
  g.lineCap = g.lineJoin = 'round';
  for (const r of layout.roads) {
    g.strokeStyle = 'rgba(214,206,180,.8)'; g.lineWidth = 9;
    g.beginPath(); r.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z))); g.stroke();
  }
  g.strokeStyle = 'rgba(30,34,38,.55)'; g.lineWidth = 3; g.setLineDash([14, 10]);
  for (const l of layout.powerLines) { g.beginPath(); l.pylons.forEach((p, i) => (i ? g.lineTo(p.x, p.z) : g.moveTo(p.x, p.z))); g.stroke(); }
  g.setLineDash([]);
  g.fillStyle = 'rgba(30,34,38,.8)';
  for (const p of layout.props) if (p.kind === 'pylon') g.fillRect(p.x - 6, p.z - 6, 12, 12);
  for (const p of layout.props) if (p.kind === 'mast') { g.fillStyle = '#ff6b5e'; g.beginPath(); g.arc(p.x, p.z, 14, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = 'rgba(110,116,120,.9)'; g.fillRect(-40, -40, 80, 80);    // Base apron
  g.fillStyle = '#c9c3b8'; g.strokeStyle = 'rgba(30,34,38,.8)'; g.lineWidth = 2;
  for (const b of layout.buildings) {
    g.save(); g.translate(b.x, b.z); g.rotate(-b.rot);
    g.fillRect(-b.hw, -b.hd, b.w, b.d); g.strokeRect(-b.hw, -b.hd, b.w, b.d);
    g.restore();
  }
  // the warning line: past it the countdown starts
  g.strokeStyle = 'rgba(255,107,94,.75)'; g.lineWidth = 8; g.setLineDash([40, 30]);
  g.strokeRect(-EDGE_WARN, -EDGE_WARN, EDGE_WARN * 2, EDGE_WARN * 2);
  g.setLineDash([]);
  for (const p of layout.pads) {
    g.fillStyle = '#2f3338'; g.beginPath(); g.arc(p.x, p.z, 26, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#ffb547'; g.lineWidth = 5; g.stroke();
    g.fillStyle = '#ffb547'; g.font = '700 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('H', p.x, p.z + 1);
  }
  return c;
}
