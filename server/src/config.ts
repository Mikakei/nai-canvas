import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
// 测试时可以用环境变量指到别的目录，避免碰到真实数据
export const DATA_DIR = process.env.NAI_DATA_DIR || join(ROOT, 'data');
const DEFAULT_OUTPUT = process.env.NAI_OUTPUT_DIR || join(ROOT, 'outputs');
export const PORT = Number(process.env.PORT || 8787);
/** 设为 1 时不调用 NovelAI，用本地生成的示意图走完整流程（开发和演示用） */
export const MOCK = process.env.NAI_MOCK === '1';

export interface Config {
  token?: string;
  outputDir: string;
  /** 以前用过的输出目录：换目录后旧图的地址还能打开 */
  outputDirs?: string[];
  /** 文件名模板，见 shared/src/filename.ts */
  fileTemplate?: string;
  /** 按日期分文件夹（默认是） */
  dateFolders?: boolean;
  /** 让 NovelAI 返回 PNG 还是 WebP */
  format?: 'png' | 'webp';
  /** 透明背景图用 straight alpha（默认 premultiplied） */
  straightAlpha?: boolean;
  /** 流式生成：显示中间步骤（默认开） */
  stream?: boolean;
}

/** 当前和以前用过的输出目录，当前的在最前 */
export const outputRoots = (c: Config) => [c.outputDir, ...(c.outputDirs ?? []).filter(d => d !== c.outputDir)];

const CONFIG_FILE = join(DATA_DIR, 'config.json');
let cache: Config | null = null;

export async function loadConfig(): Promise<Config> {
  if (cache) return cache;
  try {
    cache = { outputDir: DEFAULT_OUTPUT, ...JSON.parse(await readFile(CONFIG_FILE, 'utf8')) };
  } catch {
    cache = { outputDir: DEFAULT_OUTPUT };
  }
  return cache!;
}

export async function saveConfig(patch: Partial<Config>): Promise<Config> {
  const next = { ...(await loadConfig()), ...patch };
  if (!next.token) delete next.token;
  await writeJsonAtomic(CONFIG_FILE, next);
  cache = next;
  return next;
}

let tmpSeq = 0;
/**
 * 先写临时文件再改名，避免写到一半断电留下坏文件。
 * 每次用不同的临时文件名，同一个文件同时保存两次也不会互相干扰；Windows 上目标文件被短暂占用时重试几次
 */
export async function writeJsonAtomic(file: string, data: unknown) {
  await mkdir(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${tmpSeq++}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  for (let i = 0; ; i++) {
    try { await rename(tmp, file); return; }
    catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 5 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) { await unlink(tmp).catch(() => {}); throw e; }
      await new Promise(r => setTimeout(r, 40 * (i + 1)));
    }
  }
}

export function tokenHint(token?: string) {
  return token ? `${token.slice(0, 4)}…${token.slice(-4)}` : null;
}
