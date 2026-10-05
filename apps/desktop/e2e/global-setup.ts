/**
 * Playwright 全局前置检查。
 *
 * E2E 打的是**编译产物**（`out/main/index.js` + `out/renderer/index.html`），
 * 不是 vite dev server —— 这是选 Electron E2E 的核心原因（见 playwright.config.ts
 * 文件头）。所以必须先 build。
 *
 * 为什么要在这里 fail fast：缺产物时 Electron 的表现是「进程起来了但永远
 * 不弹窗」，Playwright 只能报 `firstWindow: Timeout 30000ms exceeded`，
 * 排查者会误以为是显示环境问题。直接抛中文提示省掉这层误判。
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const DESKTOP_ROOT = join(__dirname, '..');

/** 缺一不可的产物清单。 */
const REQUIRED_ARTIFACTS = ['out/main/index.js', 'out/preload/index.js', 'out/renderer/index.html'];

export default function globalSetup(): void {
  const missing = REQUIRED_ARTIFACTS.filter((rel) => !existsSync(join(DESKTOP_ROOT, rel)));
  if (missing.length === 0) return;

  throw new Error(
    [
      '[e2e] 缺少编译产物：' + missing.join('、'),
      '[e2e] E2E 打的是 out/ 里的编译产物（真实 Electron 进程），必须先构建：',
      '    pnpm --filter @mc-creator/desktop build',
      '[e2e] 然后再跑：pnpm --filter @mc-creator/desktop test:e2e',
    ].join('\n'),
  );
}
