import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

const workspacePkgs = ['@mc-creator/core', '@mc-creator/shared'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: {
      alias: {
        '@mc-creator/core': resolve(__dirname, '../../packages/core/src'),
        '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: workspacePkgs })],
    resolve: {
      alias: {
        '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer/src'),
        '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
      },
    },
    plugins: [react()],
  },
});
