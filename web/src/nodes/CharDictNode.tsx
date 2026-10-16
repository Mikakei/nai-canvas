import { memo, useEffect, useMemo, useState } from 'react';
import type { NodeProps } from '@xyflow/react';
import { KINDS, type CharDictNode as CDN } from '../graph.ts';
import { addChar, charPrompt, deleteChar, exportPresets, importPresets, setCharCover, updateChar, type CharEntry } from '../presets.ts';
import { coverBusy, coverCostLabel, fillCover, generateCover } from '../coverGen.ts';
import { usePrefs } from '../prefs.ts';
import { toast, updateData, useStore } from '../store.ts';
import { dupNodes, removeNodes } from '../actions.ts';
import { pickFiles } from '../images.ts';
import { PromptEditor } from '../editor/PromptEditor.tsx';
import { placeChar, startCharDrag } from '../ui/DragImage.tsx';
import { NodeShell } from './NodeShell.tsx';

const WIDE = 680;

function NoCover({ name }: { name: string }) {
  return <span className="acv-none"><b>{(name.trim()[0] ?? '角').toUpperCase()}</b></span>;
}

/** 右边（窄的时候盖在上面）编辑选中的角色 */
function Detail({ entry, nodeId, narrow, onBack }: { entry: CharEntry; nodeId: string; narrow: boolean; onBack: () => void }) {
  const [outfit, setOutfit] = useState(entry.outfits.length ? 0 : -1);
  useEffect(() => { setOutfit(entry.outfits.length ? 0 : -1); }, [entry.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const busy = useStore(s => s.runtime[nodeId]?.status === 'running');
  const chars = useStore(s => s.characters);
  const series = useMemo(() => [...new Set(chars.map(c => c.series.trim()).filter(Boolean))], [chars]);
  const prefs = usePrefs();
  const set = (p: Partial<CharEntry>) => updateChar(entry.id, p);
  const setOutfitAt = (i: number, p: Partial<CharEntry['outfits'][number]>) => set({ outfits: entry.outfits.map((o, j) => (j === i ? { ...o, ...p } : o)) });
  const genCover = () => {
    if (coverBusy(nodeId)) return;
    generateCover({ statusId: nodeId, title: entry.name, prompt: fillCover(prefs.charCover, '{角色}', charPrompt(entry, outfit)), onCover: url => set({ cover: url }) });
  };
  const pickCover = async () => { const f = await pickFiles('image/*'); if (f[0]) setCharCover(entry.id, f[0]); };
  return (
    <div className="cd-edit">
      {narrow && <button type="button" className="tg" style={{ justifySelf: 'start' }} onClick={onBack}>‹ 返回</button>}
      <div className="cd-head">
        <div className={`cd-bigcover ${busy ? 'is-busy' : ''}`} title="把图拖到这里换封面" onPointerDown={e => startCharDrag(e, entry, outfit)}>
          {entry.cover ? <img src={entry.cover} alt="" draggable={false} /> : <NoCover name={entry.name} />}
          {busy && <div className="acv-busy"><i /><span>生成封面中</span></div>}
        </div>
        <div className="cd-fields">
          <label className="ameta-row"><span>名字</span><input className="input" value={entry.name} aria-label="角色名字" onChange={e => set({ name: e.target.value })} /></label>
          <label className="ameta-row"><span>作品</span><input className="input" list={`cs-${nodeId}`} value={entry.series} placeholder="比如 原创、VOCALOID" aria-label="作品" onChange={e => set({ series: e.target.value })} /></label>
          <datalist id={`cs-${nodeId}`}>{series.map(s => <option key={s} value={s} />)}</datalist>
          <div className="cd-drag" onPointerDown={e => startCharDrag(e, entry, outfit)} title="拖到画布空白处、生图节点或角色节点上">
            <i aria-hidden="true" />拖出去用{outfit >= 0 && entry.outfits[outfit] ? `（带「${entry.outfits[outfit].name || '服装'}」）` : ''}
          </div>
          <div className="cd-acts">
            <button type="button" className="btn sm is-primary" onClick={() => placeChar(entry, outfit, nodeId)}>放到画布</button>
            <button type="button" className="btn sm" disabled={busy} onClick={genCover}>生成封面 · {coverCostLabel()}</button>
            <button type="button" className="btn sm" onClick={pickCover}>换封面…</button>
          </div>
        </div>
      </div>
      <div className="field">
        <div className="field-label"><span>角色提示词 · 设定</span><span className="v">外貌、身份这些不变的</span></div>
        <PromptEditor key={`p-${entry.id}`} className="ta-box" label="角色提示词" character value={entry.prompt} placeholder="比如 hatsune miku, vocaloid, long hair, twintails, aqua hair" onChange={v => set({ prompt: v })} />
      </div>
      <div className="field">
        <div className="field-label"><span>角色负面</span></div>
        <PromptEditor key={`u-${entry.id}`} className="ta-box" label="角色负面提示词" value={entry.uc} placeholder="这个角色不想出现的内容（可以不填）" onChange={v => set({ uc: v })} />
      </div>
      <div className="field">
        <div className="field-label"><span>服装 / 形态</span><span className="v">拖出去时带上选中的那套</span></div>
        <div className="cd-outfits">
          <button type="button" className={`cd-o-pick ${outfit < 0 ? 'is-on' : ''}`} onClick={() => setOutfit(-1)}>不带服装</button>
          {entry.outfits.map((o, i) => (
            <div key={i} className={`cd-o ${outfit === i ? 'is-on' : ''}`}>
              <button type="button" className="cd-o-dot" aria-label={`拖出时带这套：${o.name}`} aria-pressed={outfit === i} onClick={() => setOutfit(i)} />
              <input className="input cd-o-name" value={o.name} placeholder="名字" aria-label="服装名字" onChange={e => setOutfitAt(i, { name: e.target.value })} />
              <input className="input cd-o-tags" value={o.tags} placeholder="比如 maid, frilled apron" aria-label="服装提示词" onChange={e => setOutfitAt(i, { tags: e.target.value })} />
              <button type="button" className="arow-x" aria-label="删掉这套" onClick={() => { set({ outfits: entry.outfits.filter((_, j) => j !== i) }); if (outfit >= i) setOutfit(outfit - 1); }}>×</button>
            </div>
          ))}
          <button type="button" className="linkish" onClick={() => { set({ outfits: [...entry.outfits, { name: entry.outfits.length ? `服装 ${entry.outfits.length + 1}` : '默认', tags: '' }] }); setOutfit(entry.outfits.length); }}>+ 加一套</button>
        </div>
      </div>
      <div className="field">
        <div className="field-label"><span>备注</span></div>
        <textarea className="ta ta-box cd-note" value={entry.note ?? ''} placeholder="出处、画法心得…" aria-label="备注" onChange={e => set({ note: e.target.value })} />
      </div>
      <div className="cd-acts">
        <button type="button" className="btn sm" onClick={() => addChar({ ...entry, id: undefined, name: `${entry.name} 副本`, created: Date.now() })}>复制一份</button>
        <button type="button" className="btn sm is-danger" onClick={() => deleteChar(entry.id)}>从字典删掉</button>
      </div>
      <p className="note">最终的角色提示词 = 设定 + 选中的服装。拖出去以后是一个普通的角色节点，可以在上面接着加动作、表情；改这里不会影响已经拖出去的节点。</p>
    </div>
  );
}

function CharDictNodeView({ id, data }: NodeProps<CDN>) {
  const all = useStore(s => s.characters);
  const [peek, setPeek] = useState(false);
  const wide = (data.w ?? KINDS.chardict.w) >= WIDE;
  const q = (data.q ?? '').trim().toLowerCase(), series = data.series ?? '';
  const allSeries = useMemo(() => [...new Set(all.map(c => c.series.trim()))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b)), [all]);
  const list = all.filter(c => (!series || c.series.trim() === series) && (!q || `${c.name} ${c.series} ${c.prompt} ${c.outfits.map(o => o.tags).join(' ')}`.toLowerCase().includes(q)));
  const groups = [...new Set(list.map(c => c.series.trim()))].sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || a.localeCompare(b));
  const sel = all.find(c => c.id === data.sel) ?? null;
  const select = (c: CharEntry) => { updateData(id, { sel: c.id }); if (!wide) setPeek(true); };
  const create = () => { const e = addChar({ series }); select(e); toast('新建了一个角色：填好名字和角色提示词，就能拖出去用了'); };
  const importLib = async () => { const f = await pickFiles('.zip,.json,application/zip,application/json'); if (f[0]) importPresets('characters', f[0]); };
  return (
    <NodeShell id={id} kind="chardict" title={data.title} width={data.w ?? KINDS.chardict.w} status={`${all.length} 个角色`}
      tools={[{ label: '新建角色', onClick: create }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <div className={`cdict box-resize ${wide ? 'is-wide' : ''} ${peek && !wide ? 'is-peek' : ''}`} style={{ height: data.h }}>
        <div className="cd-bar nodrag">
          <input className="input" value={data.q ?? ''} placeholder="搜名字、作品、外貌…" aria-label="搜角色" onChange={e => updateData(id, { q: e.target.value })} />
          <select className="dd" value={series} aria-label="作品" onChange={e => updateData(id, { series: e.target.value })}>
            <option value="">全部作品</option>
            {allSeries.filter(Boolean).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <button type="button" className="btn sm is-primary" onClick={create}>+ 新建角色</button>
          <button type="button" className="tg" onClick={importLib}>导入</button>
          <button type="button" className="tg" onClick={() => exportPresets('characters')}>导出</button>
        </div>
        <div className="cd-body nodrag nowheel">
          <div className="cd-list">
            {groups.map(g => (
              <section key={g || '_'}>
                <div className="cd-g">{g || '没填作品'}</div>
                <div className="cd-grid">
                  {list.filter(c => c.series.trim() === g).map(c => (
                    <div key={c.id} className={`cd-card ${c.id === data.sel ? 'is-sel' : ''}`} title="点一下编辑；拖出去用"
                      onPointerDown={e => startCharDrag(e, c, c.outfits.length ? 0 : -1, () => select(c))}>
                      <span className="cd-cover">{c.cover ? <img src={c.cover} alt="" draggable={false} /> : <NoCover name={c.name} />}</span>
                      <b>{c.name}</b>
                      <small>{c.outfits.length ? `${c.outfits.length} 套服装` : c.series || ' '}</small>
                    </div>
                  ))}
                </div>
              </section>
            ))}
            {!all.length && <p className="cd-empty">角色字典还是空的。点"新建角色"写一个；也可以在任意角色节点上右键"存进角色字典"。</p>}
            {all.length > 0 && !list.length && <p className="cd-empty">没有符合的角色</p>}
          </div>
          {(wide || peek) && (
            <div className="cd-detail">
              {sel ? <Detail entry={sel} nodeId={id} narrow={!wide} onBack={() => setPeek(false)} />
                : <p className="cd-empty">点一个角色在这里编辑；把卡片拖到画布空白处、生图节点或角色节点上就能用。</p>}
            </div>
          )}
        </div>
      </div>
    </NodeShell>
  );
}
export const CharDictNode = memo(CharDictNodeView);
