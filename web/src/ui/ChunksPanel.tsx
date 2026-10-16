import { useMemo, useState } from 'react';
import { useStore, type Chunk } from '../store.ts';
import { CHUNK_COLORS, addChunk, deleteChunk, insertChunk, updateChunk, validName } from '../chunks.ts';
import { PromptEditor } from '../editor/PromptEditor.tsx';
import { Field } from './controls.tsx';

/** 片段名输入：失焦或回车时检查并保存，有问题就恢复原名 */
function NameInput({ chunk }: { chunk: Chunk }) {
  const [name, setName] = useState(chunk.name);
  const [err, setErr] = useState('');
  const commit = () => {
    if (name.trim() === chunk.name) { setErr(''); return; }
    const e = validName(name, chunk.id);
    if (e) { setErr(e); return; }
    setErr(''); updateChunk(chunk.id, { name: name.trim() });
  };
  return <>
    <input className="input" style={{ width: '100%' }} value={name} maxLength={30} aria-label="片段名称" onChange={e => setName(e.target.value)} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
    {err && <span className="form-err">{err}</span>}
  </>;
}

function ChunkCard({ chunk, folders, open, onToggle }: { chunk: Chunk; folders: string[]; open: boolean; onToggle: () => void }) {
  return (
    <div className={`chunk ${open ? 'is-open' : ''}`} style={{ ['--chunk' as string]: chunk.color }}
      draggable={!open} onDragStart={e => { e.dataTransfer.setData('text/plain', `!macro:${chunk.name}!`); e.dataTransfer.effectAllowed = 'copy'; }}>
      <div className="chunk-head" onClick={onToggle} title={open ? '收起' : '点开编辑；也可以直接拖进提示词框'}>
        <i className="chunk-dot" />
        <span className="chunk-name">{chunk.name}</span>
        <span className="chunk-acts" onClick={e => e.stopPropagation()}>
          <button type="button" onClick={() => insertChunk(chunk.name)} title="插到最近用过的提示词框里">插入</button>
        </span>
      </div>
      {!open && <div className="chunk-text">{chunk.text || <span className="note">（空）</span>}</div>}
      {open && (
        <div className="chunk-edit">
          <Field label="名称"><NameInput chunk={chunk} /></Field>
          <Field label="内容">
            <PromptEditor className="ta-box" label="片段内容" value={chunk.text} placeholder="写一段常用的提示词，可以用 ||红发|蓝发|| 随机" onChange={v => updateChunk(chunk.id, { text: v })} />
          </Field>
          <div className="two">
            <Field label="分类">
              <input className="input" style={{ width: '100%' }} list="chunk-folders" value={chunk.folder} placeholder="未分类" aria-label="分类" onChange={e => updateChunk(chunk.id, { folder: e.target.value })} />
              <datalist id="chunk-folders">{folders.map(f => <option key={f} value={f} />)}</datalist>
            </Field>
            <Field label="颜色">
              <div className="swatches">{CHUNK_COLORS.map(c => <button key={c} type="button" aria-label={`颜色 ${c}`} aria-pressed={c === chunk.color} style={{ background: c }} onClick={() => updateChunk(chunk.id, { color: c })} />)}</div>
            </Field>
          </div>
          <div className="row"><span className="note">在提示词框里输入 @ 也能插入</span><button type="button" className="linkish" style={{ color: 'var(--red)' }} onClick={() => deleteChunk(chunk.id)}>删除片段</button></div>
        </div>
      )}
    </div>
  );
}

/** 左侧的提示词片段库 */
export function ChunksPanel() {
  const open = useStore(s => s.panel === 'chunks');
  const chunks = useStore(s => s.chunks);
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const folders = useMemo(() => [...new Set(chunks.map(c => c.folder).filter(Boolean))].sort(), [chunks]);
  const shown = chunks.filter(c => !q || c.name.includes(q) || c.text.includes(q));
  const groups = [...new Set(shown.map(c => c.folder))].sort((a, b) => (a ? 1 : 0) - (b ? 1 : 0) || a.localeCompare(b));
  return (
    <aside className={`side ${open ? 'is-open' : ''}`} aria-label="提示词片段" aria-hidden={!open}>
      <div className="insp-head"><span className="ttl">提示词片段</span><span className="lab">{chunks.length}</span>
        <button type="button" className="x-btn" aria-label="关闭片段面板" onClick={() => useStore.setState({ panel: null })}>×</button>
      </div>
      <div className="side-tools">
        <input className="input" style={{ width: 'auto', flex: 1 }} placeholder="搜索片段…" value={q} onChange={e => setQ(e.target.value)} aria-label="搜索片段" />
        <button type="button" className="btn is-primary" onClick={() => { setQ(''); const c = addChunk(); setEditing(c.id); }}>新建</button>
      </div>
      <div className="insp-body">
        {!chunks.length && <p className="note" style={{ lineHeight: 1.7 }}>把常用的一段提示词存成片段，比如画风、质量词、某个角色的外貌。在任何提示词框里输入 @ 就能插入；改了片段，所有用到它的地方都会跟着变。</p>}
        {groups.map(g => (
          <div key={g || '_'} className="chunk-group">
            <div className="field-label"><span>{g || '未分类'}</span></div>
            {shown.filter(c => c.folder === g).map(c => <ChunkCard key={c.id} chunk={c} folders={folders} open={editing === c.id} onToggle={() => setEditing(e => (e === c.id ? null : c.id))} />)}
          </div>
        ))}
      </div>
    </aside>
  );
}
