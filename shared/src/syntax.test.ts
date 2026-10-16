import { describe, expect, it } from 'vitest';
import { expandMacros, expandRandom, hasRandom, lintPrompt, lintText, macroNames, parsePrompt, quotedRanges, randomPrompt } from './index.ts';

const weightOf = (src: string, word: string) => {
  const at = src.indexOf(word);
  return parsePrompt(src).find(s => s.from <= at && s.to > at)!.weight;
};

describe('强调解析', () => {
  it('花括号每层 ×1.05，方括号每层 ÷1.05', () => {
    expect(weightOf('{{cat}}, dog', 'cat')).toBeCloseTo(1.1025);
    expect(weightOf('{{cat}}, dog', 'dog')).toBe(1);
    expect(weightOf('[hat]', 'hat')).toBeCloseTo(1 / 1.05);
  });
  it('数值权重到下一个 :: 结束', () => {
    const src = '1.5::red hair::, blue eyes';
    expect(weightOf(src, 'red')).toBe(1.5);
    expect(weightOf(src, 'blue')).toBe(1);
    expect(parsePrompt(src)[0]).toMatchObject({ from: 0, to: 5, kind: 'weight-mark' });
  });
  it('负权重', () => {
    expect(weightOf('-1::hat::', 'hat')).toBe(-1);
  });
  it('Text: 之后不解析语法', () => {
    const spans = parsePrompt('1girl, sign, Text: {Hello}');
    expect(spans[spans.length - 1]).toMatchObject({ kind: 'textmode' });
    expect(spans.some(s => s.kind === 'brace')).toBe(false);
  });
  it('识别片段和随机器', () => {
    const spans = parsePrompt('!macro:画风!, ||red|blue|| hair');
    expect(spans[0]).toMatchObject({ kind: 'macro', name: '画风' });
    expect(spans.find(s => s.kind === 'rand')).toBeTruthy();
  });
});

describe('写法检查', () => {
  it('数字和 :: 之间有空格', () => {
    expect(lintPrompt('1.5 ::tag::')[0]).toMatchObject({ level: 'error' });
  });
  it('数字写在 :: 后面', () => {
    expect(lintPrompt('tag::1.5, cat')[0].message).toContain('写在前面');
  });
  it('权重异常大', () => {
    expect(lintPrompt('8::tag::')[0]).toMatchObject({ level: 'warning' });
  });
  it('括号不配对', () => {
    expect(lintPrompt('{cat, dog')[0].message).toContain('没有闭合');
    expect(lintPrompt('cat}')[0].message).toContain('多了');
  });
  it('正确写法没有提示', () => {
    expect(lintPrompt('1.5::red hair::, {{cat}}, [hat], -1::glasses::, Text: 1.5 ::x')).toEqual([]);
  });
});

describe('文字渲染', () => {
  it('V4.5 只能画英文，超过 118 字符提醒', () => {
    expect(lintText('sign, Text: 你好', 'nai-diffusion-4-5-full')[0].message).toContain('只能画英文');
    expect(lintText(`sign, Text: ${'a'.repeat(119)}`, 'nai-diffusion-4-5-full')[0].message).toContain('上限 118');
    expect(lintText('sign, Text: 你好', 'nai-diffusion-5-full')).toEqual([]);
    expect(lintText(`Text: ${'a'.repeat(400)}`, 'nai-diffusion-5-curated')[0].message).toContain('374');
  });
  it('找出 V5 会自动画出来的引号文字', () => {
    expect(quotedRanges('a sign saying "OPEN", 「营业中」, Text: "x"')).toEqual([{ from: 14, to: 20 }, { from: 22, to: 27 }]);
  });
});

describe('随机提示词', () => {
  it('固定随机数时结果固定，且没有重复标签', () => {
    const p = randomPrompt(() => 0);
    expect(p).toBe(randomPrompt(() => 0));
    const tags = p.split(', ');
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe('展开', () => {
  it('片段可以嵌套，循环引用不会死循环', () => {
    const chunks = { a: 'x, !macro:b!', b: 'y', loop: '!macro:loop!' };
    expect(expandMacros('!macro:a!, z', chunks)).toBe('x, y, z');
    expect(expandMacros('!macro:loop!', chunks)).toContain('!macro:loop!');
    expect(expandMacros('!macro:没有这个!', chunks)).toBe('!macro:没有这个!');
    expect(macroNames('!macro:a!, !macro:b!')).toEqual(['a', 'b']);
  });
  it('随机器每处选一个', () => {
    expect(expandRandom('||red|blue|| hair, ||a|b||', () => 0.99)).toBe('blue hair, b');
    expect(expandRandom('||red|blue|| hair', () => 0)).toBe('red hair');
    expect(hasRandom('a || b')).toBe(false);
    expect(hasRandom('||a|b||')).toBe(true);
  });
});
