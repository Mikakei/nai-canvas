// X/Y 网格对比：把生图节点的某个参数换成几种值，排成网格一起看。解析写法、换算成参数改动
import { MODELS, MODEL_KEYS, NOISE_SCHEDULES, SAMPLERS, type ModelKey, type NoiseSchedule, type SamplerId, type UcPreset } from './models.ts';
import type { GenParams } from './params.ts';

export type GridParam = 'none' | 'prompt' | 'seed' | 'steps' | 'scale' | 'cfgRescale' | 'sampler' | 'noise' | 'model' | 'ucPreset' | 'quality' | 'variety' | 'strength';
export const GRID_PARAMS: { id: GridParam; name: string; hint: string }[] = [
  { id: 'none', name: '不用', hint: '' },
  { id: 'prompt', name: '提示词替换', hint: '用 | 分隔：第一个是提示词里已有的词，后面每个都拿来替换它。例：red hair | blue hair | silver hair' },
  { id: 'scale', name: '提示词遵循度', hint: '例：3, 5, 7  或  3-9:2（3 到 9，每次加 2）' },
  { id: 'steps', name: '步数', hint: '例：12, 20, 28' },
  { id: 'sampler', name: '采样器', hint: `例：euler_a, dpmpp_2m。可选：${SAMPLERS.map(s => s.id.replace(/^k_/, '')).join('、')}` },
  { id: 'seed', name: '种子', hint: '例：1, 2, 3（不同种子看稳定性）' },
  { id: 'cfgRescale', name: '遵循度校正', hint: '例：0, 0.3, 0.6' },
  { id: 'noise', name: '噪声计划', hint: `可选：${NOISE_SCHEDULES.join('、')}` },
  { id: 'model', name: '模型', hint: `例：V5 Full, V4.5 Full。可选：${MODEL_KEYS.map(k => MODELS[k].label).join('、')}` },
  { id: 'ucPreset', name: 'UC 预设', hint: '可选：heavy、light、human、furry、none' },
  { id: 'quality', name: '质量标签', hint: '开, 关' },
  { id: 'variety', name: 'Variety+', hint: '开, 关' },
  { id: 'strength', name: '图生图强度', hint: '例：0.3, 0.5, 0.7（要接底图）' },
];
export const gridParamName = (id: GridParam) => GRID_PARAMS.find(p => p.id === id)?.name ?? id;

/** 一个格子要改的东西：参数改动、提示词替换（search → replace） */
export interface AxisValue { label: string; params?: Partial<GenParams>; replace?: [string, string] }

const num = (s: string) => Number(s.trim());
/** "3, 5, 7" 或 "3-9:2"；结果按 step 保留小数 */
function numbers(text: string): number[] | string {
  const out: number[] = [];
  for (const part of text.split(/[,，]/).map(s => s.trim()).filter(Boolean)) {
    const m = /^(-?[\d.]+)\s*[-~到]\s*(-?[\d.]+)(?:\s*[:：]\s*([\d.]+))?$/.exec(part);
    if (m) {
      const a = num(m[1]), b = num(m[2]), st = m[3] ? num(m[3]) : 1;
      if (!(st > 0) || !Number.isFinite(a) || !Number.isFinite(b)) return `「${part}」写法不对`;
      const dec = (m[3] ?? '1').split('.')[1]?.length ?? 0;
      for (let v = Math.min(a, b), k = 0; v <= Math.max(a, b) + 1e-9 && k < 64; v += st, k++) out.push(Number(v.toFixed(dec)));
    } else {
      const v = num(part);
      if (!Number.isFinite(v)) return `「${part}」不是数字`;
      out.push(v);
    }
  }
  return out;
}
const onoff = (s: string) => /^(开|on|true|yes|1|是)$/i.test(s.trim()) ? true : /^(关|off|false|no|0|否)$/i.test(s.trim()) ? false : null;

/** 解析一个坐标轴的值；出错时返回提示 */
export function parseAxis(param: GridParam, text: string, prompt = ''): { values: AxisValue[]; error?: string } {
  if (param === 'none') return { values: [{ label: '' }] };
  const t = text.trim();
  if (!t) return { values: [], error: `${gridParamName(param)}还没填值` };
  const range = (min: number, max: number, int = false) => {
    const ns = numbers(t);
    if (typeof ns === 'string') return ns;
    const bad = ns.find(v => v < min || v > max || (int && !Number.isInteger(v)));
    return bad !== undefined ? `${bad} 超出范围（${min}–${max}${int ? '，整数' : ''}）` : ns;
  };
  let values: AxisValue[] = [];
  switch (param) {
    case 'prompt': {
      const parts = t.split(/[|\n]/).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) return { values: [], error: '至少写两个，用 | 分隔：第一个是要被替换的词' };
      if (prompt && !prompt.includes(parts[0])) return { values: [], error: `提示词里找不到「${parts[0]}」` };
      values = parts.map(p => ({ label: p, replace: [parts[0], p] as [string, string] }));
      break;
    }
    case 'scale': { const r = range(0, 10); if (typeof r === 'string') return { values: [], error: r }; values = r.map(v => ({ label: String(v), params: { scale: v } })); break; }
    case 'cfgRescale': { const r = range(0, 1); if (typeof r === 'string') return { values: [], error: r }; values = r.map(v => ({ label: String(v), params: { cfgRescale: v } })); break; }
    case 'strength': { const r = range(0.01, 0.99); if (typeof r === 'string') return { values: [], error: r }; values = r.map(v => ({ label: String(v), params: { strength: v } })); break; }
    case 'steps': { const r = range(1, 50, true); if (typeof r === 'string') return { values: [], error: r }; values = r.map(v => ({ label: `${v} 步`, params: { steps: v } })); break; }
    case 'seed': { const r = range(0, 4294967295, true); if (typeof r === 'string') return { values: [], error: r }; values = r.map(v => ({ label: `种子 ${v}`, params: { seed: v, seedLocked: true } })); break; }
    case 'sampler': {
      for (const part of t.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean)) {
        const key = part.replace(/^k_/, '').replace(/\s+/g, '_').replace('euler_ancestral', 'euler_a');
        const s = SAMPLERS.find(x => x.id.replace(/^k_/, '') === key || x.id.replace(/^k_/, '').replace('euler_ancestral', 'euler_a') === key || x.label.toLowerCase() === part);
        if (!s) return { values: [], error: `没有「${part}」这个采样器` };
        values.push({ label: s.label, params: { sampler: s.id as SamplerId } });
      }
      break;
    }
    case 'noise': {
      for (const part of t.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean)) {
        const n = NOISE_SCHEDULES.find(x => x === part || x.startsWith(part));
        if (!n) return { values: [], error: `没有「${part}」这个噪声计划` };
        values.push({ label: n, params: { noise: n as NoiseSchedule } });
      }
      break;
    }
    case 'model': {
      for (const part of t.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean)) {
        const k = MODEL_KEYS.find(x => x === part || MODELS[x].label.toLowerCase() === part || MODELS[x].label.toLowerCase().replace(/\s+/g, '') === part.replace(/\s+/g, ''));
        if (!k) return { values: [], error: `没有「${part}」这个模型` };
        values.push({ label: MODELS[k].label, params: { model: k as ModelKey } });
      }
      break;
    }
    case 'ucPreset': {
      for (const part of t.split(/[,，]/).map(s => s.trim().toLowerCase()).filter(Boolean)) {
        if (!['heavy', 'light', 'human', 'furry', 'none'].includes(part)) return { values: [], error: `没有「${part}」这个 UC 预设` };
        values.push({ label: part, params: { ucPreset: part as UcPreset } });
      }
      break;
    }
    case 'quality': case 'variety': {
      for (const part of t.split(/[,，]/).filter(s => s.trim())) {
        const v = onoff(part);
        if (v === null) return { values: [], error: `「${part.trim()}」请写 开 或 关` };
        values.push({ label: v ? '开' : '关', params: { [param]: v } });
      }
      break;
    }
  }
  if (!values.length) return { values: [], error: `${gridParamName(param)}还没填值` };
  if (values.length > 16) return { values: [], error: '一个方向最多 16 个值' };
  return { values };
}

/** 一个格子的改动：两个轴的参数合起来，提示词依次替换 */
export function cellChange(x: AxisValue, y: AxisValue): { params: Partial<GenParams>; prompt: (p: string) => string } {
  const reps = [x.replace, y.replace].filter(Boolean) as [string, string][];
  return { params: { ...x.params, ...y.params }, prompt: p => reps.reduce((s, [a, b]) => (a === b ? s : s.split(a).join(b)), p) };
}

/** 最多跑多少格 */
export const GRID_MAX = 64;
