import { useEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap, insertNewline } from '@codemirror/commands';
import { Annotation, EditorState, Prec, Transaction } from '@codemirror/state';
import { EditorView, keymap, placeholder as placeholderExt, tooltips } from '@codemirror/view';
import { promptExtensions, warmUp } from './extensions.ts';
import { useStore } from '../store.ts';
import { lastEditor } from '../chunks.ts';

/** 从外面同步进来的改动（撤销画布、粘贴节点等）：不再回调 onChange，也不进编辑器自己的撤销记录 */
const external = Annotation.define<boolean>();

interface Props {
  value: string;
  onChange: (v: string) => void;
  /** 失去焦点时，如果内容变了，带着修改前的值回调（用来记一次撤销） */
  onCommit?: (before: string) => void;
  /** 工具节点的提示词：Enter 运行，Shift+Enter 换行。返回 true 表示已处理 */
  onEnter?: () => boolean;
  placeholder?: string;
  label: string;
  /** 用于标签补全的模型 API 名 */
  model?: string;
  character?: boolean;
  className?: string;
  style?: React.CSSProperties;
}

/** 提示词编辑器：语法高亮、写法检查、标签补全、@ 插入片段 */
export function PromptEditor({ value, onChange, onCommit, onEnter, placeholder, label, model, character, className = '', style }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  // 回调和配置放进 ref，编辑器只创建一次，之后读最新的值
  const props = useRef({ onChange, onCommit, onEnter, model });
  props.current = { onChange, onCommit, onEnter, model };
  const before = useRef<string | null>(null);

  useEffect(() => {
    const env = {
      model: () => props.current.model ?? 'nai-diffusion-4-5-full',
      character: !!character,
      chunks: () => useStore.getState().chunks,
    };
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          Prec.high(keymap.of([
            { key: 'Enter', run: () => props.current.onEnter?.() ?? false },
            { key: 'Shift-Enter', run: insertNewline },
            { key: 'Escape', run: view => { view.contentDOM.blur(); return true; } },
          ])),
          keymap.of([...defaultKeymap, ...historyKeymap]),
          // 补全和错误提示的弹窗挂到 body 上，不会被节点卡片的圆角裁掉，也不受画布缩放影响
          tooltips({ parent: document.body, position: 'fixed' }),
          EditorView.lineWrapping,
          placeholderExt(placeholder ?? ''),
          EditorView.contentAttributes.of({ 'aria-label': label, spellcheck: 'false' }),
          ...promptExtensions(env),
          EditorView.updateListener.of(u => { if (u.docChanged && !u.transactions.some(t => t.annotation(external))) props.current.onChange(u.state.doc.toString()); }),
          EditorView.domEventHandlers({
            focus: (_e, view) => { before.current = view.state.doc.toString(); lastEditor.view = view; warmUp(); },
            blur: (_e, view) => {
              const now = view.state.doc.toString();
              if (before.current !== null && before.current !== now) props.current.onCommit?.(before.current);
              before.current = null;
            },
          }),
        ],
      }),
    });
    view.current = v;
    return () => { v.destroy(); view.current = null; };
    // 编辑器只在挂载时创建；value 的外部变化由下面的 effect 同步
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 外部改了内容（撤销、粘贴节点等）时同步进编辑器
  useEffect(() => {
    const v = view.current;
    if (!v) return;
    const cur = v.state.doc.toString();
    if (cur !== value) v.dispatch({ changes: { from: 0, to: cur.length, insert: value }, selection: { anchor: Math.min(v.state.selection.main.head, value.length) }, annotations: [external.of(true), Transaction.addToHistory.of(false)] });
  }, [value]);

  // 片段列表变化后重画小标签
  const chunks = useStore(s => s.chunks);
  useEffect(() => { view.current?.dispatch({}); }, [chunks]);

  return <div ref={host} className={`pe nodrag nowheel ${className}`} style={style} />;
}
