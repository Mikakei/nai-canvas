import { describe, expect, it } from 'vitest';
import { pixelSnap, toolCost, toolRequest, toolSize } from './index.ts';

describe('Director Tools', () => {
  it('小图放大到约 1MP，大图缩到上限内', () => {
    const [w, h] = toolSize(512, 768);
    expect(w * h).toBeGreaterThan(1000000); expect(w * h).toBeLessThanOrEqual(1048576);
    const [W, H] = toolSize(2000, 2000);
    expect(W * H).toBeLessThanOrEqual(3145728 - 2000);
    expect(toolSize(1024, 1536)).toEqual([1024, 1536]);
  });
  it('请求字段：改表情写成 "表情;;补充"，去杂物保留气泡换类型', () => {
    expect(toolRequest('emotion', 'IMG', 832, 1216, { emotion: 'happy', prompt: 'smile', defry: 2 })).toEqual({ req_type: 'emotion', image: 'IMG', width: 832, height: 1216, prompt: 'happy;;smile', defry: 2 });
    expect(toolRequest('declutter', 'IMG', 1, 1, { keepBubbles: true }).req_type).toBe('declutter-keep-bubbles');
    expect(toolRequest('lineart', 'IMG', 1, 1).prompt).toBeUndefined();
    expect(toolRequest('colorize', 'IMG', 1, 1, { prompt: 'red hair', defry: 1 })).toMatchObject({ prompt: 'red hair', defry: 1 });
  });
  it('价格：1MP 以内 Opus 免费；去背景三倍加 5 且不免费；像素整理不花钱', () => {
    const opus = { tier: 3, active: true };
    expect(toolCost('lineart', 832, 1216, opus)).toEqual({ price: 0, free: true });
    expect(toolCost('lineart', 832, 1216, { tier: 1, active: true })).toEqual({ price: 20, free: false });
    expect(toolCost('bg-removal', 832, 1216, opus)).toEqual({ price: 65, free: false });
    expect(toolCost('pixel-snap', 832, 1216, opus)!.price).toBe(0);
    expect(toolCost('lineart', 1024, 1536, opus)!.free).toBe(false);
  });
});

/** 生成一张"放大过的像素画"：cw×ch 个格子，每格 pitch 像素，带一点噪声 */
function pixelArt(cw: number, ch: number, pitch: number, seed = 1) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const pal = [[20, 20, 30], [230, 230, 220], [215, 25, 33], [61, 123, 217], [245, 213, 71], [88, 179, 104]];
  const cells = Array.from({ length: cw * ch }, () => Math.floor(rnd() * pal.length));
  const w = Math.round(cw * pitch), h = Math.round(ch * pitch), d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = pal[cells[Math.min(ch - 1, Math.floor(y / pitch)) * cw + Math.min(cw - 1, Math.floor(x / pitch))]], i = (y * w + x) * 4;
    d[i] = c[0] + (rnd() - 0.5) * 6; d[i + 1] = c[1] + (rnd() - 0.5) * 6; d[i + 2] = c[2] + (rnd() - 0.5) * 6; d[i + 3] = 255;
  }
  return { d, w, h, cells, pal };
}

describe('像素整理', () => {
  it('找到非整数的像素间距，格子数对得上，颜色还原', () => {
    const { d, w, h, cells, pal } = pixelArt(20, 30, 7.5);
    const r = pixelSnap(d, w, h, { palette: 'auto', colors: 64, avoidOverRefining: false });
    expect(Math.abs(r.Wc - 20)).toBeLessThanOrEqual(1);
    expect(Math.abs(r.Hc - 30)).toBeLessThanOrEqual(1);
    expect(r.pitch[0]).toBeCloseTo(7.5, 0);
    expect(r.paletteSize).toBeGreaterThanOrEqual(4); expect(r.paletteSize).toBeLessThanOrEqual(12);
    if (r.Wc === 20 && r.Hc === 30) {
      let ok = 0;
      for (let k = 0; k < 600; k++) { const c = pal[cells[k]]; const dd = Math.abs(r.data[k * 4] - c[0]) + Math.abs(r.data[k * 4 + 1] - c[1]) + Math.abs(r.data[k * 4 + 2] - c[2]); if (dd < 30) ok++; }
      expect(ok / 600).toBeGreaterThan(0.95);
    }
  });
  it('整数间距、指定颜色数', () => {
    const { d, w, h } = pixelArt(16, 16, 8, 7);
    const r = pixelSnap(d, w, h, { palette: 'custom', colors: 4, avoidOverRefining: true });
    expect([r.Wc, r.Hc]).toEqual([16, 16]);
    expect(r.paletteSize).toBe(4);
  });
  it('不是像素画（随机噪点）时报错', () => {
    let s = 3; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
    const w = 120, h = 120, d = new Uint8ClampedArray(w * h * 4).map((_, i) => (i % 4 === 3 ? 255 : rnd() * 255));
    expect(() => pixelSnap(d, w, h, { palette: 'off', colors: 0, avoidOverRefining: false })).toThrow(/不是像素画/);
  });
});
