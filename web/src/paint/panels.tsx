import { useEffect, useRef, useState } from 'react';
import type { Layer, PaintDoc } from './doc.ts';
import { Slider } from '../ui/controls.tsx';

/** Nothing 风格的常用色：黑白灰 + 一点红，再加几个基础色 */
export const PALETTE = ['#000000', '#3a3a3a', '#7a7a7a', '#bdbdbd', '#ffffff', '#d71921', '#f2a03d', '#f5d547', '#58b368', '#3d7bd9', '#7d4fd6', '#f4c7b8'];

/** 图层缩略图：版本号变了才重画 */
function Thumb({ layer, ver, w, h }: { layer: Layer; ver: number; w: number; h: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current; if (!c) return;
    const g = c.getContext('2d')!;
    g.clearRect(0, 0, c.width, c.height);
    g.drawImage(layer.canvas, 0, 0, c.width, c.height);
  }, [layer, ver, w, h]);
  const tw = 40, th = Math.max(16, Math.min(56, Math.round((40 * h) / w)));
  return <canvas ref={ref} width={tw} height={th} className="lthumb" />;
}

const EYE = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8s-2.4 4.5-6.5 4.5S1.5 8 1.5 8Z" /><circle cx="8" cy="8" r="1.9" /></svg>;
const EYE_OFF = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 2.5l11 11M6.2 4A6.7 6.7 0 0 1 8 3.5c4.1 0 6.5 4.5 6.5 4.5a11 11 0 0 1-1.8 2.3M10 12.1A6.4 6.4 0 0 1 8 12.5C3.9 12.5 1.5 8 1.5 8a11.3 11.3 0 0 1 2.4-2.9" /></svg>;

/** 图层面板：最上面的图层排在最前 */
export function LayersPanel({ doc, ver }: { doc: PaintDoc; ver: number }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const l = doc.layer;
  const rows = doc.layers.map((layer, i) => ({ layer, i })).reverse();
  return (
    <div className="field layers">
      <div className="field-label"><span>图层</span><span className="v">{doc.layers.length} 层</span></div>
      <div className="lrows">
        {rows.map(({ layer, i }) => (
          <div key={layer.id} className={`lrow ${i === doc.active ? 'is-act' : ''} ${layer.visible ? '' : 'is-hidden'}`} onClick={() => { if (doc.active !== i) { doc.commitFloating(); doc.active = i; doc.bump(); } }}>
            <button type="button" className="leye" aria-label={layer.visible ? '隐藏图层' : '显示图层'} onClick={e => { e.stopPropagation(); doc.structural(() => { layer.visible = !layer.visible; }); }}>{layer.visible ? EYE : EYE_OFF}</button>
            <Thumb layer={layer} ver={ver} w={doc.W} h={doc.H} />
            {editing === layer.id ? (
              <input className="input lname" autoFocus defaultValue={layer.name} aria-label="图层名称"
                onBlur={e => { const v = e.target.value.trim(); if (v && v !== layer.name) doc.structural(() => { layer.name = v; }); setEditing(null); }}
                onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); if (e.key === 'Escape') { (e.target as HTMLInputElement).value = layer.name; setEditing(null); } e.stopPropagation(); }} />
            ) : <span className="lname" onDoubleClick={() => setEditing(layer.id)} title="双击改名">{layer.name}</span>}
            {layer.opacity < 1 && <em>{Math.round(layer.opacity * 100)}%</em>}
          </div>
        ))}
      </div>
      {l && (
        <div className="lopa">
          <span>不透明度</span>
          <Slider label="图层不透明度" min={0} max={1} step={0.01} value={l.opacity}
            onCommit={() => setStart(l.opacity)}
            onChange={v => { l.opacity = v; doc.bump(); }} />
          <b>{Math.round(l.opacity * 100)}%</b>
        </div>
      )}
      {start !== null && <OpacityCommit doc={doc} from={start} onDone={() => setStart(null)} />}
      <div className="lbtns">
        <button type="button" onClick={() => doc.newLayer()} title="在当前图层上面新建">新建</button>
        <button type="button" onClick={() => doc.duplicateLayer()}>复制</button>
        <button type="button" onClick={() => doc.mergeDown()} disabled={doc.active < 1} title="合并到下面的图层">向下合并</button>
        <button type="button" onClick={() => doc.moveLayer(doc.active, 1)} disabled={doc.active >= doc.layers.length - 1} aria-label="上移">↑</button>
        <button type="button" onClick={() => doc.moveLayer(doc.active, -1)} disabled={doc.active < 1} aria-label="下移">↓</button>
        <button type="button" onClick={() => doc.removeLayer()} disabled={doc.layers.length < 2} className="is-danger">删除</button>
      </div>
    </div>
  );
}

/** 拖动不透明度滑块松手后，记一步撤销（拖动过程中直接改，不记） */
function OpacityCommit({ doc, from, onDone }: { doc: PaintDoc; from: number; onDone: () => void }) {
  const done = useRef(onDone); done.current = onDone;
  useEffect(() => {
    const up = () => {
      const l = doc.layer, to = l.opacity;
      if (to !== from) { l.opacity = from; doc.structural(() => { l.opacity = to; }); }
      done.current();
    };
    window.addEventListener('pointerup', up, { once: true });
    window.addEventListener('keyup', up, { once: true });
    return () => { window.removeEventListener('pointerup', up); window.removeEventListener('keyup', up); };
  }, [doc, from]);
  return null;
}

/** 颜色：当前色（点开是系统取色器）、常用色、最近用过的颜色 */
export function ColorPanel({ color, recent, onChange }: { color: string; recent: string[]; onChange: (c: string) => void }) {
  return (
    <div className="field">
      <div className="field-label"><span>颜色</span><span className="v">{color.toUpperCase()}</span></div>
      <div className="colors">
        <label className="cur" style={{ background: color }} title="选择颜色">
          <input type="color" value={color} onChange={e => onChange(e.target.value)} aria-label="选择颜色" />
        </label>
        <div className="swatches">
          {PALETTE.map(c => <button key={c} type="button" style={{ background: c }} aria-label={c} aria-pressed={c === color} onClick={() => onChange(c)} />)}
        </div>
      </div>
      {recent.length > 0 && (
        <div className="swatches is-recent">
          {recent.map(c => <button key={c} type="button" style={{ background: c }} aria-label={`最近用过 ${c}`} onClick={() => onChange(c)} />)}
        </div>
      )}
      <span className="note">Ctrl+点击画面取色</span>
    </div>
  );
}
