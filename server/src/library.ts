// 图库索引：outputs 里每张图的尺寸、模型、提示词、种子、类型、收藏。存在 data/library.json。
// 新图在保存时直接登记；以前的图在第一次打开图库时扫描补上（读图里的生成信息）
import { access, mkdir, readFile, rename, stat, open, readdir } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseNaiMeta, readPngText, readWebpExif } from '@nai/shared';
import { DATA_DIR, writeJsonAtomic } from './config.ts';
import { imageDims } from './storage.ts';

export interface Entry {
  url: string;
  /** 文件修改时间（毫秒） */
  at: number;
  w: number; h: number;
  seed?: number;
  model?: string;
  prompt?: string;
  /** generate / img2img / inpaint / enhance / variation / tool / upscale / grid */
  kind: string;
  fav?: boolean;
  bytes: number;
}
interface Trashed { entry: Entry; file: string; trashFile: string }

const FILE = join(DATA_DIR, 'library.json');
let items: Map<string, Entry> | null = null;
let loading: Promise<Map<string, Entry>> | null = null;
let trash = new Map<string, Trashed>();
let scanned = false;
let saveTimer: NodeJS.Timeout | null = null;

/** 只读一次文件；同时来的调用等同一次读取，不会互相覆盖 */
function load(): Promise<Map<string, Entry>> {
  if (items) return Promise.resolve(items);
  loading ??= (async () => {
    try {
      const j = JSON.parse(await readFile(FILE, 'utf8')) as { items?: Entry[]; trash?: Trashed[] };
      items = new Map((j.items ?? []).map(e => [e.url, e]));
      trash = new Map((j.trash ?? []).map(t => [t.entry.url, t]));
    } catch { items = new Map(); }
    return items;
  })();
  return loading;
}
function save() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; if (items) writeJsonAtomic(FILE, { version: 1, items: [...items.values()], trash: [...trash.values()].slice(-200) }).catch(() => {}); }, 800);
}

/** 保存新图时登记 */
export async function addEntry(e: Entry) {
  (await load()).set(e.url, e);
  save();
}

/** 从文件名后缀猜类型（扫描旧图时用） */
function kindOf(name: string): string {
  const m = /_([a-z-]+)(?:_\d+)?\.(png|webp|jpg)$/i.exec(name);
  const s = m?.[1] ?? '';
  if (s === 'inpaint') return 'inpaint';
  if (s === 'grid') return 'grid';
  if (s === 'upscale') return 'upscale';
  if (['bg-removal', 'declutter', 'declutter-keep-bubbles', 'lineart', 'sketch', 'colorize', 'emotion', 'pixelsnap'].includes(s)) return 'tool';
  return 'generate';
}

/** 读一张图的尺寸和生成信息（只读开头一段就够了，PNG 的文本块在图像数据前面） */
async function inspect(file: string, url: string): Promise<Entry | null> {
  try {
    const st = await stat(file);
    const fh = await open(file, 'r');
    const len = Math.min(st.size, url.endsWith('.webp') ? st.size : 512 * 1024);
    const buf = Buffer.alloc(len);
    await fh.read(buf, 0, len, 0); await fh.close();
    const dims = imageDims(buf);
    if (!dims) return null;
    const fields = { ...readPngText(buf), ...readWebpExif(buf) };
    const meta = parseNaiMeta(fields);
    return {
      url, at: st.mtimeMs, w: dims[0], h: dims[1], bytes: st.size, kind: kindOf(basename(file)),
      seed: meta?.seed, model: meta && !meta.unknownModel ? meta.params.model : undefined, prompt: meta?.prompt,
    };
  } catch { return null; }
}

/** 扫描所有输出目录（当前的和以前用过的），补上没登记的图，去掉已经不存在的 */
export async function scan(roots: string[], force = false) {
  const map = await load();
  if (scanned && !force) return;
  scanned = true;
  // 扫描过程中新存的图不在 before 里，扫完时不会被当成"已经不存在"删掉
  const seen = new Set<string>(), before = new Set(map.keys());
  for (const [ri, root] of roots.entries()) {
    // 不按日期分文件夹时，图直接在输出目录里
    try {
      for (const f of (await readdir(root)).filter(n => /\.(png|webp|jpe?g)$/i.test(n))) {
        const url = `/outputs/${f}`;
        if (seen.has(url)) continue;
        seen.add(url);
        if (!map.has(url)) { const e = await inspect(join(root, f), url); if (e) map.set(url, e); await new Promise(r => setImmediate(r)); }
      }
    } catch { /* 目录不存在 */ }
    let days: string[] = [];
    try { days = (await readdir(root, { withFileTypes: true })).filter(d => d.isDirectory() && /^\d{4}-\d{2}-\d{2}$/.test(d.name)).map(d => d.name); } catch { continue; }
    for (const day of days) {
      let files: string[] = [];
      try { files = (await readdir(join(root, day))).filter(f => /\.(png|webp|jpe?g)$/i.test(f)); } catch { continue; }
      for (const f of files) {
        const url = `/outputs/${day}/${f}`;
        // 同一个相对路径在新目录里有了，就不再看旧目录的
        if (seen.has(url)) continue;
        seen.add(url);
        if (map.has(url)) continue;
        const e = await inspect(join(root, day, f), url);
        if (e) map.set(url, e);
        // 每扫一张让出一下，别卡住生成
        await new Promise(r => setImmediate(r));
      }
    }
    void ri;
  }
  for (const url of before) if (!seen.has(url)) map.delete(url);
  save();
}

export interface Query { q?: string; day?: string; model?: string; kind?: string; fav?: boolean; offset?: number; limit?: number;
  /** 只看这些图（比如"本画布"：画布上出现过的图） */
  urls?: string[] }
const dayOf = (t: number) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export async function query(o: Query) {
  // 局部重绘的原始结果（raw）不算在图库里，贴回原图的那张才是成品
  const only = o.urls ? new Set(o.urls) : null;
  const all = [...(await load()).values()].filter(e => (o.kind === 'raw' || e.kind !== 'raw') && (!only || only.has(e.url))).sort((a, b) => b.at - a.at);
  const q = o.q?.trim().toLowerCase();
  const list = all.filter(e => (!q || (e.prompt ?? '').toLowerCase().includes(q) || String(e.seed ?? '').includes(q))
    && (!o.day || dayOf(e.at) === o.day) && (!o.model || (e.model ?? '') === o.model) && (!o.kind || e.kind === o.kind) && (!o.fav || e.fav));
  const count = (key: (e: Entry) => string) => { const m = new Map<string, number>(); for (const e of all) { const k = key(e); m.set(k, (m.get(k) ?? 0) + 1); } return [...m.entries()].map(([k, n]) => ({ k, n })); };
  const offset = Math.max(0, o.offset ?? 0), limit = Math.min(500, Math.max(1, o.limit ?? 120));
  return {
    total: list.length, all: all.length, items: list.slice(offset, offset + limit),
    days: count(e => dayOf(e.at)).sort((a, b) => b.k.localeCompare(a.k)),
    models: count(e => e.model ?? '').sort((a, b) => b.n - a.n),
    kinds: count(e => e.kind).sort((a, b) => b.n - a.n),
  };
}

export async function getEntry(url: string) { return (await load()).get(url) ?? null; }

export async function setFav(url: string, fav: boolean) {
  const e = (await load()).get(url);
  if (!e) return false;
  e.fav = fav; save();
  return true;
}

/** 删除到回收站：文件移到输出目录下的 .trash，可以恢复 */
export async function toTrash(url: string, file: string, root: string) {
  const map = await load(), e = map.get(url);
  const dir = join(root, '.trash');
  await mkdir(dir, { recursive: true });
  const trashFile = join(dir, `${Date.now()}_${basename(file)}`);
  await rename(file, trashFile);
  map.delete(url);
  if (e) trash.set(url, { entry: e, file, trashFile });
  save();
}
export async function fromTrash(url: string) {
  await load();
  const t = trash.get(url);
  if (!t) return false;
  // 原来的位置已经有同名的新图时不覆盖
  if (await access(t.file).then(() => true, () => false)) throw new Error('原来的位置已经有同名的图了');
  await rename(t.trashFile, t.file);
  trash.delete(url);
  items!.set(url, t.entry);
  save();
  return true;
}
