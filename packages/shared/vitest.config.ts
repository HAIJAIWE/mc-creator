import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      // 基线门禁（2026-09-30 实测）：防回归，不代表目标覆盖率；
      // 提升覆盖率后可同步上调阈值
      thresholds: { statements: 22, branches: 53, functions: 15, lines: 22 },
    },
  },
});
