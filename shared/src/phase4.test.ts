import { describe, expect, it } from 'vitest';
import { buildGenerateRequest, cost, defaultParams, focusRegion, focusSize, inpaintModel, remapCenter } from './index.ts';

describe('局部重绘请求', () => {
  it('有遮罩时 action 为 infill，用重绘模型，不叠原图', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 10, image: 'IMG', mask: 'MASK' });
    expect(r.action).toBe('infill');
    expect(r.model).toBe('nai-diffusion-4-5-full-inpainting');
    expect(r.parameters).toMatchObject({ image: 'IMG', mask: 'MASK', add_original_image: false, extra_noise_seed: 9 });
    expect(r.parameters.img2img).toBeUndefined();
  });
  it('重绘强度不是 1 时附带 img2img', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: { ...defaultParams('v45-full'), inpaintStrength: 0.6 }, seed: 1, image: 'I', mask: 'M' });
    expect(r.parameters.img2img).toEqual({ strength: 0.6, color_correct: true });
  });
  it('重绘时不发风格参考', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 1, image: 'I', mask: 'M', vibes: [{ encoding: 'E', strength: 1 }] });
    expect(r.parameters.reference_image_multiple).toBeUndefined();
  });
  it('聚焦重绘用指定的尺寸', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 1, image: 'I', mask: 'M', size: [1024, 1024] });
    expect([r.parameters.width, r.parameters.height]).toEqual([1024, 1024]);
  });
  it('重绘模型对应关系，V5 Curated 用 V4.5 Curated 的', () => {
    expect(inpaintModel('v5-full', 'high')).toBe('nai-diffusion-5-full-inpainting');
    expect(inpaintModel('v5-full', 'medium')).toBe('nai-diffusion-5-full-medium-inpainting');
    expect(inpaintModel('v5-curated', 'high')).toBe('nai-diffusion-4-5-curated-inpainting');
    expect(inpaintModel('v4-curated', 'high')).toBe('nai-diffusion-4-curated-inpainting');
  });
});

describe('局部重绘计费', () => {
  it('按重绘强度打折', () => {
    const p = { ...defaultParams('v45-full'), steps: 28, inpaintStrength: 0.5 };
    expect(cost(p, null, { inpaint: true }).perImage).toBe(10);
  });
  it('V5 Curated 重绘不乘 1.5', () => {
    const p = { ...defaultParams('v5-curated'), steps: 28 };
    expect(cost(p, null, { inpaint: true }).perImage).toBe(20);
    expect(cost(p, null).perImage).toBe(30);
  });
  it('聚焦重绘按实际尺寸算，1MP 以内 Opus 免费', () => {
    const p = { ...defaultParams('v45-full'), tier: 'large' as const };
    expect(cost(p, { tier: 3, active: true, anlas: 10 }, { inpaint: true, size: [1024, 1024] }).free).toBe(true);
  });
  it('重绘时风格参考不计费', () => {
    expect(cost(defaultParams('v45-full'), null, { inpaint: true, vibes: 6, encodes: 2 }).extra).toBe(0);
  });
});

describe('聚焦区域', () => {
  it('小框扩到最小参照范围，并对齐 8 像素', () => {
    const r = focusRegion({ x: 400, y: 600, w: 50, h: 40 }, 64, 832, 1216);
    expect(r.w).toBe(512); expect(r.h).toBe(512);
    expect(r.x % 8 + r.y % 8).toBe(0);
    expect(r.x).toBeLessThanOrEqual(400); expect(r.x + r.w).toBeGreaterThanOrEqual(450);
  });
  it('靠边时不超出图片', () => {
    const r = focusRegion({ x: 0, y: 0, w: 30, h: 30 }, 64, 832, 1216);
    expect([r.x, r.y, r.w, r.h]).toEqual([0, 0, 512, 512]);
    const b = focusRegion({ x: 800, y: 1200, w: 32, h: 16 }, 96, 832, 1216);
    expect(b.x + b.w).toBeLessThanOrEqual(832); expect(b.y + b.h).toBeLessThanOrEqual(1216);
  });
  it('放大到约 1MP，宽高是 64 的倍数', () => {
    expect(focusSize(512, 512)).toEqual([1024, 1024]);
    const [w, h] = focusSize(400, 600);
    expect(w % 64 + h % 64).toBe(0); expect(w * h).toBeLessThanOrEqual(1048576);
    expect(focusSize(1024, 1024)).toEqual([1024, 1024]);
  });
  it('角色位置换算到聚焦区域', () => {
    expect(remapCenter(0.5, 0.5, { x: 0, y: 0, w: 416, h: 608 }, 832, 1216)).toEqual({ x: 1, y: 1 });
    expect(remapCenter(0.25, 0.25, { x: 0, y: 0, w: 416, h: 608 }, 832, 1216)).toEqual({ x: 0.5, y: 0.5 });
  });
});
