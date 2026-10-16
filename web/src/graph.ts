import type { Edge, Node } from '@xyflow/react';
import { wrapStrength, type GenParams, type GridParam, type Rect, type RefType, type ToolId } from '@nai/shared';

export type DataType = 'text' | 'neg' | 'image' | 'char' | 'vibe' | 'ref' | 'artist' | 'none';
export type Slot = 'prompt' | 'negative' | 'chars' | 'base' | 'vibes' | 'refs' | 'src' | 'setup' | 'artists';

/** kind：普通生成之外的来源（图生图、增强、变体），显示在历史里 */
/** raw：局部重绘时贴回原图之前的原始结果 */
export interface HistItem { url: string; seed: number; w: number; h: number; model: string; prompt: string; at: number; kind?: 'img2img' | 'enhance' | 'variation' | 'inpaint'; raw?: string }
export interface PromptData extends Record<string, unknown> { title: string; text: string; w?: number; h?: number }
export interface GenData extends Record<string, unknown> { title: string; params: GenParams; history: HistItem[]; cur: number; w?: number; hidePrompt?: boolean;
  /** 参数区展开着（参数直接在节点里调） */
  showParams?: boolean }

/** 角色：位置是 0–1 的坐标，V4 / V4.5 生成时会对齐到 5×5 网格 */
export interface CharData extends Record<string, unknown> { title: string; text: string; uc: string; enabled: boolean; x: number; y: number; showUc?: boolean; w?: number; h?: number }
/** mask：局部重绘的遮罩（和图同尺寸的 PNG，白色为重绘区域）；focus：聚焦重绘的框；ctx：最小参照范围（8 像素一格） */
export interface ImageData extends Record<string, unknown> { title: string; url: string; iw: number; ih: number; seed?: number; prompt?: string; w?: number; name?: string; mask?: string; focus?: Rect; ctx?: number;
  /** 在编辑器里画过多个图层时，各图层单独存一份，下次打开能接着改；url 是合成后的图 */
  layers?: { url: string; name: string; visible: boolean; opacity: number }[] }

/**
 * 风格参考：图片来自接进来的图片节点，没接时用自己的图。
 * vibeId 是服务端登记的编号（图片 base64 的 SHA-256），enc 记录在哪些模型、信息提取量下编码过
 */
export interface VibeData extends Record<string, unknown> {
  title: string; url: string; iw: number; ih: number; strength: number; ie: number; enabled: boolean;
  vibeId?: string; vibeFor?: string; enc?: Record<string, number[] | 'any'>; encodingOnly?: boolean; w?: number;
}
/** 精确参考（V4.5）：参考图生成时自动缩放补边 */
export interface RefData extends Record<string, unknown> { title: string; url: string; iw: number; ih: number; type: RefType; strength: number; fidelity: number; enabled: boolean; w?: number }

/** 图片工具的一次结果：去背景有三张（抠图、生成、混合），sel 是当前选的那张 */
export interface ToolItem { urls: string[]; sel: number; w: number; h: number; tool: ToolId; at: number; note?: string }
export interface ToolData extends Record<string, unknown> {
  title: string; tool: ToolId;
  /** 上色、改表情的提示词；defry 0–5 越大改得越少 */
  prompt: string; defry: number; emotion: string; keepBubbles: boolean;
  snapPalette: 'off' | 'auto' | 'custom'; snapColors: number; snapAvoid: boolean; snapUpscale: boolean;
  history: ToolItem[]; cur: number; w?: number;
}

/** 网格对比：两个轴的参数和写法；cells 是上次运行的结果（xs、ys 是当时的行列标题） */
export interface GridCell { x: number; y: number; url?: string; seed?: number; w?: number; h?: number; error?: string }
export interface GridData extends Record<string, unknown> {
  title: string; x: { param: GridParam; values: string }; y: { param: GridParam; values: string };
  cells: GridCell[]; xs: string[]; ys: string[]; seed?: number; at?: number; srcTitle?: string; axisNames?: [string, string]; w?: number;
}
export type GridNode = Node<GridData, 'grid'>;
/** 画师串：entry 是画师串库里的那一条；name、text、cover 是它的快照（库里删了、画布带到别的电脑也能用）；k 是这个节点的整体强度 */
export interface ArtistData extends Record<string, unknown> { title: string; entry?: string; name: string; text: string; cover?: string; k: number; enabled: boolean; mode?: 'v' | 't'; w?: number }
export type ArtistNode = Node<ArtistData, 'artist'>;
/** 图库：筛选条件；pick 是选中的那张图（从输出口出去） */
export interface GalleryData extends Record<string, unknown> {
  title: string; w: number; h: number; q?: string; day?: string; model?: string; kind?: string; fav?: boolean; here?: boolean; size?: 'S' | 'M' | 'L';
  pick?: { url: string; iw: number; ih: number; seed?: number; prompt?: string };
}
export type GalleryNode = Node<GalleryData, 'gallery'>;
/** 角色字典：浏览和管理全局的角色字典；sel 是选中的角色 */
export interface CharDictData extends Record<string, unknown> { title: string; w: number; h: number; q?: string; series?: string; sel?: string }
export type CharDictNode = Node<CharDictData, 'chardict'>;
/** 便签：备注文字，tone 是底色 */
export interface NoteData extends Record<string, unknown> { title: string; text: string; tone?: 'plain' | 'yellow' | 'red' | 'blue'; w?: number; h?: number }
export type NoteNode = Node<NoteData, 'note'>;
/** 分区：框住一组节点的底板 */
export interface SectionData extends Record<string, unknown> { title: string; w: number; h: number }
export type SectionNode = Node<SectionData, 'section'>;
export type PromptNode = Node<PromptData, 'prompt'>;
export type ToolNode = Node<ToolData, 'tool'>;
export type NegNode = Node<PromptData, 'negative'>;
export type GenNode = Node<GenData, 'generate'>;
export type ImageNode = Node<ImageData, 'image'>;
export type CharNode = Node<CharData, 'character'>;
export type VibeNode = Node<VibeData, 'vibe'>;
export type RefNode = Node<RefData, 'reference'>;
export type AppNode = PromptNode | NegNode | GenNode | ImageNode | CharNode | VibeNode | RefNode | ToolNode | SectionNode | GridNode | NoteNode | ArtistNode | GalleryNode | CharDictNode;
export type AppEdge = Edge<{ slot: Slot }>;
export type Kind = AppNode['type'];

export interface KindInfo {
  name: string; en: string; desc: string;
  w: number; min: number; max: number;
  out: DataType;
  accept: Partial<Record<DataType, Slot>>;
  multi?: Partial<Record<Slot, true>>;
  run?: true;
  /** 文字节点可以同时调宽高；带图节点只调宽度 */
  textResize?: true;
  /** 不出现在添加菜单里（只能从别处生成） */
  hidden?: true;
  /** 宽高都能拖（图库、角色字典这类大节点） */
  boxResize?: true;
}

export const KINDS: Record<Kind, KindInfo> = {
  prompt: { name: '提示词', en: 'PROMPT', desc: '一段可复用的提示词，可以同时接到多个生图节点', w: 260, min: 200, max: 640, out: 'text', accept: {}, textResize: true },
  negative: { name: '负面提示词', en: 'NEGATIVE', desc: '不想出现的内容，可以同时接到多个生图节点（接在 UC 预设后面）', w: 260, min: 200, max: 640, out: 'neg', accept: {}, textResize: true },
  character: { name: '角色', en: 'CHARACTER', desc: '一个角色的描述和在画面里的位置，接到生图节点（V4 及以上）', w: 280, min: 240, max: 560, out: 'char', accept: {}, textResize: true },
  generate: {
    name: '生图', en: 'GENERATE', desc: '出图。提示词、负面提示词、画师串、角色、底图、风格参考、精确参考都从左边接进来', w: 300, min: 240, max: 760, out: 'image',
    accept: { text: 'prompt', neg: 'negative', char: 'chars', image: 'base', vibe: 'vibes', ref: 'refs', artist: 'artists' }, multi: { prompt: true, negative: true, chars: true, vibes: true, refs: true, artists: true }, run: true,
  },
  image: { name: '图片', en: 'IMAGE', desc: '上传、拖入或粘贴一张图；接到生图节点就是图生图的底图', w: 260, min: 160, max: 760, out: 'image', accept: {} },
  tool: { name: '图片工具', en: 'TOOLS', desc: '去背景、去杂物、线稿、草图、上色、改表情、放大、像素整理（官网的 Director Tools）', w: 280, min: 220, max: 760, out: 'image', accept: { image: 'src' }, run: true },
  grid: { name: '网格对比', en: 'X/Y GRID', desc: '把一个生图节点的某个参数换几种值，排成网格一起比较（CFG、步数、采样器、提示词…）', w: 560, min: 320, max: 1800, out: 'none', accept: { image: 'setup' }, run: true },
  note: { name: '便签', en: 'NOTE', desc: '写点备注，不参与生成', w: 240, min: 160, max: 720, out: 'none', accept: {}, textResize: true },
  section: { name: '分区', en: 'SECTION', desc: '框住一组节点：拖标题整体移动，一键依次运行里面的生图和工具节点', w: 640, min: 240, max: 6000, out: 'none', accept: {} },
  vibe: { name: '风格参考', en: 'VIBE', desc: '参考一张图的画风、配色和氛围（V4、V4.5）', w: 240, min: 200, max: 520, out: 'vibe', accept: { image: 'src' } },
  artist: { name: '画师串', en: 'ARTISTS', desc: '从画师串库里挑一串画师和权重，带封面；接到生图节点上，自动放在提示词最前面', w: 290, min: 240, max: 1200, out: 'artist', accept: {} },
  gallery: { name: '图库', en: 'GALLERY', desc: '所有生成过的图：瀑布流、看大图、拖到画布；选中的图可以从输出口接给别的节点', w: 980, min: 420, max: 4000, out: 'image', accept: {}, boxResize: true },
  chardict: { name: '角色字典', en: 'CHARACTERS', desc: '保存喜欢的角色：设定、服装、封面；把角色拖到画布或生图节点上就能用', w: 760, min: 360, max: 3000, out: 'none', accept: {}, boxResize: true },
  reference: { name: '精确参考', en: 'REFERENCE', desc: '照着一张图画出同一个角色或同一种画风（V4.5）', w: 240, min: 200, max: 520, out: 'ref', accept: { image: 'src' } },
};
export const KIND_KEYS = Object.keys(KINDS) as Kind[];
export const SLOT_LABEL: Record<Slot, string> = { setup: '生图节点', prompt: '提示词', negative: '负面提示词', chars: '角色', base: '底图', vibes: '风格参考', refs: '精确参考', src: '图片', artists: '画师串' };

export const isGen = (n: AppNode | undefined): n is GenNode => n?.type === 'generate';
export const isImage = (n: AppNode | undefined): n is ImageNode => n?.type === 'image';
export const isChar = (n: AppNode | undefined): n is CharNode => n?.type === 'character';
export const isVibe = (n: AppNode | undefined): n is VibeNode => n?.type === 'vibe';
export const isRef = (n: AppNode | undefined): n is RefNode => n?.type === 'reference';
export const isTool = (n: AppNode | undefined): n is ToolNode => n?.type === 'tool';
export const isSection = (n: AppNode | undefined): n is SectionNode => n?.type === 'section';
export const isGrid = (n: AppNode | undefined): n is GridNode => n?.type === 'grid';
export const isArtist = (n: AppNode | undefined): n is ArtistNode => n?.type === 'artist';
export const isGallery = (n: AppNode | undefined): n is GalleryNode => n?.type === 'gallery';
export const isCharDict = (n: AppNode | undefined): n is CharDictNode => n?.type === 'chardict';

/** 画师串节点实际接进提示词的内容：停用或空的时候是空串；整体强度不是 1 时整串包成 k::…:: */
export function artistOut(n: AppNode | undefined): string {
  return isArtist(n) && n.data.enabled ? wrapStrength(n.data.text ?? '', n.data.k ?? 1) : '';
}

/** 从 a 拉线到 b 时，b 用哪个输入接 */
export function slotFor(a: AppNode, b: AppNode): Slot | undefined {
  // 网格只接生图节点（借用它的全部设置），不接普通图片
  if (b.type === 'grid') return a.type === 'generate' ? 'setup' : undefined;
  return KINDS[b.type].accept[KINDS[a.type].out];
}

export function nextTitle(nodes: AppNode[], kind: Kind): string {
  let m = 0;
  for (const n of nodes) if (n.type === kind) { const k = parseInt(String(n.data.title).split(' ').pop() ?? '', 10); if (k > m) m = k; }
  return `${KINDS[kind].name} ${m + 1}`;
}

/** 生图节点实际使用的提示词：画师串在最前（多个按连线顺序），然后是接入的提示词节点（按连线顺序） */
export function promptFor(id: string, nodes: AppNode[], edges: AppEdge[]): string {
  const parts = inputsOf(id, 'artists', nodes, edges).map(artistOut);
  parts.push(...edges.filter(e => e.target === id && e.data?.slot === 'prompt')
    .map(e => nodes.find(n => n.id === e.source)).filter(Boolean)
    .map(n => String(n!.data.text ?? '')));
  return parts.map(t => t.replace(/^[\s,]+|[\s,]+$/g, '')).filter(Boolean).join(', ');
}

/** 生图节点实际使用的负面提示词（不含 UC 预设）：接入的负面提示词节点按连线顺序在前，参数面板里自己的在后 */
export function negativeFor(id: string, nodes: AppNode[], edges: AppEdge[]): string {
  const self = nodes.find(n => n.id === id);
  const parts = inputsOf(id, 'negative', nodes, edges).map(n => String(n.data.text ?? ''));
  parts.push(isGen(self) ? self.data.params.negative : '');
  return parts.map(t => t.replace(/^[\s,]+|[\s,]+$/g, '')).filter(Boolean).join(', ');
}

export interface Pic { url: string; iw: number; ih: number; seed?: number; prompt?: string; mask?: string; focus?: Rect; ctx?: number }

/** 一个节点"输出"的图：图片节点就是它的图，生图节点是当前选中的那张结果 */
export function picOf(n: AppNode | undefined): Pic | null {
  if (!n) return null;
  if (isImage(n)) return n.data.url ? { url: n.data.url, iw: n.data.iw, ih: n.data.ih, seed: n.data.seed, prompt: n.data.prompt, mask: n.data.mask, focus: n.data.focus, ctx: n.data.ctx } : null;
  if (isGen(n)) { const h = n.data.history[n.data.cur]; return h ? { url: h.url, iw: h.w, ih: h.h, seed: h.seed, prompt: h.prompt } : null; }
  if (isTool(n)) { const h = n.data.history[n.data.cur]; return h ? { url: h.urls[h.sel] ?? h.urls[0], iw: h.w, ih: h.h } : null; }
  if (isGallery(n)) { const p = n.data.pick; return p ? { url: p.url, iw: p.iw, ih: p.ih, seed: p.seed, prompt: p.prompt } : null; }
  return null;
}

/** 风格参考、精确参考节点实际用的图：优先用接进来的，没接时用自己的 */
export function refPic(id: string, nodes: AppNode[], edges: AppEdge[]): (Pic & { from?: string }) | null {
  const e = edges.find(x => x.target === id && x.data?.slot === 'src');
  if (e) { const src = nodes.find(n => n.id === e.source); const p = picOf(src); return p ? { ...p, from: String(src?.data.title ?? '') } : null; }
  const self = nodes.find(n => n.id === id);
  if ((isVibe(self) || isRef(self)) && self.data.url) return { url: self.data.url, iw: self.data.iw, ih: self.data.ih };
  return null;
}

/** 接到生图节点某个输入上的节点，按连线顺序 */
export function inputsOf(id: string, slot: Slot, nodes: AppNode[], edges: AppEdge[]): AppNode[] {
  return edges.filter(e => e.target === id && e.data?.slot === slot).map(e => nodes.find(n => n.id === e.source)).filter((n): n is AppNode => !!n);
}

export function reaches(edges: AppEdge[], from: string, to: string): boolean {
  const seen = new Set<string>(), stack = [from];
  while (stack.length) {
    const c = stack.pop()!;
    if (c === to) return true;
    if (seen.has(c)) continue;
    seen.add(c);
    for (const e of edges) if (e.source === c) stack.push(e.target);
  }
  return false;
}
