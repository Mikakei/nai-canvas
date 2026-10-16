import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { MODELS, TOOLS, UPSCALE, apiModel, buildGenerateRequest, cost, normalizeParams, randomSeed, renderName, toolCost, toolName, toolRequest, upscaleCost, vibeModelKey, type CharacterInput, type GenParams, type ModelKey, type RefType, type ToolId, type ToolOpts } from '@nai/shared';
import { tokenizer } from './tokenizer.ts';
import { DATA_DIR, MOCK, PORT, ROOT, loadConfig, outputRoots, saveConfig, tokenHint, writeJsonAtomic, type Config } from './config.ts';
import { fromTrash, getEntry, query, scan, setFav, toTrash } from './library.ts';
import { THUMB_SIZES, thumbnail } from './thumbs.ts';
import { isAbsolute, resolve as resolvePath } from 'node:path';
import { access, mkdir, unlink, writeFile as writeFileFs } from 'node:fs/promises';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { NaiError, augmentImage, encodeVibe, generate, getSubscription, suggestTags, upscale, warmUp, type GenEvent } from './nai.ts';
import { mockAccount, mockEncodeVibe, mockGenerate, mockTags, mockTool, mockUpscale } from './mock.ts';
import { copyTextChunks, imageExt, mimeOf, safeJoin, saveImage, saveUpload } from './storage.ts';
import { encodingFor, importVibes, loadVibe, registerEncoding, registerImage, sha256 as sha, storeEncoding, summary } from './vibes.ts';
import { createProject, duplicateProject, getCurrent, getProject, listProjects, renameProject, restoreProject, saveProject, setCurrent, trashProject, validId, renameMacro } from './projects.ts';

const app = new Hono();
// 没接住的错误也用 JSON 回，前端能显示具体原因，而不是"请求失败（500）"
app.onError((e, c) => { console.error('[server]', e); return c.json({ error: `本机服务出错：${e.message}` }, 500); });

// 只接受本工具前端发来的请求：带自定义请求头的跨站请求会被浏览器预检拦下，
// 防止别的网页偷偷调用本机服务、花掉 Anlas
app.use('/api/*', async (c, next) => {
  if (c.req.header('x-nai-canvas') !== '1') return c.json({ error: 'forbidden' }, 403);
  await next();
});

/* ---------- 设置 ---------- */
const publicConfig = (cfg: Config) => ({
  hasToken: !!cfg.token, tokenHint: tokenHint(cfg.token), outputDir: cfg.outputDir, mock: MOCK, dataDir: DATA_DIR,
  fileTemplate: cfg.fileTemplate ?? '', dateFolders: cfg.dateFolders !== false, format: cfg.format ?? 'png', straightAlpha: !!cfg.straightAlpha, stream: cfg.stream !== false,
});
app.get('/api/config', async c => c.json(publicConfig(await loadConfig())));

/** 改保存相关的设置：输出目录要能创建、能写入；以前的目录记下来，旧图还能打开 */
app.put('/api/settings', async c => {
  const b = await c.req.json<Partial<Pick<Config, 'outputDir' | 'fileTemplate' | 'dateFolders' | 'format' | 'straightAlpha' | 'stream'>>>();
  const cfg = await loadConfig(), patch: Partial<Config> = {};
  if (typeof b.outputDir === 'string' && b.outputDir.trim() && resolvePath(b.outputDir.trim()) !== resolvePath(cfg.outputDir)) {
    const dir = b.outputDir.trim();
    if (!isAbsolute(dir)) return c.json({ error: '请填完整的路径，比如 D:\\NAI 图片' }, 400);
    try {
      await mkdir(dir, { recursive: true });
      const probe = join(dir, `.nai-write-test-${process.pid}`);
      await writeFileFs(probe, 'ok'); await unlink(probe);
    } catch (e) { return c.json({ error: `这个文件夹没法写入：${(e as Error).message}` }, 400); }
    patch.outputDir = resolvePath(dir);
    patch.outputDirs = [cfg.outputDir, ...(cfg.outputDirs ?? [])].filter((d, i, a) => d !== patch.outputDir && a.indexOf(d) === i).slice(0, 10);
  }
  if (typeof b.fileTemplate === 'string') {
    const t = b.fileTemplate.trim().slice(0, 200);
    if (t && !/\{(time|seed|id|index)\b/.test(t)) return c.json({ error: '模板里至少要有 {time}、{seed}、{id}、{index} 之一，不然容易重名' }, 400);
    patch.fileTemplate = t || undefined;
  }
  if (typeof b.dateFolders === 'boolean') patch.dateFolders = b.dateFolders;
  if (b.format === 'png' || b.format === 'webp') patch.format = b.format;
  if (typeof b.straightAlpha === 'boolean') patch.straightAlpha = b.straightAlpha;
  if (typeof b.stream === 'boolean') { patch.stream = b.stream; streamFails = 0; }
  const next = await saveConfig(patch);
  return c.json(publicConfig(next));
});
/** 预览文件名模板 */
app.post('/api/settings/name-preview', async c => {
  const { template } = await c.req.json<{ template: string }>();
  return c.json({ name: renderName(template, { prompt: '1girl, silver hair, raincoat, standing in the rain', seed: 1234567890, date: new Date(), model: 'nai-diffusion-4-5-full', modelName: 'V4.5 Full', width: 832, height: 1216, index: 0, id: 'a1b2c3', type: 'generate', characters: ['girl, silver hair', 'boy, black hair'] }) + '.png' });
});

app.put('/api/config', async c => {
  const body = await c.req.json<{ token?: string | null }>();
  if (body.token === null || body.token === '') { await saveConfig({ token: undefined }); return c.json({ ok: true }); }
  if (typeof body.token === 'string') {
    const token = body.token.trim();
    if (!/^pst-/.test(token)) return c.json({ error: 'Token 格式不对：Persistent API Token 以 pst- 开头。可以在官网的账号设置 → Account 页面获取' }, 400);
    try {
      const account = await getSubscription(token);
      await saveConfig({ token });
      return c.json({ ok: true, account });
    } catch (e) {
      return c.json({ error: e instanceof NaiError ? e.message : `无法连接 NovelAI：${(e as Error).message}` }, 400);
    }
  }
  return c.json({ error: '没有可保存的内容' }, 400);
});

/* ---------- 账户 ---------- */
let mockAnlas = mockAccount.anlas, mockOpus = mockAccount.usage.percent;
app.get('/api/account', async c => {
  if (MOCK) return c.json({ ...mockAccount, anlas: mockAnlas, usage: { ...mockAccount.usage, percent: mockOpus } });
  const cfg = await loadConfig();
  if (!cfg.token) return c.json({ error: '还没有填 Token', needToken: true }, 401);
  try { return c.json(await getSubscription(cfg.token)); }
  catch (e) { return c.json({ error: (e as Error).message }, e instanceof NaiError ? (e.status as 401) : 502); }
});

/* ---------- 生成：串行队列 + SSE 回传 ---------- */
// 所有调用 NovelAI 生成类接口的请求排成一队，同时发会被 429 拒绝
let chain: Promise<unknown> = Promise.resolve();
let waiting = 0;
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn);
  chain = run.catch(() => {});
  return run;
}

const UPLOAD_DIR = join(DATA_DIR, 'uploads');
/** /outputs/… 或 /uploads/… 对应的本地文件 */
async function fileForUrl(url: unknown): Promise<string | null> {
  if (typeof url !== 'string') return null;
  const path = url.split('?')[0];
  if (path.startsWith('/outputs/')) return outputFile(path.slice('/outputs/'.length));
  if (path.startsWith('/uploads/')) return safeJoin(UPLOAD_DIR, path.slice('/uploads/'.length));
  return null;
}
/** /outputs/ 下的相对路径：先在当前输出目录找，找不到再看以前用过的目录 */
async function outputFile(rel: string): Promise<string | null> {
  const roots = outputRoots(await loadConfig());
  let first: string | null = null;
  for (const r of roots) {
    const f = safeJoin(r, rel);
    if (!f) continue;
    first ??= f;
    try { await access(f); return f; } catch { /* 下一个 */ }
  }
  return first;
}
async function readImageB64(url: unknown): Promise<string | null> {
  const f = await fileForUrl(url);
  if (!f) return null;
  try { return (await readFile(f)).toString('base64'); } catch { return null; }
}

interface GenBody {
  prompt: string; params: GenParams; characters?: CharacterInput[]; aiPositions?: boolean;
  /** 底图（base64 PNG，前端已缩放到生成尺寸） */
  image?: string;
  upscaledEnhance?: boolean;
  /** 风格参考：登记过的 id、信息提取量、强度 */
  vibes?: { id: string; ie: number; strength: number }[];
  /** 精确参考：前端已补边的 base64 PNG */
  refs?: { image: string; type: RefType; strength: number; fidelity: number }[];
  /** 局部重绘的遮罩（base64 PNG）和聚焦重绘的实际尺寸 */
  mask?: string;
  size?: [number, number];
  /** 生成类型（图库分类用）：img2img、enhance、variation、inpaint… */
  kind?: string;
}
// 流式连续 3 次没拿到图，就改用普通请求（官网同款），重启或改设置后恢复
let streamFails = 0;

app.post('/api/generate', async c => {
  const body = await c.req.json<GenBody>();
  body.params = normalizeParams(body.params);
  const cfg = await loadConfig();
  if (!MOCK && !cfg.token) return c.json({ error: '还没有填 Token：点右上角的设置按钮，填入 Persistent API Token' }, 400);
  if (!body.prompt?.trim()) return c.json({ error: '提示词是空的' }, 400);

  const seed = body.params.seedLocked ? body.params.seed >>> 0 : randomSeed();
  const m = MODELS[body.params.model];
  const refs = m.preciseRef ? (body.refs ?? []).filter(r => typeof r.image === 'string' && r.image) : [];
  const vibeIn = m.vibe && !refs.length && !body.mask ? body.vibes ?? [] : [];
  const abort = new AbortController();
  c.req.raw.signal.addEventListener('abort', () => abort.abort());
  const useStream = cfg.stream !== false && streamFails < 3;

  return streamSSE(c, async stream => {
    stream.onAbort(() => abort.abort());
    const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
    const position = waiting++;
    if (position > 0) await send('queued', { position });
    const run = enqueue(async () => {
      waiting--;
      if (abort.signal.aborted) return;
      // 风格参考：没编码过的先编码（每张 2 Anlas），结果存进本地缓存
      const vibes: { encoding: string; strength: number }[] = [];
      let encodes = 0;
      try {
        for (const [i, v] of vibeIn.entries()) {
          const file = await loadVibe(v.id);
          if (!file) throw new NaiError(400, `第 ${i + 1} 个风格参考找不到了，请重新放一次图`);
          let enc = encodingFor(file, body.params.model, v.ie);
          if (!enc) {
            if (file.type !== 'image' || !file.image) throw new NaiError(400, `第 ${i + 1} 个风格参考只有其他模型的编码、没有原图，不能在 ${m.label} 上用。换回原来的模型，或者用原图重新放一次`);
            await send('encoding', { index: i, total: vibeIn.length });
            enc = MOCK ? await mockEncodeVibe(file.image, v.ie) : await encodeVibe(cfg.token!, file.image, apiModel(body.params.model, 'high'), v.ie, abort.signal);
            await storeEncoding(file, body.params.model, v.ie, enc);
            encodes++;
          }
          vibes.push({ encoding: enc, strength: v.strength });
        }
      } catch (e) {
        if (abort.signal.aborted) return;
        await send('fail', { message: e instanceof NaiError ? e.message : `风格参考编码失败：${(e as Error).message}`, status: e instanceof NaiError ? e.status : 0 });
        return;
      }
      if (encodes) await send('encoded', { count: encodes });
      const pending: Promise<unknown>[] = [];
      try {
        // 请求整理出错也要告诉前端，不然前端只看到连接断开
        const req = buildGenerateRequest({ prompt: body.prompt, params: body.params, characters: body.characters, aiPositions: body.aiPositions, seed, image: body.image, upscaledEnhance: body.upscaledEnhance, vibes, refs, mask: body.mask, size: body.size, format: cfg.format, straightAlpha: !!cfg.straightAlpha }, useStream);
        await send('start', { seed, steps: req.parameters.steps, n: body.params.nSamples });
        const on = (e: GenEvent) => {
          if (e.type === 'progress') { send('progress', { sample: e.sample, step: e.step, preview: e.preview }); return; }
          const s = (seed + e.index) >>> 0;
          // 局部重绘的原始结果会再贴回原图另存一份，图库里归到 raw 不显示
          const kind = body.mask ? 'raw' : body.kind ?? (body.image ? 'img2img' : 'generate');
          const saving = saveImage(cfg, e.png, { kind, seed: s, prompt: body.prompt, model: body.params.model, modelApi: req.model, index: e.index, characters: body.characters?.map(ch => ch.prompt) }).then(saved => send('image', { index: e.index, seed: s, url: saved.url, file: saved.file }));
          // 先挂上处理：生成还没结束时存图就失败的话，不能当成没人管的错误（Node 会直接退出）
          saving.catch(() => {});
          pending.push(saving);
        };
        // 演示模式下记下最后一次请求（图片只留长度），方便检查发给 NovelAI 的字段
        if (MOCK) writeJsonAtomic(join(DATA_DIR, 'mock-last-request.json'), JSON.parse(JSON.stringify(req, (k, v) => typeof v === 'string' && v.length > 300 ? `<${v.length} chars:${v.slice(0, 40)}>` : v))).catch(() => {});
        const n = MOCK ? await mockGenerate(req, abort.signal, on) : await generate(cfg.token!, req, abort.signal, on, useStream);
        streamFails = 0;
        await Promise.all(pending);
        if (MOCK) { const k = cost({ ...body.params, nSamples: n }, mockAccount, { base: !!body.image, vibes: vibes.length, encodes, refs: refs.length, inpaint: !!body.mask, size: body.size }); mockAnlas -= k.total; if (k.free && body.params.model.startsWith('v5')) mockOpus = Math.max(0, mockOpus - 1); }
        await send('done', { count: n });
      } catch (e) {
        // 存图失败时这里不能再抛，不然前端收不到失败的消息
        await Promise.allSettled(pending);
        if (abort.signal.aborted || (e as Error).name === 'AbortError') return;
        if (useStream && e instanceof NaiError && /没有返回图片/.test(e.message) && ++streamFails >= 3) console.warn('[generate] 流式生成连续 3 次没有拿到图，之后改用普通请求');
        console.error('[generate]', e);
        await send('fail', { message: e instanceof NaiError ? e.message : `生成失败：${(e as Error).message}`, status: e instanceof NaiError ? e.status : 0 });
      }
    });
    await run;
  });
});

/* ---------- 局部重绘：前端把结果按遮罩贴回原图后，存进 outputs，并带上原始结果里的生成信息 ---------- */
app.post('/api/compose', async c => {
  const raw = c.req.query('raw'), seed = c.req.query('seed') ? Number(c.req.query('seed')) >>> 0 : -1;
  const tag = (c.req.query('tag') ?? 'inpaint').replace(/[^a-z0-9-]/gi, '').slice(0, 20) || 'inpaint';
  const from = raw ? await getEntry(raw) : null;
  const png = Buffer.from(await c.req.arrayBuffer());
  if (imageExt(png) !== '.png') return c.json({ error: '只接受 PNG' }, 400);
  const cfg = await loadConfig();
  const rawFile = await fileForUrl(raw);
  let out: Buffer = png;
  if (rawFile) { try { out = copyTextChunks(await readFile(rawFile), png); } catch { /* 原图读不到就不带生成信息 */ } }
  const kind = tag === 'inpaint' ? 'inpaint' : tag === 'grid' ? 'grid' : 'tool';
  return c.json(await saveImage(cfg, out, { kind, seed: seed >= 0 ? seed : from?.seed, prompt: from?.prompt ?? (tag === 'pixelsnap' ? '像素整理' : undefined), model: from?.model as never, suffix: `_${tag}` }));
});

/* ---------- Director Tools：图片由前端缩放好再发来，结果存进 outputs ---------- */
app.post('/api/tool', async c => {
  const body = await c.req.json<{ tool: ToolId; image: string; width: number; height: number } & ToolOpts>();
  const cfg = await loadConfig();
  if (!MOCK && !cfg.token) return c.json({ error: '还没有填 Token' }, 400);
  if (!TOOLS.some(t => t.id === body.tool) || body.tool === 'pixel-snap' || body.tool === 'upscale') return c.json({ error: '不支持的工具' }, 400);
  if (!body.image || !body.width || !body.height) return c.json({ error: '没有图片' }, 400);
  const req = toolRequest(body.tool, body.image, body.width, body.height, body);
  try {
    const pngs = await enqueue(() => (MOCK ? mockTool(req as { req_type: string; image: string }) : augmentImage(cfg.token!, req, c.req.raw.signal)));
    const price = toolCost(body.tool, body.width, body.height, MOCK ? mockAccount : null);
    if (MOCK && price) mockAnlas -= price.price;
    const saved = [];
    for (const png of pngs) saved.push({ ...(await saveImage(cfg, png, { kind: 'tool', prompt: toolName(body.tool), suffix: `_${req.req_type}` })), w: png.readUInt32BE(16), h: png.readUInt32BE(20) });
    return c.json({ urls: saved.map(s => s.url), w: saved[0].w, h: saved[0].h });
  } catch (e) {
    return c.json({ error: e instanceof NaiError ? e.message : `处理失败：${(e as Error).message}` }, 502);
  }
});

/* ---------- 上传图片 ---------- */
app.post('/api/upload', async c => {
  const buf = Buffer.from(await c.req.arrayBuffer());
  const ext = imageExt(buf);
  if (!ext) return c.json({ error: '只支持 PNG、JPEG、WebP、AVIF、GIF 图片' }, 400);
  if (buf.length > 60 * 1024 * 1024) return c.json({ error: '图片太大了（超过 60MB）' }, 400);
  return c.json(await saveUpload(UPLOAD_DIR, buf, ext));
});

/* ---------- 放大 ---------- */
app.post('/api/upscale', async c => {
  const { url, w, h } = await c.req.json<{ url: string; w: number; h: number }>();
  const cfg = await loadConfig();
  if (!MOCK && !cfg.token) return c.json({ error: '还没有填 Token' }, 400);
  const price = upscaleCost(w, h);
  if (price === null) return c.json({ error: `这张图 ${w}×${h} 太大了，放大只支持 ${(3145728).toLocaleString()} 像素以内的图` }, 400);
  const b64 = await readImageB64(url);
  if (!b64) return c.json({ error: '找不到这张图片的文件' }, 404);
  try {
    const png = await enqueue(() => MOCK ? mockUpscale(w, h, w * 7 + h) : upscale(cfg.token!, b64, UPSCALE.model, UPSCALE.blurSigma, c.req.raw.signal));
    if (MOCK) mockAnlas -= price;
    const from = await getEntry(url);
    const saved = await saveImage(cfg, png, { kind: 'upscale', seed: from?.seed, prompt: from?.prompt, model: from?.model as never, suffix: '_upscale' });
    const W = png.readUInt32BE(16), H = png.readUInt32BE(20);
    return c.json({ url: saved.url, w: W, h: H, cost: price });
  } catch (e) {
    return c.json({ error: e instanceof NaiError ? e.message : `放大失败：${(e as Error).message}` }, 502);
  }
});

/* ---------- 风格参考 ---------- */
// 用一张图登记风格参考（不编码，生成时才按模型和信息提取量编码）
app.post('/api/vibes/register', async c => {
  const { url } = await c.req.json<{ url: string }>();
  const b64 = await readImageB64(url);
  if (!b64) return c.json({ error: '找不到这张图片的文件' }, 404);
  return c.json(summary(await registerImage(b64)));
});
// 只有编码没有原图（从别人的图片元数据里读出来的）
app.post('/api/vibes/encoding', async c => {
  const { encoding, model } = await c.req.json<{ encoding: string; model: ModelKey }>();
  const v = typeof encoding === 'string' && encoding ? await registerEncoding(encoding, model) : null;
  return v ? c.json(summary(v)) : c.json({ error: '这个模型不支持风格参考' }, 400);
});
app.post('/api/vibes/info', async c => {
  const { ids } = await c.req.json<{ ids: string[] }>();
  const out: Record<string, ReturnType<typeof summary>> = {};
  for (const id of ids ?? []) { const v = await loadVibe(id); if (v) out[id] = summary(v); }
  return c.json(out);
});
// 导入 .naiv4vibe / .naiv4vibebundle：原图或缩略图另存一份到 uploads 用来显示
app.post('/api/vibes/import', async c => {
  let r;
  try { r = await importVibes(await c.req.text()); } catch { return c.json({ error: '不是有效的风格参考文件' }, 400); }
  const items = [];
  for (const v of r.ok) {
    const pic = v.image ?? v.thumbnail?.replace(/^data:[^,]+,/, '');
    let url: string | undefined;
    if (pic) { const buf = Buffer.from(pic, 'base64'), ext = imageExt(buf); if (ext) url = (await saveUpload(UPLOAD_DIR, buf, ext)).url; }
    items.push({ ...summary(v), url, importInfo: v.importInfo });
  }
  return c.json({ items, bad: r.bad });
});
// 导出：一个是 .naiv4vibe，多个打包成 .naiv4vibebundle；encodingOnly 时去掉原图
app.post('/api/vibes/export', async c => {
  const { items, encodingOnly } = await c.req.json<{ items: { id: string; ie: number; strength: number; model: ModelKey }[]; encodingOnly?: boolean }>();
  const vibes = [];
  for (const it of items ?? []) {
    const v = await loadVibe(it.id);
    if (!v) return c.json({ error: '有一个风格参考找不到了' }, 404);
    const out = { ...v, importInfo: { model: apiModel(it.model, 'high'), information_extracted: it.ie, strength: it.strength } };
    if (encodingOnly && v.type === 'image') {
      const enc = encodingFor(v, it.model, it.ie);
      if (!enc) return c.json({ error: '有一个风格参考还没在这个模型上编码过：先生成一次，或者导出时带上原图' }, 400);
      vibes.push({ ...out, type: 'encoding', image: undefined, id: sha(enc), encodings: { [vibeModelKey(it.model)!]: { unknown: { encoding: enc } } } });
    } else vibes.push(out);
  }
  if (!vibes.length) return c.json({ error: '没有要导出的风格参考' }, 400);
  return c.json(vibes.length === 1 ? vibes[0] : { identifier: 'novelai-vibe-transfer-bundle', version: 1, vibes });
});

/* ---------- 提示词片段 ---------- */
/* ---------- 收藏库：画师串库、角色字典（整份存取，和片段一样） ---------- */
const PRESETS = { artists: join(DATA_DIR, 'artists.json'), characters: join(DATA_DIR, 'characters.json'), prompts: join(DATA_DIR, 'prompts.json') } as const;
type PresetKind = keyof typeof PRESETS;
const PRESET_NAME: Record<PresetKind, string> = { artists: '画师串库', characters: '角色字典', prompts: '提示词词典' };
const presetKind = (k: string): PresetKind | null => (k === 'artists' || k === 'characters' || k === 'prompts' ? k : null);
async function readPresets(k: PresetKind): Promise<{ id: string; name?: string; cover?: string }[]> {
  try { const j = JSON.parse(await readFile(PRESETS[k], 'utf8')); return Array.isArray(j) ? j : []; } catch { return []; }
}
app.get('/api/presets/:kind', async c => {
  const k = presetKind(c.req.param('kind'));
  return k ? c.json(await readPresets(k)) : c.json({ error: '不认识的收藏库' }, 404);
});
app.put('/api/presets/:kind', async c => {
  const k = presetKind(c.req.param('kind'));
  if (!k) return c.json({ error: '不认识的收藏库' }, 404);
  const list = await c.req.json<unknown[]>();
  if (!Array.isArray(list) || list.some(e => !e || typeof e !== 'object' || typeof (e as { id?: unknown }).id !== 'string')) return c.json({ error: '格式不对' }, 400);
  await writeJsonAtomic(PRESETS[k], list);
  return c.json({ ok: true });
});
/** 导出整个库：list.json + 封面图片，打成 zip */
app.get('/api/presets/:kind/export', async c => {
  const k = presetKind(c.req.param('kind'));
  if (!k) return c.json({ error: '不认识的收藏库' }, 404);
  const list = await readPresets(k);
  const files: Record<string, Uint8Array> = { 'list.json': strToU8(JSON.stringify({ kind: k, version: 1, items: list }, null, 1)) };
  for (const e of list) {
    if (typeof e.cover !== 'string') continue;
    const f = await fileForUrl(e.cover);
    if (f) { try { files[`covers${e.cover}`] = await readFile(f); } catch { /* 封面文件没了 */ } }
  }
  const name = encodeURIComponent(`${PRESET_NAME[k]}.nai-${k}.zip`);
  return new Response(zipSync(files, { level: 0 }), { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${name}` } });
});
/** 导入：合并进现有的库。同一条（编号相同）已经有了就跳过；封面放进 uploads */
app.post('/api/presets/:kind/import', async c => {
  const k = presetKind(c.req.param('kind'));
  if (!k) return c.json({ error: '不认识的收藏库' }, 404);
  const buf = new Uint8Array(await c.req.arrayBuffer());
  let items: { id?: unknown; cover?: unknown }[] = [];
  const covers = new Map<string, string>();
  try {
    if (buf[0] === 0x50 && buf[1] === 0x4b) {
      const z = unzipSync(buf);
      const j = JSON.parse(strFromU8(z['list.json'] ?? new Uint8Array()));
      if (j.kind && j.kind !== k) return c.json({ error: `这是${PRESET_NAME[j.kind as PresetKind] ?? '别的库'}的备份，不是${PRESET_NAME[k]}` }, 400);
      items = Array.isArray(j.items) ? j.items : [];
      for (const [path, bytes] of Object.entries(z)) {
        if (!path.startsWith('covers/') || !bytes.length) continue;
        const b = Buffer.from(bytes), ext = imageExt(b);
        if (ext) covers.set(path.slice('covers'.length), (await saveUpload(UPLOAD_DIR, b, ext)).url);
      }
    } else {
      const j = JSON.parse(strFromU8(buf));
      items = Array.isArray(j) ? j : Array.isArray(j.items) ? j.items : [];
    }
  } catch { return c.json({ error: '不是有效的收藏库文件（zip 或 json）' }, 400); }
  const list = await readPresets(k), ids = new Set(list.map(e => e.id));
  let added = 0;
  for (const e of items) {
    if (!e || typeof e !== 'object' || typeof e.id !== 'string' || ids.has(e.id)) continue;
    const cover = typeof e.cover === 'string' ? covers.get(e.cover) ?? (e.cover.startsWith('/uploads/') ? e.cover : undefined) : undefined;
    list.push({ ...(e as { id: string }), cover });
    ids.add(e.id);
    added++;
  }
  await writeJsonAtomic(PRESETS[k], list);
  return c.json({ added, skipped: items.length - added, items: list });
});

const CHUNKS = join(DATA_DIR, 'chunks.json');
app.get('/api/chunks', async c => { try { return c.json(JSON.parse(await readFile(CHUNKS, 'utf8'))); } catch { return c.json([]); } });
/** 片段改名后，把其他画布里的引用一起改掉 */
app.post('/api/chunks/rename', async c => {
  const { from, to, skip } = await c.req.json<{ from?: unknown; to?: unknown; skip?: unknown }>();
  if (typeof from !== 'string' || typeof to !== 'string' || !from || !to || /[!\n]/.test(from + to)) return c.json({ error: '片段名不对' }, 400);
  return c.json({ updated: await renameMacro(from, to, typeof skip === 'string' ? skip : undefined) });
});
app.put('/api/chunks', async c => {
  const list = await c.req.json<unknown[]>();
  if (!Array.isArray(list)) return c.json({ error: '格式不对' }, 400);
  await writeJsonAtomic(CHUNKS, list);
  return c.json({ ok: true });
});

/* ---------- Token 计数 ---------- */
app.post('/api/tokens', async c => {
  const { model, texts } = await c.req.json<{ model: ModelKey; texts: string[] }>();
  const m = MODELS[model] ?? MODELS['v5-full'], kind = m.family === 'v5' ? 'qwen' : 't5';
  try {
    const tk = await tokenizer(kind);
    return c.json({ exact: true, kind, limit: m.tokenLimit, counts: texts.map(t => tk.count(t)) });
  } catch {
    return c.json({ exact: false, kind, limit: m.tokenLimit, counts: [] });
  }
});

/* ---------- 标签补全 ---------- */
app.get('/api/suggest-tags', async c => {
  const prompt = (c.req.query('prompt') ?? '').trim(), model = c.req.query('model') ?? 'nai-diffusion-4-5-full', lang = c.req.query('lang') === 'jp' ? 'jp' : 'en';
  if (prompt.length < 2) return c.json({ tags: [] });
  if (MOCK) return c.json({ tags: mockTags(prompt) });
  const cfg = await loadConfig();
  if (!cfg.token) return c.json({ tags: [] });
  try { return c.json(await suggestTags(cfg.token, model, prompt, lang, c.req.raw.signal)); }
  catch (e) { return c.json({ tags: [], error: (e as Error).message }); }
});
app.post('/api/warmup', async c => { if (!MOCK) warmUp(); return c.json({ ok: true }); });

/* ---------- 图库 ---------- */
app.get('/api/library', async c => {
  const cfg = await loadConfig();
  await scan(outputRoots(cfg), c.req.query('rescan') === '1');
  const q = c.req.query();
  const r = await query({ q: q.q, day: q.day, model: q.model, kind: q.kind, fav: q.fav === '1', offset: Number(q.offset ?? 0), limit: Number(q.limit ?? 120) });
  return c.json(r);
});
/** 同上，条件放在请求体里（"本画布"要带一串地址） */
app.post('/api/library/query', async c => {
  const cfg = await loadConfig();
  const b = await c.req.json<{ q?: string; day?: string; model?: string; kind?: string; fav?: boolean; offset?: number; limit?: number; urls?: unknown; rescan?: boolean }>();
  await scan(outputRoots(cfg), !!b.rescan);
  const urls = Array.isArray(b.urls) ? b.urls.filter((u): u is string => typeof u === 'string').slice(0, 20000) : undefined;
  return c.json(await query({ q: b.q, day: b.day, model: b.model, kind: b.kind, fav: !!b.fav, offset: Number(b.offset ?? 0), limit: Number(b.limit ?? 120), urls }));
});
app.post('/api/library/fav', async c => {
  const { url, fav } = await c.req.json<{ url: string; fav: boolean }>();
  return (await setFav(url, !!fav)) ? c.json({ ok: true }) : c.json({ error: '图库里没有这张图' }, 404);
});
app.post('/api/library/trash', async c => {
  const { url } = await c.req.json<{ url: string }>();
  const file = typeof url === 'string' && url.startsWith('/outputs/') ? await outputFile(url.slice('/outputs/'.length)) : null;
  if (!file) return c.json({ error: '只能删除输出文件夹里的图' }, 400);
  const root = outputRoots(await loadConfig()).find(r => file.startsWith(r)) ?? (await loadConfig()).outputDir;
  try { await toTrash(url, file, root); return c.json({ ok: true }); }
  catch (e) { return c.json({ error: `删除失败：${(e as Error).message}` }, 500); }
});
app.post('/api/library/restore', async c => {
  const { url } = await c.req.json<{ url: string }>();
  return (await fromTrash(url).catch(() => false)) ? c.json({ ok: true }) : c.json({ error: '回收站里没有这张图' }, 404);
});

/* ---------- 画布备份：画布 + 用到的图片 + 风格参考，打成一个 zip ---------- */
app.get('/api/projects/:id/export', async c => {
  const id = c.req.param('id');
  if (!validId(id)) return c.json({ error: '项目编号不对' }, 400);
  const data = await getProject(id);
  if (!data) return c.json({ error: '找不到这个画布' }, 404);
  const json = JSON.stringify(data);
  const files: Record<string, Uint8Array> = { 'project.json': strToU8(json), 'README.txt': strToU8('NAI Canvas 画布备份。在画布菜单里选"导入备份"恢复。\n') };
  for (const url of new Set(json.match(/\/(?:outputs|uploads)\/[^"?#]+/g) ?? [])) {
    const f = await fileForUrl(url);
    if (!f) continue;
    try { files[`files${url}`] = await readFile(f); } catch { /* 文件已经没了 */ }
  }
  for (const vid of new Set([...json.matchAll(/"vibeId":"([0-9a-f]{64})"/g)].map(m => m[1]))) {
    try { files[`vibes/${vid}.naiv4vibe`] = await readFile(join(DATA_DIR, 'vibes', `${vid}.naiv4vibe`)); } catch { /* 没有缓存 */ }
  }
  const zip = zipSync(files, { level: 0 });
  const name = encodeURIComponent(`${(data as { name?: string }).name ?? id}.nai-canvas.zip`);
  return new Response(zip, { headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${name}` } });
});
app.post('/api/projects/import', async c => {
  let entries: Record<string, Uint8Array>;
  try { entries = unzipSync(new Uint8Array(await c.req.arrayBuffer())); } catch { return c.json({ error: '不是有效的备份文件（zip）' }, 400); }
  const pj = entries['project.json'];
  if (!pj) return c.json({ error: '备份里没有 project.json' }, 400);
  let json = strFromU8(pj);
  // 图片都放进 uploads（按内容去重），把画布里的地址换成新的
  const map = new Map<string, string>();
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith('files/') || !bytes.length) continue;
    const buf = Buffer.from(bytes), ext = imageExt(buf);
    if (!ext) continue;
    map.set(path.slice('files'.length), (await saveUpload(UPLOAD_DIR, buf, ext)).url);
  }
  for (const [path, bytes] of Object.entries(entries)) {
    if (!path.startsWith('vibes/') || !path.endsWith('.naiv4vibe')) continue;
    try { await importVibes(strFromU8(bytes)); } catch { /* 坏的就跳过 */ }
  }
  json = json.replace(/"(\/(?:outputs|uploads)\/[^"?#]+)"/g, (m, url: string) => (map.has(url) ? JSON.stringify(map.get(url)) : m));
  let data: { version: number; name?: string; nodes?: unknown[] };
  try { data = JSON.parse(json); } catch { return c.json({ error: '备份里的画布数据坏了' }, 400); }
  const meta = await createProject(`${data.name ?? '导入的画布'}（导入）`);
  await saveProject(meta.id, data);
  await setCurrent(meta.id);
  return c.json({ ...meta, images: map.size });
});

/* ---------- 在资源管理器中显示 ---------- */
app.post('/api/reveal', async c => {
  const { url } = await c.req.json<{ url: string }>();
  const cfg = await loadConfig();
  void cfg;
  const file = await fileForUrl(url);
  if (!file) return c.json({ error: '路径不对' }, 400);
  spawn('explorer.exe', [`/select,${file}`], { detached: true, stdio: 'ignore' }).unref();
  return c.json({ ok: true });
});

/* ---------- 多项目 ---------- */
app.get('/api/projects', async c => c.json({ current: await getCurrent(), projects: await listProjects() }));
app.post('/api/projects', async c => {
  const { name } = await c.req.json<{ name?: string }>();
  const meta = await createProject(name ?? '');
  await setCurrent(meta.id);
  return c.json(meta);
});
app.use('/api/projects/:id/*', async (c, next) => validId(c.req.param('id')) ? next() : c.json({ error: '项目编号不对' }, 400));
app.use('/api/projects/:id', async (c, next) => validId(c.req.param('id')) ? next() : c.json({ error: '项目编号不对' }, 400));
app.get('/api/projects/:id', async c => {
  const data = await getProject(c.req.param('id'));
  if (!data) return c.json({ error: '找不到这个画布，可能已经被删除' }, 404);
  await setCurrent(c.req.param('id'));
  return c.json(data);
});
app.put('/api/projects/:id', async c => (await saveProject(c.req.param('id'), await c.req.json())) ? c.json({ ok: true }) : c.json({ error: '找不到这个画布，可能已经被删除' }, 404));
app.patch('/api/projects/:id', async c => {
  const { name } = await c.req.json<{ name: string }>();
  return (await renameProject(c.req.param('id'), name)) ? c.json({ ok: true }) : c.json({ error: '找不到这个画布' }, 404);
});
app.post('/api/projects/:id/duplicate', async c => {
  const meta = await duplicateProject(c.req.param('id'));
  return meta ? c.json(meta) : c.json({ error: '找不到这个画布' }, 404);
});
app.delete('/api/projects/:id', async c => (await trashProject(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: '找不到这个画布' }, 404));
app.post('/api/projects/:id/restore', async c => (await restoreProject(c.req.param('id'))) ? c.json({ ok: true }) : c.json({ error: '回收站里没有这个画布' }, 404));

/* ---------- 静态文件：生成的图片、构建好的前端 ---------- */
async function sendFile(file: string | null) {
  if (!file) return new Response('Not found', { status: 404 });
  try { return new Response(await readFile(file), { headers: { 'Content-Type': mimeOf(file), 'Cache-Control': 'no-cache' } }); }
  catch { return null; }
}
app.get('/outputs/*', async c => (await sendFile(await outputFile(c.req.path.slice('/outputs/'.length)))) ?? c.notFound());
/** 缩略图：/thumb?u=/outputs/…&w=256；生成不了（WebP、太小）时直接给原图 */
app.get('/thumb', async c => {
  const u = c.req.query('u') ?? '', w = THUMB_SIZES.find(s => s >= Number(c.req.query('w') ?? 256)) ?? 512;
  const file = await fileForUrl(u);
  if (!file) return c.notFound();
  try {
    const png = await thumbnail(file, w);
    if (png) return new Response(new Uint8Array(png), { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'max-age=86400' } });
  } catch { /* 生成失败就用原图 */ }
  return (await sendFile(file)) ?? c.notFound();
});
app.get('/uploads/*', async c => (await sendFile(safeJoin(UPLOAD_DIR, c.req.path.slice('/uploads/'.length)))) ?? c.notFound());
const DIST = join(ROOT, 'web', 'dist');
app.get('*', async c => {
  const p = c.req.path === '/' ? 'index.html' : c.req.path.slice(1);
  return (await sendFile(safeJoin(DIST, p))) ?? (await sendFile(join(DIST, 'index.html'))) ?? c.text('前端还没有构建：请运行 启动.bat，或在 web 目录执行 pnpm build', 404);
});

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, info => {
  const url = `http://localhost:${info.port}`;
  console.log(`NAI Canvas 本地服务已启动：${url}${MOCK ? '（演示模式：不调用 NovelAI）' : ''}`);
  if (process.env.OPEN_BROWSER === '1') {
    // 用系统默认浏览器打开；打不开就算了，服务照常运行
    const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    p.on('error', () => console.log(`没能自动打开浏览器，请手动打开 ${url}`));
    p.unref();
  }
});
