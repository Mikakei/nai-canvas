import { memo } from 'react';
import type { NodeProps } from '@xyflow/react';
import { KINDS, type ImageNode as IN } from '../graph.ts';
import { api } from '../api.ts';
import { toast, useStore } from '../store.ts';
import { copyImage, dupNodes, removeNodes } from '../actions.ts';
import { importMetaOf, openEditor, paintBlank, upscaleImage } from '../imageActions.ts';
import { NodeShell } from './NodeShell.tsx';
import { PicArea } from './PicArea.tsx';

function ImageNodeView({ id, data }: NodeProps<IN>) {
  const label = useStore(s => s.runtime[id]?.label);
  const used = useStore(s => s.edges.filter(e => e.source === id).length);
  const pic = data.url ? { url: data.url, iw: data.iw, ih: data.ih } : null;
  return (
    <NodeShell id={id} kind="image" title={data.title} width={data.w ?? KINDS.image.w}
      status={label ?? (pic ? `${data.mask ? '遮罩 · ' : ''}${data.focus && data.mask ? '聚焦 · ' : ''}${data.iw}×${data.ih}` : '空')}
      className={label ? 'is-working' : ''}
      tools={[...(pic ? [{ label: '编辑', onClick: () => openEditor(id, undefined, 'paint') }, { label: data.mask ? '改遮罩' : '画遮罩', onClick: () => openEditor(id) }] : []), { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <PicArea id={id} pic={pic} empty="放一张图" ratio={3 / 4} blank={<BlankRow id={id} />} overlay={data.mask ? <MaskOverlay url={data.mask} focus={data.focus} iw={data.iw} ih={data.ih} /> : undefined}>
        <button type="button" onClick={() => openEditor(id, undefined, 'paint')}>编辑</button>
        <button type="button" onClick={() => openEditor(id)}>{data.mask ? '改遮罩' : '局部重绘'}</button>
        <button type="button" onClick={() => copyImage(data.url)}>复制图片</button>
        <button type="button" onClick={() => upscaleImage(id, { url: data.url, iw: data.iw, ih: data.ih })}>放大 2×</button>
        <button type="button" onClick={() => importMetaOf(id)}>读取生成信息</button>
        {data.seed !== undefined && <button type="button" onClick={() => navigator.clipboard.writeText(String(data.seed)).then(() => toast(`已复制种子 ${data.seed}`), () => toast(`种子是 ${data.seed}`))}>复制种子</button>}
        <button type="button" onClick={() => api.reveal(data.url).catch(e => toast((e as Error).message, { err: true }))}>在文件夹中显示</button>
      </PicArea>
      {pic && !used && <div className="hint-line">{data.mask ? '接到生图节点当底图，运行就是局部重绘' : '接到生图节点当底图（图生图），或接到风格参考、精确参考节点'}</div>}
    </NodeShell>
  );
}
export const ImageNode = memo(ImageNodeView);

/** 空图片节点上"画一张"：选个方向就新建白色画布 */
function BlankRow({ id }: { id: string }) {
  return (
    <div className="blank nodrag">
      <span>或者画一张</span>
      <button type="button" onClick={() => paintBlank(id, 832, 1216)}>竖</button>
      <button type="button" onClick={() => paintBlank(id, 1024, 1024)}>方</button>
      <button type="button" onClick={() => paintBlank(id, 1216, 832)}>横</button>
    </div>
  );
}

/** 节点上的遮罩预览：红色半透明，聚焦框画成白框 */
function MaskOverlay({ url, focus, iw, ih }: { url: string; focus?: { x: number; y: number; w: number; h: number }; iw: number; ih: number }) {
  return (
    <>
      <div className="mask-ov" style={{ WebkitMaskImage: `url("${url}")`, maskImage: `url("${url}")` }} />
      {focus && <div className="focus-ov" style={{ left: `${focus.x / iw * 100}%`, top: `${focus.y / ih * 100}%`, width: `${focus.w / iw * 100}%`, height: `${focus.h / ih * 100}%` }} />}
    </>
  );
}
