// 图库：输出文件夹里所有的图。同一个界面用在两个地方：画布上的图库节点（可以随意拉大）和全屏图库。
// 左边瀑布流（按原比例排，只渲染看得见的格子），右边大图；窄的时候只有瀑布流，点一张在里面看大图
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MODELS, type ModelKey } from '@nai/shared';
import { api, thumb, type LibEntry, type LibResult } from '../api.ts';
import { copyImage, placeImageAt, type ImageRef } from '../actions.ts';
import { importMetaOf } from '../imageActions.ts';
import { useJobs } from '../jobs.ts';
import { settle } from '../layout.ts';
import { KINDS, type AppNode, type GalleryData } from '../graph.ts';
import { batch, createNode, flow, node, setSelection, toast, useStore } from '../store.ts';
import { startImageDrag } from './DragImage.tsx';
import { Seg } from './controls.tsx';

export interface GalleryFilters { q: string; day: string; model: string; kind: string; fav: boolean; here: boolean; size: 'S' | 'M' | 'L' }
export const DEFAULT_FILTERS: GalleryFilters = { q: '', day: '', model: '', kind: '', fav: false, here: false, size: 'M' };
export const KIND_LABEL: Record<string, string> = { generate: '生成', img2img: '图生图', inpaint: '局部重绘', enhance: '增强', variation: '变体', tool: '图片工具', upscale: '放大', grid: '网格', cover: '封面' };
const modelLabel = (k?: string) => (k && k in MODELS ? MODELS[k as ModelKey].label : '未知模型');
const when = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const refOf = (e: LibEntry): ImageRef => ({ url: e.url, iw: e.w, ih: e.h, seed: e.seed, prompt: e.prompt });
const GAP = 8, PAD = 12, PAGE = 200;
const TARGET = { S: 120, M: 176, L: 260 } as const;
const STAR = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.6l1.9 4 4.4.5-3.3 3 .9 4.3L8 11.2 4.1 13.4l.9-4.3-3.3-3 4.4-.5z" /></svg>;
const ARROW_L = <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2.5 4.5 7 9 11.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const ARROW_R = <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2.5 9.5 7 5 11.5" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** 画布上出现过的图（"本画布"筛选用）：生成历史、图片节点、网格、工具结果 */
export function canvasUrls(nodes: AppNode[]): string[] {
  const out = new Set<string>();
  for (const n of nodes) {
    const d = n.data as Record<string, unknown>;
    if (typeof d.url === 'string' && d.url) out.add(d.url);
    if (Array.isArray(d.history)) for (const h of d.history as { url?: string; raw?: string; urls?: string[] }[]) { if (h.url) out.add(h.url); if (h.raw) out.add(h.raw); h.urls?.forEach(u => out.add(u)); }
    if (Array.isArray(d.cells)) for (const c of d.cells as { url?: string }[]) if (c.url) out.add(c.url);
  }
  return [...out].filter(u => u.startsWith('/outputs/'));
}

/** 图库节点数据里的筛选条件 */
export const filtersOf = (d: GalleryData): GalleryFilters => ({ q: d.q ?? '', day: d.day ?? '', model: d.model ?? '', kind: d.kind ?? '', fav: !!d.fav, here: !!d.here, size: d.size ?? 'M' });

/** 选中的图库节点响应画布上的方向键（快捷键在 shortcuts.ts 里转过来） */
export const galleryNav = new Map<string, { current: ((key: string) => boolean) | null }>();
/** 大图打开时，别的键盘处理先让开 */
let lightboxOpen = 0;

function center(): [number, number] {
  const r = document.querySelector('.canvas')?.getBoundingClientRect();
  return r ? [r.left + r.width / 2, r.top + r.height / 2] : [innerWidth / 2, innerHeight / 2];
}

interface ViewProps {
  filters: GalleryFilters;
  onFilters: (f: GalleryFilters) => void;
  /** 选中的那张图的地址（图库节点从输出口送出去的就是它） */
  pick: string | null;
  onPick: (e: LibEntry | null) => void;
  /** 放到画布时放在这个节点旁边；没有就放在画布中央 */
  near?: string;
  /** 放到画布、导入设置之后（全屏图库这时要关掉，让人看到画布） */
  onLeave?: () => void;
  navRef?: { current: ((key: string) => boolean) | null };
  /** 工具栏右边额外的按钮 */
  tools?: ReactNode;
  className?: string;
  style?: CSSProperties;
  onCount?: (total: number) => void;
}

export function GalleryView({ filters, onFilters, pick, onPick, near, onLeave, navRef, tools, className = '', style, onCount }: ViewProps) {
  const [res, setRes] = useState<LibResult | null>(null);
  const [items, setItems] = useState<LibEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [fresh, setFresh] = useState(0);
  const [multi, setMulti] = useState<Set<string>>(() => new Set());
  const [peek, setPeek] = useState(false);
  const [lb, setLb] = useState(false);
  const [box, setBox] = useState({ w: 0, h: 0, root: 0 });
  const [scroll, setScroll] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null), wrapRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0), anchor = useRef(-1);
  const live = useRef({ filters, items });
  live.current = { filters, items };
  const set = (p: Partial<GalleryFilters>) => onFilters({ ...filters, ...p });
  const narrow = box.root > 0 && box.root < 720;
  const dpr = Math.min(2, devicePixelRatio || 1);

  const load = useCallback(async (more = false) => {
    const my = ++seq.current;
    setLoading(true);
    try {
      const f = live.current.filters;
      const r = await api.libraryQuery({
        q: f.q || undefined, day: f.day || undefined, model: f.model || undefined, kind: f.kind || undefined, fav: f.fav || undefined,
        offset: more ? live.current.items.length : 0, limit: PAGE, urls: f.here ? canvasUrls(useStore.getState().nodes) : undefined,
      });
      if (my !== seq.current) return;
      setRes(r);
      setItems(prev => (more ? [...prev, ...r.items.filter(e => !prev.some(p => p.url === e.url))] : r.items));
      if (!more) setFresh(0);
    } catch (e) { toast((e as Error).message, { err: true }); }
    finally { if (my === seq.current) setLoading(false); }
  }, []);

  // 条件变了重新读（搜索框停顿一下再读）
  const fkey = JSON.stringify([filters.q, filters.day, filters.model, filters.kind, filters.fav, filters.here]);
  useEffect(() => {
    const t = setTimeout(() => { load(false); wrapRef.current?.scrollTo({ top: 0 }); setMulti(new Set()); }, filters.q ? 250 : 0);
    return () => clearTimeout(t);
  }, [fkey, load]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (res) onCount?.(res.total); }, [res, onCount]);

  // 有新图生成：在最前面时直接刷新，翻到后面时提示一下
  const doneAt = useJobs(s => s.jobs.reduce((m, j) => (j.status === 'done' && (j.ended ?? 0) > m ? j.ended! : m), 0));
  const seenDone = useRef(doneAt);
  useEffect(() => {
    if (doneAt === seenDone.current) return;
    seenDone.current = doneAt;
    if ((wrapRef.current?.scrollTop ?? 0) < 60) load(false); else setFresh(n => n + 1);
  }, [doneAt, load]);

  useLayoutEffect(() => {
    const w = wrapRef.current, r = rootRef.current;
    if (!w || !r) return;
    const measure = () => setBox({ w: Math.max(0, w.clientWidth - PAD * 2), h: w.clientHeight, root: r.clientWidth });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(w); ro.observe(r);
    return () => ro.disconnect();
  }, []);

  // 瀑布流：每张图放进当前最短的一列
  const lay = useMemo(() => {
    const W = box.w;
    if (W <= 0) return { pos: [] as { x: number; y: number; w: number; h: number }[], h: 0 };
    const target = TARGET[filters.size];
    const n = Math.max(2, Math.round((W + GAP) / (target + GAP)));
    const cw = (W - GAP * (n - 1)) / n, hs = new Array<number>(n).fill(0);
    const pos = items.map(it => {
      let c = 0;
      for (let j = 1; j < n; j++) if (hs[j] < hs[c] - 0.5) c = j;
      const h = (cw * (it.h || 3)) / (it.w || 2), p = { x: c * (cw + GAP), y: hs[c], w: cw, h };
      hs[c] += h + GAP;
      return p;
    });
    return { pos, h: Math.max(0, Math.max(...hs) - GAP) };
  }, [items, box.w, filters.size]);
  // 只渲染看得见的格子（上下多留一屏）
  const vis = useMemo(() => {
    const top = scroll - PAD - box.h, bottom = scroll + box.h * 2;
    const out: number[] = [];
    lay.pos.forEach((p, i) => { if (p.y + p.h >= top && p.y <= bottom) out.push(i); });
    return out;
  }, [lay, scroll, box.h]);
  const hasMore = !!res && items.length < res.total;
  // 内容不够一屏时接着读
  useEffect(() => { if (!loading && hasMore && lay.h < box.h + 300) load(true); }, [loading, hasMore, lay.h, box.h, load]);
  const scrollRaf = useRef(0);
  const onScroll = () => {
    cancelAnimationFrame(scrollRaf.current);
    scrollRaf.current = requestAnimationFrame(() => {
      const w = wrapRef.current;
      if (!w) return;
      setScroll(w.scrollTop);
      if (!loading && hasMore && w.scrollTop + w.clientHeight > lay.h - 900) load(true);
    });
  };

  const cur = pick ? items.findIndex(e => e.url === pick) : -1;
  const curEntry = cur >= 0 ? items[cur] : null;
  const total = res?.total ?? items.length;
  const reveal = (k: number) => {
    const w = wrapRef.current, p = lay.pos[k];
    if (!w || !p) return;
    if (p.y + PAD < w.scrollTop) w.scrollTo({ top: p.y });
    else if (p.y + p.h + PAD > w.scrollTop + w.clientHeight) w.scrollTo({ top: p.y + p.h + PAD * 2 - w.clientHeight });
  };
  const go = (d: number) => {
    if (!items.length) return;
    const k = cur < 0 ? 0 : Math.min(items.length - 1, Math.max(0, cur + d));
    onPick(items[k]);
    reveal(k);
    if (k >= items.length - 4 && hasMore && !loading) load(true);
  };
  if (navRef) navRef.current = key => {
    if (key === 'ArrowLeft') { go(-1); return true; }
    if (key === 'ArrowRight') { go(1); return true; }
    if (key === 'Enter' && curEntry) { setLb(true); return true; }
    return false;
  };

  const clickTile = (k: number, mod: boolean, shift: boolean) => {
    const e = items[k];
    if (!e) return;
    if (shift && anchor.current >= 0) {
      const a = Math.min(anchor.current, k), b = Math.max(anchor.current, k);
      setMulti(new Set(items.slice(a, b + 1).map(x => x.url)));
      return;
    }
    if (mod) {
      setMulti(m => { const n = new Set(m); if (n.has(e.url)) n.delete(e.url); else n.add(e.url); return n; });
      anchor.current = k;
      return;
    }
    anchor.current = k;
    if (multi.size) setMulti(new Set());
    onPick(e);
    if (narrow) setPeek(true);
  };

  const patch = (urls: Set<string>, p: Partial<LibEntry>) => setItems(list => list.map(e => (urls.has(e.url) ? { ...e, ...p } : e)));
  const setFav = async (list: LibEntry[], fav: boolean) => {
    const urls = new Set(list.map(e => e.url));
    patch(urls, { fav });
    const bad = (await Promise.all(list.map(e => api.libFav(e.url, fav).then(() => null, () => e.url)))).filter(Boolean);
    if (bad.length) { patch(new Set(bad as string[]), { fav: !fav }); toast('有的图没能收藏，可能已经被删了', { err: true }); }
  };
  const trash = async (list: LibEntry[]) => {
    const done: string[] = [];
    for (const e of list) { try { await api.libTrash(e.url); done.push(e.url); } catch (er) { toast((er as Error).message, { err: true }); } }
    if (!done.length) return;
    const gone = new Set(done), rest = items.filter(x => !gone.has(x.url));
    if (pick && gone.has(pick)) onPick(rest[Math.min(Math.max(cur, 0), rest.length - 1)] ?? null);
    setItems(rest);
    setRes(r => (r ? { ...r, total: r.total - done.length, all: r.all - done.length } : r));
    setMulti(new Set());
    toast(done.length > 1 ? `已把 ${done.length} 张移到输出文件夹的 .trash` : '已移到输出文件夹的 .trash', {
      action: { label: '撤销', fn: async () => { for (const u of done) await api.libRestore(u).catch(() => {}); load(false); } },
    });
  };
  /** 放到画布：图库节点旁边排成一行，没有节点时放在画布中央 */
  const place = (list: LibEntry[]) => {
    const rf = flow.rf;
    if (!rf || !list.length) return;
    onLeave?.();
    const src = near ? node(near) : undefined, w = KINDS.image.w;
    let x0: number, y0: number;
    if (src) { x0 = src.position.x + (src.measured?.width ?? Number(src.data.w ?? 600)) + 80; y0 = src.position.y; }
    else { const p = rf.screenToFlowPosition({ x: center()[0], y: center()[1] }); x0 = p.x - (list.length * (w + 40) - 40) / 2; y0 = p.y - 160; }
    const made = batch(() => list.map((e, i) => createNode('image', Math.round(x0 + i * (w + 40)), Math.round(y0), { url: e.url, iw: e.w, ih: e.h, seed: e.seed, prompt: e.prompt })));
    setSelection(made.map(n => n.id));
    made.forEach(n => settle(n.id));
    toast(made.length > 1 ? `已放到画布：${made.length} 张` : '已放到画布，可以接到生图节点当底图，或者接到风格参考、精确参考');
  };
  const importSettings = async (e: LibEntry) => {
    onLeave?.();
    const [x, y] = center();
    const n = placeImageAt(refOf(e), x, y);
    if (n) await importMetaOf(n.id);
  };
  const copySeed = (e: LibEntry) => {
    if (e.seed === undefined) return;
    navigator.clipboard.writeText(String(e.seed)).then(() => toast(`已复制种子 ${e.seed}`), () => toast(`种子是 ${e.seed}`));
  };
  const selected = items.filter(e => multi.has(e.url));

  const days = res?.days ?? [], models = res?.models ?? [], kinds = (res?.kinds ?? []).filter(k => k.k !== 'raw');
  const empty = !loading && res && !items.length;

  const preview = (
    <div className="gpv">
      <div className="gpv-top">
        {narrow && <button type="button" className="tg" onClick={() => setPeek(false)}>‹ 返回</button>}
        <span className="gpv-count">{cur >= 0 ? `${cur + 1} / ${total}` : `— / ${total}`}</span>
        <span className="gpv-hint">{curEntry ? '点图放大看 · ← → 翻页 · 拖到画布或节点上' : ''}</span>
      </div>
      <div className="gpv-stage">
        {curEntry ? <>
          <img key={curEntry.url} className="gpv-img" src={curEntry.url} alt={curEntry.prompt ?? ''} draggable={false}
            onPointerDown={ev => startImageDrag(ev, refOf(curEntry), () => setLb(true))} />
          <button type="button" className="gpv-arrow is-l" aria-label="上一张" disabled={cur <= 0} onClick={() => go(-1)}>{ARROW_L}</button>
          <button type="button" className="gpv-arrow is-r" aria-label="下一张" disabled={cur >= items.length - 1 && !hasMore} onClick={() => go(1)}>{ARROW_R}</button>
        </> : <div className="gpv-empty">{items.length ? '点一张图，在这里看大图' : ''}</div>}
      </div>
      {curEntry && (
        <div className="gpv-info">
          <div className="gpv-meta">
            <span><b>模型</b>{modelLabel(curEntry.model)}</span><span><b>尺寸</b>{curEntry.w}×{curEntry.h}</span>
            {curEntry.seed !== undefined && <span><b>种子</b>{curEntry.seed}</span>}
            <span><b>类型</b>{KIND_LABEL[curEntry.kind] ?? curEntry.kind}</span><span><b>时间</b>{when(curEntry.at)}</span>
          </div>
          {curEntry.prompt && <p className={`gpv-prompt ${showAll ? 'is-all' : ''}`} title={showAll ? '点一下收起' : '点一下看全部'} onClick={() => setShowAll(v => !v)}>{curEntry.prompt}</p>}
          <div className="gpv-acts">
            <button type="button" className="btn sm is-primary" onClick={() => place([curEntry])}>放到画布</button>
            <button type="button" className="btn sm" onClick={() => importSettings(curEntry)}>导入设置</button>
            {curEntry.seed !== undefined && <button type="button" className="btn sm" onClick={() => copySeed(curEntry)}>复制种子</button>}
            <button type="button" className="btn sm" onClick={() => copyImage(curEntry.url)}>复制图片</button>
            <button type="button" className="btn sm" onClick={() => setFav([curEntry], !curEntry.fav)}>{curEntry.fav ? '取消收藏' : '收藏'}</button>
            <button type="button" className="btn sm" onClick={() => api.reveal(curEntry.url).catch(e => toast((e as Error).message, { err: true }))}>在文件夹中显示</button>
            <button type="button" className="btn sm is-danger" onClick={() => trash([curEntry])}>删除</button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div ref={rootRef} className={`gal ${narrow ? 'is-narrow' : ''} ${peek ? 'is-peek' : ''} ${className}`} style={style}>
      <div className="gbar nodrag">
        <input className="input gq" value={filters.q} placeholder="搜提示词或种子…" aria-label="搜索图库" onChange={e => set({ q: e.target.value })} />
        <select className="dd" value={filters.day} aria-label="日期" onChange={e => set({ day: e.target.value })}>
          <option value="">全部日期</option>
          {days.map(d => <option key={d.k} value={d.k}>{d.k}（{d.n}）</option>)}
          {filters.day && !days.some(d => d.k === filters.day) && <option value={filters.day}>{filters.day}</option>}
        </select>
        <select className="dd" value={filters.model} aria-label="模型" onChange={e => set({ model: e.target.value })}>
          <option value="">全部模型</option>
          {models.map(m => <option key={m.k || '_'} value={m.k}>{modelLabel(m.k)}（{m.n}）</option>)}
        </select>
        <select className="dd" value={filters.kind} aria-label="类型" onChange={e => set({ kind: e.target.value })}>
          <option value="">全部类型</option>
          {kinds.map(k => <option key={k.k} value={k.k}>{KIND_LABEL[k.k] ?? k.k}（{k.n}）</option>)}
        </select>
        <button type="button" className="tg" aria-pressed={filters.fav} title="只看收藏" onClick={() => set({ fav: !filters.fav })}>{STAR}收藏</button>
        <button type="button" className="tg" aria-pressed={filters.here} title="只看这张画布上生成过、用过的图" onClick={() => set({ here: !filters.here })}>本画布</button>
        <div className="gsize"><Seg label="缩略图大小" value={filters.size} options={[{ v: 'S', l: '小' }, { v: 'M', l: '中' }, { v: 'L', l: '大' }]} onChange={v => set({ size: v })} /></div>
        {tools}
      </div>
      {multi.size > 0 && (
        <div className="gbatch nodrag">
          <span>已选 {multi.size} 张</span>
          <button type="button" className="btn sm" onClick={() => setFav(selected, true)}>收藏</button>
          <button type="button" className="btn sm" onClick={() => place(selected)}>放到画布</button>
          <button type="button" className="btn sm is-danger" onClick={() => trash(selected)}>删除</button>
          <button type="button" className="btn sm" onClick={() => setMulti(new Set())}>取消选择</button>
          <span className="note">Ctrl 点击加选，Shift 点击连选</span>
        </div>
      )}
      <div className="gbody nodrag nowheel">
        <div className="gwrap" ref={wrapRef} onScroll={onScroll}>
          {fresh > 0 && <button type="button" className="gfresh" onClick={() => { wrapRef.current?.scrollTo({ top: 0 }); load(false); }}>有新生成的图 · 回到最前</button>}
          <div className="ggrid" style={{ height: lay.h }}>
            {vis.map(k => {
              const e = items[k], p = lay.pos[k];
              return (
                <div key={e.url} className={`gt ${e.url === pick ? 'is-sel' : ''} ${multi.has(e.url) ? 'is-multi' : ''}`} style={{ left: p.x, top: p.y, width: p.w, height: p.h }}
                  title={`${e.w}×${e.h}${e.seed !== undefined ? ` · 种子 ${e.seed}` : ''}`}
                  onPointerDown={ev => {
                    if ((ev.target as HTMLElement).closest('.gt-star')) return;
                    const mod = ev.ctrlKey || ev.metaKey, sh = ev.shiftKey;
                    startImageDrag(ev, refOf(e), () => clickTile(k, mod, sh));
                  }}
                  onDoubleClick={() => { onPick(e); setLb(true); }}>
                  <img src={thumb(e.url, Math.ceil(p.w * dpr))} alt="" loading="lazy" draggable={false} />
                  <button type="button" className={`gt-star ${e.fav ? 'is-on' : ''}`} aria-label={e.fav ? '取消收藏' : '收藏'} onClick={() => setFav([e], !e.fav)}>{STAR}</button>
                  {multi.has(e.url) && <i className="gt-check" aria-hidden="true" />}
                </div>
              );
            })}
          </div>
          {empty && <p className="gnote">{res!.all ? '没有符合条件的图' : '还没有生成过图。生成的图都会存进输出文件夹，在这里按日期、模型、提示词找。'}</p>}
          {loading && <p className="gnote">读取中…</p>}
        </div>
        {(!narrow || peek) && preview}
      </div>
      {lb && curEntry && <Lightbox items={items} index={cur} total={total} onIndex={k => { onPick(items[k]); reveal(k); if (k >= items.length - 2 && hasMore) load(true); }} onClose={() => setLb(false)} />}
    </div>
  );
}

/** 放大看：滚轮缩放（以鼠标为中心）、拖动平移、双击在适配和 100% 之间切换、← → 翻页、Esc 关闭 */
function Lightbox({ items, index, total, onIndex, onClose }: { items: LibEntry[]; index: number; total: number; onIndex: (k: number) => void; onClose: () => void }) {
  const e = items[index];
  const fitScale = () => Math.min((innerWidth * 0.92) / e.w, (innerHeight * 0.84) / e.h, 1.5);
  const [v, setV] = useState(() => ({ s: fitScale(), x: 0, y: 0 }));
  const live = useRef({ index, onIndex, onClose });
  live.current = { index, onIndex, onClose };
  useEffect(() => { setV({ s: fitScale(), x: 0, y: 0 }); }, [e.url]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    lightboxOpen++;
    const key = (ev: KeyboardEvent) => {
      const L = live.current;
      if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); L.onClose(); }
      else if (ev.key === 'ArrowLeft' && L.index > 0) { ev.preventDefault(); ev.stopPropagation(); L.onIndex(L.index - 1); }
      else if (ev.key === 'ArrowRight' && L.index < items.length - 1) { ev.preventDefault(); ev.stopPropagation(); L.onIndex(L.index + 1); }
    };
    window.addEventListener('keydown', key, true);
    return () => { lightboxOpen--; window.removeEventListener('keydown', key, true); };
  }, [items.length]);
  const onWheel = (ev: React.WheelEvent) => {
    const cx = ev.clientX - innerWidth / 2, cy = ev.clientY - innerHeight / 2;
    setV(o => {
      const s = Math.min(8, Math.max(fitScale() * 0.5, o.s * Math.exp(-ev.deltaY * 0.0015))), k = s / o.s;
      return { s, x: cx - (cx - o.x) * k, y: cy - (cy - o.y) * k };
    });
  };
  const onDown = (ev: React.PointerEvent) => {
    if (ev.button !== 0) return;
    ev.preventDefault();
    const sx = ev.clientX, sy = ev.clientY, o = v;
    let moved = false;
    const move = (m: PointerEvent) => { if (Math.hypot(m.clientX - sx, m.clientY - sy) > 3) moved = true; setV({ ...o, x: o.x + m.clientX - sx, y: o.y + m.clientY - sy }); };
    const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); if (!moved && ev.target === ev.currentTarget) onClose(); };
    addEventListener('pointermove', move); addEventListener('pointerup', up);
  };
  const onDbl = (ev: React.MouseEvent) => {
    const f = fitScale();
    if (Math.abs(v.s - f) > 0.01) { setV({ s: f, x: 0, y: 0 }); return; }
    const cx = ev.clientX - innerWidth / 2, cy = ev.clientY - innerHeight / 2, k = 1 / v.s;
    setV({ s: 1, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k });
  };
  return createPortal(
    <div className="glb" role="dialog" aria-label="大图" onWheel={onWheel} onPointerDown={onDown}>
      <img className="glb-img" src={e.url} alt={e.prompt ?? ''} draggable={false} onDoubleClick={onDbl}
        style={{ width: e.w, height: e.h, transform: `translate(-50%, -50%) translate(${v.x}px, ${v.y}px) scale(${v.s})` }} />
      <div className="glb-top" onPointerDown={ev => ev.stopPropagation()}>
        <span className="gpv-count">{index + 1} / {total}</span>
        <span className="glb-zoom">{Math.round(v.s * 100)}%</span>
        <span className="note">滚轮缩放 · 拖动平移 · 双击切换 100% · Esc 关闭</span>
        <button type="button" className="x-btn" aria-label="关闭大图" onClick={onClose}>×</button>
      </div>
      {index > 0 && <button type="button" className="gpv-arrow is-l glb-arrow" aria-label="上一张" onPointerDown={ev => ev.stopPropagation()} onClick={() => onIndex(index - 1)}>{ARROW_L}</button>}
      {index < items.length - 1 && <button type="button" className="gpv-arrow is-r glb-arrow" aria-label="下一张" onPointerDown={ev => ev.stopPropagation()} onClick={() => onIndex(index + 1)}>{ARROW_R}</button>}
    </div>,
    document.body,
  );
}

/* ---------- 全屏图库（底栏"图库"按钮） ---------- */
function loadFull(): GalleryFilters {
  try { return { ...DEFAULT_FILTERS, ...JSON.parse(localStorage.getItem('nai-gallery') ?? '{}'), q: '' }; } catch { return DEFAULT_FILTERS; }
}
export function GalleryOverlay() {
  const open = useStore(s => s.gallery);
  const [filters, setFilters] = useState<GalleryFilters>(loadFull);
  const [pick, setPick] = useState<LibEntry | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const nav = useRef<((key: string) => boolean) | null>(null);
  const close = useCallback(() => useStore.setState({ gallery: false }), []);
  const setF = (f: GalleryFilters) => { setFilters(f); try { localStorage.setItem('nai-gallery', JSON.stringify({ ...f, q: '' })); } catch { /* 存不了就算了 */ } };
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      if (lightboxOpen) return;
      const typing = (e.target as HTMLElement).closest?.('input, textarea, select');
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (typing) (e.target as HTMLElement).blur(); else close(); return; }
      if (typing) return;
      if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter') && nav.current?.(e.key)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [open, close]);
  if (!open) return null;
  /** 钉到画布：在画布中央放一个图库节点，带上现在的筛选和选中的图 */
  const pin = () => {
    const rf = flow.rf;
    if (!rf) return;
    const p = rf.screenToFlowPosition({ x: center()[0], y: center()[1] }), w = 980, h = 640;
    const n = createNode('gallery', Math.round(p.x - w / 2), Math.round(p.y - h / 2), {
      w, h, q: filters.q, day: filters.day, model: filters.model, kind: filters.kind, fav: filters.fav, here: filters.here, size: filters.size,
      pick: pick ? { url: pick.url, iw: pick.w, ih: pick.h, seed: pick.seed, prompt: pick.prompt } : undefined,
    });
    close();
    setSelection([n.id]);
    settle(n.id);
    toast('已放到画布：拖右下角改大小，选中的图可以从右边的 + 口接给别的节点');
  };
  // 不放到 body 下面：提示条（删除的撤销按钮）要盖在全屏图库上面
  return (
    <div className="gfull" role="dialog" aria-label="图库">
      <div className="gfull-veil" onPointerDown={close} />
      <div className="gfull-panel">
        <div className="gfull-head">
          <b>图库</b><span className="lab">{count ?? ''}</span>
          <button type="button" className="btn sm" onClick={pin} title="变成画布上的图库节点，可以随意摆放和拉大">钉到画布</button>
          <button type="button" className="x-btn" aria-label="关闭图库" onClick={close}>×</button>
        </div>
        <GalleryView filters={filters} onFilters={setF} pick={pick?.url ?? null} onPick={setPick} onLeave={close} navRef={nav} onCount={setCount} />
      </div>
    </div>
  );
}
