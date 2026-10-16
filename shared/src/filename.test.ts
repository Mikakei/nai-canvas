import { describe, expect, it } from 'vitest';
import { renderName, sanitizeName } from './index.ts';

const date = new Date(2026, 9, 14, 15, 30, 45);
const ctx = { prompt: '1girl, silver hair, raincoat, standing in the rain', seed: 1234, date, model: 'nai-diffusion-4-5-full', modelName: 'V4.5 Full', width: 832, height: 1216, index: 2, type: 'generate', characters: ['girl, silver hair', 'boy, black hair'] };

describe('文件名模板', () => {
  it('默认：时间_种子', () => {
    expect(renderName('', ctx)).toBe('153045_1234');
  });
  it('占位符', () => {
    expect(renderName('{date}_{modelname}_{resolution}_{index|pad:3}', ctx)).toBe('2026-10-14_V4.5 Full_832x1216_002');
  });
  it('提示词过滤器', () => {
    expect(renderName('{prompt|tags:2}', ctx)).toBe('1girl, silver hair');
    expect(renderName('{prompt|tags:-1}', ctx)).toBe('standing in the rain');
    expect(renderName('{prompt|words:1}', ctx)).toBe('1girl,');
    expect(renderName('{prompt|first:5|upper}', ctx)).toBe('1GIRL');
  });
  it('前后缀：值为空时跳过', () => {
    expect(renderName('a{seed|pre:-}', ctx)).toBe('a-1234');
    expect(renderName('a{seed|pre:-}', { ...ctx, seed: -1 })).toBe('a');
  });
  it('角色列表', () => {
    expect(renderName('{characters}', ctx)).toBe('girl_boy');
    expect(renderName('{characters|max:1}', ctx)).toBe('girl');
    expect(renderName('{characters|at:1|full}', ctx)).toBe('boy, black hair');
    expect(renderName('{characters|join:+}', ctx)).toBe('girl+boy');
  });
  it('不合法的字符和保留名', () => {
    expect(sanitizeName('a/b:c*?"<>|d. ')).toBe('a_b_c______d');
    expect(sanitizeName('CON')).toBe('_CON');
    expect(sanitizeName('')).toBe('image');
    expect(renderName('{prompt}', { ...ctx, prompt: 'x'.repeat(200) })).toHaveLength(80);
  });
});
