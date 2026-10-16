import { describe, expect, it } from 'vitest';
import { fmtWeight, parseArtists, serializeArtists, splitTop, wrapStrength } from './index.ts';

const S = '0.6::anteiru ::, 0.8::betanonbeet ::, 0.7::misaka_12003-gou ::, 0.5::sencha_(senta_10) ::, jima';

describe('画师串', () => {
  it('按最外层逗号拆，权重组和括号里的逗号不拆', () => {
    expect(splitTop(S)).toHaveLength(5);
    expect(splitTop('0.8::a, b ::, {c, d}, e')).toEqual(['0.8::a, b ::', '{c, d}', 'e']);
    expect(splitTop(' , a,, b ,')).toEqual(['a', 'b']);
  });
  it('拆出名字和权重', () => {
    const items = parseArtists(S);
    expect(items.map(i => [i.name, i.w])).toEqual([['anteiru', 0.6], ['betanonbeet', 0.8], ['misaka_12003-gou', 0.7], ['sencha_(senta_10)', 0.5], ['jima', 1]]);
    expect(parseArtists('{{a}}, [b], 1.2::c::').map(i => [i.name, i.w])).toEqual([['a', 1.1], ['b', 0.95], ['c', 1.2]]);
  });
  it('没改过的原样拼回去，改过的写成 w::name ::', () => {
    expect(serializeArtists(parseArtists(S))).toBe(S);
    const items = parseArtists('{{a}}, 0.6::b ::, c');
    items[1].w = 0.75; items[2].w = 1.2; items[0].w = 1.1;
    expect(serializeArtists(items)).toBe('{{a}}, 0.75::b ::, 1.2::c ::');
    items[1].w = 1;
    expect(serializeArtists(items)).toBe('{{a}}, b, 1.2::c ::');
  });
  it('整体强度把整串包起来', () => {
    expect(wrapStrength('a, b', 1)).toBe('a, b');
    expect(wrapStrength(' a, b, ', 0.8)).toBe('0.8::a, b ::');
    expect(wrapStrength('', 0.8)).toBe('');
    expect(fmtWeight(0.6000001)).toBe('0.6');
  });
});
