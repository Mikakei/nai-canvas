// 笔刷引擎：沿着指针轨迹按间距盖"笔印"。画笔、橡皮、仿制图章先画在笔触画布上，松手时合进图层；
// 模糊直接改图层；遮罩直接画在遮罩上
import { cloneCanvas, ctxOf, makeCanvas, type Layer, type PaintDoc, type Pt } from './doc.ts';
import type { Rect } from '@nai/shared';

export type Tip = 'round' | 'soft' | 'square';
export interface StrokePt extends Pt { p: number }

/** 一个笔印 */
export function dab(g: CanvasRenderingContext2D, x: number, y: number, size: number, tip: Tip, color: string) {
  const r = Math.max(0.5, size / 2);
  if (tip === 'square') { g.fillStyle = color; g.fillRect(x - r, y - r, r * 2, r * 2); return; }
  if (tip === 'soft') {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, color); gr.addColorStop(0.45, color); gr.addColorStop(1, transparentOf(color));
    g.fillStyle = gr;
  } else g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
}
function transparentOf(color: string) {
  const m = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(color);
  return m ? `rgba(${parseInt(m[1], 16)},${parseInt(m[2], 16)},${parseInt(m[3], 16)},0)` : 'rgba(0,0,0,0)';
}

interface StrokeOpts { tool: 'brush' | 'erase' | 'blur' | 'clone' | 'mask' | 'unmask'; size: number; tip: Tip; color: string; alpha: number; pressure: boolean; intensity: number; cloneOffset?: Pt }

/**
 * 一笔：begin 时拍下快照（用于撤销），move 时盖笔印，end 时合并、记录改动的范围
 */
export class Stroke {
  private last: StrokePt | null = null;
  private dirty: Rect | null = null;
  private snap: HTMLCanvasElement;
  private target: Layer | 'mask';
  private canvas: HTMLCanvasElement | null = null;
  private source: HTMLCanvasElement | null = null;
  private patch: HTMLCanvasElement | null = null;

  constructor(private doc: PaintDoc, private o: StrokeOpts) {
    const masky = o.tool === 'mask' || o.tool === 'unmask';
    this.target = masky ? 'mask' : doc.layer;
    const tc = this.target === 'mask' ? doc.mask : this.target.canvas;
    this.snap = cloneCanvas(tc);
    if (o.tool === 'brush' || o.tool === 'erase' || o.tool === 'clone') {
      this.canvas = makeCanvas(doc.W, doc.H);
      const g = ctxOf(this.canvas); g.save(); doc.clipToSelection(g);
      doc.stroke = { target: this.target as Layer, canvas: this.canvas, erase: o.tool === 'erase', alpha: o.alpha };
      if (o.tool === 'clone') this.source = cloneCanvas(doc.merged());
    } else if (o.tool === 'blur') {
      const g = ctxOf(tc); g.save(); doc.clipToSelection(g);
    }
  }

  private grow(x: number, y: number, r: number) {
    const d = { x: x - r - 2, y: y - r - 2, w: r * 2 + 4, h: r * 2 + 4 };
    this.dirty = this.dirty ? { x: Math.min(this.dirty.x, d.x), y: Math.min(this.dirty.y, d.y), w: Math.max(this.dirty.x + this.dirty.w, d.x + d.w) - Math.min(this.dirty.x, d.x), h: Math.max(this.dirty.y + this.dirty.h, d.y + d.h) - Math.min(this.dirty.y, d.y) } : d;
  }

  private stamp(x: number, y: number, size: number) {
    const o = this.o, r = size / 2;
    this.grow(x, y, r);
    if (o.tool === 'mask' || o.tool === 'unmask') {
      const g = ctxOf(this.doc.mask);
      g.globalCompositeOperation = o.tool === 'unmask' ? 'destination-out' : 'source-over';
      dab(g, x, y, size, o.tip === 'square' ? 'square' : 'round', '#ffffff');
      g.globalCompositeOperation = 'source-over';
      return;
    }
    if (o.tool === 'blur') { this.blurAt(x, y, size); return; }
    const g = ctxOf(this.canvas!);
    if (o.tool === 'clone') {
      const off = o.cloneOffset!, s = this.source!;
      g.save(); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
      g.drawImage(s, x - off.x - r, y - off.y - r, size, size, x - r, y - r, size, size);
      g.restore();
      return;
    }
    dab(g, x, y, size, o.tip, o.tool === 'erase' ? '#000000' : o.color);
  }

  /** 模糊一个笔印范围：取一块放大一点的区域模糊，再按柔边圆形贴回去 */
  private blurAt(x: number, y: number, size: number) {
    const tc = (this.target as Layer).canvas, r = size / 2;
    const k = Math.max(0.5, (size * this.o.intensity) / 100 / 4), pad = Math.ceil(k * 3);
    const x0 = Math.floor(x - r - pad), y0 = Math.floor(y - r - pad), w = Math.ceil(size + pad * 2), h = w;
    if (!this.patch || this.patch.width < w) this.patch = makeCanvas(w, h);
    const p = this.patch, pg = ctxOf(p);
    pg.save(); pg.globalCompositeOperation = 'copy'; pg.filter = `blur(${k}px)`;
    pg.drawImage(tc, x0, y0, w, h, 0, 0, w, h); pg.restore();
    pg.save(); pg.globalCompositeOperation = 'destination-in';
    const gr = pg.createRadialGradient(x - x0, y - y0, 0, x - x0, y - y0, r);
    gr.addColorStop(0, '#000'); gr.addColorStop(0.6, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    pg.fillStyle = gr; pg.fillRect(0, 0, p.width, p.height); pg.restore();
    ctxOf(tc).drawImage(p, 0, 0, w, h, x0, y0, w, h);
  }

  move(pt: StrokePt) {
    const o = this.o, size = Math.max(1, o.size * (o.pressure ? Math.max(0.05, pt.p) : 1));
    if (!this.last) { this.stamp(pt.x, pt.y, size); this.last = { ...pt, p: size }; return; }
    const a = this.last, d = Math.hypot(pt.x - a.x, pt.y - a.y);
    const spacing = Math.max(1, ((a.p + size) / 2) * (o.tip === 'soft' ? 0.12 : o.tool === 'blur' ? 0.3 : 0.25));
    const n = Math.floor(d / spacing);
    if (!n) return;
    for (let i = 1; i <= n; i++) {
      const t = (i * spacing) / d;
      this.stamp(a.x + (pt.x - a.x) * t, a.y + (pt.y - a.y) * t, a.p + (size - a.p) * t);
    }
    const t = (n * spacing) / d;
    this.last = { x: a.x + (pt.x - a.x) * t, y: a.y + (pt.y - a.y) * t, p: a.p + (size - a.p) * t };
  }

  end() {
    const doc = this.doc;
    if (this.o.tool === 'blur') ctxOf((this.target as Layer).canvas).restore();
    if (this.canvas) {
      ctxOf(this.canvas).restore();
      const l = this.target as Layer, g = ctxOf(l.canvas);
      g.save(); g.globalAlpha = this.o.alpha;
      g.globalCompositeOperation = this.o.tool === 'erase' ? 'destination-out' : 'source-over';
      g.drawImage(this.canvas, 0, 0); g.restore();
      doc.stroke = null;
    }
    if (this.dirty) doc.commitPatch(this.target, this.snap, this.dirty);
    else doc.bump();
  }
}
