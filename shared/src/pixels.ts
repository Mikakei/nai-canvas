// 画布编辑器用到的像素算法：填充、HSV 调整、颜色换算。只操作 RGBA 字节数组，不依赖浏览器

/** 0–255 的 RGB → [色相 0–360, 饱和度 0–1, 明度 0–1] */
export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) {
    if (max === R) h = ((G - B) / d) % 6;
    else if (max === G) h = (B - R) / d + 2;
    else h = (R - G) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max ? d / max : 0, max];
}

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = v * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** 调整量：0 不变；往正方向时向 1 靠近，往负方向时按比例减少 */
const shift = (v: number, k: number) => (k >= 0 ? v + (1 - v) * k : v * (1 + k));

/**
 * HSV 调整（原地修改）。dh：色相 −180…180 度；ds、dv：饱和度、明度 −100…100。
 * weight 是每个像素的作用强度 0–255（选区，带抗锯齿边缘），不传时全图
 */
export function adjustHsv(data: Uint8ClampedArray, dh: number, ds: number, dv: number, weight?: Uint8Array | null) {
  const ks = ds / 100, kv = dv / 100;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const w = weight ? weight[p] / 255 : 1;
    if (!w || !data[i + 3]) continue;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const [h, s, v] = rgbToHsv(r, g, b);
    const [nr, ng, nb] = hsvToRgb(h + dh, Math.min(1, Math.max(0, shift(s, ks))), Math.min(1, Math.max(0, shift(v, kv))));
    data[i] = r + (nr - r) * w; data[i + 1] = g + (ng - g) * w; data[i + 2] = b + (nb - b) * w;
  }
}

/**
 * 油漆桶：从 (x, y) 开始，找出和起点颜色相近、连在一起的区域。
 * tolerance 0–100：任一通道（含透明度）相差不超过 tolerance% 就算相近。
 * limit 是选区（0 表示选区外），填充不会越过选区。返回 0/1 的区域
 */
export function floodFill(data: Uint8ClampedArray, w: number, h: number, x: number, y: number, tolerance: number, limit?: Uint8Array | null): Uint8Array {
  const out = new Uint8Array(w * h);
  x = Math.floor(x); y = Math.floor(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return out;
  if (limit && !limit[y * w + x]) return out;
  const t = Math.round((tolerance / 100) * 255), s = (y * w + x) * 4;
  const r0 = data[s], g0 = data[s + 1], b0 = data[s + 2], a0 = data[s + 3];
  const ok = (p: number) => {
    if (out[p] || (limit && !limit[p])) return false;
    const i = p * 4;
    return Math.abs(data[i] - r0) <= t && Math.abs(data[i + 1] - g0) <= t && Math.abs(data[i + 2] - b0) <= t && Math.abs(data[i + 3] - a0) <= t;
  };
  // 扫描线填充：每次把一整段横线填满，再把上下两行的起点压栈
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop()!, px = stack.pop()!;
    let lx = px;
    if (!ok(py * w + lx)) continue;
    while (lx > 0 && ok(py * w + lx - 1)) lx--;
    let rx = px;
    while (rx < w - 1 && ok(py * w + rx + 1)) rx++;
    for (let i = lx; i <= rx; i++) out[py * w + i] = 1;
    for (const ny of [py - 1, py + 1]) {
      if (ny < 0 || ny >= h) continue;
      let inRun = false;
      for (let i = lx; i <= rx; i++) {
        const can = ok(ny * w + i);
        if (can && !inRun) { stack.push(i, ny); inRun = true; } else if (!can) inRun = false;
      }
    }
  }
  return out;
}

/** 区域向外扩 r 个像素（填充时盖住抗锯齿的边缘，不留白边） */
export function dilate(mask: Uint8Array, w: number, h: number, r = 1): Uint8Array {
  let cur = mask;
  for (let k = 0; k < r; k++) {
    const next = new Uint8Array(cur);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (cur[y * w + x]) continue;
      if ((x > 0 && cur[y * w + x - 1]) || (x < w - 1 && cur[y * w + x + 1]) || (y > 0 && cur[(y - 1) * w + x]) || (y < h - 1 && cur[(y + 1) * w + x])) next[y * w + x] = 1;
    }
    cur = next;
  }
  return cur;
}

/** 区域的外接矩形，没有像素时返回 null */
export function maskBounds(mask: Uint8Array, w: number, h: number): { x: number; y: number; w: number; h: number } | null {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[y * w + x]) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** "#rrggbb" ↔ [r, g, b] */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex.trim());
  return m ? [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)] : [0, 0, 0];
}
export const rgbToHex = (r: number, g: number, b: number) => `#${[r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('')}`;
