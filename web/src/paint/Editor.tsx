import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CONTEXT_RANGE, MAX_PIXELS, corners, dragBox, focusRegion, focusSize, handlePoints, hitBox, rgbToHex, type Handle, type Rect } from '@nai/shared';
import { isImage } from '../graph.ts';
import { uploadBlob } from '../inpaint.ts';
import { matchBaseSize } from '../inputs.ts';
import { run } from '../run.ts';
import { node, toast, updateData, useStore } from '../store.ts';
import { Seg, Slider } from '../ui/controls.tsx';
import { PaintDoc, cloneCanvas, ctxOf, makeCanvas, type Pt } from './doc.ts';
import { Stroke, type Tip } from './brush.ts';
import { ColorPanel, LayersPanel } from './panels.tsx';

export type EditorMode = 'paint' | 'mask';
type PaintTool = 'brush' | 'erase' | 'fill' | 'select' | 'lasso' | 'move' | 'picker' | 'blur' | 'clone';
type MaskTool = 'brush' | 'erase' | 'focus';
const PAINT_TOOLS: [PaintTool, string, string][] = [['brush', '画笔', 'B'], ['erase', '橡皮', 'E'], ['fill', '填充', 'G'], ['select', '选区', 'S'], ['lasso', '套索', 'L'], ['move', '变换', 'V'], ['picker', '取色', 'C'], ['blur', '模糊', 'R'], ['clone', '仿制', 'J']];
const MASK_TOOLS: [MaskTool, string, string][] = [['brush', '画遮罩', 'B'], ['erase', '擦遮罩', 'E'], ['focus', '聚焦框', 'F']];
const TIPS: { v: Tip; l: string }[] = [{ v: 'round', l: '圆' }, { v: 'soft', l: '柔边' }, { v: 'square', l: '方' }];
const CURSOR: Record<Handle | 'inside', string> = { nw: 'nwse-resize', se: 'nwse-resize', ne: 'nesw-resize', sw: 'nesw-resize', n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', rot: 'grab', inside: 'move' };

interface Settings { size: number; maskSize: number; alpha: number; tip: Tip; pressure: boolean; color: string; recent: string[]; tolerance: number; intensity: number; square: boolean }
const DEF: Settings = { size: 20, maskSize: 48, alpha: 1, tip: 'round', pressure: true, color: '#000000', recent: [], tolerance: 15, intensity: 50, square: false };
// 笔刷设置记在浏览器里，下次打开还是这些（只是方便，丢了也没关系）
function loadSettings(): Settings { try { return { ...DEF, ...JSON.parse(localStorage.getItem('nai-paint') ?? '{}') }; } catch { return DEF; } }
function storeSettings(s: Settings) { try { localStorage.setItem('nai-paint', JSON.stringify(s)); } catch { /* 存不了就算了 */ } }

interface Pad { l: number; t: number; r: number; b: number }
const NO_PAD: Pad = { l: 0, t: 0, r: 0, b: 0 };
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error('图片编码失败'))), 'image/png'));
async function bitmap(url: string) { return createImageBitmap(await (await fetch(url)).blob()); }

/** 遮罩上有没有画东西：逐块读全分辨率，很细的几笔也不会漏掉（缩小估算会把细笔画平均没了） */
function hasPaint(c: HTMLCanvasElement) {
  const g = ctxOf(c), rows = Math.max(1, Math.floor(4_000_000 / c.width));
  for (let y = 0; y < c.height; y += rows) {
    const d = g.getImageData(0, y, c.width, Math.min(rows, c.height - y)).data;
    for (let i = 3; i < d.length; i += 4) if (d[i] > 32) return true;
  }
  return false;
}

/** 遮罩覆盖了多少（缩小后估算，只用来显示） */
function coverage(c: HTMLCanvasElement) {
  const s = makeCanvas(96, Math.max(1, Math.round((96 * c.height) / c.width))), g = ctxOf(s);
  g.drawImage(c, 0, 0, s.width, s.height);
  const d = g.getImageData(0, 0, s.width, s.height).data;
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 64) n++;
  return n / (s.width * s.height);
}

export interface EditorProps { id: string; runAfter?: string; mode?: EditorMode; blank?: [number, number] }

/**
 * 全屏的画布编辑器。绘画模式：图层上画画、填充、选区和变换、取色、模糊、仿制、调色；
 * 遮罩模式：涂局部重绘的遮罩、框聚焦区域。两种模式都能扩图。
 * 保存时：画过的话把所有可见图层合成一张新图（多个图层时各图层也存下，下次能接着改），遮罩另存
 */
export function Editor({ id, runAfter, mode: initMode, blank }: EditorProps) {
  const n = node(id);
  const data = isImage(n) ? n.data : null;
  const view = useRef<HTMLCanvasElement>(null), over = useRef<HTMLCanvasElement>(null), wrap = useRef<HTMLDivElement>(null);
  const docRef = useRef<PaintDoc | null>(null);
  const [ver, setVer] = useState(0);
  const [ready, setReady] = useState(false);
  const [mode, setModeState] = useState<EditorMode>(initMode ?? 'mask');
  const [ptool, setPtool] = useState<PaintTool>('brush');
  const [mtool, setMtool] = useState<MaskTool>('brush');
  const [S, setS] = useState<Settings>(loadSettings);
  const upd = useCallback((patch: Partial<Settings> | ((s: Settings) => Partial<Settings>)) => setS(s => { const next = { ...s, ...(typeof patch === 'function' ? patch(s) : patch) }; storeSettings(next); return next; }), []);
  const [orig, setOrig] = useState({ w: 1, h: 1 });
  const [pad, setPad] = useState<Pad>(NO_PAD);
  const padRef = useRef(pad);
  const [ctxCells, setCtx] = useState(data?.ctx ?? CONTEXT_RANGE.def);
  const [showMask, setShowMask] = useState(false);
  const [space, setSpace] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hsv, setHsv] = useState<{ h: number; s: number; v: number } | null>(null);
  const [cloneSrc, setCloneSrc] = useState<Pt | null>(null);
  const cloneOff = useRef<Pt | null>(null);
  const baseVer = useRef(0);
  const vp = useRef({ s: 1, x: 0, y: 0 });
  const ptr = useRef<{ x: number; y: number } | null>(null);
  const lasso = useRef<Pt[] | null>(null);
  const rectSel = useRef<{ a: Pt; b: Pt } | null>(null);
  const focusDrag = useRef<Rect | null>(null);
  const ants = useRef(0);
  const prevTool = useRef<PaintTool>('brush');
  const clip = useRef<{ c: HTMLCanvasElement; at: Pt } | null>(null);
  const escArmed = useRef(false);
  const live = useRef({ mode, ptool, mtool, S, space, showMask, cloneSrc, ctxCells });
  live.current = { mode, ptool, mtool, S, space, showMask, cloneSrc, ctxCells };
  const gens = useStore(s => s.edges.filter(e => e.source === id && e.data?.slot === 'base').map(e => e.target).join(','));
  const target = runAfter ?? (gens ? gens.split(',')[0] : undefined);
  const close = useCallback(() => useStore.setState({ modal: null }), []);
  const doc = docRef.current;

  /* ---------- 绘制：内容画布（图层、遮罩）和覆盖层（选区、变换框、光标）分开，移动鼠标只重画覆盖层 ---------- */
  const tint = useRef<HTMLCanvasElement | null>(null);
  const pattern = useRef<CanvasPattern | null>(null);
  const drawContent = useCallback(() => {
    const c = view.current, d = docRef.current; if (!c || !d) return;
    const dpr = devicePixelRatio || 1, g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, c.width, c.height);
    const { s, x, y } = vp.current, L = live.current;
    g.save(); g.translate(x, y); g.scale(s, s);
    if (!pattern.current) {
      const p = makeCanvas(16, 16), pg = ctxOf(p);
      pg.fillStyle = '#ecece8'; pg.fillRect(0, 0, 16, 16); pg.fillStyle = '#d4d4cf'; pg.fillRect(0, 0, 8, 8); pg.fillRect(8, 8, 8, 8);
      pattern.current = g.createPattern(p, 'repeat');
    }
    g.fillStyle = pattern.current!; g.fillRect(0, 0, d.W, d.H);
    g.imageSmoothingEnabled = s < 2; g.imageSmoothingQuality = 'high';
    d.drawLayers(g);
    if (L.mode === 'mask' || L.showMask) {
      const t = tint.current && tint.current.width === d.W && tint.current.height === d.H ? tint.current : (tint.current = makeCanvas(d.W, d.H));
      const tg = ctxOf(t);
      tg.globalCompositeOperation = 'copy'; tg.fillStyle = '#d71921'; tg.fillRect(0, 0, d.W, d.H);
      tg.globalCompositeOperation = 'destination-in'; tg.drawImage(d.mask, 0, 0); tg.globalCompositeOperation = 'source-over';
      g.globalAlpha = L.mode === 'mask' ? 0.5 : 0.3; g.drawImage(t, 0, 0); g.globalAlpha = 1;
    }
    g.restore();
  }, []);
  const drawOverlay = useCallback(() => {
    const c = over.current, d = docRef.current; if (!c || !d) return;
    const dpr = devicePixelRatio || 1, g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, c.width, c.height);
    const { s, x, y } = vp.current, L = live.current;
    g.save(); g.translate(x, y); g.scale(s, s);
    g.lineWidth = 1 / s; g.strokeStyle = 'rgba(0,0,0,.35)'; g.strokeRect(0, 0, d.W, d.H);
    const pd = padRef.current;
    if (pd.l || pd.t || pd.r || pd.b) { g.setLineDash([4 / s, 4 / s]); g.strokeStyle = 'rgba(0,0,0,.45)'; g.strokeRect(pd.l, pd.t, d.W - pd.l - pd.r, d.H - pd.t - pd.b); g.setLineDash([]); }
    // 选区：黑白相间的蚂蚁线
    const ant = (pts: Pt[], closed: boolean) => {
      g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); if (closed) g.closePath();
      g.lineWidth = 1.2 / s; g.setLineDash([5 / s, 4 / s]);
      g.strokeStyle = '#000'; g.lineDashOffset = -ants.current / s; g.stroke();
      g.strokeStyle = '#fff'; g.lineDashOffset = -ants.current / s + 4.5 / s; g.stroke();
      g.setLineDash([]);
    };
    if (d.sel && !d.floating) ant(d.sel, true);
    if (lasso.current) ant(lasso.current, false);
    if (rectSel.current) { const { a, b } = rectSel.current; ant([a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }], true); }
    // 变换框和手柄
    const f = d.floating;
    if (f) {
      const cs = corners(f.box), hp = handlePoints(f.box, 26 / s);
      g.beginPath(); cs.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
      g.lineWidth = 1.5 / s; g.strokeStyle = '#d71921'; g.stroke();
      const top = { x: (cs[0].x + cs[1].x) / 2, y: (cs[0].y + cs[1].y) / 2 };
      g.beginPath(); g.moveTo(top.x, top.y); g.lineTo(hp.rot.x, hp.rot.y); g.stroke();
      for (const [k, p] of Object.entries(hp)) {
        g.beginPath();
        if (k === 'rot') g.arc(p.x, p.y, 5 / s, 0, Math.PI * 2); else g.rect(p.x - 4.5 / s, p.y - 4.5 / s, 9 / s, 9 / s);
        g.fillStyle = '#fff'; g.fill(); g.lineWidth = 1.5 / s; g.strokeStyle = '#d71921'; g.stroke();
      }
    }
    // 聚焦区域：实线是框，虚线是实际参与重绘的范围
    const fr = focusDrag.current ?? d.focus;
    if (L.mode === 'mask' && fr) {
      const r = focusRegion(fr, L.ctxCells, d.W, d.H);
      g.setLineDash([6 / s, 5 / s]); g.strokeStyle = '#d71921'; g.lineWidth = 1.5 / s; g.strokeRect(r.x, r.y, r.w, r.h);
      g.setLineDash([]); g.strokeStyle = '#fff'; g.lineWidth = 2 / s; g.strokeRect(fr.x, fr.y, fr.w, fr.h);
    }
    // 仿制图章的取样点
    if (L.mode === 'paint' && L.ptool === 'clone' && L.cloneSrc) {
      let p = L.cloneSrc;
      const pp = ptr.current;
      if (cloneOff.current && pp) p = { x: (pp.x - x) / s - cloneOff.current.x, y: (pp.y - y) / s - cloneOff.current.y };
      const r = 7 / s;
      g.lineWidth = 1.5 / s; g.strokeStyle = '#fff';
      g.beginPath(); g.moveTo(p.x - r, p.y); g.lineTo(p.x + r, p.y); g.moveTo(p.x, p.y - r); g.lineTo(p.x, p.y + r); g.stroke();
      g.strokeStyle = '#d71921'; g.lineWidth = 0.8 / s; g.stroke();
    }
    g.restore();
    // 笔刷光标
    const p = ptr.current;
    const brushy = L.mode === 'mask' ? L.mtool !== 'focus' : ['brush', 'erase', 'blur', 'clone'].includes(L.ptool);
    if (p && brushy && !L.space) {
      const size = L.mode === 'mask' ? L.S.maskSize : L.S.size, r = (size / 2) * s;
      const sq = L.mode === 'mask' ? L.S.square : L.S.tip === 'square';
      g.beginPath();
      if (sq) g.rect(p.x - r, p.y - r, r * 2, r * 2); else g.arc(p.x, p.y, Math.max(1, r), 0, Math.PI * 2);
      g.lineWidth = 1.5; g.strokeStyle = '#fff'; g.stroke(); g.lineWidth = 1; g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke();
      if (r < 4) { g.beginPath(); g.moveTo(p.x - 6, p.y); g.lineTo(p.x + 6, p.y); g.moveTo(p.x, p.y - 6); g.lineTo(p.x, p.y + 6); g.stroke(); }
    }
  }, []);
  const raf = useRef(0), need = useRef(false);
  const schedule = useCallback((content = true) => {
    if (content) need.current = true;
    if (raf.current) return;
    raf.current = requestAnimationFrame(() => { raf.current = 0; if (need.current) drawContent(); need.current = false; drawOverlay(); });
  }, [drawContent, drawOverlay]);
  useEffect(() => { schedule(true); }, [mode, showMask, ptool, mtool, S, space, cloneSrc, ctxCells, pad, schedule]);

  /* ---------- 载入 ---------- */
  const fit = useCallback(() => {
    const el = wrap.current, d = docRef.current; if (!el || !d) return;
    const r = el.getBoundingClientRect();
    const s = Math.min((r.width - 80) / d.W, (r.height - 80) / d.H, 2);
    vp.current = { s, x: (r.width - d.W * s) / 2, y: (r.height - d.H * s) / 2 };
    schedule(true);
  }, [schedule]);
  useEffect(() => {
    if (!data) return;
    let dead = false;
    (async () => {
      let d: PaintDoc;
      if (blank) {
        d = new PaintDoc(blank[0], blank[1]);
        const bg = d.addLayerFrom(null, '背景'), g = ctxOf(bg.canvas);
        g.fillStyle = '#fff'; g.fillRect(0, 0, blank[0], blank[1]);
        d.addLayerFrom(null, '图层 1'); d.active = 1; d.paintDirty = true;
      } else {
        const im = await bitmap(data.url);
        d = new PaintDoc(im.width, im.height);
        let ok = false;
        if (data.layers?.length) {
          try {
            const bms = await Promise.all(data.layers.map(l => bitmap(l.url)));
            if (bms.every(b => b.width === im.width && b.height === im.height)) {
              data.layers.forEach((l, i) => { const L = d.addLayerFrom(bms[i], l.name); L.visible = l.visible; L.opacity = l.opacity; });
              d.active = d.layers.length - 1; ok = true;
            }
            bms.forEach(b => b.close());
          } catch { /* 图层文件丢了就只用合成好的图 */ }
        }
        if (!ok) d.addLayerFrom(im, '原图');
        im.close();
        if (data.mask) { try { const mb = await bitmap(data.mask); ctxOf(d.mask).drawImage(mb, 0, 0, d.W, d.H); mb.close(); } catch { /* 遮罩丢了就从空白开始 */ } }
        d.focus = data.focus ?? null;
      }
      if (dead) return;
      d.onChange = () => { setVer(v => v + 1); schedule(true); };
      docRef.current = d; baseVer.current = d.version;
      setOrig({ w: d.W, h: d.H }); setReady(true);
      requestAnimationFrame(fit);
    })().catch(e => { toast(`打不开这张图：${(e as Error).message}`, { err: true }); close(); });
    return () => { dead = true; };
  }, [data?.url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => {
      const r = el.getBoundingClientRect(), dpr = devicePixelRatio || 1;
      for (const c of [view.current, over.current]) { if (!c) continue; c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); c.style.width = `${r.width}px`; c.style.height = `${r.height}px`; }
      schedule(true);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [schedule]);
  // 有选区、变换框时让蚂蚁线动起来
  useEffect(() => {
    const t = setInterval(() => { const d = docRef.current; if (d && (d.sel || d.floating || lasso.current)) { ants.current = (ants.current + 1) % 1000; schedule(false); } }, 110);
    return () => clearInterval(t);
  }, [schedule]);

  /* ---------- 工具和模式切换 ---------- */
  const setMode = (m: EditorMode) => {
    const d = docRef.current;
    if (d) { d.commitFloating(); if (d.adjusting) { d.endAdjust(false); setHsv(null); } }
    setModeState(m);
  };
  const pickTool = (t: PaintTool) => {
    const d = docRef.current;
    if (t !== 'move') d?.commitFloating();
    if (t === 'picker' && ptool !== 'picker') prevTool.current = ptool;
    setPtool(t);
    if (t === 'move' && d && !d.floating && d.sel) d.lift();
  };
  const addRecent = (c: string) => upd(s => ({ recent: [c, ...s.recent.filter(x => x !== c)].slice(0, 10) }));
  const pickAt = (p: Pt) => {
    const d = docRef.current!; const [r, g, b, a] = d.pick(p.x, p.y);
    if (!a) { toast('这里是透明的，没有颜色可取'); return; }
    upd({ color: rgbToHex(r, g, b) });
  };

  /* ---------- 指针 ---------- */
  const toDoc = (cx: number, cy: number) => {
    const r = over.current!.getBoundingClientRect(), { s, x, y } = vp.current;
    return { x: (cx - r.left - x) / s, y: (cy - r.top - y) / s };
  };
  const pressureOf = (e: { pointerType: string; pressure: number }) => (e.pointerType === 'pen' ? e.pressure || 0.5 : 1);
  const onDown = (e: React.PointerEvent) => {
    const d = docRef.current; if (!d || !ready) return;
    const c = over.current!; c.setPointerCapture(e.pointerId);
    const L = live.current, sx = e.clientX, sy = e.clientY, v0 = { ...vp.current };
    const track = (onMove: (ev: PointerEvent) => void, onUp?: (ev: PointerEvent) => void) => {
      const move = (ev: PointerEvent) => { const r = c.getBoundingClientRect(); ptr.current = { x: ev.clientX - r.left, y: ev.clientY - r.top }; onMove(ev); schedule(false); };
      const up = (ev: PointerEvent) => { c.removeEventListener('pointermove', move); c.removeEventListener('pointerup', up); c.removeEventListener('pointercancel', up); onUp?.(ev); schedule(true); };
      c.addEventListener('pointermove', move); c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    };
    if (e.button === 1 || e.button === 2 || L.space) { track(ev => { vp.current = { ...v0, x: v0.x + ev.clientX - sx, y: v0.y + ev.clientY - sy }; schedule(true); }); return; }
    if (e.button !== 0) return;
    const p0 = toDoc(sx, sy);
    const strokeWith = (o: ConstructorParameters<typeof Stroke>[1]) => {
      const st = new Stroke(d, o);
      st.move({ ...p0, p: pressureOf(e) }); schedule(true);
      track(ev => {
        const list = ev.getCoalescedEvents?.() ?? [ev];
        for (const ce of list.length ? list : [ev]) { const p = toDoc(ce.clientX, ce.clientY); st.move({ ...p, p: pressureOf(ce) }); }
        schedule(true);
      }, () => st.end());
    };
    if (L.mode === 'mask') {
      if (L.mtool === 'focus') {
        track(ev => {
          const p = toDoc(ev.clientX, ev.clientY);
          const x = Math.max(0, Math.min(p0.x, p.x)), y = Math.max(0, Math.min(p0.y, p.y));
          const x2 = Math.min(d.W, Math.max(p0.x, p.x)), y2 = Math.min(d.H, Math.max(p0.y, p.y));
          focusDrag.current = { x: Math.round(x), y: Math.round(y), w: Math.round(x2 - x), h: Math.round(y2 - y) };
        }, () => { const f = focusDrag.current; focusDrag.current = null; d.setFocus(f && f.w >= 8 && f.h >= 8 ? f : null); });
        return;
      }
      strokeWith({ tool: L.mtool === 'erase' || e.altKey ? 'unmask' : 'mask', size: L.S.maskSize, tip: L.S.square ? 'square' : 'round', color: '#ffffff', alpha: 1, pressure: false, intensity: 0 });
      return;
    }
    const t = L.ptool;
    if ((e.ctrlKey || e.metaKey) && (t === 'brush' || t === 'fill')) { pickAt(p0); return; }
    if (d.floating && t !== 'move') d.commitFloating();
    switch (t) {
      case 'brush': case 'erase':
        strokeWith({ tool: t, size: L.S.size, tip: L.S.tip, color: L.S.color, alpha: L.S.alpha, pressure: L.S.pressure, intensity: 0 });
        if (t === 'brush') addRecent(L.S.color);
        return;
      case 'blur':
        strokeWith({ tool: 'blur', size: L.S.size, tip: 'round', color: '#000000', alpha: 1, pressure: L.S.pressure, intensity: L.S.intensity });
        return;
      case 'clone': {
        if (e.altKey) { setCloneSrc(p0); cloneOff.current = null; toast('已设好取样点，在别处涂抹就会把这里复制过去'); return; }
        if (!L.cloneSrc) { toast('先按住 Alt 点一下要复制的地方', { err: true }); return; }
        if (!cloneOff.current) cloneOff.current = { x: p0.x - L.cloneSrc.x, y: p0.y - L.cloneSrc.y };
        strokeWith({ tool: 'clone', size: L.S.size, tip: 'round', color: '#000000', alpha: L.S.alpha, pressure: L.S.pressure, intensity: 0, cloneOffset: cloneOff.current });
        return;
      }
      case 'fill': d.fill(p0.x, p0.y, L.S.color, L.S.tolerance, L.S.alpha); addRecent(L.S.color); return;
      case 'picker': pickAt(p0); setPtool(prevTool.current); return;
      case 'select':
        rectSel.current = { a: p0, b: p0 };
        track(ev => { rectSel.current = { a: p0, b: toDoc(ev.clientX, ev.clientY) }; }, () => {
          const r = rectSel.current!; rectSel.current = null;
          const x0 = Math.max(0, Math.min(r.a.x, r.b.x)), y0 = Math.max(0, Math.min(r.a.y, r.b.y)), x1 = Math.min(d.W, Math.max(r.a.x, r.b.x)), y1 = Math.min(d.H, Math.max(r.a.y, r.b.y));
          d.setSelection(x1 - x0 < 2 || y1 - y0 < 2 ? null : [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }]);
        });
        return;
      case 'lasso':
        lasso.current = [p0];
        track(ev => {
          const p = toDoc(ev.clientX, ev.clientY), l = lasso.current!, last = l[l.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) * vp.current.s >= 3) l.push(p);
        }, () => { const pts = lasso.current!; lasso.current = null; d.setSelection(pts.length >= 3 ? pts : null); });
        return;
      case 'move': {
        const fresh = !d.floating;
        if (fresh && !d.lift()) { toast('这个图层是空的，没有可以移动的内容'); return; }
        const f = d.floating!, s = vp.current.s;
        const h = hitBox(f.box, p0.x, p0.y, 9 / s, 26 / s) ?? (fresh ? 'inside' : null);
        if (!h) { d.commitFloating(); return; }
        const start = { ...f.box };
        track(ev => { f.box = dragBox(start, h, p0, toDoc(ev.clientX, ev.clientY), { shift: ev.shiftKey, alt: ev.altKey }); schedule(true); });
        return;
      }
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const c = over.current!, r = c.getBoundingClientRect();
    ptr.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    // 变换框上的手柄换成对应的鼠标样式
    const d = docRef.current, L = live.current;
    if (d?.floating && L.mode === 'paint' && L.ptool === 'move' && !L.space) {
      const p = toDoc(e.clientX, e.clientY), h = hitBox(d.floating.box, p.x, p.y, 9 / vp.current.s, 26 / vp.current.s);
      c.style.cursor = h ? CURSOR[h] : 'default';
    } else c.style.cursor = '';
    schedule(false);
  };
  const onWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const c = over.current!, r = c.getBoundingClientRect(), v = vp.current;
    if (e.ctrlKey || e.metaKey) {
      const k = Math.exp(-e.deltaY * 0.0015), s = Math.min(16, Math.max(0.05, v.s * k));
      const px = e.clientX - r.left, py = e.clientY - r.top;
      vp.current = { s, x: px - ((px - v.x) * s) / v.s, y: py - ((py - v.y) * s) / v.s };
    } else vp.current = { ...v, x: v.x - e.deltaX, y: v.y - e.deltaY };
    schedule(true);
  }, [schedule]);
  useEffect(() => {
    const c = over.current; if (!c) return;
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => c.removeEventListener('wheel', onWheel);
  }, [onWheel]);

  /* ---------- 遮罩、选区、颜色调整 ---------- */
  const maskEdit = (fn: (g: CanvasRenderingContext2D, W: number, H: number) => void) => {
    const d = docRef.current; if (!d) return;
    const snap = cloneCanvas(d.mask), g = ctxOf(d.mask);
    g.save(); fn(g, d.W, d.H); g.restore();
    d.commitPatch('mask', snap, { x: 0, y: 0, w: d.W, h: d.H });
  };
  const clearMask = () => maskEdit((g, W, H) => g.clearRect(0, 0, W, H));
  const invertMask = () => maskEdit((g, W, H) => {
    const old = cloneCanvas(g.canvas as HTMLCanvasElement);
    g.globalCompositeOperation = 'copy'; g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
    g.globalCompositeOperation = 'destination-out'; g.drawImage(old, 0, 0);
  });
  const copySel = () => {
    const d = docRef.current; if (!d) return;
    const r = d.selBounds();
    if (!r || !d.selCanvas) { toast('先用选区或套索框出要复制的部分'); return; }
    const c = makeCanvas(r.w, r.h), g = ctxOf(c);
    g.drawImage(d.layer.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    g.globalCompositeOperation = 'destination-in'; g.drawImage(d.selCanvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
    clip.current = { c, at: { x: r.x + r.w / 2, y: r.y + r.h / 2 } };
    toast('已复制选区里的内容，Ctrl+V 粘贴成新图层');
  };
  useEffect(() => {
    if (!hsv) return;
    const t = requestAnimationFrame(() => docRef.current?.previewAdjust(hsv.h, hsv.s, hsv.v));
    return () => cancelAnimationFrame(t);
  }, [hsv]);
  const startAdjust = () => {
    const d = docRef.current; if (!d) return;
    d.commitFloating();
    if (d.beginAdjust()) setHsv({ h: 0, s: 0, v: 0 });
  };
  const endAdjust = (apply: boolean) => { docRef.current?.endAdjust(apply); setHsv(null); };

  /* ---------- 粘贴、拖入：成为新图层上的浮动内容 ---------- */
  const pasteImage = useCallback(async (file: Blob, at?: Pt) => {
    const d = docRef.current; if (!d) return;
    try {
      const b = await createImageBitmap(file);
      d.pasteFloating(b, '粘贴的图', at); b.close();
      setModeState('paint'); setPtool('move');
      toast('拖动调整位置和大小，Enter 确定');
    } catch { toast('这个文件不是能打开的图片', { err: true }); }
  }, []);
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const d = docRef.current; if (!d || (e.target as HTMLElement).closest?.('input')) return;
      const file = [...(e.clipboardData?.files ?? [])].find(f => f.type.startsWith('image/'));
      if (file) { e.preventDefault(); pasteImage(file); return; }
      if (clip.current) { e.preventDefault(); d.pasteFloating(clip.current.c, '粘贴的图', clip.current.at); setModeState('paint'); setPtool('move'); }
    };
    window.addEventListener('paste', onPaste);
    return () => window.removeEventListener('paste', onPaste);
  }, [pasteImage]);
  const onDrop = (e: React.DragEvent) => {
    const f = [...e.dataTransfer.files].find(x => x.type.startsWith('image/'));
    if (!f) return;
    e.preventDefault(); e.stopPropagation();
    pasteImage(f, toDoc(e.clientX, e.clientY));
  };

  /* ---------- 扩图 ---------- */
  const changePad = (next: Pad) => {
    const d = docRef.current; if (!d) return;
    const cur = padRef.current, W = orig.w + next.l + next.r, H = orig.h + next.t + next.b;
    if (W * H > MAX_PIXELS) { toast(`扩完是 ${W}×${H}，超过 ${MAX_PIXELS.toLocaleString()} 像素上限`, { err: true }); return; }
    d.resize(W, H, next.l - cur.l, next.t - cur.t, { x: next.l, y: next.t, w: orig.w, h: orig.h });
    padRef.current = next; setPad(next);
    requestAnimationFrame(fit);
  };
  const step = (side: keyof Pad, dd: number) => { const cur = padRef.current; changePad({ ...cur, [side]: Math.max(0, Math.min(1024, cur[side] + dd)) }); };

  /* ---------- 保存 ---------- */
  const dirty = ready && !!doc && (doc.version !== baseVer.current || !!blank);
  const save = async (andRun: boolean) => {
    const d = docRef.current; if (!d || !data) return;
    d.commitFloating();
    if (d.adjusting) { d.endAdjust(true); setHsv(null); }
    setSaving(true);
    try {
      const patch: Record<string, unknown> = { focus: d.focus ?? undefined, ctx: ctxCells };
      if (d.paintDirty || blank) {
        Object.assign(patch, { url: await uploadBlob(await toBlob(d.flatten())), iw: d.W, ih: d.H });
        patch.layers = d.layers.length > 1
          ? await Promise.all(d.layers.map(async l => ({ url: await uploadBlob(await toBlob(l.canvas)), name: l.name, visible: l.visible, opacity: l.opacity })))
          : undefined;
        if (blank) Object.assign(patch, { seed: undefined, prompt: undefined });
      }
      const hasMask = hasPaint(d.mask);
      patch.mask = hasMask ? await uploadBlob(await toBlob(d.mask)) : undefined;
      if (!hasMask && !d.focus) patch.focus = undefined;
      updateData(id, patch as never, true);
      if (patch.url) for (const g of gens.split(',').filter(Boolean)) matchBaseSize(id, g);
      close();
      if (andRun && target) run(target);
      else toast(hasMask ? '已保存。接到生图节点当底图，运行就是局部重绘' : patch.url ? '已保存。接到生图节点当底图就是图生图' : '已保存');
    } catch (e) { toast((e as Error).message, { err: true }); }
    finally { setSaving(false); }
  };
  const cancel = () => {
    if (!dirty || escArmed.current) { close(); return; }
    escArmed.current = true; toast('有没保存的修改，再按一次放弃');
    setTimeout(() => { escArmed.current = false; }, 2500);
  };

  /* ---------- 快捷键 ---------- */
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const d = docRef.current; if (!d) return;
      if ((e.target as HTMLElement).closest?.('input, textarea')) return;
      const k = e.key.toLowerCase(), mod = e.ctrlKey || e.metaKey, L = live.current;
      if (e.key === ' ') { setSpace(true); e.preventDefault(); return; }
      if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) d.redo(); else d.undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); d.redo(); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); save(!!target); return; }
      if (mod && k === 'a' && L.mode === 'paint') { e.preventDefault(); d.selectAll(); return; }
      if (mod && k === 'd') { e.preventDefault(); d.setSelection(null); return; }
      if (mod && k === 'c' && L.mode === 'paint') { e.preventDefault(); copySel(); return; }
      if (mod && k === 't' && L.mode === 'paint') { e.preventDefault(); pickTool('move'); if (!d.floating) d.lift(); return; }
      if (mod) return;
      if (e.key === 'Enter' && d.floating) { d.commitFloating(); return; }
      if (e.key === 'Escape') {
        if (d.floating) { d.cancelFloating(); return; }
        if (d.adjusting) { endAdjust(false); return; }
        if (d.sel) { d.setSelection(null); return; }
        cancel(); return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && L.mode === 'paint' && d.sel) { e.preventDefault(); d.clearSelection(); return; }
      if (k === 'm') { setMode(L.mode === 'mask' ? 'paint' : 'mask'); return; }
      if (k === '0') { fit(); return; }
      const sizeKey = L.mode === 'mask' ? 'maskSize' : 'size';
      if (k === '[') { upd(s => ({ [sizeKey]: Math.max(1, Math.round(s[sizeKey] / 1.25)) })); return; }
      if (k === ']') { upd(s => ({ [sizeKey]: Math.min(512, Math.round(s[sizeKey] * 1.25 + 1)) })); return; }
      if (L.mode === 'mask') { const t = MASK_TOOLS.find(x => x[2].toLowerCase() === k); if (t) setMtool(t[0]); return; }
      const t = PAINT_TOOLS.find(x => x[2].toLowerCase() === k);
      if (t) pickTool(t[0]);
    };
    const up = (e: KeyboardEvent) => { if (e.key === ' ') setSpace(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  });

  const cov = useMemo(() => (ready && doc ? coverage(doc.mask) : 0), [ver, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!data) return null;
  const W = doc?.W ?? orig.w, H = doc?.H ?? orig.h;
  const fr = doc?.focus ? focusRegion(doc.focus, ctxCells, W, H) : null, fs = fr ? focusSize(fr.w, fr.h) : null;
  const padded = !!(pad.l || pad.t || pad.r || pad.b);
  const tools = mode === 'mask' ? MASK_TOOLS : PAINT_TOOLS;
  const tool = mode === 'mask' ? mtool : ptool;
  const runLabel = mode === 'mask' || cov > 0 ? '保存并重绘' : '保存并生成';

  return (
    <div className="editor" role="dialog" aria-label="画布编辑器">
      <div className="ed-top">
        <div className="ed-title"><b>{mode === 'mask' ? '局部重绘' : '绘画'}</b><span>{data.title} · {W}×{H}{padded ? `（原图 ${orig.w}×${orig.h}）` : ''}</span></div>
        <div className="ed-mode"><Seg label="模式" value={mode} options={[{ v: 'paint' as EditorMode, l: '绘画' }, { v: 'mask' as EditorMode, l: '遮罩' }]} onChange={setMode} /></div>
        <div className="ed-tools" role="group" aria-label="工具">
          {tools.map(([t, l, k]) => (
            <button key={t} type="button" aria-pressed={tool === t} title={`${l}（${k}）`} onClick={() => (mode === 'mask' ? setMtool(t as MaskTool) : pickTool(t as PaintTool))}>{l}<kbd>{k}</kbd></button>
          ))}
        </div>
        <div className="ed-acts">
          <button type="button" onClick={() => doc?.undo()} disabled={!doc?.canUndo} title="撤销（Ctrl+Z）">撤销</button>
          <button type="button" onClick={() => doc?.redo()} disabled={!doc?.canRedo} title="重做（Ctrl+Shift+Z）">重做</button>
        </div>
      </div>
      <div className={`ed-stage ${space ? 'is-pan' : ''} is-${mode}-${tool}`} ref={wrap} onDragOver={e => { if (e.dataTransfer.types.includes('Files')) e.preventDefault(); }} onDrop={onDrop}>
        <canvas ref={view} className="ed-view" />
        <canvas ref={over} className="ed-over" onPointerDown={onDown} onPointerMove={onMove} onPointerLeave={() => { ptr.current = null; schedule(false); }} onContextMenu={e => e.preventDefault()} />
        {!ready && <div className="ed-loading">LOADING</div>}
      </div>
      <aside className="ed-side">
        {mode === 'paint' ? (
          <>
            {(ptool === 'brush' || ptool === 'erase' || ptool === 'blur' || ptool === 'clone') && (
              <div className="field">
                <div className="field-label"><span>{ptool === 'erase' ? '橡皮大小' : '笔刷大小'}</span><span className="v">{S.size}px</span></div>
                <Slider label="笔刷大小" min={1} max={500} step={1} value={S.size} onChange={v => upd({ size: v })} />
                {ptool !== 'blur' && <>
                  <div className="field-label"><span>不透明度</span><span className="v">{Math.round(S.alpha * 100)}%</span></div>
                  <Slider label="不透明度" min={0.05} max={1} step={0.05} value={S.alpha} onChange={v => upd({ alpha: v })} />
                </>}
                {(ptool === 'brush' || ptool === 'erase') && <Seg label="笔头" value={S.tip} options={TIPS} onChange={v => upd({ tip: v })} />}
                {ptool === 'blur' && <>
                  <div className="field-label"><span>模糊强度</span><span className="v">{S.intensity}</span></div>
                  <Slider label="模糊强度" min={1} max={100} step={1} value={S.intensity} onChange={v => upd({ intensity: v })} />
                </>}
                <label className="check"><input type="checkbox" checked={S.pressure} onChange={e => upd({ pressure: e.target.checked })} /><span>压感（数位笔按得越重越粗）</span></label>
                {ptool === 'clone' && <span className="note">{cloneSrc ? '已有取样点；按住 Alt 再点一下可以换' : '先按住 Alt 点一下要复制的地方，再到别处涂抹'}</span>}
                <span className="note">[ 和 ] 调大小{ptool === 'brush' ? '；Ctrl+点击取色' : ''}</span>
              </div>
            )}
            {ptool === 'fill' && (
              <div className="field">
                <div className="field-label"><span>容差</span><span className="v">{S.tolerance}</span></div>
                <Slider label="容差" min={0} max={100} step={1} value={S.tolerance} onChange={v => upd({ tolerance: v })} />
                <div className="field-label"><span>不透明度</span><span className="v">{Math.round(S.alpha * 100)}%</span></div>
                <Slider label="不透明度" min={0.05} max={1} step={0.05} value={S.alpha} onChange={v => upd({ alpha: v })} />
                <span className="note">按画面上看到的颜色找区域，填进当前图层；有选区时不会填出选区</span>
              </div>
            )}
            {(ptool === 'select' || ptool === 'lasso' || ptool === 'move') && (
              <div className="field">
                <div className="field-label"><span>{ptool === 'move' ? '变换' : '选区'}</span><span className="v">{doc?.floating ? '变换中' : doc?.sel ? '已选择' : '无'}</span></div>
                {ptool === 'move'
                  ? <span className="note">拖框里移动；拖角缩放（Shift 保持比例、Alt 从中心）；拖上方圆点旋转（Shift 每 15°）。Enter 确定，Esc 取消。没有选区时变换整个图层</span>
                  : <span className="note">{ptool === 'lasso' ? '按住拖动画出范围' : '拖出一个矩形'}；画笔、填充、调色只作用在选区里。Delete 删除选区内容，Ctrl+C / Ctrl+V 复制成新图层</span>}
                <div className="btnrow">
                  {doc?.floating ? <>
                    <button type="button" className="btn is-primary" onClick={() => doc.commitFloating()}>确定</button>
                    <button type="button" className="btn" onClick={() => doc.cancelFloating()}>取消</button>
                  </> : <>
                    <button type="button" className="btn" onClick={() => doc?.selectAll()}>全选</button>
                    <button type="button" className="btn" disabled={!doc?.sel} onClick={() => doc?.setSelection(null)}>取消选区</button>
                    <button type="button" className="btn" disabled={!doc?.sel} onClick={() => doc?.clearSelection()}>删除内容</button>
                    {ptool !== 'move' && <button type="button" className="btn" onClick={() => pickTool('move')}>变换</button>}
                  </>}
                </div>
              </div>
            )}
            {ptool === 'picker' && <div className="field"><span className="note">点一下画面，取那里的颜色，然后回到上一个工具</span></div>}
            {(ptool === 'brush' || ptool === 'fill' || ptool === 'picker') && <ColorPanel color={S.color} recent={S.recent} onChange={c => upd({ color: c })} />}
            <div className="field">
              <div className="field-label"><span>调整颜色</span><span className="v">{doc?.sel ? '选区内' : '整个图层'}</span></div>
              {hsv ? <>
                {([['h', '色相', -180, 180], ['s', '饱和度', -100, 100], ['v', '明度', -100, 100]] as const).map(([k, l, lo, hi]) => (
                  <div key={k} className="hsvrow"><span>{l}</span><Slider label={l} min={lo} max={hi} step={1} value={hsv[k]} onChange={v => setHsv({ ...hsv, [k]: v })} /><b>{hsv[k] > 0 ? `+${hsv[k]}` : hsv[k]}</b></div>
                ))}
                <div className="btnrow">
                  <button type="button" className="btn is-primary" onClick={() => endAdjust(true)}>应用</button>
                  <button type="button" className="btn" onClick={() => endAdjust(false)}>取消</button>
                </div>
              </> : <button type="button" className="btn" onClick={startAdjust}>调整色相 / 饱和度 / 明度</button>}
            </div>
            {doc && <LayersPanel doc={doc} ver={ver} />}
            <label className="check"><input type="checkbox" checked={showMask} onChange={e => setShowMask(e.target.checked)} /><span>在绘画模式下也显示遮罩</span></label>
          </>
        ) : (
          <>
            <div className="field">
              <div className="field-label"><span>笔刷大小</span><span className="v">{S.maskSize}px</span></div>
              <Slider label="遮罩笔刷大小" min={4} max={512} step={1} value={S.maskSize} onChange={v => upd({ maskSize: v })} />
              <label className="check"><input type="checkbox" checked={S.square} onChange={e => upd({ square: e.target.checked })} /><span>方形笔刷</span></label>
              <span className="note">[ 和 ] 调大小；按住 Alt 临时当橡皮</span>
              <div className="btnrow">
                <button type="button" className="btn" onClick={invertMask}>反选</button>
                <button type="button" className="btn" onClick={clearMask}>清空遮罩</button>
              </div>
            </div>
            <div className="field">
              <div className="field-label"><span>聚焦重绘</span><span className="v">{fr && fs ? `${fr.w}×${fr.h} → ${fs[0]}×${fs[1]}` : '未框选'}</span></div>
              <span className="note">用聚焦框框住要细修的地方，只把这一块放大到约 1MP 重画，小细节更清楚；1MP 以内 Opus 免费</span>
              <div className="field-label"><span>最小参照范围</span><span className="v">{ctxCells * 8}px</span></div>
              <Slider label="最小参照范围" min={CONTEXT_RANGE.min} max={CONTEXT_RANGE.max} step={CONTEXT_RANGE.step} value={ctxCells} onChange={setCtx} />
              {doc?.focus && <button type="button" className="linkish" onClick={() => doc.setFocus(null)}>取消聚焦</button>}
            </div>
          </>
        )}
        <div className="field">
          <div className="field-label"><span>扩图</span><span className="v">{W}×{H}</span></div>
          <div className="pads">
            {(['t', 'l', 'r', 'b'] as (keyof Pad)[]).map(k => (
              <div key={k} className={`padk is-${k}`}>
                <span>{{ t: '上', l: '左', r: '右', b: '下' }[k]}</span>
                <button type="button" aria-label="减少" onClick={() => step(k, -64)} disabled={!pad[k]}>−</button>
                <b>{pad[k]}</b>
                <button type="button" aria-label="增加" onClick={() => step(k, 64)}>+</button>
              </div>
            ))}
          </div>
          <span className="note">扩出来的部分会自动加进遮罩；每次 64 像素。扩图会清空撤销记录</span>
          {padded && <button type="button" className="linkish" onClick={() => changePad(NO_PAD)}>不扩了</button>}
        </div>
        <div className="ed-info">遮罩覆盖 {(cov * 100).toFixed(cov < 0.1 ? 1 : 0)}%{doc?.focus ? ' · 聚焦' : ''}{doc && doc.layers.length > 1 ? ` · ${doc.layers.length} 个图层` : ''}</div>
      </aside>
      <div className="ed-foot">
        <span className="note">M 切换模式 · 空格 / 右键 / 中键拖动平移 · Ctrl+滚轮缩放 · 0 适配</span>
        <button type="button" className="btn" onClick={cancel}>取消</button>
        <button type="button" className={`btn ${target ? '' : 'is-primary'}`} disabled={saving || !ready} onClick={() => save(false)}>保存</button>
        {target && <button type="button" className="btn is-primary" disabled={saving || !ready} onClick={() => save(true)}>{runLabel}<kbd>Ctrl+Enter</kbd></button>}
      </div>
    </div>
  );
}
