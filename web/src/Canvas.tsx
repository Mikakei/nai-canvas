import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background, BackgroundVariant, ReactFlow, SelectionMode, ViewportPortal, useOnViewportChange, useReactFlow,
  type Connection, type FinalConnectionState, type NodeChange, type OnConnectStartParams,
} from '@xyflow/react';
import { isSection, slotFor, reaches, type AppEdge, type AppNode } from './graph.ts';
import { membersOf } from './sections.ts';
import { freeSpot, ghostsFor, glide, snap } from './layout.ts';
import { connect, flow, node, onNodesChange as applyChanges, pushUndo, scheduleSave, useStore } from './store.ts';
import { altCopy, ensureVisible } from './actions.ts';
import { NegativeNode, PromptNode } from './nodes/PromptNode.tsx';
import { GenerateNode } from './nodes/GenerateNode.tsx';
import { ImageNode } from './nodes/ImageNode.tsx';
import { CharacterNode } from './nodes/CharacterNode.tsx';
import { VibeNode } from './nodes/VibeNode.tsx';
import { RefNode } from './nodes/RefNode.tsx';
import { ToolNode } from './nodes/ToolNode.tsx';
import { SectionNode } from './nodes/SectionNode.tsx';
import { GridNode } from './nodes/GridNode.tsx';
import { NoteNode } from './nodes/NoteNode.tsx';
import { GalleryNode } from './nodes/GalleryNode.tsx';
import { ArtistNode } from './nodes/ArtistNode.tsx';
import { CharDictNode } from './nodes/CharDictNode.tsx';
import { dropTarget, handleFiles } from './files.ts';
import { DotConnectionLine, DotEdge } from './edges/DotEdge.tsx';
import { Spot } from './ui/Spot.tsx';

const nodeTypes = { prompt: PromptNode, negative: NegativeNode, generate: GenerateNode, image: ImageNode, character: CharacterNode, vibe: VibeNode, reference: RefNode, tool: ToolNode, section: SectionNode, grid: GridNode, note: NoteNode, gallery: GalleryNode, artist: ArtistNode, chardict: CharDictNode };
const edgeTypes = { dot: DotEdge };
const get = useStore.getState, set = useStore.setState;
const keys = { ctrl: false };
window.addEventListener('keydown', e => { keys.ctrl = e.ctrlKey || e.metaKey; });
window.addEventListener('keyup', e => { keys.ctrl = e.ctrlKey || e.metaKey; });
// 按着 Ctrl 切走窗口时收不到 keyup，回来后吸附会一直关着
window.addEventListener('blur', () => { keys.ctrl = false; });

export function Canvas() {
  const nodes = useStore(s => s.nodes), edges = useStore(s => s.edges), wheel = useStore(s => s.wheel);
  const guides = useStore(s => s.guides), ghosts = useStore(s => s.ghosts);
  // 分区垫在最下面，只能拖标题栏
  const rfNodes = useMemo(() => nodes.map(n => (n.type === 'section' ? { ...n, zIndex: -2000, dragHandle: '.sec-head' } : n)), [nodes]);
  const rf = useReactFlow<AppNode, AppEdge>();
  useEffect(() => { flow.rf = rf; }, [rf]);
  useOnViewportChange({ onEnd: () => scheduleSave() });

  /* ---------- 拖动：吸附 + 预告落点 + 松手后滑到空位 ---------- */
  /** 拖分区时，框里的节点跟着走：记下分区和成员的起点 */
  const drag = useRef<{ free: [number, number]; moved: boolean; secs?: Map<string, { x: number; y: number; followers: [string, { x: number; y: number }][] }> } | null>(null);
  const onNodeDragStart = useCallback((e: MouseEvent | TouchEvent, _n: AppNode, dragged: AppNode[]) => {
    pushUndo();
    drag.current = { free: [0, 0], moved: false };
    set({ busy: true });
    const secs = dragged.filter(isSection);
    if (secs.length) {
      const all = get().nodes, ids = new Set(dragged.map(n => n.id));
      drag.current.secs = new Map(secs.map(s => [s.id, { ...s.position, followers: membersOf(s.id, all).filter(m => !ids.has(m.id)).map(m => [m.id, { ...m.position }] as [string, { x: number; y: number }]) }]));
      return;
    }
    // Alt+拖动：原地留一份副本，被拖走的是原节点
    if (e.altKey) altCopy(dragged.map(n => n.id));
  }, []);
  const boxing = useRef(false);
  const onNodesChange = useCallback((changes: NodeChange<AppNode>[]) => {
    // 框选时不选中分区本身（在分区里框选节点很常见）
    if (boxing.current) changes = changes.filter(c => !(c.type === 'select' && isSection(node(c.id))));
    const moving = changes.filter((c): c is NodeChange<AppNode> & { type: 'position' } => c.type === 'position' && !!c.dragging && !!c.position);
    // 拖的是分区：成员一起平移，不吸附、不找空位
    if (moving.length && drag.current?.secs) {
      const secs = drag.current.secs;
      for (const c of moving) {
        const s = secs.get(c.id); if (!s) continue;
        const dx = c.position!.x - s.x, dy = c.position!.y - s.y;
        for (const [fid, p] of s.followers) changes.push({ type: 'position', id: fid, position: { x: Math.round(p.x + dx), y: Math.round(p.y + dy) }, dragging: true });
      }
      applyChanges(changes);
      if (changes.some(c => c.type === 'position' && c.dragging === false)) { drag.current = null; set({ busy: false }); }
      return;
    }
    if (moving.length && drag.current) {
      drag.current.moved = true;
      const all = get().nodes, byId = new Map(moving.map(c => [c.id, c.position!]));
      const proposed = all.map(n => byId.has(n.id) ? { ...n, position: byId.get(n.id)! } : n);
      const group = proposed.filter(n => byId.has(n.id));
      const [sx, sy, lines] = keys.ctrl ? [0, 0, []] as [number, number, []] : snap(group, proposed, rf.getZoom());
      for (const c of moving) c.position = { x: Math.round(c.position!.x + sx), y: Math.round(c.position!.y + sy) };
      const snapped = group.map(n => ({ ...n, position: byId.get(n.id)! }));
      const allSnapped = proposed.map(n => snapped.find(m => m.id === n.id) ?? n);
      const free = freeSpot(snapped, allSnapped);
      drag.current.free = free;
      set({ guides: lines, ghosts: ghostsFor(snapped, free[0], free[1]) });
    }
    applyChanges(changes);
    const ended = changes.filter(c => c.type === 'position' && c.dragging === false).map(c => (c as { id: string }).id);
    if (ended.length && drag.current) {
      const { free, moved } = drag.current;
      drag.current = null;
      set({ guides: [], ghosts: [], busy: false });
      if (moved && (free[0] || free[1])) glide(ended, free[0], free[1], () => ensureVisible(ended[0]));
    }
  }, [rf]);

  /* ---------- 连线：松在节点任意位置都行，松在空白处弹出能接的节点 ---------- */
  const onConnectStart = useCallback((_: unknown, p: OnConnectStartParams) => {
    if (p.nodeId && p.handleType) set({ wiring: { id: p.nodeId, dir: p.handleType } });
  }, []);
  const onConnect = useCallback((c: Connection) => { if (c.source && c.target) connect(c.source, c.target); }, []);
  const isValidConnection = useCallback((c: Connection | AppEdge) => {
    const a = node(c.source), b = node(c.target);
    return !!a && !!b && a.id !== b.id && !!slotFor(a, b) && !reaches(get().edges, b.id, a.id);
  }, []);
  const pointerTarget = (x: number, y: number) => {
    const el = document.elementFromPoint(x, y);
    return { el, nodeId: el?.closest('.react-flow__node')?.getAttribute('data-id') ?? null };
  };
  const onPointerMove = useCallback((e: React.PointerEvent) => {
    const w = get().wiring; if (!w) return;
    const { nodeId } = pointerTarget(e.clientX, e.clientY);
    let t: string | null = null;
    if (nodeId && nodeId !== w.id) {
      const a = node(w.dir === 'source' ? w.id : nodeId), b = node(w.dir === 'source' ? nodeId : w.id);
      if (a && b && slotFor(a, b) && !reaches(get().edges, b.id, a.id)) t = nodeId;
    }
    if (get().target !== t) set({ target: t });
  }, []);
  const onConnectEnd = useCallback((e: MouseEvent | TouchEvent, state: FinalConnectionState) => {
    const w = get().wiring;
    set({ wiring: null, target: null });
    if (!w || state.isValid) return;
    const pt = 'changedTouches' in e ? e.changedTouches[0] : e;
    const { el, nodeId } = pointerTarget(pt.clientX, pt.clientY);
    if (nodeId && nodeId !== w.id) { w.dir === 'source' ? connect(w.id, nodeId) : connect(nodeId, w.id); return; }
    if (el?.closest('.react-flow__pane')) set({ menu: { kind: 'add', x: pt.clientX, y: pt.clientY, from: w } });
  }, []);

  /* ---------- 右键：拖动是平移，单击才弹菜单 ---------- */
  const rdown = useRef<[number, number] | null>(null);
  const onPointerDownCapture = (e: React.PointerEvent) => { if (e.button === 2) rdown.current = [e.clientX, e.clientY]; };
  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const d = rdown.current; rdown.current = null;
    if (d && Math.hypot(e.clientX - d[0], e.clientY - d[1]) > 5) return;
    const nodeId = (e.target as HTMLElement).closest('.react-flow__node')?.getAttribute('data-id');
    if (nodeId) {
      if (!node(nodeId)?.selected) { set({ nodes: get().nodes.map(n => ({ ...n, selected: n.id === nodeId })) }); }
      set({ menu: { kind: 'node', x: e.clientX, y: e.clientY, nodeId } });
    } else if ((e.target as HTMLElement).closest('.react-flow__pane')) set({ menu: { kind: 'add', x: e.clientX, y: e.clientY } });
  };
  const onDoubleClick = (e: React.MouseEvent) => {
    const t = e.target as HTMLElement;
    if (t.closest('.react-flow__pane') && !t.closest('.react-flow__node')) set({ menu: { kind: 'add', x: e.clientX, y: e.clientY } });
  };

  /* ---------- 从系统拖入文件：图片、风格参考文件 ---------- */
  const [fileOver, setFileOver] = useState(false);
  const onDragOver = (e: React.DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
    if (!fileOver) setFileOver(true);
  };
  const onDrop = (e: React.DragEvent) => {
    setFileOver(false);
    const files = [...e.dataTransfer.files];
    if (!files.length) return;
    e.preventDefault();
    handleFiles(files, [e.clientX, e.clientY], dropTarget(e.target as Element));
  };

  return (
    <div className={`canvas ${fileOver ? 'is-file-over' : ''}`} onPointerDownCapture={onPointerDownCapture} onContextMenu={onContextMenu} onDoubleClick={onDoubleClick} onPointerMove={onPointerMove}
      onDragOver={onDragOver} onDrop={onDrop} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFileOver(false); }}>
      <Spot />
      <ReactFlow<AppNode, AppEdge>
        nodes={rfNodes} edges={edges} nodeTypes={nodeTypes} edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={changes => { const sel = changes.filter(c => c.type === 'select'); if (sel.length) set({ edges: get().edges.map(ed => { const c = sel.find(s => s.id === ed.id); return c && c.type === 'select' ? { ...ed, selected: c.selected } : ed; }) }); }}
        onNodeDragStart={onNodeDragStart}
        onConnectStart={onConnectStart} onConnect={onConnect} onConnectEnd={onConnectEnd} isValidConnection={isValidConnection}
        connectionLineComponent={DotConnectionLine} connectionRadius={36}
        panOnScroll={wheel === 'pan'} zoomOnScroll={wheel === 'zoom'} zoomOnPinch panOnDrag={[1, 2]}
        onSelectionStart={() => { boxing.current = true; }} onSelectionEnd={() => { boxing.current = false; }}
        selectionOnDrag selectionMode={SelectionMode.Partial} panActivationKeyCode="Space" multiSelectionKeyCode="Shift"
        deleteKeyCode={null} selectionKeyCode={null} zoomOnDoubleClick={false}
        minZoom={0.2} maxZoom={2} nodeDragThreshold={3} elevateNodesOnSelect onlyRenderVisibleElements
        proOptions={{ hideAttribution: true }}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="var(--dot)" />
        <ViewportPortal>
          {ghosts.map((g, i) => <div key={i} className="ghost" style={{ left: g.x, top: g.y, width: g.w, height: g.h }} />)}
          {guides.length > 0 && (
            <svg style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none' }} width={1} height={1}>
              {guides.map((l, i) => <line key={i} className="guide" x1={l[0]} y1={l[1]} x2={l[2]} y2={l[3]} />)}
            </svg>
          )}
        </ViewportPortal>
      </ReactFlow>
    </div>
  );
}
