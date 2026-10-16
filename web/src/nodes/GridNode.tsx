import { memo, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { GRID_PARAMS, type GridParam } from '@nai/shared';
import { KINDS, type GridCell, type GridNode as GN } from '../graph.ts';
import { thumb } from '../api.ts';
import { recordEdit, toast, updateData, useStore } from '../store.ts';
import { dupNodes, placeImageBeside, removeNodes } from '../actions.ts';
import { applyCell, exportGrid, gridBusy, gridPlan, runGrid } from '../gridRun.ts';
import { startImageDrag } from '../ui/DragImage.tsx';
import { NodeShell } from './NodeShell.tsx';

function Axis({ id, axis, data }: { id: string; axis: 'x' | 'y'; data: GN['data'] }) {
  const a = data[axis], before = useRef(a);
  const hint = GRID_PARAMS.find(p => p.id === a.param)?.hint ?? '';
  return (
    <div className="gaxis">
      <b>{axis.toUpperCase()}</b>
      <select className="dd nodrag" value={a.param} aria-label={`${axis.toUpperCase()} 轴参数`} onChange={e => updateData(id, { [axis]: { ...a, param: e.target.value as GridParam } }, true)}>
        {GRID_PARAMS.filter(p => axis === 'y' || p.id !== 'none').map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {a.param !== 'none' && (
        <input className="input nodrag" value={a.values} placeholder={hint} title={hint} aria-label={`${axis.toUpperCase()} 轴的值`}
          onFocus={() => { before.current = a; }}
          onChange={e => updateData(id, { [axis]: { ...a, values: e.target.value } })}
          onBlur={() => recordEdit(id, axis, before.current)}
          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); e.stopPropagation(); }} />
      )}
    </div>
  );
}

function GridNodeView({ id, data }: NodeProps<GN>) {
  const rt = useStore(s => s.runtime[id]);
  // 计划随连线、生图节点设置、余额变化
  const planKey = useStore(useShallow(s => { void s.nodes; void s.edges; void s.account; const p = gridPlan(id); return p ? [p.error ?? '', p.count, p.total, p.src?.data.title ?? ''] : []; }));
  const [error, count, total, srcTitle] = planKey as [string, number, number, string];
  const busy = gridBusy(id) || rt?.status === 'running' || rt?.status === 'queued';
  const done = data.cells.filter(c => c.url || c.error).length;
  let stat = data.cells.length ? `${done}/${data.cells.length} 格` : 'READY';
  if (busy) stat = `生成中 ${Math.min(done + 1, data.cells.length)}/${data.cells.length}${rt?.status === 'running' && rt.steps ? ` · ${rt.step ?? 0}/${rt.steps}` : ''}`;
  const cols = Math.max(1, data.xs.length), hasY = data.ys.length > 1 || !!data.ys[0];
  const cellOf = (x: number, y: number) => data.cells.find(c => c.x === x && c.y === y);
  const exportAll = async () => { const r = await exportGrid(id); if (r) placeImageBeside(id, { url: r.url, iw: r.w, ih: r.h }, `已导出整张网格（${r.w}×${r.h}），存进了 outputs`); };

  const cellView = (c: GridCell | undefined, x: number, y: number) => {
    const running = busy && !c?.url && !c?.error && data.cells.findIndex(m => !m.url && !m.error) === data.cells.findIndex(m => m.x === x && m.y === y);
    return (
      <div key={`${x},${y}`} className={`gcell ${running ? 'is-run' : ''}`} style={{ aspectRatio: c?.w && c?.h ? `${c.w} / ${c.h}` : '2 / 3' }}>
        {c?.url ? <>
          <img src={thumb(c.url, 384)} alt="" loading="lazy" draggable={false} onPointerDown={e => startImageDrag(e, { url: c.url!, iw: c.w ?? 512, ih: c.h ?? 768, seed: c.seed })} title="拖到空白处变成图片节点" />
          <button type="button" className="guse nodrag" onClick={() => applyCell(id, c)}>用这组参数</button>
        </> : c?.error ? <span className="gerr">{c.error}</span> : <span className="gwait">{running ? '生成中' : ''}</span>}
      </div>
    );
  };

  return (
    <NodeShell id={id} kind="grid" title={data.title} width={data.w ?? KINDS.grid.w} status={stat} className={busy ? 'is-running' : ''}
      tools={[{ label: busy ? '取消' : '运行', run: true, onClick: () => runGrid(id) }, ...(data.cells.some(c => c.url) ? [{ label: '导出整张', onClick: exportAll }] : []), { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <div className="pad">
        <div className="gsrc">{srcTitle ? <>借用「{srcTitle}」的提示词和全部设置</> : '从一个生图节点拉线到这里'}</div>
        <Axis id={id} axis="x" data={data} />
        <Axis id={id} axis="y" data={data} />
        {error ? <div className="warn-line" style={{ padding: 0 }}>{error}</div>
          : <span className="note">{count} 格 · 约 {total} Anlas · 所有格子用同一个种子{data.seed !== undefined && data.cells.length ? `（上次 ${data.seed}）` : ''}</span>}
      </div>
      {data.cells.length > 0 && (
        <div className="gview nodrag nowheel" style={{ gridTemplateColumns: `${hasY ? 'minmax(48px, auto) ' : ''}repeat(${cols}, minmax(0, 1fr))` }}>
          {hasY && <span className="gcorner">{data.axisNames?.[1] ?? ''} ╲ {data.axisNames?.[0] ?? ''}</span>}
          {data.xs.map((l, i) => <span key={`x${i}`} className="glabel is-x" title={l}>{l}</span>)}
          {data.ys.map((yl, y) => [
            hasY ? <span key={`y${y}`} className="glabel is-y" title={yl}>{yl}</span> : null,
            ...data.xs.map((_, x) => cellView(cellOf(x, y), x, y)),
          ])}
        </div>
      )}
      <div className="foot gfoot">
        <span>{data.srcTitle && data.cells.length ? `上次来自「${data.srcTitle}」` : ''}</span>
        <button type="button" className="btn is-primary tool-go nodrag" disabled={!!error && !busy} onClick={() => { if (!busy && error) { toast(error, { err: true }); return; } runGrid(id); }}>{busy ? '取消' : `运行 ${count || ''} 格${total ? ` · ${total} ANLAS` : ''}`}</button>
      </div>
    </NodeShell>
  );
}
export const GridNode = memo(GridNodeView);
