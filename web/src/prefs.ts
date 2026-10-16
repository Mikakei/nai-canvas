// 界面偏好：只跟这台电脑的浏览器有关，存在 localStorage（丢了就回到默认，不影响数据）
import { create } from 'zustand';
import { MODELS, type ModelKey } from '@nai/shared';

export type Theme = 'auto' | 'light' | 'dark';
export interface Prefs {
  theme: Theme;
  /** 输入提示词时联想标签（会请求 NovelAI 的补全接口） */
  tagSuggest: boolean;
  /** 减少动效 */
  calm: boolean;
  /** 新手引导看过了 */
  onboarded: boolean;
  /** 打开过生图节点的参数面板（打开之前"参数"上有个小红点提示） */
  paramsSeen: boolean;
  /** 界面文字大小：所有字号乘以它 */
  fontScale: number;
  /** "生成封面"没连生图节点时用的模型，和封面的固定写法（{画师串}、{角色} 会换成实际内容） */
  coverModel: ModelKey;
  artistCover: string;
  charCover: string;
}
export const FONT_SCALES = [0.9, 1, 1.15, 1.3, 1.45];
export const DEFAULT_ARTIST_COVER = '{画师串}, 1girl, solo, upper body, looking at viewer, simple background';
export const DEFAULT_CHAR_COVER = '{角色}, solo, upper body, looking at viewer, simple background';
const DEF: Prefs = { theme: 'auto', tagSuggest: true, calm: false, onboarded: false, paramsSeen: false, fontScale: 1, coverModel: 'v45-full', artistCover: DEFAULT_ARTIST_COVER, charCover: DEFAULT_CHAR_COVER };

function load(): Prefs {
  try {
    const j = JSON.parse(localStorage.getItem('nai-prefs') ?? '{}') as Partial<Prefs>;
    const t = localStorage.getItem('nai-theme');
    const p = { ...DEF, ...j, theme: t === 'light' || t === 'dark' ? t : j.theme ?? 'auto' };
    if (!FONT_SCALES.includes(p.fontScale)) p.fontScale = 1;
    if (!(p.coverModel in MODELS)) p.coverModel = DEF.coverModel;
    return p;
  } catch { return DEF; }
}

export const usePrefs = create<Prefs>(load);

export function applyPrefs() {
  const p = usePrefs.getState(), root = document.documentElement;
  if (p.theme === 'auto') delete root.dataset.theme; else root.dataset.theme = p.theme;
  root.classList.toggle('is-calm', p.calm);
  root.style.setProperty('--fs', String(p.fontScale));
}
/** 节点宽度跟着文字大小放大的比例（文字放大比例的一半）。新建节点的默认宽度和生图节点的参数卡片用它，已经摆好的节点不动 */
export const widthScale = (fs = usePrefs.getState().fontScale) => 1 + (fs - 1) * 0.5;

export function setPrefs(patch: Partial<Prefs>) {
  usePrefs.setState(patch);
  const p = usePrefs.getState();
  try {
    localStorage.setItem('nai-prefs', JSON.stringify(p));
    // index.html 在页面加载前读这个，避免闪一下
    if (p.theme === 'auto') localStorage.removeItem('nai-theme'); else localStorage.setItem('nai-theme', p.theme);
  } catch { /* 存不了就只在这次有效 */ }
  applyPrefs();
}

/** 系统设置了减少动态效果，或者在设置里打开了"减少动效" */
export const calm = () => usePrefs.getState().calm || matchMedia('(prefers-reduced-motion: reduce)').matches;
