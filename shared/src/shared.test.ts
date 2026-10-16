import { describe, expect, it } from 'vitest';
import { buildGenerateRequest, buildNegative, cost, defaultParams, gridCenter, switchEffort, switchModel, withQuality } from './index.ts';

describe('计费公式', () => {
  it('V5 Full 832×1216、28 步、1 张：Opus 免费', () => {
    const p = { ...defaultParams('v5-full'), steps: 28 };
    expect(cost(p, { tier: 3, active: true, anlas: 100 })).toMatchObject({ perImage: 30, total: 0, free: true });
  });
  it('V5 两张：第一张免费，第二张 30', () => {
    const p = { ...defaultParams('v5-full'), steps: 28, nSamples: 2 };
    expect(cost(p, { tier: 3, active: true, anlas: 100 }).total).toBe(30);
  });
  it('V4.5 不乘 1.5', () => {
    const p = { ...defaultParams('v45-full'), steps: 28 };
    expect(cost(p).perImage).toBe(20);
  });
  it('超过 28 步不再免费', () => {
    const p = { ...defaultParams('v5-full'), steps: 29 };
    expect(cost(p, { tier: 3, active: true, anlas: 100 }).free).toBe(false);
  });
  it('超过 1MP 不再免费', () => {
    const p = { ...defaultParams('v5-full'), tier: 'large' as const };
    expect(cost(p, { tier: 3, active: true, anlas: 100 }).free).toBe(false);
  });
  it('非 Opus 不免费', () => {
    expect(cost(defaultParams('v5-full'), { tier: 2, active: true, anlas: 100 }).free).toBe(false);
  });
  it('V5 额度用完时不免费，V4.5 不受影响', () => {
    const acc = { tier: 3, active: true, anlas: 100, usage: { percent: 0, purchasedPercent: 0, isNegative: true, timeUntilNextPercent: 60 } };
    expect(cost(defaultParams('v5-full'), acc).free).toBe(false);
    expect(cost(defaultParams('v45-full'), acc).free).toBe(true);
  });
  it('V5 Medium 用折算系数', () => {
    const hi = cost({ ...defaultParams('v5-full'), steps: 28 });
    const md = cost({ ...defaultParams('v5-full'), steps: 28, effort: 'medium' });
    expect(md.perImage).toBeLessThanOrEqual(hi.perImage);
  });
});

describe('提示词拼接', () => {
  it('质量标签加在末尾，去掉多余逗号', () => {
    expect(withQuality('1girl, ', ', masterpiece')).toBe('1girl, masterpiece');
  });
  it('有 Text: 时质量标签插在它前面', () => {
    expect(withQuality('1girl, sign, Text: Hello', ', masterpiece')).toBe('1girl, sign, masterpiece, Text: Hello');
  });
  it('非 Curated 模型自动加 nsfw', () => {
    expect(buildNegative('1girl', defaultParams('v5-full'))).toMatch(/^nsfw, lowres/);
  });
  it('提示词里已有 nsfw 时不加', () => {
    expect(buildNegative('1girl, nsfw', defaultParams('v5-full'))).toMatch(/^lowres/);
  });
  it('Curated 模型不加 nsfw；自定义 UC 接在预设后面', () => {
    const neg = buildNegative('1girl', { ...defaultParams('v45-curated'), negative: 'bad hands' });
    expect(neg.startsWith('blurry')).toBe(true);
    expect(neg.endsWith(', bad hands')).toBe(true);
  });
  it('不用预设时只有自定义 UC', () => {
    expect(buildNegative('x', { ...defaultParams('v5-full'), ucPreset: 'none', negative: 'abc' })).toBe('abc');
  });
});

describe('请求组装', () => {
  it('V5 Full High', () => {
    const r = buildGenerateRequest({ prompt: '1girl', params: defaultParams('v5-full'), seed: 42 }, true);
    expect(r.model).toBe('nai-diffusion-5-full');
    expect(r.action).toBe('generate');
    expect(r.input).toBe('1girl, very aesthetic, masterpiece, no text');
    expect(r.parameters).toMatchObject({ width: 832, height: 1216, seed: 42, stream: 'sse', noise_schedule: 'karras', skip_cfg_above_sigma: null });
    expect((r.parameters.v4_prompt as any).caption.base_caption).toBe(r.input);
  });
  it('V5 Medium 用 medium 模型，cfg_rescale 固定为 0', () => {
    const p = { ...switchEffort(defaultParams('v5-full'), 'medium'), cfgRescale: 0.5 };
    const r = buildGenerateRequest({ prompt: 'a', params: p, seed: 1 });
    expect(r.model).toBe('nai-diffusion-5-full-medium');
    expect(r.parameters.cfg_rescale).toBe(0);
    expect(r.parameters.stream).toBeUndefined();
  });
  it('V4.5 的 Variety+ 用 58', () => {
    const r = buildGenerateRequest({ prompt: 'a', params: { ...defaultParams('v45-full'), variety: true }, seed: 1 });
    expect(r.parameters.skip_cfg_above_sigma).toBe(58);
  });
  it('角色坐标写进 v4_prompt 和 characterPrompts', () => {
    const c = { prompt: 'girl', uc: 'bad', ...gridCenter(11) };
    const r = buildGenerateRequest({ prompt: 'a', params: defaultParams('v45-full'), seed: 1, characters: [c] });
    expect(gridCenter(11)).toEqual({ x: 0.3, y: 0.5 });
    expect(r.parameters.use_coords).toBe(true);
    expect((r.parameters.v4_prompt as any).caption.char_captions[0]).toEqual({ char_caption: 'girl', centers: [{ x: 0.3, y: 0.5 }] });
    expect((r.parameters.characterPrompts as any)[0].center).toEqual({ x: 0.3, y: 0.5 });
  });
});

describe('切换模型', () => {
  it('V5 → V4.5：默认 CFG 跟着换，关掉不支持的档位', () => {
    const p = switchModel({ ...defaultParams('v5-full'), effort: 'medium' }, 'v45-full');
    expect(p.scale).toBe(5);
    expect(p.effort).toBe('high');
  });
  it('用户改过的 CFG 保留', () => {
    expect(switchModel({ ...defaultParams('v5-full'), scale: 6.3 }, 'v45-full').scale).toBe(6.3);
  });
  it('切到不支持 Variety+ 的模型时关掉它', () => {
    expect(switchModel({ ...defaultParams('v45-full'), variety: true }, 'v5-full').variety).toBe(false);
  });
});
