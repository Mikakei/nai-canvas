import { memo, useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { MODELS, applyLocks, cost, costLabel, sizeOf } from '@nai/shared';
import { useGenTokens } from '../editor/TokenCount.tsx';
import { promptFor } from '../graph.ts';
import { KINDS, isChar, isRef, isVibe, type GenNode as GN, type Slot } from '../graph.ts';
import { refWarnings, useExtras } from '../inputs.ts';
import { inpaintResult, upscaleImage, variations } from '../imageActions.ts';
import { charWarnings } from '../run.ts';
import { api, thumb } from '../api.ts';
import { useShallow } from 'zustand/react/shallow';
import { disconnect, toast, updateData, useStore } from '../store.ts';
import { addPromptFor, copyImage, dupNodes, ensureVisible, placeImageBeside, removeNodes, type ImageRef } from '../actions.ts';
import { ParamsPanel } from '../ui/ParamsPanel.tsx';
import { setPrefs, usePrefs, widthScale } from '../prefs.ts';
import { startImageDrag } from '../ui/DragImage.tsx';
import { cancel, run, setRuntime } from '../run.ts';
import { Glyph, Icons } from '../ui/controls.tsx';
import { DotBreath } from './DotBreath.tsx';
import { NodeShell } from './NodeShell.tsx';

const GLYPH: Record<Slot, 'text' | 'neg' | 'char' | 'image' | 'vibe' | 'ref' | 'artist'> = { prompt: 'text', negative: 'neg', chars: 'char', base: 'image', vibes: 'vibe', refs: 'ref', src: 'image', setup: 'image', artists: 'artist' };
/** 参数卡片的宽度（打开时贴在生图卡片右边） */
const PARAMS_W = 320;
const SLIDERS = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4.5h7M12.5 4.5h1M2.5 11.5h1M6.5 11.5h7" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /><circle cx="11" cy="4.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" /><circle cx="5" cy="11.5" r="1.6" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>;
const refOf = (h: { url: string; w: number; h: number; seed: number; prompt: string }): ImageRef => ({ url: h.url, iw: h.w, ih: h.h, seed: h.seed, prompt: h.prompt });

function GenerateNodeView({ id, data }: NodeProps<GN>) {
  const rt = useStore(s => s.runtime[id]);
  const account = useStore(s => s.account);
  const inputs = useStore(useShallow(s => s.edges.filter(e => e.target === id)));
  const sources = useStore(useShallow(s => inputs.map(e => { const n = s.nodes.find(m => m.id === e.source); return String((n?.type === 'artist' && n.data.name) || n?.data.title || ''); })));
  const masks = useStore(useShallow(s => inputs.map(e => { const n = s.nodes.find(m => m.id === e.source); return n?.type === 'image' && !!n.data.mask; })));
  const offs = useStore(useShallow(s => inputs.map(e => { const n = s.nodes.find(m => m.id === e.source); return (isChar(n) || isVibe(n) || isRef(n)) && !n.data.enabled; })));
  const warnings = useStore(useShallow(s => [...charWarnings(id, s.nodes, s.edges), ...refWarnings(id, s.nodes, s.edges)]));
  const extras = useExtras(id);
  const paramsSeen = usePrefs(s => s.paramsSeen);
  // 字调大时参数卡片跟着变宽，不然选项挤不下
  const sideW = Math.round(PARAMS_W * widthScale(usePrefs(s => s.fontScale)));
  const fullPrompt = useStore(s => promptFor(id, s.nodes, s.edges));
  const tok = useGenTokens(id, fullPrompt);
  const p = applyLocks(data.params), m = MODELS[p.model], [pw, ph] = sizeOf(p);
  const item = data.history[data.cur];
  // 有没有接提示词（提示词节点或画师串）；没有的话底栏给一个"新建提示词"
  const hasPrompt = inputs.some(e => e.data?.slot === 'prompt' || e.data?.slot === 'artists');
  const status = rt?.status ?? 'idle';
  const busy = status === 'queued' || status === 'running';

  // 完成一张时闪一下
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (!rt?.flash) return; setFlash(false); requestAnimationFrame(() => setFlash(true)); const t = setTimeout(() => setFlash(false), 650); return () => clearTimeout(t); }, [rt?.flash]);
  // 缺提示词的报错，补上提示词以后自己消失
  useEffect(() => { if (rt?.status === 'error' && rt.error === '缺少提示词' && fullPrompt) setRuntime(id, null); }, [id, fullPrompt, rt?.status, rt?.error]);


  let stat = item ? `DONE · ${data.history.length} 张` : 'READY';
  if (rt?.label && status !== 'running') stat = rt.label;
  if (status === 'queued') stat = 'QUEUED · 排队中';
  if (status === 'error') stat = '失败';
  if (status === 'running') {
    const step = rt.step ?? 0, steps = rt.steps ?? p.steps, n = rt.n ?? 1, s = rt.sample ?? 0;
    const el = rt.startedAt ? (performance.now() - rt.startedAt) / 1000 : 0, done = s * steps + step, total = n * steps;
    const left = done > 0 ? Math.ceil((el / done) * (total - done)) : null;
    stat = `${n > 1 ? `${s + 1}/${n} · ` : ''}${String(step).padStart(2, '0')}/${steps}${left !== null ? ` · ~${left}S` : ''}`;
    if (rt.label) stat = rt.label;
  }

  const ar = item ? item.w / item.h : pw / ph;
  const c = cost(p, account, extras);
  const showImg = rt?.preview ?? item?.url;

  // 参数在旁边单独一张卡片里（还是这个节点的一部分），第一次打开前在"参数"上亮个小红点提示
  const toggleParams = () => {
    const open = !data.showParams;
    updateData(id, { showParams: open });
    if (open) { if (!paramsSeen) setPrefs({ paramsSeen: true }); setTimeout(() => ensureVisible(id), 260); }
  };
  return (
    <NodeShell id={id} kind="generate" title={data.title} width={data.w ?? KINDS.generate.w} status={stat}
      className={`is-${status === 'idle' ? 'idle' : status === 'error' ? 'err' : status} ${data.hidePrompt ? 'is-nopb' : ''}`}
      side={data.showParams ? { title: '参数', en: 'PARAMS', width: sideW, content: <ParamsPanel id={id} />, onClose: toggleParams } : undefined}
      tools={[{ label: busy ? '取消' : '运行', run: true, onClick: () => (busy ? cancel(id) : run(id)) }, { label: data.showParams ? '收起参数' : '参数', onClick: toggleParams }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}
      after={data.history.length > 1 ? (
        <div className="hist nodrag nowheel">
          {data.history.slice(0, 30).map((h, i) => (
            <button key={h.url} type="button" className={i === data.cur ? 'is-cur' : ''} title={`种子 ${h.seed}。拖到空白处可以变成图片节点`}
              onPointerDown={e => startImageDrag(e, refOf(h), () => updateData(id, { cur: i }))}
              onClick={e => { if (e.detail === 0) updateData(id, { cur: i }); }}>
              <img src={thumb(h.url, 128)} alt={`第 ${i + 1} 张`} loading="lazy" draggable={false} style={{ aspectRatio: `${h.w} / ${h.h}` }} />
            </button>
          ))}
        </div>
      ) : undefined}>
      <div className={`media ${flash ? 'is-flash' : ''}`} style={{ aspectRatio: String(ar) }}>
        {showImg ? <img src={showImg} alt={item ? `种子 ${item.seed}` : '生成预览'} draggable={false} /> : <><DotBreath /><div className="empty"><b>READY</b><span>ENTER 运行</span></div></>}
        {status === 'running' && (
          <div className="prog" aria-hidden="true">
            {Array.from({ length: Math.min(rt.steps ?? p.steps, 50) }, (_, i) => <i key={i} className={i < (rt.step ?? 0) - 1 ? 'is-done' : i === (rt.step ?? 0) - 1 ? 'is-cur' : ''} />)}
          </div>
        )}
        {status === 'error' && rt.error && <div className="err nodrag"><b>没有生成成功</b>{rt.error}</div>}
        {item && !busy && status !== 'error' && (
          <div className="acts nodrag">
            <button type="button" onClick={() => copyImage(item.url)}>复制图片</button>
            <button type="button" title="按住拖到空白处，或者点一下放到右边" onPointerDown={e => startImageDrag(e, refOf(item), () => placeImageBeside(id, refOf(item)))}
              onClick={e => { if (e.detail === 0) placeImageBeside(id, refOf(item)); }}>拖到画布</button>
            <button type="button" title="涂出要重画的地方，只改那一块" onClick={() => inpaintResult(id)}>局部重绘</button>
            <button type="button" title="以这张图为底图再出几张相似的" onClick={() => variations(id)}>变体</button>
            <button type="button" title="放大一点再重画一遍，补细节" onClick={() => useStore.setState({ modal: { kind: 'enhance', id } })}>增强</button>
            <button type="button" title="用 NovelAI 的放大模型放大 2 倍" onClick={() => upscaleImage(id, refOf(item))}>放大</button>
            <button type="button" title={`种子 ${item.seed}`} onClick={() => { updateData(id, { params: { ...data.params, seed: item.seed, seedLocked: true } }, true); toast(`已锁定种子 ${item.seed}，下次运行会沿用`); }}>用这个种子</button>
            <button type="button" onClick={() => api.reveal(item.url).catch(e => toast((e as Error).message, { err: true }))}>打开文件夹</button>
          </div>
        )}
      </div>
      {inputs.length > 0 && (
        <div className="chips">
          {inputs.map((e, i) => (
            <span key={e.id} className={`chip nodrag ${offs[i] ? 'is-off' : ''}`} title={offs[i] ? '已停用，生成时不会用到' : undefined} onPointerEnter={() => useStore.setState({ hl: e.id })} onPointerLeave={() => useStore.setState({ hl: null })}>
              <Glyph t={GLYPH[e.data?.slot ?? 'prompt']} /><span>{e.data?.slot === 'base' ? `${masks[i] ? '重绘' : '底图'} · ${sources[i]}` : sources[i]}</span>
              <button type="button" aria-label={`断开 ${sources[i]}`} title="断开" onClick={() => disconnect(e.id)}>×</button>
            </span>
          ))}
        </div>
      )}
      {warnings.map(w => <div key={w} className="warn-line">{w}</div>)}
      {tok.over && <div className="warn-line">提示词超出 {m.label} 的 {tok.limit} token 上限（含质量标签和角色），超出的部分会被忽略</div>}
      <div className="pbar">
        {hasPrompt
          ? <span className={`tok ${tok.over ? 'is-over' : ''}`} title="实际发送的提示词（含质量标签、片段展开和所有角色）占用的 token">{tok.approx ? '约 ' : ''}{tok.total}/{tok.limit} TOKEN</span>
          : <button type="button" className="add-pr nodrag" title="在左边新建一个提示词节点，自动接到这里" onClick={() => addPromptFor(id)}>{Icons.plus}新建提示词</button>}
        <button type="button" className="go nodrag" aria-label={busy ? '取消' : '生成'} data-tip={busy ? '取消生成' : costLabel(c)} onClick={e => { e.currentTarget.blur(); if (busy) cancel(id); else run(id); }}>
          <span className="go-ic">{Icons.arrow}{Icons.stop}</span>{busy ? '取消' : '生成'}</button>
      </div>
      <button type="button" className={`sum nodrag ${data.showParams ? 'is-open' : ''}`} aria-expanded={!!data.showParams}
        title={data.showParams ? '收起参数面板（P）' : '打开参数面板：模型、尺寸、步数、种子、负面提示词（P）'}
        onClick={e => { e.currentTarget.blur(); toggleParams(); }}>
        <span className={`sum-lab ${paramsSeen ? '' : 'is-new'}`}>{SLIDERS}参数</span>
        <span className="sum-val">{m.label}{p.effort === 'medium' && m.apiMedium ? ' · MEDIUM' : ''} · {pw}×{ph} · {p.steps} 步{p.nSamples > 1 ? ` · ${p.nSamples} 张` : ''}{p.seedLocked ? ' · 种子锁定' : ''}</span>
        <i className="sum-chev" aria-hidden="true" />
      </button>
    </NodeShell>
  );
}
export const GenerateNode = memo(GenerateNodeView);
