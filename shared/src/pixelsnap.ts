// 像素整理（Pixel Snap）：AI 画的"像素画"其实是放大后又被模糊过的，像素块大小也不完全一致。
// 这里先从边缘的规律里找出像素网格（间距和起点），再把每个格子取成一种颜色，最后可选地整理调色板。
// 思路和官网一致（找间距 → 对齐格线 → 取格子颜色 → 调色板），实现是简化过的纯 JS 版本

export interface SnapOpts {
  /** 调色板：不整理、自动决定颜色数、指定颜色数 */
  palette: 'off' | 'auto' | 'custom';
  colors: number;
  /** 勾选时始终用检测到的像素大小；不勾时如果更细的像素网格更贴合，就用更细的 */
  avoidOverRefining: boolean;
}
export interface SnapResult {
  /** 整理后的小图（每个像素就是一个格子），RGBA */
  data: Uint8ClampedArray;
  Wc: number; Hc: number;
  pitch: [number, number];
  paletteSize: number;
}

/** 每列、每行相邻像素的颜色差之和（边缘越多越大） */
function profiles(d: Uint8ClampedArray, w: number, h: number) {
  const cols = new Float64Array(w - 1), rows = new Float64Array(h - 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = (y * w + x) * 4, j = i + 4;
      cols[x] += Math.abs(d[j] - d[i]) + Math.abs(d[j + 1] - d[i + 1]) + Math.abs(d[j + 2] - d[i + 2]) + Math.abs(d[j + 3] - d[i + 3]);
    }
  }
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4, j = i + w * 4;
      rows[y] += Math.abs(d[j] - d[i]) + Math.abs(d[j + 1] - d[i + 1]) + Math.abs(d[j + 2] - d[i + 2]) + Math.abs(d[j + 3] - d[i + 3]);
    }
  }
  return [cols, rows];
}

/** 截掉特别大的边缘值，避免一两条很强的边主导结果 */
function clip(g: Float64Array): Float64Array {
  const max = g.reduce((a, b) => Math.max(a, b), 0);
  const sig = [...g].filter(v => v > max * 0.02).sort((a, b) => a - b);
  const cap = sig.length ? sig[Math.floor(sig.length * 0.6)] : max;
  return g.map(v => Math.min(v, cap));
}

/**
 * 间距 p 的周期性（官网同款算法）：把边的位置按 (位置 mod p) 归到约 0.25 像素宽的格子里，
 * 看 0.7 像素宽的窗口里最多能装下多少能量，再除以均匀分布时窗口应占的比例。
 * 按长度约 14 个间距的小段分别算再加权平均，AI 画的格子大小慢慢漂移也不怕。越大越像网格
 */
function periodicity(g: Float64Array, p: number): { score: number; phase: number } {
  const a = g.length, seg = Math.trunc(Math.max(80, 14 * p)), B = Math.max(8, Math.round(p / 0.25)), bw = p / B;
  const u = Math.max(1, Math.round(0.7 / bw)), segs = Math.floor((a - 1) / seg) + 1, frac = (u * bw) / p;
  const f = new Float64Array(segs * B), glob = new Float64Array(B);
  for (let r = 0; r < a; r++) {
    if (!g[r]) continue;
    const b = Math.min(B - 1, Math.floor((((r + 1) % p) + p) % p / bw));
    f[Math.floor(r / seg) * B + b] += g[r];
    glob[b] += g[r];
  }
  let num = 0, den = 0;
  for (let k = 0; k < segs; k++) {
    let tot = 0;
    for (let b = 0; b < B; b++) tot += f[k * B + b];
    if (tot <= 1e-9) continue;
    let best = 0;
    for (let s = 0; s < B; s++) { let sum = 0; for (let t = 0; t < u; t++) sum += f[k * B + ((s + t) % B)]; if (sum > best) best = sum; }
    num += (best / tot / frac) * tot; den += tot;
  }
  // 起点用整条的直方图
  let bestG = -1, at = 0;
  for (let s = 0; s < B; s++) { let sum = 0; for (let t = 0; t < u; t++) sum += glob[(s + t) % B]; if (sum > bestG) { bestG = sum; at = s; } }
  return { score: den ? num / den : 0, phase: (at + u / 2) * bw };
}

/**
 * 一个方向上的像素间距：在 3–32 像素里找得分最高的，再看它的整数分之一是不是同样高
 * （网格的整数倍得分和网格本身差不多，所以要往回找基本间距）
 */
function detectPitch(g0: Float64Array, avoidOverRefining: boolean): { p: number; phase: number; score: number } | null {
  const g = clip(g0);
  let best = { p: 0, phase: 0, score: 0 };
  for (let p = 3; p <= Math.min(32, g.length / 3); p += 0.02) {
    const r = periodicity(g, p);
    if (r.score > best.score) best = { p, ...r };
  }
  if (!best.p) return null;
  // 在 ±0.06 像素里细找一下最高点
  const around = (p: number) => {
    let top = { p, ...periodicity(g, p) };
    for (let q = p - 0.06; q <= p + 0.06; q += 0.01) { const r = periodicity(g, q); if (r.score > top.score) top = { p: q, ...r }; }
    return top;
  };
  let pick = best;
  const keep = avoidOverRefining ? 0.85 : 0.72;
  for (let k = 2; best.p / k >= 3; k++) {
    const r = around(best.p / k);
    if (r.score >= best.score * keep) pick = r;
  }
  // 真正的网格得分约是 间距/0.7；杂乱的图只有 1.4 左右
  if (pick.score < Math.max(3, (0.3 * pick.p) / 0.7)) return null;
  return { p: pick.p, phase: pick.phase, score: pick.score };
}

/** 按间距和起点放格线，再把每条格线吸到附近最强的边上（AI 画的像素块大小不完全一样） */
function boundaries(g: Float64Array, n: number, p: number, phase: number): number[] {
  const out = [0];
  let start = phase % p;
  if (start < p * 0.5) start += p;
  const peak = clip(g).reduce((a, b) => Math.max(a, b), 0);
  for (let b = start; b < n - p * 0.5; b += p) {
    let at = Math.round(b), best = -1;
    const r = Math.max(1, Math.round(p * 0.35));
    for (let x = Math.round(b) - r; x <= Math.round(b) + r; x++) {
      const i = x - 1;
      if (i < 0 || i >= g.length) continue;
      if (g[i] > best) { best = g[i]; at = x; }
    }
    if (best < peak * 0.15) at = Math.round(b);
    const last = out[out.length - 1];
    if (at - last >= p * 0.5) out.push(at);
  }
  if (n - out[out.length - 1] < p * 0.5 && out.length > 1) out.pop();
  out.push(n);
  return out;
}

/* ---------- 颜色 ---------- */
function toLab(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  const x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const t = (v: number) => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = t(x), fy = t(y), fz = t(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** k-means（k-means++ 初始化），在 Lab 空间里聚类；返回每个样本所属的中心和中心颜色 */
function kmeans(lab: Float64Array, rgb: Float64Array, n: number, k: number, iters = 10): { centers: Float64Array; rgbC: Float64Array; assign: Int32Array } {
  k = Math.max(1, Math.min(k, n));
  const C = new Float64Array(k * 3), assign = new Int32Array(n);
  // 确定性的初始化：第一个取最暗的，之后每次取离已有中心最远的（相当于 k-means++ 的贪心版）
  const dist = new Float64Array(n).fill(Infinity);
  let first = 0;
  for (let i = 1; i < n; i++) if (lab[i * 3] < lab[first * 3]) first = i;
  C.set(lab.subarray(first * 3, first * 3 + 3), 0);
  for (let c = 1; c < k; c++) {
    let far = 0, fd = -1;
    for (let i = 0; i < n; i++) {
      const dl = lab[i * 3] - C[(c - 1) * 3], da = lab[i * 3 + 1] - C[(c - 1) * 3 + 1], db = lab[i * 3 + 2] - C[(c - 1) * 3 + 2];
      dist[i] = Math.min(dist[i], dl * dl + da * da + db * db);
      if (dist[i] > fd) { fd = dist[i]; far = i; }
    }
    C.set(lab.subarray(far * 3, far * 3 + 3), c * 3);
  }
  const sum = new Float64Array(k * 3), cnt = new Int32Array(k);
  for (let it = 0; it < iters; it++) {
    sum.fill(0); cnt.fill(0);
    let moved = false;
    for (let i = 0; i < n; i++) {
      let bi = 0, bd = Infinity;
      for (let c = 0; c < k; c++) {
        const dl = lab[i * 3] - C[c * 3], da = lab[i * 3 + 1] - C[c * 3 + 1], db = lab[i * 3 + 2] - C[c * 3 + 2], dd = dl * dl + da * da + db * db;
        if (dd < bd) { bd = dd; bi = c; }
      }
      if (assign[i] !== bi) { assign[i] = bi; moved = true; }
      sum[bi * 3] += lab[i * 3]; sum[bi * 3 + 1] += lab[i * 3 + 1]; sum[bi * 3 + 2] += lab[i * 3 + 2]; cnt[bi]++;
    }
    for (let c = 0; c < k; c++) if (cnt[c]) { C[c * 3] = sum[c * 3] / cnt[c]; C[c * 3 + 1] = sum[c * 3 + 1] / cnt[c]; C[c * 3 + 2] = sum[c * 3 + 2] / cnt[c]; }
    if (!moved && it > 0) break;
  }
  // 中心的 RGB 用成员的平均值（避免 Lab 换回 RGB 的误差）
  const rgbC = new Float64Array(k * 3); cnt.fill(0);
  for (let i = 0; i < n; i++) { const c = assign[i]; rgbC[c * 3] += rgb[i * 3]; rgbC[c * 3 + 1] += rgb[i * 3 + 1]; rgbC[c * 3 + 2] += rgb[i * 3 + 2]; cnt[c]++; }
  for (let c = 0; c < k; c++) if (cnt[c]) { rgbC[c * 3] /= cnt[c]; rgbC[c * 3 + 1] /= cnt[c]; rgbC[c * 3 + 2] /= cnt[c]; }
  return { centers: C, rgbC, assign };
}

/** 调色板：自动时找最少的颜色数，让 95% 的格子颜色误差不超过 ΔE 2.5（官网同款标准） */
function palettize(rgb: Float64Array, n: number, mode: SnapOpts['palette'], colors: number): { out: Float64Array; size: number } {
  if (mode === 'off' || n === 0) {
    const set = new Set<number>();
    for (let i = 0; i < n; i++) set.add((Math.round(rgb[i * 3]) << 16) | (Math.round(rgb[i * 3 + 1]) << 8) | Math.round(rgb[i * 3 + 2]));
    return { out: rgb, size: set.size };
  }
  const lab = new Float64Array(n * 3);
  for (let i = 0; i < n; i++) lab.set(toLab(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]), i * 3);
  const unique = new Set<number>();
  for (let i = 0; i < n && unique.size <= 256; i++) unique.add((Math.round(rgb[i * 3]) << 16) | (Math.round(rgb[i * 3 + 1]) << 8) | Math.round(rgb[i * 3 + 2]));
  const apply = (r: ReturnType<typeof kmeans>) => {
    const out = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) { const c = r.assign[i]; out[i * 3] = r.rgbC[c * 3]; out[i * 3 + 1] = r.rgbC[c * 3 + 1]; out[i * 3 + 2] = r.rgbC[c * 3 + 2]; }
    return out;
  };
  if (mode === 'custom') { const r = kmeans(lab, rgb, n, Math.max(2, Math.min(256, colors))); return { out: apply(r), size: Math.min(n, Math.max(2, Math.min(256, colors))) }; }
  const err95 = (r: ReturnType<typeof kmeans>) => {
    const e = new Float64Array(n);
    for (let i = 0; i < n; i++) { const c = r.assign[i]; const dl = lab[i * 3] - r.centers[c * 3], da = lab[i * 3 + 1] - r.centers[c * 3 + 1], db = lab[i * 3 + 2] - r.centers[c * 3 + 2]; e[i] = Math.sqrt(dl * dl + da * da + db * db); }
    e.sort();
    return e[Math.min(n - 1, Math.floor(n * 0.95))];
  };
  let lo = 1, hi = Math.min(256, unique.size);
  let bestR = kmeans(lab, rgb, n, hi);
  if (err95(bestR) > 2.5) return { out: apply(bestR), size: hi };
  while (lo < hi) {
    const mid = (lo + hi) >> 1, r = kmeans(lab, rgb, n, mid);
    if (err95(r) <= 2.5) { hi = mid; bestR = r; } else lo = mid + 1;
  }
  if (bestR.rgbC.length / 3 !== hi) bestR = kmeans(lab, rgb, n, hi);
  return { out: apply(bestR), size: hi };
}

/** 中位数（格子里的颜色取中位数，比平均值更不受边缘模糊影响） */
function median(a: number[]) { a.sort((x, y) => x - y); return a.length ? a[a.length >> 1] : 0; }

export function pixelSnap(d: Uint8ClampedArray, w: number, h: number, o: SnapOpts): SnapResult {
  const [cols, rows] = profiles(d, w, h);
  const px = detectPitch(cols, o.avoidOverRefining), py = detectPitch(rows, o.avoidOverRefining);
  if (!px || !py) throw new Error('看起来不是像素画：没有找到重复的像素网格');
  const xb = boundaries(cols, w, px.p, px.phase), yb = boundaries(rows, h, py.p, py.phase);
  const Wc = xb.length - 1, Hc = yb.length - 1, n = Wc * Hc;
  const rgb = new Float64Array(n * 3), alpha = new Uint8ClampedArray(n);
  // 每个格子去掉四周 27% 再取中位色，避开模糊的边
  const rr: number[] = [], gg: number[] = [], bb: number[] = [], aa: number[] = [];
  for (let cy = 0; cy < Hc; cy++) for (let cx = 0; cx < Wc; cx++) {
    const x0 = xb[cx], x1 = xb[cx + 1], y0 = yb[cy], y1 = yb[cy + 1];
    const mx = Math.floor((x1 - x0) * 0.27), my = Math.floor((y1 - y0) * 0.27);
    rr.length = gg.length = bb.length = aa.length = 0;
    for (let y = y0 + my; y < Math.max(y0 + my + 1, y1 - my); y++) for (let x = x0 + mx; x < Math.max(x0 + mx + 1, x1 - mx); x++) {
      const i = (Math.min(h - 1, y) * w + Math.min(w - 1, x)) * 4;
      rr.push(d[i]); gg.push(d[i + 1]); bb.push(d[i + 2]); aa.push(d[i + 3]);
    }
    const k = cy * Wc + cx;
    rgb[k * 3] = median(rr); rgb[k * 3 + 1] = median(gg); rgb[k * 3 + 2] = median(bb);
    alpha[k] = median(aa) >= 128 ? 255 : 0;
  }
  const { out, size } = palettize(rgb, n, o.palette, o.colors);
  const data = new Uint8ClampedArray(n * 4);
  for (let k = 0; k < n; k++) { data[k * 4] = out[k * 3]; data[k * 4 + 1] = out[k * 3 + 1]; data[k * 4 + 2] = out[k * 3 + 2]; data[k * 4 + 3] = alpha[k]; }
  return { data, Wc, Hc, pitch: [px.p, py.p], paletteSize: size };
}
