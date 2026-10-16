// 网格对比：按 X/Y 两个轴依次生成每一格，结果写进网格节点；可以把某一格的参数用回生图节点、导出整张网格
import { GRID_MAX, cellChange, cost, gridParamName, normalizeParams, parseAxis, randomSeed, type AxisValue } from '@nai/shared';
import { inputsOf, isGen, isGrid, promptFor, type GridCell, type GridNode } from './graph.ts';
import { extrasFor } from './inputs.ts';
import { batch, node, refreshAccount, toast, updateData, useStore } from './store.ts';
import { run, setRunHook, setRuntime } from './run.ts';
import { finishJob, startJob, updateJob } from './jobs.ts';
import { pushAway } from './layout.ts';

/** 节点变大后，等它渲染完再把压到的邻居推开 */
const makeRoom = (id: string) => requestAnimationFrame(() => requestAnimationFrame(() => pushAway(id)));

const H = { 'x-nai-canvas': '1' };
const ctrls = new Map<string, AbortController>();
export const gridBusy = (id: string) => ctrls.has(id);

/** 网格接着的生图节点 */
export function gridSource(id: string) {
  const st = useStore.getState();
  const g = inputsOf(id, 'setup', st.nodes, st.edges)[0];
  return isGen(g) ? g : null;
}

/** 解析两个轴，得到格子和预计花费 */
export function gridPlan(id: string) {
  const st = useStore.getState(), n = st.nodes.find(m => m.id === id);
  if (!isGrid(n)) return null;
  const src = gridSource(id);
  const prompt = src ? promptFor(src.id, st.nodes, st.edges) : '';
  const x = parseAxis(n.data.x.param, n.data.x.values, prompt), y = parseAxis(n.data.y.param, n.data.y.values, prompt);
  const error = !src ? '从一个生图节点拉线过来' : n.data.x.param === 'none' ? 'X 轴还没选参数' : x.error ?? y.error;
  let total = 0;
  if (src && !error) {
    const ex = extrasFor(src.id, st.nodes, st.edges);
    for (const xv of x.values) for (const yv of y.values) total += cost(normalizeParams({ ...src.data.params, ...cellChange(xv, yv).params, nSamples: 1 }), st.account, ex).total;
  }
  const count = x.values.length * y.values.length;
  return { src, x: x.values, y: y.values, error: error ?? (count > GRID_MAX ? `一共 ${count} 格，最多 ${GRID_MAX} 格` : undefined), count, total };
}

/** 依次生成每一格；再点一次是取消 */
export async function runGrid(id: string) {
  if (ctrls.has(id)) { ctrls.get(id)!.abort(); return; }
  const n = node(id), plan = gridPlan(id);
  if (!isGrid(n) || !plan) return;
  if (plan.error || !plan.src) { toast(plan.error ?? '网格设置有问题', { err: true }); return; }
  const st = useStore.getState();
  if (st.account && plan.total > st.account.anlas) { toast(`Anlas 不够：整张网格约要 ${plan.total}，余额只有 ${st.account.anlas}`, { err: true }); return; }
  const src = plan.src, srcParams = src.data.params;
  // 所有格子用同一个种子，比较才公平（种子轴除外）
  const seed = srcParams.seedLocked ? srcParams.seed : randomSeed();
  const cells: GridCell[] = [];
  plan.y.forEach((_, yi) => plan.x.forEach((__, xi) => cells.push({ x: xi, y: yi })));
  updateData(id, { cells, xs: plan.x.map(v => v.label), ys: plan.y.map(v => v.label), seed, at: Date.now(), srcTitle: src.data.title, axisNames: [gridParamName(n.data.x.param), gridParamName(n.data.y.param)] });
  makeRoom(id);
  const ctrl = new AbortController();
  ctrls.set(id, ctrl);
  const jobId = startJob({ nodeId: id, title: n.data.title, label: `网格 0/${cells.length} · 来自「${src.data.title}」`, kind: 'grid', cancel: () => ctrl.abort(), retry: () => runGrid(id) });
  let done = 0, fail = 0;
  try {
    for (const [k, cell] of cells.entries()) {
      if (ctrl.signal.aborted) break;
      updateJob(jobId, { label: `网格 ${k + 1}/${cells.length} · 来自「${src.data.title}」` });
      const change = cellChange(plan.x[cell.x] as AxisValue, plan.y[cell.y] as AxisValue);
      let got: GridCell | null = null;
      const r = await run(src.id, {
        params: { seed, seedLocked: true, ...change.params, nSamples: 1 },
        prompt: change.prompt,
        sink: item => { got = { ...cell, url: item.url, seed: item.seed, w: item.w, h: item.h }; },
        statusId: id, quiet: true, signal: ctrl.signal,
      });
      const cur = node(id);
      if (!isGrid(cur)) break;
      const value: GridCell = got ?? { ...cell, error: r.error ?? (r.canceled ? '已取消' : '没有生成') };
      if (got) done++; else if (!r.canceled) fail++;
      updateData(id, { cells: cur.data.cells.map(c => (c.x === cell.x && c.y === cell.y ? value : c)) });
      if (r.canceled) break;
    }
  } finally {
    ctrls.delete(id);
    setRuntime(id, { status: 'idle', label: undefined, flash: Date.now() });
    makeRoom(id);
    finishJob(jobId, ctrl.signal.aborted ? 'canceled' : fail && !done ? 'failed' : 'done', { count: done, error: fail ? `${fail} 格没有生成成功` : undefined });
    refreshAccount();
  }
  toast(ctrl.signal.aborted ? `网格已取消，完成了 ${done} 格` : fail ? `网格完成 ${done} 格，${fail} 格失败` : `网格完成：${done} 格`, { err: fail > 0 && !done });
}

/** 把某一格的参数用回生图节点 */
export function applyCell(id: string, cell: GridCell) {
  const n = node(id), plan = gridPlan(id);
  if (!isGrid(n) || !plan?.src) return;
  const change = cellChange(plan.x[cell.x] ?? { label: '' }, plan.y[cell.y] ?? { label: '' });
  const src = plan.src, st = useStore.getState();
  batch(() => {
    // 提示词替换改到原词实际所在的地方：接进来的提示词节点
    for (const pn of inputsOf(src.id, 'prompt', st.nodes, st.edges)) {
      const t = String(pn.data.text ?? ''), u = change.prompt(t);
      if (u !== t) updateData(pn.id, { text: u });
    }
    updateData(src.id, { params: { ...src.data.params, ...change.params, ...(cell.seed !== undefined ? { seed: cell.seed, seedLocked: true } : {}) } });
  });
  toast(`已把这一格的参数用到「${src.data.title}」（种子 ${cell.seed} 已锁定）`);
}

/** 导出整张网格：带行列标题合成一张 PNG，存进 outputs */
export async function exportGrid(id: string): Promise<{ url: string; w: number; h: number } | null> {
  const n = node(id);
  if (!isGrid(n)) return null;
  const d = (n as GridNode).data, cells = d.cells.filter(c => c.url);
  if (!cells.length) { toast('网格里还没有图', { err: true }); return null; }
  const cw = Math.max(...cells.map(c => c.w ?? 512)), ch = Math.max(...cells.map(c => c.h ?? 768));
  const s = Math.min(1, 512 / cw), W = Math.round(cw * s), Hh = Math.round(ch * s);
  const cols = d.xs.length, rows = d.ys.length, top = 56, left = rows > 1 || d.ys[0] ? 180 : 0, gap = 8;
  const c = document.createElement('canvas');
  c.width = left + cols * (W + gap) + gap; c.height = top + rows * (Hh + gap) + gap;
  const g = c.getContext('2d')!;
  g.fillStyle = '#f4f4f1'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#111'; g.font = '600 22px "Microsoft YaHei", sans-serif'; g.textBaseline = 'middle'; g.textAlign = 'center';
  d.xs.forEach((l, i) => g.fillText(l, left + gap + i * (W + gap) + W / 2, top / 2, W - 8));
  g.textAlign = 'right';
  d.ys.forEach((l, i) => l && g.fillText(l, left - 12, top + gap + i * (Hh + gap) + Hh / 2, left - 20));
  try {
    // 某一格的图读不出来（比如文件被删了）就留空，不让整张导出失败
    let missing = 0;
    await Promise.all(cells.map(async cell => {
      try {
        const r = await fetch(cell.url!);
        if (!r.ok) throw new Error(String(r.status));
        const b = await createImageBitmap(await r.blob());
        g.drawImage(b, left + gap + cell.x * (W + gap), top + gap + cell.y * (Hh + gap), W, Hh); b.close();
      } catch { missing++; }
    }));
    if (missing === cells.length) { toast('网格里的图都读不出来了（可能已经删掉）', { err: true }); return null; }
    if (missing) toast(`有 ${missing} 格的图读不出来，导出时留空了`, { err: true });
    const blob = await new Promise<Blob>((ok, bad) => c.toBlob(b => (b ? ok(b) : bad(new Error('图片编码失败'))), 'image/png'));
    const res = await fetch('/api/compose?tag=grid', { method: 'POST', headers: { ...H, 'Content-Type': 'application/octet-stream' }, body: blob });
    const j = await res.json().catch(() => ({})) as { url?: string; error?: string };
    if (!res.ok || !j.url) { toast(j.error || '保存失败', { err: true }); return null; }
    return { url: j.url, w: c.width, h: c.height };
  } catch (e) { toast(`导出失败：${(e as Error).message}`, { err: true }); return null; }
}

setRunHook('grid', runGrid);
