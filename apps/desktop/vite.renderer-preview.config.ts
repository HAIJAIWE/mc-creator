import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 独立预览 renderer 用的 Vite 配置（不启动 Electron）。
// 通过 transformIndexHtml 注入 window.mcApi 桩，避免点击需要后端的功能时抛错。
const mcApiStub = {
  name: 'mcapi-stub',
  transformIndexHtml() {
    return [
      {
        tag: 'script',
        attrs: { type: 'module' },
        children: `window.mcApi = new Proxy({}, { get: () => (..._args) => Promise.resolve({ ok: true, data: [], files: [], projects: [] }) });`,
        injectTo: 'head',
      },
    ];
  },
};

export default defineConfig({
  root: 'src/renderer',
  resolve: {
    alias: {
      '@renderer': resolve(__dirname, 'src/renderer/src'),
      '@mc-creator/shared': resolve(__dirname, '../../packages/shared/src'),
    },
  },
  plugins: [react(), mcApiStub],
  server: {
    port: 5174,
    strictPort: false,
  },
});
