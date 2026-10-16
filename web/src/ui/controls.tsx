import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/** 数据类型的小记号：文字圆点、负面带横杠的圆点、角色菱形、图片方块、风格参考三点、精确参考圆环、画师串三角 */
export const Glyph = ({ t }: { t: 'text' | 'neg' | 'image' | 'char' | 'vibe' | 'ref' | 'artist' | 'none' }) => (
  <svg className="glyph" viewBox="0 0 10 10" aria-hidden="true">
    {t === 'text' ? <circle cx="5" cy="5" r="4" />
      : t === 'neg' ? <path d="M5 1a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm-2.4 3.2v1.6h4.8V4.2Z" fillRule="evenodd" />
      : t === 'char' ? <path d="M5 .5 9.5 5 5 9.5 .5 5Z" />
      : t === 'vibe' ? <><circle cx="1.8" cy="5" r="1.6" /><circle cx="5" cy="5" r="1.6" /><circle cx="8.2" cy="5" r="1.6" /></>
      : t === 'ref' ? <path d="M5 .8a4.2 4.2 0 1 1 0 8.4 4.2 4.2 0 0 1 0-8.4Zm0 2.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 0 0 0-3.6Z" fillRule="evenodd" />
      : t === 'artist' ? <path d="M5 .9 9.4 8.8H.6Z" />
      : <rect x="1" y="1" width="8" height="8" rx="1.6" />}
  </svg>
);

export function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label"><span>{label}</span>{value !== undefined && <span className="v">{value}</span>}</div>
      {children}
    </div>
  );
}

/** 分段选择器：选中块会平滑滑过去 */
export function Seg<T extends string | number>({ value, options, onChange, label }: { value: T; options: { v: T; l: ReactNode }[]; onChange: (v: T) => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [ind, setInd] = useState<{ x: number; w: number } | null>(null);
  useLayoutEffect(() => {
    const b = ref.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (b) setInd({ x: b.offsetLeft, w: b.offsetWidth });
  }, [value, options.length]);
  return (
    <div className="seg" ref={ref} role="group" aria-label={label}>
      {ind && <span className="seg-ind" style={{ width: ind.w, transform: `translateX(${ind.x}px)` }} />}
      {options.map(o => (
        <button key={String(o.v)} type="button" aria-pressed={o.v === value} onClick={() => o.v !== value && onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}

/** 点阵轨道的滑块。拖动中实时预览，松手时才算一次改动（方便撤销） */
export function Slider({ value, min, max, step, onChange, onCommit, label }: { value: number; min: number; max: number; step: number; onChange: (v: number) => void; onCommit?: () => void; label: string }) {
  return (
    <input className="slider nodrag" type="range" min={min} max={max} step={step} value={value} aria-label={label}
      style={{ ['--pct' as string]: `${((value - min) / (max - min)) * 100}%` }}
      onPointerDown={onCommit} onKeyDown={onCommit}
      onChange={e => onChange(+e.target.value)} />
  );
}

export function Switch({ on, onChange, label }: { on: boolean; onChange: (v: boolean) => void; label: string }) {
  return <button type="button" className="switch" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)} />;
}

export const Icons = {
  plus: <svg viewBox="0 0 12 12"><path d="M6 1.5v9M1.5 6h9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>,
  arrow: <svg className="arrow" viewBox="0 0 14 14"><path d="M7 12V2.5M2.8 6.5 7 2.3l4.2 4.2" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" /></svg>,
  stop: <svg className="stop" viewBox="0 0 14 14"><rect x="3.5" y="3.5" width="7" height="7" rx="1.5" fill="currentColor" /></svg>,
  play: <svg viewBox="0 0 16 16"><path d="M5 3.5v9l7-4.5z" fill="currentColor" /></svg>,
  lock: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="7" width="10" height="7" rx="2" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" /></svg>,
  dice: <svg viewBox="0 0 16 16"><rect x="1.75" y="1.75" width="12.5" height="12.5" rx="3" fill="none" stroke="currentColor" strokeWidth="1.5" /><g fill="currentColor"><circle cx="5.3" cy="5.3" r="1.1" /><circle cx="10.7" cy="10.7" r="1.1" /><circle cx="8" cy="8" r="1.1" /></g></svg>,
  undo: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M5.5 4 2.5 7l3 3" /><path d="M2.5 7h7a4 4 0 0 1 0 8h-2" /></svg>,
  redo: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d="M10.5 4l3 3-3 3" /><path d="M13.5 7h-7a4 4 0 0 0 0 8h2" /></svg>,
  fit: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"><path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" /></svg>,
  keys: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="1.5" y="4" width="13" height="8.5" rx="2" /><path d="M4 7h1M7 7h1M10 7h2M4.5 9.8h7" strokeLinecap="round" /></svg>,
  library: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="2" y="2" width="5" height="5" rx="1.2" /><rect x="9" y="2" width="5" height="5" rx="1.2" /><rect x="2" y="9" width="5" height="5" rx="1.2" /><rect x="9" y="9" width="5" height="5" rx="1.2" /></svg>,
  queue: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M2.5 4h11M2.5 8h11M2.5 12h6" /><circle cx="12.3" cy="12" r="1.3" fill="currentColor" stroke="none" /></svg>,
  chunks: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round"><rect x="2" y="2.5" width="8" height="5" rx="1.5" /><rect x="6" y="8.5" width="8" height="5" rx="1.5" /></svg>,
  theme: <svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M8 1.5a6.5 6.5 0 0 1 0 13z" fill="currentColor" /></svg>,
  gear: <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="2.2" /><path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7 3.6 3.6" strokeLinecap="round" /></svg>,
};
