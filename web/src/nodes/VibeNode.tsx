import { memo, useEffect } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { MODELS, VIBE_ENCODE_COST, vibeModelKey } from '@nai/shared';
import { KINDS, isGen, refPic, type VibeNode as VN } from '../graph.ts';
import { isEncoded, syncVibe } from '../inputs.ts';
import { pushUndo, updateData, useStore } from '../store.ts';
import { dupNodes, removeNodes } from '../actions.ts';
import { exportVibes } from '../imageActions.ts';
import { Slider, Switch } from '../ui/controls.tsx';
import { NodeShell } from './NodeShell.tsx';
import { PicArea } from './PicArea.tsx';

const MK_LABEL: Record<string, string> = { v4full: 'V4 Full', v4curated: 'V4 Curated', 'v4-5full': 'V4.5 Full', 'v4-5curated': 'V4.5 Curated' };

function VibeNodeView({ id, data }: NodeProps<VN>) {
  const pic = useStore(useShallow(s => refPic(id, s.nodes, s.edges)));
  // 接到的生图节点用的模型：决定"编码过没有"
  const models = useStore(useShallow(s => s.edges.filter(e => e.source === id).map(e => s.nodes.find(n => n.id === e.target)).filter(isGen).map(g => g.data.params.model)));
  const encoded = useStore(useShallow(s => { const n = s.nodes.find(m => m.id === id); return n && n.type === 'vibe' ? models.map(m => isEncoded(n, m, s.nodes, s.edges)) : []; }));
  const url = pic?.url;
  useEffect(() => { if (url) syncVibe(id); }, [id, url]);

  const usable = models.filter(m => MODELS[m].vibe);
  const need = usable.filter((_, i) => !encoded[i]);
  let stat = '未接入';
  if (!data.enabled) stat = '已停用';
  else if (usable.length) stat = need.length ? `首次使用编码 ${VIBE_ENCODE_COST} ANLAS` : '已编码';
  else if (models.length) stat = '当前模型不支持';
  const encKeys = Object.entries(data.enc ?? {}).map(([k, v]) => `${MK_LABEL[k] ?? k}${v === 'any' ? '' : ` × ${v.length}`}`);

  return (
    <NodeShell id={id} kind="vibe" title={data.title} width={data.w ?? KINDS.vibe.w} status={stat} className={data.enabled ? '' : 'is-off'}
      tools={[{ label: '导出', onClick: () => exportVibes([id]) }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      {data.encodingOnly && !pic ? (
        <div className="media pic enc-only" style={{ aspectRatio: '4 / 3' }}><div className="empty"><b>VIBE</b><span>只有编码，没有原图</span></div></div>
      ) : <PicArea id={id} pic={pic} from={pic && 'from' in pic ? pic.from : undefined} empty="放一张参考图" ratio={4 / 3} />}
      <div className="pad">
        <div className="field">
          <div className="field-label"><span>参考强度</span><span className="v">{data.strength.toFixed(2)}</span></div>
          <Slider label="参考强度" min={0} max={1} step={0.01} value={data.strength} onCommit={pushUndo} onChange={v => updateData(id, { strength: v })} />
        </div>
        <div className="field">
          <div className="field-label"><span>信息提取量</span><span className="v">{data.encodingOnly ? '固定' : data.ie.toFixed(2)}</span></div>
          {data.encodingOnly ? <span className="note">只有编码的风格参考不能改这一项</span>
            : <Slider label="信息提取量" min={0.01} max={1} step={0.01} value={data.ie} onCommit={pushUndo} onChange={v => updateData(id, { ie: Math.round(v * 100) / 100 })} />}
        </div>
        <span className="note">强度越高越像参考图；信息提取量越低越只取画风和配色。{!data.encodingOnly && '改信息提取量要重新编码（2 Anlas）'}</span>
        {encKeys.length > 0 && <span className="note">已编码：{encKeys.join('、')}</span>}
        {data.encodingOnly && models.some(m => !vibeModelKey(m) || !(data.enc ?? {})[vibeModelKey(m)!]) && <div className="warn-line" style={{ padding: 0 }}>这个编码不是给当前模型的，生成时会报错</div>}
        <div className="foot">
          <span />
          <span className="row" style={{ gap: 8, fontSize: 'calc(11.5px * var(--fs))' }}>启用<Switch label="启用风格参考" on={data.enabled} onChange={v => updateData(id, { enabled: v }, true)} /></span>
        </div>
      </div>
    </NodeShell>
  );
}
export const VibeNode = memo(VibeNodeView);
