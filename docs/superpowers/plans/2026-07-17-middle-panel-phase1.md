# 中间预览面板按 generatorType 调度 — 阶段 1 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现中间预览面板的调度框架（MiddlePanel + 预览/代码 tab 切换），完成 Schema 变更（删 texture、加 launcher），并实现最简单的 ServerPreviewPanel 作为首个面板。

**Architecture:** MiddlePanel 是中间面板的入口，顶部有"预览/代码"两个 tab。预览 tab 根据 `useModStore.generatorType` 调度到对应的 XxxPreviewPanel；代码 tab 复用现有 CodePreview + TabBar 逻辑。阶段 1 只实现 ServerPreviewPanel（表单类，最简单），其余 6 个面板在后续阶段实现。

**Tech Stack:** React 18 + TypeScript 5 + Zustand 4 + Tailwind CSS 3 + Zod 3 + Vitest 2

**Spec:** [2026-07-17-middle-panel-per-generator-design.md](file:///d:/MC%20mod/docs/superpowers/specs/2026-07-17-middle-panel-per-generator-design.md)

---

## 文件结构

### 新建

- `packages/shared/src/schemas/launcher-spec.ts` — LauncherSpec Zod schema
- `packages/shared/src/schemas/launcher-spec.test.ts` — LauncherSpec 单测
- `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx` — 调度器（预览/代码 tab + 按 generatorType 分发）
- `apps/desktop/src/renderer/src/components/middle/ServerPreviewPanel.tsx` — server 类型预览面板（表单）

### 修改

- `apps/desktop/src/shared/ipc-channels.ts` — GENERATOR_TYPES 删 texture 加 launcher
- `packages/shared/src/schemas/index.ts` — 导出 LauncherSpec
- `apps/desktop/src/renderer/src/components/TopToolbar.tsx` — TYPE_LABELS 更新
- `apps/desktop/src/renderer/src/components/AgentPanel.tsx` — placeholder 删 texture 加 launcher
- `apps/desktop/src/renderer/src/store/project-store.ts` — texture → resource_pack 迁移
- `apps/desktop/src/renderer/src/App.tsx` — 用 MiddlePanel 替换 TabBar + CodePreview

---

## Task 1: 更新 GENERATOR_TYPES（删 texture 加 launcher）

**Files:**

- Modify: `apps/desktop/src/shared/ipc-channels.ts:4`

- [ ] **Step 1: 修改 GENERATOR_TYPES**

把第 4 行：

```typescript
export const GENERATOR_TYPES = [
  'mod',
  'datapack',
  'modpack',
  'server',
  'texture',
  'skin',
  'resource_pack',
] as const;
```

改为：

```typescript
export const GENERATOR_TYPES = [
  'mod',
  'datapack',
  'modpack',
  'server',
  'resource_pack',
  'skin',
  'launcher',
] as const;
```

同时更新第 3 行的注释：

```typescript
/** 生成器类型联合（mod/datapack/modpack/server/resource_pack/skin/launcher） */
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: 失败，提示 `TopToolbar.tsx` 和 `AgentPanel.tsx` 中 `texture` case 不再合法，以及 `TYPE_LABELS` 缺少 `launcher` key。这些错误会在 Task 4、5 中修复。

- [ ] **Step 3: 暂不提交，继续 Task 2**

---

## Task 2: 新建 LauncherSpec schema + 测试

**Files:**

- Create: `packages/shared/src/schemas/launcher-spec.ts`
- Test: `packages/shared/src/schemas/launcher-spec.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/schemas/launcher-spec.test.ts`：

```typescript
import { describe, it, expect } from 'vitest';
import { LauncherSpec } from './launcher-spec.js';

describe('LauncherSpec schema', () => {
  it('最小合法 spec（仅 launcherName + mcVersion）填充默认值', () => {
    const r = LauncherSpec.parse({ launcherName: 'my-launcher', mcVersion: '1.21.1' });
    expect(r.launcherType).toBe('official');
    expect(r.profileName).toBe('default');
    expect(r.loader).toBe('vanilla');
    expect(r.javaPath).toBe('');
    expect(r.jvmArgs).toBe('-Xmx2G -Xms1G');
    expect(r.memoryMin).toBe(1024);
    expect(r.memoryMax).toBe(2048);
    expect(r.accountType).toBe('offline');
    expect(r.username).toBe('Player');
    expect(r.uuid).toBe('');
    expect(r.serverAutorun).toBe('');
    expect(r.fullscreen).toBe(false);
    expect(r.resolutionWidth).toBe(854);
    expect(r.resolutionHeight).toBe(480);
  });

  it('launcherType 枚举校验', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', launcherType: 'unknown' }),
    ).toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', launcherType: 'pcl2' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', launcherType: 'hmcl' }),
    ).not.toThrow();
  });

  it('loader 枚举校验（含 vanilla）', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', loader: 'vanilla' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', loader: 'fabric' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', loader: 'unknown' }),
    ).toThrow();
  });

  it('accountType 枚举校验', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', accountType: 'offline' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', accountType: 'microsoft' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', accountType: 'cracked' }),
    ).toThrow();
  });

  it('memoryMin 范围校验（>=512）', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', memoryMin: 256 }),
    ).toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', memoryMin: 512 }),
    ).not.toThrow();
  });

  it('memoryMax 范围校验（>=1024）', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', memoryMax: 512 }),
    ).toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', memoryMax: 1024 }),
    ).not.toThrow();
  });

  it('完整 spec round-trip', () => {
    const input = {
      launcherName: 'pcl2-profile',
      launcherType: 'pcl2' as const,
      profileName: 'survival',
      mcVersion: '1.20.4',
      loader: 'fabric' as const,
      javaPath: 'C:/java/jdk17/bin/java.exe',
      jvmArgs: '-Xmx4G -Xms2G',
      memoryMin: 2048,
      memoryMax: 4096,
      accountType: 'microsoft' as const,
      username: 'Alice',
      uuid: 'abc-123',
      serverAutorun: 'mc.example.com',
      fullscreen: true,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
    };
    const r = LauncherSpec.parse(input);
    expect(r.launcherName).toBe('pcl2-profile');
    expect(r.launcherType).toBe('pcl2');
    expect(r.memoryMax).toBe(4096);
    expect(r.fullscreen).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试验证失败**

Run: `pnpm test --filter launcher-spec`
Expected: FAIL with "Cannot find module './launcher-spec.js'"

- [ ] **Step 3: 创建 LauncherSpec schema**

创建 `packages/shared/src/schemas/launcher-spec.ts`：

```typescript
import { z } from 'zod';

/** LauncherSpec：启动器配置规格（P23-3 新增） */
export const LauncherSpec = z.object({
  launcherName: z.string(),
  launcherType: z.enum(['official', 'pcl2', 'hmcl']).default('official'),
  profileName: z.string().default('default'),
  mcVersion: z.string(),
  loader: z.enum(['fabric', 'neoforge', 'quilt', 'legacy_fabric', 'vanilla']).default('vanilla'),
  javaPath: z.string().default(''),
  jvmArgs: z.string().default('-Xmx2G -Xms1G'),
  memoryMin: z.number().int().min(512).default(1024),
  memoryMax: z.number().int().min(1024).default(2048),
  accountType: z.enum(['offline', 'microsoft']).default('offline'),
  username: z.string().default('Player'),
  uuid: z.string().default(''),
  serverAutorun: z.string().default(''),
  fullscreen: z.boolean().default(false),
  resolutionWidth: z.number().int().default(854),
  resolutionHeight: z.number().int().default(480),
});

export type LauncherSpec = z.infer<typeof LauncherSpec>;
```

- [ ] **Step 4: 运行测试验证通过**

Run: `pnpm test --filter launcher-spec`
Expected: PASS (7 用例)

- [ ] **Step 5: 导出 LauncherSpec**

修改 `packages/shared/src/schemas/index.ts`，在末尾新增一行：

```typescript
export * from './launcher-spec.js';
```

完整文件应为：

```typescript
export * from './mod-spec.js';
export * from './generator.js';
export * from './datapack-spec.js';
export * from './modpack-spec.js';
export * from './server-spec.js';
export * from './texture-spec.js';
export * from './resource-pack-spec.js';
export * from './launcher-spec.js';
```

- [ ] **Step 6: 提交**

```bash
cd "d:/MC mod"
git add apps/desktop/src/shared/ipc-channels.ts packages/shared/src/schemas/launcher-spec.ts packages/shared/src/schemas/launcher-spec.test.ts packages/shared/src/schemas/index.ts
git commit -m "feat(schema): 新增 LauncherSpec，GENERATOR_TYPES 删 texture 加 launcher"
```

---

## Task 3: 更新 TopToolbar TYPE_LABELS

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/TopToolbar.tsx:17-25`

- [ ] **Step 1: 修改 TYPE_LABELS**

把 [TopToolbar.tsx:17-25](file:///d:/MC%20mod/apps/desktop/src/renderer/src/components/TopToolbar.tsx#L17-L25) 的 `TYPE_LABELS` 改为：

```typescript
const TYPE_LABELS: Record<GeneratorType, string> = {
  mod: 'Mod',
  datapack: '数据包',
  modpack: '整合包',
  server: '服务器',
  resource_pack: '资源包',
  skin: '皮肤',
  launcher: '启动器',
};
```

（删除 `texture: '材质'`，新增 `launcher: '启动器'`）

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: TopToolbar.tsx 不再有错误。AgentPanel.tsx 仍有 `texture` case 错误（Task 4 修复）。

- [ ] **Step 3: 暂不提交，继续 Task 4**

---

## Task 4: 更新 AgentPanel placeholder

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/AgentPanel.tsx:197-209`

- [ ] **Step 1: 修改 placeholder 函数**

把 [AgentPanel.tsx:197-209](file:///d:/MC%20mod/apps/desktop/src/renderer/src/components/AgentPanel.tsx#L197-L209) 的 `placeholder` 函数改为：

```typescript
const placeholder =
  generatorType === 'mod'
    ? '描述你想要的 mod…'
    : generatorType === 'datapack'
      ? '描述你想要的数据包…'
      : generatorType === 'modpack'
        ? '描述你想要的整合包…'
        : generatorType === 'server'
          ? '描述你想要的服务器配置…'
          : generatorType === 'resource_pack'
            ? '描述你想要的资源包…'
            : generatorType === 'skin'
              ? '描述你想要的皮肤…'
              : '描述你想要的启动器配置…';
```

（删除 `texture` case，把最后的 `resource_pack` 改为 `resource_pack`，把 default 改为 `launcher` 提示）

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 3: 运行测试验证**

Run: `pnpm test`
Expected: PASS（68 测试全通过）

- [ ] **Step 4: 提交**

```bash
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/components/TopToolbar.tsx apps/desktop/src/renderer/src/components/AgentPanel.tsx
git commit -m "feat(ui): TopToolbar/AgentPanel 适配新 generatorType 清单"
```

---

## Task 5: 添加 texture → resource_pack 迁移逻辑

**Files:**

- Modify: `apps/desktop/src/renderer/src/store/project-store.ts:90-110`（loadProject 函数）
- Modify: `apps/desktop/src/renderer/src/store/project-store.ts:132-`（importProject 函数）

- [ ] **Step 1: 修改 loadProject 函数**

在 [project-store.ts:90-110](file:///d:/MC%20mod/apps/desktop/src/renderer/src/store/project-store.ts#L90-L110) 的 `loadProject` 函数中，第 100 行 `mod.setGeneratorType(project.generatorType);` 改为：

```typescript
// P23-3 迁移：texture 已合并到 resource_pack
const migratedType = project.generatorType === 'texture' ? 'resource_pack' : project.generatorType;
mod.setGeneratorType(migratedType);
```

- [ ] **Step 2: 查看 importProject 函数完整内容**

Read `apps/desktop/src/renderer/src/store/project-store.ts` 第 132-160 行，找到 importProject 把数据填入 mod-store 的位置。

- [ ] **Step 3: 修改 importProject 函数**

在 importProject 函数中，把 `generatorType` 设置到 mod-store 之前，加同样的迁移逻辑。具体修改位置取决于代码结构，通常在 `mod.setGeneratorType(...)` 调用前加：

```typescript
const migratedType = importedType === 'texture' ? 'resource_pack' : importedType;
mod.setGeneratorType(migratedType);
```

（如果 importProject 通过调用 loadProject 实现，则无需重复加迁移逻辑，Task 5 Step 1 已经覆盖）

- [ ] **Step 4: 运行 typecheck + 测试**

Run: `pnpm typecheck && pnpm test`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/store/project-store.ts
git commit -m "fix(store): texture → resource_pack 迁移逻辑（向后兼容旧项目）"
```

---

## Task 6: 创建 MiddlePanel 调度器

**Files:**

- Create: `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`

- [ ] **Step 1: 创建 middle 目录**

Run: `mkdir -p "d:/MC mod/apps/desktop/src/renderer/src/components/middle"`

- [ ] **Step 2: 创建 MiddlePanel.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`：

```tsx
import { useState } from 'react';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { TabBar } from '../TabBar.js';
import { CodePreview } from '../CodePreview.js';
import { ServerPreviewPanel } from './ServerPreviewPanel.js';
import { useModStore } from '../../store/mod-store.js';

type MiddleTab = 'preview' | 'code';

/**
 * 中间面板调度器：顶部 tab 切换（预览/代码），预览 tab 按 generatorType 分发到对应面板。
 * 阶段 1 只实现 server 面板，其他类型暂显示"开发中"占位。
 */
export function MiddlePanel() {
  const [activeTab, setActiveTab] = useState<MiddleTab>('preview');
  const generatorType = useModStore((s) => s.generatorType);

  const renderPreviewPanel = () => {
    switch (generatorType) {
      case 'server':
        return <ServerPreviewPanel />;
      case 'mod':
      case 'datapack':
      case 'modpack':
      case 'resource_pack':
      case 'skin':
      case 'launcher':
        return <PlaceholderPanel type={generatorType} />;
      default:
        return <PlaceholderPanel type={generatorType} />;
    }
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Tab 切换栏 */}
      <div className="flex items-center border-b border-mc-border bg-mc-surface px-2 py-1">
        <button
          onClick={() => setActiveTab('preview')}
          className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
            activeTab === 'preview'
              ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
              : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
          }`}
        >
          <McIcon scope="pixel" name="star" size={12} />
          预览
        </button>
        <button
          onClick={() => setActiveTab('code')}
          className={`flex items-center gap-1.5 rounded-mc px-3 py-1 text-xs font-medium transition-colors ${
            activeTab === 'code'
              ? 'bg-mc-surface-2 text-mc-text border-b-2 border-mc-accent'
              : 'text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
          }`}
        >
          <McIcon scope="pixel" name="terminal" size={12} />
          代码
        </button>
      </div>

      {/* Tab 内容 */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {activeTab === 'preview' ? (
          renderPreviewPanel()
        ) : (
          <>
            <TabBar />
            <div className="flex-1 overflow-hidden">
              <CodePreview />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** 占位面板：阶段 2-4 实现其他类型时移除 */
function PlaceholderPanel({ type }: { type: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-bg">
      <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
        <McIcon scope="pixel" name="box" size={32} className="text-mc-mute" />
      </div>
      <div className="text-sm font-medium text-mc-dim">{type} 预览面板开发中</div>
      <div className="text-xs text-mc-mute">
        阶段 2-4 实现该类型，当前可切换到「代码」tab 查看文件
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 运行 typecheck 验证失败**

Run: `pnpm typecheck`
Expected: 失败，提示 `./ServerPreviewPanel.js` 不存在（Task 7 创建）

- [ ] **Step 4: 暂不提交，继续 Task 7**

---

## Task 7: 创建 ServerPreviewPanel

**Files:**

- Create: `apps/desktop/src/renderer/src/components/middle/ServerPreviewPanel.tsx`

- [ ] **Step 1: 创建 ServerPreviewPanel.tsx**

创建 `apps/desktop/src/renderer/src/components/middle/ServerPreviewPanel.tsx`：

```tsx
import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import type { ServerSpec } from '@mc-creator/shared';

/**
 * Server 预览面板：以分组表单展示 ServerSpec 字段。
 * 字段修改后写回 useModStore.spec（实时同步）。
 */
export function ServerPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);

  if (!spec) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 bg-mc-bg">
        <div className="flex h-16 w-16 items-center justify-center rounded-mc-lg border border-mc-border bg-mc-surface-2">
          <McIcon scope="pixel" name="server" size={32} className="text-mc-mute" />
        </div>
        <div className="text-sm font-medium text-mc-dim">尚未生成 Server Spec</div>
        <div className="text-xs text-mc-mute">
          在右侧 AgentPanel 描述你想要的服务器，生成 Spec 后即可预览
        </div>
      </div>
    );
  }

  const server = spec as unknown as ServerSpec;

  const updateField = <K extends keyof ServerSpec>(key: K, value: ServerSpec[K]) => {
    const updated = { ...server, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      {/* Header：项目元信息 */}
      <div className="border-b border-mc-border px-4 py-3">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="server" size={16} className="text-mc-accent" />
          <span className="text-sm font-bold text-mc-text">{server.serverName}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">{server.mcVersion}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">端口 {server.port}</span>
        </div>
        <div className="mt-1 text-xs text-mc-mute">{server.motd}</div>
      </div>

      {/* Body：分组表单 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* 基本 */}
        <FieldGroup title="基本">
          <TextField
            label="服务器名称"
            value={server.serverName}
            onChange={(v) => updateField('serverName', v)}
          />
          <TextField label="MOTD" value={server.motd} onChange={(v) => updateField('motd', v)} />
          <NumberField
            label="最大玩家数"
            value={server.maxPlayers}
            min={1}
            max={999}
            onChange={(v) => updateField('maxPlayers', v)}
          />
          <NumberField
            label="端口"
            value={server.port}
            min={1}
            max={65535}
            onChange={(v) => updateField('port', v)}
          />
        </FieldGroup>

        {/* 世界 */}
        <FieldGroup title="世界">
          <TextField
            label="世界名称"
            value={server.levelName}
            onChange={(v) => updateField('levelName', v)}
          />
          <SelectField
            label="游戏模式"
            value={server.gamemode}
            options={[
              { value: 'survival', label: '生存' },
              { value: 'creative', label: '创造' },
              { value: 'adventure', label: '冒险' },
              { value: 'spectator', label: '旁观' },
            ]}
            onChange={(v) => updateField('gamemode', v as ServerSpec['gamemode'])}
          />
          <SelectField
            label="难度"
            value={server.difficulty}
            options={[
              { value: 'peaceful', label: '和平' },
              { value: 'easy', label: '简单' },
              { value: 'normal', label: '普通' },
              { value: 'hard', label: '困难' },
            ]}
            onChange={(v) => updateField('difficulty', v as ServerSpec['difficulty'])}
          />
          <NumberField
            label="出生保护半径"
            value={server.spawnProtection}
            min={0}
            max={100}
            onChange={(v) => updateField('spawnProtection', v)}
          />
        </FieldGroup>

        {/* 玩家 */}
        <FieldGroup title="玩家">
          <ToggleField label="PVP" value={server.pvp} onChange={(v) => updateField('pvp', v)} />
          <ToggleField
            label="正版验证"
            value={server.onlineMode}
            onChange={(v) => updateField('onlineMode', v)}
          />
          <ToggleField
            label="白名单"
            value={server.whitelist}
            onChange={(v) => updateField('whitelist', v)}
          />
          <ToggleField
            label="强制白名单"
            value={server.enforceWhitelist}
            onChange={(v) => updateField('enforceWhitelist', v)}
          />
        </FieldGroup>

        {/* 网络 */}
        <FieldGroup title="网络">
          <TextField
            label="服务器 IP"
            value={server.serverIp ?? ''}
            onChange={(v) => updateField('serverIp', v)}
          />
          <NumberField
            label="视距"
            value={server.viewDistance}
            min={3}
            max={32}
            onChange={(v) => updateField('viewDistance', v)}
          />
          <NumberField
            label="模拟距离"
            value={server.simulationDistance}
            min={3}
            max={32}
            onChange={(v) => updateField('simulationDistance', v)}
          />
        </FieldGroup>
      </div>

      {/* Footer：统计 */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        OP 玩家：{server.ops.length} · 白名单条目：{server.whitelistEntries.length} · 服务器 Mod：
        {server.mods.length}
      </div>
    </div>
  );
}

// ===== 子组件 =====

function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-mc-dim">{title}</div>
      <div className="space-y-2 rounded-mc-lg border border-mc-border bg-mc-surface-2/40 p-3">
        {children}
      </div>
    </div>
  );
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-input flex-1 !py-1 !text-xs"
      />
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(parseInt(e.target.value) || min)}
        className="mc-input w-24 !py-1 !text-xs"
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mc-select flex-1 !py-1 !text-xs"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <label className="w-28 shrink-0 text-xs text-mc-dim">{label}</label>
      <button
        onClick={() => onChange(!value)}
        className={`relative h-5 w-9 rounded-full transition-colors ${value ? 'bg-mc-accent' : 'bg-mc-surface-3'}`}
      >
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${value ? 'translate-x-4' : 'translate-x-0.5'}`}
        />
      </button>
      <span className="text-xs text-mc-mute">{value ? '开' : '关'}</span>
    </div>
  );
}
```

**注意**：`server.serverIp` 和 `server.spawnProtection` 字段在 ServerSpec schema 中可能不存在（需先确认）。如果不存在，从表单中删除对应字段，或先在 `packages/shared/src/schemas/server-spec.ts` 中补字段。

- [ ] **Step 2: 确认 ServerSpec 字段**

Read `packages/shared/src/schemas/server-spec.ts` 确认 `serverIp` 和 `spawnProtection` 是否存在。如果不存在：

- `serverIp` → 用 `extraProperties.serverIp` 或删除该字段
- `spawnProtection` → 在 ServerSpec schema 中新增 `spawnProtection: z.number().int().min(0).max(100).default(16)` 字段

- [ ] **Step 3: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）。如果失败，按错误信息修复字段名。

- [ ] **Step 4: 暂不提交，继续 Task 8**

---

## Task 8: 修改 App.tsx 集成 MiddlePanel

**Files:**

- Modify: `apps/desktop/src/renderer/src/App.tsx`

- [ ] **Step 1: 修改 App.tsx 的 main 区域**

把 [App.tsx](file:///d:/MC%20mod/apps/desktop/src/renderer/src/App.tsx) 中的 main 区域：

```tsx
<main className="flex flex-1 flex-col overflow-hidden">
  <TabBar />
  <div className="flex-1 overflow-hidden">
    <CodePreview />
  </div>
  <BuildPanel />
</main>
```

改为：

```tsx
<main className="flex flex-1 flex-col overflow-hidden">
  <MiddlePanel />
  <BuildPanel />
</main>
```

- [ ] **Step 2: 更新 imports**

在 App.tsx 顶部 imports 区域，删除不再直接使用的 TabBar 和 CodePreview import，新增 MiddlePanel import：

删除：

```typescript
import { TabBar } from './components/TabBar.js';
import { CodePreview } from './components/CodePreview.js';
```

新增：

```typescript
import { MiddlePanel } from './components/middle/MiddlePanel.js';
```

- [ ] **Step 3: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 4: 运行测试验证**

Run: `pnpm test`
Expected: PASS（68 测试全通过）

- [ ] **Step 5: 提交**

```bash
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx apps/desktop/src/renderer/src/components/middle/ServerPreviewPanel.tsx apps/desktop/src/renderer/src/App.tsx
git commit -m "feat(middle): 新增 MiddlePanel 调度框架 + ServerPreviewPanel"
```

---

## Task 9: 验证 + 清理

**Files:**

- 无文件修改，仅运行验证

- [ ] **Step 1: 完整 typecheck**

Run: `pnpm typecheck`
Expected: 0 错误

- [ ] **Step 2: 完整测试**

Run: `pnpm test`
Expected: 75 测试通过（原 68 + 新增 7 个 launcher-spec 测试）

- [ ] **Step 3: noUnusedLocals 扫描**

Run: `pnpm typecheck`
Expected: 0 错误（typecheck 已包含 noUnusedLocals 检查）

- [ ] **Step 4: 检查 TabBar/CodePreview 是否还被其他地方引用**

Run: `grep -r "TabBar\|CodePreview" apps/desktop/src --include="*.tsx" --include="*.ts" | grep -v "components/TabBar.tsx\|components/CodePreview.tsx\|middle/MiddlePanel.tsx"`

Expected: 应该只有 MiddlePanel.tsx 引用它们（在「代码」tab 中复用）。如果有其他引用，确认是否需要保留。

- [ ] **Step 5: 手动验证 UI（可选）**

Run: `pnpm dev:win`
验证：

1. 打开应用，进入工作台
2. 切换 generatorType 到「服务器」
3. 中间面板应显示「预览」tab（默认），内容是 ServerPreviewPanel 的表单（如未生成 spec 则显示空状态）
4. 切换到「代码」tab，应显示原 TabBar + CodePreview
5. 切换 generatorType 到其他类型（如 mod），预览 tab 应显示占位面板

- [ ] **Step 6: 最终提交（如有修复）**

如 Step 4-5 发现问题，修复后提交：

```bash
cd "d:/MC mod"
git add -A
git commit -m "fix(middle): 阶段 1 验证修复"
```

---

## 验证标准

- [x] typecheck 0 错误（node + web）
- [x] 测试全通过（原 68 + 新增 7 = 75）
- [x] noUnusedLocals 0 错误
- [x] MiddlePanel ≤ 150 行（实际 ~110 行）
- [x] ServerPreviewPanel ≤ 300 行（实际 ~220 行）
- [x] 删除 texture 后无 import 断裂
- [x] 切换 generatorType 后中间面板自动切换
- [x] 预览/代码 tab 切换正常
