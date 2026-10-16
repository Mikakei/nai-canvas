// 跨组件使用的画布操作：添加、复制、粘贴、删除、打开面板
import { KINDS, type AppEdge, type AppNode, type Kind } from './graph.ts';
import { freeSpot, glide, settle } from './layout.ts';
import { batch, born, connect, createNode, deleteSelection, flow, newId, setSelection, toast, undo, useStore } from './store.ts';

const get = useStore.getState, set = useStore.setState;

/** 在屏幕坐标处添加节点；from 表示是从某个节点拉线到空白处添加的，要自动接上 */
export function addNodeAt(kind: Kind, sx: number, sy: number, from?: { id: string; dir: 'source' | 'target' }) {
  const rf = flow.rf; if (!rf) return;
  const p = rf.screenToFlowPosition({ x: sx, y: sy }), w = KINDS[kind].w;
  let x = p.x - w / 2, y = p.y - 60;
  if (from?.dir === 'source') { x = p.x + 24; y = p.y - 140; }
  if (from?.dir === 'target') { x = p.x - w - 24; y = p.y - 100; }
  const n = batch(() => {
    const created = createNode(kind, Math.round(x), Math.round(y));
    if (from) from.dir === 'source' ? connect(from.id, created.id, true) : connect(created.id, from.id, true);
    return created;
  });
  setSelection([n.id]);
  settle(n.id);
  setTimeout(() => ensureVisible(n.id), 400);
  setTimeout(() => {
    const ta = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${n.id}"] .cm-content`);
    ta?.focus({ preventScroll: true });
  }, 60);
  return n;
}

/** 生图节点上的"新建提示词"：在它左边新建一个提示词节点接上，光标放进去 */
export function addPromptFor(genId: string) {
  const g = get().nodes.find(n => n.id === genId); if (!g) return;
  const n = batch(() => {
    const created = createNode('prompt', Math.round(g.position.x - KINDS.prompt.w - 80), Math.round(g.position.y));
    connect(created.id, genId, true);
    return created;
  });
  setSelection([n.id]);
  settle(n.id);
  setTimeout(() => ensureVisible(n.id), 400);
  setTimeout(() => document.querySelector<HTMLElement>(`.react-flow__node[data-id="${n.id}"] .cm-content`)?.focus({ preventScroll: true }), 60);
}

export function removeNodes(ids: string[]) {
  setSelection(ids);
  deleteSelection();
}

/** 复制一组节点：组内连线照搬；keepInputs 时，从组外接进来的连线也接到副本上 */
function cloneGroup(ids: string[], keepInputs: boolean, offset: [number, number], select = true): AppNode[] {
  const st = get(), group = st.nodes.filter(n => ids.includes(n.id)), map = new Map<string, string>(), title = titler(st.nodes);
  const made = group.map(n => {
    const id = newId('n'); map.set(n.id, id); born.add(id);
    const data = JSON.parse(JSON.stringify(n.data));
    data.title = title(n.type);
    return { id, type: n.type, position: { x: n.position.x + offset[0], y: n.position.y + offset[1] }, data, selected: select } as AppNode;
  });
  const edges: AppEdge[] = [];
  for (const e of st.edges) {
    const a = map.get(e.source), b = map.get(e.target);
    if (a && b) edges.push({ ...e, id: newId('e'), source: a, target: b, selected: false });
    else if (b && keepInputs) edges.push({ ...e, id: newId('e'), target: b, selected: false });
  }
  edges.forEach(e => born.add(e.id));
  set({ nodes: [...(select ? st.nodes.map(n => n.selected ? { ...n, selected: false } : n) : st.nodes), ...made], edges: [...st.edges, ...edges] });
  return made;
}
/** 副本的标题：每种节点各自往后编号（"提示词 3"、"生图 2"），不会因为一起复制了别的节点而跳号 */
function titler(nodes: AppNode[]) {
  const next = new Map<Kind, number>();
  return (kind: Kind) => {
    if (!next.has(kind)) {
      let m = 0;
      for (const n of nodes) if (n.type === kind) { const k = parseInt(String(n.data.title).split(' ').pop() ?? '', 10); if (k > m) m = k; }
      next.set(kind, m);
    }
    const k = next.get(kind)! + 1;
    next.set(kind, k);
    return `${KINDS[kind].name} ${k}`;
  };
}

/** Ctrl+D / 复制按钮：副本滑到右侧空位，保留接入的连线 */
export function dupNodes(ids: string[]) {
  if (!ids.length) return;
  const made = batch(() => cloneGroup(ids, true, [0, 0]));
  const st = get(), src = st.nodes.filter(n => ids.includes(n.id));
  const w = Math.max(...src.map(n => n.position.x + (n.measured?.width ?? KINDS[n.type].w))) - Math.min(...src.map(n => n.position.x));
  requestAnimationFrame(() => {
    const all = get().nodes, group = all.filter(n => made.some(m => m.id === n.id));
    const [dx, dy] = freeSpot(group, all, w + 48, 0);
    glide(group.map(n => n.id), dx, dy);
  });
  toast(made.length > 1 ? `已复制 ${made.length} 个节点，接入的连线也保留了` : `已复制出「${made[0].data.title}」，接入的连线也保留了`, { action: { label: '撤销', fn: undo } });
}

/** Alt+拖动：在原位复制一份，返回副本 id，让拖动作用在原节点上，副本留在原地 */
export function altCopy(ids: string[]) {
  return cloneGroup(ids, true, [0, 0], false).map(n => n.id);
}

let clip: { nodes: AppNode[]; edges: AppEdge[] } | null = null;
export function copySelection() {
  const st = get(), sel = st.nodes.filter(n => n.selected);
  if (!sel.length) return false;
  const ids = new Set(sel.map(n => n.id));
  clip = JSON.parse(JSON.stringify({ nodes: sel, edges: st.edges.filter(e => ids.has(e.source) && ids.has(e.target)) }));
  toast(`已复制 ${sel.length} 个节点：切到要放的画布，右键空白处选"粘贴"`);
  return true;
}
export function hasClip() { return !!clip?.nodes.length; }
export const clipCount = () => clip?.nodes.length ?? 0;
/** 粘贴到鼠标所在位置（at 为屏幕坐标），压到别的节点就挪到空位 */
export function pasteClip(at?: [number, number]) {
  const rf = flow.rf; if (!clip || !rf) return;
  const bx = Math.min(...clip.nodes.map(n => n.position.x)), by = Math.min(...clip.nodes.map(n => n.position.y));
  const target = at ? rf.screenToFlowPosition({ x: at[0], y: at[1] }) : { x: bx + 48, y: by + 48 };
  const st = get(), map = new Map<string, string>(), title = titler(st.nodes);
  const made = clip.nodes.map(n => {
    const id = newId('n'); map.set(n.id, id); born.add(id);
    const data = { ...JSON.parse(JSON.stringify(n.data)), title: title(n.type) };
    return { id, type: n.type, position: { x: Math.round(n.position.x - bx + target.x - 30), y: Math.round(n.position.y - by + target.y) }, data, selected: true } as AppNode;
  });
  const edges = clip.edges.map(e => ({ ...e, id: newId('e'), source: map.get(e.source)!, target: map.get(e.target)!, selected: false }));
  batch(() => set({ nodes: [...st.nodes.map(n => n.selected ? { ...n, selected: false } : n), ...made], edges: [...st.edges, ...edges] }));
  requestAnimationFrame(() => {
    // 只挪粘贴出来的节点（map 的键是原节点，不能算进来，不然原节点会跟着挪，副本也会压在原节点上）
    const fresh = new Set(map.values()), all = get().nodes, group = all.filter(n => fresh.has(n.id));
    const [dx, dy] = freeSpot(group, all);
    glide(group.map(n => n.id), dx, dy);
  });
  toast(made.length > 1 ? `已粘贴 ${made.length} 个节点` : `已粘贴「${made[0].data.title}」`, { action: { label: '撤销', fn: undo } });
}


/** 平移画布，让某个节点完整出现在视野里（右侧参数面板打开时让出位置） */
export function ensureVisible(id: string) {
  const rf = flow.rf, n = get().nodes.find(m => m.id === id);
  if (!rf || !n) return;
  const el = document.querySelector('.canvas')?.getBoundingClientRect(); if (!el) return;
  const { x: vx, y: vy, zoom } = rf.getViewport();
  const w = n.measured?.width ?? KINDS[n.type].w, h = n.measured?.height ?? 300;
  const left = vx + n.position.x * zoom, top = vy + (n.position.y - 80) * zoom, right = vx + (n.position.x + w + 20) * zoom, bottom = vy + (n.position.y + h) * zoom;
  const maxR = el.width - 48, maxB = el.height - 90;
  let dx = 0, dy = 0;
  if (right > maxR) dx = maxR - right; if (left + dx < 48) dx = 48 - left;
  if (bottom > maxB) dy = maxB - bottom; if (top + dy < 70) dy = 70 - top;
  if (dx || dy) rf.setViewport({ x: vx + dx, y: vy + dy, zoom }, { duration: 380 });
}

/* ---------- 图片 ---------- */
export interface ImageRef { url: string; iw: number; ih: number; seed?: number; prompt?: string }

/** 把一张图复制到系统剪贴板（可以直接粘贴到聊天软件、绘图软件里） */
export async function copyImage(url: string) {
  try {
    let blob = await (await fetch(url)).blob();
    // 浏览器的剪贴板只收 PNG：WebP、JPEG 先转一下
    if (blob.type !== 'image/png') {
      const bmp = await createImageBitmap(blob), c = document.createElement('canvas');
      c.width = bmp.width; c.height = bmp.height;
      c.getContext('2d')!.drawImage(bmp, 0, 0); bmp.close();
      blob = await new Promise<Blob>((ok, no) => c.toBlob(b => (b ? ok(b) : no(new Error('转换失败'))), 'image/png'));
    }
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    toast('已复制图片');
  } catch {
    toast('浏览器拦下了复制图片，可以用"在文件夹中显示"找到原图', { err: true });
  }
}

/** 在屏幕坐标处放一个图片节点（拖出结果图时用） */
export function placeImageAt(img: ImageRef, sx: number, sy: number) {
  const rf = flow.rf; if (!rf) return;
  const p = rf.screenToFlowPosition({ x: sx, y: sy }), w = KINDS.image.w, h = w * img.ih / img.iw;
  const n = createNode('image', Math.round(p.x - w / 2), Math.round(p.y - h / 2), { ...img });
  setSelection([n.id]);
  settle(n.id);
  return n;
}

/** 在某个节点右边放一个图片节点 */
export function placeImageBeside(nodeId: string, img: ImageRef, msg = '已放到画布上，可以接到生图节点当底图，或者接到风格参考、精确参考节点') {
  const src = get().nodes.find(n => n.id === nodeId); if (!src) return;
  const w = src.measured?.width ?? KINDS[src.type].w;
  const n = createNode('image', Math.round(src.position.x + w + 80), Math.round(src.position.y), { ...img });
  setSelection([n.id]);
  settle(n.id);
  setTimeout(() => ensureVisible(n.id), 400);
  toast(msg);
}
