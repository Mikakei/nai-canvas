// 分区：框住一组节点。成员按位置算（节点卡片的中心在框里就算），不用父子关系，节点随时可以拖进拖出
import { KINDS, isSection, reaches, type AppNode, type SectionNode } from './graph.ts';
import { batch, createNode, node, setSelection, toast, useStore } from './store.ts';
import { runNode, setRuntime } from './run.ts';

const sizeOf = (n: AppNode) => ({ w: n.measured?.width ?? (n.data.w as number | undefined) ?? KINDS[n.type].w, h: n.measured?.height ?? 200 });

/** 分区里的节点（不含其他分区） */
export function membersOf(id: string, nodes: AppNode[]): AppNode[] {
  const s = nodes.find(n => n.id === id);
  if (!isSection(s)) return [];
  const { x, y } = s.position, { w, h } = s.data;
  return nodes.filter(n => {
    if (n.id === id || isSection(n)) return false;
    const z = sizeOf(n), cx = n.position.x + z.w / 2, cy = n.position.y + z.h / 2;
    return cx >= x && cx <= x + w && cy >= y && cy <= y + h;
  });
}

/** 把选中的节点框成一个分区（Ctrl+G） */
export function wrapSelection() {
  const sel = useStore.getState().nodes.filter(n => n.selected && !isSection(n));
  if (!sel.length) { toast('先选中要框进分区的节点'); return; }
  const PAD = 36, HEAD = 56;
  const x0 = Math.min(...sel.map(n => n.position.x)) - PAD;
  const y0 = Math.min(...sel.map(n => n.position.y)) - PAD - HEAD;
  const x1 = Math.max(...sel.map(n => n.position.x + sizeOf(n).w)) + PAD;
  const y1 = Math.max(...sel.map(n => n.position.y + sizeOf(n).h)) + PAD;
  const s = batch(() => createNode('section', Math.round(x0), Math.round(y0), { w: Math.round(x1 - x0), h: Math.round(y1 - y0) }));
  setSelection([s.id]);
  toast(`已把 ${sel.length} 个节点框成「${s.data.title}」：拖标题整体移动，点"运行"依次运行里面的节点`);
}

const running = new Set<string>();

/**
 * 依次运行分区里的生图和工具节点。上游先跑：A 的结果接到 B（直接或经过参考节点），A 就排在前面；
 * 其余按从上到下、从左到右
 */
export async function runSection(id: string) {
  const st = useStore.getState(), s = node(id);
  if (!isSection(s)) return;
  if (running.has(id)) { toast('这个分区正在运行'); return; }
  const list = membersOf(id, st.nodes).filter(n => KINDS[n.type].run);
  if (!list.length) { toast(`「${s.data.title}」里没有可以运行的生图或工具节点`, { err: true }); return; }
  const left = [...list].sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x), order: AppNode[] = [];
  while (left.length) {
    const i = left.findIndex(n => !left.some(m => m !== n && reaches(st.edges, m.id, n.id)));
    order.push(...left.splice(i < 0 ? 0 : i, 1));
  }
  running.add(id);
  toast(`「${s.data.title}」：依次运行 ${order.length} 个节点`);
  let fail = 0;
  try {
    for (const [k, n] of order.entries()) {
      if (!node(n.id)) continue;
      setRuntime(id, { status: 'running', label: `运行中 ${k + 1}/${order.length}` });
      await runNode(n.id);
      if (useStore.getState().runtime[n.id]?.status === 'error') fail++;
    }
  } finally {
    running.delete(id);
    setRuntime(id, { status: 'idle', label: undefined });
  }
  toast(fail ? `「${s.data.title}」运行完了，其中 ${fail} 个失败，在队列面板里能看到原因` : `「${s.data.title}」里的 ${order.length} 个节点都运行完了`, { err: fail > 0 });
}

export type { SectionNode };
