import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { ENHANCE_LEVELS, MODELS, applyLocks, cost, enhanceScales, enhanceSize, sizeParams, type EnhanceScale, type ImportedMeta } from '@nai/shared';
import { isGen } from '../graph.ts';
import { extrasFor } from '../inputs.ts';
import { applyImport, currentPic, enhance, type ImportPick } from '../imageActions.ts';
import { node, useStore, type Modal } from '../store.ts';
import { Seg, Slider } from './controls.tsx';
import { Editor } from '../paint/Editor.tsx';

const close = () => useStore.setState({ modal: null });

export function Modals() {
  const modal = useStore(s => s.modal);
  if (!modal) return null;
  if (modal.kind === 'editor') return <Editor key={modal.id} id={modal.id} runAfter={modal.run} mode={modal.mode} blank={modal.blank} />;
  return (
    <div className="overlay" onPointerDown={e => { if (e.target === e.currentTarget) close(); }} onKeyDown={e => { if (e.key === 'Escape') close(); }}>
      {modal.kind === 'enhance' ? <Enhance id={modal.id} /> : <Import m={modal} />}
    </div>
  );
}

const SCALE_LABEL = (s: EnhanceScale) => (s === 'max' ? 'MAX' : `${s}×`);

function Enhance({ id }: { id: string }) {
  const g = node(id), pic = currentPic(id);
  const account = useStore(s => s.account);
  const nodes = useStore(s => s.nodes), edges = useStore(s => s.edges);
  const [mag, setMag] = useState(3);
  const [adv, setAdv] = useState(false);
  const scales = pic && isGen(g) ? enhanceScales(pic.iw, pic.ih, g.data.params.model) : [];
  const [scale, setScale] = useState<EnhanceScale>(scales.includes(1.5) ? 1.5 : scales[0] ?? 1);
  const [lv, setLv] = useState(ENHANCE_LEVELS[3]);
  if (!pic || !isGen(g)) return null;
  const [w, h] = enhanceSize(pic.iw, pic.ih, scale);
  const p = applyLocks({ ...g.data.params, ...sizeParams(w, h), strength: lv.strength, nSamples: 1 });
  const c = cost(p, account, { ...extrasFor(id, nodes, edges), base: true });
  const pickMag = (v: number) => { setMag(v); setLv(ENHANCE_LEVELS[v]); };
  return (
    <div className="dialog is-small" role="dialog" aria-label="增强">
      <h2>增强这张图<button type="button" className="x-btn" aria-label="关闭" onClick={close}>×</button></h2>
      <p>用当前的提示词，在放大后的尺寸上用较低的强度重画一遍，补细节、修小瑕疵。结果会进「{g.data.title}」的历史。</p>
      <div className="mgrid">
        <div className="field">
          <div className="field-label"><span>力度</span><span className="v">Strength {lv.strength} · Noise {lv.noise}</span></div>
          <Seg label="力度" value={mag} options={[1, 2, 3, 4, 5].map(v => ({ v, l: String(v) }))} onChange={pickMag} />
          <span className="note">越大改动越多：1 只修细节，5 可能会改变构图</span>
        </div>
        <div className="field">
          <div className="field-label"><span>放大</span><span className="v">{pic.iw}×{pic.ih} → {w}×{h}</span></div>
          <Seg label="放大倍率" value={scale} options={scales.map(s => ({ v: s, l: SCALE_LABEL(s) }))} onChange={setScale} />
          {scale === 'max' && <span className="note">MAX：保持尺寸生成，再由 NovelAI 放大（V5 专有）</span>}
        </div>
        <button type="button" className="linkish" style={{ justifySelf: 'start' }} onClick={() => setAdv(!adv)}>{adv ? '收起' : '分别调整强度和噪声'}</button>
        {adv && (
          <div className="two">
            <div className="field"><div className="field-label"><span>Strength</span><span className="v">{lv.strength.toFixed(2)}</span></div><Slider label="Strength" min={0.01} max={0.99} step={0.01} value={lv.strength} onChange={v => setLv({ ...lv, strength: v })} /></div>
            <div className="field"><div className="field-label"><span>Noise</span><span className="v">{lv.noise.toFixed(2)}</span></div><Slider label="Noise" min={0} max={0.99} step={0.01} value={lv.noise} onChange={v => setLv({ ...lv, noise: v })} /></div>
          </div>
        )}
      </div>
      <div className="actions">
        <span className="note" style={{ marginRight: 'auto', alignSelf: 'center' }}>{c.tooLarge ? '超过单张 140 Anlas 上限' : c.total === 0 ? 'Opus 免费' : `${c.total} Anlas`}</span>
        <button type="button" className="btn" onClick={close}>取消</button>
        <button type="button" className="btn is-primary" disabled={c.tooLarge} onClick={() => { close(); enhance(id, mag, scale, adv ? lv : undefined); }}>增强</button>
      </div>
    </div>
  );
}

const PICKS: { k: keyof ImportPick; l: string; show?: (m: ImportedMeta) => boolean; n?: (m: ImportedMeta) => string }[] = [
  { k: 'prompt', l: '提示词' },
  { k: 'negative', l: '负面提示词' },
  { k: 'settings', l: '设置（模型、尺寸、步数、采样器等）' },
  { k: 'seed', l: '种子', show: m => m.seed !== undefined, n: m => String(m.seed) },
  { k: 'characters', l: '角色', show: m => m.characters.length > 0, n: m => `${m.characters.length} 个` },
  { k: 'vibes', l: '风格参考（只有编码）', show: m => m.vibes.length > 0, n: m => `${m.vibes.length} 个` },
  { k: 'clean', l: '清理括号：去掉 [] {}，逗号后补空格' },
];

function Import({ m: modal }: { m: Extract<Modal, { kind: 'import' }> }) {
  const meta = modal.meta;
  const [pick, setPick] = useState<ImportPick>({ prompt: true, negative: true, settings: true, seed: true, characters: true, vibes: true, clean: false });
  const sel = useStore(useShallow(s => s.nodes.filter(n => n.selected && isGen(n))));
  const into = sel.length === 1 ? sel[0] : null;
  const model = meta.params.model ? MODELS[meta.params.model] : null;
  const w = meta.params.width, h = meta.params.height;
  return (
    <div className="dialog is-small" role="dialog" aria-label="导入生成信息">
      <h2>这张图带有生成信息<button type="button" className="x-btn" aria-label="关闭" onClick={close}>×</button></h2>
      <p className="meta-sum">
        <b>{model?.label ?? '未知模型'}{meta.unknownModel ? '（没认出来，按 V4.5 Full 处理）' : ''}</b>
        {w && h ? ` · ${w}×${h}` : ''}{meta.params.steps ? ` · ${meta.params.steps} 步` : ''}{meta.img2img ? ' · 图生图' : ''}{meta.refCount ? ` · 用了 ${meta.refCount} 个精确参考（参考图没有保存在图里）` : ''}
      </p>
      <p className="meta-prompt">{meta.prompt || '（没有提示词）'}</p>
      <div className="checks">
        {PICKS.filter(p => !p.show || p.show(meta)).map(p => (
          <label key={p.k} className="check">
            <input type="checkbox" checked={pick[p.k]} onChange={e => setPick({ ...pick, [p.k]: e.target.checked })} />
            <span>{p.l}</span>{p.n && <em>{p.n(meta)}</em>}
          </label>
        ))}
      </div>
      <div className="actions">
        <button type="button" className="btn" style={{ marginRight: 'auto' }} onClick={close}>只当图片用</button>
        {into && <button type="button" className="btn" onClick={() => { close(); applyImport(modal.nodeId, meta, pick, into.id); }}>导入到「{into.data.title}」</button>}
        <button type="button" className="btn is-primary" onClick={() => { close(); applyImport(modal.nodeId, meta, pick); }}>还原成节点</button>
      </div>
    </div>
  );
}
