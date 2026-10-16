// 提示词片段：保存在本机 data/chunks.json；在提示词里写成 !macro:名称!，生成前展开
import type { EditorView } from '@codemirror/view';
import { api } from './api.ts';
import { newId, toast, useStore, type Chunk } from './store.ts';

const get = useStore.getState, set = useStore.setState;
export const CHUNK_COLORS = ['#D71921', '#E0892B', '#3E8E5E', '#3B6FD8', '#8E5BD6', '#5B5B58'];

/** 最近获得焦点的提示词编辑器，点"插入"时插到这里 */
export const lastEditor: { view: EditorView | null } = { view: null };

export async function loadChunks() {
  try { set({ chunks: await api.chunks() }); } catch { /* 读不到就当没有 */ }
}

let timer = 0, pending = false;
function save(list: Chunk[]) {
  set({ chunks: list });
  pending = true;
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    pending = false;
    api.saveChunks(get().chunks).catch(() => { pending = true; toast('片段保存失败，请检查本地服务是否在运行', { err: true }); });
  }, 400);
}
/** 关闭或切走页面时，把还没发出去的片段改动立刻存掉 */
function flushChunks() {
  if (!pending) return;
  clearTimeout(timer); pending = false;
  const body = JSON.stringify(get().chunks);
  fetch('/api/chunks', { method: 'PUT', keepalive: body.length < 60000, headers: { 'x-nai-canvas': '1', 'Content-Type': 'application/json' }, body }).catch(() => { pending = true; });
}
window.addEventListener('pagehide', flushChunks);
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushChunks(); });

/** 片段名不能含 ! 和换行（它们是 !macro:名称! 语法的一部分），也不能重名 */
export function validName(name: string, selfId?: string): string | null {
  const n = name.trim();
  if (!n) return '名称不能为空';
  if (/[!\n]/.test(n)) return '名称里不能有感叹号或换行';
  if (get().chunks.some(c => c.name === n && c.id !== selfId)) return '已经有同名的片段了';
  return null;
}

export function addChunk(partial: Partial<Chunk> = {}): Chunk {
  const list = get().chunks;
  let k = list.length + 1, name = partial.name ?? `片段 ${k}`;
  while (list.some(c => c.name === name)) name = `片段 ${++k}`;
  const c: Chunk = { id: newId('c'), text: '', color: CHUNK_COLORS[list.length % CHUNK_COLORS.length], folder: '', ...partial, name };
  save([...list, c]);
  return c;
}

/** 改名时，引用它的 !macro:旧名! 一起改掉，避免引用失效：
 *  当前画布的节点、其他片段的内容（片段可以套片段）在这里改，其他画布交给服务端改 */
export function updateChunk(id: string, patch: Partial<Chunk>) {
  const old = get().chunks.find(c => c.id === id);
  if (!old) return;
  const renamed = !!patch.name && patch.name !== old.name;
  const from = `!macro:${old.name}!`, to = `!macro:${patch.name}!`;
  save(get().chunks.map(c => (c.id === id ? { ...c, ...patch } : renamed && c.text.includes(from) ? { ...c, text: c.text.split(from).join(to) } : c)));
  if (renamed) {
    set({ nodes: get().nodes.map(n => {
      const d = n.data as Record<string, unknown>;
      let changed = false;
      const nd: Record<string, unknown> = { ...d };
      // 工具节点（上色、表情）的提示词也会展开片段
      for (const k of ['text', 'uc', ...(n.type === 'tool' ? ['prompt'] : [])]) if (typeof d[k] === 'string' && (d[k] as string).includes(from)) { nd[k] = (d[k] as string).split(from).join(to); changed = true; }
      if (n.type === 'generate' && n.data.params.negative.includes(from)) { nd.params = { ...n.data.params, negative: n.data.params.negative.split(from).join(to) }; changed = true; }
      return changed ? { ...n, data: nd } as typeof n : n;
    }) });
    api.renameMacro(old.name, patch.name!, get().project?.id ?? undefined)
      .catch(() => toast(`其他画布里引用「${old.name}」的地方没能一起改名，打开时会显示为找不到`, { err: true }));
  }
}

export function deleteChunk(id: string) {
  const list = get().chunks, i = list.findIndex(c => c.id === id);
  if (i < 0) return;
  const removed = list[i];
  save(list.filter(c => c.id !== id));
  toast(`已删除片段「${removed.name}」，用到它的地方会显示为找不到`, {
    action: { label: '撤销', fn: () => { const now = [...get().chunks]; now.splice(i, 0, removed); save(now); } },
  });
}

/** 把片段插到最近使用的编辑器光标处 */
export function insertChunk(name: string) {
  const v = lastEditor.view;
  if (!v || !v.dom.isConnected) { toast('先点一下要插入的提示词框，再点"插入"', { err: true }); return; }
  const { from, to } = v.state.selection.main;
  const before = v.state.sliceDoc(Math.max(0, from - 2), from);
  const insert = `${from > 0 && !/[,\s]$/.test(before) ? ', ' : ''}!macro:${name}!`;
  v.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
  v.focus();
}

export const chunkMap = () => Object.fromEntries(get().chunks.map(c => [c.name, c.text]));
