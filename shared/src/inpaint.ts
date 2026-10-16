// 局部重绘：重绘模型、聚焦区域的计算。来源：官网前端代码（2026-10-14 核对）
import { snap64 } from './refs.ts';
import type { Effort, ModelKey } from './models.ts';

/** 每个模型对应的重绘模型。注意 V5 Curated 用的是 V4.5 Curated 的重绘模型（官网同款） */
export function inpaintModel(model: ModelKey, effort: Effort): string {
  switch (model) {
    case 'v5-full': return effort === 'medium' ? 'nai-diffusion-5-full-medium-inpainting' : 'nai-diffusion-5-full-inpainting';
    case 'v5-curated': return 'nai-diffusion-4-5-curated-inpainting';
    case 'v45-full': return 'nai-diffusion-4-5-full-inpainting';
    case 'v45-curated': return 'nai-diffusion-4-5-curated-inpainting';
    case 'v4-full': return 'nai-diffusion-4-full-inpainting';
    case 'v4-curated': return 'nai-diffusion-4-curated-inpainting';
  }
}
/** 重绘时实际按 V5 计费（乘 1.5）吗：V5 Curated 走的是 V4.5 的重绘模型，不乘 */
export const inpaintIsV5 = (model: ModelKey) => model === 'v5-full';

export interface Rect { x: number; y: number; w: number; h: number }

/** 最小参照范围的可选值（单位是 8 像素的格子），官网 32–96，默认取中间 */
export const CONTEXT_RANGE = { min: 32, max: 96, step: 8, def: 64 };

/**
 * 聚焦区域：用户框的范围至少扩到"最小参照范围"那么大（以框的中心为准），
 * 不超出图片，边界对齐 8 像素
 */
export function focusRegion(box: Rect, ctxCells: number, iw: number, ih: number): Rect {
  const min = ctxCells * 8;
  let w = Math.max(box.w, Math.min(min, iw)), h = Math.max(box.h, Math.min(min, ih));
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  let x = cx - w / 2, y = cy - h / 2;
  x = Math.min(Math.max(0, x), iw - w); y = Math.min(Math.max(0, y), ih - h);
  // 对齐到 8 的倍数：起点往下取、终点往上取，再夹回图片内
  // 扩出来的区域有余量时保持 8 的整数倍宽度；框本身就是全部范围时向外取整，保证框住的内容不被裁掉
  const span = (a: number, len: number, extra: boolean, lim: number) => {
    let a0 = Math.floor(a / 8) * 8, a1 = Math.ceil((a + len) / 8) * 8;
    if (extra) a1 = a0 + Math.ceil(len / 8) * 8;
    const max = Math.floor(lim / 8) * 8;
    if (a1 > max) { a0 -= a1 - max; a1 = max; }
    return [Math.max(0, a0), a1];
  };
  let [x0, x1] = span(x, w, w > box.w + 8, iw), [y0, y1] = span(y, h, h > box.h + 8, ih);
  if (x1 - x0 < 64) { x1 = Math.min(x0 + 64, Math.floor(iw / 8) * 8); x0 = Math.max(0, x1 - 64); }
  if (y1 - y0 < 64) { y1 = Math.min(y0 + 64, Math.floor(ih / 8) * 8); y0 = Math.max(0, y1 - 64); }
  w = x1 - x0; h = y1 - y0;
  return { x: x0, y: y0, w, h };
}

/** 聚焦区域放大到约 1MP 再生成（官网 largestValidWithinPixelCount）；已经够大时保持原尺寸 */
export function focusSize(w: number, h: number, target = 1048576): [number, number] {
  if (w * h >= 0.8 * target) return [Math.max(64, Math.floor(w / 64) * 64), Math.max(64, Math.floor(h / 64) * 64)];
  const s = Math.sqrt(target / (w * h));
  return [Math.max(64, Math.floor(Math.floor(w * s) / 64) * 64), Math.max(64, Math.floor(Math.floor(h * s) / 64) * 64)];
}

/** 聚焦重绘时，角色位置换算到聚焦区域里的坐标 */
export function remapCenter(x: number, y: number, r: Rect, iw: number, ih: number) {
  const c = (v: number) => Math.min(1, Math.max(0, v));
  return { x: c((x * iw - r.x) / r.w), y: c((y * ih - r.y) / r.h) };
}

/** 扩图后的尺寸：每边扩的像素，总尺寸不超过上限 */
export function outpaintSize(iw: number, ih: number, pad: { l: number; t: number; r: number; b: number }) {
  return [iw + pad.l + pad.r, ih + pad.t + pad.b] as [number, number];
}
