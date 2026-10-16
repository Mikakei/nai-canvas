// 生成封面：固定的写法 + 固定的尺寸、步数、种子出一张，不同画师串（角色）的封面放在一起才好比较。
// 结果另存成封面小图；原图照常存进输出文件夹，图库里归到"封面"
import { MODELS, cost, defaultParams, normalizeParams, sizeParams, withSize, type GenParams } from '@nai/shared';
import { generate } from './api.ts';
import { isGen, type AppNode } from './graph.ts';
import { finishJob, startJob } from './jobs.ts';
import { usePrefs } from './prefs.ts';
import { makeCover } from './presets.ts';
import { setRuntime } from './run.ts';
import { refreshAccount, toast, useStore } from './store.ts';

export const COVER_SEED = 1015;
const busy = new Set<string>();

/** 封面用的参数：模型、采样器、质量标签这些跟着连着的生图节点（没连就用设置里的模型），尺寸、步数、种子固定 */
export function coverParams(from?: AppNode): GenParams {
  const base = isGen(from) ? from.data.params : defaultParams(usePrefs.getState().coverModel);
  return normalizeParams({ ...withSize(base, sizeParams(832, 1216)), steps: 28, nSamples: 1, seed: COVER_SEED, seedLocked: true });
}

/** 把写法里的 {画师串}、{角色} 换成实际内容；写法里没有占位符时放在最前面 */
export function fillCover(template: string, key: string, value: string): string {
  const t = template.trim() || key;
  return (t.includes(key) ? t.split(key).join(value) : `${value}, ${t}`).replace(/^[\s,]+|[\s,]+$/g, '').replace(/,\s*,/g, ',');
}

export function coverCostLabel(from?: AppNode): string {
  const c = cost(coverParams(from), useStore.getState().account, {});
  return c.total === 0 ? 'Opus 免费' : `${c.total} Anlas`;
}

/** 出一张封面；statusId 是显示"生成封面中"的节点 */
export async function generateCover(o: { statusId: string; title: string; prompt: string; from?: AppNode; onCover: (cover: string) => void }) {
  const st = useStore.getState();
  if (busy.has(o.statusId)) return;
  if (!o.prompt.trim()) { toast('先写好内容再生成封面', { err: true }); return; }
  if (!st.config?.mock && !st.config?.hasToken) { toast('还没有填 Token，先在设置里填好', { err: true }); useStore.setState({ dialog: 'settings' }); return; }
  const params = coverParams(o.from), c = cost(params, st.account, {});
  if (st.account && c.total > st.account.anlas) { toast(`Anlas 不够：生成封面要 ${c.total}，余额只有 ${st.account.anlas}`, { err: true }); return; }
  busy.add(o.statusId);
  const label = `生成封面 · ${MODELS[params.model].label}`;
  const job = startJob({ nodeId: o.statusId, title: o.title, label, kind: 'generate' });
  setRuntime(o.statusId, { status: 'running', label: '生成封面中', error: undefined });
  let raw = '';
  try {
    await generate({ prompt: o.prompt, params, kind: 'cover' }, new AbortController().signal, e => {
      if (e.event === 'image') raw = e.data.url;
      else if (e.event === 'fail') throw new Error(e.data.message);
    });
    if (!raw) throw new Error('没有拿到图，再试一次');
    o.onCover(await makeCover(raw));
    finishJob(job, 'done', { count: 1 });
    setRuntime(o.statusId, { status: 'idle', label: undefined, flash: Date.now() });
    toast(`封面换好了（${MODELS[params.model].label} · 832×1216 · 种子 ${COVER_SEED}），原图也存进了图库`);
  } catch (err) {
    const msg = (err as Error).message || '生成封面失败';
    finishJob(job, 'failed', { error: msg });
    setRuntime(o.statusId, { status: 'idle', label: undefined });
    toast(msg, { err: true });
  } finally {
    busy.delete(o.statusId);
    refreshAccount();
  }
}
export const coverBusy = (id: string) => busy.has(id);
