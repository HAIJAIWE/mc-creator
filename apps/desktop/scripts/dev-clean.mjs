// 清除可能被沙箱/CI 注入的 NODE_OPTIONS（如 --use-system-ca 会让 electron.exe 直接拒启动），
// 再以纯净环境拉起 electron-vite dev。
// 用法：pnpm dev:clean   （等价于 dev，但不会被 NODE_OPTIONS 绊倒）
import { spawnSync } from 'node:child_process';

delete process.env.NODE_OPTIONS;

const result = spawnSync('pnpm', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  env: process.env,
  shell: true,
});

process.exit(result.status ?? 1);
