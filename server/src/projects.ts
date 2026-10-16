// 多项目：每个画布一个 data/projects/{id}.json；删除时移进 .trash，可以恢复
import { mkdir, readFile, readdir, rename, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR, writeJsonAtomic } from './config.ts';

const DIR = join(DATA_DIR, 'projects'), TRASH = join(DIR, '.trash'), STATE = join(DATA_DIR, 'state.json');
export const validId = (id: string) => /^[a-z0-9_-]{1,40}$/i.test(id);
const file = (id: string) => join(DIR, `${id}.json`);
const newId = () => `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

interface ProjectFile { version: number; name?: string; nodes?: unknown[]; edges?: unknown[]; viewport?: unknown }
export interface ProjectMeta { id: string; name: string; updatedAt: number; nodes: number }

const defaultName = (id: string) => (id === 'default' ? '我的画布' : '未命名画布');

async function read(id: string): Promise<ProjectFile | null> {
  try { return JSON.parse(await readFile(file(id), 'utf8')); } catch { return null; }
}

export async function listProjects(): Promise<ProjectMeta[]> {
  await mkdir(DIR, { recursive: true });
  const out: ProjectMeta[] = [];
  for (const f of await readdir(DIR)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (!validId(id)) continue;
    const data = await read(id);
    if (!data) continue;
    out.push({ id, name: data.name || defaultName(id), updatedAt: (await stat(file(id))).mtimeMs, nodes: data.nodes?.length ?? 0 });
  }
  return out.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getProject(id: string) {
  const data = await read(id);
  return data ? { ...data, name: data.name || defaultName(id) } : null;
}

/** 保存画布内容；名字以文件里的为准，避免旧标签页覆盖改过的名字。
 *  画布已经删掉（或不存在）时不保存，免得晚到的自动保存把删掉的画布又"变"回来 */
export async function saveProject(id: string, data: ProjectFile) {
  const old = await read(id);
  if (!old) return false;
  await writeJsonAtomic(file(id), { ...data, version: 1, name: old.name || data.name || defaultName(id) });
  return true;
}

export async function createProject(name: string, content?: ProjectFile): Promise<ProjectMeta> {
  const id = newId();
  await writeJsonAtomic(file(id), { version: 1, nodes: [], edges: [], ...content, name: name.trim() || '未命名画布' });
  return { id, name: name.trim() || '未命名画布', updatedAt: Date.now(), nodes: content?.nodes?.length ?? 0 };
}

export async function renameProject(id: string, name: string) {
  const data = await read(id);
  if (!data) return false;
  await writeJsonAtomic(file(id), { ...data, name: name.trim() || defaultName(id) });
  return true;
}

export async function duplicateProject(id: string) {
  const data = await read(id);
  if (!data) return null;
  return createProject(`${data.name || defaultName(id)} 副本`, data);
}

export async function trashProject(id: string) {
  await mkdir(TRASH, { recursive: true });
  try { await rename(file(id), join(TRASH, `${id}.json`)); return true; } catch { return false; }
}
export async function restoreProject(id: string) {
  try { await rename(join(TRASH, `${id}.json`), file(id)); return true; } catch { return false; }
}

/** 片段改名：所有画布里的 !macro:旧名! 换成新名。当前打开的画布由前端自己改（skip），免得覆盖它还没保存的改动 */
export async function renameMacro(from: string, to: string, skip?: string) {
  await mkdir(DIR, { recursive: true });
  // 在 JSON 文本里替换，名字里的引号、反斜杠要按 JSON 转义后的样子找
  const a = JSON.stringify(`!macro:${from}!`).slice(1, -1), b = JSON.stringify(`!macro:${to}!`).slice(1, -1);
  let n = 0;
  for (const f of await readdir(DIR)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    if (!validId(id) || id === skip) continue;
    try {
      const text = await readFile(file(id), 'utf8');
      if (!text.includes(a)) continue;
      await writeJsonAtomic(file(id), JSON.parse(text.split(a).join(b)));
      n++;
    } catch { /* 读不了的文件跳过 */ }
  }
  return n;
}

export async function getCurrent(): Promise<string | null> {
  try { return (JSON.parse(await readFile(STATE, 'utf8')) as { current?: string }).current ?? null; } catch { return null; }
}
export async function setCurrent(id: string) { await writeJsonAtomic(STATE, { current: id }); }
