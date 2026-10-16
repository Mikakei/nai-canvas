import { describe, expect, it } from 'vitest';
import { cellChange, parseAxis } from './index.ts';

describe('网格对比：解析', () => {
  it('数字：逗号列表和区间写法', () => {
    expect(parseAxis('scale', '3, 5，7').values.map(v => v.params?.scale)).toEqual([3, 5, 7]);
    expect(parseAxis('scale', '3-9:2').values.map(v => v.params?.scale)).toEqual([3, 5, 7, 9]);
    expect(parseAxis('cfgRescale', '0-0.6:0.3').values.map(v => v.params?.cfgRescale)).toEqual([0, 0.3, 0.6]);
    expect(parseAxis('steps', '12, 28').values.map(v => v.label)).toEqual(['12 步', '28 步']);
  });
  it('范围检查', () => {
    expect(parseAxis('scale', '3, 12').error).toMatch(/超出范围/);
    expect(parseAxis('steps', '12.5').error).toMatch(/整数/);
    expect(parseAxis('scale', 'abc').error).toMatch(/不是数字/);
    expect(parseAxis('steps', '').error).toMatch(/还没填/);
  });
  it('采样器、模型、开关', () => {
    expect(parseAxis('sampler', 'euler_a, dpmpp_2m, Euler').values.map(v => v.params?.sampler)).toEqual(['k_euler_ancestral', 'k_dpmpp_2m', 'k_euler']);
    expect(parseAxis('sampler', 'ddim').error).toMatch(/没有/);
    expect(parseAxis('model', 'V5 Full, v45-full').values.map(v => v.params?.model)).toEqual(['v5-full', 'v45-full']);
    expect(parseAxis('quality', '开, 关').values.map(v => v.params?.quality)).toEqual([true, false]);
  });
  it('提示词替换：第一个必须在提示词里', () => {
    const r = parseAxis('prompt', 'red hair | blue hair | silver hair', '1girl, red hair, smile');
    expect(r.values.map(v => v.label)).toEqual(['red hair', 'blue hair', 'silver hair']);
    expect(parseAxis('prompt', 'green eyes | red eyes', '1girl, red hair').error).toMatch(/找不到/);
    expect(parseAxis('prompt', 'only one', '').error).toMatch(/至少/);
  });
  it('两个轴合起来', () => {
    const x = parseAxis('prompt', 'red hair | blue hair', 'red hair, smile').values[1];
    const y = parseAxis('scale', '5').values[0];
    const c = cellChange(x, y);
    expect(c.params).toEqual({ scale: 5 });
    expect(c.prompt('1girl, red hair, smile')).toBe('1girl, blue hair, smile');
    expect(parseAxis('none', '').values).toHaveLength(1);
  });
});
