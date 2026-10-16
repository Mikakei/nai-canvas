import { useEffect } from 'react';
import { isGallery, isGen } from './graph.ts';
import { galleryNav } from './ui/Gallery.tsx';
import { dupNodes } from './actions.ts';
import { deleteSelection, flow, redo, selected, setSelection, toast, undo, updateData, useStore } from './store.ts';
import { runSelected } from './run.ts';
import { wrapSelection } from './sections.ts';
import { dropTarget, handleFiles } from './files.ts';

/** 最近一次鼠标在画布上的位置，用于"粘贴到鼠标处" */
const pointer: { at: [number, number] | null } = { at: null };

export function useShortcuts() {
  useEffect(() => {
    const move = (e: PointerEvent) => { pointer.at = (e.target as HTMLElement).closest?.('.react-flow') ? [e.clientX, e.clientY] : null; };
    const key = (e: KeyboardEvent) => {
      const st = useStore.getState();
      if (st.modal?.kind === 'editor') return;
      // 增强、导入这类弹窗打开时，快捷键不能作用到后面的画布上（比如 Delete 删掉选中的节点）
      if (st.modal) { if (e.key === 'Escape') useStore.setState({ modal: null }); return; }
      // 全屏图库自己处理按键
      if (st.gallery) return;
      if (st.dialog) { if (e.key === 'Escape') useStore.setState({ dialog: null }); return; }
      if (st.menu) { if (e.key === 'Escape') useStore.setState({ menu: null }); return; }
      const t = e.target as HTMLElement;
      const typing = !!t.closest?.('input, textarea, select, [contenteditable]');
      const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
      // Ctrl+D 在文字框里也有效（复制当前节点），同时挡住浏览器的"加书签"
      if (mod && k === 'd') {
        e.preventDefault();
        const own = typing ? t.closest('.react-flow__node')?.getAttribute('data-id') : null;
        const ids = own && !selected().some(n => n.id === own) ? [own] : selected().map(n => n.id);
        if (ids.length) dupNodes(ids);
        return;
      }
      if (mod && k === 'f') { e.preventDefault(); useStore.setState({ search: true }); return; }
      if (mod && e.key === 'Enter') { e.preventDefault(); runSelected(); return; }
      if (mod && k === 'g' && !typing) { e.preventDefault(); wrapSelection(); return; }
      if (e.key === 'Escape') { if (typing) t.blur(); else setSelection([]); return; }
      if (typing) return;
      if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && k === 'y') { e.preventDefault(); redo(); return; }
      if (mod && k === 'a') { e.preventDefault(); setSelection(st.nodes.map(n => n.id)); return; }
      if (mod) return;
      // 选中一个图库节点时：← → 翻图，Enter 放大看
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Enter') {
        const sel = selected();
        if (sel.length === 1 && isGallery(sel[0]) && galleryNav.get(sel[0].id)?.current?.(e.key)) { e.preventDefault(); return; }
      }
      if (e.key === 'Enter') { e.preventDefault(); runSelected(); return; }
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); deleteSelection(); return; }
      if (e.key === '?') { useStore.setState({ dialog: 'keys' }); return; }
      if (e.key === '!' || (e.shiftKey && e.code === 'Digit1')) { flow.rf?.fitView({ padding: 0.2, duration: 400, maxZoom: 1 }); return; }
      if (k === 'h') { for (const n of selected()) if (isGen(n)) updateData(n.id, { hidePrompt: !n.data.hidePrompt }); return; }
      if (k === 'p') { const gens = selected().filter(isGen); const open = gens.some(n => !n.data.showParams); for (const n of gens) updateData(n.id, { showParams: open }); return; }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const sel = selected();
        if (sel.length === 1 && isGen(sel[0]) && sel[0].data.history.length > 1) {
          e.preventDefault();
          const n = sel[0], cur = Math.min(n.data.history.length - 1, Math.max(0, n.data.cur + (e.key === 'ArrowRight' ? 1 : -1)));
          updateData(n.id, { cur });
        }
      }
    };
    const paste = (e: ClipboardEvent) => {
      // 在文字框、提示词编辑器里粘贴：完全交给它们，不管剪贴板里是什么
      if ((e.target as HTMLElement).closest?.('input, textarea, [contenteditable]') || useStore.getState().modal || useStore.getState().gallery) return;
      // 剪贴板里有图片时粘贴图片：选中了一个图片、风格参考或精确参考节点就换掉它的图，否则在鼠标处新建图片节点。
      // 节点不再用 Ctrl+V 粘贴（会和粘贴文字冲突）：复制节点用 Alt+拖动、Ctrl+D，跨画布用右键菜单
      const files = [...(e.clipboardData?.files ?? [])];
      if (files.length) {
        e.preventDefault();
        const sel = selected();
        const onto = sel.length === 1 ? dropTarget(document.querySelector(`.react-flow__node[data-id="${sel[0].id}"]`)) : null;
        handleFiles(files, pointer.at ?? undefined, onto);
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('keydown', key);
    window.addEventListener('paste', paste);
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('keydown', key); window.removeEventListener('paste', paste); };
  }, []);
}
