// 提示词语法：强调、数值权重、Text:、随机器、片段。供编辑器高亮、错误检查和生成前展开使用
// 规则来源见 docs/FEATURES.md 第 3、4 节

export type SpanKind = 'text' | 'brace' | 'weight-mark' | 'separator' | 'textmode' | 'rand' | 'macro';
export interface Span {
  from: number;
  to: number;
  kind: SpanKind;
  /** 这段文字的实际强调倍数：{} 每层 ×1.05，[] 每层 ÷1.05，再乘数值权重 */
  weight: number;
  /** 片段名（kind 为 macro 时） */
  name?: string;
}

/** 把提示词切成带权重的片段，供高亮使用 */
export function parsePrompt(src: string): Span[] {
  const spans: Span[] = [];
  let up = 0, down = 0, num = 1, i = 0, textStart = -1;
  const w = () => Math.pow(1.05, up - down) * num;
  const push = (from: number, to: number, kind: SpanKind, extra: Partial<Span> = {}) => {
    if (to <= from) return;
    const last = spans[spans.length - 1];
    if (kind === 'text' && last && last.kind === 'text' && last.to === from && last.weight === w() && !extra.name) last.to = to;
    else spans.push({ from, to, kind, weight: w(), ...extra });
  };
  while (i < src.length) {
    // Text: 之后全部是要画进图里的文字，不再解析语法
    if (src.startsWith('Text:', i) && (i === 0 || /[\s,]/.test(src[i - 1]))) { textStart = i; break; }
    const c = src[i];
    if (src.startsWith('!macro:', i)) {
      const end = src.indexOf('!', i + 7);
      if (end > i + 7) { push(i, end + 1, 'macro', { name: src.slice(i + 7, end) }); i = end + 1; continue; }
    }
    if (src.startsWith('||', i)) {
      const end = src.indexOf('||', i + 2);
      if (end > i) { push(i, end + 2, 'rand'); i = end + 2; continue; }
    }
    if (c === '{') { up++; push(i, i + 1, 'brace'); i++; continue; }
    if (c === '}') { push(i, i + 1, 'brace'); up = Math.max(0, up - 1); i++; continue; }
    if (c === '[') { down++; push(i, i + 1, 'brace'); i++; continue; }
    if (c === ']') { push(i, i + 1, 'brace'); down = Math.max(0, down - 1); i++; continue; }
    if (src.startsWith('::', i)) {
      // 数字紧挨着 :: 时是权重开头；否则是权重结束
      let j = i - 1;
      while (j >= 0 && /[\d.\-]/.test(src[j])) j--;
      const numText = src.slice(j + 1, i);
      if (numText && /^-?\d+(?:\.\d+)?$/.test(numText) && (j < 0 || /[\s,{}\[\]|]/.test(src[j]))) {
        // 把刚才当普通文字处理的数字改成权重标记
        trimText(spans, j + 1);
        num = parseFloat(numText);
        spans.push({ from: j + 1, to: i + 2, kind: 'weight-mark', weight: num });
      } else {
        num = 1;
        push(i, i + 2, 'weight-mark');
      }
      i += 2; continue;
    }
    if (c === ',') { push(i, i + 1, 'separator'); i++; continue; }
    push(i, i + 1, 'text'); i++;
  }
  if (textStart >= 0) spans.push({ from: textStart, to: src.length, kind: 'textmode', weight: 1 });
  return spans;
}

function trimText(spans: Span[], at: number) {
  while (spans.length) {
    const last = spans[spans.length - 1];
    if (last.to <= at) break;
    if (last.kind !== 'text') break;
    if (last.from >= at) spans.pop(); else { last.to = at; break; }
  }
}

export interface Problem { from: number; to: number; level: 'error' | 'warning'; message: string }

/** 三种常见写法错误（FEATURES 第 3 节），再加上括号不配对 */
export function lintPrompt(src: string): Problem[] {
  const out: Problem[] = [];
  const body = src.split(/(?:^|[\s,])Text:/)[0];
  let m: RegExpExecArray | null;
  // 1. 数字和 :: 之间有空格：1.5 ::tag
  const spaced = /(^|[\s,{\[])(-?\d+(?:\.\d+)?)\s+::/g;
  while ((m = spaced.exec(body))) {
    const from = m.index + m[1].length;
    out.push({ from, to: m.index + m[0].length, level: 'error', message: '数字和 :: 之间不能有空格，应写成 1.5::标签::' });
  }
  // 2. 数字写在 :: 后面：tag::1.5（这种写法不会生效）
  const after = /([^\s\d.:\-,])::\s*(-?\d+(?:\.\d+)?)(?=\s*(?:,|$|\s))/g;
  while ((m = after.exec(body))) {
    const from = m.index + 1;
    out.push({ from, to: m.index + m[0].length, level: 'error', message: `权重数字要写在前面：${m[2]}::标签::，写在后面不会生效` });
  }
  // 3. 权重数值异常大
  const weight = /(^|[\s,{\[|])(-?\d+(?:\.\d+)?)::/g;
  while ((m = weight.exec(body))) {
    const v = parseFloat(m[2]);
    if (Math.abs(v) > 5) out.push({ from: m.index + m[1].length, to: m.index + m[0].length, level: 'warning', message: `权重 ${m[2]} 异常大，常用范围大约是 -3 到 3` });
  }
  // 4. 括号不配对
  for (const [o, c, name] of [['{', '}', '花括号'], ['[', ']', '方括号']] as const) {
    let depth = 0, firstOpen = -1;
    for (let i = 0; i < body.length; i++) {
      if (body[i] === o) { if (depth === 0) firstOpen = i; depth++; }
      else if (body[i] === c) {
        if (depth === 0) { out.push({ from: i, to: i + 1, level: 'warning', message: `多了一个右${name}` }); continue; }
        depth--;
      }
    }
    if (depth > 0) out.push({ from: firstOpen, to: firstOpen + 1, level: 'warning', message: `${name}没有闭合，后面的内容都会被加强或减弱` });
  }
  return out.sort((a, b) => a.from - b.from);
}

/** Text: 之后要画进图里的文字的检查（FEATURES 第 3 节）。apiModel 是模型 API 名 */
export function lintText(src: string, apiModel: string): Problem[] {
  const m = /(?:^|[\s,])Text:/.exec(src);
  if (!m) return [];
  const start = m.index + m[0].length, text = src.slice(start).trim();
  const v5 = apiModel.startsWith('nai-diffusion-5'), curated = apiModel.includes('curated');
  const limit = v5 ? (curated ? 374 : 750) : 118;
  const out: Problem[] = [];
  if (text.length > limit) out.push({ from: start, to: src.length, level: 'warning', message: `要画的文字有 ${text.length} 个字符，超过这个模型的上限 ${limit}，多出的部分画不出来` });
  if (!v5 && /[^\x00-\x7f]/.test(text)) out.push({ from: start, to: src.length, level: 'warning', message: 'V4 / V4.5 只能画英文；中文、日文要用 V5' });
  return out;
}

/** V5 会把引号里的内容自动当成要画进图里的文字 */
export function quotedRanges(src: string): { from: number; to: number }[] {
  const body = src.split(/(?:^|[\s,])Text:/)[0];
  return [...body.matchAll(/"[^"\n]+"|“[^”\n]+”|「[^」\n]+」/g)].map(m => ({ from: m.index!, to: m.index! + m[0].length }));
}

/** 展开片段 !macro:名称!（可以嵌套；循环引用时停下并保留原文） */
export function expandMacros(src: string, chunks: Record<string, string>, depth = 0): string {
  if (depth > 8) return src;
  return src.replace(/!macro:([^!]+)!/g, (all, name: string) => (name in chunks ? expandMacros(chunks[name], chunks, depth + 1) : all));
}

/** 展开随机器 ||a|b||：每处随机选一个选项。rand 用来在测试里固定结果 */
export function expandRandom(src: string, rand: () => number = Math.random): string {
  return src.replace(/\|\|([^|][\s\S]*?)\|\|/g, (_all, body: string) => {
    const opts = body.split('|').map(s => s.trim());
    return opts[Math.floor(rand() * opts.length)] ?? '';
  });
}

export const hasRandom = (src: string) => /\|\|[^|][\s\S]*?\|\|/.test(src);
export const macroNames = (src: string) => [...src.matchAll(/!macro:([^!]+)!/g)].map(m => m[1]);
