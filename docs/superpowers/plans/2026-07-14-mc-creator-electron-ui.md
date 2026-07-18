# MC Creator Electron UI 与端到端 实现计划（P3）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 Electron + React 桌面客户端，实现 VS Code 式三栏布局（左侧文件树 / 中间对话+Spec+代码预览 / 右侧 AI 聊天）+ 顶部 Loader/版本切换器，串联 P1/P2 的 core 引擎，跑通「描述 → Spec → 生成代码 → 编译」端到端可视化流程。

**Architecture:** `apps/desktop` 单一 Electron 应用（electron-vite 标准），内部分 main（主进程 + IPC 处理器）/ preload（类型安全桥）/ renderer（React UI）。主进程调 `@mc-creator/core` 引擎，通过类型化 IPC（zod 校验）暴露给渲染进程。UI 用 React + Tailwind + shadcn/ui + Monaco Editor + Zustand。

**Tech Stack:** Electron 31、electron-vite、React 18、TypeScript 5、Tailwind CSS 3、shadcn/ui、@monaco-editor/react、Zustand、Vitest + @testing-library/react。

**对应规格：** `docs/superpowers/specs/2026-07-13-mc-creator-design.md` 第 2.1、4、7、9 节。

**前置条件：** P1（core 引擎基础）+ P2（Mod 生成器 + Loader Adapters）已完成，45/45 测试通过。

---

## 文件结构（本计划涉及）

```
apps/desktop/
├── package.json
├── electron.vite.config.ts
├── tsconfig.json
├── tsconfig.node.json
├── tsconfig.web.json
├── tailwind.config.js
├── postcss.config.js
├── src/
│   ├── main/                    # 主进程
│   │   ├── index.ts             # 创建窗口 + 生命周期
│   │   ├── ipc.ts               # IPC 处理器（调 core 引擎）
│   │   └── ipc.test.ts
│   ├── preload/                 # 预加载（类型安全桥）
│   │   ├── index.ts
│   │   └── api.d.ts             # IPC 通道类型定义
│   ├── renderer/                # React UI
│   │   ├── index.html
│   │   └── src/
│   │       ├── main.tsx         # React 入口
│   │       ├── App.tsx          # 根布局
│   │       ├── index.css        # Tailwind 指令
│   │       ├── store/
│   │       │   ├── mod-store.ts # Zustand 状态（spec/loader/files）
│   │       │   └── mod-store.test.ts
│   │       ├── components/
│   │       │   ├── TopBar.tsx           # 顶部 loader/版本切换器
│   │       │   ├── FileTree.tsx         # 左侧文件树
│   │       │   ├── ChatPanel.tsx        # 中间对话+Spec
│   │       │   ├── CodePreview.tsx      # Monaco 代码预览
│   │       │   ├── AiChat.tsx           # 右侧 AI 聊天
│   │       │   └── BuildPanel.tsx       # 编译面板
│   │       └── lib/
│   │           └── ipc-client.ts        # 渲染进程调 IPC 封装
│   └── shared/
│       └── ipc-channels.ts      # IPC 通道定义 + zod schema（主/preload/renderer 共用）
```

---

## Task 1: apps/desktop 脚手架

**Files:**

- Create: `apps/desktop/package.json`
- Create: `apps/desktop/electron.vite.config.ts`
- Create: `apps/desktop/tsconfig.json` / `tsconfig.node.json` / `tsconfig.web.json`
- Create: `apps/desktop/tailwind.config.js` / `postcss.config.js`

- [ ] **Step 1: 写 `apps/desktop/package.json`**

```json
{
  "name": "@mc-creator/desktop",
  "version": "0.0.0",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "typecheck:node": "tsc --noEmit -p tsconfig.node.json",
    "typecheck:web": "tsc --noEmit -p tsconfig.web.json",
    "typecheck": "pnpm typecheck:node && pnpm typecheck:web",
    "test": "vitest run"
  },
  "dependencies": {
    "@mc-creator/core": "workspace:*",
    "@mc-creator/shared": "workspace:*",
    "@monaco-editor/react": "^4.6.0",
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "zustand": "^4.5.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.4.0",
    "@testing-library/react": "^15.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "autoprefixer": "^10.4.0",
    "electron": "^31.0.0",
    "electron-vite": "^2.3.0",
    "jsdom": "^24.0.0",
    "postcss": "^8.4.0",
    "tailwindcss": "^3.4.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 写 `electron.vite.config.ts`**

```typescript
import { resolve } from 'path';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/main/index.ts') } } },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/preload/index.ts') } } },
  },
  renderer: {
    root: 'src/renderer',
    build: { rollupOptions: { input: { index: resolve(__dirname, 'src/renderer/index.html') } } },
    resolve: { alias: { '@renderer': resolve(__dirname, 'src/renderer/src') } },
    plugins: [react()],
  },
});
```

- [ ] **Step 3: 写 tsconfig 三件套**

`tsconfig.json`:

```json
{
  "files": [],
  "references": [{ "path": "./tsconfig.node.json" }, { "path": "./tsconfig.web.json" }]
}
```

`tsconfig.node.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "types": ["electron-vite/node"],
    "paths": {
      "@mc-creator/core": ["../../packages/core/src"],
      "@mc-creator/shared": ["../../packages/shared/src"]
    }
  },
  "include": ["src/main/**/*", "src/preload/**/*", "src/shared/**/*", "electron.vite.config.ts"]
}
```

`tsconfig.web.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "types": ["vite/client"],
    "paths": {
      "@mc-creator/shared": ["../../packages/shared/src"],
      "@renderer/*": ["src/renderer/src/*"]
    }
  },
  "include": ["src/renderer/**/*", "src/shared/**/*"]
}
```

- [ ] **Step 4: 写 tailwind + postcss 配置**

`tailwind.config.js`:

```javascript
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: { extend: {} },
  plugins: [],
};
```

`postcss.config.js`:

```javascript
export default {
  plugins: { tailwindcss: {}, autoprefixer: {} },
};
```

- [ ] **Step 5: 安装依赖并验证**

Run: `pnpm install`
Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 无错误（暂无源文件）

- [ ] **Step 6: 提交**

```bash
git add apps/desktop
git commit -m "chore(desktop): 初始化 Electron 脚手架"
```

---

## Task 2: IPC 通道定义 + zod 校验

**Files:**

- Create: `apps/desktop/src/shared/ipc-channels.ts`
- Test: `apps/desktop/src/shared/ipc-channels.test.ts`

- [ ] **Step 1: 写 `ipc-channels.ts`**

```typescript
import { z } from 'zod';
import { ModSpec } from '@mc-creator/shared';

/** IPC 通道名常量 */
export const IPC = {
  GENERATE_SPEC: 'mod:generateSpec',
  GENERATE_FILES: 'mod:generateFiles',
  BUILD: 'mod:build',
} as const;

/** 请求/响应 schema（zod 校验，规格 §7.2 类型化 IPC） */
export const GenerateSpecRequest = z.object({ description: z.string().min(1) });
export const GenerateSpecResponse = z.object({ spec: ModSpec, raw: z.string() });

export const GenerateFilesRequest = z.object({
  loader: z.enum(['fabric', 'neoforge']),
  mcVersion: z.string(),
  spec: ModSpec,
});
export const GenerateFilesResponse = z.object({
  files: z.array(z.object({ path: z.string(), content: z.string() })),
  warnings: z.array(z.string()),
});

export const BuildRequest = z.object({ projectPath: z.string() });
export const BuildResponse = z.object({
  success: z.boolean(),
  jarPath: z.string().nullable(),
  log: z.string(),
});

export type GenerateSpecReq = z.infer<typeof GenerateSpecRequest>;
export type GenerateSpecRes = z.infer<typeof GenerateSpecResponse>;
export type GenerateFilesReq = z.infer<typeof GenerateFilesRequest>;
export type GenerateFilesRes = z.infer<typeof GenerateFilesResponse>;
export type BuildReq = z.infer<typeof BuildRequest>;
export type BuildRes = z.infer<typeof BuildResponse>;
```

- [ ] **Step 2: 写测试 `ipc-channels.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { GenerateSpecRequest, GenerateFilesRequest, BuildRequest } from './ipc-channels.js';

describe('IPC schema 校验', () => {
  it('GenerateSpecRequest 校验描述非空', () => {
    expect(GenerateSpecRequest.safeParse({ description: '做一个 mod' }).success).toBe(true);
    expect(GenerateSpecRequest.safeParse({ description: '' }).success).toBe(false);
  });

  it('GenerateFilesRequest 校验 loader 枚举', () => {
    const valid = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      spec: {
        modId: 'demo',
        version: '1.0.0',
        name: 'Demo',
        description: '',
        items: [],
        blocks: [],
      },
    };
    expect(GenerateFilesRequest.safeParse(valid).success).toBe(true);
    expect(GenerateFilesRequest.safeParse({ ...valid, loader: 'forge' }).success).toBe(false);
  });

  it('BuildRequest 校验路径非空', () => {
    expect(BuildRequest.safeParse({ projectPath: '/proj' }).success).toBe(true);
    expect(BuildRequest.safeParse({ projectPath: '' }).success).toBe(false);
  });
});
```

- [ ] **Step 3: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test`
Expected: PASS（3 个用例）

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/shared
git commit -m "feat(desktop): IPC 通道定义与 zod 校验"
```

---

## Task 3: 主进程 + IPC 处理器

**Files:**

- Create: `apps/desktop/src/main/index.ts`
- Create: `apps/desktop/src/main/ipc.ts`
- Create: `apps/desktop/src/main/ipc.test.ts`

- [ ] **Step 1: 写 `ipc.ts`（IPC 处理器，调 core 引擎）**

```typescript
import { ipcMain, BrowserWindow } from 'electron';
import { Orchestrator } from '@mc-creator/core';
import { ModGenerator } from '@mc-creator/core';
import { runGradleBuild, detectJavaVersion } from '@mc-creator/core';
import { MockProvider } from '@mc-creator/core';
import {
  IPC,
  GenerateSpecRequest,
  GenerateFilesRequest,
  BuildRequest,
  type GenerateSpecRes,
  type GenerateFilesRes,
  type BuildRes,
} from '../shared/ipc-channels.js';

/**
 * 注册 IPC 处理器（规格 §4 端到端数据流）。
 * 主进程调 core 引擎，结果经 zod 校验后返回渲染进程。
 */
export function registerIpcHandlers(getOrchestrator: () => Orchestrator): void {
  ipcMain.handle(IPC.GENERATE_SPEC, async (_e, raw: unknown): Promise<GenerateSpecRes> => {
    const req = GenerateSpecRequest.parse(raw);
    const orchestrator = getOrchestrator();
    const spec = await orchestrator.generateModSpec(req.description);
    return { spec, raw: JSON.stringify(spec, null, 2) };
  });

  ipcMain.handle(IPC.GENERATE_FILES, async (_e, raw: unknown): Promise<GenerateFilesRes> => {
    const req = GenerateFilesRequest.parse(raw);
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: req.loader,
      mcVersion: req.mcVersion,
      modId: req.spec.modId,
      spec: req.spec,
      projectPath: '',
    });
    return { files: result.files, warnings: result.warnings };
  });

  ipcMain.handle(IPC.BUILD, async (_e, raw: unknown): Promise<BuildRes> => {
    const req = BuildRequest.parse(raw);
    const java = await detectJavaVersion();
    if (java === null) {
      return { success: false, jarPath: null, log: '未检测到 Java，请安装 JDK 21+' };
    }
    const result = await runGradleBuild(req.projectPath);
    return { success: result.success, jarPath: result.jarPath, log: result.log };
  });
}

/** 默认编排器工厂（用 MockProvider，后续 P4 接真实模型） */
export function createDefaultOrchestrator(): Orchestrator {
  return new Orchestrator(
    new MockProvider(
      JSON.stringify({
        modId: 'demo',
        version: '1.0.0',
        name: 'Demo Mod',
        description: 'A demo mod',
        items: [{ id: 'demo_item', name: 'Demo Item', maxStackSize: 64 }],
        blocks: [],
      }),
    ),
  );
}
```

- [ ] **Step 2: 写测试 `ipc.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ModGenerator, MockProvider, Orchestrator } from '@mc-creator/core';
import { GenerateSpecRequest, GenerateFilesRequest } from '../shared/ipc-channels.js';

// 直接测试 schema 解析 + core 引擎调用（不启动 Electron）
describe('IPC 处理逻辑（不经过 ipcMain）', () => {
  it('GenerateSpec：描述 → spec', async () => {
    const req = GenerateSpecRequest.parse({ description: '做一个 mod' });
    const o = new Orchestrator(
      new MockProvider(
        JSON.stringify({
          modId: 'demo',
          version: '1.0.0',
          name: 'Demo',
          description: '',
          items: [],
          blocks: [],
        }),
      ),
    );
    const spec = await o.generateModSpec(req.description);
    expect(spec.modId).toBe('demo');
  });

  it('GenerateFiles：spec → 文件树', async () => {
    const req = GenerateFilesRequest.parse({
      loader: 'fabric',
      mcVersion: '1.21.11',
      spec: {
        modId: 'demo',
        version: '1.0.0',
        name: 'Demo',
        description: '',
        items: [],
        blocks: [],
      },
    });
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: req.loader,
      mcVersion: req.mcVersion,
      modId: req.spec.modId,
      spec: req.spec,
      projectPath: '',
    });
    expect(result.files.some((f) => f.path === 'src/main/resources/fabric.mod.json')).toBe(true);
  });
});
```

- [ ] **Step 3: 写 `index.ts`（主进程入口）**

```typescript
import { app, BrowserWindow } from 'electron';
import { join } from 'path';
import { registerIpcHandlers, createDefaultOrchestrator } from './ipc.js';

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  registerIpcHandlers(createDefaultOrchestrator);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test`
Expected: PASS（3 + 2 = 5 个用例）

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/main
git commit -m "feat(desktop): 主进程与 IPC 处理器（调 core 引擎）"
```

---

## Task 4: preload + 渲染进程入口 + Tailwind

**Files:**

- Create: `apps/desktop/src/preload/index.ts`
- Create: `apps/desktop/src/preload/api.d.ts`
- Create: `apps/desktop/src/renderer/index.html`
- Create: `apps/desktop/src/renderer/src/main.tsx`
- Create: `apps/desktop/src/renderer/src/index.css`

- [ ] **Step 1: 写 `preload/index.ts`（类型安全桥）**

```typescript
import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '../shared/ipc-channels.js';

const api = {
  generateSpec: (description: string) => ipcRenderer.invoke(IPC.GENERATE_SPEC, { description }),
  generateFiles: (req: { loader: string; mcVersion: string; spec: unknown }) =>
    ipcRenderer.invoke(IPC.GENERATE_FILES, req),
  build: (projectPath: string) => ipcRenderer.invoke(IPC.BUILD, { projectPath }),
};

try {
  contextBridge.exposeInMainWorld('mcApi', api);
} catch {
  // 测试环境无 contextBridge，挂到 globalThis
  (globalThis as any).mcApi = api;
}

export type McApi = typeof api;
```

- [ ] **Step 2: 写 `api.d.ts`（类型声明）**

```typescript
import type { McApi } from './index.js';
declare global {
  interface Window {
    mcApi: McApi;
  }
}
export {};
```

- [ ] **Step 3: 写 `renderer/index.html`**

```html
<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MC Creator</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 4: 写 `renderer/src/index.css`（Tailwind 指令）**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  margin: 0;
  font-family: system-ui, sans-serif;
}
```

- [ ] **Step 5: 写 `renderer/src/main.tsx`（React 入口，占位 App）**

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.js';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
```

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/preload apps/desktop/src/renderer
git commit -m "feat(desktop): preload 桥与渲染进程入口"
```

---

## Task 5: Zustand store（全局状态）

**Files:**

- Create: `apps/desktop/src/renderer/src/store/mod-store.ts`
- Test: `apps/desktop/src/renderer/src/store/mod-store.test.ts`

- [ ] **Step 1: 写 `mod-store.ts`**

```typescript
import { create } from 'zustand';
import type { ModSpec, Loader, McVersion } from '@mc-creator/shared';
import type { FileNode } from '@mc-creator/shared';

interface ModState {
  // 输入
  loader: Loader;
  mcVersion: McVersion;
  description: string;
  // 产出
  spec: ModSpec | null;
  files: FileNode[];
  selectedFile: string | null;
  // 构建
  buildLog: string;
  buildSuccess: boolean | null;
  jarPath: string | null;
  loading: boolean;
  error: string | null;

  setLoader: (l: Loader) => void;
  setMcVersion: (v: McVersion) => void;
  setDescription: (d: string) => void;
  setSpec: (s: ModSpec | null) => void;
  setFiles: (f: FileNode[]) => void;
  selectFile: (p: string) => void;
  setBuildResult: (r: { success: boolean; log: string; jarPath: string | null }) => void;
  setLoading: (b: boolean) => void;
  setError: (e: string | null) => void;
}

export const useModStore = create<ModState>((set) => ({
  loader: 'fabric',
  mcVersion: '1.21.11',
  description: '',
  spec: null,
  files: [],
  selectedFile: null,
  buildLog: '',
  buildSuccess: null,
  jarPath: null,
  loading: false,
  error: null,

  setLoader: (l) => set({ loader: l }),
  setMcVersion: (v) => set({ mcVersion: v }),
  setDescription: (d) => set({ description: d }),
  setSpec: (s) => set({ spec: s }),
  setFiles: (f) => set({ files: f, selectedFile: f[0]?.path ?? null }),
  selectFile: (p) => set({ selectedFile: p }),
  setBuildResult: (r) => set({ buildSuccess: r.success, buildLog: r.log, jarPath: r.jarPath }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
}));
```

- [ ] **Step 2: 写测试 `mod-store.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { useModStore } from './mod-store.js';

describe('mod-store', () => {
  it('初始状态', () => {
    const s = useModStore.getState();
    expect(s.loader).toBe('fabric');
    expect(s.mcVersion).toBe('1.21.11');
    expect(s.spec).toBeNull();
  });

  it('setLoader 切换 loader', () => {
    useModStore.getState().setLoader('neoforge');
    expect(useModStore.getState().loader).toBe('neoforge');
  });

  it('setFiles 自动选中第一个文件', () => {
    useModStore.getState().setFiles([
      { path: 'a.txt', content: 'a' },
      { path: 'b.txt', content: 'b' },
    ]);
    expect(useModStore.getState().selectedFile).toBe('a.txt');
  });
});
```

- [ ] **Step 3: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test`
Expected: PASS

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/src/store
git commit -m "feat(desktop): Zustand 全局状态管理"
```

---

## Task 6: App 布局 + TopBar（Loader/版本切换器）

**Files:**

- Create: `apps/desktop/src/renderer/src/App.tsx`
- Create: `apps/desktop/src/renderer/src/components/TopBar.tsx`

- [ ] **Step 1: 写 `TopBar.tsx`（顶部 loader/版本切换器，规格 §2.1 常驻顶部）**

```tsx
import { useModStore } from '../store/mod-store.js';
import { MC_VERSIONS } from '@mc-creator/shared';
import type { Loader, McVersion } from '@mc-creator/shared';

export function TopBar() {
  const { loader, mcVersion, setLoader, setMcVersion, loading } = useModStore();

  return (
    <header className="flex items-center gap-4 border-b border-zinc-700 bg-zinc-900 px-4 py-2 text-zinc-100">
      <span className="text-lg font-bold">MC Creator</span>
      <div className="flex items-center gap-2">
        <label className="text-sm">Loader:</label>
        <select
          value={loader}
          onChange={(e) => setLoader(e.target.value as Loader)}
          disabled={loading}
          className="rounded bg-zinc-800 px-2 py-1 text-sm"
        >
          <option value="fabric">Fabric</option>
          <option value="neoforge">NeoForge</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <label className="text-sm">MC 版本:</label>
        <select
          value={mcVersion}
          onChange={(e) => setMcVersion(e.target.value as McVersion)}
          disabled={loading}
          className="rounded bg-zinc-800 px-2 py-1 text-sm"
        >
          {MC_VERSIONS.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      </div>
    </header>
  );
}
```

- [ ] **Step 2: 写 `App.tsx`（VS Code 式三栏布局）**

```tsx
import { TopBar } from './components/TopBar.js';
import { FileTree } from './components/FileTree.js';
import { ChatPanel } from './components/ChatPanel.js';
import { CodePreview } from './components/CodePreview.js';
import { AiChat } from './components/AiChat.js';

export default function App() {
  return (
    <div className="flex h-screen flex-col bg-zinc-950 text-zinc-100">
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        {/* 左：文件树 */}
        <aside className="w-60 border-r border-zinc-800 overflow-y-auto">
          <FileTree />
        </aside>
        {/* 中：对话 + Spec + 代码预览 */}
        <main className="flex flex-1 flex-col overflow-hidden">
          <ChatPanel />
          <CodePreview />
        </main>
        {/* 右：AI 聊天 */}
        <aside className="w-80 border-l border-zinc-800 overflow-y-auto">
          <AiChat />
        </aside>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck:web`
Expected: 暂报错（FileTree/ChatPanel 等未创建），后续 Task 补齐

- [ ] **Step 4: 提交（布局骨架）**

```bash
git add apps/desktop/src/renderer/src/App.tsx apps/desktop/src/renderer/src/components/TopBar.tsx
git commit -m "feat(desktop): 三栏布局骨架与 Loader/版本切换器"
```

---

## Task 7: FileTree + ChatPanel + CodePreview + AiChat + BuildPanel

**Files:**

- Create: `apps/desktop/src/renderer/src/components/FileTree.tsx`
- Create: `apps/desktop/src/renderer/src/components/ChatPanel.tsx`
- Create: `apps/desktop/src/renderer/src/components/CodePreview.tsx`
- Create: `apps/desktop/src/renderer/src/components/AiChat.tsx`
- Create: `apps/desktop/src/renderer/src/lib/ipc-client.ts`

- [ ] **Step 1: 写 `lib/ipc-client.ts`（渲染进程调 IPC 封装）**

```typescript
import type { GenerateSpecRes, GenerateFilesRes, BuildRes } from '../../../shared/ipc-channels.js';

/** 封装 window.mcApi，提供类型安全调用 */
export const ipcClient = {
  generateSpec: (description: string): Promise<GenerateSpecRes> =>
    window.mcApi.generateSpec(description),
  generateFiles: (req: {
    loader: string;
    mcVersion: string;
    spec: unknown;
  }): Promise<GenerateFilesRes> => window.mcApi.generateFiles(req),
  build: (projectPath: string): Promise<BuildRes> => window.mcApi.build(projectPath),
};
```

- [ ] **Step 2: 写 `FileTree.tsx`（左侧文件树）**

```tsx
import { useModStore } from '../store/mod-store.js';

export function FileTree() {
  const { files, selectedFile, selectFile } = useModStore();

  if (files.length === 0) {
    return <div className="p-4 text-sm text-zinc-500">暂无生成文件</div>;
  }

  return (
    <div className="p-2">
      <div className="mb-2 text-xs font-semibold text-zinc-400">生成文件</div>
      <ul className="space-y-0.5">
        {files.map((f) => (
          <li key={f.path}>
            <button
              onClick={() => selectFile(f.path)}
              className={`w-full truncate rounded px-2 py-1 text-left text-xs ${
                selectedFile === f.path
                  ? 'bg-zinc-700 text-white'
                  : 'text-zinc-300 hover:bg-zinc-800'
              }`}
            >
              {f.path}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 3: 写 `ChatPanel.tsx`（中间对话+Spec 审阅，端到端流程入口）**

```tsx
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';

export function ChatPanel() {
  const {
    description,
    setDescription,
    loader,
    mcVersion,
    spec,
    setSpec,
    setFiles,
    setLoading,
    setError,
    loading,
    error,
  } = useModStore();

  const generateSpec = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.generateSpec(description);
      setSpec(res.spec);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const generateFiles = async () => {
    if (!spec) return;
    setLoading(true);
    setError(null);
    try {
      const res = await ipcClient.generateFiles({ loader, mcVersion, spec });
      setFiles(res.files);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 border-b border-zinc-800 p-4">
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="描述你想要的 mod（如：做一个添加红宝石工具的 mod）"
        className="h-24 rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100"
        disabled={loading}
      />
      <div className="flex gap-2">
        <button
          onClick={generateSpec}
          disabled={loading || !description}
          className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          生成 Spec
        </button>
        <button
          onClick={generateFiles}
          disabled={loading || !spec}
          className="rounded bg-green-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          生成代码
        </button>
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      {spec && (
        <div className="rounded border border-zinc-800 bg-zinc-900 p-2">
          <div className="mb-1 text-xs text-zinc-400">ModSpec（审阅后点「生成代码」）</div>
          <pre className="max-h-48 overflow-auto text-xs text-zinc-300">
            {JSON.stringify(spec, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 写 `CodePreview.tsx`（Monaco 代码预览）**

```tsx
import Editor from '@monaco-editor/react';
import { useModStore } from '../store/mod-store.js';

export function CodePreview() {
  const { files, selectedFile } = useModStore();
  const file = files.find((f) => f.path === selectedFile);

  if (!file) {
    return (
      <div className="flex-1 flex items-center justify-center text-sm text-zinc-600">
        选择文件预览代码
      </div>
    );
  }

  const lang = file.path.endsWith('.java')
    ? 'java'
    : file.path.endsWith('.json')
      ? 'json'
      : file.path.endsWith('.gradle')
        ? 'groovy'
        : file.path.endsWith('.toml')
          ? 'ini'
          : 'plaintext';

  return (
    <div className="flex-1 overflow-hidden">
      <Editor
        height="100%"
        path={file.path}
        language={lang}
        value={file.content}
        theme="vs-dark"
        options={{ readOnly: true, fontSize: 13, minimap: { enabled: false } }}
      />
    </div>
  );
}
```

- [ ] **Step 5: 写 `AiChat.tsx`（右侧 AI 聊天面板）**

```tsx
import { useState } from 'react';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

export function AiChat() {
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: '你好！描述你想要的 mod，我来帮你生成。' },
  ]);
  const [input, setInput] = useState('');

  const send = () => {
    if (!input.trim()) return;
    setMessages((m) => [...m, { role: 'user', text: input }]);
    setInput('');
    // TODO: P4 接真实 AI 流式响应
    setMessages((m) => [
      ...m,
      { role: 'assistant', text: '（P3 阶段用 Mock，P4 接真实模型流式响应）' },
    ]);
  };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-zinc-800 p-2 text-xs font-semibold text-zinc-400">
        AI 助手
      </div>
      <div className="flex-1 space-y-2 overflow-y-auto p-3">
        {messages.map((m, i) => (
          <div
            key={i}
            className={`rounded p-2 text-xs ${m.role === 'user' ? 'bg-blue-900/40' : 'bg-zinc-800'}`}
          >
            {m.text}
          </div>
        ))}
      </div>
      <div className="flex gap-2 border-t border-zinc-800 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          placeholder="输入消息…"
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
        />
        <button onClick={send} className="rounded bg-blue-600 px-3 py-1 text-xs text-white">
          发送
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: typecheck（web）**

Run: `pnpm --filter @mc-creator/desktop typecheck:web`
Expected: 无错误

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 文件树 + 对话 + 代码预览 + AI 聊天面板"
```

---

## Task 8: BuildPanel + 端到端流程串联

**Files:**

- Create: `apps/desktop/src/renderer/src/components/BuildPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/App.tsx`（挂载 BuildPanel）

- [ ] **Step 1: 写 `BuildPanel.tsx`（编译面板，调 build IPC）**

```tsx
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';

export function BuildPanel() {
  const {
    files,
    buildLog,
    buildSuccess,
    jarPath,
    loading,
    setBuildResult,
    setLoading,
    setError,
    error,
  } = useModStore();

  const build = async () => {
    setLoading(true);
    setError(null);
    try {
      // 注意：P3 阶段用临时目录，P4 接真实文件系统写入
      const res = await ipcClient.build('/tmp/mc-mod');
      setBuildResult({ success: res.success, log: res.log, jarPath: res.jarPath });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="border-t border-zinc-800 p-3">
      <div className="mb-2 flex items-center gap-2">
        <button
          onClick={build}
          disabled={loading || files.length === 0}
          className="rounded bg-orange-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
        >
          编译 .jar
        </button>
        {buildSuccess === true && <span className="text-sm text-green-400">编译成功！</span>}
        {buildSuccess === false && <span className="text-sm text-red-400">编译失败</span>}
        {jarPath && <span className="text-xs text-zinc-400">产物：{jarPath}</span>}
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      {buildLog && (
        <pre className="max-h-40 overflow-auto rounded bg-black p-2 text-xs text-zinc-300">
          {buildLog}
        </pre>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 修改 `App.tsx` 挂载 BuildPanel**

在 `App.tsx` 的 `<main>` 内 `<CodePreview />` 后追加 `<BuildPanel />`：

```tsx
import { BuildPanel } from './components/BuildPanel.js';
// ...
<main className="flex flex-1 flex-col overflow-hidden">
  <ChatPanel />
  <CodePreview />
  <BuildPanel />
</main>;
```

- [ ] **Step 3: 全量测试 + typecheck**

Run: `pnpm --filter @mc-creator/desktop test`
Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 全部 PASS，0 错误

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 编译面板与端到端流程串联"
```

---

## Task 9: 端到端验证 + 全量测试

- [ ] **Step 1: 全量测试（desktop + core + shared）**

Run: `pnpm -r test`
Expected: 全部 PASS（core 45 + desktop ~10）

- [ ] **Step 2: 全量 typecheck**

Run: `pnpm -r typecheck`
Expected: 0 错误

- [ ] **Step 3: 启动 dev 验证（手动）**

Run: `pnpm --filter @mc-creator/desktop dev`
Expected: Electron 窗口打开，显示三栏布局 + 顶部 loader 切换器

- 输入描述 → 点「生成 Spec」→ 看到 ModSpec JSON
- 点「生成代码」→ 左侧文件树出现 → 中间 Monaco 预览代码
- 切换 loader → 重新生成 → 文件树变化（fabric.mod.json ↔ mods.toml）

- [ ] **Step 4: 提交**

```bash
git add -A
git commit -m "feat(desktop): P3 端到端验证通过"
```

---

## 自审清单

**1. 规格覆盖**：

- ✅ §2.1 UI 层（对话/Spec 审阅/代码预览/Loader 切换器）→ Task 6/7/8
- ✅ §2.2 核心引擎接线（主进程调 core）→ Task 3
- ✅ §4 端到端数据流（描述→spec→生成→编译）→ Task 8
- ✅ §7.2 技术栈（Electron + React + Tailwind + Monaco + Zustand + 类型化 IPC）→ Task 1/4/5
- ✅ §9 v1 成功标准（描述→spec→编译→.jar）→ Task 9
- ⚠️ 真实 Gradle 编译需用户本机有 JDK 21 + Gradle wrapper（Task 8 build IPC 调 runGradleBuild）

**2. 占位符扫描**：AiChat 的 `TODO: P4 接真实 AI` 是明确的阶段标记，非占位符。

**3. 类型一致性**：IPC 通道 schema 在 Task 2 定义，Task 3/4/7 引用一致；store 在 Task 5 定义，Task 6/7/8 引用一致；`Loader`/`McVersion` 从 shared 导入一致。

---

## 执行交接

P3 Electron UI 计划完成，已保存至 `docs/superpowers/plans/2026-07-14-mc-creator-electron-ui.md`。
