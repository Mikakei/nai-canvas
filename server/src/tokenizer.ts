// Token 计数：V4 / V4.5 用 T5（SentencePiece Unigram），V5 用 Qwen（字节级 BPE）。
// 分词器文件第一次用到时从 Hugging Face 下载，缓存在 data/tokenizers/。
// V5 具体用的是哪个版本的 Qwen 分词器官方没说，这里用 Qwen2.5，结果可能有少量误差
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DATA_DIR } from './config.ts';

export type TokKind = 't5' | 'qwen';
const SOURCES: Record<TokKind, string[]> = {
  t5: ['https://huggingface.co/google-t5/t5-base/resolve/main/tokenizer.json', 'https://hf-mirror.com/google-t5/t5-base/resolve/main/tokenizer.json'],
  qwen: ['https://huggingface.co/Qwen/Qwen2.5-7B-Instruct/resolve/main/tokenizer.json', 'https://hf-mirror.com/Qwen/Qwen2.5-7B-Instruct/resolve/main/tokenizer.json'],
};

async function loadJson(kind: TokKind): Promise<any> {
  const dir = join(DATA_DIR, 'tokenizers'), file = join(dir, `${kind}.json`);
  try { return JSON.parse(await readFile(file, 'utf8')); } catch { /* 还没下载 */ }
  for (const url of SOURCES[kind]) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) continue;
      const text = await res.text();
      const j = JSON.parse(text);
      await mkdir(dir, { recursive: true });
      await writeFile(file, text);
      return j;
    } catch { /* 换下一个地址 */ }
  }
  throw new Error('分词器下载失败');
}

/* ---------- T5：Unigram，按分数做 Viterbi 切分 ---------- */
class Unigram {
  private pieces = new Map<string, number>();
  private maxLen = 1;
  private unkScore: number;
  constructor(j: any) {
    const vocab: [string, number][] = j.model.vocab;
    let min = 0;
    for (const [p, s] of vocab) { this.pieces.set(p, s); if (p.length > this.maxLen) this.maxLen = p.length; if (s < min) min = s; }
    this.unkScore = min - 10;
  }
  count(text: string): number {
    const norm = text.normalize('NFKC').replace(/\s+/g, ' ').trim();
    if (!norm) return 1;
    let n = 0;
    for (const word of norm.split(' ')) n += this.word('▁' + word);
    return n + 1; // 末尾的 </s>
  }
  private word(w: string): number {
    const L = w.length, best = new Array<number>(L + 1).fill(-Infinity), cnt = new Array<number>(L + 1).fill(0);
    best[0] = 0;
    for (let i = 1; i <= L; i++) {
      for (let j = Math.max(0, i - this.maxLen); j < i; j++) {
        if (best[j] === -Infinity) continue;
        const s = this.pieces.get(w.slice(j, i)) ?? (i - j === 1 ? this.unkScore : undefined);
        if (s === undefined) continue;
        if (best[j] + s > best[i]) { best[i] = best[j] + s; cnt[i] = cnt[j] + 1; }
      }
    }
    return cnt[L];
  }
}

/* ---------- Qwen：字节级 BPE ---------- */
function bytesToUnicode(): string[] {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = [...bs];
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  const map: string[] = new Array(256);
  bs.forEach((b, i) => { map[b] = String.fromCodePoint(cs[i]); });
  return map;
}
// Qwen2 的预切分规则；JS 不支持 (?i:...)，所以把缩写写成大小写都匹配
const QWEN_SPLIT = /'(?:[sS]|[tT]|[rR][eE]|[vV][eE]|[mM]|[lL][lL]|[dD])|[^\r\n\p{L}\p{N}]?\p{L}+|\p{N}| ?[^\s\p{L}\p{N}]+[\r\n]*|\s*[\r\n]+|\s+(?!\S)|\s+/gu;
class ByteBpe {
  private ranks = new Map<string, number>();
  private byteMap = bytesToUnicode();
  private cache = new Map<string, number>();
  private enc = new TextEncoder();
  constructor(j: any) {
    (j.model.merges as (string | [string, string])[]).forEach((m, i) => this.ranks.set(Array.isArray(m) ? m.join(' ') : m, i));
  }
  count(text: string): number {
    let n = 0;
    for (const piece of text.normalize('NFC').match(QWEN_SPLIT) ?? []) n += this.piece(piece);
    return n;
  }
  private piece(p: string): number {
    const hit = this.cache.get(p);
    if (hit !== undefined) return hit;
    let parts = [...this.enc.encode(p)].map(b => this.byteMap[b]);
    for (;;) {
      let best = -1, rank = Infinity;
      for (let i = 0; i < parts.length - 1; i++) {
        const r = this.ranks.get(`${parts[i]} ${parts[i + 1]}`);
        if (r !== undefined && r < rank) { rank = r; best = i; }
      }
      if (best < 0) break;
      parts = [...parts.slice(0, best), parts[best] + parts[best + 1], ...parts.slice(best + 2)];
    }
    if (this.cache.size > 20000) this.cache.clear();
    this.cache.set(p, parts.length);
    return parts.length;
  }
}

const loaded: Partial<Record<TokKind, Promise<{ count(t: string): number }>>> = {};
export function tokenizer(kind: TokKind) {
  if (!loaded[kind]) {
    loaded[kind] = loadJson(kind).then(j => (kind === 't5' ? new Unigram(j) : new ByteBpe(j)));
    loaded[kind]!.catch(() => { delete loaded[kind]; });
  }
  return loaded[kind]!;
}
