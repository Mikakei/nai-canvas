// 文件名模板（FEATURES.md 附录 J）：{占位符|过滤器:参数|…}，例如 {prompt|first:40|pre:-}

export interface NameContext {
  prompt?: string;
  seed?: number;
  date: Date;
  /** 接口里的模型名，比如 nai-diffusion-4-5-full */
  model?: string;
  /** 模型简称，比如 V4.5 Full */
  modelName?: string;
  width?: number; height?: number;
  /** 一批里的第几张（从 0 开始） */
  index?: number;
  id?: string;
  /** 生成类型：generate、img2img、inpaint、enhance、variation、lineart… */
  type?: string;
  characters?: string[];
}

export const NAME_PLACEHOLDERS: [string, string][] = [
  ['{prompt}', '提示词（默认前 80 个字符）'], ['{seed}', '种子'], ['{date}', '日期 2026-10-14'], ['{time}', '时间 153045'],
  ['{model}', '模型 ID'], ['{modelname}', '模型简称'], ['{resolution}', '832x1216'], ['{width}', '宽'], ['{height}', '高'],
  ['{index}', '批次内序号'], ['{id}', '随机编号'], ['{type}', '生成类型'], ['{characters}', '角色'],
];
export const NAME_FILTERS = 'first:N 前 N 个字符 · last:N 后 N 个 · words:N 前 N 个词 · tags:N 前 N 个标签（负数从末尾取）· pre:X / suf:X 加前后缀（值为空时跳过）· pad:N 数字补零 · lower / upper · 角色专用 max:N at:N join:X full';
export const DEFAULT_NAME = '{time}_{seed}';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');

function base(key: string, c: NameContext): string | string[] {
  const d = c.date;
  switch (key) {
    case 'prompt': return c.prompt ?? '';
    case 'seed': return c.seed !== undefined && c.seed >= 0 ? String(c.seed) : '';
    case 'date': return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    case 'time': return `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
    case 'model': return c.model ?? '';
    case 'modelname': return c.modelName ?? '';
    case 'resolution': return c.width && c.height ? `${c.width}x${c.height}` : '';
    case 'width': return c.width ? String(c.width) : '';
    case 'height': return c.height ? String(c.height) : '';
    case 'index': return c.index !== undefined ? String(c.index) : '';
    case 'id': return c.id ?? '';
    case 'type': return c.type ?? '';
    case 'characters': return c.characters ?? [];
    default: return `{${key}}`;
  }
}

/** 角色的第一个标签当名字（"girl, silver hair" → "girl"），full 时用整段 */
const charName = (s: string, full: boolean) => (full ? s : s.split(',')[0]).trim();

function apply(v: string | string[], filters: string[], key: string): string {
  // 角色列表先用角色专用的过滤器变成一个字符串
  if (Array.isArray(v)) {
    let list = v, join = '_', full = false;
    for (const f of filters) {
      const [name, arg = ''] = f.split(':');
      if (name === 'max') list = list.slice(0, Math.max(0, parseInt(arg, 10) || 0));
      else if (name === 'at') { const i = parseInt(arg, 10) || 0; list = list[i] !== undefined ? [list[i]] : []; }
      else if (name === 'join') join = arg;
      else if (name === 'full') full = true;
    }
    v = list.map(s => charName(s, full)).filter(Boolean).join(join);
  }
  let s = v;
  if (key === 'prompt' && !filters.some(f => /^(first|last|words|tags):/.test(f))) s = s.slice(0, 80);
  for (const f of filters) {
    const i = f.indexOf(':'), name = i < 0 ? f : f.slice(0, i), arg = i < 0 ? '' : f.slice(i + 1), n = parseInt(arg, 10);
    switch (name) {
      case 'first': s = s.slice(0, Math.max(0, n || 0)); break;
      case 'last': s = n > 0 ? s.slice(-n) : ''; break;
      case 'words': s = s.split(/\s+/).filter(Boolean).slice(0, Math.max(0, n || 0)).join(' '); break;
      case 'tags': { const t = s.split(',').map(x => x.trim()).filter(Boolean); s = (n >= 0 ? t.slice(0, n) : t.slice(n)).join(', '); break; }
      case 'pre': if (s) s = arg + s; break;
      case 'suf': if (s) s += arg; break;
      case 'pad': if (/^\d+$/.test(s)) s = s.padStart(n || 0, '0'); break;
      case 'lower': s = s.toLowerCase(); break;
      case 'upper': s = s.toUpperCase(); break;
    }
  }
  return s;
}

/** Windows 文件名不能有的字符换成下划线，去掉结尾的点和空格，限制长度 */
export function sanitizeName(s: string, max = 120): string {
  let out = s.replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
  out = out.slice(0, max).replace(/[. ]+$/, '');
  if (/^(con|prn|aux|nul|com\d|lpt\d)$/i.test(out)) out = `_${out}`;
  return out || 'image';
}

/** 按模板生成文件名（不含扩展名） */
export function renderName(template: string, c: NameContext): string {
  const out = (template || DEFAULT_NAME).replace(/\{([a-z]+)((?:\|[^|}]*)*)\}/gi, (_, key: string, rest: string) => {
    const filters = rest ? rest.slice(1).split('|') : [];
    return apply(base(key.toLowerCase(), c), filters, key.toLowerCase());
  });
  return sanitizeName(out);
}
