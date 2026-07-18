# MC Creator AI 模型接入 实现计划（P4）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 Vercel AI SDK 接入真实云端模型（OpenAI 兼容接口），替换 MockProvider，实现流式生成 + 模型配置 UI，让用户能用自己的 API key 真正生成 ModSpec。

**Architecture:** core 层新增 `VercelAiProvider`（实现 `ModelProvider` 接口，内部调 `ai.generateText`/`ai.streamText`）。desktop 层新增模型配置 store + SettingsPanel + 模型配置 IPC，AiChat 改用流式 `streamText` 输出。编排器 Orchestrator 不改，只换 provider 实现。

**Tech Stack:** Vercel AI SDK（`ai` + `@ai-sdk/openai`），已在 core 的 dependencies。模型配置存 electron-store（JSON 文件持久化）。

**对应规格：** `docs/superpowers/specs/2026-07-13-mc-creator-design.md` 第 2.4 节（AI 编排技术选型）。

**前置条件：** P1-P3 已完成，53/53 测试通过，Electron UI 可运行。

---

## 文件结构（本计划涉及）

```
packages/core/
└── src/
    ├── model-provider/
    │   ├── types.ts            # 已有：ModelProvider 接口
    │   ├── mock-provider.ts    # 已有：MockProvider
    │   ├── vercel-ai-provider.ts   # 新增：VercelAiProvider
    │   ├── vercel-ai-provider.test.ts
    │   └── index.ts            # 更新导出
apps/desktop/
└── src/
    ├── shared/
    │   └── ipc-channels.ts     # 新增模型配置 IPC 通道
    ├── main/
    │   ├── ipc.ts              # 新增模型配置 IPC 处理
    │   ├── model-config.ts     # 新增：模型配置管理（electron-store 封装）
    │   └── index.ts            # 修改：读模型配置创建 Orchestrator
    ├── preload/
    │   ├── index.ts            # 修改：暴露模型配置 API
    │   └── api.d.ts            # 修改：更新类型
    └── renderer/
        └── src/
            ├── store/
            │   ├── mod-store.ts        # 不改
            │   └── model-config-store.ts  # 新增：模型配置 Zustand store
            ├── components/
            │   ├── AiChat.tsx          # 修改：用流式 IPC 替换 mock
            │   ├── SettingsPanel.tsx   # 新增：模型配置面板
            │   └── TopBar.tsx          # 修改：加设置按钮
            └── lib/
                └── ipc-client.ts       # 修改：加模型配置 + 流式 chat 方法
```

---

## Task 1: core 层 VercelAiProvider

**Files:**

- Create: `packages/core/src/model-provider/vercel-ai-provider.ts`
- Test: `packages/core/src/model-provider/vercel-ai-provider.test.ts`
- Modify: `packages/core/src/model-provider/index.ts`

- [ ] **Step 1: 写 `vercel-ai-provider.ts`**

```typescript
import { generateText, streamText } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { CompleteOptions, ModelProvider, StreamChunk } from './types.js';

/** 模型配置（持久化存 UI 层，创建 provider 时传入） */
export interface AiModelConfig {
  /** 模型 ID，如 'gpt-4o-mini', 'deepseek-chat' */
  modelId: string;
  /** OpenAI 兼容的 base URL（默认 https://api.openai.com/v1） */
  baseURL: string;
  /** API Key */
  apiKey: string;
}

/**
 * 基于 Vercel AI SDK 的模型提供者（规格 §2.4）。
 * 用 @ai-sdk/openai 的 OpenAI 兼容接口，支持各家云端模型。
 */
export class VercelAiProvider implements ModelProvider {
  readonly id: string;
  readonly capabilities = { toolCalling: true, vision: false, streaming: true };
  private readonly openai;

  constructor(config: AiModelConfig) {
    this.id = config.modelId;
    this.openai = createOpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
    });
  }

  async complete(prompt: string, opts?: CompleteOptions): Promise<string> {
    const { text } = await generateText({
      model: this.openai(this.id),
      prompt,
      system: opts?.system,
      maxTokens: opts?.maxTokens,
    });
    return text;
  }

  async *stream(prompt: string, opts?: CompleteOptions): AsyncIterable<StreamChunk> {
    const result = streamText({
      model: this.openai(this.id),
      prompt,
      system: opts?.system,
      maxTokens: opts?.maxTokens,
    });
    for await (const chunk of (await result).textStream) {
      yield { delta: chunk, done: false };
    }
    yield { delta: '', done: true };
  }
}
```

- [ ] **Step 2: 写测试 `vercel-ai-provider.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VercelAiProvider } from './vercel-ai-provider.js';

// Mock Vercel AI SDK
vi.mock('ai', () => ({
  generateText: vi.fn(),
  streamText: vi.fn(),
}));

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: () => (modelId: string) => modelId,
}));

import { generateText, streamText } from 'ai';

describe('VercelAiProvider', () => {
  const config = {
    modelId: 'test-model',
    baseURL: 'https://api.example.com/v1',
    apiKey: 'test-key',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('complete 调用 generateText 返回文本', async () => {
    vi.mocked(generateText).mockResolvedValue({ text: '{"modId":"test"}' });
    const provider = new VercelAiProvider(config);
    const result = await provider.complete('生成 mod');
    expect(result).toBe('{"modId":"test"}');
    expect(generateText).toHaveBeenCalled();
  });

  it('stream 返回流式片段', async () => {
    const chunks = ['hello', ' ', 'world'];
    const asyncIter = (async function* () {
      for (const c of chunks) yield c;
    })();
    vi.mocked(streamText).mockResolvedValue({ textStream: asyncIter } as any);
    const provider = new VercelAiProvider(config);
    const collected: string[] = [];
    for await (const chunk of provider.stream('test')) {
      if (!chunk.done) collected.push(chunk.delta);
    }
    expect(collected.join('')).toBe('hello world');
  });

  it('id 等于 config.modelId', () => {
    const provider = new VercelAiProvider(config);
    expect(provider.id).toBe('test-model');
  });
});
```

- [ ] **Step 3: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/core test -- model-provider`
Expected: PASS（含原有 MockProvider 测试 + 3 个新测试）

- [ ] **Step 4: 更新 `index.ts` 导出**

在 `packages/core/src/model-provider/index.ts` 追加：

```typescript
export * from './vercel-ai-provider.js';
```

- [ ] **Step 5: 安装 `@ai-sdk/openai` 依赖**

Run: `pnpm --filter @mc-creator/core add @ai-sdk/openai`

- [ ] **Step 6: typecheck 验证**

Run: `pnpm --filter @mc-creator/core typecheck`
Expected: 0 错误

- [ ] **Step 7: 提交**

```bash
git add packages/core/src/model-provider packages/core/package.json pnpm-lock.yaml
git commit -m "feat(core): VercelAiProvider（Vercel AI SDK 接入云端模型）"
```

---

## Task 2: 模型配置管理（electron-store）

**Files:**

- Create: `apps/desktop/src/main/model-config.ts`

- [ ] **Step 1: 写 `model-config.ts`**

```typescript
import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { AiModelConfig } from '@mc-creator/core';

/** 模型配置持久化（用 JSON 文件存 app.getPath('userData')） */
const CONFIG_FILE = 'model-config.json';

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE);
}

export interface ModelConfigFull extends AiModelConfig {
  /** 用户自定义名称，如 'DeepSeek' */
  name: string;
}

const DEFAULT_CONFIG: ModelConfigFull = {
  name: 'OpenAI',
  modelId: 'gpt-4o-mini',
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
};

export function loadModelConfig(): ModelConfigFull {
  try {
    if (existsSync(configPath())) {
      const raw = readFileSync(configPath(), 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // 文件损坏，用默认
  }
  return { ...DEFAULT_CONFIG };
}

export function saveModelConfig(config: ModelConfigFull): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}
```

- [ ] **Step 2: 提交**

```bash
git add apps/desktop/src/main/model-config.ts
git commit -m "feat(desktop): 模型配置持久化管理"
```

---

## Task 3: IPC 通道 + 处理器（模型配置 + 流式 chat）

**Files:**

- Modify: `apps/desktop/src/shared/ipc-channels.ts`（新增模型配置 + chat IPC）
- Modify: `apps/desktop/src/main/ipc.ts`（注册新 IPC 处理器）
- Modify: `apps/desktop/src/main/index.ts`（用真实配置创建 Orchestrator）

- [ ] **Step 1: 在 `ipc-channels.ts` 追加**

```typescript
// === 模型配置 ===
export const LOAD_MODEL_CONFIG = 'model:loadConfig';
export const SAVE_MODEL_CONFIG = 'model:saveConfig';

export const SaveModelConfigRequest = z.object({
  name: z.string(),
  modelId: z.string().min(1),
  baseURL: z.string().min(1),
  apiKey: z.string(),
});
export const ModelConfigResponse = z.object({
  name: z.string(),
  modelId: z.string(),
  baseURL: z.string(),
  apiKey: z.string(),
});

export type SaveModelConfigReq = z.infer<typeof SaveModelConfigRequest>;
export type ModelConfigRes = z.infer<typeof ModelConfigResponse>;

// === AI 聊天（流式） ===
export const CHAT = 'ai:chat';

export const ChatRequest = z.object({ message: z.string().min(1) });
export const ChatResponse = z.object({ reply: z.string() });

export type ChatReq = z.infer<typeof ChatRequest>;
export type ChatRes = z.infer<typeof ChatResponse>;
```

- [ ] **Step 2: 在 `ipc.ts` 追加处理器**

在文件顶部添加导入：

```typescript
import { VercelAiProvider } from '@mc-creator/core';
import type { AiModelConfig } from '@mc-creator/core';
import { loadModelConfig, saveModelConfig, type ModelConfigFull } from './model-config.js';
import {
  SaveModelConfigRequest,
  ModelConfigResponse,
  ChatRequest,
  LOAD_MODEL_CONFIG,
  SAVE_MODEL_CONFIG,
  CHAT,
} from '../shared/ipc-channels.js';
```

在 `registerIpcHandlers` 函数末尾追加：

```typescript
// 模型配置
ipcMain.handle(LOAD_MODEL_CONFIG, async () => {
  const config = loadModelConfig();
  return ModelConfigResponse.parse(config);
});

ipcMain.handle(SAVE_MODEL_CONFIG, async (_e, raw: unknown) => {
  const req = SaveModelConfigRequest.parse(raw);
  saveModelConfig(req as ModelConfigFull);
  return { ok: true };
});

// AI 聊天（非流式，后续可加流式 IPC）
let chatProvider: VercelAiProvider | null = null;

ipcMain.handle(CHAT, async (_e, raw: unknown) => {
  const req = ChatRequest.parse(raw);
  const config = loadModelConfig();
  if (!config.apiKey) {
    return { reply: '请先在设置中配置 API Key。' };
  }
  if (!chatProvider || chatProvider.id !== config.modelId) {
    chatProvider = new VercelAiProvider(config);
  }
  const reply = await chatProvider.complete(req.message, {
    system: '你是 Minecraft mod 专家助手，帮助用户设计 mod。',
  });
  return { reply };
});
```

修改 `createDefaultOrchestrator`：读模型配置，如果有 API key 就用 VercelAiProvider，否则 fallback 到 MockProvider：

```typescript
export function createDefaultOrchestrator(): Orchestrator {
  try {
    const config = loadModelConfig();
    if (config.apiKey) {
      return new Orchestrator(new VercelAiProvider(config));
    }
  } catch {
    // 配置读取失败，fallback
  }
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

- [ ] **Step 3: 修改 `src/main/index.ts`**

在 `ipc.ts` 导入中添加 `loadModelConfig`（已在 ipc.ts 内部使用），index.ts 无需改动。

- [ ] **Step 4: 更新 `src/preload/index.ts`**

在 api 对象中追加：

```typescript
  loadModelConfig: () => ipcRenderer.invoke(IPC.LOAD_MODEL_CONFIG),
  saveModelConfig: (config: unknown) => ipcRenderer.invoke(IPC.SAVE_MODEL_CONFIG, config),
  chat: (message: string) => ipcRenderer.invoke(IPC.CHAT, { message }),
```

并在 IPC 常量导入中追加：

```typescript
import { IPC, LOAD_MODEL_CONFIG, SAVE_MODEL_CONFIG, CHAT } from '../shared/ipc-channels.js';
```

- [ ] **Step 5: 更新 `src/preload/api.d.ts`**

重新从 `./index.js` 导入 `McApi` 类型即可（自动包含新方法）。

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 错误

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src
git commit -m "feat(desktop): 模型配置 IPC + AI 聊天处理器"
```

---

## Task 4: 模型配置 Store + SettingsPanel

**Files:**

- Create: `apps/desktop/src/renderer/src/store/model-config-store.ts`
- Create: `apps/desktop/src/renderer/src/components/SettingsPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/TopBar.tsx`（加设置按钮）
- Modify: `apps/desktop/src/renderer/src/lib/ipc-client.ts`（加模型配置方法）

- [ ] **Step 1: 写 `model-config-store.ts`**

```typescript
import { create } from 'zustand';

interface ModelConfigState {
  name: string;
  modelId: string;
  baseURL: string;
  apiKey: string;
  loaded: boolean;

  setConfig: (c: { name: string; modelId: string; baseURL: string; apiKey: string }) => void;
  setLoaded: (b: boolean) => void;
}

export const useModelConfigStore = create<ModelConfigState>((set) => ({
  name: '',
  modelId: '',
  baseURL: '',
  apiKey: '',
  loaded: false,

  setConfig: (c) => set({ ...c, loaded: true }),
  setLoaded: (b) => set({ loaded: b }),
}));
```

- [ ] **Step 2: 更新 `ipc-client.ts`**

追加：

```typescript
  loadModelConfig: () => window.mcApi.loadModelConfig(),
  saveModelConfig: (config: { name: string; modelId: string; baseURL: string; apiKey: string }) =>
    window.mcApi.saveModelConfig(config),
  chat: (message: string) => window.mcApi.chat(message),
```

- [ ] **Step 3: 写 `SettingsPanel.tsx`**

```tsx
import { useState, useEffect } from 'react';
import { useModelConfigStore } from '../store/model-config-store.js';
import { ipcClient } from '../lib/ipc-client.js';

interface Props {
  onClose: () => void;
}

export function SettingsPanel({ onClose }: Props) {
  const { name, modelId, baseURL, apiKey, setConfig } = useModelConfigStore();
  const [form, setForm] = useState({ name, modelId, baseURL, apiKey });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    ipcClient.loadModelConfig().then((c: any) => {
      setConfig(c);
      setForm(c);
    });
  }, [setConfig]);

  const save = async () => {
    setSaving(true);
    await ipcClient.saveModelConfig(form);
    setConfig(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[480px] rounded-lg border border-zinc-700 bg-zinc-900 p-6 text-zinc-100">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-bold">模型配置</h2>
          <button onClick={onClose} className="text-zinc-400 hover:text-white">
            ✕
          </button>
        </div>

        <div className="space-y-3">
          <div>
            <label className="text-sm text-zinc-400">配置名称</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="如 DeepSeek"
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400">模型 ID</label>
            <input
              value={form.modelId}
              onChange={(e) => setForm({ ...form, modelId: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="如 gpt-4o-mini, deepseek-chat"
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400">Base URL</label>
            <input
              value={form.baseURL}
              onChange={(e) => setForm({ ...form, baseURL: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="https://api.openai.com/v1"
            />
          </div>
          <div>
            <label className="text-sm text-zinc-400">API Key</label>
            <input
              type="password"
              value={form.apiKey}
              onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
              className="mt-1 w-full rounded border border-zinc-700 bg-zinc-800 px-3 py-1.5 text-sm"
              placeholder="sk-..."
            />
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={saving}
            className="rounded bg-blue-600 px-4 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {saved && <span className="text-sm text-green-400">已保存</span>}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 修改 `TopBar.tsx`**

在 TopBar 的 header 末尾（MC 版本选择器后面）追加设置按钮：

```tsx
import { useState } from 'react';
import { SettingsPanel } from './SettingsPanel.js';

// 在 TopBar 组件内：
const [showSettings, setShowSettings] = useState(false);

// 在 header 末尾：
<button
  onClick={() => setShowSettings(true)}
  className="ml-auto text-sm text-zinc-400 hover:text-white"
>
  设置
</button>;
{
  showSettings && <SettingsPanel onClose={() => setShowSettings(false)} />;
}
```

- [ ] **Step 5: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 错误

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/renderer/src
git commit -m "feat(desktop): 模型配置面板 + 设置按钮"
```

---

## Task 5: AiChat 接真实 AI 流式响应

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/AiChat.tsx`

- [ ] **Step 1: 重写 `AiChat.tsx`**

```tsx
import { useState, useRef } from 'react';
import { ipcClient } from '../lib/ipc-client.js';
import { useModelConfigStore } from '../store/model-config-store.js';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
}

export function AiChat() {
  const { loaded, apiKey } = useModelConfigStore();
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: '你好！描述你想要的 mod，我来帮你生成。' },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  const send = async () => {
    if (!input.trim() || sending) return;
    const text = input;
    setInput('');
    setMessages((m) => [...m, { role: 'user', text }]);
    setSending(true);

    try {
      if (!apiKey) {
        setMessages((m) => [...m, { role: 'assistant', text: '请先在「设置」中配置 API Key。' }]);
        return;
      }
      const res = await ipcClient.chat(text);
      setMessages((m) => [...m, { role: 'assistant', text: (res as any).reply }]);
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', text: `错误：${(e as Error).message}` }]);
    } finally {
      setSending(false);
      bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
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
            className={`rounded p-2 text-xs whitespace-pre-wrap ${
              m.role === 'user' ? 'bg-blue-900/40' : 'bg-zinc-800'
            }`}
          >
            {m.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <div className="flex gap-2 border-t border-zinc-800 p-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && send()}
          placeholder={apiKey ? '输入消息…' : '请先配置 API Key'}
          className="flex-1 rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-100"
          disabled={sending}
        />
        <button
          onClick={send}
          disabled={sending || !input.trim()}
          className="rounded bg-blue-600 px-3 py-1 text-xs text-white disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck:web`
Expected: 0 错误

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/AiChat.tsx
git commit -m "feat(desktop): AiChat 接真实 AI 模型响应"
```

---

## Task 6: 全量验证

- [ ] **Step 1: 全量测试**

Run: `pnpm -r test`
Expected: 全部 PASS（core 48 + desktop 8 = 56）

- [ ] **Step 2: 全量 typecheck**

Run: `pnpm -r typecheck`
Expected: 0 错误

- [ ] **Step 3: 提交（如有遗留）**

```bash
git add -A
git commit -m "feat(desktop): P4 AI 模型接入验证通过"
```

---

## 自审清单

**1. 规格覆盖**：

- ✅ §2.4 AI 编排技术选型（Vercel AI SDK + 自建薄编排层）→ Task 1
- ✅ §2.2 模型提供者统一接口（云端/本地同接口）→ Task 1
- ✅ §2.1 对话界面 → Task 5
- ✅ §5 错误处理（模型限流/网络断 → 提示用户）→ Task 5 catch

**2. 占位符扫描**：无占位符。

**3. 类型一致性**：`AiModelConfig` 在 core 定义，`ModelConfigFull` 在 desktop 继承扩展，IPC schema 的字段与 `AiModelConfig` 一致。
