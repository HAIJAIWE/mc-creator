# 中间预览面板阶段 3 — launcher 面板实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 抽取表单组件到 shared/FormField.tsx 供 server/launcher 共用，实现 LauncherPreviewPanel（表单类），替换 MiddlePanel 中 launcher 的 PlaceholderPanel。

**Architecture:** 把 ServerPreviewPanel 内部定义的 5 个表单子组件（FieldGroup/TextField/NumberField/SelectField/ToggleField）抽取到 `middle/shared/FormField.tsx` 并导出。ServerPreviewPanel 改为从 shared 导入（消除重复）。LauncherPreviewPanel 同样从 shared 导入，按 §5.7 分组（基本/JVM/账号/启动后）渲染表单，字段修改写回 useModStore.spec。

**Tech Stack:** React 18 + TypeScript 5 + Zustand 4 + Tailwind CSS 3 + Zod 3 + Vitest 2

**Spec:** [2026-07-17-middle-panel-per-generator-design.md](file:///d:/MC%20mod/docs/superpowers/specs/2026-07-17-middle-panel-per-generator-design.md) §5.7

---

## 文件结构

### 新建

- `apps/desktop/src/renderer/src/components/middle/shared/FormField.tsx` — 表单组件（FieldGroup/TextField/NumberField/SelectField/ToggleField）
- `apps/desktop/src/renderer/src/components/middle/LauncherPreviewPanel.tsx` — launcher 预览（表单类）

### 修改

- `apps/desktop/src/renderer/src/components/middle/shared/index.ts` — 导出表单组件
- `apps/desktop/src/renderer/src/components/middle/ServerPreviewPanel.tsx` — 删除内部表单子组件，改从 shared 导入
- `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx` — switch 的 launcher case 替换 placeholder

---

## Task 1: 抽取表单组件到 shared/FormField.tsx

**Files:**

- Create: `apps/desktop/src/renderer/src/components/middle/shared/FormField.tsx`
- Modify: `apps/desktop/src/renderer/src/components/middle/shared/index.ts`
- Modify: `apps/desktop/src/renderer/src/components/middle/ServerPreviewPanel.tsx`

**LauncherSpec 字段**（阶段 1 已创建，供 Task 2 参考）：

- launcherName: string
- launcherType: 'official' | 'pcl2' | 'hmcl' (default 'official')
- profileName: string (default 'default')
- mcVersion: string
- loader: 'fabric' | 'neoforge' | 'quilt' | 'legacy_fabric' | 'vanilla' (default 'vanilla')
- javaPath: string (default '')
- jvmArgs: string (default '-Xmx2G -Xms1G')
- memoryMin: number (>=512, default 1024)
- memoryMax: number (>=1024, default 2048)
- accountType: 'offline' | 'microsoft' (default 'offline')
- username: string (default 'Player')
- uuid: string (default '')
- serverAutorun: string (default '')
- fullscreen: boolean (default false)
- resolutionWidth: number (default 854)
- resolutionHeight: number (default 480)

- [ ] **Step 1: 创建 shared/FormField.tsx**

使用 Write 工具创建 `apps/desktop/src/renderer/src/components/middle/shared/FormField.tsx`，内容如下：

```tsx
/** 表单分组容器 */
export function FieldGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 text-xs font-bold uppercase tracking-wider text-mc-dim">{title}</div>
      <div className="space-y-2 rounded-mc-lg border border-mc-border bg-mc-surface-2/40 p-3">
        {children}
      </div>
    </div>
  );
}

/** 文本输入字段 */
export function TextField({
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

/** 数字输入字段 */
export function NumberField({
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

/** 下拉选择字段 */
export function SelectField({
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

/** 开关字段 */
export function ToggleField({
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

- [ ] **Step 2: 更新 shared/index.ts 导出**

Read `apps/desktop/src/renderer/src/components/middle/shared/index.ts`，用 Edit 在末尾新增表单组件导出：

```typescript
export { FieldGroup, TextField, NumberField, SelectField, ToggleField } from './FormField.js';
```

完整文件最终应为：

```typescript
export { DataTable } from './DataTable.js';
export type { Column } from './DataTable.js';
export { PanelHeader } from './PanelHeader.js';
export { SearchInput } from './SearchInput.js';
export { EmptyState } from './EmptyState.js';
export { FieldGroup, TextField, NumberField, SelectField, ToggleField } from './FormField.js';
```

- [ ] **Step 3: 修改 ServerPreviewPanel.tsx 使用共享表单组件**

Read `apps/desktop/src/renderer/src/components/middle/ServerPreviewPanel.tsx`。

修改 1：更新 import。把：

```tsx
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import type { ServerSpec } from '@mc-creator/shared';
```

改为（新增 shared 导入）：

```tsx
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import { FieldGroup, TextField, NumberField, SelectField, ToggleField } from './shared/index.js';
import type { ServerSpec } from '@mc-creator/shared';
```

修改 2：删除文件末尾的 5 个内部子组件定义（FieldGroup/TextField/NumberField/SelectField/ToggleField）。从 `// ===== 子组件 =====` 注释行开始到文件末尾全部删除。

保留 `EmptyState` 的使用不变（ServerPreviewPanel 已直接使用 McIcon 实现空状态，不用 EmptyState 组件——确认这一点）。

- [ ] **Step 4: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）。如果失败，检查是否漏删了内部子组件定义导致重复，或 import 路径错误。

- [ ] **Step 5: 运行测试验证**

Run: `pnpm test`
Expected: PASS（258 测试通过，无回归）

- [ ] **Step 6: 提交**

```bash
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/components/middle/shared/FormField.tsx apps/desktop/src/renderer/src/components/middle/shared/index.ts apps/desktop/src/renderer/src/components/middle/ServerPreviewPanel.tsx
git commit -m "refactor(middle/shared): extract form field components from ServerPreviewPanel"
```

---

## Task 2: 创建 LauncherPreviewPanel

**Files:**

- Create: `apps/desktop/src/renderer/src/components/middle/LauncherPreviewPanel.tsx`

- [ ] **Step 1: 创建 LauncherPreviewPanel.tsx**

使用 Write 工具创建 `apps/desktop/src/renderer/src/components/middle/LauncherPreviewPanel.tsx`，内容如下：

```tsx
import { shallow } from 'zustand/shallow';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import {
  EmptyState,
  FieldGroup,
  TextField,
  NumberField,
  SelectField,
  ToggleField,
} from './shared/index.js';
import type { LauncherSpec } from '@mc-creator/shared';

/**
 * Launcher 预览面板：以分组表单展示 LauncherSpec 字段。
 * 字段修改后写回 useModStore.spec（实时同步）。
 */
export function LauncherPreviewPanel() {
  const { spec, setSpec } = useModStore((s) => ({ spec: s.spec, setSpec: s.setSpec }), shallow);

  if (!spec) {
    return (
      <EmptyState
        icon="box"
        title="尚未生成启动器 Spec"
        hint="在右侧 AgentPanel 描述你想要的启动器，生成 Spec 后即可预览"
      />
    );
  }

  const launcher = spec as unknown as LauncherSpec;

  const updateField = <K extends keyof LauncherSpec>(key: K, value: LauncherSpec[K]) => {
    const updated = { ...launcher, [key]: value };
    setSpec(updated as unknown as typeof spec);
  };

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-mc-surface">
      {/* Header */}
      <div className="border-b border-mc-border px-4 py-3">
        <div className="flex items-center gap-2">
          <McIcon scope="pixel" name="box" size={16} className="text-mc-accent" />
          <span className="text-sm font-bold text-mc-text">{launcher.launcherName}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">{launcherTypeLabel(launcher.launcherType)}</span>
          <span className="text-xs text-mc-mute">·</span>
          <span className="text-xs text-mc-dim">MC {launcher.mcVersion}</span>
        </div>
        <div className="mt-1 text-xs text-mc-mute">配置文件: {launcher.profileName}</div>
      </div>

      {/* Body：分组表单 */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* 基本 */}
        <FieldGroup title="基本">
          <TextField
            label="启动器名称"
            value={launcher.launcherName}
            onChange={(v) => updateField('launcherName', v)}
          />
          <SelectField
            label="启动器类型"
            value={launcher.launcherType}
            options={[
              { value: 'official', label: '官方启动器' },
              { value: 'pcl2', label: 'PCL2' },
              { value: 'hmcl', label: 'HMCL' },
            ]}
            onChange={(v) => updateField('launcherType', v as LauncherSpec['launcherType'])}
          />
          <TextField
            label="配置名称"
            value={launcher.profileName}
            onChange={(v) => updateField('profileName', v)}
          />
          <TextField
            label="MC 版本"
            value={launcher.mcVersion}
            onChange={(v) => updateField('mcVersion', v)}
          />
          <SelectField
            label="加载器"
            value={launcher.loader}
            options={[
              { value: 'vanilla', label: '原版' },
              { value: 'fabric', label: 'Fabric' },
              { value: 'neoforge', label: 'NeoForge' },
              { value: 'quilt', label: 'Quilt' },
              { value: 'legacy_fabric', label: 'Legacy Fabric' },
            ]}
            onChange={(v) => updateField('loader', v as LauncherSpec['loader'])}
          />
        </FieldGroup>

        {/* JVM */}
        <FieldGroup title="JVM">
          <TextField
            label="Java 路径"
            value={launcher.javaPath}
            onChange={(v) => updateField('javaPath', v)}
          />
          <TextField
            label="JVM 参数"
            value={launcher.jvmArgs}
            onChange={(v) => updateField('jvmArgs', v)}
          />
          <NumberField
            label="最小内存(MB)"
            value={launcher.memoryMin}
            min={512}
            max={32768}
            onChange={(v) => updateField('memoryMin', v)}
          />
          <NumberField
            label="最大内存(MB)"
            value={launcher.memoryMax}
            min={1024}
            max={32768}
            onChange={(v) => updateField('memoryMax', v)}
          />
        </FieldGroup>

        {/* 账号 */}
        <FieldGroup title="账号">
          <SelectField
            label="账号类型"
            value={launcher.accountType}
            options={[
              { value: 'offline', label: '离线' },
              { value: 'microsoft', label: '微软账号' },
            ]}
            onChange={(v) => updateField('accountType', v as LauncherSpec['accountType'])}
          />
          <TextField
            label="用户名"
            value={launcher.username}
            onChange={(v) => updateField('username', v)}
          />
          <TextField label="UUID" value={launcher.uuid} onChange={(v) => updateField('uuid', v)} />
        </FieldGroup>

        {/* 启动后 */}
        <FieldGroup title="启动后">
          <TextField
            label="自动连接服务器"
            value={launcher.serverAutorun}
            onChange={(v) => updateField('serverAutorun', v)}
          />
          <ToggleField
            label="全屏"
            value={launcher.fullscreen}
            onChange={(v) => updateField('fullscreen', v)}
          />
          <NumberField
            label="分辨率宽"
            value={launcher.resolutionWidth}
            min={1}
            max={7680}
            onChange={(v) => updateField('resolutionWidth', v)}
          />
          <NumberField
            label="分辨率高"
            value={launcher.resolutionHeight}
            min={1}
            max={4320}
            onChange={(v) => updateField('resolutionHeight', v)}
          />
        </FieldGroup>
      </div>

      {/* Footer */}
      <div className="border-t border-mc-border px-4 py-2 text-xs text-mc-mute">
        {launcherTypeLabel(launcher.launcherType)} · {launcher.loader} ·{' '}
        {launcher.accountType === 'microsoft' ? '微软账号' : '离线'}
      </div>
    </div>
  );
}

function launcherTypeLabel(type: LauncherSpec['launcherType']): string {
  switch (type) {
    case 'official':
      return '官方启动器';
    case 'pcl2':
      return 'PCL2';
    case 'hmcl':
      return 'HMCL';
    default:
      return type;
  }
}
```

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 3: 暂不提交，继续 Task 3**

---

## Task 3: MiddlePanel 集成 + 验证

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`

- [ ] **Step 1: 修改 MiddlePanel**

Read `apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx`。

修改 1：新增 import（在现有 3 个面板 import 之后）：

```tsx
import { LauncherPreviewPanel } from './LauncherPreviewPanel.js';
```

修改 2：修改 switch，把 launcher 从 PlaceholderPanel 分支拆出。把：

```tsx
      case 'resource_pack':
      case 'skin':
      case 'launcher':
        return <PlaceholderPanel type={generatorType} />;
```

改为：

```tsx
      case 'launcher':
        return <LauncherPreviewPanel />;
      case 'resource_pack':
      case 'skin':
        return <PlaceholderPanel type={generatorType} />;
```

修改 3：更新顶部注释，把"阶段 2 已实现 server/mod/datapack/modpack 面板"改为"阶段 3 已实现 server/mod/datapack/modpack/launcher 面板"。

- [ ] **Step 2: 运行 typecheck 验证**

Run: `pnpm typecheck`
Expected: PASS（0 错误）

- [ ] **Step 3: 运行测试验证**

Run: `pnpm test`
Expected: PASS（258 测试通过，无回归）

- [ ] **Step 4: 行数检查**

用 Read 工具读取以下文件末尾确认行数：

- `LauncherPreviewPanel.tsx` — 目标 ≤ 200 行
- `MiddlePanel.tsx` — 目标 ≤ 100 行
- `ServerPreviewPanel.tsx` — 应减少（删除了内部子组件，目标 ≤ 120 行）

- [ ] **Step 5: 提交**

```bash
cd "d:/MC mod"
git add apps/desktop/src/renderer/src/components/middle/LauncherPreviewPanel.tsx apps/desktop/src/renderer/src/components/middle/MiddlePanel.tsx
git commit -m "feat(middle): add Launcher preview panel"
```

---

## 验证标准

- [x] typecheck 0 错误
- [x] 测试全通过（258，无回归）
- [x] noUnusedLocals 0 错误
- [x] LauncherPreviewPanel ≤ 200 行
- [x] MiddlePanel ≤ 100 行
- [x] ServerPreviewPanel 减少（≤ 120 行）
- [x] ServerPreviewPanel 和 LauncherPreviewPanel 共用 shared/FormField 组件
- [x] launcher 类型切换后中间面板显示 LauncherPreviewPanel
- [x] 表单字段修改写回 spec
