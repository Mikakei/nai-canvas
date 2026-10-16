import { useEffect, useRef } from 'react';
import { calm } from '../prefs.ts';

/** 空白生图节点里缓慢起伏的点阵 */
export function DotBreath() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    let alive = true, last = 0;
    const draw = (t: number) => {
      if (!alive) return;
      requestAnimationFrame(draw);
      if (t - last < 50 || document.hidden) return;
      last = t;
      const W = c.clientWidth, H = c.clientHeight, dpr = Math.min(2, devicePixelRatio || 1);
      if (!W || !H) return;
      if (c.width !== Math.round(W * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
      const x = c.getContext('2d')!, cs = getComputedStyle(c);
      x.setTransform(dpr, 0, 0, dpr, 0, 0);
      x.fillStyle = cs.getPropertyValue('--surface-2'); x.fillRect(0, 0, W, H);
      x.fillStyle = cs.getPropertyValue('--dot-ui');
      const g = 12, cx = W / 2, cy = H / 2, still = calm();
      for (let yy = g / 2; yy < H; yy += g) for (let xx = g / 2; xx < W; xx += g) {
        const s = still ? 0.4 : 0.5 + 0.5 * Math.sin(t / 700 - Math.hypot(xx - cx, yy - cy) / 34);
        x.beginPath(); x.arc(xx, yy, 0.8 + 1.5 * s * s, 0, 6.2832); x.fill();
      }
    };
    requestAnimationFrame(draw);
    return () => { alive = false; };
  }, []);
  return <canvas ref={ref} aria-hidden="true" />;
}
