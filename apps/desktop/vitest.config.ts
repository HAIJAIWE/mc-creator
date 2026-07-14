import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: { globals: true, environment: 'node' },
  resolve: {
    alias: {
      '@mc-creator/core': resolve(__dirname, '../../packages/core/src'),
      '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
      '@renderer': resolve(__dirname, 'src/renderer/src'),
    },
  },
});
