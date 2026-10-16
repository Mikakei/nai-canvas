// NAI_MOCK=1 时使用：不调用 NovelAI，按真实流程逐步吐出预览和最终 PNG
import { deflateSync } from 'node:zlib';
import type { GenEvent } from './nai.ts';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crc32(buf: Buffer) { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
export function encodePng(w: number, h: number, rgb: Uint8Array, text: Record<string, string> = {}) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const texts = Object.entries(text).map(([k, v]) => chunk('tEXt', Buffer.from(`${k}\0${v}`, 'latin1')));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), ...texts, chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function rng(seed: number) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** 画一张点阵示意图：progress 从 0 到 1，点从粗到细 */
function render(w: number, h: number, seed: number, progress: number) {
  const R = rng(seed), img = new Uint8Array(w * h * 3).fill(238);
  const moon = { x: (0.25 + R() * 0.5) * w, y: (0.12 + R() * 0.15) * h, r: (0.08 + R() * 0.05) * Math.max(w, h) };
  const hz = (0.56 + R() * 0.1) * h, cell = Math.max(3, Math.round(w / (12 + 70 * progress * progress)));
  const N = rng(seed ^ Math.round(progress * 1000));
  for (let cy = cell / 2; cy < h; cy += cell) for (let cx = cell / 2; cx < w; cx += cell) {
    let d = cy < hz ? 0.6 - 0.36 * (cy / hz) : 0.46 - 0.2 * ((cy - hz) / (h - hz));
    let red = false;
    const dm = Math.hypot(cx - moon.x, cy - moon.y);
    if (dm < moon.r) { d = 0.82; red = true; } else if (cy < hz) d -= 0.4 * Math.exp(-(dm - moon.r) / (moon.r * 0.9));
    const fx = w * 0.5, top = h * 0.42;
    if (Math.hypot(cx - fx, cy - (top + h * 0.035)) < h * 0.035 || (cy > top + h * 0.07 && cy < h * 0.86 && Math.abs(cx - fx) < h * (0.045 + 0.05 * (cy - top) / (h * 0.44)))) { d = 0.95; red = false; }
    d = Math.min(1, Math.max(0, d + (N() - 0.5) * 0.6 * (1 - progress)));
    const rad = (cell / 2) * Math.sqrt(d);
    const [r, g, b] = red ? [215, 25, 33] : [12, 12, 12];
    for (let y = Math.max(0, Math.floor(cy - rad)); y < Math.min(h, cy + rad); y++) for (let x = Math.max(0, Math.floor(cx - rad)); x < Math.min(w, cx + rad); x++) {
      if ((x - cx) ** 2 + (y - cy) ** 2 <= rad * rad) { const i = (y * w + x) * 3; img[i] = r; img[i + 1] = g; img[i + 2] = b; }
    }
  }
  return img;
}

export async function mockGenerate(body: any, signal: AbortSignal, on: (e: GenEvent) => void): Promise<number> {
  const p = body.parameters, steps: number = p.steps, n: number = p.n_samples;
  const pw = Math.round(p.width / 4), ph = Math.round(p.height / 4);
  for (let s = 0; s < n; s++) {
    for (let step = 0; step < steps; step++) {
      await new Promise(r => setTimeout(r, 2200 / steps));
      if (signal.aborted) throw new DOMException('aborted', 'AbortError');
      if (step % 2 === 1) on({ type: 'progress', sample: s, step, preview: `data:image/png;base64,${encodePng(pw, ph, render(pw, ph, p.seed + s, step / steps)).toString('base64')}` });
    }
    const comment = JSON.stringify({ prompt: body.input, ...p, request_type: 'PromptGenerateRequest', mock: true });
    on({ type: 'image', index: s, png: encodePng(p.width, p.height, render(p.width, p.height, p.seed + s, 1), { Software: 'NAI Canvas (mock)', Description: body.input, Comment: comment }) });
  }
  return n;
}

export const mockAccount = { tier: 3, active: true, anlas: 12480, usage: { percent: 70, purchasedPercent: 0, isNegative: false, timeUntilNextPercent: 540 } };

/** 演示模式的标签补全：从一份常见标签里按前缀找 */
const TAGS = ['1girl', '1boy', 'solo', 'long hair', 'short hair', 'silver hair', 'smile', 'looking at viewer', 'rain', 'raincoat', 'night', 'neon lights', 'city', 'cityscape', 'cinematic lighting', 'red moon', 'reflection', 'umbrella', 'standing', 'sitting', 'school uniform', 'blue eyes', 'red eyes'];
export function mockTags(prompt: string) {
  const q = prompt.toLowerCase();
  return TAGS.filter(t => t.startsWith(q) || t.includes(` ${q}`)).slice(0, 10).map((tag, i) => ({ tag, count: 120000 - i * 9000, confidence: 1 - i * 0.08 }));
}

/** 演示模式的风格参考编码：按图片和信息提取量算出一串固定的假数据 */
export async function mockEncodeVibe(image: string, ie: number) {
  await new Promise(r => setTimeout(r, 400));
  const { createHash } = await import('node:crypto');
  return createHash('sha512').update(`${ie}:${image.slice(0, 2000)}`).digest('base64').repeat(8);
}

/** 演示模式的放大：画一张两倍大的点阵图 */
export async function mockUpscale(w: number, h: number, seed: number) {
  await new Promise(r => setTimeout(r, 800));
  const W = Math.min(w * 2, 4096), H = Math.min(h * 2, 4096);
  return encodePng(W, H, render(W, H, seed, 1), { Software: 'NAI Canvas (mock upscale)' });
}

/** 演示模式的图片工具：线稿取边缘、草图转灰、上色加色调、去背景去掉浅色背景，等等 */
export async function mockTool(body: { req_type: string; image: string }) {
  await new Promise(r => setTimeout(r, 900));
  const { decodePng, encodeRgba } = await import('./pngio.ts');
  const img = decodePng(Buffer.from(body.image, 'base64'));
  if (!img) throw new Error('演示模式只能处理 PNG');
  const { w, h, rgba } = img, lum = (i: number) => 0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2];
  const map = (fn: (i: number, o: Uint8Array) => void) => { const o = new Uint8Array(rgba.length); for (let i = 0; i < rgba.length; i += 4) fn(i, o); return encodeRgba(w, h, o); };
  const edge = (i: number) => { const x = (i / 4) % w, y = Math.floor(i / 4 / w); if (!x || !y || x === w - 1 || y === h - 1) return 0; return Math.abs(lum(i + 4) - lum(i - 4)) + Math.abs(lum(i + w * 4) - lum(i - w * 4)); };
  switch (body.req_type) {
    case 'lineart': return [map((i, o) => { const v = 255 - Math.min(255, edge(i) * 3); o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255; })];
    case 'sketch': return [map((i, o) => { const v = 255 - Math.min(255, edge(i) * 2); const g = Math.min(255, v * 0.85 + lum(i) * 0.15 + 30); o[i] = o[i + 1] = o[i + 2] = g; o[i + 3] = 255; })];
    case 'colorize': return [map((i, o) => { const l = lum(i) / 255, y = Math.floor(i / 4 / w) / h; o[i] = 255 * l * (0.9 + 0.1 * y); o[i + 1] = 200 * l + 40 * (1 - y); o[i + 2] = 255 * l * (1 - 0.5 * y) + 30; o[i + 3] = 255; })];
    case 'emotion': return [map((i, o) => { o[i] = Math.min(255, rgba[i] * 1.08 + 12); o[i + 1] = rgba[i + 1]; o[i + 2] = rgba[i + 2] * 0.92; o[i + 3] = rgba[i + 3]; })];
    case 'declutter': case 'declutter-keep-bubbles': return [map((i, o) => { const n = [i, i - 4, i + 4, i - w * 4, i + w * 4].filter(j => j >= 0 && j < rgba.length); for (let c = 0; c < 3; c++) o[i + c] = n.reduce((a, j) => a + rgba[j + c], 0) / n.length; o[i + 3] = 255; })];
    case 'bg-removal': return [
      map((i, o) => { o.set(rgba.subarray(i, i + 3), i); o[i + 3] = lum(i) > 200 ? 0 : 255; }),
      map((i, o) => { o[i] = 255 - rgba[i]; o[i + 1] = 255 - rgba[i + 1]; o[i + 2] = 255 - rgba[i + 2]; o[i + 3] = 255; }),
      map((i, o) => { const k = lum(i) > 200 ? 0.25 : 1; for (let c = 0; c < 3; c++) o[i + c] = rgba[i + c] * k + 255 * (1 - k); o[i + 3] = 255; }),
    ];
    default: throw new Error(`演示模式不支持 ${body.req_type}`);
  }
}
