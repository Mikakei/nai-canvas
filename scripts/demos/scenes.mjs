// 演示动图的各个场景：每个场景拿到一个全新的演示画布（提示词 1、负面提示词 1、生图 1），
// 先做不录的准备，h.start() 开始录，返回 h.stop() 抓到的帧。改了界面以后对不上的话，改这里的选择器就行
const node = id => `.react-flow__node[data-id="${id}"]`;
const at = r => [r[0], r[1]];
const PROMPT = '1girl, silver hair, raincoat, standing in the rain, neon city at night';

/** 等生图节点跑完 */
async function waitIdle(h, id, ms = 25000) {
  const t0 = Date.now(); await h.sleep(500);
  while (Date.now() - t0 < ms) {
    const cls = await h.ev(`document.querySelector('${node(id)} .node')?.className`);
    if (cls && !/is-(running|queued)/.test(cls)) return;
    await h.sleep(150);
  }
  throw new Error('生成超时');
}
/** 准备步骤：直接把提示词写进提示词节点 */
async function seedPrompt(h, text = PROMPT) {
  await h.ev(`document.querySelector('.react-flow__node-prompt .cm-content')?.focus()`);
  await h.send('Input.insertText', { text }); await h.sleep(200);
  await h.ev(`document.activeElement?.blur()`); await h.sleep(500);
}
async function generate(h, id) {
  await h.ev(`document.querySelector('${node(id)} .go').click()`);
  await waitIdle(h, id);
}
/** 用滚轮平移画布，直到某个元素的左边（或上边）到指定位置 */
async function panTo(h, sel, target, axis = 'x') {
  for (let i = 0; i < 12; i++) {
    const r = await h.rect(sel); if (!r) return;
    const d = (axis === 'x' ? r[4] : r[5]) - target;
    if (Math.abs(d) < 6) break;
    await h.wheel(axis === 'x' ? d * 2 : 0, axis === 'y' ? d * 2 : 0);
    await h.sleep(260);
  }
  await h.sleep(300);
}
const zoomOut = async h => { await h.ev(`document.querySelector('.dock button[aria-label="缩小"]').click()`); await h.sleep(500); };
const setValue = (h, sel, v, proto) => h.ev(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return false; el.focus(); Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(el, ${JSON.stringify(v)}); el.dispatchEvent(new Event('${proto === 'HTMLSelectElement' ? 'change' : 'input'}', { bubbles: true })); el.blur(); return true; })()`);
/** 屏幕上终点落在某个节点左边的那根连线的中点 */
const wireInto = (h, id) => h.ev(`(() => { const t = document.querySelector('${node(id)}').getBoundingClientRect(); for (const p of document.querySelectorAll('path.wire-hit')) { const L = p.getTotalLength(), m = p.getScreenCTM(), q = p.getPointAtLength(L); if (Math.abs(q.x * m.a + q.y * m.c + m.e - t.left) < 40) { const c = p.getPointAtLength(L / 2); return [c.x * m.a + c.y * m.c + m.e, c.x * m.b + c.y * m.d + m.f]; } } return null; })()`);
const must = (v, what) => { if (!v) throw new Error(`找不到${what}`); return v; };

export const SCENES = {
  // 首页主图：写提示词 → 生成 → 悬停看操作 → 再来一张 → 切换深色
  async hero(h) {
    await h.viewport(1100, 780);
    await h.load({ paramsSeen: false });
    await h.fit();
    const [gen] = await h.ids('generate');
    await h.start();
    await h.sleep(500);
    const pe = must(await h.rect('.react-flow__node-prompt .cm-content'), '提示词框');
    await h.click(pe[4] + 40, pe[5] + 14);
    await h.sleep(250);
    await h.type(PROMPT, 30);
    await h.sleep(400);
    await h.key('Escape', 'Escape', 0, 27);
    await h.click(...at(await h.rect(`${node(gen)} .go`)));
    await waitIdle(h, gen); await h.sleep(500);
    const media = await h.rect(`${node(gen)} .media`);
    await h.move(media[0] + 30, media[1] + 30, 600);
    await h.sleep(900);
    await h.click(...at(await h.rect(`${node(gen)} .go`)));
    await waitIdle(h, gen); await h.sleep(800);
    await h.click(...at(must(await h.rect('button[aria-label="切换明暗主题"]'), '主题按钮')), { ms: 700 });
    await h.sleep(1500);
    return h.stop();
  },

  // 连线：从结果图拉线到空白处 → 选「图片工具」→ 运行线稿 → 鼠标移到线上点 × 断开 → 撤销
  async wires(h) {
    await h.viewport(1100, 720);
    await h.load();
    await h.fit();
    const [gen] = await h.ids('generate');
    await seedPrompt(h);
    await generate(h, gen);
    await panTo(h, `${node(gen)} .node`, 300);
    await h.start();
    await h.sleep(400);
    const out = await h.rect(`${node(gen)} .hd.is-out`), g = await h.rect(`${node(gen)} .node`);
    await h.drag(out[0], out[1], g[4] + g[2] + 140, g[5] + 170, 800);
    await h.sleep(700);
    await h.click(...at(must(await h.rectText('.menu-item', '图片工具'), '菜单里的图片工具')), { ms: 500 });
    await h.sleep(1000);
    const [tool] = await h.ids('tool');
    // 用节点上方工具条里的「运行」，节点底部的按钮可能被底栏挡住
    const tn = await h.rect(`${node(tool)} .node`);
    await h.move(tn[0], tn[5] + 120, 500); await h.sleep(300);
    await h.click(...at(must(await h.rect(`${node(tool)} .ntool button.run`), '运行按钮')));
    await h.sleep(2600);
    const w = must(await wireInto(h, tool), '连线');
    await h.move(w[0], w[1], 700);
    await h.sleep(700);
    await h.click(...at(must(await h.rect('.wire-cut'), '断开按钮')), { ms: 250 });
    await h.sleep(1000);
    const undo = await h.rect('.toast button');
    if (undo) await h.click(...at(undo), { ms: 700 });
    await h.sleep(1300);
    return h.stop();
  },

  // 参数卡片：点「参数」在旁边打开 → 改成横向 → 重新生成 → 收起
  async params(h) {
    await h.viewport(1100, 720);
    await h.load({ paramsSeen: false });
    await h.fit();
    const [gen] = await h.ids('generate');
    await seedPrompt(h);
    await generate(h, gen);
    await panTo(h, `${node(gen)} .node`, 300);
    await h.start();
    await h.sleep(400);
    await h.click(...at(await h.rect(`${node(gen)} .sum-lab`)));
    await h.sleep(1100);
    await h.click(...at(must(await h.rectText(`${node(gen)} .gparams .seg button`, '横向'), '横向按钮')));
    await h.sleep(600);
    await h.click(...at(await h.rect(`${node(gen)} .go`)));
    await waitIdle(h, gen); await h.sleep(900);
    await h.click(...at(await h.rect(`${node(gen)} .nside-x`)));
    await h.sleep(1300);
    return h.stop();
  },

  // 画师串：双击空白处加一个画师串节点 → 从库里选 → 拖权重 → 接到生图节点，画师串排在提示词最前
  async artist(h) {
    await h.viewport(1100, 720);
    await h.load();
    const now = Date.now();
    const lib = [
      ['水彩清透', '日常', '0.8::artist_alpha ::, 1.1::artist_beta ::, artist_gamma'],
      ['柔和人像', '日常', 'artist_delta, 0.7::artist_epsilon ::, 1.2::artist_zeta ::'],
      ['鲜明线条', '日常', '1.3::artist_eta ::, artist_theta, 0.6::artist_iota ::'],
      ['梦幻光感', '收藏', 'artist_kappa, 0.9::artist_lambda ::'],
      ['低饱和', '收藏', '0.75::artist_mu ::, artist_nu, artist_xi'],
    ].map(([name, group, text], i) => ({ id: 'a' + i, name, group, text, created: now + i }));
    await h.api('/api/presets/artists', { method: 'PUT', body: JSON.stringify(lib) });
    await h.load();
    await h.fit();
    const [gen] = await h.ids('generate');
    await seedPrompt(h);
    await zoomOut(h);
    await panTo(h, '.react-flow__node-prompt .node', 400);
    await panTo(h, '.react-flow__node-prompt .node', 150, 'y');
    await h.start();
    await h.sleep(400);
    const p = await h.rect('.react-flow__node-prompt .node');
    await h.click(p[4] - 200, p[5] + 150, { double: true });
    await h.sleep(600);
    await h.click(...at(must(await h.rectText('.menu-item', '画师串'), '菜单里的画师串')), { ms: 450 });
    await h.sleep(1100);
    const [art] = await h.ids('artist');
    await h.click(...at(must(await h.rectText(`${node(art)} .astart .btn`, '从库里选'), '从库里选')));
    await h.sleep(800);
    const card = must(await h.rectText('.apop .alib-name', '水彩清透'), '画师串卡片');
    await h.move(card[0] + 60, card[1] - 60, 500); await h.sleep(250);
    await h.click(...at(card), { ms: 300 });
    await h.sleep(900);
    const dots = await h.rect(`${node(art)} .adots`);
    if (dots) await h.drag(dots[4] + dots[2] * 0.5, dots[1], dots[4] + dots[2] * 0.9, dots[1], 600);
    await h.sleep(500);
    const out = await h.rect(`${node(art)} .hd.is-out`), head = await h.rect(`${node(gen)} .nhead`);
    await h.drag(out[0], out[1], head[0], head[1] + 120, 900);
    await h.sleep(1600);
    return h.stop();
  },

  // 局部重绘：结果图上点「局部重绘」→ 涂两笔 → 保存并重绘
  async inpaint(h) {
    await h.viewport(1100, 720);
    await h.load();
    await h.fit();
    const [gen] = await h.ids('generate');
    await seedPrompt(h);
    await generate(h, gen);
    await zoomOut(h);
    await panTo(h, '.react-flow__node-prompt .node', 420);
    await h.sleep(500);
    await h.start();
    await h.sleep(400);
    const media = await h.rect(`${node(gen)} .media`);
    await h.move(media[0], media[1] + 20, 600); await h.sleep(500);
    await h.click(...at(must(await h.rectText(`${node(gen)} .acts button`, '局部重绘'), '局部重绘按钮')), { ms: 400 });
    await h.sleep(1600);
    const c = must(await h.rect('.ed-stage canvas'), '编辑器画布');
    await h.drag(c[0] - 70, c[1] - 30, c[0] + 60, c[1] + 10, 700);
    await h.sleep(200);
    await h.drag(c[0] - 60, c[1] + 40, c[0] + 70, c[1] + 70, 700);
    await h.sleep(600);
    await h.click(...at(must(await h.rectText('.ed-foot .btn', '保存并重绘'), '保存并重绘')));
    await waitIdle(h, gen); await h.sleep(1300);
    return h.stop();
  },

  // 网格对比：从生图节点拉一个网格对比，X 轴换 4 个种子，一键跑完，挑一格用回生图节点
  async grid(h) {
    await h.viewport(1100, 720);
    await h.load();
    await h.fit();
    const [gen] = await h.ids('generate');
    await seedPrompt(h);
    await zoomOut(h);
    await panTo(h, `${node(gen)} .node`, 120);
    const out = await h.rect(`${node(gen)} .hd.is-out`), g = await h.rect(`${node(gen)} .node`);
    await h.drag(out[0], out[1], g[4] + g[2] + 110, g[5] + 30, 300);
    await h.sleep(500);
    await h.click(...at(must(await h.rectText('.menu-item', '网格对比'), '菜单里的网格对比')), { ms: 200 });
    await h.sleep(1200);
    const [grid] = await h.ids('grid');
    await setValue(h, `${node(grid)} select[aria-label="X 轴参数"]`, 'seed', 'HTMLSelectElement'); await h.sleep(300);
    await setValue(h, `${node(grid)} input[aria-label="X 轴的值"]`, '7, 21, 42, 99', 'HTMLInputElement'); await h.sleep(500);
    await h.move(h.W * 0.5, h.H * 0.85, 100);
    await h.start();
    await h.sleep(500);
    await h.click(...at(must(await h.rect(`${node(grid)} .tool-go`), '运行按钮')));
    await h.sleep(1200);
    for (let i = 0; i < 80; i++) { if (await h.ev(`document.querySelectorAll('${node(grid)} .gcell img').length`) >= 4) break; await h.sleep(300); }
    await h.sleep(800);
    const cells = await h.ev(`[...document.querySelectorAll('${node(grid)} .gcell')].map(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })`);
    await h.move(cells[2][0], cells[2][1], 600); await h.sleep(700);
    const use = await h.ev(`(() => { const b = [...document.querySelectorAll('${node(grid)} .gcell')][2]?.querySelector('.guse'); if (!b) return null; const r = b.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
    if (use) await h.click(use[0], use[1], { ms: 300 });
    await h.sleep(1500);
    return h.stop();
  },

  // 全屏图库：打开 → 点一张看大图 → 翻页 → 放大 → 关掉
  async gallery(h) {
    await h.viewport(1100, 720);
    await h.load();
    await h.fit();
    const [gen] = await h.ids('generate');
    await seedPrompt(h);
    // 准备：每次 4 张，跑 3 次
    await h.ev(`document.querySelector('${node(gen)} .sum').click()`); await h.sleep(500);
    await setValue(h, '.gparams select[aria-label="张数"]', '4', 'HTMLSelectElement'); await h.sleep(300);
    await h.ev(`document.querySelector('${node(gen)} .nside-x').click()`); await h.sleep(400);
    for (let i = 0; i < 3; i++) await generate(h, gen);
    await h.sleep(600);
    await h.start();
    await h.sleep(400);
    await h.click(...at(must(await h.rectText('.dock .db', '图库'), '图库按钮')));
    await h.sleep(1300);
    const tiles = await h.ev(`[...document.querySelectorAll('.gfull .gt')].slice(0, 8).map(e => { const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })`);
    await h.move(tiles[4][0], tiles[4][1], 600); await h.sleep(300);
    await h.move(tiles[1][0], tiles[1][1], 500); await h.sleep(200);
    await h.click(tiles[1][0], tiles[1][1], { ms: 200 });
    await h.sleep(900);
    const right = must(await h.rect('.gfull .gpv-arrow.is-r'), '下一张按钮');
    await h.click(...at(right)); await h.sleep(650);
    await h.click(...at(right), { ms: 250 }); await h.sleep(800);
    await h.click(...at(must(await h.rect('.gfull .gpv-img'), '大图')), { ms: 500 });
    await h.sleep(1500);
    await h.key('Escape', 'Escape', 0, 27); await h.sleep(600);
    await h.key('Escape', 'Escape', 0, 27); await h.sleep(1000);
    return h.stop();
  },
};
