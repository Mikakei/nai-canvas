import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { EditorView } from '@codemirror/view';
import { KINDS, KIND_KEYS, isArtist, isChar, isGen, isImage, isVibe, picOf, slotFor, type Kind } from '../graph.ts';
import { addArtist, addChar, setArtistCover } from '../presets.ts';
import { exportVibes, importMetaOf, inpaintResult, openEditor, paintResult, upscaleImage, variations } from '../imageActions.ts';
import { addNodeAt, clipCount, copySelection, dupNodes, pasteClip, removeNodes } from '../actions.ts';
import { batch, createNode, node, setSelection, toast, updateData, useStore } from '../store.ts';
import { settle } from '../layout.ts';
import { cancel, runNode } from '../run.ts';
import { runSection, wrapSelection } from '../sections.ts';

const close = () => useStore.setState({ menu: null });

/** 提示词节点里选中的那段文字（右键菜单打开时选区还在） */
function selectedText(id: string): string {
  const el = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"] .cm-editor`);
  const v = el ? EditorView.findFromDOM(el) : null;
  if (!v) return '';
  const { from, to } = v.state.selection.main;
  return v.state.sliceDoc(from, to).trim();
}

/** 选中的文字存成画师串，在旁边放一个画师串节点 */
function saveAsArtist(promptId: string, text: string) {
  const p = node(promptId);
  if (!p) return;
  const e = addArtist({ text: text.replace(/^[\s,]+|[\s,]+$/g, '') });
  const n = batch(() => createNode('artist', Math.round(p.position.x), Math.round(p.position.y + (p.measured?.height ?? 200) + 60), { entry: e.id, name: e.name, text: e.text }));
  setSelection([n.id]);
  settle(n.id);
  toast(`已存成画师串「${e.name}」。原来的文字还在提示词里，不需要的话记得删掉；把画师串节点接到生图节点上就会放在最前面`);
}

/** 角色节点存进角色字典 */
function saveAsChar(id: string) {
  const n = node(id);
  if (!isChar(n)) return;
  const text = n.data.text.trim();
  if (!text) { toast('这个角色还没有提示词', { err: true }); return; }
  const def = /^角色 \d+$/.test(n.data.title) ? text.split(',')[0].trim().slice(0, 24) : n.data.title;
  const e = addChar({ name: def, prompt: text, uc: n.data.uc });
  // 画布上有角色字典节点的话，选中刚存的这个
  const dict = useStore.getState().nodes.find(m => m.type === 'chardict');
  if (dict) updateData(dict.id, { sel: e.id });
  toast(`已存进角色字典：「${e.name}」。可以在角色字典节点里改名字、加封面和服装`);
}

/** 清空生图、工具节点的历史。历史不在画布撤销记录里，所以在提示里给一个撤销 */
function clearHistory(id: string) {
  const n = node(id);
  if (!n || (n.type !== 'generate' && n.type !== 'tool')) return;
  const { history, cur } = n.data;
  updateData(id, { history: [], cur: 0 });
  toast('已清空，图片文件还在输出文件夹和图库里', { action: { label: '撤销', fn: () => { if (node(id)) updateData(id, { history, cur }); } } });
}

/** 菜单放在触发点附近，不超出窗口；展开动画从触发点开始 */
function usePlace(x: number, y: number, above?: boolean) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; ox: number; oy: number } | null>(null);
  useLayoutEffect(() => {
    const m = ref.current; if (!m) return;
    const w = m.offsetWidth, h = m.offsetHeight, W = innerWidth, H = innerHeight;
    const left = Math.min(Math.max(8, x - (above ? w / 2 : 0)), W - w - 8), top = Math.min(Math.max(8, y - (above ? h + 10 : 0)), H - h - 8);
    setPos({ left, top, ox: x - left, oy: y - top });
  }, [x, y, above]);
  return [ref, pos ? { left: pos.left, top: pos.top, ['--ox' as string]: `${pos.ox}px`, ['--oy' as string]: `${pos.oy}px` } : { left: x, top: y, visibility: 'hidden' as const }] as const;
}

export function Menu() {
  const menu = useStore(s => s.menu);
  useEffect(() => {
    if (!menu) return;
    const down = (e: PointerEvent) => { const t = e.target as HTMLElement; if (!t.closest('.menu') && !t.closest('[data-dock-add]')) close(); };
    window.addEventListener('pointerdown', down, true);
    return () => window.removeEventListener('pointerdown', down, true);
  }, [menu]);
  if (!menu) return null;
  return menu.kind === 'add' ? <AddMenu key={`${menu.x},${menu.y}`} /> : <NodeMenu key={menu.nodeId} />;
}

function AddMenu() {
  const menu = useStore(s => s.menu)!;
  const from = menu.from ? node(menu.from.id) : undefined;
  const all = KIND_KEYS.filter(k => !KINDS[k].hidden).filter(k => {
    if (!from || !menu.from) return true;
    const probe = { type: k } as never;
    return menu.from.dir === 'source' ? !!slotFor(from, probe) : !!slotFor(probe, from);
  });
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);
  const items = all.filter(k => !q || KINDS[k].name.includes(q) || KINDS[k].en.toLowerCase().includes(q.toLowerCase()) || KINDS[k].desc.includes(q));
  const [ref, style] = usePlace(menu.x, menu.y, menu.above);
  useEffect(() => { if (from) ref.current?.focus(); }, [from, ref]);
  const choose = (k: Kind) => { const at = menu.at ?? [menu.x, menu.y]; close(); addNodeAt(k, at[0], at[1], menu.from); };
  // 之前用右键"复制到别的画布"复制过节点：空白处右键可以粘贴
  const clips = from ? 0 : clipCount();
  const paste = () => { const at = menu.at ?? [menu.x, menu.y]; close(); pasteClip(at); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { setAct(a => (a + 1) % Math.max(1, items.length)); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { setAct(a => (a - 1 + items.length) % Math.max(1, items.length)); e.preventDefault(); }
    else if (e.key === 'Enter' && items[act]) { choose(items[act]); e.preventDefault(); }
    else if (e.key === 'Escape') close();
  };
  return (
    <div className="menu" ref={ref} style={style} role="menu" tabIndex={-1} onKeyDown={onKey}>
      {from ? <div className="menu-head">能接上「{from.data.title}」的节点</div>
        : <input autoFocus placeholder="搜索节点…" aria-label="搜索节点" value={q} onChange={e => { setQ(e.target.value); setAct(0); }} />}
      {clips > 0 && !q && (
        <div role="menuitem" className="menu-item is-paste" onClick={paste}>
          <span className="t">粘贴 {clips} 个节点</span><span className="e">PASTE</span><span className="d">刚才用右键"复制到别的画布"复制的</span>
        </div>
      )}
      {items.length ? items.map((k, i) => (
        <div key={k} role="menuitem" className={`menu-item ${i === act ? 'is-act' : ''}`} style={{ animationDelay: `${i * 18}ms` }} onPointerEnter={() => setAct(i)} onClick={() => choose(k)}>
          <span className="t">{KINDS[k].name}</span><span className="e">{KINDS[k].en}</span><span className="d">{KINDS[k].desc}</span>
        </div>
      )) : <div className="menu-none">没有匹配的节点</div>}
    </div>
  );
}

function NodeMenu() {
  const menu = useStore(s => s.menu)!;
  const n = useStore(s => s.nodes.find(m => m.id === menu.nodeId));
  const status = useStore(s => s.runtime[menu.nodeId ?? '']?.status);
  const [ref, style] = usePlace(menu.x, menu.y);
  if (!n) return null;
  const busy = status === 'queued' || status === 'running';
  const rows: ({ k: string; t: string; kbd?: string; danger?: boolean; fn: () => void } | null)[] = [];
  if (KINDS[n.type].run) rows.push(busy && isGen(n) ? { k: 'cancel', t: '取消生成', fn: () => cancel(n.id) } : { k: 'run', t: '运行', kbd: 'Enter', fn: () => runNode(n.id) });
  if (n.type === 'tool' && n.data.history.length) rows.push({ k: 'clearT', t: '清空结果', fn: () => clearHistory(n.id) });
  if (n.type === 'section') rows.push({ k: 'runsec', t: '运行分区里的节点', fn: () => runSection(n.id) });
  rows.push({ k: 'dup', t: '复制一份', kbd: 'Ctrl+D', fn: () => dupNodes([n.id]) });
  rows.push({ k: 'copyx', t: '复制到别的画布', fn: () => { copySelection(); } });
  if (n.type !== 'section' && useStore.getState().nodes.filter(m => m.selected).length > 0) rows.push({ k: 'wrap', t: '框成分区', kbd: 'Ctrl+G', fn: wrapSelection });
  if (isGen(n)) {
    if (n.data.history.length) rows.push({ k: 'clear', t: '清空历史', fn: () => clearHistory(n.id) });
    // 当前这张设为接着的画师串的封面
    const cur = n.data.history[n.data.cur];
    if (cur) for (const e of useStore.getState().edges.filter(x => x.target === n.id && x.data?.slot === 'artists')) {
      const a = node(e.source);
      if (isArtist(a)) rows.push({ k: `cover-${a.id}`, t: `当前这张设为「${a.data.name || a.data.title}」的封面`, fn: () => setArtistCover(a.id, cur.url) });
    }
    rows.push({ k: 'hide', t: n.data.hidePrompt ? '显示底栏' : '隐藏底栏', kbd: 'H', fn: () => updateData(n.id, { hidePrompt: !n.data.hidePrompt }) });
    if (n.data.history.length && !busy) rows.push(null,
      { k: 'inp', t: '局部重绘…', fn: () => inpaintResult(n.id) },
      { k: 'paint', t: '涂改后图生图…', fn: () => paintResult(n.id) },
      { k: 'var', t: '生成变体', fn: () => variations(n.id) },
      { k: 'enh', t: '增强…', fn: () => useStore.setState({ modal: { kind: 'enhance', id: n.id } }) });
  }
  if (n.type === 'prompt') { const sel = selectedText(n.id); if (sel) rows.push({ k: 'asart', t: '选中的文字存为画师串', fn: () => saveAsArtist(n.id, sel) }); }
  if (isChar(n) && n.data.text.trim()) rows.push({ k: 'asdict', t: '存进角色字典', fn: () => saveAsChar(n.id) });
  const pic = picOf(n);
  if (pic) {
    rows.push({ k: 'up', t: '放大 2×', fn: () => upscaleImage(n.id, pic) });
    rows.push({ k: 'meta', t: '读取生成信息…', fn: () => importMetaOf(n.id) });
  }
  if (isImage(n) && pic) rows.push({ k: 'edit', t: '编辑（绘画）…', fn: () => openEditor(n.id, undefined, 'paint') }, { k: 'mask', t: n.data.mask ? '改遮罩…' : '局部重绘 / 扩图…', fn: () => openEditor(n.id) });
  if (isImage(n) && n.data.mask) rows.push({ k: 'unmask', t: '去掉遮罩', fn: () => updateData(n.id, { mask: undefined, focus: undefined }, true) });
  if (isImage(n) && !pic) rows.push({ k: 'pick', t: '选择图片…', fn: () => (document.querySelector<HTMLButtonElement>(`.react-flow__node[data-id="${n.id}"] .drop`))?.click() });
  if (isVibe(n)) {
    const vibes = useStore.getState().nodes.filter(m => m.selected && isVibe(m)).map(m => m.id);
    rows.push({ k: 'exp', t: vibes.length > 1 ? `导出 ${vibes.length} 个风格参考` : '导出 .naiv4vibe', fn: () => exportVibes(vibes.length > 1 ? vibes : [n.id]) });
    rows.push({ k: 'expe', t: '只导出编码', fn: () => exportVibes(vibes.length > 1 ? vibes : [n.id], true) });
  }
  rows.push(null, { k: 'del', t: '删除', kbd: 'Delete', danger: true, fn: () => removeNodes(useStore.getState().nodes.filter(m => m.selected).map(m => m.id)) });
  return (
    <div className="menu" ref={ref} style={{ ...style, width: 220 }} role="menu">
      {rows.map((r, i) => r ? (
        <div key={r.k} role="menuitem" className={`menu-item ${r.danger ? 'is-danger' : ''}`} style={{ animationDelay: `${i * 18}ms` }} onClick={() => { close(); r.fn(); }}>
          <span className="t">{r.t}</span>{r.kbd && <kbd>{r.kbd}</kbd>}
        </div>
      ) : <div key={`s${i}`} className="menu-sep" />)}
    </div>
  );
}
