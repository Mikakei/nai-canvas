import { memo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { KINDS, type SectionNode as SN } from '../graph.ts';
import { flow, node, pushUndo, updateData, useStore } from '../store.ts';
import { membersOf, runSection } from '../sections.ts';
import { Icons } from '../ui/controls.tsx';

/** 分区：垫在节点下面的大框。只有标题栏和右下角能点，框里的空白处照常能框选、平移 */
function SectionNodeView({ id, data, selected }: NodeProps<SN>) {
  const count = useStore(s => membersOf(id, s.nodes).length);
  const runnable = useStore(s => membersOf(id, s.nodes).filter(n => KINDS[n.type].run).length);
  const label = useStore(s => s.runtime[id]?.label);
  const [editing, setEditing] = useState(false);

  const resize = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const n = node(id); if (!n) return;
    const zoom = flow.rf?.getZoom() ?? 1, sx = e.clientX, sy = e.clientY, w0 = data.w, h0 = data.h;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; moved = true; pushUndo(); }
      updateData(id, { w: Math.round(Math.max(240, w0 + (ev.clientX - sx) / zoom)), h: Math.round(Math.max(160, h0 + (ev.clientY - sy) / zoom)) });
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };

  return (
    <div className={`section ${selected ? 'is-sel' : ''} ${label ? 'is-running' : ''}`} style={{ width: data.w, height: data.h }}>
      <div className="sec-head" title="拖动整体移动（框里的节点一起走）；双击改名">
        <i className="sec-dot" />
        {editing ? (
          <input className="input sec-name nodrag" autoFocus defaultValue={data.title} aria-label="分区名称"
            onBlur={e => { const v = e.target.value.trim(); if (v && v !== data.title) updateData(id, { title: v }, true); setEditing(false); }}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = data.title; setEditing(false); } e.stopPropagation(); }} />
        ) : <span className="sec-name" onDoubleClick={() => setEditing(true)}>{data.title}</span>}
        <span className="sec-n">{label ?? `${count} 个节点`}</span>
        <button type="button" className="sec-run nodrag" disabled={!runnable || !!label} title={runnable ? `依次运行里面的 ${runnable} 个生图和工具节点` : '里面没有可以运行的节点'} onClick={() => runSection(id)}>{Icons.play}运行</button>
      </div>
      <div className="sec-rz nodrag" title="拖动调整大小" onPointerDown={resize} />
    </div>
  );
}
export const SectionNode = memo(SectionNodeView);
