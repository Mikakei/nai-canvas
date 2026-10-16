// 运行图片工具节点：Director Tools 走服务端；放大用放大接口；像素整理在浏览器里算
import { expandMacros, pixelSnap, toolCost, toolName, toolSize } from '@nai/shared';
import { api } from './api.ts';
import { chunkMap } from './chunks.ts';
import { baseImage } from './images.ts';
import { inputsOf, isTool, picOf, type Pic, type ToolData, type ToolItem } from './graph.ts';
import { node, refreshAccount, toast, updateData, useStore } from './store.ts';
import { setRuntime, setRunHook } from './run.ts';
import { finishJob, startJob } from './jobs.ts';
import { pushAway } from './layout.ts';

const H = { 'x-nai-canvas': '1' };
const busy = new Set<string>();

/** 工具节点接进来的图 */
export function toolInput(id: string): Pic | null {
  const st = useStore.getState();
  return picOf(inputsOf(id, 'src', st.nodes, st.edges)[0]);
}

/** 像素整理：读出像素 → 找网格、取格子颜色、整理调色板 → 可选按原倍率放大 → 存进 outputs */
async function snapLocal(pic: Pic, d: ToolData): Promise<ToolItem> {
  const bmp = await createImageBitmap(await (await fetch(pic.url)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  let w = bmp.width, h = bmp.height;
  // 太大的图先缩一下（最近邻，不破坏像素块）
  const MAX = 4194304;
  if (w * h > MAX) { const s = Math.sqrt(MAX / (w * h)); w = Math.floor(w * s); h = Math.floor(h * s); }
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingEnabled = false; g.drawImage(bmp, 0, 0, w, h); bmp.close();
  // 让"处理中"先显示出来，再做计算
  await new Promise(r => setTimeout(r, 30));
  const r = pixelSnap(g.getImageData(0, 0, w, h).data, w, h, { palette: d.snapPalette, colors: d.snapColors, avoidOverRefining: d.snapAvoid });
  const small = document.createElement('canvas'); small.width = r.Wc; small.height = r.Hc;
  small.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(r.data), r.Wc, r.Hc), 0, 0);
  let out = small;
  if (d.snapUpscale) {
    const k = Math.max(1, Math.round((pic.iw / r.Wc + pic.ih / r.Hc) / 2));
    out = document.createElement('canvas'); out.width = r.Wc * k; out.height = r.Hc * k;
    const og = out.getContext('2d')!; og.imageSmoothingEnabled = false; og.drawImage(small, 0, 0, out.width, out.height);
  }
  const blob = await new Promise<Blob>((ok, bad) => out.toBlob(b => (b ? ok(b) : bad(new Error('图片编码失败'))), 'image/png'));
  const res = await fetch('/api/compose?tag=pixelsnap', { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: blob });
  const j = await res.json() as { url?: string; error?: string };
  if (!res.ok || !j.url) throw new Error(j.error || '保存失败');
  const pitch = (r.pitch[0] + r.pitch[1]) / 2;
  return { urls: [j.url], sel: 0, w: out.width, h: out.height, tool: 'pixel-snap', at: Date.now(), note: `${r.Wc}×${r.Hc} 格 · 像素约 ${pitch.toFixed(1)}px · ${r.paletteSize} 色` };
}

export async function runTool(id: string) {
  const n = node(id);
  if (!isTool(n) || busy.has(id)) return;
  const st = useStore.getState(), d = n.data, tool = d.tool;
  const pic = toolInput(id);
  if (!pic) { setRuntime(id, { status: 'error', error: '先接一张图进来' }); toast(`「${d.title}」还没有图：从图片或生图节点拉一根线过来`, { err: true }); return; }
  if (tool !== 'pixel-snap' && !st.config?.mock && !st.config?.hasToken) { toast('还没有填 Token，先在设置里填好', { err: true }); useStore.setState({ dialog: 'settings' }); return; }
  const c = toolCost(tool, pic.iw, pic.ih, st.account);
  if (!c) { toast(`这张图 ${pic.iw}×${pic.ih} 太大了，最大 1536×2048`, { err: true }); return; }
  if (st.account && c.price > st.account.anlas) { toast(`Anlas 不够：这次要 ${c.price}，余额只有 ${st.account.anlas}`, { err: true }); return; }

  busy.add(id);
  const job = startJob({ nodeId: id, title: d.title, label: toolName(tool), kind: 'tool', retry: () => runTool(id) });
  setRuntime(id, { status: 'running', label: `${toolName(tool)} · 处理中`, error: undefined, startedAt: performance.now() });
  try {
    let item: ToolItem;
    if (tool === 'pixel-snap') item = await snapLocal(pic, d);
    else if (tool === 'upscale') {
      const r = await api.upscale(pic.url, pic.iw, pic.ih);
      item = { urls: [r.url], sel: 0, w: r.w, h: r.h, tool, at: Date.now() };
    } else {
      const [w, h] = toolSize(pic.iw, pic.ih);
      const image = await baseImage(pic.url, w, h, true);
      const prompt = expandMacros(d.prompt.trim(), chunkMap());
      const r = await api.tool({ tool, image, width: w, height: h, prompt, defry: d.defry, emotion: d.emotion, keepBubbles: d.keepBubbles });
      item = { urls: r.urls, sel: 0, w: r.w, h: r.h, tool, at: Date.now() };
    }
    const cur = node(id);
    if (isTool(cur)) updateData(id, { history: [item, ...cur.data.history].slice(0, 200), cur: 0 });
    setRuntime(id, { status: 'idle', label: undefined, flash: Date.now() });
    requestAnimationFrame(() => requestAnimationFrame(() => pushAway(id)));
    finishJob(job, 'done', { count: item.urls.length });
    toast(`「${d.title}」${toolName(tool)}完成${item.urls.length > 1 ? '，可以在三种结果之间切换' : ''}${item.note ? `：${item.note}` : ''}`);
    if (tool !== 'pixel-snap') refreshAccount();
  } catch (e) {
    const msg = (e as Error).message || '处理失败';
    setRuntime(id, { status: 'error', error: msg, label: undefined });
    finishJob(job, 'failed', { error: msg });
    toast(msg, { err: true });
  } finally {
    busy.delete(id);
  }
}

setRunHook('tool', runTool);
