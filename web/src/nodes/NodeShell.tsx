import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Handle, Position, useUpdateNodeInternals } from '@xyflow/react';
import { KINDS, slotFor, type Kind } from '../graph.ts';
import { layoutHold, pushAway } from '../layout.ts';
import { born, flow, node, pushUndo, updateData, useStore } from '../store.ts';
import { Glyph, Icons } from '../ui/controls.tsx';

interface Props {
  id: string;
  kind: Kind;
  title: string;
  status?: ReactNode;
  className?: string;
  tools: { label: string; run?: boolean; onClick: () => void }[];
  children: ReactNode;
  after?: ReactNode;
  width: number;
  /** 贴在卡片右边的第二张卡片（生图节点的参数）：和主卡片是同一个节点，一起拖动；输出口挪到它的右边 */
  side?: { title: string; en?: string; content: ReactNode; width: number; onClose?: () => void };
}
/** 主卡片和旁边那张卡片之间的空隙 */
const SIDE_GAP = 18;

/** 所有节点共用的外壳：上方标题和状态、悬停工具条、左右 + 手柄、右下角调整大小 */
export function NodeShell({ id, kind, title, status, className = '', tools, children, after, width, side }: Props) {
  const info = KINDS[kind];
  const [isBorn] = useState(() => born.has(id));
  useEffect(() => { if (isBorn) { const t = setTimeout(() => born.delete(id), 500); return () => clearTimeout(t); } }, [id, isBorn]);

  const inOn = useStore(s => s.edges.some(e => e.target === id));
  const outOn = useStore(s => s.edges.some(e => e.source === id));
  const solo = useStore(s => s.nodes.filter(n => n.selected).length === 1);
  const hlSource = useStore(s => s.hl && s.edges.find(e => e.id === s.hl)?.source === id);
  const isTarget = useStore(s => s.target === id);
  // 拉线时：能接的节点亮出对应手柄，接不上的变暗
  const wire = useStore(s => {
    if (!s.wiring || s.wiring.id === id) return '';
    const from = s.nodes.find(n => n.id === s.wiring!.id), me = s.nodes.find(n => n.id === id);
    if (!from || !me) return '';
    const ok = s.wiring.dir === 'source' ? !!slotFor(from, me) : !!slotFor(me, from);
    return ok ? (s.wiring.dir === 'source' ? 'is-can' : 'is-can-out') : 'is-dim';
  });

  const [sizing, setSizing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  // 内容变多、节点变高（选了画师串、出了第一张图、展开了设置）时，把压到的邻居推开。
  // 刚出现的一会儿不算（字体加载、图片尺寸还在定），拖动、调大小的时候也不算
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const t0 = performance.now();
    let last = el.offsetHeight, lastW = el.offsetWidth, timer = 0;
    const ro = new ResizeObserver(() => {
      const h = el.offsetHeight, w = el.offsetWidth, grew = h > last + 8 || w > lastW + 8;
      last = h; lastW = w;
      if (!grew || performance.now() - t0 < 1500 || Date.now() < layoutHold.until || useStore.getState().busy) return;
      clearTimeout(timer);
      timer = window.setTimeout(() => pushAway(id), 160);
    });
    ro.observe(el);
    return () => { ro.disconnect(); clearTimeout(timer); };
  }, [id]);
  const startResize = (e: React.PointerEvent) => {
    e.stopPropagation(); e.preventDefault();
    const n = node(id); if (!n) return;
    const zoom = flow.rf?.getZoom() ?? 1, sx = e.clientX, sy = e.clientY;
    const w0 = rootRef.current?.querySelector<HTMLElement>(':scope > .cw')?.offsetWidth ?? width;
    // 文字节点拖的是文字框的高度；图库、角色字典这类大节点拖的是整块内容的高度
    const ta = info.textResize || info.boxResize ? rootRef.current?.querySelector<HTMLElement>(info.boxResize ? '.box-resize' : '.ta-resize') : null;
    const h0 = ta?.offsetHeight ?? 0;
    let moved = false;
    setSizing(true); useStore.setState({ busy: true });
    const move = (ev: PointerEvent) => {
      if (!moved) { if (Math.hypot(ev.clientX - sx, ev.clientY - sy) < 3) return; moved = true; pushUndo(); }
      const patch: Record<string, number> = { w: Math.round(Math.min(info.max, Math.max(info.min, w0 + (ev.clientX - sx) / zoom))) };
      if (ta) patch.h = info.boxResize ? Math.round(Math.min(3000, Math.max(300, h0 + (ev.clientY - sy) / zoom))) : Math.round(Math.min(600, Math.max(48, h0 + (ev.clientY - sy) / zoom)));
      updateData(id, patch);
    };
    const up = () => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      setSizing(false); useStore.setState({ busy: false });
      if (moved) requestAnimationFrame(() => pushAway(id));
    };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up);
  };
  const resetSize = () => { updateData(id, { w: undefined, h: undefined }, true); };
  // 旁边的卡片打开、收起时输出口换了位置，让画布重新量一下手柄，连线才接得准
  const updateInternals = useUpdateNodeInternals();
  useEffect(() => { const t = requestAnimationFrame(() => updateInternals(id)); return () => cancelAnimationFrame(t); }, [!!side, id, updateInternals]); // eslint-disable-line react-hooks/exhaustive-deps
  const outHandle = info.out !== 'none' && <Handle type="source" position={Position.Right} id="out" className={`hd is-out ${outOn ? 'is-on' : ''}`} title="输出：拖出连线"><i>{Icons.plus}</i></Handle>;

  return (
    <div ref={rootRef} className={`node ${side ? 'has-side' : ''} ${isBorn ? 'is-born' : ''} ${solo ? 'is-solo' : ''} ${hlSource ? 'is-hl' : ''} ${isTarget ? 'is-target' : ''} ${sizing ? 'is-sizing' : ''} ${wire} ${className}`}
      style={{ width: width + (side ? SIDE_GAP + side.width : 0), ['--main-w' as string]: `${width}px`, ['--side-w' as string]: `${side?.width ?? 0}px` }}>
      <div className="nhead"><Glyph t={info.out} /><span className="ttl">{title}</span><span className="en">{info.en}</span>{status !== undefined && <span className="nstat">{status}</span>}</div>
      <div className="ntool nodrag">
        {tools.map(t => <button key={t.label} type="button" className={t.run ? 'run' : ''} onClick={t.onClick}>{t.run && Icons.play}{t.label}</button>)}
      </div>
      <div className="cw">
        <div className="card">{children}</div>
        {Object.keys(info.accept).length > 0 && (
          <Handle type="target" position={Position.Left} id="in" className={`hd is-in ${inOn ? 'is-on' : ''}`} title="输入：可以从这里拉线，也可以把别的节点连过来"><i>{Icons.plus}</i></Handle>
        )}
        {!side && outHandle}
        <div className="rz nodrag" title="拖动调整大小，双击恢复默认" onPointerDown={startResize} onDoubleClick={resetSize}>
          <svg viewBox="0 0 30 30" aria-hidden="true"><path d="M25.3 8.6A29 29 0 0 1 8.6 25.3" /></svg>
        </div>
      </div>
      {side && (
        <div className="nside">
          <div className="nhead nside-head"><span className="ttl">{side.title}</span>{side.en && <span className="en">{side.en}</span>}
            {side.onClose && <button type="button" className="nside-x nodrag" onClick={side.onClose}>收起</button>}</div>
          <div className="card nside-card">{side.content}</div>
          {outHandle}
        </div>
      )}
      {after}
    </div>
  );
}
