import { access, mkdir, writeFile } from 'node:fs/promises';
import { basename, extname, join, normalize, relative, sep } from 'node:path';
import { DEFAULT_NAME, MODELS, renderName, type ModelKey } from '@nai/shared';
import type { Config } from './config.ts';
import { addEntry } from './library.ts';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

/** 生成类图片保存时带的信息：用来起文件名和登记图库 */
export interface SaveInfo {
  kind: string;
  seed?: number;
  prompt?: string;
  model?: ModelKey;
  /** 接口里的模型名 */
  modelApi?: string;
  index?: number;
  characters?: string[];
  /** 文件名后缀（比如 _inpaint、_lineart），方便在文件夹里认出来 */
  suffix?: string;
}

/** 按设置保存到输出目录（默认 日期/时分秒_种子.png），登记到图库，返回文件路径和对外的 URL */
export async function saveImage(cfg: Config, buf: Buffer, info: SaveInfo) {
  const d = new Date();
  const ext = imageExt(buf) ?? '.png', dims = imageDims(buf) ?? [0, 0];
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const name = renderName(cfg.fileTemplate ?? DEFAULT_NAME, {
    prompt: info.prompt, seed: info.seed, date: d, model: info.modelApi, modelName: info.model ? MODELS[info.model]?.label : undefined,
    width: dims[0], height: dims[1], index: info.index, id: Math.random().toString(36).slice(2, 8), type: info.kind, characters: info.characters,
  }) + (info.suffix ?? '');
  const sub = cfg.dateFolders === false ? '' : day;
  const dir = sub ? join(cfg.outputDir, sub) : cfg.outputDir;
  await mkdir(dir, { recursive: true });
  // 同名时加序号；用独占创建（wx），同时保存的几张图也不会互相覆盖
  let file = join(dir, name + ext);
  for (let k = 1; ; k++) {
    try { await writeFile(file, buf, { flag: 'wx' }); break; }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST' || k > 9999) throw e;
      file = join(dir, `${name}_${k}${ext}`);
    }
  }
  const url = `/outputs/${sub ? `${sub}/` : ''}${basename(file)}`;
  await addEntry({ url, at: Date.now(), w: dims[0], h: dims[1], bytes: buf.length, kind: info.kind, seed: info.seed !== undefined && info.seed >= 0 ? info.seed : undefined, model: info.model, prompt: info.prompt });
  return { file, url };
}

/** 图片的宽高：PNG、WebP、JPEG */
export function imageDims(b: Buffer): [number, number] | null {
  if (b.length < 30) return null;
  if (b[0] === 0x89 && b[1] === 0x50) return [b.readUInt32BE(16), b.readUInt32BE(20)];
  if (b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') {
    const fmt = b.toString('latin1', 12, 16);
    if (fmt === 'VP8X') return [1 + b.readUIntLE(24, 3), 1 + b.readUIntLE(27, 3)];
    if (fmt === 'VP8L') { const v = b.readUInt32LE(21); return [1 + (v & 0x3fff), 1 + ((v >> 14) & 0x3fff)]; }
    if (fmt === 'VP8 ') return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1], len = b.readUInt16BE(i + 2);
      if (m >= 0xc0 && m <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(m)) return [b.readUInt16BE(i + 7), b.readUInt16BE(i + 5)];
      i += 2 + len;
    }
  }
  return null;
}

async function exists(f: string) { try { await access(f); return true; } catch { return false; } }

/** 把 URL 路径安全地映射到某个根目录下，拒绝 ../ 之类越界路径 */
export function safeJoin(root: string, urlPath: string): string | null {
  const p = normalize(join(root, decodeURIComponent(urlPath)));
  const rel = relative(root, p);
  return rel.startsWith('..') || rel.includes(`..${sep}`) ? null : p;
}

export const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.avif': 'image/avif', '.gif': 'image/gif',
};
export const mimeOf = (f: string) => MIME[extname(f).toLowerCase()] ?? 'application/octet-stream';

/** 上传的图片按内容的 SHA-256 存到 data/uploads，同一张图只存一份 */
export async function saveUpload(dir: string, buf: Buffer, ext: string) {
  const { createHash } = await import('node:crypto');
  const name = `${createHash('sha256').update(buf).digest('hex').slice(0, 32)}${ext}`;
  await mkdir(dir, { recursive: true });
  const file = join(dir, name);
  if (!(await exists(file))) await writeFile(file, buf);
  return { file, url: `/uploads/${name}` };
}

/** 图片文件头 → 扩展名；不是常见图片格式返回 null */
export function imageExt(b: Buffer): string | null {
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return '.png';
  if (b[0] === 0xff && b[1] === 0xd8) return '.jpg';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return '.webp';
  if (b.subarray(4, 12).toString('latin1').startsWith('ftypavi')) return '.avif';
  if (b.subarray(0, 3).toString('latin1') === 'GIF') return '.gif';
  return null;
}

/** 把 a 里的文本块（生成信息）复制到 b 的 IHDR 后面，b 原有的文本块去掉 */
export function copyTextChunks(a: Buffer, b: Buffer): Buffer {
  const chunks = (buf: Buffer) => {
    const out: { type: string; raw: Buffer }[] = [];
    for (let i = 8; i + 8 <= buf.length;) {
      const len = buf.readUInt32BE(i), type = buf.toString('latin1', i + 4, i + 8);
      out.push({ type, raw: buf.subarray(i, i + 12 + len) });
      i += 12 + len;
      if (type === 'IEND') break;
    }
    return out;
  };
  const text = new Set(['tEXt', 'iTXt', 'zTXt']);
  const from = chunks(a).filter(c => text.has(c.type));
  const to = chunks(b).filter(c => !text.has(c.type));
  const [ihdr, ...rest] = to;
  return Buffer.concat([b.subarray(0, 8), ihdr.raw, ...from.map(c => c.raw), ...rest.map(c => c.raw)]);
}
