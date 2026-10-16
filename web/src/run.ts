import { applyLocks, cost, isMedium, remapCenter, expandMacros, expandRandom, hasRandom, macroNames, sizeOf, MODELS, type CharacterInput, type GenParams } from '@nai/shared';
import { chunkMap } from './chunks.ts';
import { generate, type GenBody } from './api.ts';
import { baseImage, directorImage } from './images.ts';
import { composite, prepareInpaint, saveComposite, type InpaintJob, type MaskedPic } from './inpaint.ts';
import { baseFor, extrasFor, refreshVibes, syncVibe, usableRefs, usableVibes } from './inputs.ts';
import { KINDS, inputsOf, isChar, isGen, isVibe, negativeFor, promptFor, refPic, type AppEdge, type AppNode, type HistItem, type Pic } from './graph.ts';
import { node, refreshAccount, setCancelHook, toast, updateData, useStore, type Runtime } from './store.ts';
import { finishJob, startJob, updateJob } from './jobs.ts';

const controllers = new Map<string, AbortController>();
const set = useStore.setState, get = useStore.getState;

export function setRuntime(id: string, patch: Partial<Runtime> | null) {
  const rt = { ...get().runtime };
  if (patch === null) delete rt[id]; else rt[id] = { ...(rt[id] ?? { status: 'idle' }), ...patch };
  set({ runtime: rt });
}
const isBusy = (id: string) => ['queued', 'running'].includes(get().runtime[id]?.status ?? '');

export function cancel(id: string) {
  controllers.get(id)?.abort();
}
setCancelHook(cancel);

/** 抖一下生图节点的底栏，提示问题出在这里 */
function shake(id: string) {
  const el = document.querySelector(`.react-flow__node[data-id="${id}"] .pbar`);
  if (!el) return;
  el.classList.remove('is-shake'); void (el as HTMLElement).offsetWidth; el.classList.add('is-shake');
}

/** 接到生图节点上、启用了的角色，按连线顺序 */
export function charactersFor(id: string, nodes: AppNode[], edges: AppEdge[]) {
  return edges.filter(e => e.target === id && e.data?.slot === 'chars').map(e => nodes.find(n => n.id === e.source)).filter(isChar).filter(n => n.data.enabled);
}

/** 角色数量超过上限、位置重叠时的提醒文字 */
export function charWarnings(id: string, nodes: AppNode[], edges: AppEdge[]): string[] {
  const g = nodes.find(n => n.id === id);
  if (!isGen(g)) return [];
  const chars = charactersFor(id, nodes, edges), m = MODELS[g.data.params.model], out: string[] = [];
  if (isMedium(g.data.params) && edges.some(e => e.target === id && e.data?.slot === 'negative')) out.push('Medium 档固定使用 Heavy 预设，接入的负面提示词不会生效；切回 High 才能用');
  if (chars.length > m.maxCharacters) out.push(`${m.label} 最多 ${m.maxCharacters} 个角色，排在后面的 ${chars.length - m.maxCharacters} 个不会生效`);
  if (g.data.params.charPos === 'custom') {
    const grid = m.family !== 'v5', key = (n: (typeof chars)[number]) => grid ? `${Math.round(n.data.x * 10)},${Math.round(n.data.y * 10)}` : '';
    for (let i = 0; i < chars.length; i++) for (let j = i + 1; j < chars.length; j++) {
      const a = chars[i], b = chars[j];
      const same = grid ? key(a) === key(b) : Math.hypot(a.data.x - b.data.x, a.data.y - b.data.y) < 0.08;
      if (same) out.push(`「${a.data.title}」和「${b.data.title}」位置重叠，画出来可能混在一起`);
    }
  }
  return out;
}

/** 增强、变体这类一次性的运行：临时换掉底图、参数、提示词，结果照常进历史 */
export interface RunOpts {
  base?: Pic;
  params?: Partial<GenParams>;
  prompt?: (p: string) => string;
  upscaledEnhance?: boolean;
  kind?: HistItem['kind'];
  /** 完成提示里的说法，比如"增强" */
  verb?: string;
  /** 网格对比用：结果不进生图节点的历史，交给 sink；进度显示在 statusId 节点上；不弹提示、不进队列 */
  sink?: (item: HistItem) => void;
  statusId?: string;
  quiet?: boolean;
  signal?: AbortSignal;
}
export interface RunResult { got: number; error?: string; canceled?: boolean }

export async function run(id: string, opts: RunOpts = {}): Promise<RunResult> {
  const n = node(id), sid = opts.statusId ?? id, NONE: RunResult = { got: 0 };
  if (!isGen(n)) return NONE;
  if (isBusy(sid)) { cancel(sid); return NONE; }
  const st = get(), p: GenParams = { ...n.data.params, ...opts.params, negative: negativeFor(id, get().nodes, get().edges) };
  const prompt = opts.prompt ? opts.prompt(promptFor(id, st.nodes, st.edges)) : promptFor(id, st.nodes, st.edges);
  if (!prompt) {
    setRuntime(sid, { status: 'error', error: '缺少提示词' });
    // 接了提示词节点但都是空的：把光标放进第一个；一个都没接：抖一下底栏的"新建提示词"
    const pn = inputsOf(id, 'prompt', st.nodes, st.edges)[0];
    if (pn) {
      toast(`「${pn.data.title}」还是空的，写点想要的画面再生成`, { err: true });
      document.querySelector<HTMLElement>(`.react-flow__node[data-id="${pn.id}"] .cm-content`)?.focus({ preventScroll: true });
    } else {
      toast(`「${n.data.title}」还没有提示词：点卡片下面的「新建提示词」，或者从提示词节点拉一根线过来`, { err: true });
      shake(id);
    }
    return { got: 0, error: '缺少提示词' };
  }
  if (!st.config?.mock && !st.config?.hasToken) {
    toast('还没有填 Token，先在设置里填好再生成', { err: true });
    set({ dialog: 'settings' }); return { got: 0, error: '还没有填 Token' };
  }
  const base = opts.base ?? baseFor(id, st.nodes, st.edges)?.pic ?? null;
  const m = MODELS[p.model];
  const c = cost(p, st.account, opts.base ? { ...extrasFor(id, st.nodes, st.edges), base: true } : extrasFor(id, st.nodes, st.edges));
  if (c.tooLarge) { toast(`单张要 ${c.perImage} Anlas，超过官网上限 140，请减小尺寸或步数`, { err: true }); return { got: 0, error: '超过单张 140 Anlas 上限' }; }
  if (st.account && c.total > st.account.anlas) { toast(`Anlas 不够：这次要 ${c.total}，余额只有 ${st.account.anlas}`, { err: true }); return { got: 0, error: 'Anlas 不够' }; }

  // 展开片段；有随机器时每张图单独请求一次，各自重新随机（官网的做法），实际用到的提示词记进历史
  const chunks = chunkMap();
  const missing = [...new Set([prompt, p.negative, ...charactersFor(id, st.nodes, st.edges).flatMap(ch => [ch.data.text, ch.data.uc])].flatMap(macroNames))].filter(m => !(m in chunks));
  if (missing.length && !opts.quiet) toast(`找不到片段：${missing.join('、')}，会原样发送`, { err: true });
  const baseChars = charactersFor(id, st.nodes, st.edges).filter(ch => ch.data.text.trim()).map(ch => ({ prompt: expandMacros(ch.data.text.trim(), chunks), uc: expandMacros(ch.data.uc.trim(), chunks), x: ch.data.x, y: ch.data.y }));
  const basePrompt = expandMacros(prompt, chunks), baseParams = { ...p, negative: expandMacros(p.negative, chunks) };
  const random = hasRandom(basePrompt) || hasRandom(baseParams.negative) || baseChars.some(ch => hasRandom(ch.prompt) || hasRandom(ch.uc));
  const batches = random ? p.nSamples : 1;

  const ctrl = new AbortController();
  controllers.set(sid, ctrl);
  if (opts.signal) { if (opts.signal.aborted) ctrl.abort(); else opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true }); }
  const what = opts.verb ?? (base?.mask ? '局部重绘' : base ? '图生图' : '生成');
  const jobId = opts.quiet ? '' : startJob({ nodeId: id, title: n.data.title, label: `${what} · ${MODELS[p.model].label} · ${sizeOf(p).join('×')}`, kind: 'generate', status: 'queued', started: undefined, cancel: () => cancel(sid), retry: () => run(id, opts) });
  let jobStarted = false;
  setRuntime(sid, { status: 'queued', error: undefined, preview: undefined, step: 0, steps: p.steps, sample: 0, n: p.nSamples, label: undefined });
  const [w, h] = sizeOf(p);
  let got = 0;
  const vibeIds: string[] = [];
  try {
    // 图片类输入在浏览器里处理好：底图缩放到生成尺寸，精确参考补边；风格参考只传编号，由服务端编码和缓存
    const extra: Pick<GenBody, 'image' | 'vibes' | 'refs' | 'upscaledEnhance' | 'mask' | 'size'> = { upscaledEnhance: opts.upscaledEnhance };
    const masked = base?.mask ? base as MaskedPic : null;
    let job: InpaintJob | null = null;
    const refs = m.preciseRef ? usableRefs(id, st.nodes, st.edges) : [];
    const vibes = m.vibe && !refs.length && !masked ? usableVibes(id, st.nodes, st.edges) : [];
    if (base || refs.length) setRuntime(sid, { label: '处理图片' });
    // 局部重绘：原图和遮罩按生成尺寸（聚焦时按聚焦区域）准备好，结果再贴回原图
    if (masked) {
      job = await prepareInpaint(masked, [w, h], applyLocks(p).transparent);
      Object.assign(extra, { image: job.image, mask: job.mask, size: masked.focus ? job.size : undefined });
    } else if (base) extra.image = await baseImage(base.url, w, h, applyLocks(p).transparent);
    if (refs.length) extra.refs = await Promise.all(refs.map(async r => ({ image: await directorImage(refPic(r.id, get().nodes, get().edges)!.url), type: r.data.type, strength: r.data.strength, fidelity: r.data.fidelity })));
    if (vibes.length) {
      for (const v of vibes) await syncVibe(v.id);
      extra.vibes = vibes.map(v => node(v.id)).filter(isVibe).filter(v => v.data.vibeId).map(v => ({ id: v.data.vibeId!, ie: v.data.ie, strength: v.data.strength }));
      vibeIds.push(...vibes.map(v => v.id));
    }
    if (ctrl.signal.aborted) throw new DOMException('aborted', 'AbortError');
    const pending: Promise<unknown>[] = [];
    for (let k = 0; k < batches && !ctrl.signal.aborted; k++) {
      const pr = random ? expandRandom(basePrompt) : basePrompt;
      const characters: CharacterInput[] = baseChars.map(ch => random ? { ...ch, prompt: expandRandom(ch.prompt), uc: expandRandom(ch.uc) } : ch)
        .map(ch => (job && masked?.focus ? { ...ch, ...remapCenter(ch.x, ch.y, job.region, masked.iw, masked.ih) } : ch));
      const params = random ? { ...baseParams, nSamples: 1, negative: expandRandom(baseParams.negative) } : baseParams;
      await generate({ prompt: pr, params, characters, aiPositions: p.charPos === 'ai', ...extra, kind: opts.kind ?? (masked ? 'inpaint' : base ? 'img2img' : undefined) }, ctrl.signal, e => {
        switch (e.event) {
          case 'queued': setRuntime(sid, { status: 'queued', label: undefined }); break;
          case 'encoding': setRuntime(sid, { status: 'running', label: `编码风格参考 ${e.data.index + 1}/${e.data.total}` }); break;
          case 'encoded': toast(`编码了 ${e.data.count} 个风格参考（每个 2 Anlas），之后同样的设置不用再编码`); break;
          case 'start': if (!jobStarted) { jobStarted = true; if (jobId) updateJob(jobId, { status: 'running', started: Date.now() }); }
            setRuntime(sid, { status: 'running', label: undefined, startedAt: k === 0 ? performance.now() : get().runtime[sid]?.startedAt, steps: e.data.steps, n: p.nSamples }); break;
          case 'progress': setRuntime(sid, { status: 'running', step: e.data.step + 1, sample: k + e.data.sample, ...(e.data.preview ? { preview: e.data.preview } : {}) }); break;
          case 'image': {
            got++;
            const raw = e.data.url, seed = e.data.seed;
            const add = (item: HistItem) => {
              if (opts.sink) { opts.sink(item); setRuntime(sid, { preview: undefined, flash: Date.now() }); return; }
              const cur = node(id);
              if (!isGen(cur)) return;
              updateData(id, { history: [item, ...cur.data.history].slice(0, 500), cur: 0 });
              setRuntime(sid, { preview: undefined, flash: Date.now() });
            };
            const item: HistItem = { url: raw, seed, w: extra.size?.[0] ?? w, h: extra.size?.[1] ?? h, model: MODELS[p.model].label, prompt: pr, at: Date.now(), kind: opts.kind ?? (masked ? 'inpaint' : base ? 'img2img' : undefined) };
            if (job && masked) {
              // 贴回原图后再进历史；贴回失败时保留原始结果
              const jb = job, mp = masked;
              pending.push(composite(raw, mp, jb, p.keepOriginal)
                .then(async blob => blob ? { ...item, url: await saveComposite(blob, raw, seed), raw, w: mp.iw, h: mp.ih } : item)
                .catch(err => { toast(`贴回原图失败，保留了原始结果：${(err as Error).message}`, { err: true }); return item; })
                .then(add));
            } else add(item);
            break;
          }
          case 'fail': throw new Error(e.data.message);
          case 'done': break;
        }
      });
    }
    await Promise.all(pending);
    // 两次请求之间点了取消：循环提前结束，按取消处理
    if (ctrl.signal.aborted) throw new DOMException('aborted', 'AbortError');
    setRuntime(sid, { status: 'idle', preview: undefined, label: undefined });
    if (jobId) finishJob(jobId, 'done', { count: got });
    if (got && !opts.quiet) toast(`「${n.data.title}」${opts.verb ?? (masked ? '重绘' : '生成')}了 ${got} 张${random ? '，每张的随机内容各不相同' : ''}，已存进 outputs 文件夹`);
    refreshAccount();
    refreshVibes(vibeIds);
    return { got };
  } catch (err) {
    refreshVibes(vibeIds);
    if (ctrl.signal.aborted) {
      if (jobId) finishJob(jobId, 'canceled', { count: got || undefined });
      setRuntime(sid, { status: 'idle', preview: undefined, label: undefined });
      if (!opts.quiet) toast(got ? `已取消，已经生成的 ${got} 张保留了` : '已取消');
      refreshAccount();
      return { got, canceled: true };
    } else {
      const msg = (err as Error).message || '生成失败';
      setRuntime(sid, { status: 'error', error: msg, preview: undefined, label: undefined });
      if (jobId) finishJob(jobId, 'failed', { error: msg, count: got || undefined });
      if (!opts.quiet) toast(msg, { err: true });
      refreshAccount();
      return { got, error: msg };
    }
  } finally {
    controllers.delete(sid);
  }
}

/** 运行选中的可运行节点 */
/** 运行一个节点：生图节点生成，工具节点处理图片 */
export function runNode(id: string): Promise<unknown> | void {
  const n = node(id);
  if (isGen(n)) return run(id);
  if (n) return hooks[n.type]?.(id);
}
const hooks: Record<string, (id: string) => Promise<unknown> | void> = {};
/** 工具、网格节点在各自的模块里登记怎么运行 */
export function setRunHook(kind: string, fn: (id: string) => Promise<unknown> | void) { hooks[kind] = fn; }

export function runSelected() {
  const list = get().nodes.filter(n => n.selected && KINDS[n.type].run);
  if (!list.length) { toast('先选中要运行的生图或工具节点', { err: true }); return; }
  for (const n of list) runNode(n.id);
  if (list.length > 1) toast(`已排队运行 ${list.length} 个节点，会一个一个生成`);
}
