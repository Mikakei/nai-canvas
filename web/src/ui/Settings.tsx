import { useEffect, useState } from 'react';
import { MODELS, MODEL_KEYS, NAME_FILTERS, NAME_PLACEHOLDERS, type ModelKey } from '@nai/shared';
import { api } from '../api.ts';
import { refreshAccount, refreshConfig, toast, useStore } from '../store.ts';
import { DEFAULT_ARTIST_COVER, DEFAULT_CHAR_COVER, FONT_SCALES, setPrefs, usePrefs, type Theme } from '../prefs.ts';
import { layoutHold, resolveOverlaps } from '../layout.ts';
import { Seg, Switch } from './controls.tsx';

/** 设置页：Token、图片保存、生成、界面 */
export function Settings({ close }: { close: () => void }) {
  const config = useStore(s => s.config);
  const wheel = useStore(s => s.wheel);
  const prefs = usePrefs();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [dir, setDir] = useState(config?.outputDir ?? '');
  const [tpl, setTpl] = useState(config?.fileTemplate ?? '');
  const [preview, setPreview] = useState('');
  const [saveErr, setSaveErr] = useState('');
  useEffect(() => { setDir(config?.outputDir ?? ''); setTpl(config?.fileTemplate ?? ''); }, [config?.outputDir, config?.fileTemplate]);
  // 文件名模板的预览（输入停顿后再请求）
  useEffect(() => {
    const t = setTimeout(() => { api.namePreview(tpl).then(r => setPreview(r.name)).catch(() => setPreview('')); }, 250);
    return () => clearTimeout(t);
  }, [tpl]);

  const saveToken = async (value: string | null) => {
    setBusy(true); setErr('');
    try {
      const r = await api.saveToken(value);
      await refreshConfig(); await refreshAccount();
      setToken('');
      toast(value ? `Token 已保存${r.account ? `，余额 ${r.account.anlas.toLocaleString()} Anlas` : ''}` : '已清除 Token');
    } catch (e) { setErr((e as Error).message); }
    finally { setBusy(false); }
  };
  const saveSettings = async (patch: Parameters<typeof api.saveSettings>[0], ok?: string) => {
    setSaveErr('');
    try { const c = await api.saveSettings(patch); useStore.setState({ config: { ...useStore.getState().config!, ...c } }); if (ok) toast(ok); }
    catch (e) { setSaveErr((e as Error).message); }
  };
  const setWheel = (w: 'pan' | 'zoom') => { useStore.setState({ wheel: w }); try { localStorage.setItem('nai-wheel', w); } catch { /* 忽略 */ } };

  return (
    <div className="dialog is-settings" role="dialog" aria-label="设置">
      <h2>设置<button type="button" className="x-btn" aria-label="关闭" onClick={close}>×</button></h2>
      {config?.mock && <p><b>演示模式</b>：本地服务以 NAI_MOCK=1 启动，生成时不会调用 NovelAI，也不消耗 Anlas。</p>}

      <section>
        <h3>NovelAI Token</h3>
        <p>在官网登录后，进入账号设置 → Account 页面，点 “Get Persistent API Token”，把以 <code>pst-</code> 开头的那串粘贴到下面。Token 只保存在这台电脑的 <code>data\config.json</code> 里，不会进入浏览器，也不会发给 NovelAI 以外的地方。</p>
        {config?.hasToken && <p>当前已保存：<code>{config.tokenHint}</code></p>}
        <form onSubmit={e => { e.preventDefault(); if (token.trim()) saveToken(token.trim()); }} className="srow">
          <input className="input" type="password" autoComplete="off" placeholder={config?.hasToken ? '粘贴新的 Token 以替换' : 'pst-…'} value={token} onChange={e => setToken(e.target.value)} aria-label="Persistent API Token" />
          <button type="submit" className="btn is-primary" disabled={busy || !token.trim()}>{busy ? '验证中…' : '验证并保存'}</button>
          {config?.hasToken && <button type="button" className="btn" disabled={busy} onClick={() => saveToken(null)}>清除</button>}
        </form>
        {err && <div className="form-err">{err}</div>}
      </section>

      <section>
        <h3>图片保存</h3>
        <label className="slabel">输出文件夹</label>
        <div className="srow">
          <input className="input" value={dir} onChange={e => setDir(e.target.value)} aria-label="输出文件夹" spellCheck={false} />
          <button type="button" className="btn" disabled={!dir.trim() || dir === config?.outputDir} onClick={() => saveSettings({ outputDir: dir }, '输出文件夹已更改：之后的图存到新位置，以前的图还能照常打开')}>更改</button>
        </div>
        <div className="row">按日期分文件夹<Switch label="按日期分文件夹" on={config?.dateFolders !== false} onChange={v => saveSettings({ dateFolders: v })} /></div>
        <label className="slabel">文件名模板</label>
        <div className="srow">
          <input className="input" value={tpl} placeholder="{time}_{seed}" onChange={e => setTpl(e.target.value)} aria-label="文件名模板" spellCheck={false} />
          <button type="button" className="btn" disabled={tpl === (config?.fileTemplate ?? '')} onClick={() => saveSettings({ fileTemplate: tpl }, '文件名模板已保存')}>保存</button>
        </div>
        <p className="note">预览：{preview || '…'}</p>
        <details className="sdetails">
          <summary>可以用的写法</summary>
          <div className="phs">{NAME_PLACEHOLDERS.map(([k, d]) => <button key={k} type="button" title={d} onClick={() => setTpl(t => t + k)}><code>{k}</code><span>{d}</span></button>)}</div>
          <p className="note">过滤器写在竖线后面，可以连用：{NAME_FILTERS}。例：<code>{'{prompt|tags:3|pre:-}'}</code></p>
        </details>
        <label className="slabel">图片格式</label>
        <Seg label="图片格式" value={config?.format ?? 'png'} options={[{ v: 'png' as const, l: 'PNG（无损）' }, { v: 'webp' as const, l: 'WebP（更小）' }]} onChange={v => saveSettings({ format: v })} />
        <label className="slabel">透明背景图的 Alpha（V5 透明背景）</label>
        <Seg label="Alpha 模式" value={config?.straightAlpha ? 'straight' : 'premul'} options={[{ v: 'premul' as const, l: 'Premultiplied' }, { v: 'straight' as const, l: 'Straight' }]} onChange={v => saveSettings({ straightAlpha: v === 'straight' })} />
        {saveErr && <div className="form-err">{saveErr}</div>}
      </section>

      <section>
        <h3>生成</h3>
        <div className="row">流式生成（显示中间步骤）<Switch label="流式生成" on={config?.stream !== false} onChange={v => saveSettings({ stream: v })} /></div>
        <p className="note">关掉后用普通请求，等全部画完一次返回。流式连续 3 次失败时会自动改用普通请求。</p>
        <div className="row">输入时联想标签<Switch label="联想标签" on={prefs.tagSuggest} onChange={v => setPrefs({ tagSuggest: v })} /></div>
      </section>

      <section>
        <h3>封面</h3>
        <p className="note">画师串、角色字典里点"生成封面"时用。画师串连着生图节点时跟着那个节点的模型，没连的时候用这里的。尺寸 832×1216、28 步、固定种子，Opus 会员不花 Anlas。</p>
        <label className="slabel">默认模型</label>
        <select className="dd" value={prefs.coverModel} aria-label="封面默认模型" onChange={e => setPrefs({ coverModel: e.target.value as ModelKey })}>
          {MODEL_KEYS.map(k => <option key={k} value={k}>{MODELS[k].label}</option>)}
        </select>
        <label className="slabel">画师串封面的写法</label>
        <div className="srow">
          <input className="input" value={prefs.artistCover} aria-label="画师串封面的写法" spellCheck={false} onChange={e => setPrefs({ artistCover: e.target.value })} />
          <button type="button" className="btn" disabled={prefs.artistCover === DEFAULT_ARTIST_COVER} onClick={() => setPrefs({ artistCover: DEFAULT_ARTIST_COVER })}>恢复默认</button>
        </div>
        <label className="slabel">角色封面的写法</label>
        <div className="srow">
          <input className="input" value={prefs.charCover} aria-label="角色封面的写法" spellCheck={false} onChange={e => setPrefs({ charCover: e.target.value })} />
          <button type="button" className="btn" disabled={prefs.charCover === DEFAULT_CHAR_COVER} onClick={() => setPrefs({ charCover: DEFAULT_CHAR_COVER })}>恢复默认</button>
        </div>
        <p className="note"><code>{'{画师串}'}</code>、<code>{'{角色}'}</code> 会换成实际的内容。</p>
      </section>

      <section>
        <h3>界面</h3>
        <label className="slabel">文字大小</label>
        <Seg label="文字大小" value={prefs.fontScale} options={FONT_SCALES.map(f => ({ v: f, l: `${Math.round(f * 100)}%` }))}
          onChange={v => { layoutHold.until = Date.now() + 1200; setPrefs({ fontScale: v }); setTimeout(resolveOverlaps, 200); }} />
        <label className="slabel">主题</label>
        <Seg label="主题" value={prefs.theme} options={[{ v: 'auto' as Theme, l: '跟随系统' }, { v: 'light' as Theme, l: '浅色' }, { v: 'dark' as Theme, l: '深色' }]} onChange={v => setPrefs({ theme: v })} />
        <label className="slabel">滚轮</label>
        <Seg label="滚轮" value={wheel} options={[{ v: 'pan' as const, l: '平移画布（Ctrl+滚轮缩放）' }, { v: 'zoom' as const, l: '缩放画布' }]} onChange={setWheel} />
        <div className="row">减少动效<Switch label="减少动效" on={prefs.calm} onChange={v => setPrefs({ calm: v })} /></div>
        <div className="srow" style={{ marginTop: 6 }}>
          <button type="button" className="btn" onClick={() => useStore.setState({ dialog: 'keys' })}>快捷键表</button>
          <button type="button" className="btn" onClick={() => { setPrefs({ onboarded: false }); close(); }}>重新看新手引导</button>
        </div>
      </section>

      <p className="note sfoot">数据目录：<code>{config?.dataDir}</code>（画布、片段、Token、风格参考缓存都在这里）</p>
      <div className="actions"><button type="button" className="btn is-primary" onClick={close}>完成</button></div>
    </div>
  );
}
