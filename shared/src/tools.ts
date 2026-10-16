// Director Tools（官网的图片工具）：去背景、去杂物、线稿、草图、上色、改表情、放大、像素整理。
// 请求格式、尺寸和计费按官网前端代码（2026-10-14 核对），见 FEATURES.md 第 12 节、附录 H / I
import { MAX_PIXELS } from './models.ts';
import { upscaleCost } from './refs.ts';

export type ToolId = 'bg-removal' | 'declutter' | 'lineart' | 'sketch' | 'colorize' | 'emotion' | 'upscale' | 'pixel-snap';

export const TOOLS: { id: ToolId; name: string; desc: string }[] = [
  { id: 'bg-removal', name: '去背景', desc: '去掉背景，只留下人物' },
  { id: 'declutter', name: '去杂物', desc: '去掉画在图上的文字、对话气泡等杂物' },
  { id: 'lineart', name: '线稿', desc: '提取线稿' },
  { id: 'sketch', name: '草图', desc: '退回到草图阶段' },
  { id: 'colorize', name: '上色', desc: '给草图或线稿上色，可以用提示词引导' },
  { id: 'emotion', name: '改表情', desc: '改变角色的表情（只适用于动漫风）' },
  { id: 'upscale', name: '放大', desc: '放大 2 倍' },
  { id: 'pixel-snap', name: '像素整理', desc: '把 AI 画的像素画对齐到像素网格、整理颜色（在本机处理，不花 Anlas）' },
];
export const toolName = (id: ToolId) => TOOLS.find(t => t.id === id)?.name ?? id;

/** 去背景返回三张：抠好的、生成的、混合的 */
export const BG_VARIANTS = ['抠图', '生成', '混合'];

export const EMOTIONS: { id: string; name: string }[] = [
  { id: 'neutral', name: '平静' }, { id: 'happy', name: '开心' }, { id: 'sad', name: '难过' }, { id: 'angry', name: '生气' },
  { id: 'scared', name: '害怕' }, { id: 'surprised', name: '惊讶' }, { id: 'tired', name: '疲惫' }, { id: 'excited', name: '兴奋' },
  { id: 'nervous', name: '紧张' }, { id: 'thinking', name: '思考' }, { id: 'confused', name: '困惑' }, { id: 'shy', name: '害羞' },
  { id: 'disgusted', name: '厌恶' }, { id: 'smug', name: '得意' }, { id: 'bored', name: '无聊' }, { id: 'laughing', name: '大笑' },
  { id: 'irritated', name: '烦躁' }, { id: 'aroused', name: '动情' }, { id: 'embarrassed', name: '尴尬' }, { id: 'worried', name: '担心' },
  { id: 'love', name: '爱慕' }, { id: 'determined', name: '坚定' }, { id: 'hurt', name: '受伤' }, { id: 'playful', name: '调皮' },
];
/** 改表情的强度 0–5（官网的 Normal 到 Weakest），数字越大改得越少 */
export const EMOTION_LEVELS = ['正常', '稍弱', '弱', '更弱', '很弱', '最弱'];

/** 工具的提示词上限（官网按 CLIP 算 75 个 token） */
export const TOOL_TOKEN_LIMIT = 75;
const OPUS_SIZE = 1048576;

/**
 * 发给工具的图片尺寸：超过上限时等比缩小（官网留了 2000 像素余量），
 * 不到约 1MP 的小图放大到约 1MP
 */
export function toolSize(w: number, h: number): [number, number] {
  let W = w, H = h;
  const max = MAX_PIXELS - 2000;
  if (W * H > max) { const s = Math.sqrt(max / (W * H)); W = Math.floor(W * s); H = Math.floor(H * s); }
  if (W * H < 1011712) { const s = Math.sqrt(OPUS_SIZE / (W * H)); W = Math.floor(W * s); H = Math.floor(H * s); }
  return [W, H];
}

/** 官网的工具参数：上色、改表情才有提示词和 defry */
export interface ToolOpts { prompt?: string; defry?: number; emotion?: string; keepBubbles?: boolean }
export function toolRequest(tool: ToolId, image: string, w: number, h: number, o: ToolOpts = {}) {
  const req_type = tool === 'declutter' && o.keepBubbles ? 'declutter-keep-bubbles' : tool;
  const body: Record<string, unknown> = { req_type, image, width: w, height: h };
  if (tool === 'colorize') Object.assign(body, { prompt: o.prompt ?? '', defry: o.defry ?? 0 });
  if (tool === 'emotion') Object.assign(body, { prompt: `${o.emotion ?? 'neutral'};;${o.prompt ?? ''}`, defry: o.defry ?? 0 });
  return body;
}

/**
 * 工具的价格：按 V3 的公式、28 步、处理后的尺寸算；1MP 以内 Opus 免费。
 * 去背景是三倍价钱再加 5，而且不免费；像素整理在本地做，不花钱；放大按像素分档
 */
export function toolCost(tool: ToolId, w: number, h: number, account?: { tier: number; active: boolean } | null): { price: number; free: boolean } | null {
  if (tool === 'pixel-snap') return { price: 0, free: true };
  if (tool === 'upscale') { const c = upscaleCost(w, h); return c === null ? null : { price: c, free: false }; }
  let W = w, H = h;
  if (W * H > MAX_PIXELS) { const s = Math.sqrt(MAX_PIXELS / (W * H)); W = Math.floor(W * s); H = Math.floor(H * s); }
  if (W * H < OPUS_SIZE) { const s = Math.sqrt(OPUS_SIZE / (W * H)); W = Math.floor(W * s); H = Math.floor(H * s); }
  const wh = W * H;
  const base = Math.max(Math.ceil(2.951823174884865e-6 * wh + 5.753298233447344e-7 * wh * 28), 2);
  if (tool === 'bg-removal') return { price: base * 3 + 5, free: false };
  const opus = !account || (account.tier >= 3 && account.active);
  const free = opus && wh <= OPUS_SIZE;
  return { price: free ? 0 : base, free };
}
