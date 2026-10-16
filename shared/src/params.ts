import {
  MODELS, MAX_PIXELS, SIZES, availableUc, defaultNoise, maxSamples, noisesFor, samplersFor,
  type Effort, type ModelKey, type NoiseSchedule, type Orientation, type SamplerId, type SizeTier, type UcPreset,
} from './models.ts';

/** 生图节点保存的参数（不含提示词） */
export interface GenParams {
  model: ModelKey;
  effort: Effort;
  tier: SizeTier;
  orient: Orientation;
  /** tier 为 custom 时使用 */
  width: number;
  height: number;
  steps: number;
  scale: number;
  cfgRescale: number;
  sampler: SamplerId;
  noise: NoiseSchedule;
  nSamples: number;
  seed: number;
  seedLocked: boolean;
  quality: boolean;
  /** V5 质量标签用 Light 档 */
  qualityLight: boolean;
  ucPreset: UcPreset;
  negative: string;
  variety: boolean;
  /** Anime / Furry 模式：提示词开头加 fur dataset */
  furry: boolean;
  /** 透明背景（V5） */
  transparent: boolean;
  /** 角色位置：交给 AI 决定，或者用角色节点上指定的位置 */
  charPos: 'ai' | 'custom';
  /** 图生图：保留多少底图（越大改得越多）和额外噪声 */
  strength: number;
  addNoise: number;
  /** 风格参考：强度之和超过 1 时按比例缩小 */
  normalizeVibes: boolean;
  /** 局部重绘：重绘强度（1 为完全重画遮罩内）；保留原图（遮罩外不变，按羽化后的遮罩贴回原图） */
  inpaintStrength: number;
  keepOriginal: boolean;
}

export const randomSeed = () => Math.floor(Math.random() * 4294967295);

export function defaultParams(model: ModelKey = 'v5-full'): GenParams {
  const m = MODELS[model];
  return {
    model, effort: 'high', tier: 'normal', orient: 'portrait', width: 832, height: 1216,
    steps: m.defaults.steps, scale: m.defaults.scale, cfgRescale: 0,
    sampler: 'k_euler_ancestral', noise: defaultNoise('k_euler_ancestral'),
    nSamples: 1, seed: randomSeed(), seedLocked: false,
    quality: true, qualityLight: false, ucPreset: m.uc.heavy ? 'heavy' : 'light', negative: '', variety: false,
    furry: false, transparent: false, charPos: 'ai',
    strength: 0.7, addNoise: 0, normalizeVibes: true,
    inpaintStrength: 1, keepOriginal: true,
  };
}

/**
 * 整理旧存档里的参数：缺的字段补默认值，已经不存在的字段丢掉；
 * 模型已被移除（比如 V3）时换成 V5 Full，并用它的默认 CFG 和步数
 */
export function normalizeParams(p: Partial<GenParams> | undefined): GenParams {
  const known = !!p?.model && p.model in MODELS;
  const d = defaultParams(known ? p!.model : 'v5-full');
  const out = { ...d };
  for (const k of Object.keys(d) as (keyof GenParams)[]) if (p?.[k] !== undefined) (out as Record<string, unknown>)[k] = p[k];
  if (!known) Object.assign(out, { model: d.model, scale: d.scale, steps: d.steps });
  return applyLocks(out);
}

export function sizeOf(p: Pick<GenParams, 'tier' | 'orient' | 'width' | 'height'>): [number, number] {
  if (p.tier === 'custom') return [p.width, p.height];
  const t = SIZES[p.tier];
  return t[p.orient] ?? t.portrait!;
}

/** 自定义尺寸：取 64 的倍数，并限制总像素 */
export function clampSize(w: number, h: number): [number, number] {
  const r = (v: number) => Math.max(64, Math.round(v / 64) * 64);
  let W = r(w), H = r(h);
  while (W * H > MAX_PIXELS) { if (W >= H) W -= 64; else H -= 64; }
  return [W, H];
}

/** Medium 档把步数、采样器、UC 都锁死（FEATURES 第 2 节） */
export function applyLocks(p: GenParams): GenParams {
  const m = MODELS[p.model];
  const next = { ...p };
  if (p.effort === 'medium' && m.apiMedium) {
    Object.assign(next, { steps: m.defaults.stepsMedium ?? 14, sampler: 'k_euler_ancestral', ucPreset: 'heavy', negative: '', cfgRescale: 0 });
  }
  if (!m.apiMedium) next.effort = 'high';
  if (!samplersFor(p.model).some(s => s.id === next.sampler)) next.sampler = 'k_euler_ancestral';
  if (!noisesFor(p.model, next.sampler).includes(next.noise)) next.noise = defaultNoise(next.sampler);
  if (!availableUc(p.model).includes(next.ucPreset)) next.ucPreset = m.uc.heavy ? 'heavy' : 'light';
  if (m.varietySigma === undefined) next.variety = false;
  if (!m.furryMode) next.furry = false;
  if (!m.transparent) next.transparent = false;
  if (!m.qualityLight) next.qualityLight = false;
  const [w, h] = sizeOf(next);
  next.nSamples = Math.min(next.nSamples, maxSamples(w, h));
  return next;
}

/** 换模型：默认值没被改过的参数跟着换成新模型的默认值；UC 预设映射到同类预设 */
export function switchModel(p: GenParams, model: ModelKey): GenParams {
  const m = MODELS[model], prev = MODELS[p.model];
  const next: GenParams = { ...p, model };
  if (p.scale === prev.defaults.scale) next.scale = m.defaults.scale;
  if (p.steps === prev.defaults.steps || p.steps === prev.defaults.stepsMedium) next.steps = m.defaults.steps;
  if (!m.apiMedium) next.effort = 'high';
  return applyLocks(next);
}

/** 切换 Effort 只改档位本身；Medium 的锁定在使用时由 applyLocks 套上，切回 High 时原来的步数、采样器、UC 都还在 */
export function switchEffort(p: GenParams, effort: Effort): GenParams {
  return MODELS[p.model].apiMedium ? { ...p, effort } : p;
}

/** 改尺寸后，张数不能超过新尺寸允许的上限 */
export function withSize(p: GenParams, patch: Partial<Pick<GenParams, 'tier' | 'orient' | 'width' | 'height'>>): GenParams {
  const next = { ...p, ...patch };
  if (next.tier === 'wallpaper' && next.orient === 'square') next.orient = 'portrait';
  if (patch.tier === 'custom' && p.tier !== 'custom' && patch.width === undefined && patch.height === undefined) [next.width, next.height] = sizeOf(p);
  if (next.tier === 'custom') [next.width, next.height] = clampSize(next.width, next.height);
  const [w, h] = sizeOf(next);
  next.nSamples = Math.min(next.nSamples, maxSamples(w, h));
  return next;
}

export function swapSize(p: GenParams): GenParams {
  if (p.tier === 'custom') return withSize(p, { width: p.height, height: p.width });
  if (p.orient === 'square') return p;
  return withSize(p, { orient: p.orient === 'portrait' ? 'landscape' : 'portrait' });
}
