import { useEffect, useState } from 'react';
import { MODELS, buildPrompt, expandMacros, expandRandom, type ModelKey } from '@nai/shared';
import { useShallow } from 'zustand/react/shallow';
import { isGen } from '../graph.ts';
import { chunkMap } from '../chunks.ts';
import { useStore } from '../store.ts';

interface Result { counts: number[]; limit: number; exact: boolean; kind: 't5' | 'qwen' }
const cache = new Map<string, Result>();
const rough = (t: string) => (t.trim() ? Math.round(t.split(/[\s,]+/).filter(Boolean).length * 1.35) + 1 : 0);

/** 问本地服务要准确的 token 数；服务不可用时退回粗略估算 */
function useTokens(model: ModelKey, texts: string[]): Result {
  const key = `${model}|${texts.join('\u0001')}`;
  const [res, setRes] = useState<Result>(() => cache.get(key) ?? { counts: texts.map(rough), limit: MODELS[model].tokenLimit, exact: false, kind: 't5' });
  useEffect(() => {
    const hit = cache.get(key);
    if (hit) { setRes(hit); return; }
    const t = setTimeout(async () => {
      try {
        const r = await fetch('/api/tokens', { method: 'POST', headers: { 'x-nai-canvas': '1', 'Content-Type': 'application/json' }, body: JSON.stringify({ model, texts }) });
        const j = (await r.json()) as Result;
        const out = j.exact ? j : { ...j, counts: texts.map(rough) };
        if (cache.size > 500) cache.clear();
        cache.set(key, out); setRes(out);
      } catch { setRes({ counts: texts.map(rough), limit: MODELS[model].tokenLimit, exact: false, kind: 't5' }); }
    }, 350);
    return () => clearTimeout(t);
  }, [key]);
  return res;
}

/** 计数前先展开片段，随机器取第一个选项 */
const prepare = (t: string) => expandRandom(expandMacros(t, chunkMap()), () => 0);

/** 提示词、角色节点自己的 token 数（按它接到的第一个生图节点的模型计算） */
export function TokenCount({ nodeId, text }: { nodeId: string; text: string }) {
  const model = useStore(s => {
    const g = s.nodes.find(m => isGen(m) && s.edges.some(e => e.source === nodeId && e.target === m.id));
    return isGen(g) ? g.data.params.model : 'v5-full';
  });
  const r = useTokens(model, [prepare(text)]);
  const approx = !r.exact || r.kind === 'qwen';
  return <span title={r.exact ? `${r.kind === 'qwen' ? 'V5 用 Qwen 分词器，具体版本官方没公开，可能有少量误差' : 'V4 / V4.5 用 T5 分词器'}` : '分词器还没下载好，这是粗略估算'}>{approx ? '约 ' : ''}{r.counts[0] ?? 0} TOKENS</span>;
}

/** 生图节点实际发出去的全部提示词（含质量标签、片段展开、角色）的 token 数和上限。
 *  只订阅用到的参数和角色文字：拖动、编辑别的节点时，生图节点不用跟着重新渲染 */
export function useGenTokens(id: string, prompt: string) {
  const p = useStore(s => { const g = s.nodes.find(n => n.id === id); return isGen(g) ? g.data.params : null; });
  const chars = useStore(useShallow(s => s.edges.filter(e => e.target === id && e.data?.slot === 'chars').map(e => s.nodes.find(n => n.id === e.source))
    .filter(n => n?.type === 'character' && n.data.enabled).map(n => String(n!.data.text))));
  const texts = p ? [buildPrompt(prepare(prompt), p), ...chars.map(prepare)] : [];
  const r = useTokens(p?.model ?? 'v5-full', texts);
  const total = r.counts.reduce((a, b) => a + b, 0);
  return { total, limit: r.limit, approx: !r.exact || r.kind === 'qwen', over: total > r.limit };
}
