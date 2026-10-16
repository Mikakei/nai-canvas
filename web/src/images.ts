// 浏览器里处理图片：读尺寸和生成信息、上传、按生成尺寸缩放底图、给精确参考补边
import { directorLayout, parseNaiMeta, readPngText, readStealth, readWebpExif, type ImportedMeta } from '@nai/shared';

const H = { 'x-nai-canvas': '1' };

async function bitmapOf(src: Blob | string): Promise<ImageBitmap> {
  const blob = typeof src === 'string' ? await (await fetch(src)).blob() : src;
  return createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
}

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
}

async function pngB64(c: HTMLCanvasElement): Promise<string> {
  const blob = await new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error('图片编码失败'))), 'image/png'));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 图生图底图：拉伸到生成尺寸；透明背景模型保留透明，其他模型垫白底（官网同款） */
export async function baseImage(url: string, w: number, h: number, transparent: boolean): Promise<string> {
  const bmp = await bitmapOf(url);
  const [c, g] = canvas(w, h);
  if (!transparent) { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  return pngB64(c);
}

/** 精确参考：等比缩放到 1024×1536 / 1536×1024 / 1472×1472 中比例最接近的一种，四周补黑 */
export async function directorImage(url: string): Promise<string> {
  const bmp = await bitmapOf(url);
  const l = directorLayout(bmp.width, bmp.height);
  const [c, g] = canvas(l.W, l.H);
  g.fillStyle = '#000'; g.fillRect(0, 0, l.W, l.H);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, l.dx, l.dy, l.dw, l.dh);
  bmp.close();
  return pngB64(c);
}

async function gunzip(data: Uint8Array): Promise<string> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
}

/** 读图片里的 NovelAI 生成信息：先看 PNG 文本块 / WebP EXIF，没有时再看 Alpha 通道隐写 */
export async function readMeta(file: Blob, bmp?: ImageBitmap): Promise<ImportedMeta | null> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const fields = { ...readPngText(bytes), ...readWebpExif(bytes) };
  const direct = parseNaiMeta(fields);
  if (direct) return direct;
  try {
    const b = bmp ?? await bitmapOf(file);
    if (b.width * b.height > 16_777_216) return null;
    const [, g] = canvas(b.width, b.height);
    g.drawImage(b, 0, 0);
    const px = g.getImageData(0, 0, b.width, b.height).data;
    const alpha = new Uint8Array(b.width * b.height);
    for (let i = 0; i < alpha.length; i++) alpha[i] = px[i * 4 + 3];
    const gz = readStealth(alpha, b.width, b.height);
    if (!gz) return null;
    const j = JSON.parse(await gunzip(gz)) as Record<string, unknown>;
    const f = Object.fromEntries(Object.entries(j).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]));
    return parseNaiMeta(f);
  } catch { return null; }
}

export interface Uploaded { url: string; iw: number; ih: number; name: string; meta: ImportedMeta | null }

/** 上传一张本地图片：服务端按内容去重存到 data\uploads，同时读出尺寸和生成信息 */
export async function uploadImage(file: File | Blob, name = (file as File).name ?? '粘贴的图片'): Promise<Uploaded> {
  let bmp: ImageBitmap;
  try { bmp = await bitmapOf(file); } catch { throw new Error('这个文件不是能打开的图片'); }
  try {
    const [meta, res] = await Promise.all([
      readMeta(file, bmp).catch(() => null),
      fetch('/api/upload', { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: file }),
    ]);
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j as { error?: string }).error || `上传失败（${res.status}）`);
    return { url: (j as { url: string }).url, iw: bmp.width, ih: bmp.height, name, meta };
  } finally { bmp.close(); }
}

/** 已经在服务端的图（比如生成结果），读它的生成信息 */
export async function metaOfUrl(url: string): Promise<ImportedMeta | null> {
  try { return await readMeta(await (await fetch(url)).blob()); } catch { return null; }
}

export const isVibeFile = (f: File) => /\.naiv4vibe(bundle)?$/i.test(f.name);
export const isImageFile = (f: File) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif)$/i.test(f.name);

/** 弹出系统的选择文件窗口 */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise(ok => {
    const input = document.createElement('input');
    input.type = 'file'; input.accept = accept; input.multiple = multiple;
    input.onchange = () => ok([...(input.files ?? [])]);
    // 关掉选择窗口没选文件
    input.oncancel = () => ok([]);
    input.click();
  });
}

/** 把一段文字存成文件下载 */
export function downloadText(text: string, name: string, type = 'application/json') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
