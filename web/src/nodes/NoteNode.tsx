import { memo, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { KINDS, type NoteNode as NN } from '../graph.ts';
import { recordEdit, updateData } from '../store.ts';
import { dupNodes, removeNodes } from '../actions.ts';
import { NodeShell } from './NodeShell.tsx';

const TONES = ['plain', 'yellow', 'red', 'blue'] as const;
const TONE_NAME: Record<(typeof TONES)[number], string> = { plain: '白', yellow: '黄', red: '红', blue: '蓝' };

/** 便签：写备注，不参与生成 */
function NoteNodeView({ id, data }: NodeProps<NN>) {
  const before = useRef(data.text);
  const tone = data.tone ?? 'plain';
  const next = TONES[(TONES.indexOf(tone) + 1) % TONES.length];
  return (
    <NodeShell id={id} kind="note" title={data.title} width={data.w ?? KINDS.note.w}
      tools={[{ label: `换成${TONE_NAME[next]}色`, onClick: () => updateData(id, { tone: next }, true) }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <div className={`note-body is-${tone}`}>
        <textarea className="ta-resize note-ta nodrag nowheel" style={{ height: data.h ?? 120 }} value={data.text} placeholder="写点备注：这组设置是干嘛的、下一步想试什么…"
          aria-label="便签内容" spellCheck={false}
          onFocus={() => { before.current = data.text; }}
          onChange={e => updateData(id, { text: e.target.value })}
          onBlur={() => recordEdit(id, 'text', before.current)}
          onKeyDown={e => { if (e.key === 'Escape') (e.target as HTMLTextAreaElement).blur(); e.stopPropagation(); }} />
      </div>
    </NodeShell>
  );
}
export const NoteNode = memo(NoteNodeView);
