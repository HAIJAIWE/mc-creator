/**
 * Playwright E2E 配置（Electron 真机链路）。
 *
 * ## 为什么是 Electron E2E 而不是「渲染层 + Vite dev server」
 *
 * 仓库里已有 `vite.renderer-preview.config.ts` + `preview:web` 脚本，那条路
 * 确实更容易起，但它给 `window.mcApi` 注入的是一个 **Proxy 桩**：所有 IPC 方法
 * 返回空数组 / `{ok:true}`。也就是说走那条路：
 *
 * - preload 桥（`contextBridge.exposeInMainWorld`）完全没被覆盖；
 * - 主进程一行代码都没跑（project-store / model-config / process-supervisor 全零覆盖）；
 * - 设计文档 §15 要求的「更新器必须 mock」「假实例目录」「不触碰真实外部 API」
 *   在 Proxy 桩下**无法验证**——桩已经把一切都伪造掉了。
 *
 * 而 `electron.launch()` 走的是真实主进程 + 真实 preload，能把
 * 「渲染层 → preload → IPC → 主进程 → 磁盘」整条链路跑通，这才是 E2E 的意义。
 * 代价是要处理真实启动副作用（网络、userData），由 `e2e/fixtures/` 里的
 * 主进程守卫兜住。
 *
 * ## 关键取舍
 *
 * - `workers: 1`：每条用例都会拉起一个完整 Electron 实例（冷启动数秒），
 *   并行只会放大 GPU/内存争抢导致的偶发失败，而这些用例总共只有 7 条，
 *   串行不到 1 分钟。**确定性优先于速度。**
 * - `trace: 'retain-on-failure'`：不是 `on-first-retry`。本地 `retries: 0`，
 *   用 `on-first-retry` 会导致本地一条 trace 都不留，CI 挂了却没现场。
 *   `retain-on-failure` 让每次运行都录制、只在成功时丢弃 —— 排查 E2E
 *   最缺的就是那个「第一次跑就红了」的现场。
 * - `retries: CI ? 2 : 0`：Electron 冷启动在 CI runner 上抖动明显（磁盘 IO、
 *   首次 GPU 进程拉起）。给 2 次重试掩盖基础设施抖动，但配合
 *   `retain-on-failure` 每次重试的现场都会留痕，不会真的把 bug 藏起来。
 */
import { defineConfig } from '@playwright/test';

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: './e2e',
  // 只认 *.e2e.ts：vitest 的默认 include 是 **/*.{test,spec}.*，
  // 两边用文件后缀互不重叠，E2E 文件绝不会被 vitest 误收。
  testMatch: '**/*.e2e.ts',
  // 启动前检查产物存在，缺失时给出可操作的中文提示（而不是让 Electron 静默起不来）
  globalSetup: './e2e/global-setup.ts',
  outputDir: './test-results',

  // 串行：见文件头「关键取舍」
  workers: 1,
  fullyParallel: false,

  // Electron 冷启动 + 首屏懒加载（Monaco / xyflow 拆 chunk）比浏览器重得多
  timeout: 90_000,
  expect: { timeout: 15_000 },

  retries: isCI ? 2 : 0,

  reporter: isCI
    ? [['list'], ['github'], ['html', { open: 'never', outputFolder: './playwright-report' }]]
    : [['list']],

  use: {
    // 见文件头「关键取舍」：本地无重试也必须留 trace
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Electron 的录像要先装 ffmpeg，而失败现场靠 trace + screenshot 已经够了
    video: 'off',
    // Electron 窗口是应用自己创建的，Playwright 的浏览器上下文选项在这里没有意义
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },

  projects: [
    {
      name: 'electron-desktop',
      testIgnore: ['**/global-setup.ts', '**/fixtures/**'],
    },
  ],
});
