import { describe, expect, it } from 'vitest';
import {
  applyLocks, buildGenerateRequest, buildPrompt, clampSize, snapToGrid, cost, defaultParams, maxSamples,
  normalizeParams, sizeOf, swapSize, switchEffort, switchModel, withSize,
} from './index.ts';

describe('提示词附加内容', () => {
  it('Furry 模式在开头加 fur dataset，不重复加', () => {
    const p = { ...defaultParams('v45-full'), furry: true, quality: false };
    expect(buildPrompt('1boy', p)).toBe('fur dataset, 1boy');
    expect(buildPrompt('fur dataset, 1boy', p)).toBe('fur dataset, 1boy');
  });
  it('透明背景加在质量标签前面，并带 tag_hint', () => {
    const p = { ...defaultParams('v5-full'), transparent: true };
    const r = buildGenerateRequest({ prompt: '1girl', params: p, seed: 1 });
    expect(r.input).toBe('1girl, transparent background, very aesthetic, masterpiece, no text');
    expect(r.parameters.tag_hint_transparent_background).toBe(true);
  });
  it('V5 质量标签 Light 档', () => {
    expect(buildPrompt('a', { ...defaultParams('v5-full'), qualityLight: true })).toBe('a, very aesthetic, amazing quality, no text');
  });
});

describe('V5 Medium 锁定', () => {
  it('固定 14 步、Euler Ancestral、Heavy、没有自定义 UC', () => {
    const p = applyLocks({ ...defaultParams('v5-full'), effort: 'medium', steps: 40, sampler: 'k_dpmpp_2m', ucPreset: 'light', negative: 'x', cfgRescale: 0.4 });
    expect(p).toMatchObject({ steps: 14, sampler: 'k_euler_ancestral', ucPreset: 'heavy', negative: '', cfgRescale: 0 });
  });
  it('切回 High 时原来的设置都还在', () => {
    const p = { ...defaultParams('v5-full'), steps: 28, sampler: 'k_dpmpp_2m' as const, negative: 'x' };
    const back = switchEffort(switchEffort(p, 'medium'), 'high');
    expect(back).toMatchObject({ steps: 28, sampler: 'k_dpmpp_2m', negative: 'x' });
    expect(applyLocks(switchEffort(p, 'medium')).steps).toBe(14);
  });
});

describe('切换模型', () => {
  it('V4.5 Full 没有 Light 预设，换过去时改成 Heavy', () => {
    expect(switchModel({ ...defaultParams('v45-curated'), ucPreset: 'light' }, 'v45-full').ucPreset).toBe('heavy');
  });
  it('换到 V5 时关掉 Variety+', () => {
    expect(switchModel({ ...defaultParams('v45-full'), variety: true }, 'v5-full').variety).toBe(false);
  });
  it('旧存档缺字段时补默认值，丢掉已不存在的字段', () => {
    const p = normalizeParams({ model: 'v45-full', steps: 30, sm: true } as never);
    expect(p.steps).toBe(30);
    expect(p.tier).toBe('normal');
    expect('sm' in p).toBe(false);
  });
  it('存档里是已移除的 V3 时换成 V5 Full 和它的默认值', () => {
    const p = normalizeParams({ model: 'v3', scale: 5, steps: 28, nSamples: 2 } as never);
    expect(p).toMatchObject({ model: 'v5-full', scale: 7, steps: 23, nSamples: 2 });
  });
  it('角色交给 AI 决定位置时不发坐标', () => {
    const c = { prompt: 'girl', uc: '', x: 0.3, y: 0.5 };
    expect(buildGenerateRequest({ prompt: 'a', params: defaultParams(), seed: 1, characters: [c], aiPositions: true }).parameters.use_coords).toBe(false);
    expect(buildGenerateRequest({ prompt: 'a', params: defaultParams(), seed: 1, characters: [c] }).parameters.use_coords).toBe(true);
  });
  it('角色数量按模型上限截断', () => {
    const cs = Array.from({ length: 8 }, () => ({ prompt: 'x', uc: '', x: 0.5, y: 0.5 }));
    expect((buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 1, characters: cs }).parameters.characterPrompts as unknown[]).length).toBe(6);
  });
});

describe('尺寸与张数', () => {
  it('自定义尺寸取 64 的倍数并限制总像素', () => {
    expect(clampSize(1000, 1000)).toEqual([1024, 1024]);
    const [w, h] = clampSize(4000, 4000);
    expect(w * h).toBeLessThanOrEqual(3145728);
    expect(w % 64 + h % 64).toBe(0);
  });
  it('Wallpaper 没有方形，自动换成竖向', () => {
    const p = withSize({ ...defaultParams(), orient: 'square' }, { tier: 'wallpaper' });
    expect(sizeOf(p)).toEqual([1088, 1920]);
  });
  it('切到自定义时沿用当前尺寸', () => {
    const p = withSize({ ...defaultParams(), orient: 'landscape' }, { tier: 'custom' });
    expect(sizeOf(p)).toEqual([1216, 832]);
  });
  it('交换宽高', () => {
    expect(sizeOf(swapSize(defaultParams()))).toEqual([1216, 832]);
    expect(sizeOf(swapSize(withSize(defaultParams(), { tier: 'custom', width: 640, height: 1280 })))).toEqual([1280, 640]);
  });
  it('张数上限随尺寸变化，改大尺寸时自动减少张数', () => {
    expect(maxSamples(512, 512)).toBe(8);
    expect(maxSamples(640, 640)).toBe(6);
    expect(maxSamples(832, 1216)).toBe(4);
    expect(withSize({ ...defaultParams(), nSamples: 4 }, { tier: 'large' }).nSamples).toBe(1);
  });
});

describe('角色位置', () => {
  it('V4.5 对齐到 5×5 网格，V5 保留原位置', () => {
    const c = { prompt: 'girl', uc: '', x: 0.27, y: 0.62 };
    const v45 = buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 1, characters: [c] });
    expect((v45.parameters.characterPrompts as any)[0].center).toEqual({ x: 0.3, y: 0.7 });
    const v5 = buildGenerateRequest({ prompt: 'a', params: defaultParams('v5-full'), seed: 1, characters: [c] });
    expect((v5.parameters.characterPrompts as any)[0].center).toEqual({ x: 0.27, y: 0.62 });
  });
  it('网格对齐的边界', () => {
    expect([0, 0.05, 0.2, 0.21, 0.5, 0.99, 1].map(snapToGrid)).toEqual([0.1, 0.1, 0.3, 0.3, 0.5, 0.9, 0.9]);
  });
});
