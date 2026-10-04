import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * packages/ui 的 vitest 配置。
 *
 * 与 apps/desktop/vitest.config.ts 保持一致的关键项：
 * - `environment: 'jsdom'`：组件测试需要 DOM（desktop 侧额外用
 *   `// @vitest-environment jsdom` 单文件覆盖，这里全局启用）
 * - `globals: true`：测试里可直接用 describe/it/expect
 *
 * 额外项：
 * - `setupFiles`：加载 @testing-library/jest-dom 的 vitest 匹配器
 *   （toBeInTheDocument / toHaveAttribute 等）。放在 src/test-setup.ts
 *   而不是 config 里内联字符串，是为了让 tsconfig 的 `include: ["src"]`
 *   也能覆盖到它，从而把 jest-dom 的类型增强注入整个 program。
 * - `esbuild.jsx: 'automatic'` + react 插件：保证 .tsx 走 React 18
 *   automatic runtime（与 apps/desktop/tsconfig.web.json 的
 *   `jsx: react-jsx` 对齐），无需在文件里 import React。
 */
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // 基线门禁：防回归，不代表目标覆盖率。组件库无分支逻辑，
      // 阈值刻意放低，等测试铺开后由主代理统一上调。
      thresholds: { statements: 8, branches: 74, functions: 45, lines: 8 },
    },
  },
});
