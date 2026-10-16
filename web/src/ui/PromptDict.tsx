// 提示词词典：提示词框旁边的"词典"小按钮。点开是存好的正面、负面提示词：点一条接在后面，"替换"换掉整段；
// 也能把框里现在的内容（或者选中的那一段）存进去。词典是全局的，存在 data\prompts.json
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorView } from '@codemirror/view';
import { addPrompt, deletePrompt, exportPresets, importPresets, updatePrompt, type PromptEntry } from '../presets.ts';
import { pickFiles } from '../images.ts';
import { toast, undo, useStore } from '../store.ts';
import { Seg } from './controls.tsx';

const TAG = <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5h5.3l5.7 5.7-5.3 5.3-5.7-5.7Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="5.7" cy="5.7" r="1.1" fill="currentColor" /></svg>;

/** 接在后面：中间用逗号隔开，去掉多余的逗号和空格 */
export const joinPrompt = (a: string, b: string) => [a.replace(/[\s,]+$/, ''), b.replace(/^[\s,]+/, '')].filter(Boolean).join(', ');

interface Props {
  kind: 'pos' | 'neg';
  /** 框里现在的内容 */
  value: string;
  /** 改内容（调用方用可以撤销的方式改） */
  onChange: (text: string) => void;
  /** 对应的编辑器（存选中的那一段时用） */
  editor?: () => Element | null;
  className?: string;
}

export function DictButton({ kind, value, onChange, editor, className = '' }: Props) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return <>
    <button ref={btn} type="button" className={`dict-btn nodrag ${open ? 'is-on' : ''} ${className}`} aria-expanded={open}
      title={kind === 'pos' ? '提示词词典：存好的正面提示词，点一条接在后面' : '提示词词典：存好的负面提示词，点一条接在后面'}
      onClick={() => setOpen(o => !o)}>{TAG}词典</button>
    {open && <DictPop anchor={btn.current} kind={kind} value={value} onChange={onChange} editor={editor} onClose={() => setOpen(false)} />}
  </>;
}

function DictPop({ anchor, kind: kind0, value, onChange, editor, onClose }: Omit<Props, 'className'> & { anchor: HTMLElement | null; onClose: () => void }) {
  const all = useStore(s => s.prompts);
  const [kind, setKind] = useState(kind0);
  const [q, setQ] = useState('');
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ value, onChange, onClose });
  live.current = { value, onChange, onClose };
  // 打开时编辑器里选中的那一段（打开后焦点会离开编辑器，先记下来）
  const [selText] = useState(() => {
    const el = editor?.(), v = el ? EditorView.findFromDOM(el as HTMLElement) : null;
    if (!v) return '';
    const { from, to } = v.state.selection.main;
    return v.state.sliceDoc(from, to).trim();
  });
  // 放在按钮下面，下面放不下就放上面，不超出窗口
  useLayoutEffect(() => {
    const a = anchor?.getBoundingClientRect(), el = box.current;
    if (!a || !el) return;
    const w = el.offsetWidth, h = el.offsetHeight;
    const left = Math.min(Math.max(8, a.left + a.width / 2 - w / 2), innerWidth - w - 8);
    let top = a.bottom + 8;
    if (top + h > innerHeight - 8) top = Math.max(8, a.top - h - 8);
    setPos({ left, top });
  }, [anchor, kind, all.length, editing, q]);
  // 点到外面、按 Esc、滚动画布时收起
  useEffect(() => {
    const down = (e: PointerEvent) => { const t = e.target as Node; if (!box.current?.contains(t) && !anchor?.contains(t)) live.current.onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape' && !editing) { e.stopPropagation(); live.current.onClose(); } };
    const wheel = (e: WheelEvent) => { if (!box.current?.contains(e.target as Node)) live.current.onClose(); };
    addEventListener('pointerdown', down, true); addEventListener('keydown', key, true); addEventListener('wheel', wheel, true);
    return () => { removeEventListener('pointerdown', down, true); removeEventListener('keydown', key, true); removeEventListener('wheel', wheel, true); };
  }, [anchor, editing]);

  const k = q.trim().toLowerCase();
  const mine = all.filter(e => e.kind === kind);
  const list = mine.filter(e => !k || e.name.toLowerCase().includes(k) || e.text.toLowerCase().includes(k));
  const insert = (e: PromptEntry) => { live.current.onChange(joinPrompt(live.current.value, e.text)); toast(`已接上「${e.name}」`, { action: { label: '撤销', fn: undo } }); live.current.onClose(); };
  const replace = (e: PromptEntry) => { live.current.onChange(e.text); toast(`已换成「${e.name}」`, { action: { label: '撤销', fn: undo } }); live.current.onClose(); };
  const source = (selText || value).trim();
  const saveNow = () => {
    if (!source) { toast('框里还没有内容', { err: true }); return; }
    const e = addPrompt({ kind, text: source, name });
    setName(''); setQ('');
    toast(`已存进${kind === 'pos' ? '正面' : '负面'}词典：「${e.name}」`);
  };
  const importLib = async () => { const f = await pickFiles('.zip,.json,application/zip,application/json'); if (f[0]) importPresets('prompts', f[0]); };

  return createPortal(
    <div ref={box} className="dict-pop" role="dialog" aria-label="提示词词典" style={pos ? { left: pos.left, top: pos.top } : { left: -9999, top: 0 }}>
      <div className="dict-head">
        <div className="dict-kind"><Seg label="正面还是负面" value={kind} options={[{ v: 'pos' as const, l: '正面' }, { v: 'neg' as const, l: '负面' }]} onChange={setKind} /></div>
        <input className="input" value={q} placeholder="搜名字或内容…" aria-label="搜词典" autoFocus onChange={e => setQ(e.target.value)} />
      </div>
      <div className="dict-list">
        {list.map(e => editing === e.id ? (
          <div key={e.id} className="dict-row is-edit">
            <input className="input" value={e.name} aria-label="词条名字" autoFocus onChange={ev => updatePrompt(e.id, { name: ev.target.value })}
              onKeyDown={ev => { if (ev.key === 'Enter' || ev.key === 'Escape') { ev.stopPropagation(); setEditing(null); } }} onBlur={() => setEditing(null)} />
          </div>
        ) : (
          <div key={e.id} className="dict-row" role="button" tabIndex={0} title={`点一下接在后面：${e.text}`} onClick={() => insert(e)} onKeyDown={ev => { if (ev.key === 'Enter') insert(e); }}>
            <b>{e.name}</b>
            <span>{e.text}</span>
            <div className="dict-acts">
              <button type="button" onClick={ev => { ev.stopPropagation(); replace(e); }}>替换</button>
              <button type="button" onClick={ev => { ev.stopPropagation(); setEditing(e.id); }}>改名</button>
              <button type="button" className="is-danger" onClick={ev => { ev.stopPropagation(); deletePrompt(e.id); }}>删除</button>
            </div>
          </div>
        ))}
        {!list.length && (
          <p className="dict-empty">{mine.length ? '没有符合的词条' : kind === 'pos'
            ? '还没有存过正面提示词。把常用的一段（画风、质量词、构图…）写好，在下面存进来，以后点一下就能接上。'
            : '还没有存过负面提示词。把常用的一套写好，在下面存进来，以后点一下就能接上。'}</p>
        )}
      </div>
      <div className="dict-save">
        <input className="input" value={name} aria-label="词条名字" placeholder={selText ? '给选中的这段起个名字（可以不填）' : '给框里这段起个名字（可以不填）'}
          onChange={e => setName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') saveNow(); }} />
        <button type="button" className="btn sm is-primary" disabled={!source} onClick={saveNow}>{selText ? '存选中的' : '存进词典'}</button>
      </div>
      <div className="dict-foot">
        <button type="button" className="linkish" onClick={() => exportPresets('prompts')}>导出词典</button>
        <button type="button" className="linkish" onClick={importLib}>导入</button>
        <span>点一条接在后面 · "替换"换掉整段</span>
      </div>
    </div>,
    document.body,
  );
}
