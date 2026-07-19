import { resolve } from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 独立预览 renderer 用的 Vite 配置（不启动 Electron）。
// 通过 transformIndexHtml 注入 window.mcApi 桩，避免点击需要后端的功能时抛错。
// 桩根据被调用的方法名返回合适的默认值（数组 / 对象 / noop），避免组件迭代 undefined 抛错。
const mcApiStub = {
  name: 'mcapi-stub',
  transformIndexHtml() {
    return [
      {
        tag: 'script',
        attrs: { type: 'module' },
        children: `window.mcApi = new Proxy({}, {
          get: (_, prop) => {
            const name = String(prop);
            // 列表类：返回空数组
            if (name === 'listProjects' || name === 'listSessions' || name === 'listResourceFiles') {
              return () => Promise.resolve([]);
            }
            // 单个查询：返回 null
            if (name === 'getProject') return () => Promise.resolve(null);
            // 搜索类：返回带空 hits 的对象
            if (name === 'modrinthSearch' || name === 'curseforgeSearch') {
              return () => Promise.resolve({ hits: [], totalHits: 0, limit: 0, offset: 0 });
            }
            if (name === 'modrinthVersions' || name === 'curseforgeFiles') {
              return () => Promise.resolve([]);
            }
            // CurseForge 配置：返回空 apiKey
            if (name === 'loadCurseForgeConfig') return () => Promise.resolve({ apiKey: '' });
            // 模型配置：返回空配置
            if (name === 'loadModelConfig') return () => Promise.resolve({ name: '', modelId: '', baseURL: '', apiKey: '' });
            // Git 系列返回空数据
            if (name === 'gitLog') return () => Promise.resolve({ log: [] });
            if (name === 'gitBranchList') return () => Promise.resolve({ branches: [], current: '' });
            if (name === 'gitStatus') return () => Promise.resolve({ files: [], ahead: 0, behind: 0, clean: true, branch: 'main' });
            if (name === 'gitDiff') return () => Promise.resolve({ hunks: [] });
            if (name.startsWith('git')) return () => Promise.resolve({ ok: true });
            // 流式 API：直接回调 done
            if (name === 'chatStream' || name === 'explainCode' || name === 'fixSuggest' || name === 'buildStream') {
              return (msg, onChunk) => { try { onChunk('', true); } catch {} return Promise.resolve(); };
            }
            if (name === 'compareModels') {
              return (req, onChunk) => { try { req.models.forEach(m => onChunk({ modelName: m.name, delta: '', done: true })); } catch {} return Promise.resolve(); };
            }
            // 文件对话框：取消
            if (name === 'exportProject' || name === 'importProject' || name === 'exportZip' || name === 'saveFile' || name === 'saveAllFiles' || name === 'gitChooseRepo' || name === 'chooseMcDir' || name === 'importResourceFiles') {
              return () => Promise.resolve({ ok: false, canceled: true, savedPath: null, success: false, error: 'preview' });
            }
            // MC 定位
            if (name === 'locateMc') return () => Promise.resolve({ found: false, mcPath: '' });
            if (name === 'installMod' || name === 'launchMc') return () => Promise.resolve({ ok: false, error: 'preview' });
            // 终端
            if (name === 'terminalSpawn') return () => Promise.resolve({ pid: 0 });
            if (name === 'terminalWrite' || name === 'terminalResize' || name === 'terminalKill') return () => Promise.resolve();
            // 终端事件订阅：必须返回清理函数（不是 Promise），与 TerminalPanel 的 useEffect 期望一致
            if (name === 'onTerminalData' || name === 'onTerminalExit') return () => () => {};
            // 生成类：返回成功但空 spec/files
            if (name === 'generateSpec') return () => Promise.resolve({ ok: true, spec: null });
            if (name === 'generateFiles') return () => Promise.resolve({ ok: true, files: [] });
            if (name === 'build' || name === 'buildWithFix') return () => Promise.resolve({ ok: true, log: '', jarPath: null });
            if (name === 'prepareBuildDir') return () => Promise.resolve({ ok: true, projectPath: '' });
            // 保存类
            if (name === 'saveProject' || name === 'saveModelConfig' || name === 'saveCurseForgeConfig' || name === 'deleteProject') {
              return () => Promise.resolve({ ok: true });
            }
            // 默认：返回带 ok 的对象
            return (..._args) => Promise.resolve({ ok: true, data: [], files: [], projects: [] });
          }
        });`,
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
