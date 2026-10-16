import { memo, useCallback, useEffect, useRef } from 'react';
import type { NodeProps } from '@xyflow/react';
import type { LibEntry } from '../api.ts';
import { type GalleryNode as GN } from '../graph.ts';
import { updateData, useStore } from '../store.ts';
import { dupNodes, removeNodes } from '../actions.ts';
import { GalleryView, filtersOf, galleryNav, type GalleryFilters } from '../ui/Gallery.tsx';
import { NodeShell } from './NodeShell.tsx';

/** 图库节点：画布上的图库，拖右下角随便拉大；选中的那张图从右边的 + 口出去 */
function GalleryNodeView({ id, data }: NodeProps<GN>) {
  const nav = useRef<((key: string) => boolean) | null>(null);
  useEffect(() => { galleryNav.set(id, nav); return () => { galleryNav.delete(id); }; }, [id]);
  const used = useStore(s => s.edges.some(e => e.source === id));
  const setFilters = useCallback((f: GalleryFilters) => updateData(id, { q: f.q, day: f.day, model: f.model, kind: f.kind, fav: f.fav, here: f.here, size: f.size }), [id]);
  const pick = useCallback((e: LibEntry | null) => updateData(id, { pick: e ? { url: e.url, iw: e.w, ih: e.h, seed: e.seed, prompt: e.prompt } : undefined }), [id]);
  const full = () => useStore.setState({ gallery: true });
  return (
    <NodeShell id={id} kind="gallery" title={data.title} width={data.w}
      status={data.pick ? `${used ? '输出 · ' : '选中 · '}${data.pick.iw}×${data.pick.ih}` : '图库'}
      tools={[{ label: '全屏', onClick: full }, { label: '复制', onClick: () => dupNodes([id]) }, { label: '删除', onClick: () => removeNodes([id]) }]}>
      <GalleryView className="box-resize" style={{ height: data.h }} filters={filtersOf(data)} onFilters={setFilters}
        pick={data.pick?.url ?? null} onPick={pick} near={id} navRef={nav} />
    </NodeShell>
  );
}
export const GalleryNode = memo(GalleryNodeView);
