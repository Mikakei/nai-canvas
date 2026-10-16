// 画布编辑器的文档：图层、遮罩、选区、浮动变换、撤销重做。所有图层和画布同尺寸
import { adjustHsv, aabb, dilate, floodFill, hexToRgb, maskBounds, type Box, type Rect } from '@nai/shared';

export interface Layer { id: string; name: string; canvas: HTMLCanvasElement; visible: boolean; opacity: number }
export interface Pt { x: number; y: number }
type Target = Layer | 'mask';
interface Props { layer: Layer; name: string; visible: boolean; opacity: number }
type Cmd =
  | { kind: 'patch'; target: Target; x: number; y: number; before: ImageData; after: ImageData }
  | { kind: 'struct'; before: Props[]; after: Props[]; activeBefore: number; activeAfter: number }
  | { kind: 'focus'; before: Rect | null; after: Rect | null }
  | { kind: 'group'; cmds: Cmd[] };

/** 浮动内容：选区或整个图层被"拿起来"后，在变换框里移动、缩放、旋转，松手前不写回图层 */
export interface Floating { content: HTMLCanvasElement; ow: number; oh: number; box: Box; layer: Layer; snapshot: HTMLCanvasElement; from: Rect }

export function makeCanvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = Math.max(1, w); c.height = Math.max(1, h);
  return c;
}
export const ctxOf = (c: HTMLCanvasElement) => c.getContext('2d', { willReadFrequently: true })!;
export function cloneCanvas(c: HTMLCanvasElement) { const n = makeCanvas(c.width, c.height); ctxOf(n).drawImage(c, 0, 0); return n; }
const bytesOf = (c: Cmd): number => c.kind === 'patch' ? (c.before.data.length + c.after.data.length) : c.kind === 'group' ? c.cmds.reduce((a, x) => a + bytesOf(x), 0) : 64;
let seq = 0;
const lid = () => `l${Date.now().toString(36)}${(seq++).toString(36)}`;

/** 矩形夹到画布里，取整；空了返回 null */
export function clampRect(r: Rect, W: number, H: number): Rect | null {
  const x = Math.max(0, Math.floor(r.x)), y = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(W, Math.ceil(r.x + r.w)), y1 = Math.min(H, Math.ceil(r.y + r.h));
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}
export const unionRect = (a: Rect, b: Rect): Rect => { const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y); return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }; };

export class PaintDoc {
  W: number; H: number;
  layers: Layer[] = [];
  active = 0;
  mask: HTMLCanvasElement;
  focus: Rect | null = null;
  /** 选区：多边形顶点；selCanvas 是它的白色填充，用来裁剪和取权重 */
  sel: Pt[] | null = null;
  selCanvas: HTMLCanvasElement | null = null;
  floating: Floating | null = null;
  /** 画笔笔触先画在这张临时画布上，松手时按不透明度合进图层（预览时也这样合成） */
  stroke: { target: Layer; canvas: HTMLCanvasElement; erase: boolean; alpha: number } | null = null;
  paintDirty = false;
  version = 0;
  onChange: () => void = () => {};
  private undoS: Cmd[] = []; private redoS: Cmd[] = []; private bytes = 0;
  private mergedCache: HTMLCanvasElement | null = null; private mergedAt = -1;
  private tmp: HTMLCanvasElement | null = null;

  constructor(W: number, H: number) {
    this.W = W; this.H = H;
    this.mask = makeCanvas(W, H);
  }

  bump() { this.version++; this.onChange(); }
  get layer() { return this.layers[this.active]; }
  get canUndo() { return this.undoS.length > 0 || !!this.floating; }
  get canRedo() { return this.redoS.length > 0; }

  addLayerFrom(source: CanvasImageSource | null, name: string, at = this.layers.length) {
    const c = makeCanvas(this.W, this.H);
    if (source) ctxOf(c).drawImage(source, 0, 0, this.W, this.H);
    const l: Layer = { id: lid(), name, canvas: c, visible: true, opacity: 1 };
    this.layers.splice(at, 0, l);
    return l;
  }

  /* ---------- 撤销重做 ---------- */
  private push(c: Cmd) {
    this.undoS.push(c); this.redoS = []; this.bytes += bytesOf(c);
    // 撤销记录最多占约 300MB，超了丢最早的
    while (this.bytes > 300e6 && this.undoS.length > 1) this.bytes -= bytesOf(this.undoS.shift()!);
  }
  private apply(c: Cmd, undo: boolean) {
    if (c.kind === 'patch') {
      const cv = c.target === 'mask' ? this.mask : c.target.canvas;
      ctxOf(cv).putImageData(undo ? c.before : c.after, c.x, c.y);
      if (c.target !== 'mask') this.paintDirty = true;
    } else if (c.kind === 'struct') {
      const list = undo ? c.before : c.after;
      this.layers = list.map(p => { Object.assign(p.layer, { name: p.name, visible: p.visible, opacity: p.opacity }); return p.layer; });
      this.active = Math.min(this.layers.length - 1, undo ? c.activeBefore : c.activeAfter);
      this.paintDirty = true;
    } else if (c.kind === 'focus') this.focus = undo ? c.before : c.after;
    else (undo ? [...c.cmds].reverse() : c.cmds).forEach(x => this.apply(x, undo));
  }
  undo() {
    if (this.floating) { this.cancelFloating(); return; }
    const c = this.undoS.pop(); if (!c) return;
    this.apply(c, true); this.redoS.push(c); this.bump();
  }
  redo() {
    const c = this.redoS.pop(); if (!c) return;
    this.apply(c, false); this.undoS.push(c); this.bump();
  }
  clearHistory() { this.undoS = []; this.redoS = []; this.bytes = 0; }

  /** 记录一块区域的改动：snapshot 是改之前整张画布的拷贝 */
  patchCmd(target: Target, snapshot: HTMLCanvasElement, r: Rect): Cmd | null {
    const rr = clampRect(r, this.W, this.H); if (!rr) return null;
    const cv = target === 'mask' ? this.mask : target.canvas;
    return { kind: 'patch', target, x: rr.x, y: rr.y, before: ctxOf(snapshot).getImageData(rr.x, rr.y, rr.w, rr.h), after: ctxOf(cv).getImageData(rr.x, rr.y, rr.w, rr.h) };
  }
  commitPatch(target: Target, snapshot: HTMLCanvasElement, r: Rect) {
    const c = this.patchCmd(target, snapshot, r);
    if (c) { this.push(c); if (target !== 'mask') this.paintDirty = true; }
    this.bump();
  }
  private props(): Props[] { return this.layers.map(l => ({ layer: l, name: l.name, visible: l.visible, opacity: l.opacity })); }
  /** 改图层结构（增删、排序、显示、不透明度、名字）并记一步撤销 */
  structural(fn: () => void, extra: Cmd[] = []) {
    const before = this.props(), ab = this.active;
    fn();
    const c: Cmd = { kind: 'struct', before, after: this.props(), activeBefore: ab, activeAfter: this.active };
    this.push(extra.length ? { kind: 'group', cmds: [...extra, c] } : c);
    this.paintDirty = true;
    this.bump();
  }
  setFocus(f: Rect | null) {
    this.push({ kind: 'focus', before: this.focus, after: f });
    this.focus = f; this.bump();
  }

  /* ---------- 图层操作 ---------- */
  newLayer() { this.structural(() => { this.addLayerFrom(null, `图层 ${this.layers.length}`, this.active + 1); this.active++; }); }
  removeLayer(i = this.active) {
    if (this.layers.length < 2) return false;
    this.structural(() => { this.layers.splice(i, 1); this.active = Math.max(0, Math.min(this.active, this.layers.length - 1)); });
    return true;
  }
  duplicateLayer(i = this.active) {
    this.structural(() => { const src = this.layers[i]; const l = this.addLayerFrom(src.canvas, `${src.name} 副本`, i + 1); l.opacity = src.opacity; this.active = i + 1; });
  }
  moveLayer(i: number, d: -1 | 1) {
    const j = i + d; if (j < 0 || j >= this.layers.length) return;
    this.structural(() => { const [l] = this.layers.splice(i, 1); this.layers.splice(j, 0, l); if (this.active === i) this.active = j; else if (this.active === j) this.active = i; });
  }
  /** 向下合并：上面的图层按自己的不透明度画进下面的图层 */
  mergeDown(i = this.active) {
    if (i < 1) return;
    const up = this.layers[i], low = this.layers[i - 1], snap = cloneCanvas(low.canvas);
    if (up.visible) { const g = ctxOf(low.canvas); g.save(); g.globalAlpha = up.opacity; g.drawImage(up.canvas, 0, 0); g.restore(); }
    const p = this.patchCmd(low, snap, { x: 0, y: 0, w: this.W, h: this.H });
    this.structural(() => { this.layers.splice(i, 1); this.active = i - 1; }, p ? [p] : []);
  }

  /* ---------- 合成 ---------- */
  private tmpCanvas() { if (!this.tmp || this.tmp.width !== this.W || this.tmp.height !== this.H) this.tmp = makeCanvas(this.W, this.H); return this.tmp; }
  /** 把一个图层（带笔触预览、浮动内容）画到 g 上；g 的变换由调用方设好 */
  drawLayer(g: CanvasRenderingContext2D, l: Layer) {
    let src: HTMLCanvasElement = l.canvas;
    if (this.stroke && this.stroke.target === l) {
      const t = this.tmpCanvas(), tg = ctxOf(t);
      tg.globalCompositeOperation = 'copy'; tg.globalAlpha = 1; tg.drawImage(l.canvas, 0, 0);
      tg.globalCompositeOperation = this.stroke.erase ? 'destination-out' : 'source-over';
      tg.globalAlpha = this.stroke.alpha; tg.drawImage(this.stroke.canvas, 0, 0);
      tg.globalCompositeOperation = 'source-over'; tg.globalAlpha = 1;
      src = t;
    }
    g.save(); g.globalAlpha = l.opacity; g.drawImage(src, 0, 0);
    const f = this.floating;
    if (f && f.layer === l) {
      g.translate(f.box.cx, f.box.cy); g.rotate(f.box.rot); g.scale(f.box.w / f.ow, f.box.h / f.oh);
      g.imageSmoothingQuality = 'high';
      g.drawImage(f.content, -f.ow / 2, -f.oh / 2);
    }
    g.restore();
  }
  drawLayers(g: CanvasRenderingContext2D) { for (const l of this.layers) if (l.visible) this.drawLayer(g, l); }
  /** 所有可见图层合起来的样子（取色、填充、仿制图章用），有缓存 */
  merged(): HTMLCanvasElement {
    if (this.mergedCache && this.mergedAt === this.version && this.mergedCache.width === this.W && this.mergedCache.height === this.H) return this.mergedCache;
    const c = this.mergedCache && this.mergedCache.width === this.W && this.mergedCache.height === this.H ? this.mergedCache : makeCanvas(this.W, this.H);
    const g = ctxOf(c); g.clearRect(0, 0, this.W, this.H); this.drawLayers(g);
    this.mergedCache = c; this.mergedAt = this.version;
    return c;
  }
  flatten(): HTMLCanvasElement { const c = makeCanvas(this.W, this.H); this.drawLayers(ctxOf(c)); return c; }
  pick(x: number, y: number): [number, number, number, number] {
    const d = ctxOf(this.merged()).getImageData(Math.max(0, Math.min(this.W - 1, Math.floor(x))), Math.max(0, Math.min(this.H - 1, Math.floor(y))), 1, 1).data;
    return [d[0], d[1], d[2], d[3]];
  }

  /* ---------- 选区 ---------- */
  setSelection(pts: Pt[] | null) {
    this.sel = pts && pts.length >= 3 ? pts : null;
    if (this.sel) {
      const c = this.selCanvas && this.selCanvas.width === this.W && this.selCanvas.height === this.H ? this.selCanvas : makeCanvas(this.W, this.H);
      const g = ctxOf(c); g.clearRect(0, 0, this.W, this.H);
      g.fillStyle = '#fff'; g.beginPath(); this.sel.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.fill();
      this.selCanvas = c;
    } else this.selCanvas = null;
    this.bump();
  }
  selectAll() { this.setSelection([{ x: 0, y: 0 }, { x: this.W, y: 0 }, { x: this.W, y: this.H }, { x: 0, y: this.H }]); }
  selBounds(): Rect | null {
    if (!this.sel) return null;
    const xs = this.sel.map(p => p.x), ys = this.sel.map(p => p.y);
    return clampRect({ x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) }, this.W, this.H);
  }
  /** 把绘制限制在选区里 */
  clipToSelection(g: CanvasRenderingContext2D) {
    if (!this.sel) return;
    g.beginPath(); this.sel.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath(); g.clip();
  }
  /** 选区里每个像素的权重 0–255（区域 r 内），没有选区时返回 null */
  selWeights(r: Rect): Uint8Array | null {
    if (!this.selCanvas) return null;
    const d = ctxOf(this.selCanvas).getImageData(r.x, r.y, r.w, r.h).data, out = new Uint8Array(r.w * r.h);
    for (let i = 0; i < out.length; i++) out[i] = d[i * 4 + 3];
    return out;
  }
  /** 删除选区里的内容 */
  clearSelection() {
    const l = this.layer, r = this.selBounds();
    if (!l || !r || !this.selCanvas) return;
    const snap = cloneCanvas(l.canvas), g = ctxOf(l.canvas);
    g.save(); g.globalCompositeOperation = 'destination-out'; g.drawImage(this.selCanvas, 0, 0); g.restore();
    this.commitPatch(l, snap, r);
  }

  /* ---------- 填充 ---------- */
  /** 油漆桶：按所有可见图层的样子找区域，填进当前图层；不越过选区 */
  fill(x: number, y: number, color: string, tolerance: number, alpha = 1) {
    const l = this.layer; if (!l) return;
    const data = ctxOf(this.merged()).getImageData(0, 0, this.W, this.H).data;
    let limit: Uint8Array | null = null;
    if (this.selCanvas) { const w = this.selWeights({ x: 0, y: 0, w: this.W, h: this.H })!; limit = w.map(v => (v > 127 ? 1 : 0)); }
    let region = floodFill(data, this.W, this.H, x, y, tolerance, limit);
    region = dilate(region, this.W, this.H, 1);
    if (limit) region = region.map((v, i) => v & limit![i]);
    const b = maskBounds(region, this.W, this.H); if (!b) return;
    const [r, g, bl] = hexToRgb(color), img = new ImageData(b.w, b.h);
    for (let yy = 0; yy < b.h; yy++) for (let xx = 0; xx < b.w; xx++) {
      if (!region[(b.y + yy) * this.W + b.x + xx]) continue;
      const i = (yy * b.w + xx) * 4; img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = bl; img.data[i + 3] = 255;
    }
    const t = makeCanvas(b.w, b.h); ctxOf(t).putImageData(img, 0, 0);
    const snap = cloneCanvas(l.canvas), lg = ctxOf(l.canvas);
    lg.save(); lg.globalAlpha = alpha; lg.drawImage(t, b.x, b.y); lg.restore();
    this.commitPatch(l, snap, b);
  }

  /* ---------- 颜色调整 ---------- */
  private adj: { layer: Layer; r: Rect; orig: ImageData; weights: Uint8Array | null } | null = null;
  beginAdjust() {
    const l = this.layer; if (!l) return false;
    const r = this.selBounds() ?? { x: 0, y: 0, w: this.W, h: this.H };
    this.adj = { layer: l, r, orig: ctxOf(l.canvas).getImageData(r.x, r.y, r.w, r.h), weights: this.selWeights(r) };
    return true;
  }
  previewAdjust(dh: number, ds: number, dv: number) {
    const a = this.adj; if (!a) return;
    const d = new ImageData(new Uint8ClampedArray(a.orig.data), a.r.w, a.r.h);
    adjustHsv(d.data, dh, ds, dv, a.weights);
    ctxOf(a.layer.canvas).putImageData(d, a.r.x, a.r.y);
    this.bump();
  }
  endAdjust(apply: boolean) {
    const a = this.adj; if (!a) return;
    this.adj = null;
    const g = ctxOf(a.layer.canvas);
    if (!apply) { g.putImageData(a.orig, a.r.x, a.r.y); this.bump(); return; }
    this.push({ kind: 'patch', target: a.layer, x: a.r.x, y: a.r.y, before: a.orig, after: g.getImageData(a.r.x, a.r.y, a.r.w, a.r.h) });
    this.paintDirty = true; this.bump();
  }
  get adjusting() { return !!this.adj; }

  /* ---------- 浮动变换 ---------- */
  /** 拿起选区里的内容（没有选区时拿起整个图层的内容），进入变换 */
  lift(): boolean {
    const l = this.layer; if (!l || this.floating) return !!this.floating;
    let r: Rect | null;
    if (this.sel) r = this.selBounds();
    else {
      const d = ctxOf(l.canvas).getImageData(0, 0, this.W, this.H).data, m = new Uint8Array(this.W * this.H);
      for (let i = 0; i < m.length; i++) m[i] = d[i * 4 + 3] ? 1 : 0;
      r = maskBounds(m, this.W, this.H);
    }
    if (!r) return false;
    const snapshot = cloneCanvas(l.canvas), content = makeCanvas(r.w, r.h), cg = ctxOf(content);
    cg.drawImage(l.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    const lg = ctxOf(l.canvas);
    if (this.selCanvas) {
      cg.globalCompositeOperation = 'destination-in'; cg.drawImage(this.selCanvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
      lg.save(); lg.globalCompositeOperation = 'destination-out'; lg.drawImage(this.selCanvas, 0, 0); lg.restore();
    } else lg.clearRect(r.x, r.y, r.w, r.h);
    this.floating = { content, ow: r.w, oh: r.h, box: { cx: r.x + r.w / 2, cy: r.y + r.h / 2, w: r.w, h: r.h, rot: 0 }, layer: l, snapshot, from: r };
    this.bump();
    return true;
  }
  /** 把一张外来的图作为新图层上的浮动内容（粘贴、拖入），太大时缩到画布里 */
  pasteFloating(src: CanvasImageSource & { width: number; height: number }, name: string, at?: Pt) {
    this.commitFloating();
    let l!: Layer;
    this.structural(() => { l = this.addLayerFrom(null, name, this.active + 1); this.active = this.layers.indexOf(l); });
    const content = makeCanvas(src.width, src.height); ctxOf(content).drawImage(src, 0, 0);
    const k = Math.min(1, (this.W * 0.9) / src.width, (this.H * 0.9) / src.height);
    const c = at ?? { x: this.W / 2, y: this.H / 2 };
    this.floating = { content, ow: src.width, oh: src.height, box: { cx: c.x, cy: c.y, w: src.width * k, h: src.height * k, rot: 0 }, layer: l, snapshot: cloneCanvas(l.canvas), from: { x: 0, y: 0, w: 0, h: 0 } };
    this.setSelection(null);
  }
  commitFloating() {
    const f = this.floating; if (!f) return;
    this.floating = null;
    const g = ctxOf(f.layer.canvas);
    g.save(); g.translate(f.box.cx, f.box.cy); g.rotate(f.box.rot); g.scale(f.box.w / f.ow, f.box.h / f.oh);
    g.imageSmoothingQuality = 'high'; g.drawImage(f.content, -f.ow / 2, -f.oh / 2); g.restore();
    const r = f.from.w ? unionRect(f.from, aabb(f.box)) : aabb(f.box);
    this.sel = null; this.selCanvas = null;
    this.commitPatch(f.layer, f.snapshot, { x: r.x - 2, y: r.y - 2, w: r.w + 4, h: r.h + 4 });
  }
  cancelFloating() {
    const f = this.floating; if (!f) return;
    this.floating = null;
    const g = ctxOf(f.layer.canvas); g.save(); g.globalCompositeOperation = 'copy'; g.drawImage(f.snapshot, 0, 0); g.restore();
    this.bump();
  }

  /* ---------- 改画布尺寸（扩图）：所有图层和遮罩一起平移，新区域加进遮罩 ---------- */
  resize(W: number, H: number, dx: number, dy: number, fillMask: Rect | null) {
    this.commitFloating();
    const move = (c: HTMLCanvasElement) => { const n = makeCanvas(W, H); ctxOf(n).drawImage(c, dx, dy); return n; };
    for (const l of this.layers) l.canvas = move(l.canvas);
    const m = move(this.mask), mg = ctxOf(m);
    if (fillMask) {
      // 原图范围外的区域全部加进遮罩
      mg.save(); mg.fillStyle = '#fff'; mg.fillRect(0, 0, W, H);
      mg.globalCompositeOperation = 'destination-out'; mg.fillRect(fillMask.x, fillMask.y, fillMask.w, fillMask.h); mg.restore();
      mg.drawImage(move(this.mask), 0, 0);
    }
    this.mask = m;
    if (this.focus) this.focus = { ...this.focus, x: this.focus.x + dx, y: this.focus.y + dy };
    this.W = W; this.H = H;
    this.sel = null; this.selCanvas = null; this.stroke = null;
    this.clearHistory();
    this.paintDirty = true;
    this.bump();
  }
}
