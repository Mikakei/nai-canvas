// 模型能力表、默认参数、质量标签和 UC 预设。来源见 docs/FEATURES.md 附录 B、C、F、G。

export type ModelKey = 'v5-full' | 'v5-curated' | 'v45-full' | 'v45-curated' | 'v4-full' | 'v4-curated';
export type Effort = 'high' | 'medium';
export type UcPreset = 'heavy' | 'light' | 'human' | 'furry' | 'none';
export type Family = 'v5' | 'v45' | 'v4';

export interface ModelInfo {
  key: ModelKey;
  label: string;
  /** 下拉框里的一句说明 */
  note: string;
  legacy?: boolean;
  family: Family;
  curated: boolean;
  api: string;
  /** V5 Full 的 Medium 档 */
  apiMedium?: string;
  defaults: { scale: number; steps: number; stepsMedium?: number };
  tokenLimit: number;
  quality: string;
  /** V5 的 Light 档质量标签 */
  qualityLight?: string;
  uc: Partial<Record<Exclude<UcPreset, 'none'>, string>>;
  /** 是否可以选噪声计划 */
  noiseSchedule: boolean;
  /** Variety+ 对应的 skip_cfg_above_sigma；undefined 表示不支持 */
  varietySigma?: number;
  vibe: boolean;
  /** 精确参考（Precise Reference），只有 V4.5 支持 */
  preciseRef?: boolean;
  maxCharacters: number;
  /** 支持 Anime / Furry 模式 */
  furryMode: boolean;
  transparent?: boolean;
}

const V5_HEAVY = 'lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page';
const V5_LIGHT = 'lowres, bad hands, bad anatomy, artistic error, sepia, white haze, worst quality, very displeasing, jpeg artifacts, 0::ai-generated::';
const V5_FURRY = '{worst quality}, distracting watermark, unfinished, bad quality, {widescreen}, upscale, {sequence}, {{grandfathered content}}, blurred foreground, chromatic aberration, sketch, everyone, [sketch background], simple, [flat colors], ych (character), outline, multiple scenes, [[horror (theme)]], comic';
const V5_UC = { heavy: V5_HEAVY, light: V5_LIGHT, human: `${V5_HEAVY}, @_@, mismatched pupils, glowing eyes, bad anatomy`, furry: V5_FURRY };
const V45C_HEAVY = 'blurry, lowres, upscaled, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, halftone, multiple views, logo, too many watermarks, negative space, blank page';

export const MODELS: Record<ModelKey, ModelInfo> = {
  'v5-full': {
    key: 'v5-full', label: 'V5 Full', note: '最新、最全面', family: 'v5', curated: false,
    api: 'nai-diffusion-5-full', apiMedium: 'nai-diffusion-5-full-medium',
    defaults: { scale: 7, steps: 23, stepsMedium: 14 }, tokenLimit: 1471,
    quality: ', very aesthetic, masterpiece, no text', qualityLight: ', very aesthetic, amazing quality, no text',
    uc: V5_UC, noiseSchedule: false, vibe: false, maxCharacters: 32, furryMode: true, transparent: true,
  },
  'v5-curated': {
    key: 'v5-curated', label: 'V5 Curated', note: '只用全年龄素材训练', family: 'v5', curated: true,
    api: 'nai-diffusion-5-curated',
    defaults: { scale: 7, steps: 23 }, tokenLimit: 703,
    quality: ', very aesthetic, masterpiece, no text', qualityLight: ', very aesthetic, amazing quality, no text',
    uc: V5_UC, noiseSchedule: false, vibe: false, maxCharacters: 32, furryMode: true, transparent: true,
  },
  'v45-full': {
    key: 'v45-full', label: 'V4.5 Full', note: '支持风格参考和精确参考', family: 'v45', curated: false,
    api: 'nai-diffusion-4-5-full',
    defaults: { scale: 5, steps: 23 }, tokenLimit: 512,
    quality: ', very aesthetic, masterpiece, no text',
    // FEATURES.md 只记录了 V4.5 Full 的 Heavy（与 V5 相同），其余预设等核对官网后再补
    uc: { heavy: V5_HEAVY },
    noiseSchedule: true, varietySigma: 58, vibe: true, preciseRef: true, maxCharacters: 6, furryMode: true,
  },
  'v45-curated': {
    key: 'v45-curated', label: 'V4.5 Curated', note: 'V4.5 的全年龄版', family: 'v45', curated: true,
    api: 'nai-diffusion-4-5-curated',
    defaults: { scale: 5, steps: 23 }, tokenLimit: 512,
    quality: ', very aesthetic, masterpiece, no text, -0.8::feet::, rating:general',
    uc: {
      heavy: V45C_HEAVY,
      light: 'blurry, lowres, upscaled, artistic error, scan artifacts, jpeg artifacts, logo, too many watermarks, negative space, blank page',
      human: `${V45C_HEAVY}, bad anatomy, bad hands, @_@, mismatched pupils, glowing eyes`,
    },
    noiseSchedule: true, varietySigma: 58, vibe: true, preciseRef: true, maxCharacters: 6, furryMode: true,
  },
  'v4-full': {
    key: 'v4-full', label: 'V4 Full', note: '不再推荐', legacy: true, family: 'v4', curated: false,
    api: 'nai-diffusion-4-full',
    defaults: { scale: 5.5, steps: 23 }, tokenLimit: 512,
    quality: ', no text, best quality, very aesthetic, absurdres',
    uc: {
      heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, multiple views, logo, too many watermarks, white blank page, blank page',
      light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, white blank page, blank page',
    },
    noiseSchedule: true, varietySigma: 19, vibe: true, maxCharacters: 6, furryMode: true,
  },
  'v4-curated': {
    key: 'v4-curated', label: 'V4 Curated', note: '不再推荐', legacy: true, family: 'v4', curated: true,
    api: 'nai-diffusion-4-curated-preview',
    defaults: { scale: 5.5, steps: 23 }, tokenLimit: 512,
    quality: ', rating:general, best quality, very aesthetic, absurdres',
    uc: {
      heavy: 'blurry, lowres, error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, logo, dated, signature, multiple views, gigantic breasts, white blank page, blank page',
      light: 'blurry, lowres, error, worst quality, bad quality, jpeg artifacts, very displeasing, logo, dated, signature, white blank page, blank page',
    },
    noiseSchedule: true, varietySigma: 19, vibe: true, maxCharacters: 6, furryMode: true,
  },
};

export const MODEL_KEYS = Object.keys(MODELS) as ModelKey[];

export const UC_LABEL: Record<UcPreset, string> = { heavy: 'Heavy', light: 'Light', human: 'Human Focus', furry: 'Furry Focus', none: '不用预设' };
/** 请求里的 ucPreset 字段，只作为元数据记录；真正生效的是拼进 negative_prompt 的文本 */
export const UC_PRESET_ID: Record<UcPreset, number> = { heavy: 0, light: 1, human: 2, furry: 2, none: 3 };

export function apiModel(key: ModelKey, effort: Effort): string {
  const m = MODELS[key];
  return effort === 'medium' && m.apiMedium ? m.apiMedium : m.api;
}

export const isMedium = (p: { model: ModelKey; effort: Effort }) => p.effort === 'medium' && !!MODELS[p.model].apiMedium;

export function availableUc(key: ModelKey): UcPreset[] {
  return [...(Object.keys(MODELS[key].uc) as UcPreset[]), 'none'];
}

export const SAMPLERS = [
  { id: 'k_euler_ancestral', label: 'Euler Ancestral' },
  { id: 'k_euler', label: 'Euler' },
  { id: 'k_dpmpp_2s_ancestral', label: 'DPM++ 2S Ancestral' },
  { id: 'k_dpmpp_2m_sde', label: 'DPM++ 2M SDE' },
  { id: 'k_dpmpp_2m', label: 'DPM++ 2M' },
  { id: 'k_dpmpp_sde', label: 'DPM++ SDE' },
  { id: 'k_dpm_2', label: 'DPM2' },
] as const;
export type SamplerId = (typeof SAMPLERS)[number]['id'];

export function samplersFor(_key: ModelKey): (typeof SAMPLERS)[number][] {
  return [...SAMPLERS];
}

export const NOISE_SCHEDULES = ['karras', 'exponential', 'polyexponential'] as const;
export type NoiseSchedule = (typeof NOISE_SCHEDULES)[number];

/** 附录 E：各采样器可选的噪声计划（V4 及以上没有 native） */
export function noisesFor(_key: ModelKey, sampler: SamplerId): NoiseSchedule[] {
  return sampler === 'k_dpm_2' ? ['exponential', 'polyexponential'] : ['karras', 'exponential', 'polyexponential'];
}

/** 切换采样器时的默认噪声计划 */
export function defaultNoise(sampler: SamplerId): NoiseSchedule {
  return sampler === 'k_dpmpp_2m' || sampler === 'k_dpm_2' ? 'exponential' : 'karras';
}

export type Orientation = 'portrait' | 'square' | 'landscape';
export type SizeTier = 'small' | 'normal' | 'large' | 'wallpaper' | 'custom';
export const SIZES: Record<Exclude<SizeTier, 'custom'>, Partial<Record<Orientation, [number, number]>>> = {
  small: { portrait: [512, 768], square: [640, 640], landscape: [768, 512] },
  normal: { portrait: [832, 1216], square: [1024, 1024], landscape: [1216, 832] },
  large: { portrait: [1024, 1536], square: [1472, 1472], landscape: [1536, 1024] },
  wallpaper: { portrait: [1088, 1920], landscape: [1920, 1088] },
};
export const TIER_LABEL: Record<SizeTier, string> = { small: 'Small', normal: 'Normal', large: 'Large', wallpaper: 'Wallpaper', custom: '自定义' };
export const ORIENT_LABEL: Record<Orientation, string> = { portrait: '竖向', square: '方形', landscape: '横向' };
/** 总像素上限（附录：生成参数） */
export const MAX_PIXELS = 3145728;

/** 每次最多生成几张：尺寸越小允许越多 */
export function maxSamples(w: number, h: number): number {
  const a = w * h;
  return a <= 360448 ? 8 : a <= 409600 ? 6 : a <= 1048576 ? 4 : 1;
}
