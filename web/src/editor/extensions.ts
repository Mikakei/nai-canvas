// 提示词编辑器的 CodeMirror 扩展：语法高亮、写法检查、补全、片段小标签
import { autocompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { usePrefs } from '../prefs.ts';
import { linter, type Diagnostic } from '@codemirror/lint';
import { Facet, RangeSetBuilder, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import { lintPrompt, lintText, parsePrompt, quotedRanges } from '@nai/shared';

export interface EditorEnv {
  /** 当前生图节点用的模型 API 名，用来给标签补全 */
  model: () => string;
  /** 角色提示词：补全里加上 source# / target# / mutual# */
  character: boolean;
  chunks: () => { name: string; color?: string; text: string }[];
}

/* ---------- 片段小标签：!macro:名称! 显示成一个整体的标签 ---------- */
const chunkSource = Facet.define<EditorEnv['chunks'], EditorEnv['chunks']>({ combine: v => v[0] ?? (() => []) });
class MacroWidget extends WidgetType {
  constructor(readonly name: string, readonly color: string | undefined, readonly missing: boolean) { super(); }
  eq(o: MacroWidget) { return o.name === this.name && o.color === this.color && o.missing === this.missing; }
  toDOM(view: EditorView) {
    const el = document.createElement('span');
    // 双击把片段展开成普通文字，方便在这一处单独修改
    el.ondblclick = () => {
      const chunk = view.state.facet(chunkSource)().find(c => c.name === this.name);
      if (!chunk) return;
      const pos = view.posAtDOM(el), tag = `!macro:${this.name}!`;
      if (view.state.sliceDoc(pos, pos + tag.length) === tag) view.dispatch({ changes: { from: pos, to: pos + tag.length, insert: chunk.text } });
    };
    el.className = `cm-p-macro${this.missing ? ' is-missing' : ''}`;
    el.textContent = this.name;
    el.title = this.missing ? `找不到片段「${this.name}」，生成时会原样保留` : `片段「${this.name}」，生成时会展开成它的内容`;
    if (this.color && !this.missing) el.style.setProperty('--chunk', this.color);
    return el;
  }
  ignoreEvent() { return false; }
}

/* ---------- 高亮：按每段的实际权重上色 ---------- */
function decorate(view: EditorView, env: EditorEnv): { marks: DecorationSet; atoms: DecorationSet } {
  const doc = view.state.doc.toString();
  const chunks = new Map(env.chunks().map(c => [c.name, c]));
  const b = new RangeSetBuilder<Decoration>(), a = new RangeSetBuilder<Decoration>();
  for (const s of parsePrompt(doc)) {
    if (s.kind === 'macro' && !s.name!.includes('\n')) {
      const c = chunks.get(s.name!);
      const deco = Decoration.replace({ widget: new MacroWidget(s.name!, c?.color, !c) });
      b.add(s.from, s.to, deco); a.add(s.from, s.to, deco);
      continue;
    }
    let cls = '', style = '';
    if (s.kind === 'brace') cls = 'cm-p-brace';
    else if (s.kind === 'weight-mark') cls = 'cm-p-wmark';
    else if (s.kind === 'separator') cls = 'cm-p-sep';
    else if (s.kind === 'textmode') cls = 'cm-p-textmode';
    else if (s.kind === 'rand') cls = 'cm-p-rand';
    else if (s.weight <= 0) cls = 'cm-p-neg';
    else if (s.weight > 1.001) { cls = 'cm-p-up'; style = `background: color-mix(in srgb, var(--red) ${Math.min(40, Math.round((s.weight - 1) * 60 + 6))}%, transparent)`; }
    else if (s.weight < 0.999) { cls = 'cm-p-down'; style = `opacity: ${Math.max(0.45, 1 - (1 - s.weight) * 2.5).toFixed(2)}`; }
    if (cls) b.add(s.from, s.to, Decoration.mark({ class: cls, attributes: style ? { style } : undefined }));
  }
  const marks = b.finish();
  // V5 会把引号里的文字画进图里：叠一层标记
  if (env.model().startsWith('nai-diffusion-5')) {
    const q = quotedRanges(doc).map(r => Decoration.mark({ class: 'cm-p-quote', attributes: { title: 'V5 会把引号里的文字画进图里' } }).range(r.from, r.to));
    if (q.length) return { marks: marks.update({ add: q, sort: true }), atoms: a.finish() };
  }
  return { marks, atoms: a.finish() };
}

function highlighter(env: EditorEnv): Extension {
  const plugin = ViewPlugin.fromClass(class {
    marks: DecorationSet; atoms: DecorationSet;
    constructor(view: EditorView) { ({ marks: this.marks, atoms: this.atoms } = decorate(view, env)); }
    // 提示词很短，每次有事务都重算；这样片段列表变化时 dispatch 一个空事务就能刷新小标签
    update(u: ViewUpdate) { if (u.docChanged || u.viewportChanged || u.transactions.length) ({ marks: this.marks, atoms: this.atoms } = decorate(u.view, env)); }
  }, { decorations: v => v.marks });
  return [plugin, EditorView.atomicRanges.of(view => view.plugin(plugin)?.atoms ?? Decoration.none)];
}

/* ---------- 写法检查 ---------- */
const promptLinter = (env: EditorEnv) => linter(view => {
  const doc = view.state.doc.toString();
  return [...lintPrompt(doc), ...lintText(doc, env.model())].map((p): Diagnostic => ({ from: p.from, to: Math.max(p.to, p.from + 1), severity: p.level, message: p.message }));
}, { delay: 350 });

/* ---------- 补全 ---------- */
const fmtCount = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const ACTIONS = [
  { label: 'source#', detail: '做动作的一方' },
  { label: 'target#', detail: '被做动作的一方' },
  { label: 'mutual#', detail: '双方一起做' },
];
let warmed = 0;
/** 第一次打字时预热到 NovelAI 的连接（有的网络新建连接要好几秒） */
export function warmUp() {
  if (Date.now() - warmed < 30_000) return;
  warmed = Date.now();
  fetch('/api/warmup', { method: 'POST', headers: { 'x-nai-canvas': '1' } }).catch(() => {});
}

function completions(env: EditorEnv) {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    // @ 开头：插入提示词片段
    const at = ctx.matchBefore(/@[^\s,@!]*$/);
    if (at) {
      const q = at.text.slice(1).toLowerCase();
      const opts = env.chunks().filter(c => !q || c.name.toLowerCase().includes(q)).map((c): Completion => ({
        label: `@${c.name}`, detail: c.text.slice(0, 40), type: 'chunk', apply: `!macro:${c.name}!`,
      }));
      return { from: at.from, options: opts.length ? opts : [{ label: '@', detail: '还没有片段，可以在底部"片段"里新建', apply: '@' }], filter: false };
    }
    // 普通标签：从上一个分隔符到光标
    const word = ctx.matchBefore(/[^,{}\[\]|:!\n]*$/);
    if (!word) return null;
    const lead = word.text.length - word.text.trimStart().length;
    const from = word.from + lead, text = word.text.trim();
    if (text.length < 2 && !ctx.explicit) return null;
    const extra: Completion[] = env.character ? ACTIONS.filter(a => a.label.startsWith(text.toLowerCase().slice(0, 7))).map(a => ({ ...a, type: 'action', boost: 99 })) : [];
    if (!usePrefs.getState().tagSuggest) return extra.length ? { from, options: extra, filter: false } : null;
    await new Promise(r => setTimeout(r, 150));
    if (ctx.aborted) return null;
    let tags: { tag: string; count: number; confidence: number }[] = [];
    try {
      const q = new URLSearchParams({ model: env.model(), prompt: text.replace(/^(source|target|mutual)#/, '') });
      const r = await fetch(`/api/suggest-tags?${q}`, { headers: { 'x-nai-canvas': '1' } });
      tags = ((await r.json()) as { tags?: typeof tags }).tags ?? [];
    } catch { /* 补全失败不影响输入 */ }
    if (ctx.aborted) return null;
    const prefix = text.match(/^(source|target|mutual)#/)?.[0] ?? '';
    const opts: Completion[] = tags.map((t, i) => ({
      label: prefix + t.tag, detail: fmtCount(t.count), type: 'tag', boost: -i,
      confidence: t.confidence,
      apply: (view: EditorView, _c: Completion, f: number, to: number) => {
        const next = view.state.sliceDoc(to, to + 1);
        const insert = prefix + t.tag + (next === ',' ? '' : ', ');
        view.dispatch({ changes: { from: f, to, insert }, selection: { anchor: f + insert.length } });
      },
    } as Completion));
    if (!opts.length && !extra.length) return null;
    return { from, options: [...extra, ...opts], filter: false };
  };
}

export function promptExtensions(env: EditorEnv): Extension[] {
  return [
    chunkSource.of(env.chunks),
    highlighter(env),
    promptLinter(env),
    autocompletion({
      override: [completions(env)],
      activateOnTyping: true,
      icons: false,
      addToOptions: [{
        // 圆点越实，说明模型越熟悉这个标签
        render: (c: Completion & { confidence?: number }) => {
          const dot = document.createElement('span');
          dot.className = 'cm-p-conf';
          if (c.confidence !== undefined) dot.style.opacity = String(Math.max(0.15, Math.min(1, c.confidence)));
          else dot.style.visibility = 'hidden';
          return dot;
        },
        position: 20,
      }],
    }),
  ];
}
