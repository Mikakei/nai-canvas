// 收藏库：画师串库和角色字典。全局保存（data\artists.json、data\characters.json），所有画布共用。
// 画师串节点引用库里的一条，并在节点里留一份快照；改了库里的条目，当前画布里用到它的节点马上跟着变
import { isArtist } from './graph.ts';
import { newId, node, toast, updateData, useStore } from './store.ts';

export interface ArtistEntry { id: string; name: string; group: string; text: string; cover?: string; note?: string; created: number }
export interface Outfit { name: string; tags: string }
export interface CharEntry { id: string; name: string; series: string; prompt: string; uc: string; outfits: Outfit[]; cover?: string; note?: string; created: number }
/** 提示词词典：存好的正面、负面提示词，在提示词框旁边的"词典"按钮里调出来 */
export interface PromptEntry { id: string; name: string; kind: 'pos' | 'neg'; text: string; created: number }
export type PresetKind = 'artists' | 'characters' | 'prompts';
const NAME: Record<PresetKind, string> = { artists: '画师串库', characters: '角色字典', prompts: '提示词词典' };

const get = useStore.getState, set = useStore.setState;
const H = { 'x-nai-canvas': '1' };

export async function loadPresets() {
  const [a, c, p] = await Promise.all(['artists', 'characters', 'prompts'].map(k => fetch(`/api/presets/${k}`, { headers: H }).then(r => r.json()).catch(() => [])));
  set({
    artists: Array.isArray(a) ? a : [],
    characters: Array.isArray(c) ? (c as CharEntry[]).map(e => ({ ...e, outfits: e.outfits ?? [], uc: e.uc ?? '' })) : [],
    prompts: Array.isArray(p) ? p : [],
  });
}

/* ---------- 存盘：改完稍等一下整份写回；关页面、切走时立刻写 ---------- */
const timers: Record<PresetKind, number> = { artists: 0, characters: 0, prompts: 0 };
const pending: Record<PresetKind, boolean> = { artists: false, characters: false, prompts: false };
function save(kind: PresetKind) {
  pending[kind] = true;
  clearTimeout(timers[kind]);
  timers[kind] = window.setTimeout(() => {
    pending[kind] = false;
    fetch(`/api/presets/${kind}`, { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(get()[kind]) })
      .then(r => { if (!r.ok) throw new Error(); })
      .catch(() => { pending[kind] = true; toast(`${NAME[kind]}保存失败，请检查本地服务是否在运行`, { err: true }); });
  }, 400);
}
function flush() {
  for (const kind of ['artists', 'characters', 'prompts'] as const) {
    if (!pending[kind]) continue;
    clearTimeout(timers[kind]); pending[kind] = false;
    const body = JSON.stringify(get()[kind]);
    fetch(`/api/presets/${kind}`, { method: 'PUT', keepalive: body.length < 60000, headers: { ...H, 'Content-Type': 'application/json' }, body }).catch(() => { pending[kind] = true; });
  }
}
window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flush(); });

/* ---------- 画师串库 ---------- */
export const artistById = (id?: string) => (id ? get().artists.find(a => a.id === id) : undefined);

/** 当前画布里用到这条画师串的节点，跟着库里的内容更新快照 */
function syncArtistNodes(e: ArtistEntry) {
  const nodes = get().nodes;
  if (!nodes.some(n => isArtist(n) && n.data.entry === e.id)) return;
  set({ nodes: nodes.map(n => (isArtist(n) && n.data.entry === e.id && (n.data.name !== e.name || n.data.text !== e.text || n.data.cover !== e.cover)
    ? { ...n, data: { ...n.data, name: e.name, text: e.text, cover: e.cover } } : n)) });
}
/** 打开画布时：节点的快照按库里最新的来（库里删了的保留快照） */
export function refreshArtistSnapshots() {
  for (const e of get().artists) syncArtistNodes(e);
}

export function addArtist(p: Partial<ArtistEntry> = {}): ArtistEntry {
  const list = get().artists;
  let k = list.length + 1, name = p.name?.trim() || `画师串 ${k}`;
  while (list.some(a => a.name === name)) name = `画师串 ${++k}`;
  const e: ArtistEntry = { group: '', text: '', created: Date.now(), ...p, id: newId('a'), name };
  set({ artists: [...list, e] });
  save('artists');
  return e;
}
export function updateArtist(id: string, patch: Partial<ArtistEntry>) {
  let next: ArtistEntry | undefined;
  set({ artists: get().artists.map(a => (a.id === id ? (next = { ...a, ...patch }) : a)) });
  if (!next) return;
  save('artists');
  syncArtistNodes(next);
}
export function deleteArtist(id: string) {
  const list = get().artists, i = list.findIndex(a => a.id === id);
  if (i < 0) return;
  const gone = list[i];
  set({ artists: list.filter(a => a.id !== id) });
  save('artists');
  toast(`已从画师串库删掉「${gone.name}」，用到它的节点保留现在的内容`, {
    action: { label: '撤销', fn: () => { const now = [...get().artists]; now.splice(i, 0, gone); set({ artists: now }); save('artists'); } },
  });
}

/* ---------- 角色字典 ---------- */
export const charById = (id?: string) => (id ? get().characters.find(c => c.id === id) : undefined);
export function addChar(p: Partial<CharEntry> = {}): CharEntry {
  const list = get().characters;
  let k = list.length + 1, name = p.name?.trim() || `角色 ${k}`;
  while (list.some(c => c.name === name)) name = `角色 ${++k}`;
  const e: CharEntry = { series: '', prompt: '', uc: '', outfits: [], created: Date.now(), ...p, id: newId('c'), name };
  set({ characters: [...list, e] });
  save('characters');
  return e;
}
export function updateChar(id: string, patch: Partial<CharEntry>) {
  set({ characters: get().characters.map(c => (c.id === id ? { ...c, ...patch } : c)) });
  save('characters');
}
export function deleteChar(id: string) {
  const list = get().characters, i = list.findIndex(c => c.id === id);
  if (i < 0) return;
  const gone = list[i];
  set({ characters: list.filter(c => c.id !== id) });
  save('characters');
  toast(`已从角色字典删掉「${gone.name}」`, {
    action: { label: '撤销', fn: () => { const now = [...get().characters]; now.splice(i, 0, gone); set({ characters: now }); save('characters'); } },
  });
}
/** 字典里的角色拼成角色提示词：设定 + 选的那套服装 */
export function charPrompt(e: CharEntry, outfit = 0): string {
  const o = e.outfits[outfit];
  return [e.prompt, o?.tags ?? ''].map(t => t.trim().replace(/^[\s,]+|[\s,]+$/g, '')).filter(Boolean).join(', ');
}

/* ---------- 提示词词典 ---------- */
export function addPrompt(p: Pick<PromptEntry, 'kind' | 'text'> & Partial<PromptEntry>): PromptEntry {
  const list = get().prompts;
  let name = p.name?.trim() || p.text.split(',').map(t => t.trim()).filter(Boolean).slice(0, 3).join(', ').slice(0, 30) || '未命名';
  for (let k = 2; list.some(e => e.kind === p.kind && e.name === name); k++) name = `${name.replace(/ \d+$/, '')} ${k}`;
  const e: PromptEntry = { created: Date.now(), ...p, id: newId('w'), name };
  set({ prompts: [...list, e] });
  save('prompts');
  return e;
}
export function updatePrompt(id: string, patch: Partial<PromptEntry>) {
  set({ prompts: get().prompts.map(e => (e.id === id ? { ...e, ...patch } : e)) });
  save('prompts');
}
export function deletePrompt(id: string) {
  const list = get().prompts, i = list.findIndex(e => e.id === id);
  if (i < 0) return;
  const gone = list[i];
  set({ prompts: list.filter(e => e.id !== id) });
  save('prompts');
  toast(`已从词典删掉「${gone.name}」`, { action: { label: '撤销', fn: () => { const now = [...get().prompts]; now.splice(i, 0, gone); set({ prompts: now }); save('prompts'); } } });
}

/* ---------- 封面：另存一份 512 像素的小图（原图删了封面还在） ---------- */
export async function makeCover(src: string | Blob): Promise<string> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  const bmp = await createImageBitmap(blob);
  try {
    const k = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(bmp.width * k)); c.height = Math.max(1, Math.round(bmp.height * k));
    const g = c.getContext('2d')!;
    g.imageSmoothingQuality = 'high';
    g.drawImage(bmp, 0, 0, c.width, c.height);
    const png = await new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error('封面编码失败'))), 'image/png'));
    const res = await fetch('/api/upload', { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: png });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error || '封面保存失败');
    return (j as { url: string }).url;
  } finally { bmp.close(); }
}

/** 给画师串节点换封面（拖进来的图、结果图、文件）：存进库里的那一条；库里没有就只存在节点上 */
export async function setArtistCover(nodeId: string, src: string | Blob) {
  const n = node(nodeId);
  if (!isArtist(n)) return;
  try {
    const url = await makeCover(src);
    if (artistById(n.data.entry)) updateArtist(n.data.entry!, { cover: url });
    else updateData(nodeId, { cover: url }, true);
    toast(`「${n.data.name || n.data.title}」的封面换好了`);
  } catch (e) { toast(`换封面失败：${(e as Error).message}`, { err: true }); }
}

/** 给角色字典里的角色换封面 */
export async function setCharCover(entryId: string, src: string | Blob) {
  const e = charById(entryId);
  if (!e) return;
  try { updateChar(entryId, { cover: await makeCover(src) }); toast(`「${e.name}」的封面换好了`); }
  catch (er) { toast(`换封面失败：${(er as Error).message}`, { err: true }); }
}

/* ---------- 整个库的导出、导入（带封面的 zip） ---------- */
export async function exportPresets(kind: PresetKind) {
  flush();
  try {
    const res = await fetch(`/api/presets/${kind}/export`, { headers: H });
    if (!res.ok) throw new Error(`导出失败（${res.status}）`);
    const blob = await res.blob(), a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${NAME[kind]}.nai-${kind}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`已导出${NAME[kind]}（${get()[kind].length} 条${kind === 'prompts' ? '' : '，带封面'}）`);
  } catch (e) { toast((e as Error).message, { err: true }); }
}
export async function importPresets(kind: PresetKind, file: Blob) {
  flush();
  try {
    const r = await fetch(`/api/presets/${kind}/import`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: file });
    const j = await r.json().catch(() => ({})) as { added?: number; skipped?: number; items?: unknown[]; error?: string };
    if (!r.ok) throw new Error(j.error || `导入失败（${r.status}）`);
    if (kind === 'artists') set({ artists: j.items as ArtistEntry[] });
    else if (kind === 'prompts') set({ prompts: j.items as PromptEntry[] });
    else set({ characters: (j.items as CharEntry[]).map(e => ({ ...e, outfits: e.outfits ?? [], uc: e.uc ?? '' })) });
    toast(`导入了 ${j.added ?? 0} 条${j.skipped ? `，${j.skipped} 条已经有了，跳过` : ''}`);
  } catch (e) { toast((e as Error).message, { err: true }); }
}
