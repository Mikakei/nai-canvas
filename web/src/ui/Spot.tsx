import { useEffect, useRef } from 'react';
import { useOnViewportChange, useReactFlow } from '@xyflow/react';
import { calm } from '../prefs.ts';

const GAP = 20, SIZE = 1.2, R = 130;

/** 鼠标在空白画布上移动时，附近的背景点变大变深。画在节点下面，移到节点上就淡出 */
export function Spot() {
  const ref = useRef<HTMLCanvasElement>(null);
  const st = useRef({ x: 0, y: 0, on: false });
  const rf = useReactFlow();

  const draw = () => {
    const c = ref.current; if (!c) return;
    const { x: mx, y: my, on } = st.current;
    c.classList.toggle('is-on', on);
    if (!on) return;
    const W = c.clientWidth, H = c.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, W, H);
    const { x: vx, y: vy, zoom } = rf.getViewport();
    // 与 React Flow 点阵背景的点位对齐：每格左上角偏移半个点
    const g = GAP * zoom, r0 = (SIZE * zoom) / 2, ox = ((vx % g) + g) % g + r0, oy = ((vy % g) + g) % g + r0;
    ctx.fillStyle = getComputedStyle(c).getPropertyValue('--ink-2');
    for (let y = oy + Math.floor((my - R - oy) / g) * g; y <= my + R; y += g)
      for (let x = ox + Math.floor((mx - R - ox) / g) * g; x <= mx + R; x += g) {
        const d = Math.hypot(x - mx, y - my); if (d > R) continue;
        const t = 1 - d / R;
        ctx.globalAlpha = 0.15 + 0.5 * t; ctx.beginPath(); ctx.arc(x, y, 1.1 + 1.4 * t * t, 0, 6.2832); ctx.fill();
      }
    ctx.globalAlpha = 1;
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const c = ref.current; if (!c) return;
      // 设置里打开"减少动效"后立刻生效，不用刷新
      if (calm()) { if (st.current.on) { st.current.on = false; draw(); } return; }
      const t = e.target as HTMLElement, r = c.getBoundingClientRect();
      st.current = { x: e.clientX - r.left, y: e.clientY - r.top, on: !!t.closest?.('.react-flow__pane') && !t.closest('.react-flow__node') && e.buttons !== 1 };
      draw();
    };
    const leave = () => { st.current.on = false; draw(); };
    window.addEventListener('pointermove', move);
    document.addEventListener('pointerleave', leave);
    return () => { window.removeEventListener('pointermove', move); document.removeEventListener('pointerleave', leave); };
  }, []);
  useOnViewportChange({ onChange: () => draw() });

  return <canvas ref={ref} className="spot" aria-hidden="true" />;
}
