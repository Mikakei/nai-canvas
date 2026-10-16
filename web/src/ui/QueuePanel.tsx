import { useEffect, useState } from 'react';
import { clearFinished, useJobs, type Job } from '../jobs.ts';
import { flow, node, setSelection, useStore } from '../store.ts';
import { ensureVisible } from '../actions.ts';

const STATUS: Record<Job['status'], string> = { queued: '排队中', running: '进行中', done: '完成', failed: '失败', canceled: '已取消' };

function elapsed(j: Job, now: number) {
  const from = j.started ?? j.created, to = j.ended ?? now, s = Math.max(0, Math.round((to - from) / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`;
}

/** 在画布上找到这个任务对应的节点 */
function locate(j: Job) {
  if (!node(j.nodeId)) return;
  setSelection([j.nodeId]);
  const n = node(j.nodeId)!, rf = flow.rf;
  if (rf) { const w = n.measured?.width ?? 300, h = n.measured?.height ?? 300; rf.setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: Math.max(rf.getZoom(), 0.6), duration: 400 }); }
  setTimeout(() => ensureVisible(j.nodeId), 450);
}

/** 生成队列：最近的生成、工具、放大任务；可以取消、重试、定位到节点 */
export function QueuePanel() {
  const open = useStore(s => s.panel === 'queue');
  const jobs = useJobs(s => s.jobs);
  const runtime = useStore(s => s.runtime);
  const [now, setNow] = useState(Date.now());
  const active = jobs.some(j => j.status === 'queued' || j.status === 'running');
  useEffect(() => { if (!open || !active) return; const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, [open, active]);
  // 记下看过的最晚一次失败的时间（按条数记的话，队列满了旧的被挤掉以后就不准了）
  useEffect(() => { if (open) useJobs.setState({ failSeen: jobs.reduce((m, j) => (j.status === 'failed' && (j.ended ?? 0) > m ? j.ended! : m), 0) }); }, [open, jobs]);
  const finished = jobs.filter(j => j.status !== 'queued' && j.status !== 'running').length;
  return (
    <aside className={`side ${open ? 'is-open' : ''}`} aria-label="生成队列" aria-hidden={!open}>
      <div className="insp-head"><span className="ttl">生成队列</span><span className="lab">{jobs.length}</span>
        <button type="button" className="x-btn" aria-label="关闭队列面板" onClick={() => useStore.setState({ panel: null })}>×</button>
      </div>
      <div className="side-tools">
        <span className="note" style={{ flex: 1, alignSelf: 'center' }}>请求一个接一个发给 NovelAI，同时发会被拒绝</span>
        <button type="button" className="btn" disabled={!finished} onClick={clearFinished}>清除已结束</button>
      </div>
      <div className="insp-body">
        {!jobs.length && <p className="note" style={{ lineHeight: 1.7 }}>还没有任务。运行生图节点、图片工具、放大时，都会在这里列出来：排队情况、进度、用时和失败原因。</p>}
        <div className="jobs">
          {jobs.map(j => {
            const rt = runtime[j.nodeId];
            const prog = j.status === 'running' && rt?.status === 'running' && rt.steps ? `${rt.n && rt.n > 1 ? `${(rt.sample ?? 0) + 1}/${rt.n} · ` : ''}${rt.step ?? 0}/${rt.steps} 步` : j.status === 'running' && rt?.label ? rt.label : j.progress;
            return (
              <div key={j.id} className={`job is-${j.status}`}>
                <div className="job-top">
                  <i className="job-dot" />
                  <button type="button" className="job-title" title="在画布上找到这个节点" onClick={() => locate(j)}>{j.title}</button>
                  <span className="job-st">{STATUS[j.status]}</span>
                </div>
                <div className="job-mid">
                  <span>{j.label}{j.count ? ` · ${j.count} 张` : ''}</span>
                  <span className="job-time">{prog ? `${prog} · ` : ''}{elapsed(j, now)}</span>
                </div>
                {j.status === 'running' && rt?.steps ? <div className="job-bar"><i style={{ width: `${Math.round((((rt.sample ?? 0) * rt.steps + (rt.step ?? 0)) / ((rt.n ?? 1) * rt.steps)) * 100)}%` }} /></div> : null}
                {j.error && <div className="job-err">{j.error}</div>}
                <div className="job-acts">
                  {(j.status === 'queued' || j.status === 'running') && j.cancel && <button type="button" onClick={j.cancel}>取消</button>}
                  {(j.status === 'failed' || j.status === 'canceled') && j.retry && <button type="button" onClick={j.retry}>重试</button>}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </aside>
  );
}
