// 布局规则：节点永不重叠、拖动时对齐吸附、被挪动时平滑滑过去
import { KINDS, type AppNode } from './graph.ts';
import { useStore } from './store.ts';
import { calm } from './prefs.ts';

export const GAP = 28;
/** 整体调整布局（比如改文字大小）的这段时间里，单个节点变高不各自推邻居，交给 resolveOverlaps 统一处理 */
export const layoutHold = { until: 0 };
/** 卡片上方的标题行高度，算碰撞时要算进去 */
export const HEAD = 34;
interface Box { x: number; y: number; w: number; h: number }

const sizeOf = (n: AppNode) => ({ w: n.measured?.width ?? (n.data.w as number | undefined) ?? KINDS[n.type].w, h: n.measured?.height ?? 200 });
export const boxOf = (n: AppNode): Box => { const s = sizeOf(n); return { x: n.position.x, y: n.position.y - HEAD, w: s.w, h: s.h + HEAD }; };
const cardOf = (n: AppNode): Box => { const s = sizeOf(n); return { x: n.position.x, y: n.position.y, w: s.w, h: s.h }; };
/** 分区是垫在下面的框，不算障碍，也不吸附 */
export const solid = (ns: AppNode[]) => ns.filter(n => n.type !== 'section');
const hits = (a: Box, b: Box) => a.x < b.x + b.w + GAP && a.x + a.w + GAP > b.x && a.y < b.y + b.h + GAP && a.y + a.h + GAP > b.y;

/** 找离 (dx0, dy0) 最近、整组都不和其他节点重叠的偏移 */
export function freeSpot(group: AppNode[], all: AppNode[], dx0 = 0, dy0 = 0): [number, number] {
  const ids = new Set(group.map(n => n.id));
  const others = solid(all).filter(o => !ids.has(o.id)).map(boxOf), bs = solid(group).map(boxOf);
  const ok = (dx: number, dy: number) => bs.every(b => others.every(o => !hits({ ...b, x: b.x + dx, y: b.y + dy }, o)));
  if (ok(dx0, dy0)) return [dx0, dy0];
  const S = 16;
  for (let k = 1; k < 150; k++) {
    let best: [number, number] | null = null, bd = Infinity;
    for (let i = -k; i <= k; i++) for (const [a, b] of [[i, -k], [i, k], [-k, i], [k, i]]) {
      const d = Math.hypot(a, b);
      if (d < bd && ok(dx0 + a * S, dy0 + b * S)) { bd = d; best = [dx0 + a * S, dy0 + b * S]; }
    }
    if (best) return best;
  }
  return [dx0, dy0];
}

/** 对齐吸附：整组的左/中/右、上/中/下边贴近其他节点时吸过去，返回偏移和要画的对齐线 */
export function snap(group: AppNode[], all: AppNode[], zoom: number): [number, number, [number, number, number, number][]] {
  const T = 7 / zoom, ids = new Set(group.map(n => n.id)), bs = group.map(cardOf);
  const B = { x: Math.min(...bs.map(b => b.x)), y: Math.min(...bs.map(b => b.y)), r: Math.max(...bs.map(b => b.x + b.w)), b: Math.max(...bs.map(b => b.y + b.h)) };
  const xs = [B.x, (B.x + B.r) / 2, B.r], ys = [B.y, (B.y + B.b) / 2, B.b];
  type Hit = { d: number; v: number; c: Box };
  let bx: Hit | null = null, by: Hit | null = null;
  for (const o of solid(all)) {
    if (ids.has(o.id)) continue;
    const c = cardOf(o);
    for (const a of xs) for (const v of [c.x, c.x + c.w / 2, c.x + c.w]) { const d = v - a; if (Math.abs(d) <= T && (!bx || Math.abs(d) < Math.abs(bx.d))) bx = { d, v, c }; }
    for (const a of ys) for (const v of [c.y, c.y + c.h / 2, c.y + c.h]) { const d = v - a; if (Math.abs(d) <= T && (!by || Math.abs(d) < Math.abs(by.d))) by = { d, v, c }; }
  }
  const sx = bx?.d ?? 0, sy = by?.d ?? 0, lines: [number, number, number, number][] = [];
  if (bx) lines.push([bx.v, Math.min(B.y + sy, bx.c.y) - 14, bx.v, Math.max(B.b + sy, bx.c.y + bx.c.h) + 14]);
  if (by) lines.push([Math.min(B.x + sx, by.c.x) - 14, by.v, Math.max(B.r + sx, by.c.x + by.c.w) + 14, by.v]);
  return [sx, sy, lines];
}

export const ghostsFor = (group: AppNode[], dx: number, dy: number) => dx || dy ? group.map(n => { const c = cardOf(n); return { x: c.x + dx, y: c.y + dy, w: c.w, h: c.h }; }) : [];

const reduced = () => calm();

/** 让一组节点平滑移动 (dx, dy)。用逐帧更新位置而不是 CSS 过渡，这样连线能一起跟着动 */
export function glide(ids: string[], dx: number, dy: number, done?: () => void) {
  if (!dx && !dy) { done?.(); return; }
  const set = useStore.setState, get = useStore.getState;
  const start = new Map(get().nodes.filter(n => ids.includes(n.id)).map(n => [n.id, { ...n.position }]));
  const t0 = performance.now(), dur = reduced() ? 0 : 340;
  const step = (t: number) => {
    const k = dur ? Math.min(1, (t - t0) / dur) : 1, e = 1 - Math.pow(1 - k, 3);
    set({ nodes: get().nodes.map(n => { const s = start.get(n.id); return s ? { ...n, position: { x: Math.round(s.x + dx * e), y: Math.round(s.y + dy * e) } } : n; }) });
    if (k < 1) requestAnimationFrame(step); else done?.();
  };
  requestAnimationFrame(step);
}

/** 新节点落地后如果压到别人，就滑到最近的空位 */
export function settle(id: string) {
  requestAnimationFrame(() => requestAnimationFrame(() => {
    const all = useStore.getState().nodes, n = all.find(m => m.id === id);
    if (!n || n.type === 'section') return;
    const [dx, dy] = freeSpot([n], all);
    glide([id], dx, dy);
  }));
}

/**
 * 节点整体变大（比如调大了文字）后互相压住了：从上往下，把被压住的节点往下挪开，
 * 尽量保持原来的排列（同一列的还在同一列）
 */
export function resolveOverlaps() {
  const ns = solid(useStore.getState().nodes);
  const box = new Map(ns.map(n => [n.id, boxOf(n)]));
  const order = [...ns].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x);
  const moved = new Map<string, number>();
  for (let i = 0; i < order.length; i++) {
    const a = box.get(order[i].id)!;
    for (let j = i + 1; j < order.length; j++) {
      const id = order[j].id, b = box.get(id)!;
      if (b.y < a.y || !hits(a, b)) continue;
      const dy = a.y + a.h + GAP - b.y;
      b.y += dy;
      moved.set(id, (moved.get(id) ?? 0) + dy);
    }
  }
  for (const [id, dy] of moved) glide([id], 0, Math.round(dy));
  return moved.size;
}

/** 某个节点变大后，把被它压到的邻居推开 */
export function pushAway(id: string) {
  const all = useStore.getState().nodes, n = all.find(m => m.id === id);
  if (!n || n.type === 'section') return;
  for (const o of solid(all)) {
    if (o.id === id || !hits(boxOf(n), boxOf(o))) continue;
    const [dx, dy] = freeSpot([o], useStore.getState().nodes);
    glide([o.id], dx, dy);
  }
}
