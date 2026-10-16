// 多项目：加载、切换、新建、重命名、复制、删除（删除可撤销）
import { defaultParams, normalizeParams } from '@nai/shared';
import { api, type ProjectData } from './api.ts';
import { KINDS, isGen, type AppEdge, type AppNode } from './graph.ts';
import { freeSpot, settle } from './layout.ts';
import { born, flow, flushSave, newId, toast, useStore } from './store.ts';
import { refreshArtistSnapshots } from './presets.ts';

const get = useStore.getState, set = useStore.setState;

/** 新画布的入门模板：提示词 → 生图 */
export function template(): { nodes: AppNode[]; edges: AppEdge[] } {
  const p = newId('n'), u = newId('n'), g = newId('n'), e = newId('e'), f = newId('e');
  [p, u, g, e, f].forEach(id => born.add(id));
  return {
    nodes: [
      { id: p, type: 'prompt', position: { x: 0, y: 60 }, data: { title: '提示词 1', text: '' } },
      { id: u, type: 'negative', position: { x: 0, y: 290 }, data: { title: '负面提示词 1', text: '' } },
      { id: g, type: 'generate', position: { x: 360, y: 0 }, data: { title: '生图 1', params: defaultParams(), history: [], cur: 0 } },
    ],
    edges: [
      { id: e, source: p, target: g, sourceHandle: 'out', targetHandle: 'in', type: 'dot', data: { slot: 'prompt' } },
      { id: f, source: u, target: g, sourceHandle: 'out', targetHandle: 'in', type: 'dot', data: { slot: 'negative' } },
    ],
  };
}

/** 以前新画布的生图节点里自动填的示例句 */
const OLD_SAMPLE = '1girl, silver hair, raincoat, standing in the rain, neon city at night';

/**
 * 生图节点以前自带一个提示词框，现在去掉了：存档里框中写的内容搬进一个新的提示词节点接上
 * （排在已经接着的提示词后面，和原来拼出来的提示词一样）；当初自动填的示例句直接去掉
 */
function moveGenText(nodes: AppNode[], edges: AppEdge[]) {
  const made: AppNode[] = [], links: AppEdge[] = [];
  const out = nodes.map(n => {
    if (n.type !== 'generate' || !('text' in n.data)) return n;
    const { text, ...data } = n.data as Record<string, unknown>;
    const t = typeof text === 'string' ? text.trim() : '';
    if (t && t !== OLD_SAMPLE) {
      const p = { id: newId('n'), type: 'prompt', position: { x: n.position.x - KINDS.prompt.w - 80, y: n.position.y }, data: { title: `${n.data.title} 的提示词`, text: t } } as AppNode;
      const [dx, dy] = freeSpot([p], [...nodes, ...made]);
      p.position = { x: p.position.x + dx, y: p.position.y + dy };
      made.push(p);
      links.push({ id: newId('e'), source: p.id, target: n.id, sourceHandle: 'out', targetHandle: 'in', type: 'dot', data: { slot: 'prompt' } });
    }
    return { ...n, data } as AppNode;
  });
  return { nodes: [...out, ...made], edges: [...edges, ...links], moved: made.map(n => n.id) };
}

/** 把存档里的内容整理成画布能用的节点和连线；旧存档缺的参数补默认值 */
function hydrate(data: ProjectData): { nodes: AppNode[]; edges: AppEdge[]; moved: string[] } {
  if (!data.nodes?.length) return { ...template(), moved: [] };
  const nodes = (data.nodes as AppNode[]).filter(n => n.type in KINDS).map(n => isGen(n) ? { ...n, data: { ...n.data, params: normalizeParams(n.data.params) } } : n) as AppNode[];
  const ids = new Set(nodes.map(n => n.id));
  const edges = ((data.edges ?? []) as AppEdge[]).filter(e => ids.has(e.source) && ids.has(e.target)).map(e => ({ ...e, type: 'dot', sourceHandle: 'out', targetHandle: 'in' }));
  return moveGenText(nodes, edges);
}

function show(id: string, name: string, data: ProjectData) {
  const { nodes, edges, moved } = hydrate(data);
  set({ project: { id, name }, nodes, edges, runtime: {}, undo: [], redo: [], menu: null, loaded: true, saved: 'saved' });
  if (moved.length) {
    // 量好真实大小以后再挪到不挡别人的地方
    moved.forEach(m => settle(m));
    toast(`生图节点不再自带提示词框：${moved.length} 个生图节点框里原来写的提示词，已经搬进「…的提示词」节点并接好，生成结果不变`);
  }
  // 画师串节点的快照按库里最新的来
  refreshArtistSnapshots();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (data.viewport && data.nodes?.length) flow.rf?.setViewport(data.viewport);
    else flow.rf?.fitView({ padding: 0.25, maxZoom: 1 });
  }));
}

export async function refreshProjects() {
  const r = await api.projects();
  set({ projects: r.projects });
  return r;
}

/** 启动时：打开上次用的画布；一个都没有就新建一个 */
export async function openInitial() {
  const { current, projects } = await refreshProjects();
  const id = current && projects.some(p => p.id === current) ? current : projects[0]?.id;
  if (id) { const data = await api.loadProject(id); show(id, data.name, data); return; }
  const meta = await api.createProject('我的画布');
  show(meta.id, meta.name, { name: meta.name });
  refreshProjects();
}

const busy = () => Object.values(get().runtime).some(r => r.status === 'running' || r.status === 'queued');

export async function switchProject(id: string) {
  if (get().project?.id === id) return;
  if (busy()) { toast('有节点正在生成，等它完成或取消后再切换画布', { err: true }); return; }
  await flushSave(false);
  try {
    const data = await api.loadProject(id);
    show(id, data.name, data);
    refreshProjects();
  } catch (e) { toast((e as Error).message, { err: true }); refreshProjects(); }
}

export async function createProject() {
  if (busy()) { toast('有节点正在生成，等它完成或取消后再新建画布', { err: true }); return; }
  await flushSave(false);
  const n = get().projects.length + 1;
  const meta = await api.createProject(`画布 ${n}`);
  show(meta.id, meta.name, { name: meta.name });
  await refreshProjects();
  toast(`已新建「${meta.name}」，自带一套提示词 → 生图的模板`);
}

export async function renameProject(name: string) {
  const p = get().project; if (!p) return;
  const clean = name.trim();
  if (!clean || clean === p.name) return;
  await api.renameProject(p.id, clean);
  set({ project: { ...p, name: clean } });
  refreshProjects();
}

export async function duplicateProject() {
  const p = get().project; if (!p) return;
  await flushSave(false);
  const meta = await api.duplicateProject(p.id);
  const data = await api.loadProject(meta.id);
  show(meta.id, meta.name, data);
  await refreshProjects();
  toast(`已复制为「${meta.name}」，现在打开的是副本`);
}

export async function deleteProject(id: string) {
  if (busy() && get().project?.id === id) { toast('有节点正在生成，等它完成或取消后再删除', { err: true }); return; }
  const meta = get().projects.find(p => p.id === id);
  // 先把还没存的改动写进去，撤销删除时能完整恢复
  if (get().project?.id === id) await flushSave(false);
  await api.deleteProject(id);
  const { projects } = await refreshProjects();
  if (get().project?.id === id) {
    const next = projects[0];
    if (next) { const data = await api.loadProject(next.id); show(next.id, data.name, data); }
    else { const created = await api.createProject('我的画布'); show(created.id, created.name, { name: created.name }); await refreshProjects(); }
  }
  toast(`已删除「${meta?.name ?? '画布'}」`, {
    action: { label: '撤销', fn: async () => { await api.restoreProject(id); await refreshProjects(); await switchProject(id); toast('已恢复'); } },
  });
}

/** 导出备份：当前画布 + 用到的图片 + 风格参考，下载成一个 zip */
export async function exportProject() {
  const p = get().project; if (!p) return;
  await flushSave(false);
  toast('正在打包…');
  try {
    const res = await fetch(`/api/projects/${p.id}/export`, { headers: { 'x-nai-canvas': '1' } });
    if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error((j as { error?: string }).error || `导出失败（${res.status}）`); }
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${p.name.replace(/[\\/:*?"<>|]/g, '_')}.nai-canvas.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast(`已导出「${p.name}」（${(blob.size / 1048576).toFixed(1)} MB），在别的电脑上用"导入备份"打开`);
  } catch (e) { toast((e as Error).message, { err: true }); }
}

/** 导入备份：图片放进 uploads，画布作为一个新画布打开 */
export async function importProject(file: File) {
  if (busy()) { toast('有节点正在生成，等它完成或取消后再导入', { err: true }); return; }
  await flushSave(false);
  toast('正在导入…');
  try {
    const meta = await api.importProject(file);
    const data = await api.loadProject(meta.id);
    show(meta.id, data.name, data);
    await refreshProjects();
    toast(`已导入「${meta.name}」，带了 ${meta.images} 张图`);
  } catch (e) { toast((e as Error).message, { err: true }); }
}
