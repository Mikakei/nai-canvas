import { MODELS } from './models.ts';
import { REF_COST, VIBE_ENCODE_COST, vibeExtraCost } from './refs.ts';
import { inpaintIsV5 } from './inpaint.ts';
import { applyLocks, sizeOf, type GenParams } from './params.ts';

export interface Account {
  tier: number;
  active: boolean;
  anlas: number;
  /** V5 的 Opus 额度 */
  usage?: { percent: number; purchasedPercent: number; isNegative: boolean; timeUntilNextPercent: number };
}

export interface Cost {
  perImage: number;
  total: number;
  /** 本次第一张是否 Opus 免费 */
  free: boolean;
  /** 单张超过 140 Anlas，官网会拒绝 */
  tooLarge: boolean;
  /** 参考图带来的额外费用（已算进 total） */
  extra: number;
}

/** 生图之外的附加项：底图、风格参考（启用张数、需要新编码的张数）、精确参考张数 */
export interface CostExtras {
  base?: boolean; vibes?: number; encodes?: number; refs?: number;
  /** 局部重绘：按重绘强度打折；聚焦重绘时按放大后的尺寸计费 */
  inpaint?: boolean; size?: [number, number];
}

/** 官方前端的计费公式，见 docs/FEATURES.md 附录 H */
export function cost(raw: GenParams, account?: Account | null, ex: CostExtras = {}): Cost {
  const p = applyLocks(raw);
  const [w, h] = ex.size ?? sizeOf(p), wh = w * h, m = MODELS[p.model];
  const k = p.effort === 'medium' && m.apiMedium ? 1 / 1.06521739 : 1;
  let base = Math.ceil(2.951823174884865e-6 * wh + 5.753298233447344e-7 * wh * p.steps * k);
  if (ex.inpaint ? inpaintIsV5(p.model) : m.family === 'v5') base *= 1.5;
  // 图生图按强度打折；精确参考和风格参考同时接时只有精确参考生效
  const perImage = Math.max(Math.ceil(base * (ex.inpaint ? p.inpaintStrength : ex.base ? p.strength : 1)), 2);
  // 局部重绘不能用风格参考
  const refs = m.preciseRef ? ex.refs ?? 0 : 0, vibes = m.vibe && !refs && !ex.inpaint ? ex.vibes ?? 0 : 0;
  const extra = refs * REF_COST * p.nSamples + (vibes ? (ex.encodes ?? 0) * VIBE_ENCODE_COST + vibeExtraCost(vibes) : 0);
  const opus = !account || (account.tier >= 3 && account.active);
  const usageOk = m.family !== 'v5' || !account?.usage?.isNegative;
  const free = opus && usageOk && wh <= 1048576 && p.steps <= 28 && !refs;
  return { perImage, total: perImage * (p.nSamples - (free ? 1 : 0)) + extra, free, tooLarge: perImage > 140, extra };
}

export function costLabel(c: Cost): string {
  if (c.total === 0) return 'OPUS 免费';
  return c.free ? `${c.total} ANLAS · 首张免费` : `${c.total} ANLAS`;
}
