// 生图节点的图片类输入：底图、风格参考、精确参考。整理成请求、算附加费用、给出提醒
import { MODELS, fitSize, focusRegion, focusSize, refFallbackModel, sizeOf, sizeParams, switchModel, vibeModelKey, withSize, type CostExtras, type ModelKey } from '@nai/shared';
import { useMemo } from 'react';
import { api } from './api.ts';
import { inputsOf, isGen, isRef, isVibe, picOf, refPic, type AppEdge, type AppNode, type Pic, type RefNode, type VibeNode } from './graph.ts';
import { node, setConnectHook, toast, updateData, useStore } from './store.ts';

/** 接在底图输入上的节点和它的图（节点还没有图时 pic 为 null） */
export function baseFor(id: string, nodes: AppNode[], edges: AppEdge[]): { src: AppNode; pic: Pic | null } | null {
  const src = inputsOf(id, 'base', nodes, edges)[0];
  return src ? { src, pic: picOf(src) } : null;
}

export const vibesFor = (id: string, nodes: AppNode[], edges: AppEdge[]) => inputsOf(id, 'vibes', nodes, edges).filter(isVibe);
export const refsFor = (id: string, nodes: AppNode[], edges: AppEdge[]) => inputsOf(id, 'refs', nodes, edges).filter(isRef);

/** 能用的风格参考：启用了，并且有图或有编码 */
export function usableVibes(id: string, nodes: AppNode[], edges: AppEdge[]): VibeNode[] {
  return vibesFor(id, nodes, edges).filter(v => v.data.enabled && (v.data.encodingOnly ? !!v.data.vibeId : !!refPic(v.id, nodes, edges)));
}
export function usableRefs(id: string, nodes: AppNode[], edges: AppEdge[]): RefNode[] {
  return refsFor(id, nodes, edges).filter(r => r.data.enabled && !!refPic(r.id, nodes, edges));
}

/** 这个风格参考在当前模型、信息提取量下是否已经编码过（编码过的不再收 2 Anlas） */
export function isEncoded(v: VibeNode, model: ModelKey, nodes: AppNode[], edges: AppEdge[]): boolean {
  const mk = vibeModelKey(model), pic = refPic(v.id, nodes, edges);
  if (!mk || !v.data.vibeId) return false;
  if (!v.data.encodingOnly && pic && v.data.vibeFor !== pic.url) return false;
  const e = v.data.enc?.[mk];
  return e === 'any' || (Array.isArray(e) && e.some(x => Math.abs(x - v.data.ie) < 1e-6));
}

/** 计费用的附加项 */
export function extrasFor(id: string, nodes: AppNode[], edges: AppEdge[]): CostExtras {
  const g = nodes.find(n => n.id === id);
  if (!isGen(g)) return {};
  const m = MODELS[g.data.params.model];
  const base = baseFor(id, nodes, edges);
  const refs = m.preciseRef ? usableRefs(id, nodes, edges).length : 0;
  const pic = base?.pic, inpaint = !!pic?.mask;
  const vibes = m.vibe && !refs && !inpaint ? usableVibes(id, nodes, edges) : [];
  // 聚焦重绘按聚焦区域放大后的尺寸计费
  const size = pic?.mask && pic.focus ? focusSize(...((r => [r.w, r.h])(focusRegion(pic.focus, pic.ctx ?? 64, pic.iw, pic.ih)) as [number, number])) : undefined;
  return { base: !!pic, inpaint, size, refs, vibes: vibes.length, encodes: vibes.filter(v => !isEncoded(v, g.data.params.model, nodes, edges)).length };
}

/** 在组件里订阅附加项：结果里有数组，用字符串比较，避免每次渲染都当成变化 */
export function useExtras(id: string | null | undefined): CostExtras {
  const key = useStore(s => (id ? JSON.stringify(extrasFor(id, s.nodes, s.edges)) : '{}'));
  return useMemo(() => JSON.parse(key) as CostExtras, [key]);
}

/** 生图节点上显示的提醒 */
export function refWarnings(id: string, nodes: AppNode[], edges: AppEdge[]): string[] {
  const g = nodes.find(n => n.id === id);
  if (!isGen(g)) return [];
  const m = MODELS[g.data.params.model], out: string[] = [];
  const base = baseFor(id, nodes, edges);
  if (base && !base.pic) out.push(`底图「${base.src.data.title}」还没有图，生成时会当成文生图`);
  const inpaint = !!base?.pic?.mask;
  const vibes = vibesFor(id, nodes, edges).filter(v => v.data.enabled), refs = refsFor(id, nodes, edges).filter(r => r.data.enabled);
  if (vibes.length && inpaint && m.vibe) out.push('局部重绘不能用风格参考，这次会忽略');
  if (vibes.length && !m.vibe) out.push(`${m.label} 不支持风格参考，生成时会忽略。换成 ${MODELS[refFallbackModel(g.data.params.model)].label} 才能用`);
  if (refs.length && !m.preciseRef) out.push(`${m.label} 不支持精确参考，只有 V4.5 能用，生成时会忽略`);
  if (refs.length && vibes.length && m.preciseRef) out.push('精确参考和风格参考不能同时用，这次只会用精确参考');
  if (m.vibe && !inpaint && !(refs.length && m.preciseRef) && vibes.length > 4) out.push(`启用了 ${vibes.length} 个风格参考：超过 4 个的部分每个加 2 Anlas`);
  for (const v of [...vibes, ...refs]) if (!(isVibe(v) && v.data.encodingOnly) && !refPic(v.id, nodes, edges)) out.push(`「${v.data.title}」还没有图`);
  return out;
}

/** 接上底图时，把生图尺寸改成和底图一样（取 64 的倍数、不超过上限），和官网"用作底图"一致 */
export function matchBaseSize(a: string, b: string) {
  const g = node(b), pic = picOf(node(a));
  if (!isGen(g) || !pic || !useStore.getState().edges.some(e => e.source === a && e.target === b && e.data?.slot === 'base')) return;
  const p = g.data.params, [W, H] = fitSize(pic.iw, pic.ih), [w, h] = sizeOf(p);
  if (W === w && H === h) return;
  updateData(b, { params: withSize(p, sizeParams(W, H)) });
  toast(`「${g.data.title}」的尺寸已改成和底图一样：${W}×${H}`, { action: { label: '换回', fn: () => { const cur = node(b); if (isGen(cur)) updateData(b, { params: withSize(cur.data.params, { tier: p.tier, orient: p.orient, width: p.width, height: p.height }) }, true); } } });
}

/** 风格参考的图换了（或第一次有图）时，到服务端登记，拿到编号和已有的编码 */
export async function syncVibe(id: string) {
  const st = useStore.getState(), v = st.nodes.find(n => n.id === id);
  if (!isVibe(v) || v.data.encodingOnly) return;
  const pic = refPic(id, st.nodes, st.edges);
  if (!pic || (v.data.vibeFor === pic.url && v.data.vibeId)) return;
  try {
    const s = await api.vibeRegister(pic.url);
    updateData(id, { vibeId: s.id, vibeFor: pic.url, enc: s.encodings });
  } catch (e) { toast(`「${v.data.title}」登记失败：${(e as Error).message}`, { err: true }); }
}

/** 生成之后刷新风格参考的编码状态 */
export async function refreshVibes(ids: string[]) {
  const list = ids.map(node).filter(isVibe).filter(v => v.data.vibeId);
  if (!list.length) return;
  try {
    const info = await api.vibeInfo(list.map(v => v.data.vibeId!));
    for (const v of list) { const s = info[v.data.vibeId!]; if (s) updateData(v.id, { enc: s.encodings }); }
  } catch { /* 下次再刷 */ }
}

/**
 * 把风格参考或精确参考接到 V5 生图节点上时，自动换成对应的 V4.5（V5 不支持这两种参考）。
 * 精确参考接到 V4 上时也换成 V4.5
 */
export function autoSwitchForRef(sourceId: string, targetId: string) {
  const a = node(sourceId), g = node(targetId);
  if (!isGen(g) || !(isVibe(a) || isRef(a))) return;
  const p = g.data.params, m = MODELS[p.model];
  let to: ModelKey | null = null;
  if (m.family === 'v5') to = refFallbackModel(p.model);
  else if (isRef(a) && !m.preciseRef) to = m.curated ? 'v45-curated' : 'v45-full';
  if (!to || to === p.model) return;
  updateData(g.id, { params: switchModel(p, to) });
  toast(`${m.label} 不支持${isRef(a) ? '精确参考' : '风格参考'}，「${g.data.title}」已换成 ${MODELS[to].label}`, { action: { label: '换回', fn: () => { const cur = node(g.id); if (isGen(cur)) updateData(g.id, { params: switchModel(cur.data.params, p.model) }, true); } } });
}

// 连线后：参考接到 V5 上自动换模型；图片接到风格参考上就登记
setConnectHook((a, b) => {
  autoSwitchForRef(a, b);
  matchBaseSize(a, b);
  if (isVibe(node(b))) syncVibe(b);
});
