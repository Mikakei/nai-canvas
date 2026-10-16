// 由 启动.bat 调用：检查环境 → 首次安装依赖 → 构建界面 → 启动本地服务并打开浏览器。
// 中文提示放在这里输出，因为 cmd 读取 .bat 时会把 UTF-8 中文拆坏
import { spawnSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// 整条命令作为一个字符串交给 shell（参数都是固定的），避免 Node 对 shell + 参数数组的弃用警告
const run = (cmd) => spawnSync(cmd, { cwd: root, stdio: 'inherit', shell: true }).status === 0;
const fail = (msg) => { console.error(`\n${msg}\n`); process.exit(1); };

if (spawnSync('pnpm --version', { shell: true, stdio: 'ignore' }).status !== 0) {
  fail('没有找到 pnpm。请在命令行运行：npm install -g pnpm，然后重新双击 启动.bat');
}
if (!existsSync(join(root, 'node_modules'))) {
  console.log('第一次运行，正在安装依赖……');
  if (!run('pnpm install')) fail('安装依赖失败，请把上面的错误信息发给开发者');
}
console.log('正在构建界面……');
if (!run('pnpm build')) fail('构建界面失败，请把上面的错误信息发给开发者');

console.log('\n启动后会自动打开浏览器。关闭这个窗口即可退出。\n');
const server = spawn('pnpm start', { cwd: root, stdio: 'inherit', shell: true, env: { ...process.env, OPEN_BROWSER: process.env.NAI_NO_BROWSER === '1' ? '0' : '1' } });
server.on('exit', code => process.exit(code ?? 0));
