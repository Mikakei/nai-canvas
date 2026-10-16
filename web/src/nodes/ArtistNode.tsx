import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { parseArtists, serializeArtists, wrapStrength, type ArtistItem } from '@nai/shared';
import { KINDS, isGen, type ArtistNode as AN } from '../graph.ts';
import { addArtist, artistById, deleteArtist, exportPresets, importPresets, setArtistCover, updateArtist, type ArtistEntry } from '../presets.ts';
import { coverBusy, coverCostLabel, fillCover, generateCover } from '../coverGen.ts';
import { usePrefs } from '../prefs.ts';
import { pushUndo, setSelection, toast, updateData, useStore } from '../store.ts';
import { dupNodes, removeNodes } from '../actions.ts';
import { pickFiles } from '../images.ts';
import { PromptEditor } from '../editor/PromptEditor.tsx';
import { TokenCount } from '../editor/TokenCount.tsx';
import { Seg, Slider, Switch } from '../ui/controls.tsx';
import { NodeShell } from './NodeShell.tsx';

const ARROW_L = <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M9 2.5 4.5 7 9 11.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const ARROW_R = <svg viewBox="0 0 14 14" aria-hidden="true"><path d="M5 2.5 9.5 7 5 11.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>;
const WIDE = 560;

/** 没有封面时：点阵底 + 名字的第一个字 */
function NoCover({ name }: { name: string }) {
  return <span className="acv-none"><b>{(name.trim()[0] ?? '画').toUpperCase()}</b></span>;
}

/** 画师串一行一行：名字 + 点阵权重条（拖动、滚轮、方向键都能调），超过 1 的部分是红色 */
function Rows({ items, onChange }: { items: ArtistItem[]; onChange: (items: ArtistItem[]) => void }) {
  const live = useRef({ items, onChange });
  live.current = { items, onChange };
  const setW = (k: number, w: number) => {
    const L = live.current, v = Math.min(1.5, Math.max(0.05, Math.round(w / 0.05) * 0.05));
    if (Math.abs(v - L.items[k].w) < 1e-9) return;
    L.onChange(L.items.map((it, j) => (j === k ? { ...it, w: Math.round(v * 100) / 100 } : it)));
  };
  const drag = (k: number, e: React.PointerEvent<HTMLSpanElement>) => {
    const el = e.currentTarget;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const at = (x: number) => { const r = el.getBoundingClientRect(); setW(k, ((x - r.left) / r.width) * 1.5); };
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); el.removeEventListener('pointercancel', up); };
    el.addEventListener('pointermove', move); el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  };
  if (!items.length) return <p className="note arows-empty">还没有画师。切到"文本"粘贴一整串，会自动拆成一行一行。</p>;
  return (
    <div className="arows nodrag nowheel">
      {items.map((it, k) => (
        <div key={k} className="arow">
          <span className="an" title={it.name}>{it.name}</span>
          <span className="adots" role="slider" tabIndex={0} aria-label={`${it.name} 的权重`} aria-valuemin={0.05} aria-valuemax={1.5} aria-valuenow={it.w}
            title="拖动、滚轮或方向键调权重"
            onPointerDown={e => drag(k, e)}
            onWheel={e => setW(k, it.w + (e.deltaY < 0 ? 0.05 : -0.05))}
            onKeyDown={e => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); setW(k, it.w + 0.05); }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); setW(k, it.w - 0.05); }
            }}>
            {Array.from({ length: 15 }, (_, j) => <i key={j} className={j < Math.round(it.w * 10) ? (j >= 10 ? 'is-on is-hot' : 'is-on') : ''} />)}
          </span>
          <span className="av">{it.w.toFixed(2)}</span>
          <button type="button" className="arow-x" aria-label={`去掉 ${it.name}`} title="去掉这位画师" onClick={() => live.current.onChange(live.current.items.filter((_, j) => j !== k))}>×</button>
        </div>
      ))}
    </div>
  );
}

/** 画师串库：封面网格、搜索、分组、新建；窄节点里是弹出层，宽节点里摊在左边 */
function Library({ current, onPick, onClose }: { current?: string; onPick: (e: ArtistEntry) => void; onClose?: () => void }) {
  const all = useStore(s => s.artists);
  const [q, setQ] = useState(''), [group, setGroup] = useState('');
  const groups = useMemo(() => [...new Set(all.map(a => a.group.trim()).filter(Boolean))].sort(), [all]);
  const k = q.trim().toLowerCase();
  const list = all.filter(a => (!group || a.group.trim() === group) && (!k || a.name.toLowerCase().includes(k) || a.text.toLowerCase().includes(k)));
  const create = () => { const e = addArtist({ group }); onPick(e); toast(`新建了「${e.name}」：切到"文本"粘贴一整串画师就行`); };
  const importLib = async () => { const f = await pickFiles('.zip,.json,application/zip,application/json'); if (f[0]) importPresets('artists', f[0]); };
  // 库还是空的：不摆一个孤零零的大加号，直接说清楚能做什么
  if (!all.length) return (
    <div className="alib is-empty nodrag nowheel">
      <div className="alib-empty">
        <b>画师串库还是空的</b>
        <span>新建一个，粘贴一整串画师就会自动拆开；以前导出过的库也可以直接导入。</span>
        <div className="alib-empty-acts">
          <button type="button" className="btn sm is-primary" onClick={create}>新建画师串</button>
          <button type="button" className="btn sm" onClick={importLib}>导入画师串库…</button>
          {onClose && <button type="button" className="btn sm" onClick={onClose}>收起</button>}
        </div>
      </div>
    </div>
  );
  return (
    <div className="alib nodrag nowheel">
      <div className="alib-bar">
        <input className="input" value={q} placeholder="搜名字或画师…" aria-label="搜画师串" onChange={e => setQ(e.target.value)} />
        {onClose && <button type="button" className="tg" onClick={onClose}>收起</button>}
      </div>
      {groups.length > 0 && (
        <div className="alib-groups">
          <button type="button" className="tg" aria-pressed={!group} onClick={() => setGroup('')}>全部</button>
          {groups.map(g => <button key={g} type="button" className="tg" aria-pressed={group === g} onClick={() => setGroup(group === g ? '' : g)}>{g}</button>)}
        </div>
      )}
      <div className="alib-grid">
        {list.map(a => (
          <button key={a.id} type="button" className="alib-card" aria-current={a.id === current} onClick={() => onPick(a)} title={a.text}>
            <span className="alib-cover">{a.cover ? <img src={a.cover} alt="" draggable={false} /> : <NoCover name={a.name} />}</span>
            <span className="alib-name">{a.name}</span>
            <small>{parseArtists(a.text).length} 位画师{a.group ? ` · ${a.group}` : ''}</small>
          </button>
        ))}
        <button type="button" className="alib-card is-add" onClick={create}><span className="alib-cover"><b>+</b></span><span className="alib-name">新建画师串</span><small>粘贴一串就会拆开</small></button>
      </div>
      {!list.length && all.length > 0 && <p className="note">没有符合的画师串</p>}
      <div className="alib-foot">
        <button type="button" className="linkish" onClick={() => exportPresets('artists')}>导出整个库</button>
        <button type="button" className="linkish" onClick={importLib}>导入</button>
        <span>{all.length} 条 · 所有画布共用</span>
      </div>
    </div>
  );
}

function ArtistNodeView({ id, data }: NodeProps<AN>) {
  const entry = useStore(s => s.artists.find(a => a.id === data.entry));
  const all = useStore(s => s.artists);
  const rt = useStore(s => s.runtime[id]);
  // 连着的第一个生图节点：生成封面跟着它的模型
  const gen = useStore(s => { const e = s.edges.find(x => x.source === id); const g = e && s.nodes.find(n => n.id === e.target); return isGen(g) ? g : undefined; });
  const prefs = usePrefs();
  const [open, setOpen] = useState(false);
  // 弹出的画师串库：点到外面、按 Esc 就收起
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => { const t = e.target as HTMLElement; if (!t.closest(`[data-apop="${id}"], [data-apop-btn="${id}"]`)) setOpen(false); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', down, true); window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down, true); window.removeEventListener('keydown', key); };
  }, [open, id]);
  // 打开时把节点选中：选中的节点会浮到别的节点上面，弹出来的库不会被挡住
  const openPicker = () => { setSelection([id]); setOpen(true); };
  const wide = (data.w ?? KINDS.artist.w) >= WIDE;
  const text = entry ? entry.text : data.text;
  const items = useMemo(() => parseArtists(text), [text]);
  const name = entry?.name ?? data.name;
  const cover = entry ? entry.cover : data.cover;
  const missing = !!data.entry && !entry;
  const busy = rt?.status === 'running';
  const mode = data.mode ?? 'v';

  const pick = (e: ArtistEntry) => { updateData(id, { entry: e.id, name: e.name, text: e.text, cover: e.cover }, true); setOpen(false); };
  const setText = (t: string) => { if (entry) updateArtist(entry.id, { text: t }); else updateData(id, { text: t }); };
  // 封面上的左右箭头：在同一个分组里翻（没有分组就在整个库里翻）
  const ring = entry?.group ? all.filter(a => a.group === entry.group) : all;
  const at = entry ? ring.findIndex(a => a.id === entry.id) : -1;
  const step = (d: number) => { if (!ring.length) return; pick(ring[((at < 0 ? 0 : at + d) % ring.length + ring.length) % ring.length]); };
  const makeCoverNow = () => {
    if (coverBusy(id)) return;
    generateCover({
      statusId: id, title: name || data.title, from: gen, prompt: fillCover(prefs.artistCover, '{画师串}', wrapStrength(text, 1)),
      onCover: url => { if (entry) updateArtist(entry.id, { cover: url }); else updateData(id, { cover: url }); },
    });
  };
  const pickCoverFile = async () => { const f = await pickFiles('image/*'); if (f[0]) setArtistCover(id, f[0]); };
  const createNew = () => { const e = addArtist(); pick(e); updateData(id, { mode: 't' }); toast(`新建了「${e.name}」：在下面粘贴一整串画师就行`); };
  const importLib = async () => { const f = await pickFiles('.zip,.json,application/zip,application/json'); if (f[0]) importPresets('artists', f[0]); };
  const saveBack = () => { const e = addArtist({ name: data.name || data.title, text: data.text, cover: data.cover }); updateData(id, { entry: e.id, name: e.name }, true); toast(`已存回画师串库：「${e.name}」`); };
  const groups = [...new Set(all.map(a => a.group.trim()).filter(Boolean))];
  let stat = !text.trim() ? (all.length ? '选一个画师串' : '新建一个画师串') : `${items.length} 位画师`;
  if (!data.enabled) stat = '已停用';
  if (busy && rt?.label) stat = rt.label;

  const main = (
    <div className="artn-main">
      <div className={`acv ${busy ? 'is-busy' : ''}`}>
        {cover ? <img src={cover} alt="" draggable={false} /> : <NoCover name={name || '画师串'} />}
        <div className="acv-top nodrag">
          <span className="acv-pill">{at >= 0 ? `${at + 1} / ${ring.length}` : missing ? '库里没有' : '未选'}</span>
          {!wide && all.length > 0 && <button type="button" className="acv-pill is-btn" data-apop-btn={id} aria-expanded={open} onClick={() => (open ? setOpen(false) : openPicker())}>全部画师串</button>}
        </div>
        {ring.length > 1 && <>
          <button type="button" className="acv-arrow is-l nodrag" aria-label="上一个画师串" onClick={() => step(-1)}>{ARROW_L}</button>
          <button type="button" className="acv-arrow is-r nodrag" aria-label="下一个画师串" onClick={() => step(1)}>{ARROW_R}</button>
        </>}
        {!cover && text.trim() && !busy && (
          <button type="button" className="acv-cta nodrag" title={`用"${prefs.artistCover}"、固定种子出一张当封面（${gen ? '模型跟着连着的生图节点' : '模型用设置里的'}）`} onClick={makeCoverNow}>
            生成封面<small>{coverCostLabel(gen)}</small>
          </button>
        )}
        <div className="acv-name">{entry?.group && <span>{entry.group}</span>}<b>{name || (all.length ? '还没选画师串' : '画师串')}</b></div>
        {busy && <div className="acv-busy"><i /><span>生成封面中</span></div>}
      </div>
      <div className="pad">
        {missing && (
          <div className="warn-line" style={{ padding: 0 }}>画师串库里没有这一条了（可能删了，或者画布是从别的电脑带来的），现在用的是节点里存的内容。
            <button type="button" className="linkish" onClick={saveBack}>存回库里</button></div>
        )}
        {!entry && !data.text && !missing ? (
          <div className="astart">
            {all.length ? <>
              <p className="note">画师串存在画师串库里，所有画布共用。从库里选一个，或者新建一个。</p>
              <div className="astart-acts">
                <button type="button" className="btn sm is-primary" data-apop-btn={id} onClick={() => (open ? setOpen(false) : openPicker())}>从库里选</button>
                <button type="button" className="btn sm" onClick={createNew}>新建</button>
              </div>
            </> : <>
              <p className="note">画师串库还是空的。新建一个，粘贴一整串画师就会自动拆开；以前导出过的库也可以直接导入。</p>
              <div className="astart-acts">
                <button type="button" className="btn sm is-primary" onClick={createNew}>新建画师串</button>
                <button type="button" className="btn sm" onClick={importLib}>导入画师串库…</button>
              </div>
            </>}
          </div>
        ) : <>
          <Seg label="显示方式" value={mode} options={[{ v: 'v' as const, l: '可视化' }, { v: 't' as const, l: '文本' }]} onChange={v => updateData(id, { mode: v })} />
          {mode === 'v' ? <Rows items={items} onChange={list => setText(serializeArtists(list))} />
            : <PromptEditor key={entry?.id ?? 'local'} className="ta-box" label="画师串" value={text} placeholder="粘贴一整串，比如 0.6::anteiru ::, 0.8::betanonbeet ::" onChange={setText} />}
          <div className="field">
            <div className="field-label"><span>整体强度</span><span className="v">{(data.k ?? 1).toFixed(2)}</span></div>
            <Slider label="整体强度" min={0.5} max={1.5} step={0.05} value={data.k ?? 1} onCommit={pushUndo} onChange={v => updateData(id, { k: Math.round(v * 100) / 100 })} />
          </div>
          {entry && (
            <details className="ameta nodrag">
              <summary>条目设置</summary>
              <label className="ameta-row"><span>名称</span><input className="input" value={entry.name} aria-label="画师串名称" onChange={e => updateArtist(entry.id, { name: e.target.value })} /></label>
              <label className="ameta-row"><span>分组</span><input className="input" list={`ag-${id}`} value={entry.group} placeholder="不分组" aria-label="分组" onChange={e => updateArtist(entry.id, { group: e.target.value })} /></label>
              <datalist id={`ag-${id}`}>{groups.map(g => <option key={g} value={g} />)}</datalist>
              <div className="ameta-acts">
                <button type="button" className="btn sm" disabled={busy || !text.trim()} onClick={makeCoverNow}>{cover ? '重新生成封面' : '生成封面'}</button>
                <button type="button" className="btn sm" onClick={pickCoverFile}>换封面…</button>
                <button type="button" className="btn sm" onClick={() => { const e = addArtist({ name: `${entry.name} 副本`, group: entry.group, text: entry.text, cover: entry.cover }); pick(e); }}>复制一份</button>
                <button type="button" className="btn sm is-danger" onClick={() => deleteArtist(entry.id)}>从库里删掉</button>
              </div>
              <p className="note">改名字、权重、封面会改库里的这一条，用到它的节点都跟着变；整体强度只影响这个节点。</p>
            </details>
          )}
        </>}
        <div className="foot">
          <TokenCount nodeId={id} text={data.enabled ? wrapStrength(text, data.k ?? 1) : ''} />
          <span className="row" style={{ gap: 8, fontSize: 'calc(11.5px * var(--fs))' }}>启用<Switch label="启用画师串" on={data.enabled} onChange={v => updateData(id, { enabled: v }, true)} /></span>
        </div>
      </div>
    </div>
  );

  return (
    <NodeShell id={id} kind="artist" title={data.title} width={data.w ?? KINDS.artist.w} status={stat}
      className={`${data.enabled ? '' : 'is-off'} ${busy ? 'is-running' : ''}`}
      after={!wide && open ? <div className="apop" data-apop={id}><Library current={entry?.id} onPick={pick} onClose={() => setOpen(false)} /></div> : undefined}
      tools={[{ label: '生成封面', onClick: makeCoverNow }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <div className={`artn ${wide ? 'is-wide' : ''}`}>
        {wide && <Library current={entry?.id} onPick={pick} />}
        {main}
      </div>
    </NodeShell>
  );
}
export const ArtistNode = memo(ArtistNodeView);
