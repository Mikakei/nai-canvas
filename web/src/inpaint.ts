// 局部重绘在浏览器里的处理：按请求尺寸准备原图和遮罩，结果按羽化后的遮罩贴回原图（官网同款流程）
import { focusRegion, focusSize, type Rect } from '@nai/shared';

const H = { 'x-nai-canvas': '1' };

export interface MaskedPic { url: string; iw: number; ih: number; mask: string; focus?: Rect; ctx?: number }

async function bitmap(url: string) {
  return createImageBitmap(await (await fetch(url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
}
function canvas(w: number, h: number) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
}
const c0 = (g: CanvasRenderingContext2D) => g.canvas;
const toBlob = (c: HTMLCanvasElement) => new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error('图片编码失败'))), 'image/png'));
async function b64(c: HTMLCanvasElement) {
  const bytes = new Uint8Array(await (await toBlob(c)).arrayBuffer());
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/** 遮罩里有没有画东西 */
export async function maskIsEmpty(url: string) {
  const b = await bitmap(url);
  const [, g] = canvas(b.width, b.height);
  g.drawImage(b, 0, 0); b.close();
  const d = g.getImageData(0, 0, c0(g).width, c0(g).height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] > 64) return false;
  return true;
}

export interface InpaintJob {
  image: string; mask: string;
  /** 实际生成尺寸 */
  size: [number, number];
  /** 在原图里的区域（不聚焦时就是整张图） */
  region: Rect;
  /** 8 像素一格的遮罩，贴回原图时用 */
  grid: Uint8Array; gw: number; gh: number;
}

/**
 * 准备一次重绘：聚焦时只取聚焦区域并放大到约 1MP；否则用生成节点的尺寸。
 * 遮罩先缩到 1/8 的格子（覆盖超过约四分之一就算要重绘），再放大回去，白色为重绘区域、黑色保留
 */
export async function prepareInpaint(pic: MaskedPic, size: [number, number], transparent: boolean): Promise<InpaintJob> {
  const [img, msk] = await Promise.all([bitmap(pic.url), bitmap(pic.mask)]);
  const iw = img.width, ih = img.height;
  const region = pic.focus ? focusRegion(pic.focus, pic.ctx ?? 64, iw, ih) : { x: 0, y: 0, w: iw, h: ih };
  const [w, h] = pic.focus ? focusSize(region.w, region.h) : size;
  const [ic, ig] = canvas(w, h);
  if (!transparent) { ig.fillStyle = '#fff'; ig.fillRect(0, 0, w, h); }
  ig.imageSmoothingQuality = 'high';
  ig.drawImage(img, region.x, region.y, region.w, region.h, 0, 0, w, h);

  const gw = Math.max(1, Math.round(w / 8)), gh = Math.max(1, Math.round(h / 8));
  const [, gg] = canvas(gw, gh);
  gg.imageSmoothingQuality = 'high';
  // 遮罩和原图同尺寸；聚焦时取同一块区域
  gg.drawImage(msk, region.x * msk.width / iw, region.y * msk.height / ih, region.w * msk.width / iw, region.h * msk.height / ih, 0, 0, gw, gh);
  const gd = gg.getImageData(0, 0, gw, gh).data, grid = new Uint8Array(gw * gh);
  for (let i = 0; i < grid.length; i++) grid[i] = gd[i * 4 + 3] > 64 ? 1 : 0;
  // 遮罩只有很细的几笔、哪一格都不到四分之一时，碰到的格子都算上，免得发出一张空遮罩
  if (!grid.includes(1)) for (let i = 0; i < grid.length; i++) grid[i] = gd[i * 4 + 3] > 0 ? 1 : 0;
  if (!grid.includes(1)) { img.close(); msk.close(); throw new Error('遮罩不在这次重绘的范围里（可能在聚焦框外面），重新涂一下遮罩或调整聚焦框'); }
  const [mc, mg] = canvas(w, h);
  mg.fillStyle = '#000'; mg.fillRect(0, 0, w, h); mg.fillStyle = '#fff';
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) if (grid[y * gw + x]) mg.fillRect(Math.floor(x * w / gw), Math.floor(y * h / gh), Math.ceil(w / gw), Math.ceil(h / gh));
  img.close(); msk.close();
  return { image: await b64(ic), mask: await b64(mc), size: [w, h], region, grid, gw, gh };
}

/** 羽化遮罩：格子向外扩 4 格，放大后模糊（官网是扩 4 格、放大 8 倍、模糊 20） */
function softMask(job: InpaintJob, w: number, h: number): HTMLCanvasElement {
  const { grid, gw, gh } = job, dil = new Uint8Array(grid.length), R = 4;
  for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
    if (!grid[y * gw + x]) continue;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const nx = x + dx, ny = y + dy;
      if (nx >= 0 && ny >= 0 && nx < gw && ny < gh && dx * dx + dy * dy <= R * R) dil[ny * gw + nx] = 1;
    }
  }
  const [sc, sg] = canvas(gw, gh), id = sg.createImageData(gw, gh);
  for (let i = 0; i < dil.length; i++) { id.data[i * 4] = id.data[i * 4 + 1] = id.data[i * 4 + 2] = 255; id.data[i * 4 + 3] = dil[i] ? 255 : 0; }
  sg.putImageData(id, 0, 0);
  const [c, g] = canvas(w, h);
  const blur = Math.max(2, Math.round(20 * w / (gw * 8)));
  g.filter = `blur(${blur}px)`;
  g.imageSmoothingEnabled = false;
  g.drawImage(sc, 0, 0, w, h);
  return c;
}

/**
 * 把生成结果贴回原图：结果缩放到区域大小，按羽化遮罩只保留重绘的部分。
 * 不聚焦、也不保留原图时直接用原始结果
 */
export async function composite(resultUrl: string, pic: MaskedPic, job: InpaintJob, keepOriginal: boolean): Promise<Blob | null> {
  if (!pic.focus && !keepOriginal) return null;
  const [orig, res] = await Promise.all([bitmap(pic.url), bitmap(resultUrl)]);
  const { region: r } = job;
  const [out, og] = canvas(orig.width, orig.height);
  og.drawImage(orig, 0, 0);
  const [piece, pg] = canvas(r.w, r.h);
  pg.imageSmoothingQuality = 'high';
  pg.drawImage(res, 0, 0, r.w, r.h);
  if (keepOriginal || pic.focus) {
    pg.globalCompositeOperation = 'destination-in';
    pg.drawImage(softMask(job, r.w, r.h), 0, 0);
  }
  og.drawImage(piece, r.x, r.y);
  orig.close(); res.close();
  return toBlob(out);
}

/** 存贴回后的图到 outputs（带上原始结果的生成信息），返回新地址 */
export async function saveComposite(blob: Blob, rawUrl: string, seed: number): Promise<string> {
  const res = await fetch(`/api/compose?raw=${encodeURIComponent(rawUrl)}&seed=${seed}`, { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: blob });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || '保存失败');
  return (j as { url: string }).url;
}

/** 上传一张画布里画好的图（遮罩、扩图结果），按内容去重 */
export async function uploadBlob(blob: Blob): Promise<string> {
  const res = await fetch('/api/upload', { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: blob });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || '上传失败');
  return (j as { url: string }).url;
}
