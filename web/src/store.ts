import { create } from 'zustand';
import { applyNodeChanges, type NodeChange, type ReactFlowInstance, type Viewport } from '@xyflow/react';
import { REF_DEFAULTS, VIBE_DEFAULTS, apiModel, defaultParams, type Account } from '@nai/shared';
import { api, type ProjectMeta, type ServerConfig } from './api.ts';
import { widthScale } from './prefs.ts';
import { KINDS, isGen, nextTitle, reaches, slotFor, type AppEdge, type AppNode, type ArtistData, type CharData, type CharDictData, type GalleryData, type GenData, type ImageData, type Kind, type PromptData, type RefData, type ToolData, type VibeData } from './graph.ts';
import type { ArtistEntry, CharEntry, PromptEntry } from './presets.ts';

export interface Runtime {
  status: 'idle' | 'queued' | 'running' | 'error';
  step?: number; steps?: number; sample?: number; n?: number;
  preview?: string; error?: string; startedAt?: number; flash?: number;
  /** 生成前的准备阶段（处理图片、编码风格参考）显示的文字 */
  label?: string;
}
export interface MenuState {
  x: number; y: number;
  /** 新节点放在哪（屏幕坐标），默认就是菜单位置 */
  at?: [number, number];
  above?: boolean;
  kind: 'add' | 'node';
  /** 从某个节点拉线到空白处时打开 */
  from?: { id: string; dir: 'source' | 'target' };
  nodeId?: string;
}
export type Modal =
  | { kind: 'enhance'; id: string }
  | { kind: 'import'; nodeId: string; meta: import('@nai/shared').ImportedMeta }
  | { kind: 'editor'; id: string; run?: string; mode?: 'paint' | 'mask'; blank?: [number, number] };
export interface Chunk { id: string; name: string; text: string; color: string; folder: string }
export interface Toast { id: number; text: string; err?: boolean; action?: { label: string; fn: () => void } }

interface State {
  nodes: AppNode[];
  edges: AppEdge[];
  runtime: Record<string, Runtime>;
  account: Account | null;
  accountError: string | null;
  config: ServerConfig | null;
  loaded: boolean;
  saved: 'saved' | 'saving' | 'fail';
  undo: string[]; redo: string[];
  wheel: 'pan' | 'zoom';
  menu: MenuState | null;
  dialog: 'settings' | 'keys' | null;
  /** 增强、导入生成信息这类带参数的弹窗 */
  modal: Modal | null;
  toast: Toast | null;
  hl: string | null;
  guides: [number, number, number, number][];
  ghosts: { x: number; y: number; w: number; h: number }[];
  wiring: { id: string; dir: 'source' | 'target' } | null;
  target: string | null;
  busy: boolean;
  /** 正在从结果里拖出的图 */
  dragImg: { url: string; iw: number; ih: number; seed?: number; prompt?: string; x: number; y: number } | null;
  project: { id: string; name: string } | null;
  projects: ProjectMeta[];
  chunks: Chunk[];
  panel: 'chunks' | 'queue' | null;
  /** 全屏图库开着 */
  gallery: boolean;
  /** 画师串库、角色字典（全局，所有画布共用） */
  artists: ArtistEntry[];
  characters: CharEntry[];
  /** 提示词词典 */
  prompts: PromptEntry[];
  /** 正在从角色字典里拖出的角色 */
  dragChar: { name: string; cover?: string; x: number; y: number } | null;
  /** 画布搜索框（Ctrl+F） */
  search: boolean;
}

export const useStore = create<State>(() => ({
  nodes: [], edges: [], runtime: {}, account: null, accountError: null, config: null, loaded: false, saved: 'saved',
  undo: [], redo: [], wheel: 'pan', menu: null, dialog: null, modal: null, toast: null,
  hl: null, guides: [], ghosts: [], wiring: null, target: null, busy: false, dragImg: null, project: null, projects: [], chunks: [], panel: null, search: false,
  gallery: false, artists: [], characters: [], prompts: [], dragChar: null,
}));
const get = useStore.getState, set = useStore.setState;

/** React Flow 实例，由画布组件挂上，供工具坞、快捷键等使用 */
export const flow: { rf: ReactFlowInstance<AppNode, AppEdge> | null } = { rf: null };
let seq = 0;
export const newId = (p: string) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;
/** 刚创建的节点和连线，用来播放入场动画 */
export const born = new Set<string>();

export const node = (id: string) => get().nodes.find(n => n.id === id);
export const selected = () => get().nodes.filter(n => n.selected);

/* ---------- 提示条 ---------- */
let toastTimer = 0;
export function toast(text: string, opt: { err?: boolean; action?: Toast['action'] } = {}) {
  set({ toast: { id: Date.now(), text, ...opt } });
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => set({ toast: null }), opt.err ? 4500 : opt.action ? 4500 : 2600);
}

/* ---------- 撤销重做：只记录画布结构和参数，生成历史不参与撤销 ---------- */
let suppress = 0;
const snap = () => JSON.stringify({ nodes: get().nodes.map(({ id, type, position, data }) => ({ id, type, position, data: { ...data, history: undefined, cells: undefined } })), edges: get().edges.map(({ id, source, target, data }) => ({ id, source, target, data })) });
export function pushUndo() {
  if (suppress) return;
  const u = [...get().undo, snap()];
  if (u.length > 100) u.shift();
  set({ undo: u, redo: [] });
}
/** 把一串改动合成一次撤销 */
export function batch<T>(fn: () => T): T { pushUndo(); suppress++; try { return fn(); } finally { suppress--; } }
/** 删掉的节点的生成历史、网格结果（这些不在撤销快照里），撤销删除时从这里找回 */
const graveyard = new Map<string, { history?: unknown[]; cur?: number; cells?: unknown[]; xs?: string[]; ys?: string[]; seed?: number }>();
function bury(n: AppNode) {
  if (n.type === 'generate' || n.type === 'tool') graveyard.set(n.id, { history: n.data.history, cur: n.data.cur });
  else if (n.type === 'grid') graveyard.set(n.id, { cells: n.data.cells, xs: n.data.xs, ys: n.data.ys, seed: n.data.seed });
  else return;
  // 只留最近删掉的一批
  if (graveyard.size > 300) graveyard.delete(graveyard.keys().next().value!);
}
function restore(s: string) {
  const o = JSON.parse(s) as { nodes: AppNode[]; edges: AppEdge[] };
  const cur = new Map(get().nodes.map(n => [n.id, n]));
  // 撤销掉"新建节点"时节点会消失，先把它的历史收起来，重做时还能找回
  const back = new Set(o.nodes.map(n => n.id));
  for (const n of get().nodes) if (!back.has(n.id)) bury(n);
  const nodes = o.nodes.map(n => {
    const c = cur.get(n.id);
    // 节点还在就用它现在的历史；已经删掉的（撤销删除）从 graveyard 找回
    const kept = (c && c.type === n.type ? c.data : !c ? graveyard.get(n.id) : null) as { history?: unknown[]; cur?: number; cells?: unknown[]; xs?: string[]; ys?: string[]; seed?: number } | null | undefined;
    const data = { ...n.data } as Record<string, unknown>;
    if (n.type === 'grid') Object.assign(data, { cells: kept?.cells ?? [], xs: kept?.xs ?? [], ys: kept?.ys ?? [], seed: kept?.seed });
    if (n.type === 'generate' || n.type === 'tool') { data.history = kept?.history ?? []; data.cur = kept?.cur ?? 0; }
    else delete data.history;
    return { ...n, data, selected: false } as AppNode;
  });
  set({ nodes, edges: o.edges.map(e => ({ ...e, type: 'dot' })) });
}
export function undo() {
  const u = [...get().undo]; const s = u.pop();
  if (!s) { toast('没有可以撤销的操作'); return; }
  set({ undo: u, redo: [...get().redo, snap()] }); restore(s); toast('已撤销');
}
export function redo() {
  const r = [...get().redo]; const s = r.pop();
  if (!s) { toast('没有可以重做的操作'); return; }
  set({ redo: r, undo: [...get().undo, snap()] }); restore(s); toast('已重做');
}

/* ---------- 节点 ---------- */
export function updateData<T extends AppNode>(id: string, patch: Partial<T['data']>, undoable = false) {
  if (undoable) pushUndo();
  set({ nodes: get().nodes.map(n => n.id === id ? { ...n, data: { ...n.data, ...patch } } as AppNode : n) });
}

/** 文字框失焦时调用：先把内容改回编辑前，记一次撤销快照，再改成现在的内容 */
export function recordEdit(id: string, field: string, before: unknown) {
  const n = node(id); if (!n) return;
  const now = (n.data as Record<string, unknown>)[field];
  if (now === before) return;
  updateData(id, { [field]: before } as never); pushUndo(); updateData(id, { [field]: now } as never);
}

/** 标签补全用的模型：生图节点用自己的；提示词、角色节点用它接到的第一个生图节点的 */
export function modelFor(id: string): string {
  const st = get(), n = st.nodes.find(m => m.id === id);
  const g = isGen(n) ? n : st.nodes.find(m => isGen(m) && st.edges.some(e => e.source === id && e.target === m.id));
  return isGen(g) ? apiModel(g.data.params.model, g.data.params.effort) : 'nai-diffusion-4-5-full';
}

/** 新建节点时可以带的初始数据（各种节点的字段合在一起；history 的类型因节点而异） */
type NodeInit = Partial<PromptData & ImageData & CharData & VibeData & RefData & Omit<GenData, 'history'> & Omit<ToolData, 'history'> & Omit<ArtistData, 'mode'> & Omit<GalleryData, 'kind' | 'size'> & CharDictData>
  & { history?: unknown[]; h?: number; kind?: string; size?: 'S' | 'M' | 'L'; mode?: 'v' | 't' };
export function createNode(kind: Kind, x: number, y: number, data?: NodeInit): AppNode {
  const id = newId('n'), title = nextTitle(get().nodes, kind);
  const base = kind === 'prompt' || kind === 'negative' ? { title, text: '' }
    : kind === 'image' ? { title, url: '', iw: 1, ih: 1 }
    : kind === 'character' ? { title, text: '', uc: '', enabled: true, x: 0.5, y: 0.5 }
    : kind === 'vibe' ? { title, url: '', iw: 1, ih: 1, strength: VIBE_DEFAULTS.strength, ie: VIBE_DEFAULTS.ie, enabled: true }
    : kind === 'section' ? { title, w: 640, h: 420 }
    : kind === 'note' ? { title, text: '', tone: 'yellow' }
    : kind === 'grid' ? { title, x: { param: 'scale', values: '3, 5, 7' }, y: { param: 'none', values: '' }, cells: [], xs: [], ys: [] }
    : kind === 'tool' ? { title, tool: 'lineart', prompt: '', defry: 0, emotion: 'happy', keepBubbles: false, snapPalette: 'auto', snapColors: 16, snapAvoid: false, snapUpscale: true, history: [], cur: 0 }
    : kind === 'reference' ? { title, url: '', iw: 1, ih: 1, type: REF_DEFAULTS.type, strength: REF_DEFAULTS.strength, fidelity: REF_DEFAULTS.fidelity, enabled: true }
    : kind === 'artist' ? { title, name: '', text: '', k: 1, enabled: true }
    : kind === 'gallery' ? { title, w: 980, h: 640, size: 'M' }
    : kind === 'chardict' ? { title, w: 760, h: 560 }
    : { title, params: defaultParams(), history: [], cur: 0 };
  // 调大了文字时，新节点默认宽一些（已有节点不动）
  const ws = widthScale();
  const width = 'w' in base || data?.w !== undefined || ws === 1 ? {} : { w: Math.round(KINDS[kind].w * ws) };
  const n = { id, type: kind, position: { x, y }, data: { ...base, ...width, ...data, title: data?.title ?? title } } as AppNode;
  born.add(id);
  pushUndo();
  set({ nodes: [...get().nodes, n] });
  return n;
}

export function setSelection(ids: string[]) {
  const s = new Set(ids);
  set({ nodes: get().nodes.map(n => (n.selected ?? false) === s.has(n.id) ? n : { ...n, selected: s.has(n.id) }) });
}

export function onNodesChange(changes: NodeChange<AppNode>[]) {
  set({ nodes: applyNodeChanges(changes.filter(c => c.type !== 'remove'), get().nodes) });
}

export function deleteSelection() {
  const ids = new Set(selected().map(n => n.id));
  const st = get();
  const edgeSel = st.edges.filter(e => e.selected);
  if (!ids.size && !edgeSel.length) return;
  pushUndo();
  if (!ids.size) {
    set({ edges: st.edges.filter(e => !e.selected) });
    toast('已删除连线', { action: { label: '撤销', fn: undo } });
    return;
  }
  for (const id of ids) cancelHook(id);
  const gone = st.nodes.filter(n => ids.has(n.id));
  gone.forEach(bury);
  const names = gone.map(n => n.data.title);
  set({ nodes: st.nodes.filter(n => !ids.has(n.id)), edges: st.edges.filter(e => !ids.has(e.source) && !ids.has(e.target)) });
  toast(names.length > 1 ? `已删除 ${names.length} 个节点` : `已删除「${names[0]}」`, { action: { label: '撤销', fn: undo } });
}
/** run.ts 注入：删除节点时取消它正在进行的生成 */
export let cancelHook: (id: string) => void = () => {};
export function setCancelHook(fn: (id: string) => void) { cancelHook = fn; }

/* ---------- 连线 ---------- */
export function connect(a: string, b: string, quiet = false): boolean {
  if (a === b) return false;
  const st = get(), A = node(a), B = node(b);
  if (!A || !B) return false;
  const slot = slotFor(A, B);
  if (!slot) { if (!quiet) toast(`「${B.data.title}」不接受「${A.data.title}」的输出`, { err: true }); return false; }
  if (reaches(st.edges, b, a)) { toast('这样连会形成循环，已取消', { err: true }); return false; }
  if (st.edges.some(e => e.source === a && e.target === b)) return false;
  pushUndo();
  const keep = KINDS[B.type].multi?.[slot] ? st.edges : st.edges.filter(e => !(e.target === b && e.data?.slot === slot));
  const id = newId('e');
  born.add(id);
  set({ edges: [...keep, { id, source: a, target: b, sourceHandle: 'out', targetHandle: 'in', type: 'dot', data: { slot } }] });
  connectHook(a, b);
  return true;
}
/** inputs.ts 注入：接上参考图后自动换模型、登记风格参考 */
let connectHook: (a: string, b: string) => void = () => {};
export function setConnectHook(fn: (a: string, b: string) => void) { connectHook = fn; }
export function disconnect(edgeId: string) {
  pushUndo();
  set({ edges: get().edges.filter(e => e.id !== edgeId), hl: null });
}

/* ---------- 账户、设置 ---------- */
export async function refreshAccount() {
  try { set({ account: await api.account(), accountError: null }); }
  catch (e) { set({ account: null, accountError: (e as Error).message }); }
}
export async function refreshConfig() {
  const config = await api.config();
  set({ config });
  return config;
}

/* ---------- 自动保存 ---------- */
let saveTimer = 0, dirty = false, inflight: Promise<unknown> = Promise.resolve();
function projectData() {
  const { nodes, edges } = get();
  const viewport: Viewport | undefined = flow.rf?.getViewport();
  return { version: 1, nodes: nodes.map(({ id, type, position, data }) => ({ id, type, position, data })), edges: edges.map(({ id, source, target, data }) => ({ id, source, target, data })), viewport };
}
export function scheduleSave() {
  if (!get().loaded || !get().project) return;
  dirty = true;
  set({ saved: 'saving' });
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    const id = get().project?.id; if (!id) return;
    dirty = false;
    // 内容在这一刻取好；一次只发一个保存请求，免得旧的内容比新的晚写进去
    const data = projectData();
    inflight = inflight.then(() => api.saveProject(id, data)).then(
      () => { if (!dirty && get().project?.id === id) set({ saved: 'saved' }); },
      () => {
        if (get().project?.id !== id) return;
        // 保存失败（比如服务暂时没响应）：过几秒再试，不用等下一次改动
        dirty = true; set({ saved: 'fail' });
        setTimeout(() => { if (get().project?.id === id && get().saved === 'fail') scheduleSave(); }, 3000);
      });
  }, 700);
}
/** 立刻保存。keepalive=true 用在页面切走或关闭时：马上发，请求在页面关掉后也能发完；
 *  false 用在切换画布之前：排在正在进行的保存后面 */
export async function flushSave(keepalive = true) {
  const id = get().project?.id;
  if (!dirty || !id) return;
  clearTimeout(saveTimer); dirty = false;
  // keepalive 的请求正文不能超过 64KB（浏览器限制），大的画布只能普通地发
  const body = JSON.stringify(projectData());
  const send = () => fetch(`/api/projects/${id}`, { method: 'PUT', keepalive: keepalive && body.length < 60000, headers: { 'x-nai-canvas': '1', 'Content-Type': 'application/json' }, body })
    .then(r => { if (!r.ok && r.status !== 404) throw new Error(String(r.status)); if (!dirty && get().project?.id === id) set({ saved: 'saved' }); })
    .catch(() => { dirty = true; });
  if (keepalive) await send(); else await (inflight = inflight.then(send));
}
window.addEventListener('pagehide', () => { flushSave(); });
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushSave(); });
useStore.subscribe((s, p) => { if (s.nodes !== p.nodes || s.edges !== p.edges) scheduleSave(); });
