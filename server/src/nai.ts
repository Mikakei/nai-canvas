import { unzipSync } from 'fflate';
import { Agent, fetch as undiciFetch } from 'undici';
import { explainNaiError, type Account } from '@nai/shared';
import { SseParser } from './sse.ts';

const BASE = 'https://image.novelai.net';

// 长时间保持到 NovelAI 的连接：有的网络环境（比如开了代理）每次新建 TLS 连接要好几秒，
// 复用连接后标签补全这类频繁请求才不会卡
const agent = new Agent({ keepAliveTimeout: 60_000, keepAliveMaxTimeout: 600_000, connections: 6 });
const fetch = ((url: string, init: Record<string, unknown> = {}) => undiciFetch(url, { ...init, dispatcher: agent } as never)) as unknown as typeof globalThis.fetch;

export class NaiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type GenEvent =
  | { type: 'progress'; sample: number; step: number; preview?: string }
  | { type: 'image'; index: number; png: Buffer };

async function fail(res: Response): Promise<never> {
  let message = '';
  try { const j = await res.json() as { message?: string }; message = j.message ?? ''; } catch { /* 不是 JSON */ }
  throw new NaiError(res.status, explainNaiError(res.status, message, res.headers.get('x-correlation-id')));
}

/** 提前建立连接（用户开始打字时调用），之后的请求就不用再等握手 */
export async function warmUp() {
  try { await fetch(`${BASE}/user/subscription`, { method: 'HEAD' }); } catch { /* 只是预热，失败无所谓 */ }
}

const tagCache = new Map<string, unknown>();
/** 标签补全（官网的 suggest-tags 接口），结果缓存在内存里 */
export async function suggestTags(token: string, model: string, prompt: string, lang: string, signal?: AbortSignal) {
  const key = `${model}|${lang}|${prompt}`;
  if (tagCache.has(key)) return tagCache.get(key);
  const q = new URLSearchParams({ model, prompt, lang });
  const res = await fetch(`${BASE}/ai/generate-image/suggest-tags?${q}`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!res.ok) await fail(res);
  const j = await res.json();
  if (tagCache.size > 2000) tagCache.delete(tagCache.keys().next().value!);
  tagCache.set(key, j);
  return j;
}

export async function getSubscription(token: string, signal?: AbortSignal): Promise<Account> {
  const res = await fetch(`${BASE}/user/subscription`, { headers: { Authorization: `Bearer ${token}` }, signal });
  if (!res.ok) await fail(res);
  const j = await res.json() as {
    tier: number; active: boolean;
    trainingStepsLeft?: { fixedTrainingStepsLeft?: number; purchasedTrainingSteps?: number };
    usage?: Account['usage'];
  };
  const t = j.trainingStepsLeft ?? {};
  return { tier: j.tier, active: j.active, anlas: (t.fixedTrainingStepsLeft ?? 0) + (t.purchasedTrainingSteps ?? 0), usage: j.usage };
}

function dataUrl(b64: string) {
  const mime = b64.startsWith('/9j/') ? 'image/jpeg' : b64.startsWith('UklGR') ? 'image/webp' : 'image/png';
  return `data:${mime};base64,${b64}`;
}

/** 调用流式生成接口，把中间预览和最终图片逐个回调出去 */
export async function generate(token: string, body: unknown, signal: AbortSignal, on: (e: GenEvent) => void, stream = true): Promise<number> {
  const res = await fetch(`${BASE}/ai/generate-image${stream ? '-stream' : ''}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: stream ? 'text/event-stream' : 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) await fail(res);
  const type = res.headers.get('content-type') ?? '';
  let images = 0;

  if (type.includes('event-stream')) {
    const parser = new SseParser(), decoder = new TextDecoder();
    const handle = (raw: { event?: string; data: string }) => {
      let obj: Record<string, any> = {};
      try { obj = JSON.parse(raw.data); } catch { obj = {}; }
      const kind = String(obj.event_type ?? raw.event ?? '').toLowerCase();
      if (kind.includes('intermediate')) {
        on({ type: 'progress', sample: obj.samp_ix ?? 0, step: obj.step_ix ?? 0, preview: obj.image ? dataUrl(obj.image) : undefined });
      } else if (kind.includes('final')) {
        if (!obj.image) return;
        on({ type: 'image', index: obj.samp_ix ?? images, png: Buffer.from(obj.image, 'base64') });
        images++;
      } else if (kind.includes('error')) {
        const status = Number(obj.status ?? obj.statusCode ?? 500);
        throw new NaiError(status, explainNaiError(status, obj.message ?? obj.error ?? ''));
      } else if (raw.data) {
        console.warn('[nai] 未识别的流事件：', raw.event, raw.data.slice(0, 120));
      }
    };
    const reader = res.body!.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const m of parser.push(decoder.decode(value, { stream: true }))) handle(m);
    }
    for (const m of parser.flush()) handle(m);
  } else if (type.includes('zip')) {
    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    for (const name of Object.keys(files).filter(n => /\.(png|webp|jpe?g)$/i.test(n)).sort()) on({ type: 'image', index: images++, png: Buffer.from(files[name]) });
  } else if (type.includes('json')) {
    // 普通请求带 Accept: application/json 时返回 base64 数组；也兼容 { images: [...] }
    const j = await res.json() as unknown;
    const list = Array.isArray(j) ? j : Array.isArray((j as { images?: unknown[] })?.images) ? (j as { images: unknown[] }).images : [];
    for (const it of list) {
      const b64 = typeof it === 'string' ? it : (it as { image?: string })?.image;
      if (typeof b64 === 'string' && b64) { on({ type: 'image', index: images, png: Buffer.from(b64, 'base64') }); images++; }
    }
  } else {
    throw new NaiError(500, `NovelAI 返回了无法识别的格式（${type || '未知'}），请把这条信息反馈给开发者`);
  }
  if (!images) throw new NaiError(500, 'NovelAI 没有返回图片。如果 Anlas 被扣了，请到官网的历史记录里查看');
  return images;
}

/** 风格参考编码（每次 2 Anlas），返回 base64 的编码结果 */
export async function encodeVibe(token: string, image: string, model: string, ie: number, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${BASE}/ai/encode-vibe`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, information_extracted: ie, model }),
    signal,
  });
  if (!res.ok) await fail(res);
  return Buffer.from(await res.arrayBuffer()).toString('base64');
}

/** 放大 2 倍（官网当前用 V5 Curated 的放大模型），返回 PNG */
export async function upscale(token: string, image: string, model: string, blurSigma: number, signal?: AbortSignal): Promise<Buffer> {
  const res = await fetch(`${BASE}/ai/upscale`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ image, model, declared_blur_sigma: blurSigma }),
    signal,
  });
  if (!res.ok) await fail(res);
  const type = res.headers.get('content-type') ?? '';
  const buf = new Uint8Array(await res.arrayBuffer());
  if (type.includes('json')) {
    const j = JSON.parse(Buffer.from(buf).toString('utf8')) as { images?: { image: string }[] };
    if (j.images?.[0]) return Buffer.from(j.images[0].image, 'base64');
  }
  if (buf[0] === 0x89 && buf[1] === 0x50) return Buffer.from(buf);
  const files = unzipSync(buf);
  const name = Object.keys(files).sort()[0];
  if (!name) throw new NaiError(500, 'NovelAI 没有返回放大后的图片');
  return Buffer.from(files[name]);
}

/** Director Tools（/ai/augment-image）：返回 zip，里面是一张或几张 PNG（去背景是三张） */
export async function augmentImage(token: string, body: unknown, signal?: AbortSignal): Promise<Buffer[]> {
  const res = await fetch(`${BASE}/ai/augment-image`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) await fail(res);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf[0] === 0x89 && buf[1] === 0x50) return [Buffer.from(buf)];
  const files = unzipSync(buf);
  const names = Object.keys(files).filter(n => n.endsWith('.png')).sort();
  if (!names.length) throw new NaiError(500, 'NovelAI 没有返回处理后的图片');
  return names.map(n => Buffer.from(files[n]));
}
