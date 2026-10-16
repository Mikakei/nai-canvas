// 选区变换框的几何：移动、缩放（Shift 等比、Alt 从中心）、旋转（Shift 每 15 度吸附）

/** 变换框：中心、当前宽高（总是正数）、旋转角（弧度） */
export interface Box { cx: number; cy: number; w: number; h: number; rot: number }
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rot';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w', 'rot'];
const SIGN: Record<Exclude<Handle, 'rot'>, [number, number]> = { nw: [-1, -1], n: [0, -1], ne: [1, -1], e: [1, 0], se: [1, 1], s: [0, 1], sw: [-1, 1], w: [-1, 0] };

/** 世界坐标 → 以框中心为原点、不旋转的局部坐标 */
export function toLocal(b: Box, x: number, y: number) {
  const dx = x - b.cx, dy = y - b.cy, c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  return { x: dx * c - dy * s, y: dx * s + dy * c };
}
export function toWorld(b: Box, lx: number, ly: number) {
  const c = Math.cos(b.rot), s = Math.sin(b.rot);
  return { x: b.cx + lx * c - ly * s, y: b.cy + lx * s + ly * c };
}

/** 各个手柄在世界坐标里的位置；旋转手柄在上边中点再往外 rotGap（按屏幕像素换算后的长度） */
export function handlePoints(b: Box, rotGap: number): Record<Handle, { x: number; y: number }> {
  const out = {} as Record<Handle, { x: number; y: number }>;
  for (const [k, [sx, sy]] of Object.entries(SIGN)) out[k as Handle] = toWorld(b, (sx * b.w) / 2, (sy * b.h) / 2);
  out.rot = toWorld(b, 0, -b.h / 2 - rotGap);
  return out;
}

/** 四个角（左上、右上、右下、左下） */
export function corners(b: Box) {
  return [toWorld(b, -b.w / 2, -b.h / 2), toWorld(b, b.w / 2, -b.h / 2), toWorld(b, b.w / 2, b.h / 2), toWorld(b, -b.w / 2, b.h / 2)];
}
/** 旋转后的框占的轴对齐范围 */
export function aabb(b: Box) {
  const c = corners(b), xs = c.map(p => p.x), ys = c.map(p => p.y);
  const x = Math.floor(Math.min(...xs)), y = Math.floor(Math.min(...ys));
  return { x, y, w: Math.ceil(Math.max(...xs)) - x, h: Math.ceil(Math.max(...ys)) - y };
}

/** 点到了哪个手柄、框内还是框外。r 是手柄的点击半径（世界坐标） */
export function hitBox(b: Box, x: number, y: number, r: number, rotGap: number): Handle | 'inside' | null {
  const hp = handlePoints(b, rotGap);
  for (const h of HANDLES) if (Math.hypot(hp[h].x - x, hp[h].y - y) <= r) return h;
  const l = toLocal(b, x, y);
  return Math.abs(l.x) <= b.w / 2 && Math.abs(l.y) <= b.h / 2 ? 'inside' : null;
}

/**
 * 拖动手柄后的新框。start 是按下时的框，p0 / p 是按下时和现在的指针（世界坐标）。
 * 角上的手柄：对角固定（Alt 时中心固定），Shift 保持比例；边上的手柄只改一个方向
 */
export function dragBox(start: Box, h: Handle | 'inside', p0: { x: number; y: number }, p: { x: number; y: number }, mod: { shift?: boolean; alt?: boolean } = {}): Box {
  if (h === 'inside') return { ...start, cx: start.cx + p.x - p0.x, cy: start.cy + p.y - p0.y };
  if (h === 'rot') {
    const a0 = Math.atan2(p0.y - start.cy, p0.x - start.cx), a1 = Math.atan2(p.y - start.cy, p.x - start.cx);
    let rot = start.rot + a1 - a0;
    if (mod.shift) { const step = Math.PI / 12; rot = Math.round(rot / step) * step; }
    return { ...start, rot };
  }
  const [sx, sy] = SIGN[h], l = toLocal(start, p.x, p.y);
  if (mod.alt) {
    let w = sx ? Math.max(1, 2 * Math.abs(l.x)) : start.w, hh = sy ? Math.max(1, 2 * Math.abs(l.y)) : start.h;
    if (mod.shift && sx && sy) { const k = Math.max(w / start.w, hh / start.h); w = start.w * k; hh = start.h * k; }
    return { ...start, w, h: hh };
  }
  const ax = (-sx * start.w) / 2, ay = (-sy * start.h) / 2;
  let w = sx ? Math.max(1, Math.abs(l.x - ax)) : start.w, hh = sy ? Math.max(1, Math.abs(l.y - ay)) : start.h;
  if (mod.shift && sx && sy) { const k = Math.max(w / start.w, hh / start.h); w = start.w * k; hh = start.h * k; }
  // 指针越过对边时朝那边长（不镜像内容）
  const dirx = sx ? Math.sign(l.x - ax) || sx : 0, diry = sy ? Math.sign(l.y - ay) || sy : 0;
  const c = toWorld(start, sx ? ax + (dirx * w) / 2 : 0, sy ? ay + (diry * hh) / 2 : 0);
  return { cx: c.x, cy: c.y, w, h: hh, rot: start.rot };
}

/** 点是否在多边形里（选区判断用，偶奇规则） */
export function inPolygon(pts: { x: number; y: number }[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
