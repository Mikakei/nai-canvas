// 拖入、粘贴、选择的文件：图片变成图片节点（或填进拖到的节点里），风格参考文件变成风格参考节点
import { isArtist, isCharDict, isGen, isImage, isRef, isVibe, KINDS, type Pic } from './graph.ts';
import { setArtistCover, setCharCover } from './presets.ts';
import { api } from './api.ts';
import { isImageFile, isVibeFile, uploadImage, type Uploaded } from './images.ts';
import { syncVibe } from './inputs.ts';
import { settle } from './layout.ts';
import { batch, connect, createNode, flow, node, setSelection, toast, updateData, useStore } from './store.ts';

/** 读一张已在服务端的图的尺寸 */
async function sizeOfUrl(url: string): Promise<[number, number]> {
  const b = await createImageBitmap(await (await fetch(url)).blob());
  const s: [number, number] = [b.width, b.height];
  b.close();
  return s;
}

/** 把上传好的图填进一个已有节点 */
function fillNode(id: string, up: Uploaded) {
  const n = node(id); if (!n) return;
  updateData(id, { url: up.url, iw: up.iw, ih: up.ih, ...(isImage(n) ? { name: up.name, seed: undefined, prompt: undefined, mask: undefined, focus: undefined, layers: undefined } : {}) } as never, true);
  if (isVibe(n)) syncVibe(id);
}

/**
 * 处理一批文件。at 是屏幕坐标；onto 是拖到的节点（图片、风格参考、精确参考节点会直接换图）
 */
export async function handleFiles(files: File[], at?: [number, number], onto?: string | null) {
  const imgs = files.filter(isImageFile), vibes = files.filter(isVibeFile);
  if (!imgs.length && !vibes.length) { toast('只能拖入图片，或者 .naiv4vibe / .naiv4vibebundle 风格参考文件', { err: true }); return; }
  const rf = flow.rf; if (!rf) return;
  const el = document.querySelector('.canvas')?.getBoundingClientRect();
  const [sx, sy] = at ?? [el ? el.left + el.width / 2 : innerWidth / 2, el ? el.top + el.height / 2 : innerHeight / 2];
  const p = rf.screenToFlowPosition({ x: sx, y: sy });
  let x = p.x, made: string[] = [];
  const target = onto ? node(onto) : undefined;

  // 拖到画师串节点上：当封面
  if (target && isArtist(target) && imgs.length) { await setArtistCover(target.id, imgs[0]); return; }
  // 拖到角色字典上：给选中的角色当封面
  if (target && isCharDict(target) && imgs.length) {
    if (target.data.sel) await setCharCover(target.data.sel, imgs[0]); else toast('先在角色字典里点一个角色，再把图拖上去当封面', { err: true });
    return;
  }
  for (const f of imgs) {
    let up: Uploaded;
    try { up = await uploadImage(f); } catch (e) { toast(`「${f.name}」${(e as Error).message}`, { err: true }); continue; }
    if (target && (isImage(target) || isVibe(target) || isRef(target)) && imgs.length === 1) {
      fillNode(target.id, up);
      toast(`已换成「${up.name}」`);
      if (up.meta && isImage(target)) useStore.setState({ modal: { kind: 'import', nodeId: target.id, meta: up.meta } });
      return;
    }
    const w = KINDS.image.w, h = w * up.ih / up.iw;
    const n = createNode('image', Math.round(x - w / 2), Math.round(p.y - h / 2), { url: up.url, iw: up.iw, ih: up.ih, name: up.name, title: undefined });
    made.push(n.id); x += w + 40;
    if (up.meta && imgs.length === 1) useStore.setState({ modal: { kind: 'import', nodeId: n.id, meta: up.meta } });
    else if (up.meta) toast(`「${up.name}」带有 NovelAI 生成信息：右键图片节点可以导入`);
  }

  for (const f of vibes) {
    let r: Awaited<ReturnType<typeof api.vibeImport>>;
    try { r = await api.vibeImport(await f.text()); } catch (e) { toast(`「${f.name}」${(e as Error).message}`, { err: true }); continue; }
    if (r.bad) toast(`「${f.name}」里有 ${r.bad} 个风格参考校验不通过，已跳过`, { err: true });
    const list = await Promise.all(r.items.map(async it => ({ it, size: it.url ? await sizeOfUrl(it.url).catch(() => [1, 1] as [number, number]) : [1, 1] as [number, number] })));
    batch(() => {
      for (const { it, size } of list) {
        const w = KINDS.vibe.w;
        const n = createNode('vibe', Math.round(x - w / 2), Math.round(p.y - 120), {
          url: it.url ?? '', iw: size[0], ih: size[1], vibeId: it.id, vibeFor: it.url, enc: it.encodings, encodingOnly: it.type === 'encoding',
          strength: it.importInfo?.strength ?? 0.6, ie: it.importInfo?.information_extracted ?? 1, title: it.name && !/^[\da-f]{6}-[\da-f]{6}$/.test(it.name) ? it.name : undefined,
        });
        made.push(n.id); x += w + 40;
      }
    });
    if (r.items.length) toast(`导入了 ${r.items.length} 个风格参考${r.items.some(i => i.type === 'encoding') ? '（有的只有编码，只能用在导出时的模型上）' : ''}`);
  }
  if (made.length) {
    setSelection(made);
    made.forEach(id => settle(id));
  }
}

/** 节点的拖放区：判断文件拖到了哪个节点上 */
export function dropTarget(el: Element | null): string | null {
  const id = el?.closest('.react-flow__node')?.getAttribute('data-id') ?? null;
  const n = id ? node(id) : undefined;
  return n && (isImage(n) || isVibe(n) || isRef(n) || isArtist(n) || isCharDict(n)) ? id : null;
}

/** 从结果里拖出的图松在某个节点上 */
export function dropImageOn(id: string, img: Pic) {
  const n = node(id); if (!n) return;
  if (isArtist(n)) { setArtistCover(id, img.url); return; }
  if (isCharDict(n)) { if (n.data.sel) setCharCover(n.data.sel, img.url); else toast('先在角色字典里点一个角色，再把图拖上去当封面', { err: true }); return; }
  if (isImage(n) || isVibe(n) || isRef(n)) {
    if (n.data.url === img.url) return;
    updateData(id, { url: img.url, iw: img.iw, ih: img.ih, ...(isImage(n) ? { seed: img.seed, prompt: img.prompt, mask: undefined, focus: undefined, layers: undefined } : {}) } as never, true);
    if (isVibe(n)) syncVibe(id);
    toast(`已换成这张图`);
  } else if (isGen(n)) {
    const w = KINDS.image.w, made = batch(() => {
      const m = createNode('image', Math.round(n.position.x - w - 80), Math.round(n.position.y), { ...img });
      connect(m.id, id, true);
      return m;
    });
    settle(made.id);
    toast(`已接为「${n.data.title}」的底图，可以在参数面板里调重绘强度`);
  }
}
