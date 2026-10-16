// 图生图、增强、变体、风格参考、精确参考用到的常量和纯函数。来源：官网前端代码（2026-10-14 核对）
import { MAX_PIXELS, MODELS, type ModelKey } from './models.ts';

/** 新模型的最小尺寸单位：宽高取最近的 64 的倍数，正好在中间时往大取（官网 closestMultipleNum） */
export function snap64(v: number): number {
  const a = Math.floor(v / 64) * 64, b = Math.ceil(v / 64) * 64;
  const n = v - a < b - v ? a : b;
  return n <= 0 ? 64 : n;
}

/** 底图尺寸 → 生成尺寸：取 64 的倍数；超过总像素上限时等比缩小 */
export function fitSize(w: number, h: number, max = MAX_PIXELS): [number, number] {
  let s = 1;
  if (w * h > max) s = Math.sqrt(max / (w * h));
  let W = snap64(w * s), H = snap64(h * s);
  while (W * H > max) { if (W >= H) W -= 64; else H -= 64; }
  return [W, H];
}

/* ---------- 增强（Enhance） ---------- */
/** Magnitude 1–5 对应的 Strength 和 Noise（FEATURES 附录 C） */
export const ENHANCE_LEVELS: Record<number, { strength: number; noise: number }> = {
  1: { strength: 0.2, noise: 0 }, 2: { strength: 0.4, noise: 0 }, 3: { strength: 0.5, noise: 0 }, 4: { strength: 0.6, noise: 0 }, 5: { strength: 0.7, noise: 0.1 },
};
export type EnhanceScale = 1 | 1.5 | 2 | 'max';

/** 某张图能选的放大倍率：放大后不能超过总像素上限；V5 额外有 Max（原尺寸、服务端放大） */
export function enhanceScales(w: number, h: number, model: ModelKey): EnhanceScale[] {
  const out: EnhanceScale[] = ([2, 1.5, 1] as const).filter(s => snap64(w * s) * snap64(h * s) <= MAX_PIXELS);
  if (MODELS[model].family === 'v5') out.unshift('max');
  return out;
}
export function enhanceSize(w: number, h: number, scale: EnhanceScale): [number, number] {
  if (scale === 'max') return [w, h];
  return [snap64(Math.floor(w * scale)), snap64(Math.floor(h * scale))];
}
/** V4.5 和 V5 增强时在提示词里加一句减弱"放大感"（有 Text: 时插在它前面）；Max 不加 */
export const ENHANCE_PROMPT_ADD = ', -2::upscaled, blurry::,';
export function enhancePrompt(prompt: string, model: ModelKey, scale: EnhanceScale): string {
  if (scale === 'max' || MODELS[model].family === 'v4' || prompt.includes('upscaled, blurry')) return prompt;
  const i = prompt.search(/Text:/);
  return i >= 0 ? prompt.slice(0, i) + ENHANCE_PROMPT_ADD + prompt.slice(i) : prompt + ENHANCE_PROMPT_ADD;
}

/** 变体：强度 0.8、噪声 0.1，最多 3 张 */
export const VARIATION = { strength: 0.8, noise: 0.1, maxSamples: 3 };

/* ---------- 放大（Upscale） ---------- */
export const UPSCALE = { model: 'nai-diffusion-5-curated', factor: 2, blurSigma: 0 };
/** 按原图像素数分档收费 */
export function upscaleCost(w: number, h: number): number | null {
  const a = w * h;
  if (!a) return null;
  for (const [lim, c] of [[1048576, 1], [1747627, 2], [2446678, 3], [3145728, 4]] as const) if (a <= lim) return c;
  return null;
}

/* ---------- 风格参考（Vibe Transfer） ---------- */
export const VIBE_DEFAULTS = { strength: 0.6, ie: 1 };
export const VIBE_FREE_COUNT = 4;
/** 启用超过 4 张时，每多一张加 2 Anlas（每次生成收一次） */
export const vibeExtraCost = (n: number) => 2 * Math.max(0, n - VIBE_FREE_COUNT);
export const VIBE_ENCODE_COST = 2;

/** .naiv4vibe 文件里按模型区分编码的键 */
export function vibeModelKey(model: ModelKey): string | null {
  return ({ 'v4-full': 'v4full', 'v4-curated': 'v4curated', 'v45-full': 'v4-5full', 'v45-curated': 'v4-5curated' } as Partial<Record<ModelKey, string>>)[model] ?? null;
}
/** 编码参数拼成的字符串，取 SHA-256 后作为 .naiv4vibe 里 encodings[模型][键] 的键（官网同款） */
export function vibeParamsString(ie: number): string {
  return `information_extracted:${ie}`;
}
/** 归一化：开启且多于一张、强度绝对值之和超过 1 时，按比例缩到和为 1 */
export function normalizeStrengths(list: number[], on: boolean): number[] {
  if (!on || list.length < 2) return list;
  const sum = list.reduce((a, b) => a + Math.abs(b), 0);
  return sum > 1 ? list.map(v => v / sum) : list;
}

/** V5 不支持两种参考：换成对应的 V4.5 */
export function refFallbackModel(model: ModelKey): ModelKey {
  return model === 'v5-full' ? 'v45-full' : model === 'v5-curated' ? 'v45-curated' : model;
}

/* ---------- 精确参考（Precise Reference，仅 V4.5） ---------- */
export type RefType = 'character' | 'style' | 'character&style';
export const REF_TYPES: { v: RefType; l: string }[] = [{ v: 'character&style', l: '角色和画风' }, { v: 'character', l: '只要角色' }, { v: 'style', l: '只要画风' }];
export const REF_DEFAULTS = { type: 'character&style' as RefType, strength: 1, fidelity: 1 };
export const REF_COST = 5;
/** 参考图统一缩放并补黑边到这三种尺寸之一（选比例最接近的） */
export const DIRECTOR_SIZES: [number, number][] = [[1024, 1536], [1536, 1024], [1472, 1472]];
export function directorLayout(w: number, h: number) {
  const r = w / h;
  let best = DIRECTOR_SIZES[0];
  for (const s of DIRECTOR_SIZES) if (Math.abs(s[0] / s[1] - r) < Math.abs(best[0] / best[1] - r)) best = s;
  const [W, H] = best;
  let dw: number, dh: number;
  if (r > W / H) { dw = W; dh = Math.round(W / r); } else { dh = H; dw = Math.round(H * r); }
  return { W, H, dw, dh, dx: Math.round((W - dw) / 2), dy: Math.round((H - dh) / 2) };
}
