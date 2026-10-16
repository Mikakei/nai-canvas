import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store.ts';
import { Icons } from './controls.tsx';
import { ProjectSwitcher } from './Projects.tsx';
import { setPrefs } from '../prefs.ts';

/** 数字变化时滚动过去 */
function Roll({ value }: { value: number }) {
  const [shown, setShown] = useState(value);
  const from = useRef(value);
  useEffect(() => {
    const a = from.current, b = value, t0 = performance.now();
    if (a === b) return;
    let raf = 0;
    const step = (t: number) => { const k = Math.min(1, (t - t0) / 650), e = 1 - Math.pow(1 - k, 3); setShown(Math.round(a + (b - a) * e)); if (k < 1) raf = requestAnimationFrame(step); else from.current = b; };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span className="num">{shown.toLocaleString('en-US')}</span>;
}

/** Opus 额度：20 个点，每个点 5%，用掉时熄灭并闪一下红 */
function Quota({ percent }: { percent: number }) {
  const on = Math.max(0, Math.min(20, Math.round(percent / 5)));
  const prev = useRef(on);
  const [off, setOff] = useState<number[]>([]);
  useEffect(() => {
    if (on < prev.current) { const gone = Array.from({ length: prev.current - on }, (_, i) => on + i); setOff(gone); setTimeout(() => setOff([]), 900); }
    prev.current = on;
  }, [on]);
  return <span className="quota">{Array.from({ length: 20 }, (_, i) => <i key={i} className={i < on ? 'is-on' : off.includes(i) ? 'is-off' : ''} />)}</span>;
}

export function TopBar() {
  const account = useStore(s => s.account), accountError = useStore(s => s.accountError);
  const saved = useStore(s => s.saved), config = useStore(s => s.config);
  const toggleTheme = () => {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    setPrefs({ theme: cur === 'dark' ? 'light' : 'dark' });
  };
  const needToken = config && !config.mock && !config.hasToken;
  return (
    <div className="hud top">
      <div className="pill">
        <span className="logo">NAI</span><span className="sep" />
        <ProjectSwitcher />
        <span className={`saved opt ${saved === 'saving' ? 'is-busy' : saved === 'fail' ? 'is-fail' : ''}`}>{saved === 'saving' ? '保存中' : saved === 'fail' ? '保存失败' : '已保存'}</span>
        {config?.mock && <span className="badge opt" title="NAI_MOCK=1：不调用 NovelAI，用本地示意图走完整流程">演示模式</span>}
      </div>
      <span className="spacer" />
      {needToken ? (
        <button type="button" className="pill is-warn" onClick={() => useStore.setState({ dialog: 'settings' })}>还没有填 Token，点这里设置</button>
      ) : account ? (
        <>
          <div className="pill" title="Anlas 余额"><span className="lab">ANLAS</span><Roll value={account.anlas} /></div>
          {account.usage && (
            <div className="pill opt" title={`Opus 的 V5 免费额度${account.usage.isNegative ? '：已用完' : ''}`}>
              <span className="lab">OPUS</span><Quota percent={account.usage.percent} /><span className="lab" style={{ color: 'var(--ink-2)' }}>{account.usage.percent}%</span>
            </div>
          )}
        </>
      ) : accountError ? (
        <button type="button" className="pill is-warn" title={accountError} onClick={() => useStore.setState({ dialog: 'settings' })}>无法读取账户</button>
      ) : null}
      <button type="button" className="pill round" aria-label="切换明暗主题" title="切换明暗主题" onClick={toggleTheme}>{Icons.theme}</button>
      <button type="button" className="pill round" aria-label="设置" title="设置" onClick={() => useStore.setState({ dialog: 'settings' })}>{Icons.gear}</button>
    </div>
  );
}
