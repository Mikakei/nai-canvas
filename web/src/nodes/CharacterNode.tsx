import { memo, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { MODELS, randomCharacter, snapToGrid } from '@nai/shared';
import { EditorView } from '@codemirror/view';
import { KINDS, isChar, isGen, type CharNode as CN } from '../graph.ts';
import { modelFor, pushUndo, recordEdit, toast, undo, updateData, useStore } from '../store.ts';
import { PromptEditor } from '../editor/PromptEditor.tsx';
import { TokenCount } from '../editor/TokenCount.tsx';
import { dupNodes, removeNodes } from '../actions.ts';
import { Switch } from '../ui/controls.tsx';
import { NodeShell } from './NodeShell.tsx';

const COLS = 'ABCDE';
/** 网格坐标 → "B3" 这样的格子名 */
export const cellName = (x: number, y: number) => `${COLS[Math.round((snapToGrid(x) - 0.1) / 0.2)]}${Math.round((snapToGrid(y) - 0.1) / 0.2) + 1}`;
/** 把光标放到角色提示词末尾，接着输入 */
function focusEnd(id: string) {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .ta-resize .cm-editor`);
  const view = el && EditorView.findFromDOM(el);
  if (!view) return;
  view.focus();
  view.dispatch({ selection: { anchor: view.state.doc.length } });
}
const START = [{ l: '女', t: 'girl, ' }, { l: '男', t: 'boy, ' }, { l: '其他', t: '' }];

function CharacterNodeView({ id, data }: NodeProps<CN>) {
  // 这个角色接到了哪些生图节点：决定位置是否生效、是否对齐网格
  const targets = useStore(useShallow(s => s.edges.filter(e => e.source === id).map(e => s.nodes.find(n => n.id === e.target)).filter(isGen)));
  // 同一批生图节点上的其他角色，画成空心点方便避开
  const others = useStore(useShallow(s => {
    const gens = new Set(s.edges.filter(e => e.source === id).map(e => e.target));
    const ids = new Set(s.edges.filter(e => gens.has(e.target) && e.data?.slot === 'chars' && e.source !== id).map(e => e.source));
    return s.nodes.filter(n => ids.has(n.id)).filter(isChar).filter(n => n.data.enabled).map(n => `${n.data.title}|${n.data.x}|${n.data.y}`);
  }));
  const ai = targets.length > 0 && targets.every(g => g.data.params.charPos === 'ai');
  const grid = targets.some(g => MODELS[g.data.params.model].family !== 'v5');
  const pos = grid ? cellName(data.x, data.y) : `${Math.round(data.x * 100)},${Math.round(data.y * 100)}`;
  const pad = useRef<HTMLDivElement>(null);

  const place = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    pushUndo();
    if (ai) {
      // 一动位置就说明想自己指定：把接着的生图节点都改成"指定位置"
      for (const g of targets) updateData(g.id, { params: { ...g.data.params, charPos: 'custom' } });
      toast('已把接着的生图节点改为"指定角色位置"');
    }
    const r = pad.current!.getBoundingClientRect();
    const set = (cx: number, cy: number) => {
      const x = Math.min(1, Math.max(0, (cx - r.left) / r.width)), y = Math.min(1, Math.max(0, (cy - r.top) / r.height));
      updateData(id, grid ? { x: snapToGrid(x), y: snapToGrid(y) } : { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 });
    };
    set(e.clientX, e.clientY);
    const move = (ev: PointerEvent) => set(ev.clientX, ev.clientY);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <NodeShell id={id} kind="character" title={data.title} width={data.w ?? KINDS.character.w}
      status={!data.enabled ? '已停用' : targets.length === 0 ? '未接入' : ai ? '位置 · AI 决定' : `位置 · ${pos}`}
      className={data.enabled ? '' : 'is-off'}
      tools={[{ label: '随机', onClick: () => { updateData(id, { text: randomCharacter() }, true); toast('已换成随机角色，再点一次重抽', { action: { label: '撤销', fn: undo } }); } }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <div className="pad">
        {!data.text && (
          <div className="starts nodrag">
            <span className="note">新角色：</span>
            {START.map(s => <button key={s.l} type="button" onClick={() => { updateData(id, { text: s.t }, true); setTimeout(() => focusEnd(id), 0); }}>{s.l}</button>)}
          </div>
        )}
        <PromptEditor className="ta-resize pe-body" style={{ height: data.h ?? 72 }} label="角色提示词" character model={modelFor(id)}
          placeholder="描述这个角色：外貌、服装、动作。动作对象可以用 source# target# mutual#"
          value={data.text} onChange={v => updateData(id, { text: v })} onCommit={b => recordEdit(id, 'text', b)} />
        {data.showUc && (
          <PromptEditor className="ta-box" label="角色负面提示词" model={modelFor(id)} placeholder="这个角色不想出现的内容"
            value={data.uc} onChange={v => updateData(id, { uc: v })} onCommit={b => recordEdit(id, 'uc', b)} />
        )}
        <div className="crow">
          <div className={`cpad nodrag ${ai ? 'is-ai' : ''} ${grid ? 'is-grid' : ''}`} ref={pad} onPointerDown={place} title={ai ? '位置由 AI 决定；点一下改为自己指定' : '拖动摆放角色位置'}>
            {Array.from({ length: 25 }, (_, i) => <i key={i} style={{ left: `${10 + 20 * (i % 5)}%`, top: `${10 + 20 * Math.floor(i / 5)}%` }} />)}
            {others.map((o, i) => { const [t, x, y] = o.split('|'); return <b key={`${i}|${t}`} className="other" title={t} style={{ left: `${+x * 100}%`, top: `${+y * 100}%` }} />; })}
            <b className="me" style={{ left: `${data.x * 100}%`, top: `${data.y * 100}%` }} />
            {ai && <span className="cpad-ai">AI 决定</span>}
          </div>
          <div className="cside">
            <span className="lab">位置</span>
            <span className="num">{ai ? 'AI' : pos}</span>
            <span className="note">{grid ? 'V4.5 只能放在 5×5 格子上' : 'V5 可以自由摆放'}</span>
          </div>
        </div>
        <div className="foot">
          <TokenCount nodeId={id} text={data.text} />
          <button type="button" className="linkish nodrag" onClick={() => updateData(id, { showUc: !data.showUc })}>{data.showUc ? '收起负面提示词' : `负面提示词${data.uc ? ' · 已填' : ''}`}</button>
          <span className="row" style={{ gap: 8, fontSize: 'calc(11.5px * var(--fs))' }}>启用<Switch label="启用角色" on={data.enabled} onChange={v => updateData(id, { enabled: v }, true)} /></span>
        </div>
      </div>
    </NodeShell>
  );
}
export const CharacterNode = memo(CharacterNodeView);
