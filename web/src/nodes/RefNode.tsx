import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { useShallow } from 'zustand/react/shallow';
import { MODELS, REF_COST, REF_TYPES } from '@nai/shared';
import { KINDS, isGen, refPic, type RefNode as RN } from '../graph.ts';
import { pushUndo, updateData, useStore } from '../store.ts';
import { dupNodes, removeNodes } from '../actions.ts';
import { Seg, Slider, Switch } from '../ui/controls.tsx';
import { NodeShell } from './NodeShell.tsx';
import { PicArea } from './PicArea.tsx';

function RefNodeView({ id, data }: NodeProps<RN>) {
  const pic = useStore(useShallow(s => refPic(id, s.nodes, s.edges)));
  const models = useStore(useShallow(s => s.edges.filter(e => e.source === id).map(e => s.nodes.find(n => n.id === e.target)).filter(isGen).map(g => g.data.params.model)));
  let stat = models.length ? `+${REF_COST}/张` : '未接入';
  if (models.length && !models.some(m => MODELS[m].preciseRef)) stat = '只有 V4.5 能用';
  if (!data.enabled) stat = '已停用';
  return (
    <NodeShell id={id} kind="reference" title={data.title} width={data.w ?? KINDS.reference.w} status={stat} className={data.enabled ? '' : 'is-off'}
      tools={[{ label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <PicArea id={id} pic={pic} from={pic && 'from' in pic ? pic.from : undefined} empty="放一张角色或画风参考图" ratio={2 / 3} />
      <div className="pad">
        <Seg label="参考什么" value={data.type} options={REF_TYPES.map(t => ({ v: t.v, l: t.l }))} onChange={v => updateData(id, { type: v }, true)} />
        <div className="field">
          <div className="field-label"><span>强度</span><span className="v">{data.strength.toFixed(2)}</span></div>
          <Slider label="强度" min={-1} max={1} step={0.01} value={data.strength} onCommit={pushUndo} onChange={v => updateData(id, { strength: v })} />
        </div>
        <div className="field">
          <div className="field-label"><span>保真度</span><span className="v">{data.fidelity.toFixed(2)}</span></div>
          <Slider label="保真度" min={-1} max={1} step={0.01} value={data.fidelity} onCommit={pushUndo} onChange={v => updateData(id, { fidelity: v })} />
        </div>
        <span className="note">参考图会自动缩放并补黑边。保真度越高越贴近原图细节；不能和风格参考同时用</span>
        <div className="foot">
          <span />
          <span className="row" style={{ gap: 8, fontSize: 'calc(11.5px * var(--fs))' }}>启用<Switch label="启用精确参考" on={data.enabled} onChange={v => updateData(id, { enabled: v }, true)} /></span>
        </div>
      </div>
    </NodeShell>
  );
}
export const RefNode = memo(RefNodeView);
