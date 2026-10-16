// 生成队列：记录最近的生成、工具、放大、网格任务，队列面板里查看、取消、重试
import { create } from 'zustand';

export type JobStatus = 'queued' | 'running' | 'done' | 'failed' | 'canceled';
export interface Job {
  id: string;
  nodeId: string;
  title: string;
  /** 做的是什么：生成 2 张、增强、线稿、网格 3/9… */
  label: string;
  kind: 'generate' | 'tool' | 'upscale' | 'grid';
  status: JobStatus;
  error?: string;
  count?: number;
  created: number; started?: number; ended?: number;
  /** 进度文字（来自节点的运行状态） */
  progress?: string;
  retry?: () => void;
  cancel?: () => void;
}

/** failSeen：队列面板里看过的最晚一次失败的结束时间，之后再有失败就在底栏亮红点 */
interface JobState { jobs: Job[]; open: boolean; failSeen: number }
export const useJobs = create<JobState>(() => ({ jobs: [], open: false, failSeen: 0 }));
const set = useJobs.setState, get = useJobs.getState;
let seq = 0;

export function startJob(j: Pick<Job, 'nodeId' | 'title' | 'label' | 'kind'> & Partial<Job>): string {
  const id = `j${Date.now().toString(36)}${(seq++).toString(36)}`;
  const job: Job = { status: 'running', created: Date.now(), started: Date.now(), ...j, id };
  // 只留最近 60 条
  set({ jobs: [job, ...get().jobs].slice(0, 60) });
  return id;
}
export function updateJob(id: string, patch: Partial<Job>) {
  set({ jobs: get().jobs.map(j => (j.id === id ? { ...j, ...patch } : j)) });
}
export function finishJob(id: string, status: Exclude<JobStatus, 'queued' | 'running'>, extra: Partial<Job> = {}) {
  updateJob(id, { status, ended: Date.now(), cancel: undefined, ...extra });
}
export function clearFinished() {
  set({ jobs: get().jobs.filter(j => j.status === 'queued' || j.status === 'running') });
}
export const activeCount = (jobs: Job[]) => jobs.filter(j => j.status === 'queued' || j.status === 'running').length;
