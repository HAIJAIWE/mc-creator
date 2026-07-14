# MC Creator 构建修复循环 实现计划（P5）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Gradle 编译失败 → 解析错误日志 → AI 修复源码 → 重新构建的自动修复循环（最多 3 次），让用户无需手动改代码即可解决编译错误。

**Architecture:** core 层新增 `BuildFixer`（调 ModelProvider + parseGradleErrors + Filesystem 修改源码 + 重新 runGradleBuild）。desktop 层 BuildPanel 串联：build 失败 → 自动触发修复循环 → 展示修复过程日志。

**Tech Stack:** 复用 P1 的 parseGradleErrors/runGradleBuild/Filesystem + P4 的 ModelProvider。

**对应规格：** `docs/superpowers/specs/2026-07-13-mc-creator-design.md` 第 5 节（错误处理：Gradle 编译失败 → AI 修复循环最多 3 次）。

**前置条件：** P1-P4 已完成，56/56 测试通过。

---

## 文件结构

```
packages/core/
└── src/
    ├── builder/
    │   ├── build-fixer.ts            # 新增：构建修复循环
    │   ├── build-fixer.test.ts
    │   └── index.ts                  # 更新导出
apps/desktop/
└── src/
    ├── main/
    │   └── ipc.ts                    # 修改：BUILD handler 接入 BuildFixer
    └── renderer/
        └── src/
            ├── components/
            │   └── BuildPanel.tsx    # 修改：展示修复过程
            └── store/
                └── mod-store.ts      # 修改：加修复日志状态
```

---

## Task 1: core 层 BuildFixer

**Files:**
- Create: `packages/core/src/builder/build-fixer.ts`
- Test: `packages/core/src/builder/build-fixer.test.ts`
- Modify: `packages/core/src/builder/index.ts`

- [ ] **Step 1: 写 `build-fixer.ts`**

```typescript
import type { ModelProvider } from '../model-provider/types.js';
import { runGradleBuild, type BuildResult } from './gradle.js';
import { parseGradleErrors, type BuildError } from './log-parser.js';
import type { Filesystem } from '../filesystem/index.js';

const MAX_FIX_ATTEMPTS = 3;

/** 修复循环结果 */
export interface FixResult {
  success: boolean;
  attempts: number;
  finalResult: BuildResult;
  fixLog: string[]; // 每轮修复的描述
}

/**
 * 构建修复循环（规格 §5）。
 * 流程：build → 失败 → parseGradleErrors → AI 修复源码 → 重新 build（最多 3 次）。
 */
export class BuildFixer {
  constructor(
    private fs: Filesystem,
    private provider: ModelProvider,
  ) {}

  async buildWithFix(
    projectPath: string,
    onProgress?: (msg: string) => void,
  ): Promise<FixResult> {
    const fixLog: string[] = [];

    for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      onProgress?.(attempt === 0 ? '开始构建…' : `第 ${attempt} 次修复后重新构建…`);
      const result = await runGradleBuild(projectPath);

      if (result.success) {
        return { success: true, attempts: attempt, finalResult: result, fixLog };
      }

      if (attempt === MAX_FIX_ATTEMPTS) {
        fixLog.push(`已尝试 ${MAX_FIX_ATTEMPTS} 次修复仍失败，请手动检查。`);
        return { success: false, attempts: attempt, finalResult: result, fixLog };
      }

      // 解析错误
      const errors = parseGradleErrors(result.log);
      if (errors.length === 0) {
        fixLog.push('无法解析编译错误，请手动检查日志。');
        return { success: false, attempts: attempt, finalResult: result, fixLog };
      }

      onProgress?.(`检测到 ${errors.length} 个错误，AI 修复中…`);
      const fixed = await this.applyFixes(projectPath, errors);
      fixLog.push(fixed);
    }

    // 不会到达
    throw new Error('构建修复循环异常退出');
  }

  /** 让 AI 修复源码，返回修复描述 */
  private async applyFixes(projectPath: string, errors: BuildError[]): Promise<string> {
    const descriptions = errors.map((e) => `${e.file}:${e.line} — ${e.message}`).join('\n');
    const prompt = `你是 Java 代码修复专家。以下 Minecraft mod 编译出错，请给出修复后的完整代码。

错误：
${descriptions}

要求：只输出修复后的完整文件内容，不要解释。如果涉及多个文件，用 === FILE: 路径 === 分隔。`;

    const raw = await this.provider.complete(prompt);

    // 简单解析：按 === FILE: 路径 === 分隔
    const blocks = raw.split(/=== FILE:\s*(.+?)\s*===/);
    let fixedCount = 0;

    for (let i = 1; i < blocks.length; i += 2) {
      const filePath = blocks[i].trim();
      const content = blocks[i + 1]?.trim() ?? '';
      const fullPath = `${projectPath}/${filePath}`;
      try {
        await this.fs.writeFile(fullPath, content);
        fixedCount++;
      } catch {
        // 文件路径可能不匹配，跳过
      }
    }

    return fixedCount > 0
      ? `AI 修复了 ${fixedCount} 个文件`
      : 'AI 返回的修复内容无法匹配文件，请手动检查';
  }
}
```

- [ ] **Step 2: 写测试 `build-fixer.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { fs as memfs } from 'memfs';
import { Filesystem } from '../filesystem/index.js';
import { BuildFixer } from './build-fixer.js';
import { MockProvider } from '../model-provider/mock-provider.js';

// Mock runGradleBuild
vi.mock('./gradle.js', () => ({
  runGradleBuild: vi.fn(),
}));

import { runGradleBuild } from './gradle.js';

describe('BuildFixer', () => {
  function makeFixer(response: string) {
    const dfs = new Filesystem(memfs as any);
    const provider = new MockProvider(response);
    return new BuildFixer(dfs, provider);
  }

  it('首次构建成功直接返回', async () => {
    vi.mocked(runGradleBuild).mockResolvedValue({
      success: true, jarPath: 'build/libs/mod.jar', log: 'BUILD SUCCESSFUL',
    });
    const fixer = makeFixer('');
    const result = await fixer.buildWithFix('/proj');
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(0);
  });

  it('构建失败 + AI 修复后成功', async () => {
    // 第一次失败，第二次成功
    vi.mocked(runGradleBuild)
      .mockResolvedValueOnce({
        success: false, jarPath: null,
        log: '/proj/src/main/java/ModItems.java:10: error: \';\' expected',
      })
      .mockResolvedValueOnce({ success: true, jarPath: 'build/libs/mod.jar', log: 'ok' });

    const fixer = makeFixer('=== FILE: src/main/java/ModItems.java ===\npublic class ModItems {}');
    const result = await fixer.buildWithFix('/proj');
    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.fixLog.length).toBe(1);
  });

  it('3 次修复仍失败返回 false', async () => {
    vi.mocked(runGradleBuild).mockResolvedValue({
      success: false, jarPath: null,
      log: '/proj/src/ModItems.java:1: error: cannot find symbol',
    });
    const fixer = makeFixer('=== FILE: src/ModItems.java ===\nclass X {}');
    const result = await fixer.buildWithFix('/proj');
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
  });

  it('无法解析错误时直接返回', async () => {
    vi.mocked(runGradleBuild).mockResolvedValue({
      success: false, jarPath: null,
      log: 'Some unknown error without file:line format',
    });
    const fixer = makeFixer('');
    const result = await fixer.buildWithFix('/proj');
    expect(result.success).toBe(false);
    expect(result.attempts).toBe(0);
  });
});
```

- [ ] **Step 3: 更新 `packages/core/src/builder/index.ts`**

```typescript
export * from './jdk.js';
export * from './gradle.js';
export * from './log-parser.js';
export * from './build-fixer.js';
```

- [ ] **Step 4: 运行测试**

Run: `pnpm --filter @mc-creator/core test -- build-fixer`
Expected: PASS（4 个用例）

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @mc-creator/core typecheck`
Expected: 0 错误

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/builder
git commit -m "feat(core): BuildFixer 构建修复循环（AI 自动修复编译错误）"
```

---

## Task 2: desktop IPC 接入 BuildFixer

**Files:**
- Modify: `apps/desktop/src/main/ipc.ts`
- Modify: `apps/desktop/src/shared/ipc-channels.ts`

- [ ] **Step 1: 在 `ipc-channels.ts` 追加**

```typescript
// === 带修复的构建 ===
export const BUILD_WITH_FIX = 'mod:buildWithFix';

export const BuildWithFixRequest = z.object({ projectPath: z.string().min(1) });
export const BuildWithFixResponse = z.object({
  success: z.boolean(),
  attempts: z.number(),
  jarPath: z.string().nullable(),
  log: z.string(),
  fixLog: z.array(z.string()),
});

export type BuildWithFixReq = z.infer<typeof BuildWithFixRequest>;
export type BuildWithFixRes = z.infer<typeof BuildWithFixResponse>;
```

- [ ] **Step 2: 修改 `apps/desktop/src/main/ipc.ts`**

在顶部导入追加：
```typescript
import { BuildFixer, Filesystem } from '@mc-creator/core';
import { BuildWithFixRequest, BUILD_WITH_FIX } from '../shared/ipc-channels.js';
import * as nodeFs from 'fs';
```

在 `registerIpcHandlers` 追加：
```typescript
  ipcMain.handle(BUILD_WITH_FIX, async (_e, raw: unknown) => {
    const req = BuildWithFixRequest.parse(raw);
    const config = loadModelConfig();

    // 创建 fixer（有 apiKey 用真实模型，否则用 Mock）
    const realFs = new Filesystem(nodeFs as any);
    let fixer: BuildFixer;
    if (config.apiKey) {
      const { VercelAiProvider } = await import('@mc-creator/core');
      fixer = new BuildFixer(realFs, new VercelAiProvider(config));
    } else {
      fixer = new BuildFixer(realFs, new MockProvider(''));
    }

    const result = await fixer.buildWithFix(req.projectPath);
    return {
      success: result.success,
      attempts: result.attempts,
      jarPath: result.finalResult.jarPath,
      log: result.finalResult.log,
      fixLog: result.fixLog,
    };
  });
```

- [ ] **Step 3: 更新 preload + ipc-client**

在 `preload/index.ts` 的 api 对象追加：
```typescript
  buildWithFix: (projectPath: string) => ipcRenderer.invoke(IPC.BUILD_WITH_FIX, { projectPath }),
```

在 IPC 常量导入追加 `BUILD_WITH_FIX`。

在 `ipc-client.ts` 追加：
```typescript
  buildWithFix: (projectPath: string) => window.mcApi.buildWithFix(projectPath),
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 错误

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): 带修复循环的构建 IPC"
```

---

## Task 3: BuildPanel 展示修复过程

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/mod-store.ts`
- Modify: `apps/desktop/src/renderer/src/components/BuildPanel.tsx`

- [ ] **Step 1: 在 `mod-store.ts` 追加状态**

在 ModState 接口追加：
```typescript
  fixLog: string[];
  setFixLog: (logs: string[]) => void;
```

在 store 实现追加：
```typescript
  fixLog: [],
  setFixLog: (logs) => set({ fixLog: logs }),
```

- [ ] **Step 2: 重写 `BuildPanel.tsx`**

```tsx
import { useModStore } from '../store/mod-store.js';
import { ipcClient } from '../lib/ipc-client.js';

export function BuildPanel() {
  const {
    files, buildLog, buildSuccess, jarPath, loading, fixLog,
    setBuildResult, setLoading, setError, error, setFixLog,
  } = useModStore();

  const build = async () => {
    setLoading(true);
    setError(null);
    setFixLog([]);
    try {
      // P3 阶段用临时目录，P4 接真实文件系统写入
      const res = await ipcClient.buildWithFix('/tmp/mc-mod') as any;
      setBuildResult({ success: res.success, log: res.log, jarPath: res.jarPath });
      setFixLog(res.fixLog ?? []);
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
          {loading ? '构建中…' : '编译 .jar'}
        </button>
        {buildSuccess === true && <span className="text-sm text-green-400">编译成功！</span>}
        {buildSuccess === false && <span className="text-sm text-red-400">编译失败</span>}
        {jarPath && <span className="text-xs text-zinc-400">产物：{jarPath}</span>}
      </div>
      {error && <div className="text-sm text-red-400">{error}</div>}
      {fixLog.length > 0 && (
        <div className="mb-2 space-y-1">
          <div className="text-xs font-semibold text-zinc-400">修复过程</div>
          {fixLog.map((log, i) => (
            <div key={i} className="text-xs text-zinc-500">• {log}</div>
          ))}
        </div>
      )}
      {buildLog && (
        <pre className="max-h-40 overflow-auto rounded bg-black p-2 text-xs text-zinc-300">{buildLog}</pre>
      )}
    </div>
  );
}
```

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 错误

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): BuildPanel 展示 AI 修复过程"
```

---

## Task 4: 全量验证

- [ ] **Step 1: 全量测试**

Run: `pnpm -r test`
Expected: 全部 PASS（core 52 + desktop 8 = 60）

- [ ] **Step 2: 全量 typecheck**

Run: `pnpm -r typecheck`
Expected: 0 错误

- [ ] **Step 3: 提交（如有遗留）**

```bash
git add -A
git commit -m "feat: P5 构建修复循环验证通过"
```

---

## 自审清单

**1. 规格覆盖**：
- ✅ §5 Gradle 编译失败 → 解析错误日志 → AI 修复循环（最多 3 次）→ Task 1
- ✅ §5 仍失败展示日志+建议 → Task 1 fixLog + Task 3 展示

**2. 占位符扫描**：无占位符。

**3. 类型一致性**：`FixResult` 在 core 定义，IPC `BuildWithFixResponse` 字段一致；`BuildError` 复用 P1 的 log-parser。
