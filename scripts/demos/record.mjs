// 录 README 里的功能演示动图。每个场景单独起一个演示模式的本地服务（数据放在系统临时目录，不碰 data 和 outputs），
// 无头 Chrome 照着 scenes.mjs 里的步骤操作，画面里放一个假鼠标指针和点击波纹；抓下来的帧按真实时间间隔交给 ffmpeg 合成 GIF。
// 用法：pnpm demos [场景名...]，不写场景名就全部重录，输出到 docs/media。
// 选项：--out <目录> 换输出位置；--keep 保留临时目录（出错时也会保留，方便看截图）
// 需要本机装有 Chrome（或 Edge、Chromium）和 ffmpeg；找不到时用 CHROME_PATH、FFMPEG 环境变量指定
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SCENES } from './scenes.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const OUT = outAt >= 0 ? resolve(args[outAt + 1] ?? '.') : join(root, 'docs', 'media');
const KEEP = args.includes('--keep');
const names = args.filter((a, i) => !a.startsWith('--') && (outAt < 0 || i !== outAt + 1));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fail = msg => { console.error(`\n${msg}\n`); process.exit(1); };

function findChrome() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  const local = process.env.LOCALAPPDATA ?? '';
  const list = process.platform === 'win32'
    ? ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe', join(local, 'Google/Chrome/Application/chrome.exe'),
      'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe']
    : process.platform === 'darwin'
      ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge', '/Applications/Chromium.app/Contents/MacOS/Chromium']
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/snap/bin/chromium'];
  return list.find(p => existsSync(p));
}
const CHROME = findChrome();
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
if (!CHROME) fail('没有找到 Chrome。装好 Chrome（或 Edge），或者用 CHROME_PATH 环境变量指定浏览器路径');
if (spawnSync(FFMPEG, ['-version'], { stdio: 'ignore' }).status !== 0) fail('没有找到 ffmpeg。装好以后确认命令行里能运行 ffmpeg，或者用 FFMPEG 环境变量指定路径');
if (!existsSync(join(root, 'web', 'dist', 'index.html'))) fail('界面还没有构建：先运行 pnpm build（pnpm demos 会自动构建）');
const bad = names.filter(n => !SCENES[n]);
if (bad.length) fail(`没有这些场景：${bad.join('、')}。可选：${Object.keys(SCENES).join('、')}`);

/** 系统分配一个空闲端口，避免和正在用的 NAI Canvas（8787）冲突 */
const freePort = () => new Promise((ok, no) => {
  const s = createServer(); s.unref(); s.on('error', no);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => ok(port)); });
});

// 假鼠标指针和点击波纹：只是画在页面最上层，不挡点击
const CURSOR = `(() => {
  const mk = () => {
    if (document.getElementById('__cur')) return;
    const c = document.createElement('div'); c.id = '__cur';
    c.innerHTML = '<svg width="24" height="24" viewBox="0 0 24 24"><path d="M4 2.5l15 9-6.6 1.4 3.8 7.3-2.8 1.5-3.8-7.4L4.6 19z" fill="#111" stroke="#fff" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, { position: 'fixed', left: '0', top: '0', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-200px,-200px)', filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.35))' });
    const ring = document.createElement('div');
    Object.assign(ring.style, { position: 'fixed', left: '0', top: '0', width: '36px', height: '36px', marginLeft: '-18px', marginTop: '-18px', borderRadius: '50%', border: '2.5px solid #D71921', opacity: '0', pointerEvents: 'none', zIndex: '2147483646', boxSizing: 'border-box' });
    document.documentElement.append(ring, c);
    addEventListener('mousemove', e => { c.style.transform = 'translate(' + (e.clientX - 4) + 'px,' + (e.clientY - 2) + 'px)'; }, true);
    addEventListener('mousedown', e => { ring.style.left = e.clientX + 'px'; ring.style.top = e.clientY + 'px'; ring.animate([{ opacity: 0.95, transform: 'scale(.35)' }, { opacity: 0, transform: 'scale(1.35)' }], { duration: 520, easing: 'cubic-bezier(.2,.7,.3,1)' }); }, true);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mk); else mk();
})();`;

/** 连上无头 Chrome 的页面，给场景用的一组操作：平滑移动的鼠标、逐字打字、录屏开始和结束 */
async function connect(cdpPort, url) {
  let list;
  for (let i = 0; i < 60 && !list?.length; i++) {
    try { list = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json(); } catch { /* 还没起来 */ }
    if (!list?.length) await sleep(250);
  }
  const page = list?.find(t => t.type === 'page');
  if (!page) throw new Error('连不上无头 Chrome');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });
  let id = 0, recording = false;
  const pend = new Map(), frames = [], errors = [];
  const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
  ws.onmessage = e => {
    const m = JSON.parse(e.data);
    if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); }
    if (m.method === 'Page.screencastFrame') {
      if (recording) frames.push({ t: m.params.metadata.timestamp, data: m.params.data });
      ws.send(JSON.stringify({ id: ++id, method: 'Page.screencastFrameAck', params: { sessionId: m.params.sessionId } }));
    }
    if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
  };
  const ev = async expr => { const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }); return r.result.result?.value ?? r.result.exceptionDetails?.exception?.description; };
  const M = (type, x, y, o = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: o.button || 'left', buttons: o.buttons ?? 0, clickCount: o.count || 1, modifiers: o.mod || 0, deltaX: o.dx || 0, deltaY: o.dy || 0 });
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const BOX = '(e => { if (!e) return null; const r = e.getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2, r.width, r.height, r.x, r.y]; })';
  let W = 1280, H = 800, mx = W * 0.62, my = H * 0.78, held = 0;
  const h = {
    get W() { return W; }, get H() { return H; }, sleep, ev, send, errors,
    /** 录制窗口大小（在 load 之前调用） */
    viewport: async (w, hh) => { W = w; H = hh; mx = W * 0.62; my = H * 0.78; await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }); },
    api: (p, init) => ev(`fetch(${JSON.stringify(p)}, Object.assign({ headers: {'x-nai-canvas': '1', 'Content-Type': 'application/json'} }, ${JSON.stringify(init ?? {})})).then(async r => ({ status: r.status, body: await r.json().catch(() => null) }))`),
    /** 元素位置：[中心 x, 中心 y, 宽, 高, 左, 上]，找不到时是 null */
    rect: sel => ev(`${BOX}(document.querySelector(${JSON.stringify(sel)}))`),
    rectText: (sel, text) => ev(`${BOX}([...document.querySelectorAll(${JSON.stringify(sel)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)})))`),
    ids: type => ev(`[...document.querySelectorAll('.react-flow__node-${type}')].map(e => e.dataset.id)`),
    key: async (k, code, mod = 0, vk) => {
      for (const type of ['keyDown', 'keyUp']) await send('Input.dispatchKeyEvent', { type, key: k, code, modifiers: mod, windowsVirtualKeyCode: vk ?? k.toUpperCase().charCodeAt(0) });
    },
    /** 平滑移动鼠标（按住时就是拖动） */
    move: async (x, y, ms = 520) => {
      const steps = Math.max(6, Math.round(ms / 16)), x0 = mx, y0 = my;
      for (let i = 1; i <= steps; i++) { const t = ease(i / steps); mx = x0 + (x - x0) * t; my = y0 + (y - y0) * t; await M('mouseMoved', mx, my, { buttons: held }); await sleep(ms / steps); }
    },
    click: async (x, y, o = {}) => {
      if (x !== undefined) await h.move(x, y, o.ms ?? 520);
      await sleep(o.pause ?? 140);
      await M('mousePressed', mx, my, { buttons: 1 }); await sleep(70); await M('mouseReleased', mx, my);
      if (o.double) { await sleep(60); await M('mousePressed', mx, my, { buttons: 1, count: 2 }); await sleep(60); await M('mouseReleased', mx, my, { count: 2 }); }
    },
    drag: async (x, y, x2, y2, ms = 900) => {
      await h.move(x, y); await sleep(140);
      await M('mousePressed', mx, my, { buttons: 1 }); held = 1; await sleep(90);
      await h.move(x2, y2, ms); await sleep(120);
      await M('mouseReleased', mx, my); held = 0;
    },
    /** 滚轮：画布默认滚轮平移，移动距离是滚动量的一半 */
    wheel: (dx, dy, x = 30, y = H / 2) => M('mouseWheel', x, y, { dx, dy }),
    type: async (text, cps = 20) => { for (const ch of text) { await send('Input.insertText', { text: ch }); await sleep(1000 / cps + (ch === ',' ? 70 : 0)); } },
    fit: async () => { await h.key('!', 'Digit1', 8, 49); await sleep(700); },
    /** 打开应用：跳过新手引导，浅色主题 */
    load: async (prefs = {}) => {
      await send('Page.navigate', { url }); await sleep(2000);
      await ev(`localStorage.setItem('nai-prefs', JSON.stringify(${JSON.stringify({ onboarded: true, paramsSeen: true, theme: 'light', ...prefs })}))`);
      await send('Page.reload'); await sleep(2600);
      await M('mouseMoved', mx, my);
    },
    start: async () => { frames.length = 0; recording = true; await send('Page.startScreencast', { format: 'png', everyNthFrame: 1, maxWidth: W, maxHeight: H }); await sleep(120); },
    stop: async () => { await sleep(80); recording = false; await send('Page.stopScreencast'); return frames.slice(); },
    shot: async file => { const r = await send('Page.captureScreenshot', { format: 'png' }); writeFileSync(file, Buffer.from(r.result.data, 'base64')); },
  };
  await send('Page.enable'); await send('Runtime.enable');
  await h.viewport(W, H);
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'light' }, { name: 'prefers-reduced-motion', value: 'no-preference' }] });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: CURSOR });
  return { h, close: () => ws.close() };
}

/**
 * 帧按真实时间间隔合成 GIF：保持原尺寸、10 帧每秒、64 色、不抖动。
 * （缩放和抖动都会多出很多过渡色，GIF 反而更大）最后一帧多停一会儿再循环
 */
function makeGif(frames, dir, file, { fps = 10, colors = 64, hold = 1600 } = {}) {
  if (!frames.length) throw new Error('没有录到画面');
  mkdirSync(dir, { recursive: true });
  const name = i => `f${String(i).padStart(5, '0')}.png`;
  let list = 'ffconcat version 1.0\n';
  frames.forEach((f, i) => {
    writeFileSync(join(dir, name(i)), Buffer.from(f.data, 'base64'));
    const next = frames[i + 1];
    list += `file '${name(i)}'\nduration ${(next ? Math.max(1 / 60, next.t - f.t) : hold / 1000).toFixed(4)}\n`;
  });
  // concat 要把最后一帧再写一次，上面给它的停留时间才生效
  list += `file '${name(frames.length - 1)}'\n`;
  writeFileSync(join(dir, 'list.txt'), list);
  const vf = `fps=${fps},split[a][b];[a]palettegen=max_colors=${colors}:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`;
  const r = spawnSync(FFMPEG, ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', 'list.txt', '-vf', vf, '-loop', '0', file], { cwd: dir, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('ffmpeg 合成失败：' + r.stderr);
  return { seconds: frames[frames.length - 1].t - frames[0].t + hold / 1000, size: statSync(file).size };
}

async function record(name) {
  const tmp = mkdtempSync(join(tmpdir(), `nai-demo-${name}-`));
  const port = await freePort(), cdpPort = await freePort();
  const url = `http://127.0.0.1:${port}/`;
  const server = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
    cwd: join(root, 'server'), stdio: 'ignore',
    env: { ...process.env, NAI_MOCK: '1', PORT: String(port), NAI_DATA_DIR: join(tmp, 'data'), NAI_OUTPUT_DIR: join(tmp, 'outputs'), OPEN_BROWSER: '0' },
  });
  const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${cdpPort}`, '--window-size=1280,800', `--user-data-dir=${join(tmp, 'chrome')}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--force-color-profile=srgb', 'about:blank'], { stdio: 'ignore' });
  let session, ok = false;
  try {
    let up = false;
    for (let i = 0; i < 80 && !up; i++) {
      try { up = (await fetch(url + 'api/config', { headers: { 'x-nai-canvas': '1' } })).ok; } catch { /* 还没起来 */ }
      if (!up) await sleep(250);
    }
    if (!up) throw new Error('演示服务没有起来');
    session = await connect(cdpPort, url);
    const frames = await SCENES[name](session.h);
    const file = join(OUT, `${name}.gif`);
    const { seconds, size } = makeGif(frames, join(tmp, 'frames'), file);
    console.log(`  ${name}.gif  ${seconds.toFixed(1)} 秒  ${(size / 1024 / 1024).toFixed(2)} MB`);
    if (session.h.errors.length) console.log(`  页面报错：${session.h.errors.join(' | ').slice(0, 300)}`);
    ok = true;
  } catch (e) {
    if (session) await session.h.shot(join(tmp, 'error.png')).catch(() => {});
    console.error(`  ${name} 没录成：${e.message}\n  现场截图和数据在 ${tmp}`);
  } finally {
    session?.close(); chrome.kill(); server.kill();
    await sleep(600);
    if (ok && !KEEP) try { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* 临时目录删不掉就留给系统清理 */ }
  }
  return ok;
}

mkdirSync(OUT, { recursive: true });
const todo = names.length ? names : Object.keys(SCENES);
console.log(`录制 ${todo.length} 个演示动图 → ${OUT}`);
let failed = 0;
for (const n of todo) if (!(await record(n))) failed++;
if (failed) fail(`${failed} 个场景没录成`);
console.log('全部录好了');
process.exit(0);
