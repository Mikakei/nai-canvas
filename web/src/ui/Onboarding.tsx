import { useState } from 'react';
import { setPrefs, usePrefs } from '../prefs.ts';
import { useStore } from '../store.ts';

const STEPS: { t: string; b: string }[] = [
  { t: '这是一张节点画布', b: '每个卡片是一个节点。双击空白处添加节点，从卡片两侧的 + 拖出连线，把提示词、角色、参考图接到生图节点上。' },
  { t: '写提示词，点「生成」', b: '在左边的「提示词」节点里写想要的画面，它已经接在生图节点上；写好以后点生图节点上红色的「生成」，或者选中生图节点按 Enter。模型、尺寸、步数、种子在「参数」里：点生图卡片最下面那一行（或按 P），参数面板会贴在节点右边打开。' },
  { t: '拿一张图来用', b: '把图片拖进画布或 Ctrl+V 粘贴；接到生图节点就是图生图。结果图上悬停可以局部重绘、增强、放大、做变体。' },
  { t: '还有这些', b: '右键打开菜单，按 ? 看快捷键，Ctrl+F 搜节点。底部工具栏里有片段库、生成队列和图库；Token 和保存位置在右上角的设置里。' },
];

/** 第一次打开时的新手引导，看完或跳过后不再出现（设置里可以重新看） */
export function Onboarding() {
  const done = usePrefs(s => s.onboarded);
  const loaded = useStore(s => s.loaded);
  const dialog = useStore(s => s.dialog);
  const [i, setI] = useState(0);
  if (done || !loaded || dialog) return null;
  const finish = () => { setPrefs({ onboarded: true }); setI(0); };
  const s = STEPS[i];
  return (
    <div className="onboard" role="dialog" aria-label="新手引导">
      <div className="ob-dots">{STEPS.map((_, k) => <i key={k} className={k === i ? 'is-on' : ''} />)}</div>
      <b>{s.t}</b>
      <p>{s.b}</p>
      <div className="ob-acts">
        <button type="button" className="linkish" onClick={finish}>跳过</button>
        <span style={{ flex: 1 }} />
        {i > 0 && <button type="button" className="btn" onClick={() => setI(i - 1)}>上一步</button>}
        {i < STEPS.length - 1 ? <button type="button" className="btn is-primary" onClick={() => setI(i + 1)}>下一步</button>
          : <button type="button" className="btn is-primary" onClick={finish}>开始用</button>}
      </div>
    </div>
  );
}
