import { describe, expect, it } from 'vitest';
import { aabb, adjustHsv, dilate, dragBox, floodFill, hexToRgb, hitBox, hsvToRgb, inPolygon, maskBounds, rgbToHex, rgbToHsv, toLocal, type Box } from './index.ts';

/** w×h 的 RGBA 图，fn 给出每个像素的颜色 */
function img(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d.set(fn(x, y), (y * w + x) * 4);
  return d;
}

describe('颜色换算', () => {
  it('RGB 和 HSV 来回换不变', () => {
    for (const c of [[255, 0, 0], [0, 128, 255], [12, 34, 56], [200, 200, 200], [0, 0, 0]] as [number, number, number][]) {
      const [h, s, v] = rgbToHsv(...c);
      expect(hsvToRgb(h, s, v)).toEqual(c);
    }
  });
  it('十六进制', () => {
    expect(hexToRgb('#d71921')).toEqual([215, 25, 33]);
    expect(rgbToHex(215, 25, 33)).toBe('#d71921');
  });
});

describe('HSV 调整', () => {
  it('色相转 120 度：红变绿', () => {
    const d = img(1, 1, () => [255, 0, 0, 255]);
    adjustHsv(d, 120, 0, 0);
    expect([...d]).toEqual([0, 255, 0, 255]);
  });
  it('饱和度 −100 变灰，明度 −100 变黑', () => {
    const d = img(1, 1, () => [200, 100, 50, 255]);
    adjustHsv(d, 0, -100, 0);
    expect(d[0]).toBe(d[1]); expect(d[1]).toBe(d[2]);
    adjustHsv(d, 0, 0, -100);
    expect([...d]).toEqual([0, 0, 0, 255]);
  });
  it('只作用在选区里，透明像素不动', () => {
    const d = img(2, 1, () => [255, 0, 0, 255]);
    adjustHsv(d, 120, 0, 0, new Uint8Array([255, 0]));
    expect([...d.slice(0, 4)]).toEqual([0, 255, 0, 255]);
    expect([...d.slice(4)]).toEqual([255, 0, 0, 255]);
  });
});

describe('油漆桶', () => {
  // 10×10：左半白、右半黑，中间一条竖线把左半分成两块
  const W = 10, H = 10;
  const pic = img(W, H, (x) => (x === 2 ? [0, 0, 0, 255] : x < 5 ? [255, 255, 255, 255] : [0, 0, 0, 255]));
  it('只填连在一起的同色区域', () => {
    const m = floodFill(pic, W, H, 0, 0, 0);
    expect(m.reduce((a, b) => a + b, 0)).toBe(20);
    expect(maskBounds(m, W, H)).toEqual({ x: 0, y: 0, w: 2, h: 10 });
  });
  it('容差：相近的颜色也算', () => {
    const g = img(4, 1, x => [x * 10, 0, 0, 255]);
    expect(floodFill(g, 4, 1, 0, 0, 3).reduce((a, b) => a + b, 0)).toBe(1);
    expect(floodFill(g, 4, 1, 0, 0, 12).reduce((a, b) => a + b, 0)).toBe(4);
  });
  it('不越过选区', () => {
    const limit = new Uint8Array(W * H); for (let y = 0; y < 5; y++) for (let x = 0; x < 2; x++) limit[y * W + x] = 1;
    expect(floodFill(pic, W, H, 0, 0, 0, limit).reduce((a, b) => a + b, 0)).toBe(10);
  });
  it('起点在图外时什么也不填', () => {
    expect(floodFill(pic, W, H, -1, 3, 0).reduce((a, b) => a + b, 0)).toBe(0);
  });
  it('向外扩一圈', () => {
    const m = new Uint8Array(9); m[4] = 1;
    expect([...dilate(m, 3, 3, 1)]).toEqual([0, 1, 0, 1, 1, 1, 0, 1, 0]);
  });
});

describe('变换框', () => {
  const b: Box = { cx: 100, cy: 100, w: 100, h: 50, rot: 0 };
  it('拖框内：移动', () => {
    expect(dragBox(b, 'inside', { x: 0, y: 0 }, { x: 10, y: -5 })).toMatchObject({ cx: 110, cy: 95, w: 100, h: 50 });
  });
  it('拖右下角：左上角不动', () => {
    const n = dragBox(b, 'se', { x: 150, y: 125 }, { x: 170, y: 135 });
    expect(n.w).toBeCloseTo(120); expect(n.h).toBeCloseTo(60);
    expect(n.cx - n.w / 2).toBeCloseTo(50); expect(n.cy - n.h / 2).toBeCloseTo(75);
  });
  it('Shift 等比、Alt 从中心', () => {
    const s = dragBox(b, 'se', { x: 150, y: 125 }, { x: 250, y: 130 }, { shift: true });
    expect(s.w / s.h).toBeCloseTo(2);
    const a = dragBox(b, 'e', { x: 150, y: 100 }, { x: 170, y: 100 }, { alt: true });
    expect([a.cx, a.cy, a.w, a.h]).toEqual([100, 100, 140, 50]);
  });
  it('边上的手柄只改一个方向', () => {
    const n = dragBox(b, 'n', { x: 100, y: 75 }, { x: 130, y: 55 });
    expect(n.w).toBe(100); expect(n.h).toBeCloseTo(70); expect(n.cy + n.h / 2).toBeCloseTo(125);
  });
  it('旋转，Shift 吸附到 15 度', () => {
    const r = dragBox(b, 'rot', { x: 100, y: 50 }, { x: 150, y: 100 });
    expect(r.rot).toBeCloseTo(Math.PI / 2);
    const s = dragBox(b, 'rot', { x: 100, y: 50 }, { x: 110, y: 51 }, { shift: true });
    expect(Math.round((s.rot * 180) / Math.PI) % 15).toBe(0);
  });
  it('旋转后的点击判断和外接范围', () => {
    const r: Box = { ...b, rot: Math.PI / 2 };
    expect(hitBox(r, 100, 140, 4, 20)).toBe('inside');
    expect(hitBox(r, 140, 100, 4, 20)).toBe(null);
    expect(aabb(r)).toEqual({ x: 75, y: 50, w: 50, h: 100 });
    const l = toLocal(r, 100, 150);
    expect(l.x).toBeCloseTo(50); expect(l.y).toBeCloseTo(0);
  });
  it('多边形内外', () => {
    const tri = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }];
    expect(inPolygon(tri, 2, 2)).toBe(true);
    expect(inPolygon(tri, 8, 8)).toBe(false);
  });
});
