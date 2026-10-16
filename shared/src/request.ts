import { MODELS, UC_PRESET_ID, apiModel } from './models.ts';
import { applyLocks, sizeOf, type GenParams } from './params.ts';
import { normalizeStrengths, type RefType } from './refs.ts';
import { inpaintModel } from './inpaint.ts';

export interface CharacterInput {
  prompt: string;
  uc: string;
  /** 0–1，5×5 网格取 0.1、0.3、0.5、0.7、0.9 */
  x: number;
  y: number;
}

export interface GenerateInput {
  prompt: string;
  params: GenParams;
  characters?: CharacterInput[];
  /** 实际使用的种子（未锁定时由调用方随机） */
  seed: number;
  /** 角色位置交给 AI 决定 */
  aiPositions?: boolean;
  /** 图生图的底图（base64 PNG，已缩放到生成尺寸） */
  image?: string;
  /** 风格参考：已经编码好的 vibe（base64）和强度 */
  vibes?: { encoding: string; strength: number }[];
  /** 精确参考：已补边的参考图（base64 PNG） */
  refs?: { image: string; type: RefType; strength: number; fidelity: number }[];
  /** V5 增强的 Max 档：保持尺寸，由服务端放大 */
  upscaledEnhance?: boolean;
  /** 局部重绘的遮罩（base64 PNG，和 image 同尺寸，白色为重绘区域）；有遮罩时 image 必须有 */
  mask?: string;
  /** 聚焦重绘时实际生成的尺寸（覆盖参数里的尺寸） */
  size?: [number, number];
  /** 让 NovelAI 返回 png 还是 webp（默认 png） */
  format?: 'png' | 'webp';
  /** 透明背景模型：用 straight alpha */
  straightAlpha?: boolean;
}

/** 质量标签追加到提示词末尾；有 `Text:` 时插在它前面（附录 F） */
export function withQuality(prompt: string, tag: string): string {
  const i = prompt.indexOf('Text:');
  if (i < 0) return prompt.replace(/[\s,]+$/, '') + tag;
  const head = prompt.slice(0, i).replace(/[\s,]+$/, '');
  return `${head}${tag}, ${prompt.slice(i)}`;
}

/** UC 预设加在负面提示词开头；非 Curated 模型在提示词没有 nsfw 时自动加上 nsfw（附录 G） */
export function buildNegative(prompt: string, raw: GenParams): string {
  const p = applyLocks(raw), m = MODELS[p.model];
  const preset = p.ucPreset === 'none' ? '' : m.uc[p.ucPreset] ?? '';
  let neg = [preset, p.negative.trim()].filter(Boolean).join(', ');
  if (!m.curated && preset && !/\bnsfw\b/i.test(prompt)) neg = `nsfw, ${neg}`;
  return neg;
}

/**
 * 实际发给 API 的主提示词：
 * Furry 模式在开头加 fur dataset；透明背景加在质量标签前面；质量标签加在末尾（有 Text: 时插在它前面）
 */
export function buildPrompt(prompt: string, raw: GenParams): string {
  const p = applyLocks(raw), m = MODELS[p.model];
  let s = prompt.trim();
  if (p.furry && !/^fur dataset\b/i.test(s)) s = `fur dataset, ${s}`;
  if (p.transparent) s = withQuality(s, ', transparent background');
  if (p.quality) s = withQuality(s, p.qualityLight && m.qualityLight ? m.qualityLight : m.quality);
  return s;
}

/** 组装 /ai/generate-image(-stream) 的请求体 */
export function buildGenerateRequest(input: GenerateInput, stream = false) {
  const p = applyLocks(input.params), m = MODELS[p.model], [width, height] = input.size ?? sizeOf(p);
  const infill = !!(input.mask && input.image);
  const prompt = buildPrompt(input.prompt, p), negative = buildNegative(input.prompt, p);
  const parameters: Record<string, unknown> = {
    params_version: 4,
    width, height,
    scale: p.scale,
    sampler: p.sampler,
    steps: p.steps,
    n_samples: p.nSamples,
    seed: input.seed,
    ucPreset: UC_PRESET_ID[p.ucPreset],
    qualityToggle: p.quality,
    cfg_rescale: p.cfgRescale,
    noise_schedule: m.noiseSchedule ? p.noise : 'karras',
    skip_cfg_above_sigma: p.variety && m.varietySigma !== undefined ? m.varietySigma : null,
    dynamic_thresholding: false,
    legacy: false,
    add_original_image: true,
    prefer_brownian: true,
    deliberate_euler_ancestral_bug: false,
    negative_prompt: negative,
    image_format: input.format ?? 'png',
  };

  // V5 可以自由摆放；V4 / V4.5 对齐到网格
  const free = m.family === 'v5';
  // Medium 档是固定设置：角色的负面提示词也清空（官网 applyFixedModelSettings）
  const fixed = p.effort === 'medium' && !!m.apiMedium;
  const chars = (input.characters ?? []).slice(0, m.maxCharacters).map(c => ({ ...(free ? c : { ...c, x: snapToGrid(c.x), y: snapToGrid(c.y) }), ...(fixed ? { uc: '' } : {}) }));
  // 由 AI 决定位置时不发坐标（官网的 AI's Choice）
  const useCoords = chars.length > 0 && !input.aiPositions;
  const centers = (c: CharacterInput) => [{ x: c.x, y: c.y }];
  Object.assign(parameters, {
    use_coords: useCoords,
    characterPrompts: chars.map(c => ({ prompt: c.prompt, uc: c.uc, center: { x: c.x, y: c.y }, enabled: true })),
    v4_prompt: {
      caption: { base_caption: prompt, char_captions: chars.map(c => ({ char_caption: c.prompt, centers: centers(c) })) },
      use_coords: useCoords,
      use_order: true,
    },
    v4_negative_prompt: {
      caption: { base_caption: negative, char_captions: chars.map(c => ({ char_caption: c.uc, centers: centers(c) })) },
      legacy_uc: false,
    },
  });
  if (p.transparent) parameters.tag_hint_transparent_background = true;
  if (m.transparent && input.straightAlpha !== undefined) parameters.straight_alpha = input.straightAlpha;

  // 图生图：额外噪声的种子用 seed - 1，颜色校正关闭（官网同款）
  if (input.image) {
    Object.assign(parameters, { image: input.image, strength: p.strength, noise: p.addNoise, extra_noise_seed: input.seed > 0 ? input.seed - 1 : 1, color_correct: false });
    if (input.upscaledEnhance) parameters.upscaled_enhance = true;
  }
  // 局部重绘：原图由前端按遮罩贴回，所以不让服务端叠原图；重绘强度不是 1 时附带 img2img（官网同款）
  if (infill) {
    Object.assign(parameters, { mask: input.mask, add_original_image: false });
    if (p.inpaintStrength !== 1) parameters.img2img = { strength: p.inpaintStrength, color_correct: true };
  }
  // 精确参考和风格参考不能同时用：都接了时只发精确参考（官网同款）
  const refs = m.preciseRef ? input.refs ?? [] : [];
  if (refs.length) {
    Object.assign(parameters, {
      director_reference_images: refs.map(r => r.image),
      director_reference_descriptions: refs.map(r => ({ caption: { base_caption: r.type, char_captions: [] }, legacy_uc: false })),
      director_reference_information_extracted: refs.map(() => 1),
      director_reference_strength_values: refs.map(r => r.strength),
      director_reference_secondary_strength_values: refs.map(r => Math.round((1 - r.fidelity) * 1000) / 1000),
    });
  } else if (m.vibe && input.vibes?.length && !infill) {
    parameters.reference_image_multiple = input.vibes.map(v => v.encoding);
    parameters.reference_strength_multiple = normalizeStrengths(input.vibes.map(v => v.strength), p.normalizeVibes);
    parameters.normalize_reference_strength_multiple = p.normalizeVibes;
  }
  if (stream) parameters.stream = 'sse';
  const action = infill ? 'infill' : input.image ? 'img2img' : 'generate';
  return { input: prompt, model: infill ? inpaintModel(p.model, p.effort) : apiModel(p.model, p.effort), action: action as 'generate' | 'img2img' | 'infill', parameters };
}

/** V4 / V4.5 只能放在 5×5 网格上：把任意位置对齐到最近的格子中心（0.1、0.3 … 0.9） */
export function snapToGrid(v: number): number {
  return Math.round((Math.min(4, Math.max(0, Math.round((v - 0.1) / 0.2))) * 0.2 + 0.1) * 10) / 10;
}

/** 5×5 网格的格子编号（0–24）转坐标 */
export function gridCenter(cell: number): { x: number; y: number } {
  const r = (v: number) => Math.round(v * 10) / 10;
  return { x: r(0.1 + 0.2 * (cell % 5)), y: r(0.1 + 0.2 * Math.floor(cell / 5)) };
}
