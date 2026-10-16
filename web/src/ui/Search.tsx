import { useEffect, useMemo, useRef, useState } from 'react';
import { KINDS, type AppNode } from '../graph.ts';
import { flow, setSelection, useStore } from '../store.ts';
import { ensureVisible } from '../actions.ts';

/** 一个节点里能搜的文字：标题、提示词、负面提示词、角色 UC、便签、工具提示词 */
function textsOf(n: AppNode): string[] {
  const d = n.data as Record<string, unknown>, out = [String(d.title ?? '')];
  for (const k of ['text', 'uc', 'prompt', 'name']) if (typeof d[k] === 'string') out.push(d[k] as string);
  const p = d.params as { negative?: string } | undefined;
  if (p?.negative) out.push(p.negative);
  return out.filter(Boolean);
}

/** 画布搜索（Ctrl+F）：按标题和内容找节点，回车跳过去 */
export function Search() {
  const open = useStore(s => s.search);
  const nodes = useStore(s => s.nodes);
  const [q, setQ] = useState('');
  const [act, setAct] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { if (open) { setAct(0); setTimeout(() => input.current?.select(), 0); } }, [open]);
  const results = useMemo(() => {
    const k = q.trim().toLowerCase();
    if (!k) return [];
    const out: { n: AppNode; snippet: string }[] = [];
    for (const n of nodes) {
      for (const t of textsOf(n)) {
        const i = t.toLowerCase().indexOf(k);
        if (i < 0) continue;
        const a = Math.max(0, i - 18);
        out.push({ n, snippet: `${a > 0 ? '…' : ''}${t.slice(a, i + k.length + 40)}` });
        break;
      }
      if (out.length >= 30) break;
    }
    return out;
  }, [q, nodes]);
  if (!open) return null;
  const close = () => useStore.setState({ search: false });
  const go = (n: AppNode) => {
    close();
    setSelection([n.id]);
    const rf = flow.rf, w = n.measured?.width ?? KINDS[n.type].w, h = n.measured?.height ?? 240;
    rf?.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.7), duration: 420 });
    setTimeout(() => ensureVisible(n.id), 460);
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'ArrowDown') { setAct(a => Math.min(results.length - 1, a + 1)); e.preventDefault(); }
    if (e.key === 'ArrowUp') { setAct(a => Math.max(0, a - 1)); e.preventDefault(); }
    if (e.key === 'Enter' && results[act]) { go(results[act].n); e.preventDefault(); }
    e.stopPropagation();
  };
  const k = q.trim();
  return (
    <div className="search" role="dialog" aria-label="搜索画布">
      <input ref={input} className="input" placeholder="搜节点：标题、提示词、便签…" value={q} onChange={e => { setQ(e.target.value); setAct(0); }} onKeyDown={onKey} onBlur={() => setTimeout(close, 150)} aria-label="搜索画布" />
      {k && (
        <div className="search-list" role="listbox">
          {results.length ? results.map((r, i) => {
            const at = r.snippet.toLowerCase().indexOf(k.toLowerCase());
            return (
              <div key={r.n.id} role="option" aria-selected={i === act} className={`search-item ${i === act ? 'is-act' : ''}`} onPointerEnter={() => setAct(i)} onPointerDown={e => { e.preventDefault(); go(r.n); }}>
                <span className="t">{String(r.n.data.title)}</span><span className="e">{KINDS[r.n.type].en}</span>
                <span className="d">{at < 0 ? r.snippet : <>{r.snippet.slice(0, at)}<mark>{r.snippet.slice(at, at + k.length)}</mark>{r.snippet.slice(at + k.length)}</>}</span>
              </div>
            );
          }) : <div className="menu-none">没有找到「{k}」</div>}
        </div>
      )}
    </div>
  );
}
