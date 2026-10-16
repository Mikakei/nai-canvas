import { useEffect } from 'react';
import { placeImageAt, type ImageRef } from '../actions.ts';
import { batch, connect, createNode, flow, node, setSelection, toast, updateData, useStore } from '../store.ts';
import { dropImageOn } from '../files.ts';
import { KINDS, isChar, isGen } from '../graph.ts';
import { settle } from '../layout.ts';
import { charPrompt, type CharEntry } from '../presets.ts';

const set = useStore.setState;

/**
 * 从结果图（缩略图或"拖到画布"按钮）上按下后开始：移动超过几像素才算拖动，
 * 否则当作普通点击交给 onClick。松手在空白画布上就生成一个图片节点；
 * 松在图片、风格参考、精确参考节点上就换成这张图，松在生图节点上就接为底图
 */
export function startImageDrag(e: React.PointerEvent, img: ImageRef, onClick?: () => void) {
  if (e.button !== 0) return;
  // 阻止浏览器对 <img> 的原生拖拽，否则后续指针事件会被中断
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  let dragging = false;
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    dragging = true;
    set({ dragImg: { ...img, x: ev.clientX, y: ev.clientY } });
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    // 被系统打断（切走窗口等）：不放下
    if (ev.type === 'pointercancel') { set({ dragImg: null }); return; }
    // 推迟到 React Flow 处理完这次点击之后，否则它会把选中状态改回被点的节点
    if (!dragging) { setTimeout(() => onClick?.(), 0); return; }
    set({ dragImg: null });
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const onto = t?.closest('.react-flow__node')?.getAttribute('data-id');
    if (onto) setTimeout(() => dropImageOn(onto, img), 0);
    else if (t?.closest('.react-flow__pane')) setTimeout(() => placeImageAt(img, ev.clientX, ev.clientY), 0);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/* ---------- 从角色字典里拖出角色 ---------- */
/** 字典里的角色变成角色节点要用的数据：标题就是角色名，提示词 = 设定 + 服装 */
const charData = (e: CharEntry, outfit: number) => ({ title: e.name, text: charPrompt(e, outfit), uc: e.uc, enabled: true, x: 0.5, y: 0.5, showUc: !!e.uc.trim() });

/** 松手的地方：生图节点 → 新建角色节点接上去；角色节点 → 换成这个角色；空白处 → 新建角色节点 */
function dropChar(e: CharEntry, outfit: number, onto: string | null, at: [number, number] | null) {
  const n = onto ? node(onto) : undefined, data = charData(e, outfit);
  if (isChar(n)) {
    updateData(n.id, { title: data.title, text: data.text, uc: data.uc, showUc: data.showUc || n.data.showUc }, true);
    toast(`「${n.data.title}」换成了「${e.name}」`);
    return;
  }
  if (isGen(n)) {
    const w = KINDS.character.w, count = useStore.getState().edges.filter(x => x.target === n.id && x.data?.slot === 'chars').length;
    const made = batch(() => { const c = createNode('character', Math.round(n.position.x - w - 80), Math.round(n.position.y + count * 48), data); connect(c.id, n.id, true); return c; });
    setSelection([made.id]);
    settle(made.id);
    toast(`已把「${e.name}」接到「${n.data.title}」上`);
    return;
  }
  if (n) { toast('角色可以放在画布空白处、生图节点或角色节点上', { err: true }); return; }
  const rf = flow.rf;
  if (!at || !rf) return;
  const p = rf.screenToFlowPosition({ x: at[0], y: at[1] });
  const c = createNode('character', Math.round(p.x - KINDS.character.w / 2), Math.round(p.y - 60), data);
  setSelection([c.id]);
  settle(c.id);
  toast(`已放出「${e.name}」：接到生图节点上就能用`);
}

/** 放到画布：放在角色字典节点右边 */
export function placeChar(e: CharEntry, outfit: number, near: string) {
  const src = node(near);
  if (!src) return;
  const w = src.measured?.width ?? Number(src.data.w ?? 600);
  const c = createNode('character', Math.round(src.position.x + w + 80), Math.round(src.position.y), charData(e, outfit));
  setSelection([c.id]);
  settle(c.id);
  toast(`已放出「${e.name}」：接到生图节点上就能用`);
}

/** 从角色卡片上按下：移动几像素才算拖动，否则当作点击 */
export function startCharDrag(e: React.PointerEvent, entry: CharEntry, outfit: number, onClick?: () => void) {
  if (e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const sx = e.clientX, sy = e.clientY;
  let dragging = false;
  const move = (ev: PointerEvent) => {
    if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
    dragging = true;
    set({ dragChar: { name: entry.name, cover: entry.cover, x: ev.clientX, y: ev.clientY } });
  };
  const up = (ev: PointerEvent) => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    if (!dragging) { setTimeout(() => onClick?.(), 0); return; }
    set({ dragChar: null });
    if (ev.type === 'pointercancel') return;
    const t = document.elementFromPoint(ev.clientX, ev.clientY);
    const onto = t?.closest('.react-flow__node')?.getAttribute('data-id') ?? null;
    const pane = !!t?.closest('.react-flow__pane');
    setTimeout(() => dropChar(entry, outfit, onto, pane ? [ev.clientX, ev.clientY] : null), 0);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/** 跟着鼠标走的小图（拖结果图）或者角色卡片（拖字典里的角色） */
export function DragImage() {
  const d = useStore(s => s.dragImg), c = useStore(s => s.dragChar);
  useEffect(() => {
    if (!d && !c) return;
    document.body.style.cursor = 'grabbing';
    return () => { document.body.style.cursor = ''; };
  }, [!!d || !!c]); // eslint-disable-line react-hooks/exhaustive-deps
  if (c) return (
    <div className="drag-char" style={{ left: c.x - 60, top: c.y - 76 }}>
      {c.cover ? <img src={c.cover} alt="" /> : <span className="acv-none"><b>{(c.name.trim()[0] ?? '角').toUpperCase()}</b></span>}
      <b>{c.name}</b>
    </div>
  );
  if (!d) return null;
  const w = 120, h = (w * d.ih) / d.iw;
  return (
    <img className="drag-img" src={d.url} alt="" style={{ left: d.x - w / 2, top: d.y - h / 2, width: w, height: h }} />
  );
}
