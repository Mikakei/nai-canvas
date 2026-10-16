import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import {
  buildGenerateRequest, cleanBrackets, cost, defaultParams, directorLayout, enhancePrompt, enhanceScales, enhanceSize, fitSize,
  modelFromSource, normalizeStrengths, parseNaiMeta, readPngText, readStealth, readWebpExif, refFallbackModel, sizeParams, snap64, upscaleCost,
} from './index.ts';
import { gzipSync } from 'node:zlib';

const opus = { tier: 3, active: true, anlas: 1000 };

describe('尺寸', () => {
  it('取最近的 64 倍数，中间往大取', () => {
    expect(snap64(1248)).toBe(1280);
    expect(snap64(1230)).toBe(1216);
    expect(snap64(10)).toBe(64);
  });
  it('底图太大时等比缩到上限内', () => {
    const [w, h] = fitSize(4000, 3000);
    expect(w * h).toBeLessThanOrEqual(3145728);
    expect(w % 64 + h % 64).toBe(0);
    expect(fitSize(832, 1216)).toEqual([832, 1216]);
  });
});

describe('增强', () => {
  it('832×1216 只能选 1.5× 和 1×，V5 多一个 Max', () => {
    expect(enhanceScales(832, 1216, 'v45-full')).toEqual([1.5, 1]);
    expect(enhanceScales(832, 1216, 'v5-full')).toEqual(['max', 1.5, 1]);
    expect(enhanceScales(640, 640, 'v45-full')).toEqual([2, 1.5, 1]);
  });
  it('1.5× 后取 64 的倍数', () => {
    expect(enhanceSize(832, 1216, 1.5)).toEqual([1280, 1856]);
    expect(enhanceSize(832, 1216, 'max')).toEqual([832, 1216]);
  });
  it('V4.5 / V5 加减弱放大感的提示词，V4 和 Max 不加', () => {
    expect(enhancePrompt('1girl', 'v45-full', 1.5)).toBe('1girl, -2::upscaled, blurry::,');
    expect(enhancePrompt('1girl, Text: hi', 'v5-full', 1)).toBe('1girl, , -2::upscaled, blurry::,Text: hi');
    expect(enhancePrompt('1girl', 'v4-full', 1.5)).toBe('1girl');
    expect(enhancePrompt('1girl', 'v5-full', 'max')).toBe('1girl');
  });
});

describe('图生图请求', () => {
  it('带底图时 action 为 img2img，额外噪声种子为 seed - 1', () => {
    const p = { ...defaultParams('v45-full'), strength: 0.5, addNoise: 0.1 };
    const r = buildGenerateRequest({ prompt: 'a', params: p, seed: 100, image: 'AAA' });
    expect(r.action).toBe('img2img');
    expect(r.parameters).toMatchObject({ image: 'AAA', strength: 0.5, noise: 0.1, extra_noise_seed: 99, color_correct: false });
  });
  it('没有底图时不带 strength 字段', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 1 });
    expect(r.action).toBe('generate');
    expect(r.parameters.strength).toBeUndefined();
  });
  it('图生图按强度打折', () => {
    const p = { ...defaultParams('v45-full'), steps: 28, strength: 0.5 };
    expect(cost(p, null, { base: true }).perImage).toBe(10);
  });
});

describe('风格参考', () => {
  it('归一化：多于一张且总和超过 1 才缩放', () => {
    expect(normalizeStrengths([0.6, 0.6], true)).toEqual([0.5, 0.5]);
    expect(normalizeStrengths([0.6, 0.6], false)).toEqual([0.6, 0.6]);
    expect(normalizeStrengths([0.6], true)).toEqual([0.6]);
    expect(normalizeStrengths([0.3, 0.3], true)).toEqual([0.3, 0.3]);
  });
  it('请求里带编码和归一化后的强度', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 1, vibes: [{ encoding: 'E1', strength: 0.8 }, { encoding: 'E2', strength: 0.8 }] });
    expect(r.parameters).toMatchObject({ reference_image_multiple: ['E1', 'E2'], reference_strength_multiple: [0.5, 0.5], normalize_reference_strength_multiple: true });
  });
  it('V5 不发风格参考', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: defaultParams('v5-full'), seed: 1, vibes: [{ encoding: 'E1', strength: 0.8 }] });
    expect(r.parameters.reference_image_multiple).toBeUndefined();
    expect(refFallbackModel('v5-full')).toBe('v45-full');
    expect(refFallbackModel('v5-curated')).toBe('v45-curated');
  });
  it('超过 4 张每张加 2，新编码每张 2', () => {
    const p = { ...defaultParams('v45-full'), steps: 28 };
    expect(cost(p, opus, { vibes: 6, encodes: 1 })).toMatchObject({ extra: 6, total: 6 });
  });
});

describe('精确参考', () => {
  it('补边到最接近的尺寸', () => {
    expect(directorLayout(832, 1216)).toMatchObject({ W: 1024, H: 1536, dw: 1024, dh: 1497, dx: 0, dy: 20 });
    const l = directorLayout(1000, 1000);
    expect([l.W, l.H, l.dw, l.dh, l.dx, l.dy]).toEqual([1472, 1472, 1472, 1472, 0, 0]);
    const w = directorLayout(2000, 1000);
    expect([w.W, w.H, w.dw, w.dh, w.dy]).toEqual([1536, 1024, 1536, 768, 128]);
  });
  it('请求字段：类型写进描述，保真度换成 1 - fidelity', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 1, refs: [{ image: 'R', type: 'style', strength: 0.8, fidelity: 0.7 }], vibes: [{ encoding: 'E', strength: 1 }] });
    expect(r.parameters).toMatchObject({
      director_reference_images: ['R'],
      director_reference_descriptions: [{ caption: { base_caption: 'style', char_captions: [] }, legacy_uc: false }],
      director_reference_information_extracted: [1], director_reference_strength_values: [0.8], director_reference_secondary_strength_values: [0.3],
    });
    // 同时接了风格参考时只发精确参考
    expect(r.parameters.reference_image_multiple).toBeUndefined();
  });
  it('每个参考每张图加 5，而且不再 Opus 免费', () => {
    const p = { ...defaultParams('v45-full'), steps: 28, nSamples: 2 };
    expect(cost(p, opus, { refs: 1 })).toMatchObject({ free: false, extra: 10, total: 20 * 2 + 10 });
  });
});

describe('放大', () => {
  it('按像素分档', () => {
    expect(upscaleCost(832, 1216)).toBe(1);
    expect(upscaleCost(1024, 1536)).toBe(2);
    expect(upscaleCost(1920, 1088)).toBe(3);
    expect(upscaleCost(1600, 1600)).toBe(4);
    expect(upscaleCost(2000, 2000)).toBeNull();
  });
});

/* ---------- 元数据 ---------- */
function crc32(buf: Uint8Array) { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; }
function chunk(type: string, data: Uint8Array) {
  const out = new Uint8Array(12 + data.length), dv = new DataView(out.buffer);
  dv.setUint32(0, data.length); out.set(new TextEncoder().encode(type), 4); out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}
function png(text: Record<string, string>) {
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', new Uint8Array(13))];
  for (const [k, v] of Object.entries(text)) parts.push(chunk('tEXt', new TextEncoder().encode(`${k}\0${v}`)));
  parts.push(chunk('IDAT', deflateSync(Buffer.alloc(1))), chunk('IEND', new Uint8Array()));
  const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0)); let o = 0;
  for (const p of parts) { all.set(p, o); o += p.length; }
  return all;
}

const V45_COMMENT = {
  prompt: '1girl, rain, very aesthetic, masterpiece, no text', steps: 28, height: 1216, width: 832, scale: 5, uncond_scale: 0, cfg_rescale: 0.1,
  seed: 123456, n_samples: 1, noise_schedule: 'karras', sampler: 'k_euler_ancestral', ucPreset: 0, qualityToggle: true,
  skip_cfg_above_sigma: 58,
  v4_prompt: { caption: { base_caption: '1girl, rain, very aesthetic, masterpiece, no text', char_captions: [{ char_caption: 'girl, 白发', centers: [{ x: 0.3, y: 0.5 }] }] }, use_coords: true, use_order: true },
  v4_negative_prompt: { caption: { base_caption: 'nsfw, lowres, artistic error, film grain, scan artifacts, worst quality, bad quality, jpeg artifacts, very displeasing, chromatic aberration, dithering, halftone, screentone, multiple views, logo, too many watermarks, negative space, blank page, bad hands', char_captions: [{ char_caption: 'blurry', centers: [{ x: 0.3, y: 0.5 }] }] }, legacy_uc: false },
  reference_image_multiple: ['ENC'], reference_strength_multiple: [0.7], reference_information_extracted_multiple: [0.9],
  request_type: 'PromptGenerateRequest',
};

describe('元数据导入', () => {
  it('读 PNG 文本块（UTF-8）', () => {
    const t = readPngText(png({ Software: 'NovelAI', Comment: '{"a":"白"}' }));
    expect(t).toEqual({ Software: 'NovelAI', Comment: '{"a":"白"}' });
  });
  it('Source 认模型', () => {
    expect(modelFromSource('NovelAI Diffusion V4.5 4BDE2A90')).toEqual({ model: 'v45-full', medium: false });
    expect(modelFromSource('NovelAI Diffusion V5 93F4BD30')).toEqual({ model: 'v5-full', medium: true });
    expect(modelFromSource('NovelAI Diffusion V4 37442FCA')?.model).toBe('v4-full');
    expect(modelFromSource('Stable Diffusion XL C1E1DE52')).toBeNull();
  });
  it('还原提示词、UC、设置、角色、风格参考', () => {
    const m = parseNaiMeta({ Source: 'NovelAI Diffusion V4.5 4BDE2A90', Comment: JSON.stringify(V45_COMMENT) })!;
    expect(m.prompt).toBe('1girl, rain');
    expect(m.negative).toBe('bad hands');
    expect(m.params).toMatchObject({ model: 'v45-full', steps: 28, scale: 5, cfgRescale: 0.1, quality: true, ucPreset: 'heavy', variety: true, tier: 'normal', orient: 'portrait', charPos: 'custom' });
    expect(m.seed).toBe(123456);
    expect(m.characters).toEqual([{ prompt: 'girl, 白发', uc: 'blurry', x: 0.3, y: 0.5 }]);
    expect(m.vibes).toEqual([{ encoding: 'ENC', strength: 0.7, ie: 0.9 }]);
  });
  it('不是 NovelAI 的图返回 null', () => {
    expect(parseNaiMeta({ parameters: 'sd webui' })).toBeNull();
    expect(parseNaiMeta({ Comment: 'not json' })).toBeNull();
  });
  it('Alpha 隐写：按列读出 gzip 数据', () => {
    const payload = gzipSync(Buffer.from(JSON.stringify({ Comment: '{}' })));
    const bytes = [...Buffer.from('stealth_pngcomp'), 0, 0, 0, 0, ...payload];
    const bitsLen = payload.length * 8;
    bytes[15] = (bitsLen >>> 24) & 255; bytes[16] = (bitsLen >>> 16) & 255; bytes[17] = (bitsLen >>> 8) & 255; bytes[18] = bitsLen & 255;
    const w = 40, h = 30, alpha = new Uint8Array(w * h).fill(254);
    let pos = 0;
    for (const b of bytes) for (let k = 7; k >= 0; k--) { const x = Math.floor(pos / h), y = pos % h; alpha[y * w + x] = 254 | ((b >> k) & 1); pos++; }
    const out = readStealth(alpha, w, h)!;
    expect(Buffer.from(out).equals(payload)).toBe(true);
    expect(readStealth(new Uint8Array(w * h).fill(255), w, h)).toBeNull();
  });
  it('WebP EXIF 里的 JSON', () => {
    const json = JSON.stringify({ Comment: '{"prompt":"x"}', Source: 'NovelAI Diffusion V4.5 4BDE2A90' });
    const exif = new Uint8Array([...Buffer.from('MM\0*'), ...Buffer.from('ASCII\0\0\0'), ...Buffer.from(json)]);
    const len = exif.length, pad = len & 1;
    const body = new Uint8Array([...Buffer.from('WEBP'), ...Buffer.from('EXIF'), len & 255, (len >> 8) & 255, 0, 0, ...exif, ...(pad ? [0] : [])]);
    const riff = new Uint8Array([...Buffer.from('RIFF'), body.length & 255, (body.length >> 8) & 255, 0, 0, ...body]);
    expect(readWebpExif(riff)).toMatchObject({ Source: 'NovelAI Diffusion V4.5 4BDE2A90', Comment: '{"prompt":"x"}' });
  });
  it('尺寸认档位，清理括号', () => {
    expect(sizeParams(1216, 832)).toMatchObject({ tier: 'normal', orient: 'landscape' });
    expect(sizeParams(1000, 700).tier).toBe('custom');
    expect(cleanBrackets('{{1girl}},[[rain]],smile')).toBe('1girl, rain, smile');
  });
});
