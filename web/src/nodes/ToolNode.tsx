import { memo, useEffect, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { BG_VARIANTS, EMOTIONS, EMOTION_LEVELS, TOOLS, toolCost, toolName, type ToolId } from '@nai/shared';
import { KINDS, type ToolItem, type ToolNode as TN } from '../graph.ts';
import { api, thumb } from '../api.ts';
import { pushUndo, recordEdit, toast, updateData, useStore } from '../store.ts';
import { copyImage, dupNodes, placeImageBeside, removeNodes, type ImageRef } from '../actions.ts';
import { runTool, toolInput } from '../toolRun.ts';
import { PromptEditor } from '../editor/PromptEditor.tsx';
import { startImageDrag } from '../ui/DragImage.tsx';
import { Seg, Slider } from '../ui/controls.tsx';
import { DotBreath } from './DotBreath.tsx';
import { NodeShell } from './NodeShell.tsx';

const refOf = (h: ToolItem): ImageRef => ({ url: h.urls[h.sel] ?? h.urls[0], iw: h.w, ih: h.h });

function ToolNodeView({ id, data }: NodeProps<TN>) {
  const rt = useStore(s => s.runtime[id]);
  const account = useStore(s => s.account);
  // 接进来的图（只取用得到的几个字段，避免每次都重渲染）
  const srcKey = useStore(s => { const e = s.edges.find(x => x.target === id && x.data?.slot === 'src'); return e ? `${e.source}|${JSON.stringify(toolInput(id))}` : ''; });
  const pic = srcKey ? toolInput(id) : null;
  const item = data.history[data.cur];
  const status = rt?.status ?? 'idle';
  const busy = status === 'running';
  const c = pic ? toolCost(data.tool, pic.iw, pic.ih, account) : null;
  const set = (patch: Partial<TN['data']>, undoable = true) => updateData(id, patch, undoable);

  // 完成一张时闪一下
  const [flash, setFlash] = useState(false);
  useEffect(() => { if (!rt?.flash) return; setFlash(false); requestAnimationFrame(() => setFlash(true)); const t = setTimeout(() => setFlash(false), 650); return () => clearTimeout(t); }, [rt?.flash]);

  let stat = item ? `DONE · ${data.history.length} 次` : pic ? 'READY' : '未接图';
  if (busy) stat = rt?.label ?? '处理中';
  if (status === 'error') stat = '失败';
  const costText = !pic ? '' : c === null ? '图太大' : data.tool === 'pixel-snap' ? '本机处理 · 免费' : c.free ? 'OPUS 免费' : `${c.price} ANLAS`;
  const show = item ? refOf(item) : pic;
  const tool = data.tool;

  return (
    <NodeShell id={id} kind="tool" title={data.title} width={data.w ?? KINDS.tool.w} status={stat}
      className={`is-${status === 'idle' ? 'idle' : status === 'error' ? 'err' : status}`}
      tools={[{ label: busy ? '处理中' : '运行', run: true, onClick: () => runTool(id) }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}
      after={data.history.length > 1 ? (
        <div className="hist nodrag nowheel">
          {data.history.slice(0, 30).map((h, i) => (
            <button key={`${h.at}${i}`} type="button" className={i === data.cur ? 'is-cur' : ''} title={toolName(h.tool)}
              onPointerDown={e => startImageDrag(e, refOf(h), () => updateData(id, { cur: i }))}
              onClick={e => { if (e.detail === 0) updateData(id, { cur: i }); }}>
              <img src={thumb(refOf(h).url, 128)} alt={`第 ${i + 1} 次`} loading="lazy" draggable={false} style={{ aspectRatio: `${h.w} / ${h.h}` }} />
            </button>
          ))}
        </div>
      ) : undefined}>
      <div className={`media tool-media ${flash ? 'is-flash' : ''} ${item ? '' : 'is-input'}`} style={{ aspectRatio: show ? `${show.iw} / ${show.ih}` : '4 / 3' }}>
        {show ? <img src={show.url} alt="" draggable={false} /> : <><DotBreath /><div className="empty"><b>TOOLS</b><span>从图片或生图节点拉线过来</span></div></>}
        {!item && pic && <div className="empty is-over"><b>READY</b><span>{toolName(tool)}</span></div>}
        {busy && <div className="tool-busy" aria-hidden="true"><i /><i /><i /></div>}
        {status === 'error' && rt?.error && <div className="err nodrag"><b>没有处理成功</b>{rt.error}</div>}
        {item && item.urls.length > 1 && (
          <div className="variants nodrag">
            <Seg label="去背景结果" value={item.sel} options={item.urls.map((_, i) => ({ v: i, l: BG_VARIANTS[i] ?? `${i + 1}` }))}
              onChange={v => updateData(id, { history: data.history.map((h, i) => (i === data.cur ? { ...h, sel: v } : h)) })} />
          </div>
        )}
        {item && !busy && (
          <div className="acts nodrag">
            <button type="button" onClick={() => copyImage(refOf(item).url)}>复制图片</button>
            <button type="button" title="按住拖到空白处，或者点一下放到右边" onPointerDown={e => startImageDrag(e, refOf(item), () => placeImageBeside(id, refOf(item)))}
              onClick={e => { if (e.detail === 0) placeImageBeside(id, refOf(item)); }}>拖到画布</button>
            <button type="button" onClick={() => api.reveal(refOf(item).url).catch(e => toast((e as Error).message, { err: true }))}>打开文件夹</button>
          </div>
        )}
      </div>
      <div className="pad">
        <div className="tchips nodrag" role="group" aria-label="工具">
          {TOOLS.map(t => <button key={t.id} type="button" aria-pressed={tool === t.id} title={t.desc} onClick={() => tool !== t.id && set({ tool: t.id as ToolId })}>{t.name}</button>)}
        </div>
        <span className="note">{TOOLS.find(t => t.id === tool)?.desc}</span>
        {tool === 'declutter' && <label className="check nodrag"><input type="checkbox" checked={data.keepBubbles} onChange={e => set({ keepBubbles: e.target.checked })} /><span>保留文字气泡</span></label>}
        {tool === 'emotion' && (
          <div className="field">
            <div className="field-label"><span>表情</span></div>
            <select className="dd nodrag" value={data.emotion} aria-label="表情" onChange={e => set({ emotion: e.target.value })}>
              {EMOTIONS.map(e => <option key={e.id} value={e.id}>{e.name}（{e.id}）</option>)}
            </select>
            <span className="note">只适用于动漫风；最好从表情平静的图开始</span>
          </div>
        )}
        {(tool === 'colorize' || tool === 'emotion') && <>
          <PromptEditor className="ta-box" label={tool === 'emotion' ? '补充提示词' : '上色提示词'} value={data.prompt}
            placeholder={tool === 'emotion' ? '可选，比如 blush, tears' : '可选，比如 red hair, blue eyes, sunset'}
            onChange={v => updateData(id, { prompt: v })} onCommit={b => recordEdit(id, 'prompt', b)} onEnter={() => { runTool(id); return true; }} />
          <div className="field">
            <div className="field-label"><span>{tool === 'emotion' ? '表情强度' : 'Defry'}</span><span className="v">{tool === 'emotion' ? EMOTION_LEVELS[data.defry] : `${data.defry} · ${['改动最大', '', '', '', '', '最接近原图'][data.defry] || '中间'}`}</span></div>
            <Slider label="Defry" min={0} max={5} step={1} value={data.defry} onCommit={pushUndo} onChange={v => set({ defry: v }, false)} />
          </div>
        </>}
        {tool === 'pixel-snap' && (
          <div className="field">
            <div className="field-label"><span>调色板</span><span className="v">{data.snapPalette === 'custom' ? `${data.snapColors} 色` : ''}</span></div>
            <Seg label="调色板" value={data.snapPalette} options={[{ v: 'off' as const, l: '不整理' }, { v: 'auto' as const, l: '自动' }, { v: 'custom' as const, l: '指定' }]} onChange={v => set({ snapPalette: v })} />
            {data.snapPalette === 'custom' && <Slider label="颜色数" min={2} max={256} step={1} value={data.snapColors} onCommit={pushUndo} onChange={v => set({ snapColors: v }, false)} />}
            <label className="check nodrag"><input type="checkbox" checked={data.snapAvoid} onChange={e => set({ snapAvoid: e.target.checked })} /><span>避免过度细化（始终用检测到的像素大小）</span></label>
            <label className="check nodrag"><input type="checkbox" checked={data.snapUpscale} onChange={e => set({ snapUpscale: e.target.checked })} /><span>放大回接近原图的尺寸</span></label>
          </div>
        )}
        {tool === 'bg-removal' && <span className="note">去背景比较贵：按尺寸算的价格乘 3 再加 5，Opus 也不免费</span>}
        <div className="foot">
          <span className={c === null && pic ? 'is-err' : ''}>{item?.note ?? (pic ? `输入 ${pic.iw}×${pic.ih}` : '还没有图')}</span>
          <button type="button" className="btn is-primary tool-go nodrag" disabled={busy || !pic} onClick={() => runTool(id)}>{busy ? '处理中…' : `运行${costText ? ` · ${costText}` : ''}`}</button>
        </div>
      </div>
    </NodeShell>
  );
}
export const ToolNode = memo(ToolNodeView);
