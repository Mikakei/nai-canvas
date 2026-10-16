import { useState, type ReactNode } from 'react';
import type { Pic } from '../graph.ts';
import { pickFiles } from '../images.ts';
import { handleFiles } from '../files.ts';

/**
 * 节点里的图片区：有图时显示图，没图时是上传区（点击选择文件，也可以把图片拖进来）。
 * from 表示图来自接进来的节点，这时不能在这里换图
 */
export function PicArea({ id, pic, from, empty, children, ratio, overlay, blank }: { id: string; pic: Pic | null; from?: string; empty: string; children?: ReactNode; ratio?: number; overlay?: ReactNode; blank?: ReactNode }) {
  const [over, setOver] = useState(false);
  const pick = async () => { const f = await pickFiles('image/*'); if (f.length) handleFiles(f, undefined, id); };
  const ar = pic ? pic.iw / pic.ih : ratio ?? 1;
  return (
    <div className={`media pic ${over ? 'is-over' : ''}`} style={{ aspectRatio: String(ar) }}
      onDragEnter={e => { if (!from && e.dataTransfer.types.includes('Files')) setOver(true); }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={() => setOver(false)}>
      {pic ? <img src={pic.url} alt="" draggable={false} /> : (
        <button type="button" className="drop nodrag" onClick={pick}>
          <b>+</b><span>{empty}</span><small>点击选择 · 拖入 · 选中后 Ctrl+V 粘贴</small>
        </button>
      )}
      {!pic && blank}
      {pic && overlay}
      {from && <span className="from">来自「{from}」</span>}
      {pic && <div className="acts nodrag">{!from && <button type="button" onClick={pick}>换一张</button>}{children}</div>}
    </div>
  );
}
