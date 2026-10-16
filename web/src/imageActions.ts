// 对一张图做的事：变体、增强、放大、读取生成信息并还原成节点、导出风格参考
import {
  ENHANCE_LEVELS, MODELS, VARIATION, cleanBrackets, defaultParams, enhancePrompt, enhanceSize, maxSamples, normalizeParams, sizeParams, upscaleCost,
  type EnhanceScale, type GenParams, type ImportedMeta,
} from '@nai/shared';
import { api } from './api.ts';
import { downloadText, metaOfUrl } from './images.ts';
import { KINDS, isGen, isImage, isVibe, picOf, type GenNode, type HistItem, type Pic } from './graph.ts';
import { placeImageBeside } from './actions.ts';
import { settle } from './layout.ts';
import { batch, connect, createNode, node, refreshAccount, setSelection, toast, updateData, useStore } from './store.ts';
import { run, setRuntime } from './run.ts';
import { finishJob, startJob } from './jobs.ts';

const get = useStore.getState;

/** 生图节点当前显示的那张图 */
export function currentPic(id: string): (Pic & { item: HistItem }) | null {
  const n = node(id);
  if (!isGen(n)) return null;
  const item = n.data.history[n.data.cur];
  return item ? { url: item.url, iw: item.w, ih: item.h, seed: item.seed, prompt: item.prompt, item } : null;
}

/** 变体：以当前这张图为底图，强度 0.8、噪声 0.1，按原图尺寸出最多 3 张（官网同款） */
export function variations(id: string) {
  const pic = currentPic(id); if (!pic) return;
  const n = Math.min(VARIATION.maxSamples, maxSamples(pic.iw, pic.ih));
  run(id, { base: pic, kind: 'variation', verb: '生成变体', params: { ...sizeParams(pic.iw, pic.ih), strength: VARIATION.strength, addNoise: VARIATION.noise, nSamples: n, seedLocked: false } });
}

/** 增强：放大一点再用较低的强度重画一遍，补细节；V5 的 Max 保持尺寸、由服务端放大 */
export function enhance(id: string, magnitude: number, scale: EnhanceScale, override?: { strength: number; noise: number }) {
  const pic = currentPic(id), g = node(id);
  if (!pic || !isGen(g)) return;
  const lv = override ?? ENHANCE_LEVELS[magnitude];
  const [w, h] = enhanceSize(pic.iw, pic.ih, scale);
  run(id, {
    base: pic, kind: 'enhance', verb: '增强', upscaledEnhance: scale === 'max',
    params: { ...sizeParams(w, h), strength: lv.strength, addNoise: lv.noise, nSamples: 1, seedLocked: false },
    prompt: p => enhancePrompt(p, g.data.params.model, scale),
  });
}

/** 打开画布编辑器；mode 选绘画或遮罩（局部重绘）；run 为保存后要运行的生图节点 */
export function openEditor(id: string, runAfter?: string, mode: 'paint' | 'mask' = 'mask') {
  const n = node(id);
  if (!isImage(n) || !n.data.url) { toast('先给这个图片节点放一张图', { err: true }); return; }
  useStore.setState({ modal: { kind: 'editor', id, run: runAfter, mode } });
}

/** 在空的图片节点上新建一张白色画布来画 */
export function paintBlank(id: string, w: number, h: number) {
  if (!isImage(node(id))) return;
  useStore.setState({ modal: { kind: 'editor', id, mode: 'paint', blank: [w, h] } });
}

/** 结果图上"涂改"：把当前这张图做成图片节点、接为底图，打开绘画模式；画完保存并生成就是图生图 */
export function paintResult(id: string) {
  const made = resultToBase(id);
  if (made) openEditor(made, id, 'paint');
}

function resultToBase(id: string, title = '涂改底图'): string | null {
  const pic = currentPic(id), g = node(id);
  if (!pic || !isGen(g)) return null;
  const w = KINDS.image.w;
  const made = batch(() => {
    const m = createNode('image', Math.round(g.position.x - w - 80), Math.round(g.position.y), { url: pic.url, iw: pic.iw, ih: pic.ih, seed: pic.seed, prompt: pic.prompt, title: `${title} ${g.data.title.split(' ').pop()}` });
    connect(m.id, id, true);
    return m;
  });
  settle(made.id);
  return made.id;
}

/**
 * 在结果图上点"局部重绘"：把当前这张图做成图片节点，接为这个生图节点的底图，打开编辑器。
 * 画完保存就直接重绘，结果进同一个生图节点的历史
 */
export function inpaintResult(id: string) {
  const made = resultToBase(id, '重绘底图');
  if (made) openEditor(made, id, 'mask');
}

/** 放大 2 倍：结果作为新的图片节点放在旁边 */
export async function upscaleImage(id: string, pic: Pic) {
  const price = upscaleCost(pic.iw, pic.ih);
  if (price === null) { toast(`这张图 ${pic.iw}×${pic.ih} 太大了，放大只支持 314 万像素以内的图`, { err: true }); return; }
  const acc = get().account;
  if (acc && price > acc.anlas) { toast(`Anlas 不够：放大要 ${price}，余额 ${acc.anlas}`, { err: true }); return; }
  if (get().runtime[id]?.label) return;
  setRuntime(id, { label: `放大中 · ${price} ANLAS` });
  const job = startJob({ nodeId: id, title: String(node(id)?.data.title ?? ''), label: `放大 2× · ${pic.iw}×${pic.ih}`, kind: 'upscale', retry: () => upscaleImage(id, pic) });
  try {
    const r = await api.upscale(pic.url, pic.iw, pic.ih);
    placeImageBeside(id, { url: r.url, iw: r.w, ih: r.h, seed: pic.seed, prompt: pic.prompt }, `已放大到 ${r.w}×${r.h}，用了 ${r.cost} Anlas`);
    finishJob(job, 'done', { count: 1 });
    refreshAccount();
  } catch (e) {
    finishJob(job, 'failed', { error: (e as Error).message });
    toast((e as Error).message, { err: true });
  } finally {
    setRuntime(id, { label: undefined });
  }
}

/** 右键"读取生成信息"：重新读一次图里的元数据，打开导入窗口 */
export async function importMetaOf(id: string) {
  const n = node(id), pic = picOf(n);
  if (!pic) return;
  const meta = await metaOfUrl(pic.url);
  if (!meta) { toast('这张图里没有 NovelAI 的生成信息（可能被聊天软件或修图软件去掉了）', { err: true }); return; }
  useStore.setState({ modal: { kind: 'import', nodeId: id, meta } });
}

export interface ImportPick { prompt: boolean; negative: boolean; settings: boolean; seed: boolean; characters: boolean; vibes: boolean; clean: boolean }

/** 按勾选的项目把生成信息写进参数 */
function pickParams(base: GenParams, meta: ImportedMeta, pick: ImportPick): GenParams {
  let p: GenParams = { ...base };
  if (pick.settings) {
    const { negative: _n, ucPreset: _u, ...rest } = meta.params;
    p = { ...p, ...rest };
  }
  if (pick.negative) p = { ...p, negative: pick.clean ? cleanBrackets(meta.params.negative ?? '') : meta.params.negative ?? '', ucPreset: meta.params.ucPreset ?? p.ucPreset };
  if (pick.seed && meta.seed !== undefined) p = { ...p, seed: meta.seed, seedLocked: true };
  return normalizeParams(p);
}

/**
 * 把生成信息还原成节点：into 为已有生图节点时只改它，否则在图片右边新建一个生图节点。
 * 提示词、角色和风格参考会新建节点接上（提示词节点排在已经接着的提示词后面）
 */
export async function applyImport(imageId: string, meta: ImportedMeta, pick: ImportPick, into?: string) {
  const img = node(imageId), pic = picOf(img);
  const target = into ? node(into) : undefined;
  const text = pick.clean ? cleanBrackets(meta.prompt) : meta.prompt;
  // 风格参考的编码要先在服务端登记
  const vibeRegs = pick.vibes && meta.vibes.length && MODELS[(meta.params.model ?? 'v45-full')].vibe
    ? await Promise.all(meta.vibes.map(v => api.vibeFromEncoding(v.encoding, meta.params.model ?? 'v45-full').then(s => ({ v, s })).catch(() => null)))
    : [];
  const made: string[] = [];
  const gid = batch(() => {
    let g = target && isGen(target) ? target : null;
    if (g) {
      updateData(g.id, { params: pickParams(g.data.params, meta, pick) });
    } else {
      const ref = img ?? null, w = ref?.measured?.width ?? KINDS.image.w;
      const x = ref ? ref.position.x + w + 80 : 0, y = ref ? ref.position.y : 0;
      const history: HistItem[] = pic ? [{ url: pic.url, seed: meta.seed ?? 0, w: pic.iw, h: pic.ih, model: MODELS[meta.params.model ?? 'v45-full'].label, prompt: meta.prompt, at: Date.now() }] : [];
      g = createNode('generate', Math.round(x), Math.round(y), { params: pickParams(defaultParams(meta.params.model ?? 'v45-full'), meta, pick), history, cur: 0 }) as GenNode;
      made.push(g!.id);
    }
    const gen = node(g!.id)!;
    const withPrompt = pick.prompt && !!text.trim();
    if (withPrompt) {
      const pn = createNode('prompt', Math.round(gen.position.x - KINDS.prompt.w - 80), Math.round(gen.position.y), { text });
      connect(pn.id, gen.id, true); made.push(pn.id);
    }
    const top = gen.position.y + (withPrompt ? 240 : 0);
    if (pick.characters) meta.characters.forEach((c, i) => {
      const ch = createNode('character', Math.round(gen.position.x - KINDS.character.w - 80), Math.round(top + i * 260), {
        text: pick.clean ? cleanBrackets(c.prompt) : c.prompt, uc: c.uc, x: c.x, y: c.y, enabled: true, showUc: !!c.uc,
      });
      connect(ch.id, gen.id, true); made.push(ch.id);
    });
    vibeRegs.forEach((r, i) => {
      if (!r) return;
      const v = createNode('vibe', Math.round(gen.position.x - KINDS.vibe.w - 80), Math.round(gen.position.y - 280 - i * 40), {
        vibeId: r.s.id, enc: r.s.encodings, encodingOnly: true, strength: r.v.strength, ie: r.v.ie,
      });
      connect(v.id, gen.id, true); made.push(v.id);
    });
    return gen.id;
  });
  setSelection(made.length ? made : [gid]);
  made.forEach(id => settle(id));
  const parts = [pick.prompt && '提示词', pick.negative && '负面提示词', pick.settings && '设置', pick.seed && meta.seed !== undefined && '种子', pick.characters && meta.characters.length && `${meta.characters.length} 个角色`, vibeRegs.filter(Boolean).length && `${vibeRegs.filter(Boolean).length} 个风格参考`].filter(Boolean);
  toast(`${target ? `已导入到「${target.data.title}」` : '已还原成节点'}：${parts.join('、') || '没有选择任何项目'}`);
}

/** 导出风格参考：一个是 .naiv4vibe，多个打包成 .naiv4vibebundle */
export async function exportVibes(ids: string[], encodingOnly = false) {
  const st = get();
  const list = ids.map(node).filter(isVibe).filter(v => v.data.vibeId);
  if (!list.length) { toast('这个风格参考还没有图', { err: true }); return; }
  const modelOf = (vid: string) => {
    const g = st.edges.filter(e => e.source === vid).map(e => node(e.target)).find(isGen);
    return g && MODELS[g.data.params.model].vibe ? g.data.params.model : 'v45-full';
  };
  try {
    const data = await api.vibeExport(list.map(v => ({ id: v.data.vibeId!, ie: v.data.ie, strength: v.data.strength, model: modelOf(v.id) })), encodingOnly);
    const day = new Date().toISOString().slice(0, 10);
    const name = list.length === 1 ? `${list[0].data.title.replace(/[\\/:*?"<>|]/g, '_')}.naiv4vibe` : `${day}.naiv4vibebundle`;
    downloadText(JSON.stringify(data, null, 2), name);
    toast(`已导出 ${name}，可以拖回本工具或官网使用`);
  } catch (e) { toast((e as Error).message, { err: true }); }
}
