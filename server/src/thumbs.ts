// 缩略图：画布上的历史条、网格、图库都用小图，几百张图时也不卡。
// 第一次请求时生成（纯 JS 解码 PNG、按块平均缩小），存在 data/thumbs，之后直接读
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';
import { decodePng, encodeRgba } from './pngio.ts';

const DIR = join(DATA_DIR, 'thumbs');
export const THUMB_SIZES = [128, 256, 384, 512];
let chain: Promise<unknown> = Promise.resolve();

/** 按块平均缩小到宽 w（高按比例） */
function shrink(src: Uint8Array, sw: number, sh: number, w: number): { w: number; h: number; rgba: Uint8Array } {
  const h = Math.max(1, Math.round((sh * w) / sw)), out = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * sh) / h), y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * sw) / w), x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / w));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 1) for (let xx = x0; xx < x1; xx += 1) {
        const i = (yy * sw + xx) * 4, al = src[i + 3];
        r += src[i] * al; g += src[i + 1] * al; b += src[i + 2] * al; a += al; n++;
      }
      const o = (y * w + x) * 4;
      if (a) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / n;
    }
  }
  return { w, h, rgba: out };
}

/**
 * 返回缩略图的 PNG；原图本来就小、或者不是能解的 PNG（WebP、JPEG）时返回 null，调用方直接用原图。
 * 生成过程排队一个一个来，避免一下子占满 CPU
 */
export async function thumbnail(file: string, w: number): Promise<Buffer | null> {
  const st = await stat(file);
  const key = createHash('sha1').update(`${file}|${st.mtimeMs}|${st.size}|${w}`).digest('hex');
  const out = join(DIR, `${key}.png`);
  try { return await readFile(out); } catch { /* 还没有，生成 */ }
  const job = chain.then(async () => {
    const buf = await readFile(file);
    const img = decodePng(buf);
    if (!img || img.w <= w * 1.25) return null;
    const t = shrink(img.rgba, img.w, img.h, w);
    const png = encodeRgba(t.w, t.h, t.rgba);
    await mkdir(DIR, { recursive: true });
    await writeFile(out, png);
    await new Promise(r => setImmediate(r));
    return png;
  });
  chain = job.catch(() => null);
  return job;
}
