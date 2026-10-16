// 开发模式：同时启动本地服务（自动重启）和 Vite 前端。加 --mock 时不调用 NovelAI
import { spawn } from 'node:child_process';

const mock = process.argv.includes('--mock');
const env = { ...process.env, ...(mock ? { NAI_MOCK: '1' } : {}) };
const procs = [
  ['server', ['--filter', '@nai/server', 'dev']],
  ['web', ['--filter', '@nai/web', 'dev']],
].map(([name, args]) => {
  const p = spawn('pnpm', args, { env, shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const tag = name === 'server' ? '\x1b[31m[服务]\x1b[0m ' : '\x1b[90m[前端]\x1b[0m ';
  const out = d => process.stdout.write(String(d).split('\n').filter(Boolean).map(l => tag + l + '\n').join(''));
  p.stdout.on('data', out); p.stderr.on('data', out);
  return p;
});
console.log(`开发模式已启动${mock ? '（演示模式）' : ''}：打开 http://localhost:5173`);
const stop = () => { for (const p of procs) p.kill(); process.exit(); };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
