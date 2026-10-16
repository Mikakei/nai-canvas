import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { NegNode as NN, PromptNode as PN } from '../graph.ts';
import { KINDS } from '../graph.ts';
import { modelFor, recordEdit, toast, undo, updateData } from '../store.ts';
import { randomPrompt } from '@nai/shared';
import { dupNodes, removeNodes } from '../actions.ts';
import { PromptEditor } from '../editor/PromptEditor.tsx';
import { TokenCount } from '../editor/TokenCount.tsx';
import { DictButton } from '../ui/PromptDict.tsx';
import { NodeShell } from './NodeShell.tsx';

function PromptNodeView({ id, data }: NodeProps<PN>) {
  return (
    <NodeShell id={id} kind="prompt" title={data.title} width={data.w ?? KINDS.prompt.w}
      tools={[{ label: '随机', onClick: () => { updateData(id, { text: randomPrompt() }, true); toast('已换成随机提示词，再点一次重抽', { action: { label: '撤销', fn: undo } }); } }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <div className="pad">
        <PromptEditor className="ta-resize pe-body" style={{ height: data.h ?? 112 }} label="提示词" placeholder="写一段提示词，输入 @ 插入片段…"
          value={data.text} model={modelFor(id)} onChange={v => updateData(id, { text: v })} onCommit={b => recordEdit(id, 'text', b)} />
        <div className="foot"><TokenCount nodeId={id} text={data.text} />
          <DictButton kind="pos" value={data.text} onChange={t => updateData(id, { text: t }, true)} editor={() => document.querySelector(`.react-flow__node[data-id="${id}"] .cm-editor`)} /></div>
      </div>
    </NodeShell>
  );
}
export const PromptNode = memo(PromptNodeView);

function NegativeNodeView({ id, data }: NodeProps<NN>) {
  return (
    <NodeShell id={id} kind="negative" title={data.title} width={data.w ?? KINDS.negative.w}
      tools={[{ label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <div className="pad">
        <PromptEditor className="ta-resize pe-body" style={{ height: data.h ?? 88 }} label="负面提示词" placeholder="不想出现的内容，会接在 UC 预设后面。比如 bad hands, text, watermark；输入 @ 插入片段…"
          value={data.text} model={modelFor(id)} onChange={v => updateData(id, { text: v })} onCommit={b => recordEdit(id, 'text', b)} />
        <div className="foot"><TokenCount nodeId={id} text={data.text} />
          <DictButton kind="neg" value={data.text} onChange={t => updateData(id, { text: t }, true)} editor={() => document.querySelector(`.react-flow__node[data-id="${id}"] .cm-editor`)} /></div>
      </div>
    </NodeShell>
  );
}
export const NegativeNode = memo(NegativeNodeView);
