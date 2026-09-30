import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      // 基线门禁（2026-09-30 实测）：防回归，不代表目标覆盖率；
      // 提升覆盖率后可同步上调阈值
      thresholds: { statements: 8, branches: 74, functions: 45, lines: 8 },
    },
  },
  resolve: {
    alias: {
      '@mc-creator/core': resolve(__dirname, '../../packages/core/src'),
      '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
});
