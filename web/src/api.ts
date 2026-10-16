import type { Account, CharacterInput, GenParams, ModelKey, RefType } from '@nai/shared';
import type { Chunk } from './store.ts';

// 本机服务要求这个请求头，用来挡住其他网页的跨站调用
const H = { 'x-nai-canvas': '1' };

export interface ProjectMeta { id: string; name: string; updatedAt: number; nodes: number }
export interface ProjectData { name: string; nodes?: unknown[]; edges?: unknown[]; viewport?: { x: number; y: number; zoom: number } }

function send<T>(method: string, url: string, body?: unknown) {
  return fetch(url, { method, headers: { ...H, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) }).then(r => json<T>(r));
}

export interface ServerConfig {
  hasToken: boolean; tokenHint: string | null; outputDir: string; mock: boolean; dataDir?: string;
  fileTemplate?: string; dateFolders?: boolean; format?: 'png' | 'webp'; straightAlpha?: boolean; stream?: boolean;
}
export interface LibEntry { url: string; at: number; w: number; h: number; seed?: number; model?: string; prompt?: string; kind: string; fav?: boolean; bytes: number }
export interface LibResult { total: number; all: number; items: LibEntry[]; days: { k: string; n: number }[]; models: { k: string; n: number }[]; kinds: { k: string; n: number }[] }

/** 输出和上传的图用缩略图（服务端生成并缓存）；别的地址原样返回 */
export const thumb = (url: string, w: number) => (/^\/(outputs|uploads)\//.test(url) ? `/thumb?u=${encodeURIComponent(url)}&w=${w}` : url);

async function json<T>(res: Response): Promise<T> {
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((j as { error?: string }).error || `请求失败（${res.status}）`);
  return j as T;
}

export const api = {
  config: () => fetch('/api/config', { headers: H }).then(r => json<ServerConfig>(r)),
  saveToken: (token: string | null) => fetch('/api/config', { method: 'PUT', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ token }) }).then(r => json<{ ok: true; account?: Account }>(r)),
  account: () => fetch('/api/account', { headers: H }).then(r => json<Account>(r)),
  projects: () => fetch('/api/projects', { headers: H }).then(r => json<{ current: string | null; projects: ProjectMeta[] }>(r)),
  createProject: (name: string) => send<ProjectMeta>('POST', '/api/projects', { name }),
  loadProject: (id: string) => fetch(`/api/projects/${id}`, { headers: H }).then(r => json<ProjectData>(r)),
  saveProject: (id: string, data: unknown) => send<{ ok: true }>('PUT', `/api/projects/${id}`, data),
  renameProject: (id: string, name: string) => send<{ ok: true }>('PATCH', `/api/projects/${id}`, { name }),
  duplicateProject: (id: string) => send<ProjectMeta>('POST', `/api/projects/${id}/duplicate`, {}),
  deleteProject: (id: string) => send<{ ok: true }>('DELETE', `/api/projects/${id}`),
  restoreProject: (id: string) => send<{ ok: true }>('POST', `/api/projects/${id}/restore`, {}),
  chunks: () => fetch('/api/chunks', { headers: H }).then(r => json<Chunk[]>(r)),
  saveChunks: (list: Chunk[]) => send<{ ok: true }>('PUT', '/api/chunks', list),
  renameMacro: (from: string, to: string, skip?: string) => send<{ updated: number }>('POST', '/api/chunks/rename', { from, to, skip }),
  upscale: (url: string, w: number, h: number) => send<{ url: string; w: number; h: number; cost: number }>('POST', '/api/upscale', { url, w, h }),
  vibeRegister: (url: string) => send<VibeSummary>('POST', '/api/vibes/register', { url }),
  vibeFromEncoding: (encoding: string, model: ModelKey) => send<VibeSummary>('POST', '/api/vibes/encoding', { encoding, model }),
  vibeInfo: (ids: string[]) => send<Record<string, VibeSummary>>('POST', '/api/vibes/info', { ids }),
  vibeImport: (text: string) => fetch('/api/vibes/import', { method: 'POST', headers: { ...H, 'Content-Type': 'text/plain' }, body: text }).then(r => json<{ items: (VibeSummary & { url?: string; importInfo?: { model: string; information_extracted: number; strength: number } })[]; bad: number }>(r)),
  vibeExport: (items: { id: string; ie: number; strength: number; model: ModelKey }[], encodingOnly = false) => send<unknown>('POST', '/api/vibes/export', { items, encodingOnly }),
  tool: (body: { tool: string; image: string; width: number; height: number; prompt?: string; defry?: number; emotion?: string; keepBubbles?: boolean }) => send<{ urls: string[]; w: number; h: number }>('POST', '/api/tool', body),
  saveSettings: (patch: Partial<Pick<ServerConfig, 'fileTemplate' | 'dateFolders' | 'format' | 'straightAlpha' | 'stream'>> & { outputDir?: string }) => send<ServerConfig>('PUT', '/api/settings', patch),
  namePreview: (template: string) => send<{ name: string }>('POST', '/api/settings/name-preview', { template }),
  library: (o: { q?: string; day?: string; model?: string; kind?: string; fav?: boolean; offset?: number; limit?: number; rescan?: boolean }) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== '' && v !== false) p.set(k, v === true ? '1' : String(v));
    return fetch(`/api/library?${p}`, { headers: H }).then(r => json<LibResult>(r));
  },
  /** 图库查询（条件放在请求体里，可以带一串地址只看这些图） */
  libraryQuery: (o: { q?: string; day?: string; model?: string; kind?: string; fav?: boolean; offset?: number; limit?: number; urls?: string[]; rescan?: boolean }) => send<LibResult>('POST', '/api/library/query', o),
  libFav: (url: string, fav: boolean) => send<{ ok: true }>('POST', '/api/library/fav', { url, fav }),
  libTrash: (url: string) => send<{ ok: true }>('POST', '/api/library/trash', { url }),
  libRestore: (url: string) => send<{ ok: true }>('POST', '/api/library/restore', { url }),
  importProject: (file: Blob) => fetch('/api/projects/import', { method: 'POST', headers: { ...H, 'Content-Type': 'application/zip' }, body: file }).then(r => json<ProjectMeta & { images: number }>(r)),
  reveal: (url: string) => fetch('/api/reveal', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ url }) }).then(r => json<{ ok: true }>(r)),
};

export interface VibeSummary { id: string; type: 'image' | 'encoding'; name?: string; encodings: Record<string, number[] | 'any'> }

export interface GenBody {
  prompt: string; params: GenParams; characters?: CharacterInput[]; aiPositions?: boolean;
  image?: string; upscaledEnhance?: boolean; mask?: string; size?: [number, number]; kind?: string;
  vibes?: { id: string; ie: number; strength: number }[];
  refs?: { image: string; type: RefType; strength: number; fidelity: number }[];
}

export type GenEvent =
  | { event: 'queued'; data: { position: number } }
  | { event: 'encoding'; data: { index: number; total: number } }
  | { event: 'encoded'; data: { count: number } }
  | { event: 'start'; data: { seed: number; steps: number; n: number } }
  | { event: 'progress'; data: { sample: number; step: number; preview?: string } }
  | { event: 'image'; data: { index: number; seed: number; url: string; file: string } }
  | { event: 'done'; data: { count: number } }
  | { event: 'fail'; data: { message: string; status: number } };

/** POST /api/generate，逐个回调服务端推送的事件。EventSource 只支持 GET，所以自己解析流 */
export async function generate(body: GenBody, signal: AbortSignal, on: (e: GenEvent) => void) {
  const res = await fetch('/api/generate', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  if (!res.ok) await json(res);
  const reader = res.body!.getReader(), dec = new TextDecoder();
  let buf = '', ended = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        let event = '', data = '';
        for (const line of block.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).replace(/^ /, '');
        }
        if (event === 'done' || event === 'fail') ended = true;
        if (event) on({ event, data: data ? JSON.parse(data) : {} } as GenEvent);
      }
    }
  } finally {
    // 回调里抛错（比如收到 fail）时把流关掉
    reader.cancel().catch(() => {});
  }
  // 服务出错或重启时流会直接断开，不能当成"生成了 0 张"
  if (!ended && !signal.aborted) throw new Error('和本机服务的连接断了，没收到完整结果。确认服务还在运行后重试');
}
