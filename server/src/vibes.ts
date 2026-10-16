// 风格参考的本地缓存：每张参考图一个 data/vibes/{id}.naiv4vibe，格式和官网导出的文件一样，
// 编码结果按"模型 × 信息提取量"存在里面，同样的组合不会重复编码（每次编码 2 Anlas）
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { vibeModelKey, vibeParamsString, type ModelKey } from '@nai/shared';
import { DATA_DIR, writeJsonAtomic } from './config.ts';

export const VIBE_DIR = join(DATA_DIR, 'vibes');
export const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');

export interface VibeFile {
  identifier: 'novelai-vibe-transfer';
  version: 1;
  type: 'image' | 'encoding';
  image?: string;
  id: string;
  encodings: Record<string, Record<string, { encoding: string; params?: { information_extracted: number } }>>;
  name?: string;
  thumbnail?: string;
  createdAt: string;
  importInfo?: { model: string; information_extracted: number; strength: number };
}

const validId = (id: string) => /^[\da-f]{64}$/.test(id);
const fileOf = (id: string) => join(VIBE_DIR, `${id}.naiv4vibe`);

export async function loadVibe(id: string): Promise<VibeFile | null> {
  if (!validId(id)) return null;
  try { return JSON.parse(await readFile(fileOf(id), 'utf8')); } catch { return null; }
}
export const saveVibe = (v: VibeFile) => writeJsonAtomic(fileOf(v.id), v);

/** 用原图登记一个风格参考，id 是图片 base64 的 SHA-256（和官网一致，导出后官网也认） */
export async function registerImage(b64: string, name?: string): Promise<VibeFile> {
  const id = sha256(b64);
  const old = await loadVibe(id);
  if (old) return old;
  const v: VibeFile = { identifier: 'novelai-vibe-transfer', version: 1, type: 'image', image: b64, id, encodings: {}, name: name ?? `${id.slice(0, 6)}-${id.slice(-6)}`, createdAt: new Date().toISOString() };
  await saveVibe(v);
  return v;
}

/** 某个模型、信息提取量下已经编码好的结果；只有编码没有原图的参考不区分信息提取量 */
export function encodingFor(v: VibeFile, model: ModelKey, ie: number): string | null {
  const mk = vibeModelKey(model);
  if (!mk) return null;
  const m = v.encodings[mk];
  if (!m) return null;
  if (v.type === 'encoding') return Object.values(m)[0]?.encoding ?? null;
  return m[sha256(vibeParamsString(ie))]?.encoding ?? null;
}
export async function storeEncoding(v: VibeFile, model: ModelKey, ie: number, encoding: string) {
  const mk = vibeModelKey(model)!;
  (v.encodings[mk] ??= {})[sha256(vibeParamsString(ie))] = { encoding, params: { information_extracted: ie } };
  await saveVibe(v);
}

/** 这张参考在哪些模型、信息提取量下编码过（给前端算价钱用） */
export function summary(v: VibeFile) {
  const enc: Record<string, number[] | 'any'> = {};
  for (const [mk, m] of Object.entries(v.encodings)) enc[mk] = v.type === 'encoding' ? 'any' : Object.values(m).map(e => e.params?.information_extracted ?? 1);
  return { id: v.id, type: v.type, name: v.name, encodings: enc };
}

/** 导入 .naiv4vibe 或 .naiv4vibebundle 的内容，校验 id 后存起来 */
export async function importVibes(text: string): Promise<{ ok: VibeFile[]; bad: number }> {
  const j = JSON.parse(text);
  const list: VibeFile[] = j?.identifier === 'novelai-vibe-transfer-bundle' ? j.vibes ?? [] : [j];
  const ok: VibeFile[] = [];
  let bad = 0;
  for (const v of list) {
    if (v?.identifier !== 'novelai-vibe-transfer' || !validId(v.id)) { bad++; continue; }
    if (v.type === 'image' && (!v.image || sha256(v.image) !== v.id)) { bad++; continue; }
    if (v.type === 'encoding') {
      const first = Object.values(v.encodings ?? {}).flatMap(m => Object.values(m))[0];
      if (!first || sha256(first.encoding) !== v.id) { bad++; continue; }
    }
    const old = await loadVibe(v.id);
    // 已有的编码保留，合并新文件里的
    const merged: VibeFile = old ? { ...old, encodings: { ...old.encodings } } : { ...v, encodings: {} };
    for (const [mk, m] of Object.entries(v.encodings ?? {})) merged.encodings[mk] = { ...(merged.encodings[mk] ?? {}), ...m };
    if (!merged.image && v.image) merged.image = v.image;
    if (!merged.thumbnail && v.thumbnail) merged.thumbnail = v.thumbnail;
    delete merged.importInfo;
    await saveVibe(merged);
    ok.push({ ...merged, importInfo: v.importInfo });
  }
  return { ok, bad };
}

/** 只有编码、没有原图的参考（比如从别人的图里读出来的） */
export async function registerEncoding(encoding: string, model: ModelKey): Promise<VibeFile | null> {
  const mk = vibeModelKey(model);
  if (!mk) return null;
  const id = sha256(encoding);
  const old = await loadVibe(id);
  if (old) return old;
  const v: VibeFile = { identifier: 'novelai-vibe-transfer', version: 1, type: 'encoding', id, encodings: { [mk]: { unknown: { encoding } } }, name: `${id.slice(0, 6)}-${id.slice(-6)}`, createdAt: new Date().toISOString() };
  await saveVibe(v);
  return v;
}
