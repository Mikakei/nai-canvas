import { memo, useEffect, useRef, useState } from 'react';
import { EdgeLabelRenderer, type ConnectionLineComponentProps, type EdgeProps } from '@xyflow/react';
import type { AppEdge } from '../graph.ts';
import { born, disconnect, toast, undo, useStore } from '../store.ts';

/** 断开一根线（可以撤销） */
function cut(id: string) {
  disconnect(id);
  toast('已断开连线', { action: { label: '撤销', fn: undo } });
}

const curve = (sx: number, sy: number, tx: number, ty: number) => {
  const dx = Math.max(60, Math.abs(tx - sx) * 0.5);
  return `M${sx} ${sy}C${sx + dx} ${sy} ${tx - dx} ${ty} ${tx} ${ty}`;
};

/**
 * 点线连线：新建时从起点"画"过去；目标节点生成中时变红并流动。
 * 鼠标移到线上（或点一下选中）时，线中间出现 × ，点它就断开
 */
function DotEdgeView({ id, target, sourceX, sourceY, targetX, targetY, selected }: EdgeProps<AppEdge>) {
  const [isBorn, setBorn] = useState(() => born.has(id));
  useEffect(() => { if (!isBorn) return; const t = setTimeout(() => { born.delete(id); setBorn(false); }, 560); return () => clearTimeout(t); }, [id, isBorn]);
  const flowing = useStore(s => s.runtime[target]?.status === 'running');
  const hl = useStore(s => s.hl === id);
  const busy = useStore(s => s.busy || !!s.wiring);
  const [hover, setHover] = useState(false);
  const leave = useRef(0);
  useEffect(() => () => clearTimeout(leave.current), []);
  // 从线移到 × 上要经过一点空隙：离开后稍等一下再藏
  const enter = () => { clearTimeout(leave.current); setHover(true); };
  const exit = () => { clearTimeout(leave.current); leave.current = window.setTimeout(() => setHover(false), 200); };
  const d = curve(sourceX, sourceY, targetX, targetY);
  const mx = (sourceX + targetX) / 2, my = (sourceY + targetY) / 2;
  return (
    <g>
      <path className="wire-hit react-flow__edge-interaction" d={d} onPointerEnter={enter} onPointerLeave={exit} />
      {isBorn && <mask id={`mk-${id}`} maskUnits="userSpaceOnUse" x={-1e5} y={-1e5} width={2e5} height={2e5}><path className="wire-mask" d={d} pathLength={1} /></mask>}
      <path className={`wire ${selected ? 'is-sel' : ''} ${hl || hover ? 'is-hl' : ''} ${flowing ? 'is-flow' : ''}`} d={d} mask={isBorn ? `url(#mk-${id})` : undefined} />
      {(hover || selected) && !busy && (
        <EdgeLabelRenderer>
          <button type="button" className="wire-cut nodrag nopan" aria-label="断开这根线" title="断开（选中线以后按 Delete 也行）"
            style={{ transform: `translate(-50%, -50%) translate(${mx}px, ${my}px)` }}
            onPointerEnter={enter} onPointerLeave={exit} onClick={() => cut(id)}>
            <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
          </button>
        </EdgeLabelRenderer>
      )}
    </g>
  );
}
export const DotEdge = memo(DotEdgeView);

export function DotConnectionLine({ fromX, fromY, toX, toY, fromHandle }: ConnectionLineComponentProps) {
  const fromSource = fromHandle?.type !== 'target';
  const d = fromSource ? curve(fromX, fromY, toX, toY) : curve(toX, toY, fromX, fromY);
  return <path className="wire is-temp" d={d} style={fromSource ? undefined : { animationDirection: 'reverse' }} />;
}
