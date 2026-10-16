import { useStore as useFlowStore } from '@xyflow/react';
import { deleteSelection, flow, redo, toast, undo, useStore } from '../store.ts';
import { Icons } from './controls.tsx';
import { activeCount, useJobs } from '../jobs.ts';
import { wrapSelection } from '../sections.ts';

export function Dock() {
  const canUndo = useStore(s => s.undo.length > 0), canRedo = useStore(s => s.redo.length > 0);
  const wheel = useStore(s => s.wheel), menuOpen = useStore(s => !!s.menu), panel = useStore(s => s.panel), gallery = useStore(s => s.gallery);
  const zoom = useFlowStore(s => s.transform[2]);
  const active = useJobs(s => activeCount(s.jobs)), failNew = useJobs(s => s.jobs.some(j => j.status === 'failed' && (j.ended ?? 0) > s.failSeen));
  const center = () => { const r = document.querySelector('.canvas')!.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2] as [number, number]; };
  const add = (e: React.MouseEvent) => {
    if (menuOpen) { useStore.setState({ menu: null }); return; }
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    useStore.setState({ menu: { kind: 'add', x: b.left + b.width / 2, y: b.top, above: true, at: center() } });
  };
  const toggleWheel = () => {
    const next = wheel === 'pan' ? 'zoom' : 'pan';
    useStore.setState({ wheel: next });
    try { localStorage.setItem('nai-wheel', next); } catch { /* 忽略 */ }
    toast(next === 'pan' ? '滚轮平移画布，Ctrl+滚轮缩放（FLORA 默认）' : '滚轮缩放画布，按住 Shift 滚动可以横向平移');
  };
  return (
    <div className="hud dock" role="toolbar" aria-label="画布工具"><div className="pill">
      <button type="button" className="db is-primary" data-dock-add title="添加节点（也可以双击画布空白处）" onClick={add}>{Icons.plus}<span className="tx">添加节点</span></button>
      <span className="sep" />
      <button type="button" className={`db ${panel === 'chunks' ? 'is-on' : ''}`} title="提示词片段：常用的提示词存起来，输入 @ 插入" onClick={() => useStore.setState({ panel: panel === 'chunks' ? null : 'chunks' })}>{Icons.chunks}<span className="tx">片段</span></button>
      <button type="button" className={`db ${gallery ? 'is-on' : ''}`} title="图库：所有生成过的图，按日期、模型、提示词找（全屏打开，可以钉到画布上）" onClick={() => useStore.setState({ gallery: !gallery })}>{Icons.library}<span className="tx">图库</span></button>
      <button type="button" className={`db ${panel === 'queue' ? 'is-on' : ''}`} title="生成队列：排队情况、进度、失败原因" onClick={() => useStore.setState({ panel: panel === 'queue' ? null : 'queue' })}>{Icons.queue}<span className="tx">队列</span>{active > 0 && <b className="badge">{active}</b>}{failNew && !active && <i className="fail-dot" />}</button>
      <span className="sep" />
      <button type="button" className="db" disabled={!canUndo} title="撤销 Ctrl+Z" onClick={undo}>{Icons.undo}<span className="tx">撤销</span></button>
      <button type="button" className="db" disabled={!canRedo} title="重做 Ctrl+Shift+Z" onClick={redo}>{Icons.redo}<span className="tx">重做</span></button>
      <span className="sep" />
      <button type="button" className="db sq" aria-label="缩小" onClick={() => flow.rf?.zoomOut({ duration: 200 })}>−</button>
      <button type="button" className="db zoomval" title="回到 100%" onClick={() => flow.rf?.zoomTo(1, { duration: 300 })}>{Math.round(zoom * 100)}%</button>
      <button type="button" className="db sq" aria-label="放大" onClick={() => flow.rf?.zoomIn({ duration: 200 })}>+</button>
      <button type="button" className="db" title="适配全部节点 Shift+1" onClick={() => flow.rf?.fitView({ padding: 0.2, duration: 400, maxZoom: 1 })}>{Icons.fit}<span className="tx">适配</span></button>
      <span className="sep" />
      <button type="button" className="db" title="滚轮的作用：平移（FLORA 默认）或缩放" onClick={toggleWheel}><span>滚轮 {wheel === 'pan' ? '平移' : '缩放'}</span></button>
      <button type="button" className="db" title="快捷键 ?" onClick={() => useStore.setState({ dialog: 'keys' })}>{Icons.keys}<span className="tx">快捷键</span></button>
    </div></div>
  );
}

export function SelTool({ onRun }: { onRun: () => void }) {
  const count = useStore(s => s.nodes.filter(n => n.selected).length);
  if (count < 2) return null;
  return (
    <div className="hud seltool"><div className="pill">
      <span>已选 {count} 个节点</span><span className="sep" />
      <button type="button" className="db" onClick={onRun}>{Icons.play}<span>全部运行</span></button>
      <button type="button" className="db" title="把选中的节点框成一个分区（Ctrl+G）" onClick={wrapSelection}><span>框成分区</span></button>
      <button type="button" className="db" onClick={deleteSelection}><span>删除</span></button>
    </div></div>
  );
}
