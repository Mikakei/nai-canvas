import { useEffect, useState } from 'react';
import {
  MAX_PIXELS, MODELS, MODEL_KEYS, ORIENT_LABEL, SIZES, TIER_LABEL, UC_LABEL,
  apiModel, applyLocks, availableUc, clampSize, cost, defaultNoise, isMedium, maxSamples, noisesFor, randomSeed, samplersFor, sizeOf,
  swapSize, switchEffort, switchModel, withSize,
  type GenParams, type Orientation, type SizeTier,
} from '@nai/shared';
import { isGen } from '../graph.ts';
import { useExtras } from '../inputs.ts';
import { useShallow } from 'zustand/react/shallow';
import { pushUndo, toast, updateData, useStore } from '../store.ts';
import { Field, Icons, Seg, Slider, Switch } from './controls.tsx';
import { PromptEditor } from '../editor/PromptEditor.tsx';
import { DictButton } from './PromptDict.tsx';

const TIER_SHORT: Record<SizeTier, string> = { small: '小', normal: '标准', large: '大', wallpaper: '壁纸', custom: '自定义' };
const SWAP = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M4 2.5v11M1.8 4.7 4 2.5l2.2 2.2M12 13.5v-11M9.8 11.3 12 13.5l2.2-2.2" /></svg>;

/** 自定义宽高输入：失焦或回车时才取 64 的倍数，打字过程中不打断 */
function DimInput({ value, label, onCommit }: { value: number; label: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState(String(value));
  useEffect(() => setText(String(value)), [value]);
  const commit = () => { const v = parseInt(text, 10); if (Number.isFinite(v) && v > 0) onCommit(v); else setText(String(value)); };
  return <input className="input" inputMode="numeric" aria-label={label} value={text} onChange={e => setText(e.target.value.replace(/\D/g, ''))} onBlur={commit} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
}

/** 生图节点里的参数区：点节点下方的参数行展开、收起（以前是右侧的面板） */
export function ParamsPanel({ id }: { id: string }) {
  const n = useStore(s => s.nodes.find(m => m.id === id));
  const account = useStore(s => s.account);
  const negCount = useStore(s => s.edges.filter(e => e.target === id && e.data?.slot === 'negative').length);
  const charCount = useStore(s => s.edges.filter(e => e.target === id && e.data?.slot === 'chars').length);
  const hasBase = useStore(s => s.edges.some(e => e.target === id && e.data?.slot === 'base'));
  const vibeCount = useStore(s => s.edges.filter(e => e.target === id && e.data?.slot === 'vibes').length);
  const extras = useExtras(id);
  const inpaint = !!extras.inpaint;
  if (!isGen(n)) return null;
  const g = n;
  const raw = g.data.params, p = applyLocks(raw), m = MODELS[p.model], [w, h] = sizeOf(p), c = cost(p, account, extras);
  const medium = isMedium(p);
  const set = (patch: Partial<GenParams>, undoable = true) => updateData(g.id, { params: { ...raw, ...patch } }, undoable);
  const setAll = (next: GenParams) => updateData(g.id, { params: next }, true);
  const maxN = maxSamples(w, h);
  const changeModel = (key: GenParams['model']) => {
    const next = switchModel(raw, key);
    setAll(next);
    if (MODELS[key].family !== m.family) toast('提示词在不同版本之间不一定通用，换模型后可能需要调整');
    if (next.ucPreset !== raw.ucPreset) toast(`${MODELS[key].label} 没有 ${UC_LABEL[raw.ucPreset]} 预设，已换成 ${UC_LABEL[next.ucPreset]}`);
  };
  const lockedNote = <span className="note">Medium 档固定，切回 High 才能改</span>;

  return (
    <div className="gparams nodrag" aria-label="生图参数">
        <Field label="模型" value={m.note}>
          <select className="dd" value={p.model} aria-label="模型" onChange={e => changeModel(e.target.value as GenParams['model'])}>
            <optgroup label="推荐">{MODEL_KEYS.filter(k => !MODELS[k].legacy).map(k => <option key={k} value={k}>{MODELS[k].label}</option>)}</optgroup>
            <optgroup label="不再推荐">{MODEL_KEYS.filter(k => MODELS[k].legacy).map(k => <option key={k} value={k}>{MODELS[k].label}</option>)}</optgroup>
          </select>
        </Field>
        {m.apiMedium && (
          <Field label="Effort" value={medium ? '约省 42%，部分设置固定' : undefined}>
            <Seg label="Effort" value={p.effort} options={[{ v: 'high', l: 'HIGH' }, { v: 'medium', l: 'MEDIUM' }]} onChange={v => setAll(switchEffort(raw, v))} />
          </Field>
        )}
        {charCount > 0 && (
          <Field label="角色位置" value={`${charCount} 个角色`}>
            <Seg label="角色位置" value={p.charPos} options={[{ v: 'ai', l: 'AI 决定' }, { v: 'custom', l: '按角色节点上的位置' }]} onChange={v => set({ charPos: v })} />
          </Field>
        )}
        {inpaint && (
          <div className="insp-sub">
            <Field label="局部重绘 · 重绘强度" value={p.inpaintStrength.toFixed(2)}>
              <Slider label="重绘强度" min={0.01} max={1} step={0.01} value={p.inpaintStrength} onCommit={pushUndo} onChange={v => set({ inpaintStrength: v }, false)} />
              <span className="note">1 是完全重画遮罩里的内容；调低会保留原来的轮廓和颜色</span>
            </Field>
            <div className="row">保留原图<Switch label="保留原图" on={p.keepOriginal} onChange={v => set({ keepOriginal: v })} /></div>
            <span className="note">{p.keepOriginal ? '遮罩外完全不变，结果按羽化后的遮罩贴回原图' : '直接用生成结果：没有接缝，但遮罩外可能有轻微变化（聚焦重绘时总是贴回）'}{extras.size ? `；聚焦重绘按 ${extras.size[0]}×${extras.size[1]} 生成` : ''}</span>
          </div>
        )}
        {hasBase && !inpaint && (
          <div className="insp-sub">
            <Field label="图生图 · 重绘强度" value={p.strength.toFixed(2)}>
              <Slider label="重绘强度" min={0.01} max={0.99} step={0.01} value={p.strength} onCommit={pushUndo} onChange={v => set({ strength: v }, false)} />
              <span className="note">越大改得越多；越小越接近底图。底图会拉伸到下面的尺寸</span>
            </Field>
            <Field label="额外噪声" value={p.addNoise.toFixed(2)}>
              <Slider label="额外噪声" min={0} max={0.99} step={0.01} value={p.addNoise} onCommit={pushUndo} onChange={v => set({ addNoise: v }, false)} />
            </Field>
          </div>
        )}
        {vibeCount > 1 && m.vibe && <div className="row">风格参考强度归一化<Switch label="风格参考强度归一化" on={p.normalizeVibes} onChange={v => set({ normalizeVibes: v })} /></div>}
        {m.furryMode && <div className="row">Furry 模式<Switch label="Furry 模式" on={p.furry} onChange={v => set({ furry: v })} /></div>}

        <Field label="尺寸" value={`${w}×${h} · ${(w * h / 1e6).toFixed(2)} MP`}>
          <Seg label="档位" value={p.tier} options={(Object.keys(TIER_SHORT) as SizeTier[]).map(t => ({ v: t, l: TIER_SHORT[t] }))} onChange={v => setAll(withSize(raw, { tier: v }))} />
          {p.tier === 'custom' ? (
            <div className="seed">
              <DimInput label="宽" value={p.width} onCommit={v => { const [W, H] = clampSize(v, p.height); setAll(withSize(raw, { width: W, height: H })); if (v !== W) toast(`宽度已调整为 ${W}：需要是 64 的倍数，总像素不超过 ${MAX_PIXELS.toLocaleString()}`); }} />
              <DimInput label="高" value={p.height} onCommit={v => { const [W, H] = clampSize(p.width, v); setAll(withSize(raw, { width: W, height: H })); if (v !== H) toast(`高度已调整为 ${H}：需要是 64 的倍数，总像素不超过 ${MAX_PIXELS.toLocaleString()}`); }} />
              <button type="button" className="icon-btn" title="交换宽高" aria-label="交换宽高" onClick={() => setAll(swapSize(raw))}>{SWAP}</button>
            </div>
          ) : (
            <div className="seed">
              <div style={{ flex: 1, minWidth: 0 }}>
                <Seg label="方向" value={p.orient} options={(Object.keys(ORIENT_LABEL) as Orientation[]).filter(o => SIZES[p.tier as Exclude<SizeTier, 'custom'>][o]).map(o => ({ v: o, l: ORIENT_LABEL[o] }))} onChange={v => setAll(withSize(raw, { orient: v }))} />
              </div>
              <button type="button" className="icon-btn" title="交换宽高" aria-label="交换宽高" disabled={p.orient === 'square'} onClick={() => setAll(swapSize(raw))}>{SWAP}</button>
            </div>
          )}
          <span className="note">{TIER_LABEL[p.tier]}{p.tier !== 'custom' ? ` · ${ORIENT_LABEL[p.orient]}` : ''}{w * h > 1048576 ? ' · 超过 1MP，Opus 不再免费' : ''}</span>
        </Field>

        <div className="two">
          <Field label="步数" value={p.steps}>
            {medium ? lockedNote : <Slider label="步数" min={1} max={50} step={1} value={p.steps} onCommit={pushUndo} onChange={v => set({ steps: v }, false)} />}
          </Field>
          <Field label="张数" value={maxN < 8 ? `最多 ${maxN}` : undefined}>
            <select className="dd" value={p.nSamples} aria-label="张数" onChange={e => set({ nSamples: +e.target.value })}>
              {Array.from({ length: maxN }, (_, i) => i + 1).map(v => <option key={v} value={v}>{v} 张</option>)}
            </select>
          </Field>
        </div>

        <Field label="种子" value={p.seedLocked ? '已锁定' : '每次运行随机'}>
          <div className="seed">
            <input className="input" inputMode="numeric" aria-label="种子" value={p.seed} onFocus={pushUndo}
              onChange={e => { const v = parseInt(e.target.value.replace(/\D/g, '') || '0', 10); set({ seed: Math.min(v, 4294967295), seedLocked: true }, false); }} />
            <button type="button" className="icon-btn" aria-pressed={p.seedLocked} title="锁定种子：每次都用这个种子" aria-label="锁定种子"
              onClick={() => { set({ seedLocked: !p.seedLocked }); toast(p.seedLocked ? '种子已解锁，每次运行换一个' : '种子已锁定，每次都用这个种子'); }}>{Icons.lock}</button>
            <button type="button" className="icon-btn" title="换一个随机种子" aria-label="换一个随机种子"
              onClick={e => { const b = e.currentTarget; b.classList.remove('is-spin'); void b.offsetWidth; b.classList.add('is-spin'); set({ seed: randomSeed() }); }}>{Icons.dice}</button>
          </div>
        </Field>

        <Field label="负面提示词" value={UC_LABEL[p.ucPreset]}>
          {medium ? <>{lockedNote}<span className="note">Medium 档固定使用 Heavy 预设，不能写自定义内容</span></> : <>
            <select className="dd" value={p.ucPreset} aria-label="UC 预设" onChange={e => set({ ucPreset: e.target.value as GenParams['ucPreset'] })}>
              {availableUc(p.model).map(u => <option key={u} value={u}>{u === 'none' ? UC_LABEL[u] : `预设：${UC_LABEL[u]}`}</option>)}
            </select>
            {negCount > 0 && <span className="note">还接了 {negCount} 个负面提示词节点，会排在这里写的内容前面</span>}
            <PromptEditor key={g.id} className="ta-box" label="负面提示词" model={apiModel(p.model, p.effort)} placeholder="不想出现的内容，接在预设后面。也可以添加负面提示词节点连过来" value={p.negative}
              onChange={v => set({ negative: v }, false)}
              onCommit={b => { const now = raw.negative; updateData(g.id, { params: { ...raw, negative: b } }); pushUndo(); updateData(g.id, { params: { ...raw, negative: now } }); }} />
            <div className="gp-dict"><DictButton kind="neg" value={p.negative} onChange={t => updateData(g.id, { params: { ...raw, negative: t } }, true)}
              editor={() => document.querySelector(`.react-flow__node[data-id="${g.id}"] .gparams .cm-editor`)} /></div>
          </>}
        </Field>

        <div className="row">质量标签<Switch label="质量标签" on={p.quality} onChange={v => set({ quality: v })} /></div>
        {m.qualityLight && p.quality && (
          <Seg label="质量标签档位" value={p.qualityLight ? 'light' : 'standard'} options={[{ v: 'standard', l: 'STANDARD' }, { v: 'light', l: 'LIGHT' }]} onChange={v => set({ qualityLight: v === 'light' })} />
        )}
        {m.transparent && <div className="row">透明背景<Switch label="透明背景" on={p.transparent} onChange={v => set({ transparent: v })} /></div>}

        <details className="gp-more">
          <summary>更多：遵循度、采样器{m.varietySigma !== undefined ? '、Variety+' : ''}</summary>
          <Field label="提示词遵循度" value={p.scale.toFixed(1)}><Slider label="提示词遵循度" min={0} max={10} step={0.1} value={p.scale} onCommit={pushUndo} onChange={v => set({ scale: v }, false)} /></Field>
          {!medium && <Field label="遵循度校正" value={p.cfgRescale.toFixed(2)}><Slider label="遵循度校正" min={0} max={1} step={0.02} value={p.cfgRescale} onCommit={pushUndo} onChange={v => set({ cfgRescale: v }, false)} /></Field>}
          <div className="two">
            <Field label="采样器">
              {medium ? lockedNote : (
                <select className="dd" value={p.sampler} aria-label="采样器" onChange={e => { const s = e.target.value as GenParams['sampler']; set({ sampler: s, noise: defaultNoise(s) }); }}>
                  {samplersFor(p.model).map(s => <option key={s.id} value={s.id}>{s.label}</option>)}
                </select>
              )}
            </Field>
            {m.noiseSchedule && (
              <Field label="噪声计划">
                <select className="dd" value={p.noise} aria-label="噪声计划" onChange={e => set({ noise: e.target.value as GenParams['noise'] })}>
                  {noisesFor(p.model, p.sampler).map(s => <option key={s} value={s}>{s[0].toUpperCase() + s.slice(1)}</option>)}
                </select>
              </Field>
            )}
          </div>
          {m.varietySigma !== undefined && <div className="row">Variety+<Switch label="Variety+" on={p.variety} onChange={v => set({ variety: v })} /></div>}
        </details>
      <div className="costbox gp-cost">
        <span className="lab">本次消耗</span>
        <div className="cbig"><span className="num">{c.total}</span><span className="lab">ANLAS</span></div>
        <span className="note">
          {c.tooLarge ? `每张 ${c.perImage}，超过官网上限 140，请减小尺寸或步数`
            : c.total === 0 ? 'Opus 免费：不超过 1MP、不超过 28 步，每次第一张免费'
            : c.free ? `每张 ${c.perImage}，第一张免费` : `每张 ${c.perImage}${account && account.tier < 3 ? '' : extras.refs ? '。用了精确参考不再免费' : '。超过 1MP 或 28 步就不再免费'}`}
          {c.extra > 0 && `；参考图另加 ${c.extra}${extras.encodes ? `（含 ${extras.encodes} 个风格参考首次编码）` : ''}`}
          {extras.inpaint ? '；局部重绘按重绘强度打折' : extras.base && '；图生图按重绘强度打折'}
        </span>
      </div>
    </div>
  );
}
