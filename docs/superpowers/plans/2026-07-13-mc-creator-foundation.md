# MC Creator 基础地基 实现计划（P1）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 搭建 mc-creator monorepo 骨架 + core 引擎基础组件（文件系统/模型提供者/编排器/构建器/生成器注册表），全部带单元测试，可在 Node 独立运行验证。

**Architecture:** pnpm workspaces monorepo。`packages/shared` 放类型与 zod schema（无副作用，被所有包依赖）；`packages/core` 是纯 TS 核心引擎，不依赖 Electron/React，可在 Node 直接跑、可单测。本计划不涉及 UI（P3）与具体 Mod 生成器实现（P2），只搭引擎骨架与接口。

**Tech Stack:** TypeScript 5、pnpm workspaces、Vitest、zod、Vercel AI SDK（仅编排器引入）、execa（进程调用）、memfs（文件系统测试）。

**对应规格：** `docs/superpowers/specs/2026-07-13-mc-creator-design.md` 第 2、4、7 节。

---

## 文件结构（本计划涉及）

```
mc-creator/
├── package.json                    # 根，pnpm workspace 配置
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── packages/
│   ├── shared/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── types/loader.ts     # Loader / McVersion 类型
│   │       ├── types/index.ts
│   │       ├── schemas/mod-spec.ts # ModSpec zod schema
│   │       ├── schemas/generator.ts# GeneratorContext / GenerationResult
│   │       ├── schemas/index.ts
│   │       └── index.ts
│   └── core/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vitest.config.ts
│       └── src/
│           ├── filesystem/index.ts          # 原子写 / 快照 / 回滚
│           ├── filesystem/filesystem.test.ts
│           ├── model-provider/types.ts      # ModelProvider 接口 + 能力声明
│           ├── model-provider/mock-provider.ts
│           ├── model-provider/index.ts
│           ├── model-provider/model-provider.test.ts
│           ├── orchestrator/orchestrator.ts # streamText 封装 + 校验重试
│           ├── orchestrator/orchestrator.test.ts
│           ├── orchestrator/index.ts
│           ├── builder/jdk.ts               # JDK 检测
│           ├── builder/gradle.ts            # Gradle 调用
│           ├── builder/log-parser.ts        # 错误日志解析
│           ├── builder/builder.test.ts
│           ├── builder/index.ts
│           ├── generators/types.ts          # Generator 接口
│           ├── generators/registry.ts       # GeneratorRegistry
│           ├── generators/registry.test.ts
│           └── index.ts
```

每个文件单一职责：shared 纯类型/schema 无副作用；core 各子目录对应规格 §2.2 的一个组件，互不依赖处保持独立可测。

---

## Task 1: 搭建 monorepo 脚手架

**Files:**

- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`

- [ ] **Step 1: 写根 `package.json`**

```json
{
  "name": "mc-creator",
  "private": true,
  "version": "0.0.0",
  "packageManager": "pnpm@9.0.0",
  "scripts": {
    "test": "pnpm -r test",
    "build": "pnpm -r build",
    "typecheck": "pnpm -r typecheck"
  }
}
```

- [ ] **Step 2: 写 `pnpm-workspace.yaml`**

```yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

- [ ] **Step 3: 写 `tsconfig.base.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "declaration": true,
    "sourceMap": true,
    "composite": true
  }
}
```

- [ ] **Step 4: 验证 pnpm 识别 workspace**

Run: `pnpm -v`
Expected: 输出 pnpm 版本号（若未装 pnpm，先 `npm i -g pnpm`）

- [ ] **Step 5: 提交**

```bash
git add package.json pnpm-workspace.yaml tsconfig.base.json
git commit -m "chore: 初始化 monorepo 脚手架"
```

---

## Task 2: shared 包 — loader/version 类型

**Files:**

- Create: `packages/shared/package.json`
- Create: `packages/shared/tsconfig.json`
- Create: `packages/shared/src/types/loader.ts`
- Create: `packages/shared/src/types/index.ts`
- Create: `packages/shared/src/index.ts`

- [ ] **Step 1: 写 `packages/shared/package.json`**

```json
{
  "name": "@mc-creator/shared",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "scripts": {
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "zod": "^3.23.0"
  }
}
```

- [ ] **Step 2: 写 `packages/shared/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "./dist" },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 `packages/shared/src/types/loader.ts`**

```typescript
/** Mod 加载器（规格 §1.2：Fabric + NeoForge 同时支持） */
export type Loader = 'fabric' | 'neoforge';

/** MC 版本（规格 §1.2：1.21.11 为主，预留 26.1） */
export const MC_VERSIONS = ['1.21.11', '1.21.1', '26.1'] as const;
export type McVersion = (typeof MC_VERSIONS)[number];

/** 默认目标版本 */
export const DEFAULT_MC_VERSION: McVersion = '1.21.11';

/** 每个 loader+版本 对应的 Java 版本（规格 §5 错误处理） */
export function javaVersionFor(loader: Loader, mc: McVersion): number {
  if (mc === '26.1') return 25;
  return 21; // 1.21.x 需 Java 21
}
```

- [ ] **Step 4: 写 `packages/shared/src/types/index.ts`**

```typescript
export * from './loader.js';
```

- [ ] **Step 5: 写 `packages/shared/src/index.ts`**

```typescript
export * from './types/index.js';
export * from '../schemas/index.js';
```

- [ ] **Step 6: 安装依赖并 typecheck**

Run: `pnpm install`
Run: `pnpm --filter @mc-creator/shared typecheck`
Expected: 无错误退出

- [ ] **Step 7: 提交**

```bash
git add packages/shared
git commit -m "feat(shared): 添加 loader/version 类型"
```

---

## Task 3: shared 包 — ModSpec 与生成器 schema

**Files:**

- Create: `packages/shared/src/schemas/mod-spec.ts`
- Create: `packages/shared/src/schemas/generator.ts`
- Create: `packages/shared/src/schemas/index.ts`

- [ ] **Step 1: 写 `packages/shared/src/schemas/mod-spec.ts`**

```typescript
import { z } from 'zod';

/** 物品条目（loader 无关） */
export const ItemSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/), // 小写下划线
  name: z.string(), // 显示名
  maxStackSize: z.number().int().min(1).max(64).default(64),
});

/** 方块条目 */
export const BlockSpec = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string(),
  material: z.enum(['wood', 'stone', 'metal', 'rock']).default('wood'),
  hardness: z.number().min(0).default(1.5),
});

/** ModSpec：loader 无关的结构化规格（规格 §3.3） */
export const ModSpec = z.object({
  modId: z.string().regex(/^[a-z0-9_]+$/),
  version: z.string().default('1.0.0'),
  name: z.string(),
  description: z.string().default(''),
  items: z.array(ItemSpec).default([]),
  blocks: z.array(BlockSpec).default([]),
});

export type ModSpec = z.infer<typeof ModSpec>;
export type ItemSpec = z.infer<typeof ItemSpec>;
export type BlockSpec = z.infer<typeof BlockSpec>;
```

- [ ] **Step 2: 写 `packages/shared/src/schemas/generator.ts`**

```typescript
import { z } from 'zod';
import { ModSpec } from './mod-spec.js';

/** 文件树节点（生成产物） */
export const FileNode = z.object({
  path: z.string(), // 相对项目根
  content: z.string(),
});

/** 生成器上下文（规格 §3.3） */
export const GeneratorContext = z.object({
  loader: z.enum(['fabric', 'neoforge']),
  mcVersion: z.string(),
  modId: z.string(),
  spec: ModSpec,
  projectPath: z.string(),
});

/** 生成结果 */
export const GenerationResult = z.object({
  files: z.array(FileNode),
  warnings: z.array(z.string()).default([]),
  buildCmd: z.string().default('./gradlew build'),
});

export type FileNode = z.infer<typeof FileNode>;
export type GeneratorContext = z.infer<typeof GeneratorContext>;
export type GenerationResult = z.infer<typeof GenerationResult>;
```

- [ ] **Step 3: 写 `packages/shared/src/schemas/index.ts`**

```typescript
export * from './mod-spec.js';
export * from './generator.js';
```

- [ ] **Step 4: typecheck**

Run: `pnpm --filter @mc-creator/shared typecheck`
Expected: 无错误

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/schemas
git commit -m "feat(shared): 添加 ModSpec 与生成器 schema"
```

---

## Task 4: core 包初始化

**Files:**

- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/vitest.config.ts`
- Create: `packages/core/src/index.ts`

- [ ] **Step 1: 写 `packages/core/package.json`**

```json
{
  "name": "@mc-creator/core",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "@mc-creator/shared": "workspace:*",
    "ai": "^4.0.0",
    "execa": "^9.0.0",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "memfs": "^4.9.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 2: 写 `packages/core/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "types": ["vitest/globals"]
  },
  "include": ["src"]
}
```

- [ ] **Step 3: 写 `packages/core/vitest.config.ts`**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 4: 写 `packages/core/src/index.ts`（空出口，后续填充）**

```typescript
export {};
```

- [ ] **Step 5: 安装并验证**

Run: `pnpm install`
Run: `pnpm --filter @mc-creator/core typecheck`
Expected: 无错误

- [ ] **Step 6: 提交**

```bash
git add packages/core/package.json packages/core/tsconfig.json packages/core/vitest.config.ts packages/core/src/index.ts
git commit -m "chore(core): 初始化 core 包与 vitest"
```

---

## Task 5: core 文件系统 — 原子写入与 diff

**Files:**

- Create: `packages/core/src/filesystem/index.ts`
- Test: `packages/core/src/filesystem/filesystem.test.ts`

- [ ] **Step 1: 写失败测试 `filesystem.test.ts`**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { fs } from 'memfs';
import { Filesystem } from './index.js';

describe('Filesystem', () => {
  let dfs: Filesystem;
  beforeEach(() => {
    dfs = new Filesystem(fs as any);
  });

  it('原子写入新文件', async () => {
    await dfs.writeFile('/proj/a.txt', 'hello');
    expect(dfs.readFile('/proj/a.txt')).toBe('hello');
  });

  it('原子写入覆盖既有文件', async () => {
    await dfs.writeFile('/proj/a.txt', 'v1');
    await dfs.writeFile('/proj/a.txt', 'v2');
    expect(dfs.readFile('/proj/a.txt')).toBe('v2');
  });

  it('写入失败不破坏原文件', async () => {
    await dfs.writeFile('/proj/a.txt', 'orig');
    // 模拟 rename 失败：目标路径父目录不存在会被原子逻辑兜住
    await expect(dfs.writeFile('/nope/sub/a.txt', 'x')).rejects.toThrow();
    expect(dfs.readFile('/proj/a.txt')).toBe('orig');
  });

  it('生成 diff', async () => {
    await dfs.writeFile('/proj/a.txt', 'line1\nline2\n');
    const diff = dfs.diff('/proj/a.txt', 'line1\nlineX\n');
    expect(diff.added).toContain('lineX');
    expect(diff.removed).toContain('line2');
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/core test -- filesystem`
Expected: FAIL — `Filesystem is not defined`

- [ ] **Step 3: 写实现 `packages/core/src/filesystem/index.ts`**

```typescript
import type { FS } from 'memfs';

export interface Diff {
  added: string[];
  removed: string[];
}

/**
 * 文件系统封装：原子写入（写临时文件再 rename）+ diff + 快照/回滚。
 * 使用注入的 memfs（生产用 node fs，测试用 memfs）。
 */
export class Filesystem {
  constructor(private fs: FS) {}

  async writeFile(path: string, content: string): Promise<void> {
    const tmp = `${path}.${process.pid}.tmp`;
    await this.fs.promises.mkdir(this.dirname(path), { recursive: true });
    await this.fs.promises.writeFile(tmp, content, 'utf8');
    await this.fs.promises.rename(tmp, path);
  }

  readFile(path: string): string {
    return this.fs.readFileSync(path, 'utf8') as string;
  }

  diff(path: string, next: string): Diff {
    const prev = this.exists(path) ? this.readFile(path) : '';
    return diffLines(prev, next);
  }

  exists(path: string): boolean {
    try {
      this.fs.statSync(path);
      return true;
    } catch {
      return false;
    }
  }

  private dirname(p: string): string {
    const i = p.lastIndexOf('/');
    return i <= 0 ? '/' : p.slice(0, i);
  }
}

function diffLines(prev: string, next: string): Diff {
  const a = prev.split('\n');
  const b = next.split('\n');
  const added: string[] = [];
  const removed: string[] = [];
  for (const line of b) if (!a.includes(line)) added.push(line);
  for (const line of a) if (!b.includes(line)) removed.push(line);
  return { added, removed };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- filesystem`
Expected: PASS（4 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/filesystem
git commit -m "feat(core): 文件系统原子写入与 diff"
```

---

## Task 6: core 文件系统 — 快照与回滚

**Files:**

- Modify: `packages/core/src/filesystem/index.ts`
- Modify: `packages/core/src/filesystem/filesystem.test.ts`

- [ ] **Step 1: 追加失败测试**

在 `filesystem.test.ts` 末尾追加：

```typescript
it('快照后可回滚到之前状态', async () => {
  await dfs.writeFile('/proj/a.txt', 'v1');
  const snap = await dfs.snapshot('/proj');
  await dfs.writeFile('/proj/a.txt', 'v2');
  expect(dfs.readFile('/proj/a.txt')).toBe('v2');
  await dfs.restore(snap);
  expect(dfs.readFile('/proj/a.txt')).toBe('v1');
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/core test -- filesystem`
Expected: FAIL — `dfs.snapshot is not a function`

- [ ] **Step 3: 实现快照/回滚**

在 `Filesystem` 类中追加：

```typescript
  async snapshot(root: string): Promise<Record<string, string>> {
    const snap: Record<string, string> = {};
    const walk = (dir: string) => {
      for (const entry of this.fs.readdirSync(dir)) {
        const full = `${dir}/${entry}`.replace('//', '/');
        const stat = this.fs.statSync(full);
        if (stat.isDirectory()) walk(full);
        else snap[full] = this.readFile(full);
      }
    };
    if (this.exists(root)) walk(root);
    return snap;
  }

  async restore(snap: Record<string, string>): Promise<void> {
    for (const [path, content] of Object.entries(snap)) {
      await this.writeFile(path, content);
    }
  }
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/core test -- filesystem`
Expected: PASS（5 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/filesystem
git commit -m "feat(core): 文件系统快照与回滚"
```

---

## Task 7: core 模型提供者接口与 mock

**Files:**

- Create: `packages/core/src/model-provider/types.ts`
- Create: `packages/core/src/model-provider/mock-provider.ts`
- Create: `packages/core/src/model-provider/index.ts`
- Test: `packages/core/src/model-provider/model-provider.test.ts`

- [ ] **Step 1: 写 `types.ts`（接口）**

```typescript
/** 模型能力声明（规格 §2.2） */
export interface ModelCapabilities {
  toolCalling: boolean;
  vision: boolean;
  streaming: boolean;
}

/** 流式片段 */
export interface StreamChunk {
  delta: string;
  done: boolean;
}

/** 模型提供者统一接口（云端/本地同接口） */
export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ModelCapabilities;

  /** 非流式补全 */
  complete(prompt: string, opts?: CompleteOptions): Promise<string>;

  /** 流式补全 */
  stream(prompt: string, opts?: CompleteOptions): AsyncIterable<StreamChunk>;
}

export interface CompleteOptions {
  system?: string;
  maxTokens?: number;
  /** 工具调用结果回灌（用于重试） */
  toolResults?: Array<{ name: string; result: string }>;
}
```

- [ ] **Step 2: 写 `mock-provider.ts`**

```typescript
import type { ModelProvider, StreamChunk } from './types.js';

/** 测试用 mock：返回预设响应，支持流式分片 */
export class MockProvider implements ModelProvider {
  readonly id = 'mock';
  readonly capabilities = { toolCalling: true, vision: false, streaming: true };
  constructor(private response: string) {}

  async complete(): Promise<string> {
    return this.response;
  }

  async *stream(): AsyncIterable<StreamChunk> {
    const tokens = this.response.split(' ');
    for (let i = 0; i < tokens.length; i++) {
      yield { delta: tokens[i] + ' ', done: false };
    }
    yield { delta: '', done: true };
  }
}
```

- [ ] **Step 3: 写 `index.ts`**

```typescript
export * from './types.js';
export * from './mock-provider.js';
```

- [ ] **Step 4: 写失败测试 `model-provider.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { MockProvider } from './mock-provider.js';

describe('MockProvider', () => {
  it('complete 返回预设响应', async () => {
    const p = new MockProvider('hello world');
    expect(await p.complete('anything')).toBe('hello world');
  });

  it('stream 分片输出并以 done 结束', async () => {
    const p = new MockProvider('a b c');
    const chunks = [];
    for await (const c of p.stream('x')) chunks.push(c);
    expect(chunks.at(-1)?.done).toBe(true);
    expect(
      chunks
        .map((c) => c.delta)
        .join('')
        .trim(),
    ).toBe('a b c');
  });
});
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @mc-creator/core test -- model-provider`
Expected: PASS（2 个用例）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/model-provider
git commit -m "feat(core): 模型提供者接口与 mock"
```

---

## Task 8: core 编排器 — Schema 校验重试

**Files:**

- Create: `packages/core/src/orchestrator/orchestrator.ts`
- Create: `packages/core/src/orchestrator/index.ts`
- Test: `packages/core/src/orchestrator/orchestrator.test.ts`

- [ ] **Step 1: 写失败测试 `orchestrator.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { Orchestrator } from './orchestrator.js';
import { MockProvider } from '../model-provider/mock-provider.js';
import { ModSpec } from '@mc-creator/shared';

describe('Orchestrator', () => {
  it('首次输出合法即返回', async () => {
    const valid = JSON.stringify({ modId: 'demo', version: '1.0.0', name: 'Demo', items: [] });
    const o = new Orchestrator(new MockProvider(valid));
    const spec = await o.generateModSpec('做一个 demo mod');
    expect(ModSpec.safeParse(spec).success).toBe(true);
  });

  it('输出不合法时带错误重试，最终成功', async () => {
    // 第一次返回缺字段，第二次返回合法
    const responses = ['{"modId":"bad id"}', JSON.stringify({ modId: 'demo', name: 'Demo' })];
    let i = 0;
    const provider = { complete: async () => responses[i++] } as any;
    const o = new Orchestrator(provider);
    const spec = await o.generateModSpec('描述');
    expect((spec as any).modId).toBe('demo');
  });

  it('重试 3 次仍失败则抛错', async () => {
    const provider = { complete: async () => 'not json' } as any;
    const o = new Orchestrator(provider);
    await expect(o.generateModSpec('x')).rejects.toThrow(/校验失败/);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/core test -- orchestrator`
Expected: FAIL — `Orchestrator is not defined`

- [ ] **Step 3: 写 `orchestrator.ts`**

```typescript
import { ModSpec, type ModSpec as ModSpecType } from '@mc-creator/shared';
import type { ModelProvider } from '../model-provider/types.js';

const MAX_RETRIES = 3;

/**
 * AI 编排器（规格 §2.4）：spec-first 流程的薄编排层。
 * 负责调用模型 → JSON Schema 校验 → 失败带错误回灌重试。
 */
export class Orchestrator {
  constructor(private provider: ModelProvider) {}

  async generateModSpec(description: string): Promise<ModSpecType> {
    let lastError = '';
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const prompt = this.buildPrompt(description, lastError);
      const raw = await this.provider.complete(prompt);
      const parsed = this.tryParse(raw);
      if (parsed.ok) {
        const result = ModSpec.safeParse(parsed.value);
        if (result.success) return result.data;
        lastError = result.error.message;
      } else {
        lastError = parsed.error;
      }
    }
    throw new Error(`ModSpec 校验失败（重试 ${MAX_RETRIES} 次）：${lastError}`);
  }

  private buildPrompt(desc: string, err: string): string {
    const base = `你是 Minecraft mod 规格生成器。根据描述生成 loader 无关的 ModSpec JSON。
描述：${desc}
只输出 JSON，不要解释。Schema：modId(小写下划线), version, name, description, items[], blocks[]。`;
    return err ? `${base}\n上次错误：${err}\n请修正。` : base;
  }

  private tryParse(raw: string): { ok: true; value: unknown } | { ok: false; error: string } {
    try {
      return { ok: true, value: JSON.parse(raw) };
    } catch (e) {
      return { ok: false, error: `JSON 解析失败：${(e as Error).message}` };
    }
  }
}
```

- [ ] **Step 4: 写 `index.ts`**

```typescript
export * from './orchestrator.js';
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @mc-creator/core test -- orchestrator`
Expected: PASS（3 个用例）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/orchestrator
git commit -m "feat(core): AI 编排器与 schema 校验重试"
```

---

## Task 9: core 构建器 — JDK 检测

**Files:**

- Create: `packages/core/src/builder/jdk.ts`
- Create: `packages/core/src/builder/index.ts`
- Test: `packages/core/src/builder/builder.test.ts`

- [ ] **Step 1: 写失败测试 `builder.test.ts`**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { detectJavaVersion } from './jdk.js';

describe('detectJavaVersion', () => {
  it('从 java -version 输出解析主版本', async () => {
    const run = vi.fn().mockResolvedValue('openjdk version "21.0.3" 2024-04-16');
    expect(await detectJavaVersion(run)).toBe(21);
  });

  it('解析 Java 25', async () => {
    const run = vi.fn().mockResolvedValue('openjdk version "25" 2025-09-16');
    expect((await detectJavaVersion(run).catch(() => null)) ?? (await detectJavaVersion(run))).toBe(
      25,
    );
  });

  it('java 不存在返回 null', async () => {
    const run = vi.fn().mockRejectedValue(new Error('not found'));
    expect(await detectJavaVersion(run)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/core test -- builder`
Expected: FAIL — `detectJavaVersion is not defined`

- [ ] **Step 3: 写 `jdk.ts`**

```typescript
/** 检测本机 Java 主版本（规格 §5：1.21.x 需 21，26.1 需 25） */
export async function detectJavaVersion(
  run: (cmd: string) => Promise<string> = defaultRun,
): Promise<number | null> {
  try {
    const out = await run('java -version');
    // openjdk version "21.0.3" ... 或 openjdk version "25" ...
    const m = out.match(/version "(\d+)(?:\.|$)/);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

async function defaultRun(cmd: string): Promise<string> {
  const { execa } = await import('execa');
  const r = await execa(cmd.split(' ')[0], cmd.split(' ').slice(1), { reject: false });
  // java -version 输出在 stderr
  return (r.stderr || r.stdout).toString();
}
```

- [ ] **Step 4: 写 `index.ts`**

```typescript
export * from './jdk.js';
export * from './gradle.js';
export * from './log-parser.js';
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @mc-creator/core test -- builder`
Expected: PASS（3 个用例）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/builder
git commit -m "feat(core): JDK 版本检测"
```

---

## Task 10: core 构建器 — Gradle 调用与日志解析

**Files:**

- Create: `packages/core/src/builder/gradle.ts`
- Create: `packages/core/src/builder/log-parser.ts`
- Modify: `packages/core/src/builder/builder.test.ts`

- [ ] **Step 1: 写 `log-parser.ts`**

```typescript
/** 解析 Gradle 编译错误日志，定位文件与行号（规格 §5 构建修复循环） */
export interface BuildError {
  file: string;
  line: number;
  message: string;
}

export function parseGradleErrors(log: string): BuildError[] {
  const errors: BuildError[] = [];
  // 形如：/path/Item.java:12: error: ';' expected
  const re = /^(.*?\.java):(\d+):\s*error:\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(log))) errors.push({ file: m[1], line: Number(m[2]), message: m[3] });
  return errors;
}
```

- [ ] **Step 2: 写 `gradle.ts`**

```typescript
import type { execa } from 'execa';

export interface BuildResult {
  success: boolean;
  jarPath: string | null;
  log: string;
}

/** 调用 Gradle 编译并提取产物 .jar（规格 §2.2 构建器） */
export async function runGradleBuild(
  projectPath: string,
  run: (
    cmd: string,
    args: string[],
    opts: any,
  ) => Promise<{ stdout: string; stderr: string; exitCode: number }> = defaultRun,
): Promise<BuildResult> {
  const r = await run('./gradlew', ['build', '--quiet'], { cwd: projectPath });
  const log = `${r.stdout}\n${r.stderr}`;
  if (r.exitCode !== 0) return { success: false, jarPath: null, log };
  // 产物在 build/libs/*.jar（排除 sources/javadoc）
  const jar = log.match(/build\/libs\/([^\s]+\.jar)/)?.[0] ?? null;
  return { success: true, jarPath: jar, log };
}

async function defaultRun(cmd: string, args: string[], opts: any) {
  const e = await import('execa');
  const r = await e.execa(cmd, args, { ...opts, reject: false });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), exitCode: r.exitCode ?? 0 };
}
```

- [ ] **Step 3: 追加测试到 `builder.test.ts`**

```typescript
import { parseGradleErrors } from './log-parser.js';
import { runGradleBuild } from './gradle.js';

describe('parseGradleErrors', () => {
  it('解析 java 编译错误', () => {
    const log = "/proj/src/Item.java:12: error: ';' expected\nother line";
    const errs = parseGradleErrors(log);
    expect(errs).toHaveLength(1);
    expect(errs[0]).toMatchObject({
      file: '/proj/src/Item.java',
      line: 12,
      message: "';' expected",
    });
  });
});

describe('runGradleBuild', () => {
  it('成功时返回 jarPath', async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: 'BUILD SUCCESSFUL\nbuild/libs/demo-1.0.0.jar',
      stderr: '',
      exitCode: 0,
    });
    const r = await runGradleBuild('/proj', run as any);
    expect(r.success).toBe(true);
    expect(r.jarPath).toContain('demo-1.0.0.jar');
  });

  it('失败时 success=false 且 log 含错误', async () => {
    const run = vi.fn().mockResolvedValue({ stdout: 'BUILD FAILED', stderr: 'error', exitCode: 1 });
    const r = await runGradleBuild('/proj', run as any);
    expect(r.success).toBe(false);
    expect(r.jarPath).toBeNull();
  });
});
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/core test -- builder`
Expected: PASS（全部 6 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/core/src/builder
git commit -m "feat(core): Gradle 调用与编译错误日志解析"
```

---

## Task 11: core 生成器注册表

**Files:**

- Create: `packages/core/src/generators/types.ts`
- Create: `packages/core/src/generators/registry.ts`
- Create: `packages/core/src/generators/index.ts`
- Test: `packages/core/src/generators/registry.test.ts`

- [ ] **Step 1: 写 `types.ts`（统一 Generator 接口，规格 §2.3）**

```typescript
import type { GeneratorContext, GenerationResult } from '@mc-creator/shared';
import type { Loader, McVersion } from '@mc-creator/shared';

export interface Generator {
  readonly type: string; // 'mod' | 'datapack' | ...
  readonly loaders: Loader[]; // 支持的 loader
  readonly versions: McVersion[]; // 支持的 MC 版本
  generate(ctx: GeneratorContext): Promise<GenerationResult>;
}
```

- [ ] **Step 2: 写 `registry.ts`**

```typescript
import type { Generator } from './types.js';
import type { Loader, McVersion } from '@mc-creator/shared';

/** 生成器注册表：按类型路由，能力声明匹配（规格 §2.2） */
export class GeneratorRegistry {
  private map = new Map<string, Generator>();

  register(g: Generator): void {
    this.map.set(g.type, g);
  }

  get(type: string): Generator | undefined {
    return this.map.get(type);
  }

  /** 找到支持指定 loader+版本 的生成器 */
  find(type: string, loader: Loader, version: McVersion): Generator | undefined {
    const g = this.map.get(type);
    if (!g) return undefined;
    if (!g.loaders.includes(loader)) return undefined;
    if (!g.versions.includes(version)) return undefined;
    return g;
  }

  list(): Generator[] {
    return [...this.map.values()];
  }
}
```

- [ ] **Step 3: 写 `index.ts`**

```typescript
export * from './types.js';
export * from './registry.js';
```

- [ ] **Step 4: 写失败测试 `registry.test.ts`**

```typescript
import { describe, it, expect } from 'vitest';
import { GeneratorRegistry } from './registry.js';
import type { Generator } from './types.js';

const modGen = (loaders: any[], versions: any[]): Generator => ({
  type: 'mod',
  loaders,
  versions,
  generate: async () => ({ files: [], warnings: [], buildCmd: '' }),
});

describe('GeneratorRegistry', () => {
  it('注册后可按 type 取', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric'], ['1.21.11']));
    expect(r.get('mod')?.type).toBe('mod');
  });

  it('find 匹配 loader+版本', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric', 'neoforge'], ['1.21.11']));
    expect(r.find('mod', 'fabric', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'fabric', '26.1')).toBeUndefined();
  });

  it('list 返回全部', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric'], ['1.21.11']));
    expect(r.list()).toHaveLength(1);
  });
});
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @mc-creator/core test -- generators`
Expected: PASS（3 个用例）

- [ ] **Step 6: 提交**

```bash
git add packages/core/src/generators
git commit -m "feat(core): 生成器接口与注册表"
```

---

## Task 12: core 出口汇总与全量测试

**Files:**

- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: 更新 `packages/core/src/index.ts`**

```typescript
export * from './filesystem/index.js';
export * from './model-provider/index.js';
export * from './orchestrator/index.js';
export * from './builder/index.js';
export * from './generators/index.js';
```

- [ ] **Step 2: 全量测试**

Run: `pnpm --filter @mc-creator/core test`
Expected: 全部 PASS（filesystem 5 + model-provider 2 + orchestrator 3 + builder 6 + generators 3 = 19 用例）

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @mc-creator/core typecheck`
Expected: 无错误

- [ ] **Step 4: 提交**

```bash
git add packages/core/src/index.ts
git commit -m "feat(core): 汇总出口并跑通全量测试"
```

---

## 自审清单

**1. 规格覆盖**（对应规格 §2.2 六组件、§2.4 编排选型、§5 错误处理、§7 项目结构）：

- ✅ AI 编排器 → Task 8（校验重试；多步/工具调用/流式留 P2 接 AI SDK streamText）
- ✅ 模型提供者 → Task 7（接口 + 能力声明 + mock）
- ✅ 文件系统 → Task 5/6（原子写/diff/快照/回滚）
- ⚠️ 项目管理 → 本计划未实现（纯 CRUD，留 P2/P3，因 v1 个人工具可先直接用文件目录）
- ✅ 构建器 → Task 9/10（JDK 检测 + Gradle + 日志解析）
- ✅ 生成器注册表 → Task 11
- ✅ §2.4 编排选型 → Task 8 注释标明薄编排层
- ✅ §5 错误处理 → Task 8 重试、Task 9 Java 版本、Task 10 构建失败
- ✅ §7 项目结构 → Task 1/4 monorepo
- 项目管理组件的缺失已在上文标注，属合理推迟（YAGNI，个人工具阶段）

**2. 占位符扫描**：无 TBD/TODO，每步含完整代码与命令。

**3. 类型一致性**：`ModSpec`/`GeneratorContext`/`GenerationResult` 在 Task 3 定义，Task 8/11 引用名一致；`Generator` 接口在 Task 11 定义后被注册表引用一致；`detectJavaVersion`/`runGradleBuild`/`parseGradleErrors` 命名跨任务一致。

---

## 执行交接

P1 基础地基计划完成，已保存至 `docs/superpowers/plans/2026-07-13-mc-creator-foundation.md`。

后续：P2（Mod 生成器 + Loader Adapters）、P3（Electron UI + 端到端）将各开计划。
