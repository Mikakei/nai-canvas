// 读取 NovelAI 图片里的生成信息：PNG 文本块、Alpha 通道隐写、WebP EXIF。见 FEATURES.md 附录 K
import { MODELS, SIZES, type ModelKey, type Orientation, type SamplerId, type NoiseSchedule, type UcPreset, SAMPLERS, NOISE_SCHEDULES } from './models.ts';
import type { GenParams } from './params.ts';
import { withQuality } from './request.ts';

const utf8 = new TextDecoder('utf-8');

/** PNG 的 tEXt / iTXt（未压缩）文本块。NovelAI 写进 tEXt 的内容是 UTF-8 */
export function readPngText(b: Uint8Array): Record<string, string> {
  const out: Record<string, string> = {};
  if (b.length < 8 || b[0] !== 0x89 || b[1] !== 0x50) return out;
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 8;
  while (i + 8 <= b.length) {
    const len = dv.getUint32(i), type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    const data = b.subarray(i + 8, i + 8 + len);
    if (type === 'tEXt') {
      const z = data.indexOf(0);
      if (z > 0) out[utf8.decode(data.subarray(0, z))] = utf8.decode(data.subarray(z + 1));
    } else if (type === 'iTXt') {
      const z = data.indexOf(0);
      if (z > 0 && data[z + 1] === 0) {
        // keyword\0 压缩标志 压缩方法 语言\0 翻译后的关键字\0 正文
        let k = z + 3;
        k = data.indexOf(0, k) + 1; k = data.indexOf(0, k) + 1;
        if (k > 0) out[utf8.decode(data.subarray(0, z))] = utf8.decode(data.subarray(k));
      }
    } else if (type === 'IEND') break;
    i += 12 + len;
  }
  return out;
}

/**
 * Alpha 通道隐写（stealth_pngcomp）：每个像素 alpha 的最低位，按列读取（先从上到下，再从左到右）。
 * 依次是 15 字节的标记、32 位的数据位数、gzip 压缩的 JSON。返回 gzip 数据，由调用方解压
 */
export function readStealth(alpha: Uint8Array, w: number, h: number): Uint8Array | null {
  const MAGIC = 'stealth_pngcomp', total = w * h;
  let pos = 0;
  const bit = () => { const x = Math.floor(pos / h), y = pos % h; pos++; return alpha[y * w + x] & 1; };
  const byte = () => { let v = 0; for (let k = 0; k < 8; k++) v = (v << 1) | bit(); return v; };
  if (total < (MAGIC.length + 4) * 8) return null;
  for (let k = 0; k < MAGIC.length; k++) if (byte() !== MAGIC.charCodeAt(k)) return null;
  let bits = 0;
  for (let k = 0; k < 32; k++) bits = (bits * 2) + bit();
  const n = Math.floor(bits / 8);
  if (!n || pos + n * 8 > total) return null;
  const out = new Uint8Array(n);
  for (let k = 0; k < n; k++) out[k] = byte();
  return out;
}

/** WebP 的 EXIF 块里，UserComment 存着和 PNG 相同的 JSON */
export function readWebpExif(b: Uint8Array): Record<string, string> {
  if (b.length < 12 || String.fromCharCode(...b.subarray(0, 4)) !== 'RIFF' || String.fromCharCode(...b.subarray(8, 12)) !== 'WEBP') return {};
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  for (let i = 12; i + 8 <= b.length;) {
    const type = String.fromCharCode(...b.subarray(i, i + 4)), len = dv.getUint32(i + 4, true);
    if (type === 'EXIF') {
      const exif = b.subarray(i + 8, i + 8 + len);
      // 不完整解析 TIFF：直接找 JSON 开头。UserComment 前 8 字节是编码标记（ASCII / UNICODE）
      const uni = indexOf(exif, [0x55, 0x4e, 0x49, 0x43, 0x4f, 0x44, 0x45, 0]);
      let text = '';
      if (uni >= 0) {
        const body = exif.subarray(uni + 8);
        const le = body[0] === 0x7b && body[1] === 0;
        text = new TextDecoder(le ? 'utf-16le' : 'utf-16be').decode(body);
      } else {
        const j = exif.indexOf(0x7b);
        if (j >= 0) text = utf8.decode(exif.subarray(j));
      }
      const end = text.lastIndexOf('}');
      if (end > 0) {
        try {
          const o = JSON.parse(text.slice(text.indexOf('{'), end + 1));
          return Object.fromEntries(Object.entries(o).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
        } catch { /* 不是 JSON */ }
      }
      return {};
    }
    i += 8 + len + (len & 1);
  }
  return {};
}
function indexOf(b: Uint8Array, pat: number[]) {
  outer: for (let i = 0; i + pat.length <= b.length; i++) { for (let k = 0; k < pat.length; k++) if (b[i + k] !== pat[k]) continue outer; return i; }
  return -1;
}

/** 元数据里的 Source（如 "NovelAI Diffusion V4.5 4BDE2A90"）→ 模型。表来自官网前端 */
export function modelFromSource(src: string | undefined): { model: ModelKey; medium: boolean } | null {
  if (!src) return null;
  const s = src.trim(), id = s.split(' ').pop() ?? '';
  if (s.includes('V5')) {
    if (['93F4BD30', '70AB5786'].includes(id)) return { model: 'v5-full', medium: true };
    if (['657484A5', '0ADF9AB7'].includes(id)) return { model: 'v5-full', medium: false };
    return { model: 'v5-curated', medium: false };
  }
  if (s.includes('V4') || s.includes('NAIv4next')) {
    if (['4BDE2A90', '1229B44F', 'B9F340FD', 'F3D95188'].includes(id)) return { model: 'v45-full', medium: false };
    if (['C02D4F98', '5AB81C7C', 'B5A2A797'].includes(id)) return { model: 'v45-curated', medium: false };
    if (['37442FCA', '4F49EC75', 'CA4B7203', '79F47848', 'F6302A9D'].includes(id)) return { model: 'v4-full', medium: false };
    if (['7ABFFA2A', 'C1CCBA86', '770A9E12'].includes(id)) return { model: 'v4-curated', medium: false };
    return { model: s.includes('V4.5') ? 'v45-curated' : 'v4-curated', medium: false };
  }
  return null;
}

export interface ImportedChar { prompt: string; uc: string; x: number; y: number }
export interface ImportedMeta {
  /** 去掉质量标签等自动添加内容后的提示词 */
  prompt: string;
  negative: string;
  params: Partial<GenParams>;
  seed?: number;
  characters: ImportedChar[];
  useCoords: boolean;
  /** 图里带着的风格参考编码 */
  vibes: { encoding: string; strength: number; ie: number }[];
  /** 用了精确参考（元数据里没有参考图本身） */
  refCount: number;
  img2img: boolean;
  /** 随机器实际选中的提示词 */
  actualPrompt?: string;
  /** 模型没认出来 */
  unknownModel: boolean;
  software: string;
}

const UC_BY_ID: Record<number, UcPreset> = { 0: 'heavy', 1: 'light', 2: 'human', 3: 'none' };

/** 从 PNG 文本块（或隐写、EXIF 解出的同样字段）里还原生成信息；不是 NovelAI 的图返回 null */
export function parseNaiMeta(fields: Record<string, string>): ImportedMeta | null {
  let c: Record<string, any>;
  try { c = JSON.parse(fields.Comment ?? ''); } catch { return null; }
  if (!c || typeof c !== 'object' || (c.prompt === undefined && !c.v4_prompt)) return null;
  const src = modelFromSource(fields.Source);
  const model = src?.model ?? 'v45-full', m = MODELS[model];
  const params: Partial<GenParams> = { model, effort: src?.medium ? 'medium' : 'high' };

  if (typeof c.steps === 'number') params.steps = c.steps;
  if (typeof c.scale === 'number') params.scale = c.scale;
  if (typeof c.cfg_rescale === 'number') params.cfgRescale = c.cfg_rescale;
  if (SAMPLERS.some(s => s.id === c.sampler)) params.sampler = c.sampler as SamplerId;
  if ((NOISE_SCHEDULES as readonly string[]).includes(c.noise_schedule)) params.noise = c.noise_schedule as NoiseSchedule;
  params.variety = c.skip_cfg_above_sigma !== null && c.skip_cfg_above_sigma !== undefined;
  if (typeof c.width === 'number' && typeof c.height === 'number') Object.assign(params, sizeParams(c.width, c.height));
  if (c.request_type === 'Img2ImgRequest' || typeof c.strength === 'number') {
    if (typeof c.strength === 'number') params.strength = c.strength;
    if (typeof c.noise === 'number') params.addNoise = c.noise;
  }
  if (typeof c.normalize_reference_strength_multiple === 'boolean') params.normalizeVibes = c.normalize_reference_strength_multiple;

  // 主提示词：去掉自动加的质量标签、透明背景、fur dataset
  let prompt = String(c.v4_prompt?.caption?.base_caption ?? c.prompt ?? '');
  const q = [m.quality, m.qualityLight].filter(Boolean) as string[];
  let quality = false, light = false;
  for (const tag of q) {
    const stripped = stripQuality(prompt, tag);
    if (stripped !== null) { prompt = stripped; quality = true; light = tag === m.qualityLight; break; }
  }
  params.quality = c.qualityToggle ?? quality;
  if (quality) params.qualityLight = light;
  const tb = stripQuality(prompt, ', transparent background');
  if (tb !== null && m.transparent) { prompt = tb; params.transparent = true; }
  if (/^fur dataset,\s*/i.test(prompt) && m.furryMode) { prompt = prompt.replace(/^fur dataset,\s*/i, ''); params.furry = true; }

  // 负面：去掉开头的预设和自动加的 nsfw
  let negative = String(c.v4_negative_prompt?.caption?.base_caption ?? c.uc ?? c.negative_prompt ?? '');
  let preset: UcPreset = typeof c.ucPreset === 'number' ? UC_BY_ID[c.ucPreset] ?? 'none' : 'none';
  if (preset === 'human' && model.startsWith('v5') && negative.includes('{worst quality}')) preset = 'furry';
  const pre = preset !== 'none' ? m.uc[preset] : undefined;
  const body = negative.replace(/^nsfw,\s*/, '');
  if (pre && body.startsWith(pre)) { negative = body.slice(pre.length).replace(/^[\s,]+/, ''); params.ucPreset = preset; }
  else { const hit = (Object.entries(m.uc) as [UcPreset, string][]).find(([, t]) => body.startsWith(t)); if (hit) { negative = body.slice(hit[1].length).replace(/^[\s,]+/, ''); params.ucPreset = hit[0]; } else params.ucPreset = 'none'; }
  params.negative = negative;

  // 角色
  const pos = c.v4_prompt?.caption?.char_captions ?? [], neg = c.v4_negative_prompt?.caption?.char_captions ?? [];
  const characters: ImportedChar[] = pos.map((ch: any, i: number) => ({ prompt: String(ch.char_caption ?? ''), uc: String(neg[i]?.char_caption ?? ''), x: ch.centers?.[0]?.x ?? 0.5, y: ch.centers?.[0]?.y ?? 0.5 }));
  const useCoords = !!(c.v4_prompt?.use_coords ?? c.use_coords);
  if (characters.length) params.charPos = useCoords ? 'custom' : 'ai';

  const enc: string[] = Array.isArray(c.reference_image_multiple) ? c.reference_image_multiple : [];
  const vibes = enc.map((encoding, i) => ({ encoding, strength: c.reference_strength_multiple?.[i] ?? 0.6, ie: c.reference_information_extracted_multiple?.[i] ?? 1 }));
  const refCount = Array.isArray(c.director_reference_strengths) ? c.director_reference_strengths.length : Array.isArray(c.director_reference_descriptions) ? c.director_reference_descriptions.length : 0;

  return {
    prompt: prompt.trim(), negative, params, seed: typeof c.seed === 'number' ? c.seed : undefined,
    characters, useCoords, vibes, refCount, img2img: c.request_type === 'Img2ImgRequest',
    actualPrompt: typeof c.actual_prompts?.prompt === 'string' ? c.actual_prompts.prompt : undefined,
    unknownModel: !src, software: fields.Software ?? '',
  };
}

/** 去掉末尾（或 Text: 前面）的质量标签，没找到返回 null */
function stripQuality(prompt: string, tag: string): string | null {
  const plain = tag.replace(/^,\s*/, '');
  const i = prompt.indexOf('Text:');
  if (i < 0) {
    if (prompt.endsWith(tag)) return prompt.slice(0, -tag.length);
    if (prompt === plain) return '';
    return null;
  }
  const head = prompt.slice(0, i).replace(/[\s,]+$/, '');
  if (head.endsWith(tag)) return withoutTag(head, tag) + ', ' + prompt.slice(i);
  return null;
}
const withoutTag = (s: string, tag: string) => s.slice(0, -tag.length);

/** 宽高 → 档位和方向；不是预设尺寸时用自定义 */
export function sizeParams(w: number, h: number): Pick<GenParams, 'tier' | 'orient' | 'width' | 'height'> {
  for (const [tier, os] of Object.entries(SIZES)) for (const [o, s] of Object.entries(os)) if (s && s[0] === w && s[1] === h) return { tier: tier as GenParams['tier'], orient: o as Orientation, width: w, height: h };
  return { tier: 'custom', orient: w > h ? 'landscape' : w < h ? 'portrait' : 'square', width: w, height: h };
}

/** 官网的"清理括号"：去掉 [] {}，逗号后补空格 */
export function cleanBrackets(s: string): string {
  return s.replace(/[[\]{}]/g, '').replace(/,(?=\S)/g, ', ').replace(/ {2,}/g, ' ').trim();
}

// 测试用：确认 withQuality 和 stripQuality 互逆
export const _stripQuality = stripQuality;
