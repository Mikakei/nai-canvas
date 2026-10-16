// 画师串：一串带权重的画师，比如 "0.6::anteiru ::, 0.8::betanonbeet ::, jima"。
// 拆成一行一行（名字 + 权重）方便可视化地调，再拼回去；没动过的那一项保留原来的写法

export interface ArtistItem {
  name: string;
  w: number;
  /** 原来的写法和权重：权重没改时原样拼回去（{}、[] 这类写法不会被改成 w::…::） */
  raw?: string;
  w0?: number;
}

/** 权重写成最短的样子：0.60 → 0.6，1.00 → 1 */
export const fmtWeight = (w: number) => String(Math.round(w * 100) / 100);

/** 按最外层的逗号拆开：w::…:: 权重组、{}、[]、() 里面的逗号不拆 */
export function splitTop(s: string): string[] {
  const out: string[] = [];
  let depth = 0, group = false, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === ':' && s[i + 1] === ':') { group = !group; cur += '::'; i++; continue; }
    if (c === '{' || c === '[' || c === '(') depth++;
    else if ((c === '}' || c === ']' || c === ')') && depth > 0) depth--;
    if (c === ',' && depth === 0 && !group) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(x => x.trim()).filter(Boolean);
}

/** 拆成画师和权重：认 w::name ::、{name}（每层 ×1.05）、[name]（每层 ÷1.05），其他按权重 1 */
export function parseArtists(s: string): ArtistItem[] {
  return splitTop(s).map(raw => {
    const m = /^(-?\d*\.?\d+)::\s*([\s\S]*?)\s*::$/.exec(raw);
    if (m) { const w = parseFloat(m[1]); return { name: m[2], w, raw, w0: w }; }
    const b = /^(\{+)([^{}]+)(\}+)$/.exec(raw);
    if (b && b[1].length === b[3].length) { const w = Math.round(1.05 ** b[1].length * 100) / 100; return { name: b[2].trim(), w, raw, w0: w }; }
    const q = /^(\[+)([^[\]]+)(\]+)$/.exec(raw);
    if (q && q[1].length === q[3].length) { const w = Math.round(1.05 ** -q[1].length * 100) / 100; return { name: q[2].trim(), w, raw, w0: w }; }
    return { name: raw, w: 1, raw, w0: 1 };
  });
}

/** 拼回一串：权重没改的保留原写法，改过的写成 w::name ::（权重 1 就只写名字） */
export function serializeArtists(items: ArtistItem[]): string {
  return items.filter(it => it.name.trim()).map(it => {
    if (it.raw !== undefined && it.w0 !== undefined && Math.abs(it.w - it.w0) < 1e-9) return it.raw;
    return Math.abs(it.w - 1) < 1e-9 ? it.name : `${fmtWeight(it.w)}::${it.name} ::`;
  }).join(', ');
}

/** 整串的整体强度：k 不是 1 时整串包成 k::…:: */
export function wrapStrength(s: string, k: number): string {
  const t = s.trim().replace(/^[\s,]+|[\s,]+$/g, '');
  if (!t) return '';
  return Math.abs(k - 1) < 1e-9 ? t : `${fmtWeight(k)}::${t} ::`;
}
