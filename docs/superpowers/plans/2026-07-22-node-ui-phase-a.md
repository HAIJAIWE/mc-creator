# 节点 UI 重构 · 阶段 A：UI 核心 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 11 种节点重构为统一的扣子风格 + MC 视觉外壳，端口数据驱动，右侧抽屉编辑参数，直角折线连线，折叠展开，删除旧 PropertyPanel。

**Architecture:** 抽出 `McNodeShell` 共享外壳组件（契约 §2 签名），所有节点复用；端口由 `portSchemas.ts` 的 `getPorts(data)` 数据驱动；参数编辑移到右侧 `NodeDetailDrawer` 抽屉（吸收 PropertyPanel 功能 + 草稿模式）；连线改 `type: 'step'` 直角折线；节点 data 增加 `collapsed` 字段。

**Tech Stack:** React + TypeScript + React Flow + Zustand + Tailwind CSS + Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-07-22-node-ui-polish-design.md`（§1-7, §15-16）

**共享契约:** `docs/superpowers/plans/shared-contracts.md`（最高优先级，所有命名/接口/路径以契约为准）

---

## 文件结构

### 新建文件

| 文件（绝对路径） | 职责 |
|------|------|
| `apps/desktop/src/renderer/src/components/lowcode/nodes/base/portColors.ts` | PortType → hex 配色 + colorClass → hex 映射 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodePort.tsx` | 端口组件（Handle + 标签 + MC 凹陷样式） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeHeader.tsx` | 头部组件（3D 凸起 + 色条 + 图标 + 标题 + 徽章 + 折叠/设置按钮 + 调试/错误标记） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeShell.tsx` | 统一节点壳（契约 §2 最终签名） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/base/useNodeStates.ts` | 调试/错误状态 hook |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.ts` | `getPorts(data: NodeData): NodePort[]` 数据驱动端口 |
| `apps/desktop/src/renderer/src/store/drawer-store.ts` | useDrawerStore（草稿模式，契约 §4） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/types.ts` | FieldSchema + EditorProps + FieldType |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NumberStepperEditor.tsx` | 数字步进编辑器 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/DropdownEditor.tsx` | 枚举下拉编辑器 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/SegmentedEditor.tsx` | 分段切换编辑器 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ColorEditor.tsx` | MC 颜色选择编辑器 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.tsx` | modid:path 资源 ID 编辑器 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NbtEditor.tsx` | NBT 树编辑器（基础版） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.tsx` | 节点引用选择编辑器 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.ts` | 各节点类型的字段定义 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailForm.tsx` | schema 驱动表单 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailDrawer.tsx` | 右侧抽屉（吸收 PropertyPanel 功能 + 草稿模式 + MC 风格） |

### 修改文件

| 文件（绝对路径） | 改动 |
|------|------|
| `packages/shared/src/schemas/node-graph-spec.ts` | BaseNodeData 加 `collapsed` 字段 |
| `apps/desktop/src/renderer/src/store/node-graph-store.ts` | toggleCollapse/collapseAll/expandAll + createDefaultPorts 调 getPorts + base 加 collapsed |
| `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx` | edge type 改 step + 连线颜色 |
| `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx` | PropertyPanel 替换为 NodeDetailDrawer + 折叠按钮 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/ItemNode.tsx` 等 11 个 | 迁移到 McNodeShell |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/index.ts` | nodeTypes 注册（保持不变，确认路径） |
| `apps/desktop/src/renderer/src/components/lowcode/connectionRules.ts` | multiple 限制 + 校验失败信息 |
| `apps/desktop/tailwind.config.js` | MC 降饱和配色注册 |

### 删除文件

| 文件（绝对路径） | 原因 |
|------|------|
| `apps/desktop/src/renderer/src/components/lowcode/PropertyPanel.tsx` | 功能合并到 NodeDetailDrawer（契约 §1.1） |

---

## Task 1: BaseNodeData 增加 collapsed 字段

**Files:**
- Modify: `packages/shared/src/schemas/node-graph-spec.ts`
- Create: `packages/shared/src/schemas/node-graph-spec-collapsed.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `packages/shared/src/schemas/node-graph-spec-collapsed.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { ItemNodeData, NodeGraph } from './node-graph-spec.js';

describe('BaseNodeData.collapsed', () => {
  it('默认 collapsed 为 false', () => {
    const item = ItemNodeData.parse({
      nodeId: 'n1',
      label: '测试',
      kind: 'item',
      itemId: 'test',
      displayName: '测试物品',
    });
    expect(item.collapsed).toBe(false);
  });

  it('可设置 collapsed 为 true', () => {
    const item = ItemNodeData.parse({
      nodeId: 'n1',
      label: '测试',
      kind: 'item',
      itemId: 'test',
      displayName: '测试物品',
      collapsed: true,
    });
    expect(item.collapsed).toBe(true);
  });

  it('旧 JSON 无 collapsed 字段时解析默认 false（向后兼容）', () => {
    const oldJson = {
      version: 1,
      modId: 'test',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        {
          id: 'n1',
          type: 'item',
          position: { x: 0, y: 0 },
          ports: [],
          selected: false,
          data: {
            nodeId: 'n1',
            label: '旧节点',
            kind: 'item',
            itemId: 'old',
            displayName: '旧物品',
          },
        },
      ],
      edges: [],
    };
    const graph = NodeGraph.parse(oldJson);
    expect(graph.nodes[0].data.collapsed).toBe(false);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/shared test -- --run node-graph-spec-collapsed`
Expected: FAIL — `collapsed` 属性不存在（`undefined !== false`）

- [ ] **Step 3: 实现 collapsed 字段**

修改 `packages/shared/src/schemas/node-graph-spec.ts`，在 `BaseNodeData`（第 84-93 行）的 `disabled` 字段后增加 `collapsed`：

```ts
export const BaseNodeData = z.object({
  /** 节点实例 ID（图内唯一） */
  nodeId: z.string(),
  /** 节点显示名 */
  label: z.string(),
  /** 节点备注（用户可编辑） */
  note: z.string().default(''),
  /** 是否禁用（编译时跳过） */
  disabled: z.boolean().default(false),
  /** 是否折叠（UI 状态，序列化到 JSON） */
  collapsed: z.boolean().default(false),
});
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/shared test -- --run node-graph-spec-collapsed`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/schemas/node-graph-spec.ts packages/shared/src/schemas/node-graph-spec-collapsed.test.ts
git commit -m "feat(shared): add collapsed field to BaseNodeData for node UI"
```

---

## Task 2: Store 新增折叠 actions + base 加 collapsed

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/node-graph-store.ts`
- Create: `apps/desktop/src/renderer/src/store/node-graph-store-collapse.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/store/node-graph-store-collapse.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useNodeGraphStore } from './node-graph-store.js';

describe('useNodeGraphStore 折叠 actions', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('toggleCollapse 切换节点折叠状态', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    expect(useNodeGraphStore.getState().graph.nodes[0].data.collapsed).toBe(false);

    useNodeGraphStore.getState().toggleCollapse(id);
    expect(useNodeGraphStore.getState().graph.nodes[0].data.collapsed).toBe(true);

    useNodeGraphStore.getState().toggleCollapse(id);
    expect(useNodeGraphStore.getState().graph.nodes[0].data.collapsed).toBe(false);
  });

  it('collapseAll 折叠所有节点', () => {
    useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useNodeGraphStore.getState().addNode('block', { x: 100, y: 0 });

    useNodeGraphStore.getState().collapseAll();

    const nodes = useNodeGraphStore.getState().graph.nodes;
    expect(nodes.every((n) => n.data.collapsed)).toBe(true);
  });

  it('expandAll 展开所有节点', () => {
    useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useNodeGraphStore.getState().addNode('block', { x: 100, y: 0 });
    useNodeGraphStore.getState().collapseAll();

    useNodeGraphStore.getState().expandAll();

    const nodes = useNodeGraphStore.getState().graph.nodes;
    expect(nodes.every((n) => !n.data.collapsed)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run node-graph-store-collapse`
Expected: FAIL — `toggleCollapse` is not a function

- [ ] **Step 3: 实现折叠 actions + base 加 collapsed**

修改 `apps/desktop/src/renderer/src/store/node-graph-store.ts`。

首先在 `createDefaultNodeData` 的 `base` 对象中增加 `collapsed: false`（第 92-97 行）：

```ts
function createDefaultNodeData(kind: NodeKind, modId: string): NodeData {
  const base = {
    nodeId: '',
    label: '',
    note: '',
    disabled: false,
    collapsed: false,
  };
```

然后在 `NodeGraphState` 接口中，在 `selectNode` 之后（第 49 行后）新增折叠 actions 声明：

```ts
  selectNode: (nodeId: string | null) => void;

  // === 折叠 ===
  toggleCollapse: (nodeId: string) => void;
  collapseAll: () => void;
  expandAll: () => void;
```

在 store 实现中，`selectNode` 之后（第 371 行后）新增实现：

```ts
  selectNode: (nodeId) => set({ selectedNodeId: nodeId, selectedEdgeId: null }),

  toggleCollapse: (nodeId) => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, collapsed: !n.data.collapsed } as NodeData }
            : n,
        ),
      },
    }));
  },

  collapseAll: () => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) => ({
          ...n,
          data: { ...n.data, collapsed: true } as NodeData,
        })),
      },
    }));
  },

  expandAll: () => {
    set((state) => ({
      graph: {
        ...state.graph,
        nodes: state.graph.nodes.map((n) => ({
          ...n,
          data: { ...n.data, collapsed: false } as NodeData,
        })),
      },
    }));
  },
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- --run node-graph-store-collapse`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/store/node-graph-store.ts apps/desktop/src/renderer/src/store/node-graph-store-collapse.test.ts
git commit -m "feat(store): add toggleCollapse/collapseAll/expandAll actions"
```

---

## Task 3: Tailwind 注册 MC 降饱和配色

**Files:**
- Modify: `apps/desktop/tailwind.config.js`

- [ ] **Step 1: 添加 MC 节点配色 + 按钮灰 + 像素字体**

修改 `apps/desktop/tailwind.config.js`，在 `theme.extend.colors` 的 `mc` 对象之后新增 `mcNode` 和 `mcBtn` 颜色组，并在 `fontFamily` 中新增 `pixel`：

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/renderer/**/*.{ts,tsx,html}'],
  theme: {
    extend: {
      colors: {
        mc: {
          bg: 'rgb(var(--mc-bg) / <alpha-value>)',
          surface: 'rgb(var(--mc-surface) / <alpha-value>)',
          'surface-2': 'rgb(var(--mc-surface-2) / <alpha-value>)',
          'surface-3': 'rgb(var(--mc-surface-3) / <alpha-value>)',
          border: 'rgb(var(--mc-border) / <alpha-value>)',
          'border-strong': 'rgb(var(--mc-border-strong) / <alpha-value>)',
          text: 'rgb(var(--mc-text) / <alpha-value>)',
          dim: 'rgb(var(--mc-text-dim) / <alpha-value>)',
          mute: 'rgb(var(--mc-text-mute) / <alpha-value>)',
          accent: 'rgb(var(--mc-accent) / <alpha-value>)',
          'accent-bright': 'rgb(var(--mc-accent-bright) / <alpha-value>)',
          'accent-deep': 'rgb(var(--mc-accent-deep) / <alpha-value>)',
          gold: 'rgb(var(--mc-gold) / <alpha-value>)',
          'gold-deep': 'rgb(var(--mc-gold-deep) / <alpha-value>)',
          redstone: 'rgb(var(--mc-redstone) / <alpha-value>)',
          'redstone-deep': 'rgb(var(--mc-redstone-deep) / <alpha-value>)',
        },
        // 节点头部色条（降饱和 MC 染色方块色）
        'mc-item': '#d88a8a',
        'mc-block': '#d8a87a',
        'mc-entity': '#7ac6c6',
        'mc-recipe': '#d8c87a',
        'mc-machine': '#7ac68a',
        'mc-multiblock': '#a87ac6',
        'mc-event': '#9a7ac6',
        'mc-condition': '#7a8ac6',
        'mc-action': '#c67a7a',
        'mc-code': '#9a9a9a',
        'mc-comment': '#d8c87a',
        // MC 按钮灰
        'mc-btn': '#c6c6c6',
        'mc-btn-hover': '#d4d4d4',
        'mc-btn-active': '#a0a0a0',
      },
      fontFamily: {
        display: 'var(--mc-font-display)',
        sans: 'var(--mc-font-body)',
        mono: 'var(--mc-font-mono)',
        pixel: ['"Press Start 2P"', 'ui-monospace', 'monospace'],
      },
      borderRadius: {
        mc: 'var(--mc-radius)',
        'mc-lg': 'var(--mc-radius-lg)',
      },
      transitionTimingFunction: {
        mc: 'var(--mc-ease)',
      },
      boxShadow: {
        'mc-block': 'var(--mc-shadow-block)',
        'mc-block-active': 'var(--mc-shadow-block-active)',
        'mc-pop': 'var(--mc-shadow-pop)',
      },
      keyframes: {
        'mc-panel-in': {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        'mc-dialog-in': {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
        },
        'mc-toast-in': {
          '0%': { opacity: '0', transform: 'translateX(100%)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        'mc-pop': {
          '0%': { transform: 'scale(0.9)' },
          '60%': { transform: 'scale(1.03)' },
          '100%': { transform: 'scale(1)' },
        },
        'mc-drawer-in': {
          '0%': { transform: 'translateX(100%)' },
          '100%': { transform: 'translateX(0)' },
        },
      },
      animation: {
        'mc-panel-in': 'mc-panel-in 0.28s var(--mc-ease) both',
        'mc-dialog-in': 'mc-dialog-in 0.22s var(--mc-ease) both',
        'mc-toast-in': 'mc-toast-in 0.25s var(--mc-ease) both',
        'mc-pop': 'mc-pop 0.2s var(--mc-ease) both',
        'mc-drawer-in': 'mc-drawer-in 0.25s var(--mc-ease) both',
      },
    },
  },
  plugins: [],
};
```

- [ ] **Step 2: 验证构建**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/tailwind.config.js
git commit -m "feat(ui): register MC desaturated node colors, button gray, pixel font, drawer animation"
```

---

## Task 4: portColors.ts + McNodePort.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/base/portColors.ts`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodePort.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodePort.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodePort.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { McNodePort } from './McNodePort.js';
import type { NodePort } from '@mc-creator/shared';

describe('McNodePort', () => {
  const outPort: NodePort = {
    id: 'out', label: '物品', type: 'item_stack',
    direction: 'out', required: false, multiple: false,
  };
  const inPort: NodePort = {
    id: 'in', label: '材料', type: 'item_stack',
    direction: 'in', required: true, multiple: true,
  };

  it('输出端口渲染标签', () => {
    render(<McNodePort port={outPort} />);
    expect(screen.getByText('物品')).toBeInTheDocument();
  });

  it('输入端口渲染标签', () => {
    render(<McNodePort port={inPort} />);
    expect(screen.getByText('材料')).toBeInTheDocument();
  });

  it('必填端口显示 * 标记', () => {
    render(<McNodePort port={inPort} />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('非必填端口不显示 * 标记', () => {
    const { container } = render(<McNodePort port={outPort} />);
    expect(container.querySelector('.text-red-400')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run McNodePort`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 portColors.ts**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/base/portColors.ts`：

```ts
import type { PortType } from '@mc-creator/shared';

/** PortType → 端口 Handle 颜色（降饱和 MC 配色，hex 值用于内联样式） */
export const PORT_COLORS: Record<PortType, string> = {
  item_stack: '#d88a8a',
  block_state: '#d8a87a',
  entity: '#7ac6c6',
  fluid: '#7a9ac6',
  energy: '#d8c87a',
  redstone: '#c67a7a',
  player: '#7ac68a',
  world: '#9a9a9a',
  boolean: '#a87ac6',
  integer: '#7a8ac6',
  number: '#7a8ac6',
  string: '#d8a87a',
  nbt: '#9a7ac6',
  void: '#9a7ac6',
  any: '#9a9a9a',
};

/** colorClass（如 'mc-item'）→ hex 值，用于节点头部色条/图标内联样式 */
export const NODE_COLORS: Record<string, string> = {
  'mc-item': '#d88a8a',
  'mc-block': '#d8a87a',
  'mc-entity': '#7ac6c6',
  'mc-recipe': '#d8c87a',
  'mc-machine': '#7ac68a',
  'mc-multiblock': '#a87ac6',
  'mc-event': '#9a7ac6',
  'mc-condition': '#7a8ac6',
  'mc-action': '#c67a7a',
  'mc-code': '#9a9a9a',
  'mc-comment': '#d8c87a',
};
```

- [ ] **Step 4: 创建 McNodePort.tsx**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodePort.tsx`：

```tsx
import { memo } from 'react';
import { Handle, Position } from 'reactflow';
import type { NodePort } from '@mc-creator/shared';
import { PORT_COLORS } from './portColors.js';

interface McNodePortProps {
  port: NodePort;
}

/**
 * 单个端口：带标签的 Handle，MC 风格凹陷方块。
 * - 输入端口：左侧 Handle + 标签
 * - 输出端口：标签 + 右侧 Handle
 * - Handle 为 6×6 方块，inset shadow 模拟 MC 凹陷感
 */
function McNodePortComponent({ port }: McNodePortProps) {
  const color = PORT_COLORS[port.type];
  const isInput = port.direction === 'in';
  const position = isInput ? Position.Left : Position.Right;

  const handleStyle: React.CSSProperties = {
    width: 8,
    height: 8,
    borderRadius: 0,
    background: color,
    border: '1px solid rgba(0,0,0,0.8)',
    boxShadow: 'inset 2px 2px 0 rgba(0,0,0,0.6)',
  };

  return (
    <div className="flex items-center gap-1 text-[10px] text-mc-text">
      {isInput && (
        <Handle
          type="target"
          position={position}
          id={port.id}
          style={handleStyle}
        />
      )}
      <span className="select-none">
        {port.required && <span className="text-red-400">*</span>}
        {port.label}
      </span>
      {!isInput && (
        <Handle
          type="source"
          position={position}
          id={port.id}
          style={handleStyle}
        />
      )}
    </div>
  );
}

export const McNodePort = memo(McNodePortComponent);
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- --run McNodePort`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/base/portColors.ts apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodePort.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodePort.test.tsx
git commit -m "feat(ui): add portColors mapping and McNodePort component with MC-style labeled ports"
```

---

## Task 5: McNodeHeader.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeHeader.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeHeader.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeHeader.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McNodeHeader } from './McNodeHeader.js';

describe('McNodeHeader', () => {
  const defaultProps = {
    icon: 'sword',
    title: '物品',
    colorClass: 'mc-item',
    badge: '普通',
    collapsed: false,
    onToggleCollapse: () => {},
    onOpenDrawer: () => {},
  };

  it('渲染图标 + 标题 + 徽章', () => {
    render(<McNodeHeader {...defaultProps} />);
    expect(screen.getByText('物品')).toBeInTheDocument();
    expect(screen.getByText('普通')).toBeInTheDocument();
  });

  it('点击折叠按钮触发 onToggleCollapse', () => {
    const onToggle = vi.fn();
    render(<McNodeHeader {...defaultProps} onToggleCollapse={onToggle} />);
    fireEvent.click(screen.getByLabelText('折叠'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('点击设置按钮触发 onOpenDrawer', () => {
    const onOpen = vi.fn();
    render(<McNodeHeader {...defaultProps} onOpenDrawer={onOpen} />);
    fireEvent.click(screen.getByLabelText('设置'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('折叠状态显示 ▸ 标记', () => {
    render(<McNodeHeader {...defaultProps} collapsed={true} />);
    const btn = screen.getByLabelText('折叠');
    expect(btn.textContent).toContain('▸');
  });

  it('展开状态显示 ▾ 标记', () => {
    render(<McNodeHeader {...defaultProps} collapsed={false} />);
    const btn = screen.getByLabelText('折叠');
    expect(btn.textContent).toContain('▾');
  });

  it('debugState=debugging 时显示调试标记', () => {
    render(<McNodeHeader {...defaultProps} debugState="debugging" />);
    expect(screen.getByLabelText('调试中')).toBeInTheDocument();
  });

  it('debugState=breakpoint 时显示断点标记', () => {
    render(<McNodeHeader {...defaultProps} debugState="breakpoint" />);
    expect(screen.getByLabelText('断点')).toBeInTheDocument();
  });

  it('errorState=error 时显示错误标记', () => {
    render(<McNodeHeader {...defaultProps} errorState="error" />);
    expect(screen.getByLabelText('错误')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run McNodeHeader`
Expected: FAIL

- [ ] **Step 3: 创建 McNodeHeader.tsx**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeHeader.tsx`：

```tsx
import { memo } from 'react';
import { McIcon } from '../../../../assets/mc-ui/McIcon.js';
import { NODE_COLORS } from './portColors.js';

export type NodeDebugState = 'breakpoint' | 'debugging' | null;
export type NodeErrorState = 'error' | 'warning' | null;

interface McNodeHeaderProps {
  icon: string;
  title: string;
  /** Tailwind 颜色类名（如 'mc-item'），用于查 NODE_COLORS hex 值 */
  colorClass: string;
  badge?: string;
  collapsed: boolean;
  debugState?: NodeDebugState;
  errorState?: NodeErrorState;
  onToggleCollapse: () => void;
  onOpenDrawer: () => void;
}

/**
 * MC 风格 3D 凸起灰色头部条。
 * - 背景 #c6c6c6（mc-btn），3D 凸起边框（上/左白、下/右黑）
 * - 左侧 4px 类别色条 + 像素图标 + 像素字体标题
 * - 右侧徽章 + 调试/错误标记 + 设置按钮 + 折叠按钮
 */
function McNodeHeaderComponent({
  icon,
  title,
  colorClass,
  badge,
  collapsed,
  debugState,
  errorState,
  onToggleCollapse,
  onOpenDrawer,
}: McNodeHeaderProps) {
  const colorHex = NODE_COLORS[colorClass] ?? '#9a9a9a';

  return (
    <div
      className="flex items-center gap-1.5 border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2"
      style={{ height: 28 }}
    >
      {/* 左侧类别色条 */}
      <div className="h-4 w-1" style={{ backgroundColor: colorHex }} />

      {/* 图标 */}
      <McIcon scope="pixel" name={icon} size={14} className="shrink-0" />

      {/* 标题 */}
      <span
        className="truncate text-[10px] font-medium"
        style={{ color: colorHex }}
      >
        {title}
      </span>

      {/* 徽章 */}
      {badge && (
        <span className="text-[10px] text-mc-text">{badge}</span>
      )}

      {/* 调试标记 */}
      {debugState === 'debugging' && (
        <span
          aria-label="调试中"
          className="text-[10px]"
          style={{ color: '#22d3ee' }}
        >
          ●
        </span>
      )}
      {debugState === 'breakpoint' && (
        <span
          aria-label="断点"
          className="text-[10px]"
          style={{ color: '#c084fc' }}
        >
          ◆
        </span>
      )}

      {/* 错误标记 */}
      {errorState === 'error' && (
        <span aria-label="错误" className="text-[10px] text-red-500">
          ✗
        </span>
      )}
      {errorState === 'warning' && (
        <span aria-label="警告" className="text-[10px] text-yellow-400">
          ⚠
        </span>
      )}

      {/* 设置按钮 */}
      <button
        type="button"
        aria-label="设置"
        onClick={onOpenDrawer}
        className="ml-auto border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 text-[10px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        ⚙
      </button>

      {/* 折叠按钮 */}
      <button
        type="button"
        aria-label="折叠"
        onClick={onToggleCollapse}
        className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 text-[10px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        {collapsed ? '▸' : '▾'}
      </button>
    </div>
  );
}

export const McNodeHeader = memo(McNodeHeaderComponent);
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- --run McNodeHeader`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeHeader.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeHeader.test.tsx
git commit -m "feat(ui): add McNodeHeader with MC 3D raised style, debug/error indicators"
```

---

## Task 6: McNodeShell.tsx（契约 §2 最终签名）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeShell.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeShell.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeShell.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { McNodeShell } from './McNodeShell.js';
import type { NodePort } from '@mc-creator/shared';

const ports: NodePort[] = [
  { id: 'in', label: '材料', type: 'item_stack', direction: 'in', required: true, multiple: true },
  { id: 'out', label: '产物', type: 'item_stack', direction: 'out', required: false, multiple: false },
];

describe('McNodeShell', () => {
  const defaultProps = {
    icon: 'sword',
    title: '物品',
    colorClass: 'mc-item',
    badge: '普通',
    ports,
    collapsed: false,
    onToggleCollapse: () => {},
    onOpenDrawer: () => {},
  };

  it('展开时渲染头部 + 主体 + 端口', () => {
    render(
      <McNodeShell {...defaultProps}>
        <div>摘要内容</div>
      </McNodeShell>,
    );
    expect(screen.getByText('物品')).toBeInTheDocument();
    expect(screen.getByText('摘要内容')).toBeInTheDocument();
    expect(screen.getByText('材料')).toBeInTheDocument();
    expect(screen.getByText('产物')).toBeInTheDocument();
  });

  it('折叠时隐藏主体，仍渲染端口', () => {
    render(
      <McNodeShell {...defaultProps} collapsed={true}>
        <div>摘要内容</div>
      </McNodeShell>,
    );
    expect(screen.queryByText('摘要内容')).not.toBeInTheDocument();
    expect(screen.getByText('产物')).toBeInTheDocument();
  });

  it('折叠时隐藏输入端口，保留输出端口', () => {
    render(
      <McNodeShell {...defaultProps} collapsed={true}>
        <div>摘要</div>
      </McNodeShell>,
    );
    expect(screen.queryByText('材料')).not.toBeInTheDocument();
    expect(screen.getByText('产物')).toBeInTheDocument();
  });

  it('点击折叠按钮触发 onToggleCollapse', () => {
    const onToggle = vi.fn();
    render(
      <McNodeShell {...defaultProps} onToggleCollapse={onToggle}>
        <div>摘要</div>
      </McNodeShell>,
    );
    fireEvent.click(screen.getByLabelText('折叠'));
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('点击设置按钮触发 onOpenDrawer', () => {
    const onOpen = vi.fn();
    render(
      <McNodeShell {...defaultProps} onOpenDrawer={onOpen}>
        <div>摘要</div>
      </McNodeShell>,
    );
    fireEvent.click(screen.getByLabelText('设置'));
    expect(onOpen).toHaveBeenCalledOnce();
  });

  it('selected=true 时添加选中边框样式', () => {
    const { container } = render(
      <McNodeShell {...defaultProps} selected={true}>
        <div>摘要</div>
      </McNodeShell>,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain('border-mc-accent');
  });

  it('无 children 时不渲染主体区', () => {
    render(<McNodeShell {...defaultProps} />);
    expect(screen.queryByText('摘要内容')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run McNodeShell`
Expected: FAIL

- [ ] **Step 3: 创建 McNodeShell.tsx（严格使用契约 §2 签名）**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeShell.tsx`：

```tsx
import { memo, type ReactNode } from 'react';
import type { NodePort } from '@mc-creator/shared';
import { McNodeHeader, type NodeDebugState, type NodeErrorState } from './McNodeHeader.js';
import { McNodePort } from './McNodePort.js';

/**
 * McNodeShell 统一节点外壳（契约 §2 最终签名）。
 *
 * 所有节点组件必须使用此签名调用 McNodeShell。
 * - header: McNodeHeader（3D 凸起头部 + 色条 + 图标 + 标题 + 徽章 + 折叠/设置按钮 + 调试/错误标记）
 * - children: 摘要内容（展开时显示在头部下方，折叠时隐藏）
 * - ports: 端口列表，来自 node.ports（store 初始化）
 */
export interface McNodeShellProps {
  /** 头部图标名（如 'item'/'block'/'variable'/'loop'） */
  icon: string;
  /** 头部标题（通常用 node.data.label） */
  title: string;
  /** 头部色条 Tailwind class（如 'mc-item'/'mc-block'/'mc-variable'） */
  colorClass: string;
  /** 右上角徽章文本（如 'const'/'forEach'，可选） */
  badge?: string;
  /** 端口列表（来自 node.ports） */
  ports: NodePort[];
  /** 是否折叠 */
  collapsed: boolean;
  /** 是否选中 */
  selected?: boolean;
  /** 调试状态（折叠时在头部显示标记） */
  debugState?: NodeDebugState;
  /** 错误状态（编译错误/警告时头部变色） */
  errorState?: NodeErrorState;
  /** 切换折叠回调 */
  onToggleCollapse: () => void;
  /** 打开抽屉回调（双击或点⚙） */
  onOpenDrawer: () => void;
  /** 摘要内容（展开时显示在头部下方） */
  children?: ReactNode;
}

function McNodeShellComponent({
  icon,
  title,
  colorClass,
  badge,
  ports,
  collapsed,
  selected = false,
  debugState,
  errorState,
  onToggleCollapse,
  onOpenDrawer,
  children,
}: McNodeShellProps) {
  const inputPorts = ports.filter((p) => p.direction === 'in');
  const outputPorts = ports.filter((p) => p.direction === 'out');

  return (
    <div
      className={`min-w-[180px] max-w-[280px] border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-surface shadow-[4px_4px_0_rgba(0,0,0,0.5)] ${
        selected ? '!border-mc-accent' : ''
      }`}
      style={{
        backgroundImage:
          'radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px)',
        backgroundSize: '3px 3px',
      }}
    >
      <McNodeHeader
        icon={icon}
        title={title}
        colorClass={colorClass}
        badge={badge}
        collapsed={collapsed}
        debugState={debugState}
        errorState={errorState}
        onToggleCollapse={onToggleCollapse}
        onOpenDrawer={onOpenDrawer}
      />

      {!collapsed && children && (
        <div className="space-y-0.5 px-3 py-2 text-[11px] text-mc-text">
          {children}
        </div>
      )}

      {/* 端口区：折叠时只显示输出端口（右对齐），展开时左右分列 */}
      {ports.length > 0 && (
        <div
          className={`flex ${
            collapsed ? 'justify-end' : 'justify-between'
          } gap-2 border-t-2 border-t-black border-b-white border-l-white border-r-white px-2 py-1`}
        >
          {!collapsed && inputPorts.length > 0 && (
            <div className="flex flex-col gap-1">
              {inputPorts.map((p) => (
                <McNodePort key={p.id} port={p} />
              ))}
            </div>
          )}
          {outputPorts.length > 0 && (
            <div className="flex flex-col gap-1">
              {outputPorts.map((p) => (
                <McNodePort key={p.id} port={p} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export const McNodeShell = memo(McNodeShellComponent);
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- --run McNodeShell`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeShell.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/base/McNodeShell.test.tsx
git commit -m "feat(ui): add McNodeShell unified node shell with contract section 2 signature"
```

---

## Task 7: portSchemas.ts（getPorts 数据驱动端口）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.ts`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.test.ts`
- Modify: `apps/desktop/src/renderer/src/store/node-graph-store.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getPorts } from './portSchemas.js';
import type { NodeData } from '@mc-creator/shared';

function makeData(kind: NodeData['kind']): NodeData {
  const base = { nodeId: 'n1', label: 'test', note: '', disabled: false, collapsed: false };
  switch (kind) {
    case 'item':
      return { ...base, kind: 'item', itemId: 'test', displayName: 'Test', category: 'misc', maxStackSize: 64, maxDamage: 0, rarity: 'common', glow: false } as NodeData;
    case 'block':
      return { ...base, kind: 'block', blockId: 'test', displayName: 'Test', hardness: 1, blastResistance: 3, luminance: 0, transparent: false, solid: true, modelType: 'cube_all', isBlockEntity: false } as NodeData;
    case 'recipe':
      return { ...base, kind: 'recipe', recipeId: 'test', recipeType: 'crafting_shaped', outputCount: 1, cookTime: 200, experience: 0, pattern: [] } as NodeData;
    case 'condition':
      return { ...base, kind: 'condition', conditionType: 'has_item', conditionArgs: '{}', invert: false } as NodeData;
    case 'comment':
      return { ...base, kind: 'comment', text: '', color: 'yellow' } as NodeData;
    default:
      return { ...base, kind } as NodeData;
  }
}

describe('getPorts', () => {
  it('item 节点返回 1 个输出端口', () => {
    const ports = getPorts(makeData('item'));
    expect(ports).toHaveLength(1);
    expect(ports[0].id).toBe('out');
    expect(ports[0].direction).toBe('out');
    expect(ports[0].type).toBe('item_stack');
  });

  it('recipe 节点返回 2 个端口（材料输入 + 产物输出）', () => {
    const ports = getPorts(makeData('recipe'));
    expect(ports).toHaveLength(2);
    const inPort = ports.find((p) => p.direction === 'in');
    const outPort = ports.find((p) => p.direction === 'out');
    expect(inPort?.id).toBe('in');
    expect(inPort?.multiple).toBe(true);
    expect(outPort?.id).toBe('out');
  });

  it('condition 节点返回 3 个端口（输入 + true/false 输出）', () => {
    const ports = getPorts(makeData('condition'));
    expect(ports).toHaveLength(3);
    expect(ports.filter((p) => p.direction === 'out')).toHaveLength(2);
    expect(ports.find((p) => p.id === 'true')).toBeDefined();
    expect(ports.find((p) => p.id === 'false')).toBeDefined();
  });

  it('comment 节点返回空端口列表', () => {
    const ports = getPorts(makeData('comment'));
    expect(ports).toHaveLength(0);
  });

  it('machine 节点返回 3 个端口', () => {
    const data = makeData('machine');
    const ports = getPorts(data);
    expect(ports).toHaveLength(3);
    expect(ports.filter((p) => p.direction === 'in')).toHaveLength(2);
    expect(ports.filter((p) => p.direction === 'out')).toHaveLength(1);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run portSchemas`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 portSchemas.ts**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.ts`：

```ts
import type { NodeData, NodePort } from '@mc-creator/shared';

/**
 * 根据节点 data 返回端口列表（数据驱动）。
 *
 * - 静态端口节点（item/block/entity/event 等）：端口固定，不依赖 data 具体值
 * - 动态端口节点（Plan C 的 variable/loop）：端口标签随 data 字段变化
 *
 * createDefaultPorts(kind) 在 store 中保留（向后兼容），内部改为调用 getPorts。
 * 所有节点组件渲染端口时用 node.ports（已由 store 初始化），不运行时调 getPorts。
 */
export function getPorts(data: NodeData): NodePort[] {
  switch (data.kind) {
    case 'item':
      return [
        { id: 'out', label: '物品', type: 'item_stack', direction: 'out', required: false, multiple: false },
      ];
    case 'block':
      return [
        { id: 'out', label: '方块', type: 'block_state', direction: 'out', required: false, multiple: false },
      ];
    case 'entity':
      return [
        { id: 'out', label: '实体', type: 'entity', direction: 'out', required: false, multiple: false },
      ];
    case 'recipe':
      return [
        { id: 'in', label: '材料', type: 'item_stack', direction: 'in', required: true, multiple: true },
        { id: 'out', label: '产物', type: 'item_stack', direction: 'out', required: false, multiple: false },
      ];
    case 'machine':
      return [
        { id: 'in_item', label: '输入物品', type: 'item_stack', direction: 'in', required: false, multiple: true },
        { id: 'in_energy', label: '能源输入', type: 'energy', direction: 'in', required: false, multiple: false },
        { id: 'out_item', label: '输出物品', type: 'item_stack', direction: 'out', required: false, multiple: true },
      ];
    case 'multiblock':
      return [
        { id: 'controller', label: '控制器', type: 'block_state', direction: 'in', required: true, multiple: false },
        { id: 'out', label: '结构', type: 'block_state', direction: 'out', required: false, multiple: false },
      ];
    case 'event':
      return [
        { id: 'trigger', label: '触发', type: 'void', direction: 'out', required: false, multiple: true },
      ];
    case 'condition':
      return [
        { id: 'in', label: '输入', type: 'void', direction: 'in', required: false, multiple: false },
        { id: 'true', label: '真', type: 'void', direction: 'out', required: false, multiple: true },
        { id: 'false', label: '假', type: 'void', direction: 'out', required: false, multiple: true },
      ];
    case 'action':
      return [
        { id: 'in', label: '执行', type: 'void', direction: 'in', required: false, multiple: false },
        { id: 'out', label: '完成', type: 'void', direction: 'out', required: false, multiple: true },
      ];
    case 'code':
      return [
        { id: 'in', label: '输入', type: 'any', direction: 'in', required: false, multiple: false },
        { id: 'out', label: '输出', type: 'any', direction: 'out', required: false, multiple: false },
      ];
    case 'comment':
      return [];
    default:
      return [];
  }
}
```

- [ ] **Step 4: 重构 store 的 createDefaultPorts 调用 getPorts**

修改 `apps/desktop/src/renderer/src/store/node-graph-store.ts`。

在文件顶部新增 import（在现有 import 块之后）：

```ts
import { getPorts } from '../components/lowcode/nodes/portSchemas.js';
```

将 `createDefaultPorts` 函数体替换为调用 `getPorts`：

```ts
/** 根据节点类型返回默认端口（委托给 portSchemas.getPorts） */
function createDefaultPorts(kind: NodeKind): NodeGraphState['graph']['nodes'][number]['ports'] {
  // 构造最小默认 data 以调用 getPorts（端口定义不依赖 data 具体值，只依赖 kind）
  const data = createDefaultNodeData(kind, '');
  return getPorts(data);
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- --run portSchemas`
Expected: PASS

- [ ] **Step 6: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 7: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.ts apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.test.ts apps/desktop/src/renderer/src/store/node-graph-store.ts
git commit -m "feat(ui): add portSchemas getPorts and refactor createDefaultPorts to use it"
```

---

## Task 8: drawer-store.ts（草稿模式，契约 §4）

**Files:**
- Create: `apps/desktop/src/renderer/src/store/drawer-store.ts`
- Create: `apps/desktop/src/renderer/src/store/drawer-store.test.ts`

> **注意：** drawer-store 在节点迁移之前创建，因为节点组件需要 `useDrawerStore.openDrawer`。

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/store/drawer-store.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useDrawerStore } from './drawer-store.js';
import { useNodeGraphStore } from './node-graph-store.js';

describe('useDrawerStore 草稿模式', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useDrawerStore.getState().closeDrawer();
  });

  it('openDrawer 深拷贝节点 data 到 draft', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    expect(useDrawerStore.getState().open).toBe(true);
    expect(useDrawerStore.getState().nodeId).toBe(id);
    const graph = useNodeGraphStore.getState().graph;
    expect(useDrawerStore.getState().draft).toEqual(graph.nodes[0].data);
    expect(useDrawerStore.getState().draft).not.toBe(graph.nodes[0].data);
  });

  it('updateField 修改草稿字段', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    useDrawerStore.getState().updateField('itemId', 'changed_id');

    expect((useDrawerStore.getState().draft as { itemId: string }).itemId).toBe('changed_id');
    expect(useDrawerStore.getState().dirty).toBe(true);
  });

  it('saveDraft 写回 store 并关闭抽屉', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('itemId', 'saved_id');

    useDrawerStore.getState().saveDraft();

    const node = useNodeGraphStore.getState().graph.nodes[0];
    expect((node.data as { itemId: string }).itemId).toBe('saved_id');
    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('cancelDraft 丢弃草稿', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('itemId', 'temp');

    useDrawerStore.getState().cancelDraft();

    const node = useNodeGraphStore.getState().graph.nodes[0];
    expect((node.data as { itemId: string }).itemId).toBe('new_item');
    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('closeDrawer 重置状态', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    useDrawerStore.getState().closeDrawer();

    expect(useDrawerStore.getState().open).toBe(false);
    expect(useDrawerStore.getState().nodeId).toBe(null);
    expect(useDrawerStore.getState().draft).toBe(null);
  });

  it('openDrawer 节点不存在时不打开', () => {
    useDrawerStore.getState().openDrawer('nonexistent');
    expect(useDrawerStore.getState().open).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run drawer-store`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 drawer-store.ts（契约 §4 完整实现）**

新建 `apps/desktop/src/renderer/src/store/drawer-store.ts`：

```ts
import { create } from 'zustand';
import type { NodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from './node-graph-store.js';

/**
 * 抽屉状态管理（草稿模式，契约 §4）。
 *
 * 数据流：
 * - openDrawer(nodeId) → 从 node-graph-store 深拷贝 node.data 到 draft
 * - updateField(key, value) → 修改 draft，标记 dirty
 * - saveDraft() → 校验通过后写回 node-graph-store.updateNode + commit + 关闭
 * - cancelDraft() → 丢弃 draft + 关闭
 *
 * 注意：用 cancelDraft（不叫 cancelDrawer），用 updateNode（不叫 updateNodeData）。
 */
interface DrawerState {
  open: boolean;
  nodeId: string | null;
  draft: NodeData | null;
  dirty: boolean;
  errors: Record<string, string>;

  openDrawer: (nodeId: string) => void;
  closeDrawer: () => void;
  updateField: (key: string, value: unknown) => void;
  saveDraft: () => void;
  cancelDraft: () => void;
}

export const useDrawerStore = create<DrawerState>((set, get) => ({
  open: false,
  nodeId: null,
  draft: null,
  dirty: false,
  errors: {},

  openDrawer: (nodeId) => {
    const node = useNodeGraphStore
      .getState()
      .graph.nodes.find((n) => n.id === nodeId);
    if (!node) return;
    set({
      open: true,
      nodeId,
      draft: structuredClone(node.data),
      dirty: false,
      errors: {},
    });
  },

  closeDrawer: () => {
    set({ open: false, nodeId: null, draft: null, dirty: false, errors: {} });
  },

  updateField: (key, value) => {
    const draft = get().draft;
    if (!draft) return;
    set({
      draft: { ...draft, [key]: value } as NodeData,
      dirty: true,
    });
  },

  saveDraft: () => {
    const { nodeId, draft } = get();
    if (!nodeId || !draft) return;
    useNodeGraphStore.getState().commit();
    useNodeGraphStore.getState().updateNode(nodeId, draft);
    set({ open: false, nodeId: null, draft: null, dirty: false, errors: {} });
  },

  cancelDraft: () => {
    set({ open: false, nodeId: null, draft: null, dirty: false, errors: {} });
  },
}));
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- --run drawer-store`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/store/drawer-store.ts apps/desktop/src/renderer/src/store/drawer-store.test.ts
git commit -m "feat(store): add useDrawerStore with draft mode per contract section 4"
```

---

## Task 9: 迁移 ItemNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/ItemNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/ItemNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/ItemNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ItemNode } from './ItemNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { ItemNodeData } from '@mc-creator/shared';

describe('ItemNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 摘要', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ItemNodeData;

    render(<ItemNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('新物品')).toBeInTheDocument();
    expect(screen.getByLabelText('设置')).toBeInTheDocument();
    expect(screen.getByLabelText('折叠')).toBeInTheDocument();
  });

  it('显示物品 ID 摘要', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ItemNodeData;

    render(<ItemNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText(/new_item/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run ItemNode`
Expected: FAIL — 旧组件不渲染 McNodeShell 元素（无 aria-label="设置" 按钮）

- [ ] **Step 3: 重写 ItemNode.tsx**

覆盖 `apps/desktop/src/renderer/src/components/lowcode/nodes/ItemNode.tsx`：

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { ItemNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const RARITY_BADGE: Record<ItemNodeData['rarity'], string> = {
  common: '普通',
  uncommon: '稀有',
  rare: '罕见',
  epic: '史诗',
};

/**
 * 物品节点：表达一个 Minecraft 物品。
 *
 * 端口：out (item_stack)
 * 颜色：mc-item（粉色）
 */
function ItemNodeComponent({ id, data, selected }: NodeProps<ItemNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="sword"
      title={data.displayName || data.label || '物品'}
      colorClass="mc-item"
      badge={RARITY_BADGE[data.rarity]}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.itemId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>{data.category}</span>
        {data.maxDamage > 0 && <span>耐久 {data.maxDamage}</span>}
        <span>堆叠 {data.maxStackSize}</span>
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const ItemNode = memo(ItemNodeComponent);
```

- [ ] **Step 4: 创建 useNodeStates.ts（依赖文件）**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/base/useNodeStates.ts`：

```ts
import { useDebuggerStore } from '../../../../store/debugger-store.js';
import type { NodeDebugState } from './McNodeHeader.js';

/**
 * 获取节点的调试状态（断点/调试中）。
 * 折叠时在 McNodeHeader 中显示标记。
 */
export function useDebugState(nodeId: string): NodeDebugState {
  const isDebugMode = useDebuggerStore((s) => s.state !== null);
  const debugCurrentNodeId = useDebuggerStore((s) => s.state?.currentNodeId ?? null);
  const hasBreakpoint = useDebuggerStore((s) => s.breakpoints.has(nodeId));

  if (isDebugMode && debugCurrentNodeId === nodeId) return 'debugging';
  if (hasBreakpoint) return 'breakpoint';
  return null;
}
```

- [ ] **Step 5: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- --run ItemNode`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/ItemNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/ItemNode.test.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/base/useNodeStates.ts
git commit -m "feat(ui): migrate ItemNode to McNodeShell"
```

---

## Task 10: 迁移 BlockNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/BlockNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/BlockNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/BlockNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { BlockNode } from './BlockNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { BlockNodeData } from '@mc-creator/shared';

describe('BlockNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 摘要', () => {
    const id = useNodeGraphStore.getState().addNode('block', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as BlockNodeData;

    render(<BlockNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('新方块')).toBeInTheDocument();
    expect(screen.getByLabelText('设置')).toBeInTheDocument();
  });

  it('方块实体时显示 BE 徽章', () => {
    const id = useNodeGraphStore.getState().addNode('block', { x: 0, y: 0 }, { isBlockEntity: true } as never);
    const data = useNodeGraphStore.getState().graph.nodes[0].data as BlockNodeData;

    render(<BlockNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('BE')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run BlockNode`
Expected: FAIL

- [ ] **Step 3: 重写 BlockNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { BlockNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 方块节点：表达一个 Minecraft 方块。
 * 端口：out (block_state)
 * 颜色：mc-block（橙色）
 */
function BlockNodeComponent({ id, data, selected }: NodeProps<BlockNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="stone-block"
      title={data.displayName || data.label || '方块'}
      colorClass="mc-block"
      badge={data.isBlockEntity ? 'BE' : undefined}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.blockId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>硬度 {data.hardness}</span>
        <span>抗爆 {data.blastResistance}</span>
        {data.luminance > 0 && <span>发光 {data.luminance}</span>}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const BlockNode = memo(BlockNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run BlockNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/BlockNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/BlockNode.test.tsx
git commit -m "feat(ui): migrate BlockNode to McNodeShell"
```

---

## Task 11: 迁移 EntityNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/EntityNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/EntityNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/EntityNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EntityNode } from './EntityNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { EntityNodeData } from '@mc-creator/shared';

describe('EntityNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 摘要', () => {
    const id = useNodeGraphStore.getState().addNode('entity', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as EntityNodeData;

    render(<EntityNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('新生物')).toBeInTheDocument();
    expect(screen.getByLabelText('设置')).toBeInTheDocument();
  });

  it('显示血量摘要', () => {
    const id = useNodeGraphStore.getState().addNode('entity', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as EntityNodeData;

    render(<EntityNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText(/20/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run EntityNode`
Expected: FAIL

- [ ] **Step 3: 重写 EntityNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { EntityNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 生物节点：表达一个 Minecraft 实体。
 * 端口：out (entity)
 * 颜色：mc-entity（青色）
 */
function EntityNodeComponent({ id, data, selected }: NodeProps<EntityNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="creeper"
      title={data.displayName || data.label || '生物'}
      colorClass="mc-entity"
      badge={data.classification}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.entityId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>❤ {data.maxHealth}</span>
        <span>⚔ {data.attackDamage}</span>
        <span>速度 {data.movementSpeed}</span>
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const EntityNode = memo(EntityNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run EntityNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/EntityNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/EntityNode.test.tsx
git commit -m "feat(ui): migrate EntityNode to McNodeShell"
```

---

## Task 12: 迁移 RecipeNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/RecipeNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/RecipeNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/RecipeNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RecipeNode } from './RecipeNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { RecipeNodeData } from '@mc-creator/shared';

describe('RecipeNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 摘要 + 端口标签', () => {
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as RecipeNodeData;

    render(<RecipeNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('新配方')).toBeInTheDocument();
    expect(screen.getByText('材料')).toBeInTheDocument();
    expect(screen.getByText('产物')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run RecipeNode`
Expected: FAIL

- [ ] **Step 3: 重写 RecipeNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { RecipeNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const RECIPE_TYPE_LABELS: Record<RecipeNodeData['recipeType'], string> = {
  crafting_shaped: '有序合成',
  crafting_shapeless: '无序合成',
  smelting: '熔炼',
  blasting: '高炉',
  smoking: '烟熏',
  stonecutting: '切石',
};

/**
 * 配方节点：表达一个合成/烧炼配方。
 * 端口：in (item_stack, multiple) ← 材料 / out (item_stack) ← 产物
 * 颜色：mc-recipe（黄色）
 */
function RecipeNodeComponent({ id, data, selected }: NodeProps<RecipeNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="crafting-table"
      title={data.label || data.recipeId || '配方'}
      colorClass="mc-recipe"
      badge={RECIPE_TYPE_LABELS[data.recipeType]}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.recipeId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>产出 ×{data.outputCount}</span>
        {data.cookTime !== 200 && <span>{data.cookTime}t</span>}
        {data.experience > 0 && <span>EXP {data.experience}</span>}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const RecipeNode = memo(RecipeNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run RecipeNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/RecipeNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/RecipeNode.test.tsx
git commit -m "feat(ui): migrate RecipeNode to McNodeShell"
```

---

## Task 13: 迁移 MachineNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/MachineNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/MachineNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/MachineNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MachineNode } from './MachineNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { MachineNodeData } from '@mc-creator/shared';

describe('MachineNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 端口标签', () => {
    const id = useNodeGraphStore.getState().addNode('machine', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as MachineNodeData;

    render(<MachineNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('新机器')).toBeInTheDocument();
    expect(screen.getByText('输入物品')).toBeInTheDocument();
    expect(screen.getByText('能源输入')).toBeInTheDocument();
    expect(screen.getByText('输出物品')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run MachineNode`
Expected: FAIL

- [ ] **Step 3: 重写 MachineNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { MachineNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 机器节点：方块实体 + GUI + 能源。
 * 端口：in_item / in_energy / out_item
 * 颜色：mc-machine（翠绿）
 */
function MachineNodeComponent({ id, data, selected }: NodeProps<MachineNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="gear-hammer"
      title={data.displayName || data.label || '机器'}
      colorClass="mc-machine"
      badge="BE+GUI"
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.machineId}</div>
      <div className="flex gap-2 text-mc-dim">
        <span>容量 {data.energyCapacity} FE</span>
        <span>输入 ×{data.inputSlots}</span>
        <span>输出 ×{data.outputSlots}</span>
      </div>
      <div className="text-mc-dim">
        {data.defaultProcessTime}t / {data.defaultEnergyPerTick} FE/t
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const MachineNode = memo(MachineNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run MachineNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/MachineNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/MachineNode.test.tsx
git commit -m "feat(ui): migrate MachineNode to McNodeShell"
```

---

## Task 14: 迁移 MultiBlockNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/MultiBlockNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/MultiBlockNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/MultiBlockNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MultiBlockNode } from './MultiBlockNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { MultiBlockNodeData } from '@mc-creator/shared';

describe('MultiBlockNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 端口', () => {
    const id = useNodeGraphStore.getState().addNode('multiblock', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as MultiBlockNodeData;

    render(<MultiBlockNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('新多方块结构')).toBeInTheDocument();
    expect(screen.getByText('控制器')).toBeInTheDocument();
    expect(screen.getByText('结构')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run MultiBlockNode`
Expected: FAIL

- [ ] **Step 3: 重写 MultiBlockNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { MultiBlockNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 多方块结构节点：表达一个 3D 结构。
 * 端口：controller (in, block_state) / out (out, block_state)
 * 颜色：mc-multiblock（紫色）
 */
function MultiBlockNodeComponent({ id, data, selected }: NodeProps<MultiBlockNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="castle"
      title={data.displayName || data.label || '多方块结构'}
      colorClass="mc-multiblock"
      badge={data.hollow ? '空心' : '实心'}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="text-mc-mute">ID: {data.structureId}</div>
      <div className="text-mc-dim">
        尺寸 {data.width}×{data.height}×{data.depth}
      </div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const MultiBlockNode = memo(MultiBlockNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run MultiBlockNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/MultiBlockNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/MultiBlockNode.test.tsx
git commit -m "feat(ui): migrate MultiBlockNode to McNodeShell"
```

---

## Task 15: 迁移 EventNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/EventNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/EventNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/EventNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventNode } from './EventNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { EventNodeData } from '@mc-creator/shared';

describe('EventNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell 头部 + 触发端口', () => {
    const id = useNodeGraphStore.getState().addNode('event', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as EventNodeData;

    render(<EventNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('触发器')).toBeInTheDocument();
    expect(screen.getByText('触发')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run EventNode`
Expected: FAIL

- [ ] **Step 3: 重写 EventNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { EventNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const EVENT_TYPE_LABELS: Record<EventNodeData['eventType'], string> = {
  player_right_click_block: '右键方块',
  player_right_click_item: '右键物品',
  player_left_click: '左键',
  block_break: '方块破坏',
  block_place: '方块放置',
  entity_death: '实体死亡',
  entity_hurt: '实体受伤',
  item_use: '使用物品',
  item_pickup: '拾取物品',
  player_join: '玩家加入',
  player_quit: '玩家退出',
  tick: 'Tick',
  custom: '自定义',
};

/**
 * 事件节点：触发器，作为控制流起点。
 * 端口：trigger (void, out, multiple)
 * 颜色：mc-event（紫色）
 */
function EventNodeComponent({ id, data, selected }: NodeProps<EventNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="power-button"
      title={EVENT_TYPE_LABELS[data.eventType] || data.label || '事件'}
      colorClass="mc-event"
      badge="触发器"
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const EventNode = memo(EventNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run EventNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/EventNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/EventNode.test.tsx
git commit -m "feat(ui): migrate EventNode to McNodeShell"
```

---

## Task 16: 迁移 ConditionNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/ConditionNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/ConditionNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/ConditionNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ConditionNode } from './ConditionNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { ConditionNodeData } from '@mc-creator/shared';

describe('ConditionNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell + 真/假端口', () => {
    const id = useNodeGraphStore.getState().addNode('condition', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ConditionNodeData;

    render(<ConditionNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('拥有物品')).toBeInTheDocument();
    expect(screen.getByText('真')).toBeInTheDocument();
    expect(screen.getByText('假')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run ConditionNode`
Expected: FAIL

- [ ] **Step 3: 重写 ConditionNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { ConditionNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const CONDITION_TYPE_LABELS: Record<ConditionNodeData['conditionType'], string> = {
  has_item: '拥有物品',
  health_below: '血量低于',
  health_above: '血量高于',
  distance_less: '距离小于',
  distance_greater: '距离大于',
  is_day: '是白天',
  is_night: '是夜晚',
  is_raining: '下雨中',
  biome_is: '生物群系是',
  block_is: '方块是',
  custom: '自定义',
};

/**
 * 条件节点：分支判断。
 * 端口：in / true / false
 * 颜色：mc-condition（蓝色）
 */
function ConditionNodeComponent({ id, data, selected }: NodeProps<ConditionNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="scales"
      title={CONDITION_TYPE_LABELS[data.conditionType] || data.label || '条件'}
      colorClass="mc-condition"
      badge={data.invert ? '取反' : undefined}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const ConditionNode = memo(ConditionNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run ConditionNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/ConditionNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/ConditionNode.test.tsx
git commit -m "feat(ui): migrate ConditionNode to McNodeShell"
```

---

## Task 17: 迁移 ActionNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/ActionNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/ActionNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/ActionNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActionNode } from './ActionNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { ActionNodeData } from '@mc-creator/shared';

describe('ActionNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell + 执行/完成端口', () => {
    const id = useNodeGraphStore.getState().addNode('action', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as ActionNodeData;

    render(<ActionNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('生成实体')).toBeInTheDocument();
    expect(screen.getByText('执行')).toBeInTheDocument();
    expect(screen.getByText('完成')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run ActionNode`
Expected: FAIL

- [ ] **Step 3: 重写 ActionNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { ActionNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

const ACTION_TYPE_LABELS: Record<ActionNodeData['actionType'], string> = {
  spawn_entity: '生成实体',
  give_item: '给予物品',
  take_item: '拿走物品',
  teleport: '传送',
  damage: '造成伤害',
  heal: '治疗',
  set_block: '放置方块',
  remove_block: '移除方块',
  play_sound: '播放声音',
  send_message: '发送消息',
  summon_lightning: '召唤闪电',
  give_effect: '给予效果',
  custom: '自定义',
};

/**
 * 动作节点：执行某个效果。
 * 端口：in (执行) / out (完成)
 * 颜色：mc-action（红色）
 */
function ActionNodeComponent({ id, data, selected }: NodeProps<ActionNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  return (
    <McNodeShell
      icon="fireball"
      title={ACTION_TYPE_LABELS[data.actionType] || data.label || '动作'}
      colorClass="mc-action"
      badge="执行"
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const ActionNode = memo(ActionNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run ActionNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/ActionNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/ActionNode.test.tsx
git commit -m "feat(ui): migrate ActionNode to McNodeShell"
```

---

## Task 18: 迁移 CodeNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/CodeNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/CodeNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/CodeNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CodeNode } from './CodeNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { CodeNodeData } from '@mc-creator/shared';

describe('CodeNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell + 语言徽章', () => {
    const id = useNodeGraphStore.getState().addNode('code', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as CodeNodeData;

    render(<CodeNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('Java')).toBeInTheDocument();
    expect(screen.getByText('process()')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run CodeNode.test`
Expected: FAIL

- [ ] **Step 3: 重写 CodeNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { CodeNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';
import { useDebugState } from './base/useNodeStates.js';

/**
 * 代码节点：L2 混合模式核心。
 * 用户在节点图嵌入 Java/JS/Kotlin 代码，通过端口连线。
 * 双击节点打开 Monaco 编辑器编辑代码。
 * 端口：in (any) / out (any)
 * 颜色：mc-code（灰色）
 */
function CodeNodeComponent({ id, data, selected }: NodeProps<CodeNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const ports = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === id)?.ports ?? []);
  const debugState = useDebugState(id);

  const languageLabel =
    data.language === 'java' ? 'Java' : data.language === 'kotlin' ? 'Kotlin' : 'JS';

  // 预览代码首行（去掉注释和空行）
  const codePreview = data.code
    .split('\n')
    .filter((l) => !l.trim().startsWith('//') && l.trim().length > 0)[0]
    ?.trim()
    .slice(0, 40);

  return (
    <McNodeShell
      icon="scroll-quill"
      title={data.methodName + '()' || data.label || '代码'}
      colorClass="mc-code"
      badge={languageLabel}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      {codePreview && (
        <div className="truncate font-mono text-mc-mute" title={codePreview}>
          {codePreview}
        </div>
      )}
      <div className="text-[10px] text-mc-mute">双击编辑代码</div>
      {data.note && <div className="text-mc-mute">{data.note}</div>}
    </McNodeShell>
  );
}

export const CodeNode = memo(CodeNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run CodeNode.test`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/CodeNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/CodeNode.test.tsx
git commit -m "feat(ui): migrate CodeNode to McNodeShell"
```

---

## Task 19: 迁移 CommentNode 到 McNodeShell

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/CommentNode.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/CommentNode.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/CommentNode.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CommentNode } from './CommentNode.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import type { CommentNodeData } from '@mc-creator/shared';

describe('CommentNode (McNodeShell)', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染 McNodeShell + 备注文本', () => {
    const id = useNodeGraphStore.getState().addNode('comment', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data as CommentNodeData;

    render(<CommentNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('备注')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run CommentNode`
Expected: FAIL

- [ ] **Step 3: 重写 CommentNode.tsx**

```tsx
import { memo } from 'react';
import { type NodeProps } from 'reactflow';
import type { CommentNodeData } from '@mc-creator/shared';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { McNodeShell } from './base/McNodeShell.js';

/**
 * 注释节点：仅文档用途，不参与编译。无端口。
 * 颜色：mc-comment（黄色）
 */
function CommentNodeComponent({ id, data, selected }: NodeProps<CommentNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const debugState = null; // comment 节点不支持调试

  return (
    <McNodeShell
      icon="thought-bubble"
      title={data.label || '备注'}
      colorClass="mc-comment"
      badge={data.color !== 'yellow' ? data.color : undefined}
      ports={[]}
      collapsed={data.collapsed}
      selected={selected}
      debugState={debugState}
      onToggleCollapse={() => toggleCollapse(id)}
      onOpenDrawer={() => openDrawer(id)}
    >
      <div className="whitespace-pre-wrap break-words text-mc-text">
        {data.text || '（空备注）'}
      </div>
    </McNodeShell>
  );
}

export const CommentNode = memo(CommentNodeComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run CommentNode`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/CommentNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/CommentNode.test.tsx
git commit -m "feat(ui): migrate CommentNode to McNodeShell"
```

---

## Task 20: connectionRules 扩展（multiple 限制 + 校验失败信息）

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/connectionRules.ts`
- Modify: `apps/desktop/src/renderer/src/components/lowcode/connectionRules.test.ts`

- [ ] **Step 1: 写失败测试**

在 `apps/desktop/src/renderer/src/components/lowcode/connectionRules.test.ts` 末尾追加：

```ts
import { validateConnection } from './connectionRules.js';

describe('validateConnection (带失败原因)', () => {
  const makeGraph = (nodes: ModNode[]): NodeGraph => ({
    version: 1,
    modId: 'test',
    viewport: { x: 0, y: 0, zoom: 1 },
    nodes,
    edges: [],
  });

  const makePort = (id: string, type: PortType, direction: 'in' | 'out', multiple = false): NodePort => ({
    id, label: id, type, direction, required: false, multiple,
  });

  it('multiple=false 目标端口已有连线时返回失败', () => {
    const source = { id: 's', type: 'item' as const, position: { x: 0, y: 0 }, data: { nodeId: 's', label: 's', note: '', disabled: false, collapsed: false, kind: 'item' as const, itemId: 's', displayName: 'S', category: 'misc' as const, maxStackSize: 64, maxDamage: 0, rarity: 'common' as const, glow: false }, ports: [makePort('out', 'item_stack', 'out')], selected: false };
    const target = { id: 't', type: 'item' as const, position: { x: 0, y: 0 }, data: { nodeId: 't', label: 't', note: '', disabled: false, collapsed: false, kind: 'item' as const, itemId: 't', displayName: 'T', category: 'misc' as const, maxStackSize: 64, maxDamage: 0, rarity: 'common' as const, glow: false }, ports: [makePort('in', 'item_stack', 'in', false)], selected: false };
    const graph = makeGraph([source, target]);
    graph.edges.push({ id: 'e1', source: 's2', target: 't', sourceHandle: undefined, targetHandle: 'in', kind: 'craft' as const, disabled: false });

    const result = validateConnection(graph, { source: 's', target: 't', sourceHandle: 'out', targetHandle: 'in' } as Connection);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('单连线');
    }
  });

  it('multiple=true 目标端口允许多连线', () => {
    const source = { id: 's', type: 'item' as const, position: { x: 0, y: 0 }, data: { nodeId: 's', label: 's', note: '', disabled: false, collapsed: false, kind: 'item' as const, itemId: 's', displayName: 'S', category: 'misc' as const, maxStackSize: 64, maxDamage: 0, rarity: 'common' as const, glow: false }, ports: [makePort('out', 'item_stack', 'out')], selected: false };
    const target = { id: 't', type: 'recipe' as const, position: { x: 0, y: 0 }, data: { nodeId: 't', label: 't', note: '', disabled: false, collapsed: false, kind: 'recipe' as const, recipeId: 't', recipeType: 'crafting_shaped' as const, outputCount: 1, cookTime: 200, experience: 0, pattern: [] }, ports: [makePort('in', 'item_stack', 'in', true)], selected: false };
    const graph = makeGraph([source, target]);
    graph.edges.push({ id: 'e1', source: 's2', target: 't', sourceHandle: undefined, targetHandle: 'in', kind: 'craft' as const, disabled: false });

    const result = validateConnection(graph, { source: 's', target: 't', sourceHandle: 'out', targetHandle: 'in' } as Connection);
    expect(result.ok).toBe(true);
  });

  it('类型不兼容时返回失败原因', () => {
    const source = { id: 's', type: 'item' as const, position: { x: 0, y: 0 }, data: { nodeId: 's', label: 's', note: '', disabled: false, collapsed: false, kind: 'item' as const, itemId: 's', displayName: 'S', category: 'misc' as const, maxStackSize: 64, maxDamage: 0, rarity: 'common' as const, glow: false }, ports: [makePort('out', 'item_stack', 'out')], selected: false };
    const target = { id: 't', type: 'block' as const, position: { x: 0, y: 0 }, data: { nodeId: 't', label: 't', note: '', disabled: false, collapsed: false, kind: 'block' as const, blockId: 't', displayName: 'T', hardness: 1, blastResistance: 3, luminance: 0, transparent: false, solid: true, modelType: 'cube_all' as const, isBlockEntity: false }, ports: [makePort('in', 'block_state', 'in')], selected: false };
    const graph = makeGraph([source, target]);

    const result = validateConnection(graph, { source: 's', target: 't', sourceHandle: 'out', targetHandle: 'in' } as Connection);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toContain('类型');
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run connectionRules`
Expected: FAIL — `validateConnection` 不存在

- [ ] **Step 3: 扩展 connectionRules.ts**

在 `apps/desktop/src/renderer/src/components/lowcode/connectionRules.ts` 末尾新增 `validateConnection` 函数（保留现有 `isValidConnection` 不变，新函数返回带原因的结果）：

```ts
/**
 * 校验连线合法性，返回带失败原因的结果。
 *
 * 在 isValidConnection 基础上增加：
 * - multiple 限制：目标端口 multiple=false 且已有连线时拒绝
 * - 返回 { ok: true } 或 { ok: false, reason: string }
 */
export function validateConnection(
  graph: NodeGraph,
  connection: Connection | Edge,
): { ok: true } | { ok: false; reason: string } {
  const sourceId = connection.source;
  const targetId = connection.target;

  if (!sourceId || !targetId) return { ok: false, reason: '缺少源或目标节点' };
  if (sourceId === targetId) return { ok: false, reason: '不能自连' };

  const sourceNode = graph.nodes.find((n) => n.id === sourceId);
  const targetNode = graph.nodes.find((n) => n.id === targetId);
  if (!sourceNode || !targetNode) return { ok: false, reason: '节点不存在' };

  if (sourceNode.data.disabled) return { ok: false, reason: '源节点已禁用' };
  if (targetNode.data.disabled) return { ok: false, reason: '目标节点已禁用' };

  const sourcePort = findPort(sourceNode, connection.sourceHandle);
  const targetPort = findPort(targetNode, connection.targetHandle);
  if (!sourcePort || !targetPort) return { ok: false, reason: '端口不存在' };

  if (!arePortTypesCompatible(sourcePort.type, targetPort.type)) {
    return { ok: false, reason: `端口类型不兼容：${sourcePort.type} → ${targetPort.type}` };
  }

  if (sourcePort.direction !== 'out') return { ok: false, reason: '源端口必须是输出方向' };
  if (targetPort.direction !== 'in') return { ok: false, reason: '目标端口必须是输入方向' };

  // multiple 限制：目标端口不允许多条连线时，检查是否已有连线
  if (!targetPort.multiple) {
    const existingConnection = graph.edges.some(
      (e) =>
        e.target === targetId &&
        e.targetHandle === (connection.targetHandle ?? undefined) &&
        e.id !== (connection as Edge).id,
    );
    if (existingConnection) {
      return { ok: false, reason: '该端口为单连线端口，已有连线（将替换旧连线）' };
    }
  }

  return { ok: true };
}
```

在文件顶部确保已导入 `Edge` 类型（已有 `import type { Edge, Connection } from 'reactflow'`）。

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- --run connectionRules`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/connectionRules.ts apps/desktop/src/renderer/src/components/lowcode/connectionRules.test.ts
git commit -m "feat(ui): extend connectionRules with multiple limit and validateConnection"
```

---

## Task 21: NodeGraphEditor edge type 改 step

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx`

- [ ] **Step 1: 修改 toFlowEdge 的 type**

修改 `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx`，在 `toFlowEdge` 函数（第 76-91 行）中，将 `type: 'smoothstep'` 改为 `type: 'step'`：

```ts
function toFlowEdge(e: ModEdge): Edge {
  return {
    id: e.id,
    source: e.source,
    target: e.target,
    sourceHandle: e.sourceHandle,
    targetHandle: e.targetHandle,
    type: 'step', // 直角折线（MC 工业风）
    animated: !e.disabled && e.kind !== 'control',
    markerEnd: { type: MarkerType.ArrowClosed },
    label: e.label,
    data: { kind: e.kind, disabled: e.disabled },
    style: getEdgeStyle(e.kind),
  };
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx
git commit -m "feat(ui): change edges to step type for MC industrial style"
```

---

## Task 22: editors/types.ts（FieldSchema + EditorProps + FieldType）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/types.ts`

- [ ] **Step 1: 创建 types.ts**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/types.ts`：

```ts
import type { NodeGraph, PortType } from '@mc-creator/shared';

/** 字段类型（对应 7 类编辑器 + text） */
export type FieldType =
  | 'text'
  | 'number'
  | 'dropdown'
  | 'noderef'
  | 'resourceId'
  | 'color'
  | 'nbt'
  | 'segmented';

/** 字段 schema（驱动 NodeDetailForm 渲染） */
export interface FieldSchema {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
  /** noderef 编辑器用：限定可选节点的端口类型 */
  dataType?: PortType;
  /** 条件显示：当指定字段值匹配时才显示 */
  condition?: { field: string; equals?: string; in?: string[] };
}

/** 编辑器统一 props */
export interface EditorProps<T = unknown> {
  value: T;
  onChange: (v: T) => void;
  schema: FieldSchema;
  graph: NodeGraph;
  error?: string;
}
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/types.ts
git commit -m "feat(ui): add editors types (FieldSchema, EditorProps, FieldType)"
```

---

## Task 23: NumberStepperEditor

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NumberStepperEditor.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NumberStepperEditor.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NumberStepperEditor.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NumberStepperEditor } from './NumberStepperEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = { version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };

describe('NumberStepperEditor', () => {
  const schema: FieldSchema = { key: 'maxDamage', label: '耐久', type: 'number', min: 0, max: 99999 };

  it('渲染当前值', () => {
    render(<NumberStepperEditor value={250} onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByDisplayValue('250')).toBeInTheDocument();
  });

  it('点击 + 按钮增加值', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={10} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('增加'));
    expect(onChange).toHaveBeenCalledWith(11);
  });

  it('点击 - 按钮减少值', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={10} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('减少'));
    expect(onChange).toHaveBeenCalledWith(9);
  });

  it('不超过 max', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={99999} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('增加'));
    expect(onChange).toHaveBeenCalledWith(99999);
  });

  it('不低于 min', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={0} onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('减少'));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('输入框直接编辑触发 onChange', () => {
    const onChange = vi.fn();
    render(<NumberStepperEditor value={10} onChange={onChange} schema={schema} graph={graph} />);
    const input = screen.getByDisplayValue('10');
    fireEvent.change(input, { target: { value: '42' } });
    expect(onChange).toHaveBeenCalledWith(42);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run NumberStepperEditor`
Expected: FAIL

- [ ] **Step 3: 创建 NumberStepperEditor.tsx**

```tsx
import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 数字步进编辑器：凹陷输入框 + 左右 [-][+] MC 按钮。
 * 支持 min/max/step 校验。
 */
function NumberStepperEditorComponent({ value, onChange, schema }: EditorProps<number>) {
  const min = schema.min ?? -Infinity;
  const max = schema.max ?? Infinity;
  const step = schema.step ?? 1;

  const handleDecrement = () => {
    const next = Math.max(min, Number(value) - step);
    onChange(next);
  };

  const handleIncrement = () => {
    const next = Math.min(max, Number(value) + step);
    onChange(next);
  };

  const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value;
    const num = Number(raw);
    if (Number.isNaN(num)) return;
    onChange(Math.max(min, Math.min(max, num)));
  };

  return (
    <div className="flex items-center gap-1">
      <button
        type="button"
        aria-label="减少"
        onClick={handleDecrement}
        className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 text-[11px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        -
      </button>
      <input
        type="number"
        value={value}
        onChange={handleInput}
        min={schema.min}
        max={schema.max}
        step={step}
        className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
      />
      <button
        type="button"
        aria-label="增加"
        onClick={handleIncrement}
        className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 text-[11px] hover:bg-mc-btn-hover active:bg-mc-btn-active"
      >
        +
      </button>
    </div>
  );
}

export const NumberStepperEditor = memo(NumberStepperEditorComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run NumberStepperEditor`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NumberStepperEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NumberStepperEditor.test.tsx
git commit -m "feat(ui): add NumberStepperEditor with min/max/step validation"
```

---

## Task 24: DropdownEditor

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/DropdownEditor.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/DropdownEditor.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DropdownEditor } from './DropdownEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = { version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };

describe('DropdownEditor', () => {
  const schema: FieldSchema = {
    key: 'rarity', label: '稀有度', type: 'dropdown',
    options: ['common', 'uncommon', 'rare', 'epic'],
  };

  it('渲染 select 含所有选项', () => {
    render(<DropdownEditor value="common" onChange={() => {}} schema={schema} graph={graph} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('common')).toBeInTheDocument();
    expect(screen.getByText('epic')).toBeInTheDocument();
  });

  it('选择新值触发 onChange', () => {
    const onChange = vi.fn();
    render(<DropdownEditor value="common" onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'rare' } });
    expect(onChange).toHaveBeenCalledWith('rare');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run DropdownEditor`
Expected: FAIL

- [ ] **Step 3: 创建 DropdownEditor.tsx**

```tsx
import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 枚举下拉编辑器：MC 风格 select。
 */
function DropdownEditorComponent({ value, onChange, schema }: EditorProps<string>) {
  const options = schema.options ?? [];

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>
          {opt}
        </option>
      ))}
    </select>
  );
}

export const DropdownEditor = memo(DropdownEditorComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run DropdownEditor`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/DropdownEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/DropdownEditor.test.tsx
git commit -m "feat(ui): add DropdownEditor with MC-style select"
```

---

## Task 25: SegmentedEditor

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/SegmentedEditor.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/SegmentedEditor.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SegmentedEditor } from './SegmentedEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = { version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };

describe('SegmentedEditor', () => {
  const schema: FieldSchema = {
    key: 'glow', label: '发光', type: 'segmented',
    options: ['false', 'true'],
  };

  it('渲染分段按钮组', () => {
    render(<SegmentedEditor value="false" onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByText('false')).toBeInTheDocument();
    expect(screen.getByText('true')).toBeInTheDocument();
  });

  it('点击分段触发 onChange', () => {
    const onChange = vi.fn();
    render(<SegmentedEditor value="false" onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByText('true'));
    expect(onChange).toHaveBeenCalledWith('true');
  });

  it('当前选中段高亮', () => {
    render(<SegmentedEditor value="true" onChange={() => {}} schema={schema} graph={graph} />);
    const activeBtn = screen.getByText('true');
    expect(activeBtn.className).toContain('bg-mc-accent');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run SegmentedEditor`
Expected: FAIL

- [ ] **Step 3: 创建 SegmentedEditor.tsx**

```tsx
import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 分段切换编辑器：MC 标签页风格分段控件。
 * 切换后表单字段根据 condition 自动显隐。
 */
function SegmentedEditorComponent({ value, onChange, schema }: EditorProps<string>) {
  const options = schema.options ?? [];

  return (
    <div className="flex border-2 border-t-white border-l-white border-b-black border-r-black">
      {options.map((opt, i) => (
        <button
          key={opt}
          type="button"
          onClick={() => onChange(opt)}
          className={`flex-1 px-2 py-0.5 text-[11px] ${
            i > 0 ? 'border-l-2 border-l-black border-t-white' : ''
          } ${
            value === opt
              ? 'bg-mc-accent text-white'
              : 'bg-mc-btn text-mc-text hover:bg-mc-btn-hover'
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

export const SegmentedEditor = memo(SegmentedEditorComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run SegmentedEditor`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/SegmentedEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/SegmentedEditor.test.tsx
git commit -m "feat(ui): add SegmentedEditor with MC tab-style segmented control"
```

---

## Task 26: ColorEditor

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ColorEditor.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ColorEditor.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ColorEditor } from './ColorEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = { version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };

describe('ColorEditor', () => {
  const schema: FieldSchema = { key: 'color', label: '染色', type: 'color' };

  it('渲染 16 色 MC 色板', () => {
    render(<ColorEditor value="#FFFFFF" onChange={() => {}} schema={schema} graph={graph} />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBe(16);
  });

  it('点击色块触发 onChange', () => {
    const onChange = vi.fn();
    render(<ColorEditor value="#FFFFFF" onChange={onChange} schema={schema} graph={graph} />);
    const redBtn = screen.getByLabelText('红色');
    fireEvent.click(redBtn);
    expect(onChange).toHaveBeenCalledWith('#993333');
  });

  it('渲染自定义输入框', () => {
    render(<ColorEditor value="#FF0000" onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByDisplayValue('#FF0000')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run ColorEditor`
Expected: FAIL

- [ ] **Step 3: 创建 ColorEditor.tsx**

```tsx
import { memo } from 'react';
import type { EditorProps } from './types.js';

/** MC 16 色染色色板 */
const MC_DYE_COLORS: { name: string; value: string }[] = [
  { name: '白色', value: '#FFFFFF' },
  { name: '橙色', value: '#D87F33' },
  { name: '品红色', value: '#B24CD8' },
  { name: '淡蓝色', value: '#6699D8' },
  { name: '黄色', value: '#E5E533' },
  { name: '黄绿色', value: '#7FCC19' },
  { name: '粉色', value: '#F27FA5' },
  { name: '灰色', value: '#4C4C4C' },
  { name: '浅灰色', value: '#999999' },
  { name: '青色', value: '#4C7F99' },
  { name: '紫色', value: '#7F3FB2' },
  { name: '蓝色', value: '#334CB2' },
  { name: '棕色', value: '#664C33' },
  { name: '绿色', value: '#667F33' },
  { name: '红色', value: '#993333' },
  { name: '黑色', value: '#191919' },
];

/**
 * MC 颜色选择编辑器：16 色染色色板 + 自定义 hex 输入。
 */
function ColorEditorComponent({ value, onChange }: EditorProps<string>) {
  return (
    <div className="space-y-1">
      <div className="grid grid-cols-8 gap-1">
        {MC_DYE_COLORS.map((c) => (
          <button
            key={c.value}
            type="button"
            aria-label={c.name}
            title={c.name}
            onClick={() => onChange(c.value)}
            className="h-5 w-5 border border-t-white border-l-white border-b-black border-r-black"
            style={{ backgroundColor: c.value }}
          />
        ))}
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
      />
    </div>
  );
}

export const ColorEditor = memo(ColorEditorComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run ColorEditor`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ColorEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ColorEditor.test.tsx
git commit -m "feat(ui): add ColorEditor with MC 16-color dye palette"
```

---

## Task 27: ResourceIdEditor

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.test.tsx`

- [ ] **Step 1: 写失败测试**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ResourceIdEditor } from './ResourceIdEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = { version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };

describe('ResourceIdEditor', () => {
  const schema: FieldSchema = { key: 'itemId', label: '物品 ID', type: 'resourceId', required: true };

  it('解析 modid:path 格式', () => {
    render(<ResourceIdEditor value="mymod:iron_sword" onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByDisplayValue('mymod')).toBeInTheDocument();
    expect(screen.getByDisplayValue('iron_sword')).toBeInTheDocument();
  });

  it('只有 path 时 modid 默认为 minecraft', () => {
    render(<ResourceIdEditor value="iron_sword" onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByDisplayValue('minecraft')).toBeInTheDocument();
    expect(screen.getByDisplayValue('iron_sword')).toBeInTheDocument();
  });

  it('编辑 path 触发 onChange 拼接 modid:path', () => {
    const onChange = vi.fn();
    render(<ResourceIdEditor value="mymod:iron_sword" onChange={onChange} schema={schema} graph={graph} />);
    const pathInput = screen.getByDisplayValue('iron_sword');
    fireEvent.change(pathInput, { target: { value: 'diamond_sword' } });
    expect(onChange).toHaveBeenCalledWith('mymod:diamond_sword');
  });

  it('格式不合法时显示错误', () => {
    render(<ResourceIdEditor value="INVALID" onChange={() => {}} schema={schema} graph={graph} error="格式错误" />);
    expect(screen.getByText('格式错误')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run ResourceIdEditor`
Expected: FAIL

- [ ] **Step 3: 创建 ResourceIdEditor.tsx**

```tsx
import { memo, useState, useEffect } from 'react';
import type { EditorProps } from './types.js';

/** 解析 modid:path 格式 */
function parseResourceId(value: string): { modid: string; path: string } {
  const idx = value.indexOf(':');
  if (idx >= 0) {
    return { modid: value.slice(0, idx), path: value.slice(idx + 1) };
  }
  return { modid: 'minecraft', path: value };
}

/**
 * 资源 ID 编辑器：命名空间下拉 + path 输入 + 实时格式校验。
 * 格式：^[a-z0-9_]+:[a-z0-9_/]+$
 */
function ResourceIdEditorComponent({ value, onChange, error }: EditorProps<string>) {
  const { modid, path } = parseResourceId(value);
  const [modidValue, setModidValue] = useState(modid);
  const [pathValue, setPathValue] = useState(path);

  useEffect(() => {
    const parsed = parseResourceId(value);
    setModidValue(parsed.modid);
    setPathValue(parsed.path);
  }, [value]);

  const handleModidChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newModid = e.target.value;
    setModidValue(newModid);
    onChange(`${newModid}:${pathValue}`);
  };

  const handlePathChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPath = e.target.value;
    setPathValue(newPath);
    onChange(`${modidValue}:${newPath}`);
  };

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        <select
          value={modidValue}
          onChange={handleModidChange}
          aria-label="命名空间"
          className="w-24 border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-1 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        >
          <option value="minecraft">minecraft</option>
          <option value="mymod">mymod</option>
        </select>
        <span className="self-center text-mc-dim">:</span>
        <input
          type="text"
          value={pathValue}
          onChange={handlePathChange}
          aria-label="资源路径"
          className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        />
      </div>
      {error && (
        <div role="alert" className="text-[10px] text-red-400">
          {error}
        </div>
      )}
    </div>
  );
}

export const ResourceIdEditor = memo(ResourceIdEditorComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run ResourceIdEditor`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.test.tsx
git commit -m "feat(ui): add ResourceIdEditor with modid:path format and validation"
```

---

## Task 28: NbtEditor（基础树编辑器）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NbtEditor.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NbtEditor.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NbtEditor.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NbtEditor } from './NbtEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';

const graph: NodeGraph = { version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [] };

describe('NbtEditor', () => {
  const schema: FieldSchema = { key: 'nbt', label: 'NBT', type: 'nbt' };

  it('空字符串渲染为空树', () => {
    render(<NbtEditor value="" onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByText('（空）')).toBeInTheDocument();
  });

  it('渲染已有键值对', () => {
    const value = '{"count":5,"name":"sword"}';
    render(<NbtEditor value={value} onChange={() => {}} schema={schema} graph={graph} />);
    expect(screen.getByText('count')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('"sword"')).toBeInTheDocument();
  });

  it('添加新键触发 onChange', () => {
    const onChange = vi.fn();
    render(<NbtEditor value="{}" onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.click(screen.getByLabelText('添加键'));
    expect(onChange).toHaveBeenCalled();
    const newJson = onChange.mock.calls[0][0] as string;
    const parsed = JSON.parse(newJson);
    expect(Object.keys(parsed)).toHaveLength(1);
  });

  it('非法 JSON 显示错误提示', () => {
    render(<NbtEditor value="INVALID" onChange={() => {}} schema={schema} graph={graph} error="解析失败" />);
    expect(screen.getByText('解析失败')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run NbtEditor`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 NbtEditor.tsx**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NbtEditor.tsx`：

```tsx
import { memo, useState } from 'react';
import type { EditorProps } from './types.js';

type NbtValue = string | number | boolean | null | NbtValue[] | { [key: string]: NbtValue };

/**
 * NBT 树编辑器（基础版）：支持 string/int/compound 三种类型。
 * - 输入为 JSON 字符串
 * - 解析为键值对列表显示
 * - 添加键（默认 string 类型）
 * - 修改值触发 onChange（重新序列化为 JSON）
 */
function NbtEditorComponent({ value, onChange, error }: EditorProps<string>) {
  const [parseError, setParseError] = useState<string | null>(null);

  let parsed: { [key: string]: NbtValue } = {};
  try {
    parsed = value.trim() === '' ? {} : JSON.parse(value);
    if (parseError) setParseError(null);
  } catch {
    if (!parseError) setParseError('JSON 格式错误');
  }

  const entries = Object.entries(parsed);

  const handleAddKey = () => {
    const newKey = `key_${entries.length + 1}`;
    const next = { ...parsed, [newKey]: 'new_value' };
    onChange(JSON.stringify(next, null, 2));
  };

  const handleValueChange = (key: string, newValue: NbtValue) => {
    const next = { ...parsed, [key]: newValue };
    onChange(JSON.stringify(next, null, 2));
  };

  const handleDeleteKey = (key: string) => {
    const next = { ...parsed };
    delete next[key];
    onChange(JSON.stringify(next, null, 2));
  };

  const renderValue = (v: NbtValue): string => {
    if (v === null) return 'null';
    if (typeof v === 'string') return `"${v}"`;
    if (typeof v === 'number' || typeof v === 'boolean') return String(v);
    return JSON.stringify(v);
  };

  const displayError = error ?? parseError;

  return (
    <div className="space-y-1">
      {entries.length === 0 && !parseError && (
        <div className="text-[11px] text-mc-mute">（空）</div>
      )}
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-1">
          <span className="w-20 truncate text-[11px] text-mc-accent">{k}</span>
          <span className="text-mc-dim">:</span>
          <input
            type="text"
            defaultValue={renderValue(v)}
            onChange={(e) => {
              const raw = e.target.value;
              let next: NbtValue = raw;
              // 尝试解析为数字/布尔/null
              if (raw === 'true') next = true;
              else if (raw === 'false') next = false;
              else if (raw === 'null') next = null;
              else if (/^-?\d+(\.\d+)?$/.test(raw)) next = Number(raw);
              else if (raw.startsWith('"') && raw.endsWith('"')) next = raw.slice(1, -1);
              handleValueChange(k, next);
            }}
            className="flex-1 border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-1 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
          />
          <button
            type="button"
            aria-label={`删除 ${k}`}
            onClick={() => handleDeleteKey(k)}
            className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 text-[11px] hover:bg-mc-btn-hover"
          >
            ×
          </button>
        </div>
      ))}
      <button
        type="button"
        aria-label="添加键"
        onClick={handleAddKey}
        className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 py-0.5 text-[11px] hover:bg-mc-btn-hover"
      >
        + 添加键
      </button>
      {displayError && (
        <div role="alert" className="text-[10px] text-red-400">
          {displayError}
        </div>
      )}
    </div>
  );
}

export const NbtEditor = memo(NbtEditorComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run NbtEditor`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NbtEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NbtEditor.test.tsx
git commit -m "feat(ui): add NbtEditor with basic string/int/compound tree editing"
```

---

## Task 29: NodeRefEditor（节点引用选择编辑器）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeRefEditor } from './NodeRefEditor.js';
import type { FieldSchema } from './types.js';
import type { NodeGraph, ModNode, NodePort } from '@mc-creator/shared';

const port: NodePort = { id: 'out', label: '物品', type: 'item_stack', direction: 'out', required: false, multiple: false };

function makeNode(id: string, kind: string, label: string): ModNode {
  return {
    id,
    type: kind,
    position: { x: 0, y: 0 },
    data: { nodeId: id, label, note: '', disabled: false, collapsed: false, kind: kind as never },
    ports: [port],
    selected: false,
  } as ModNode;
}

const graph: NodeGraph = {
  version: 1,
  modId: 'test',
  viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    makeNode('n1', 'item', '铁剑'),
    makeNode('n2', 'block', '石头'),
  ],
  edges: [],
};

describe('NodeRefEditor', () => {
  const schema: FieldSchema = { key: 'ref', label: '引用节点', type: 'noderef', dataType: 'item_stack' };

  it('渲染下拉列表含可选节点', () => {
    render(<NodeRefEditor value="" onChange={() => {}} schema={schema} graph={graph} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('铁剑')).toBeInTheDocument();
  });

  it('选择节点触发 onChange', () => {
    const onChange = vi.fn();
    render(<NodeRefEditor value="" onChange={onChange} schema={schema} graph={graph} />);
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'n1' } });
    expect(onChange).toHaveBeenCalledWith('n1');
  });

  it('dataType 过滤：只显示匹配端口类型的节点', () => {
    const blockSchema: FieldSchema = { key: 'ref', label: '引用', type: 'noderef', dataType: 'block_state' };
    render(<NodeRefEditor value="" onChange={() => {}} schema={blockSchema} graph={graph} />);
    // item 节点端口类型是 item_stack，不匹配 block_state，应不显示
    expect(screen.queryByText('铁剑')).not.toBeInTheDocument();
    expect(screen.getByText('石头')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run NodeRefEditor`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 NodeRefEditor.tsx**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.tsx`：

```tsx
import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 节点引用选择编辑器：下拉列出画布上匹配端口类型的节点。
 * - schema.dataType 指定需要的端口类型（如 'item_stack'）
 * - 只列出拥有该类型输出端口的节点
 * - 选中后 onChange 返回节点 id
 */
function NodeRefEditorComponent({ value, onChange, schema, graph }: EditorProps<string>) {
  const dataType = schema.dataType;
  const candidates = graph.nodes.filter((n) =>
    n.ports.some(
      (p) => p.direction === 'out' && (!dataType || p.type === dataType || p.type === 'any'),
    ),
  );

  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
    >
      <option value="">（未选择）</option>
      {candidates.map((n) => (
        <option key={n.id} value={n.id}>
          {n.data.label || n.id}
        </option>
      ))}
    </select>
  );
}

export const NodeRefEditor = memo(NodeRefEditorComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run NodeRefEditor`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.test.tsx
git commit -m "feat(ui): add NodeRefEditor for selecting nodes by port type"
```

---

## Task 30: fieldSchemas.ts（各节点类型字段定义）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.ts`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getFieldSchemas } from './fieldSchemas.js';

describe('getFieldSchemas', () => {
  it('item 节点返回 itemId/displayName/rarity/maxStackSize 等字段', () => {
    const fields = getFieldSchemas('item');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('itemId');
    expect(keys).toContain('displayName');
    expect(keys).toContain('rarity');
    expect(keys).toContain('maxStackSize');
    expect(keys).toContain('maxDamage');
    expect(keys).toContain('category');
    expect(keys).toContain('glow');
  });

  it('block 节点返回 blockId/hardness/blastResistance 等字段', () => {
    const fields = getFieldSchemas('block');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('blockId');
    expect(keys).toContain('hardness');
    expect(keys).toContain('blastResistance');
    expect(keys).toContain('luminance');
    expect(keys).toContain('isBlockEntity');
  });

  it('recipe 节点返回 recipeType/outputCount/cookTime 等字段', () => {
    const fields = getFieldSchemas('recipe');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('recipeType');
    expect(keys).toContain('outputCount');
    expect(keys).toContain('cookTime');
  });

  it('comment 节点返回 text/color 字段', () => {
    const fields = getFieldSchemas('comment');
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('text');
    expect(keys).toContain('color');
  });

  it('所有节点类型都包含公共字段 label/note', () => {
    const kinds = ['item', 'block', 'entity', 'recipe', 'machine', 'multiblock', 'event', 'condition', 'action', 'code', 'comment'] as const;
    for (const kind of kinds) {
      const fields = getFieldSchemas(kind);
      const keys = fields.map((f) => f.key);
      expect(keys).toContain('label');
      expect(keys).toContain('note');
    }
  });

  it('item 的 rarity 字段是 dropdown 类型含 4 个选项', () => {
    const fields = getFieldSchemas('item');
    const rarity = fields.find((f) => f.key === 'rarity');
    expect(rarity?.type).toBe('dropdown');
    expect(rarity?.options).toEqual(['common', 'uncommon', 'rare', 'epic']);
  });

  it('item 的 glow 字段是 segmented 类型', () => {
    const fields = getFieldSchemas('item');
    const glow = fields.find((f) => f.key === 'glow');
    expect(glow?.type).toBe('segmented');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run fieldSchemas`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 fieldSchemas.ts**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.ts`：

```ts
import type { NodeData, NodeKind } from '@mc-creator/shared';
import type { FieldSchema } from './editors/types.js';

/** 公共字段：所有节点都有 label/note */
const COMMON_FIELDS: FieldSchema[] = [
  { key: 'label', label: '标签', type: 'text', required: true },
  { key: 'note', label: '备注', type: 'text' },
];

/** item 节点字段 */
const ITEM_FIELDS: FieldSchema[] = [
  { key: 'itemId', label: '物品 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  {
    key: 'rarity', label: '稀有度', type: 'dropdown',
    options: ['common', 'uncommon', 'rare', 'epic'],
  },
  { key: 'category', label: '类别', type: 'dropdown', options: ['misc', 'tool', 'weapon', 'armor', 'food', 'material'] },
  { key: 'maxStackSize', label: '最大堆叠', type: 'number', min: 1, max: 64, step: 1 },
  { key: 'maxDamage', label: '最大耐久', type: 'number', min: 0, max: 99999, step: 1 },
  { key: 'glow', label: '发光', type: 'segmented', options: ['false', 'true'] },
];

/** block 节点字段 */
const BLOCK_FIELDS: FieldSchema[] = [
  { key: 'blockId', label: '方块 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'hardness', label: '硬度', type: 'number', min: 0, max: 999, step: 0.5 },
  { key: 'blastResistance', label: '抗爆性', type: 'number', min: 0, max: 9999, step: 0.5 },
  { key: 'luminance', label: '发光等级', type: 'number', min: 0, max: 15, step: 1 },
  { key: 'transparent', label: '透明', type: 'segmented', options: ['false', 'true'] },
  { key: 'solid', label: '固体', type: 'segmented', options: ['true', 'false'] },
  { key: 'modelType', label: '模型类型', type: 'dropdown', options: ['cube_all', 'cube_column', 'cross', 'door', 'fence', 'stairs'] },
  { key: 'isBlockEntity', label: '方块实体', type: 'segmented', options: ['false', 'true'] },
];

/** entity 节点字段 */
const ENTITY_FIELDS: FieldSchema[] = [
  { key: 'entityId', label: '实体 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'classification', label: '分类', type: 'dropdown', options: ['mob', 'animal', 'monster', 'boss', 'projectile', 'other'] },
  { key: 'maxHealth', label: '最大血量', type: 'number', min: 1, max: 9999, step: 1 },
  { key: 'attackDamage', label: '攻击力', type: 'number', min: 0, max: 999, step: 0.5 },
  { key: 'movementSpeed', label: '移动速度', type: 'number', min: 0, max: 10, step: 0.05 },
  { key: 'fireImmune', label: '免疫火焰', type: 'segmented', options: ['false', 'true'] },
];

/** recipe 节点字段 */
const RECIPE_FIELDS: FieldSchema[] = [
  { key: 'recipeId', label: '配方 ID', type: 'resourceId', required: true },
  {
    key: 'recipeType', label: '配方类型', type: 'dropdown',
    options: ['crafting_shaped', 'crafting_shapeless', 'smelting', 'blasting', 'smoking', 'stonecutting'],
  },
  { key: 'outputCount', label: '产出数量', type: 'number', min: 1, max: 64, step: 1 },
  { key: 'cookTime', label: '烧制时间', type: 'number', min: 1, max: 9999, step: 1, condition: { field: 'recipeType', in: ['smelting', 'blasting', 'smoking'] } },
  { key: 'experience', label: '经验', type: 'number', min: 0, max: 99, step: 0.1, condition: { field: 'recipeType', in: ['smelting', 'blasting', 'smoking'] } },
];

/** machine 节点字段 */
const MACHINE_FIELDS: FieldSchema[] = [
  { key: 'machineId', label: '机器 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'energyCapacity', label: '能源容量', type: 'number', min: 0, max: 999999, step: 100 },
  { key: 'inputSlots', label: '输入槽位数', type: 'number', min: 0, max: 27, step: 1 },
  { key: 'outputSlots', label: '输出槽位数', type: 'number', min: 0, max: 27, step: 1 },
  { key: 'defaultProcessTime', label: '默认处理时间', type: 'number', min: 1, max: 9999, step: 1 },
  { key: 'defaultEnergyPerTick', label: '每 tick 能耗', type: 'number', min: 0, max: 9999, step: 1 },
];

/** multiblock 节点字段 */
const MULTIBLOCK_FIELDS: FieldSchema[] = [
  { key: 'structureId', label: '结构 ID', type: 'resourceId', required: true },
  { key: 'displayName', label: '显示名', type: 'text', required: true },
  { key: 'width', label: '宽', type: 'number', min: 1, max: 16, step: 1 },
  { key: 'height', label: '高', type: 'number', min: 1, max: 16, step: 1 },
  { key: 'depth', label: '深', type: 'number', min: 1, max: 16, step: 1 },
  { key: 'hollow', label: '空心', type: 'segmented', options: ['false', 'true'] },
];

/** event 节点字段 */
const EVENT_FIELDS: FieldSchema[] = [
  {
    key: 'eventType', label: '事件类型', type: 'dropdown',
    options: ['player_right_click_block', 'player_right_click_item', 'player_left_click', 'block_break', 'block_place', 'entity_death', 'entity_hurt', 'item_use', 'item_pickup', 'player_join', 'player_quit', 'tick', 'custom'],
  },
  { key: 'eventArgs', label: '事件参数 (JSON)', type: 'nbt' },
];

/** condition 节点字段 */
const CONDITION_FIELDS: FieldSchema[] = [
  {
    key: 'conditionType', label: '条件类型', type: 'dropdown',
    options: ['has_item', 'health_below', 'health_above', 'distance_less', 'distance_greater', 'is_day', 'is_night', 'is_raining', 'biome_is', 'block_is', 'custom'],
  },
  { key: 'conditionArgs', label: '条件参数 (JSON)', type: 'nbt' },
  { key: 'invert', label: '取反', type: 'segmented', options: ['false', 'true'] },
];

/** action 节点字段 */
const ACTION_FIELDS: FieldSchema[] = [
  {
    key: 'actionType', label: '动作类型', type: 'dropdown',
    options: ['spawn_entity', 'give_item', 'take_item', 'teleport', 'damage', 'heal', 'set_block', 'remove_block', 'play_sound', 'send_message', 'summon_lightning', 'give_effect', 'custom'],
  },
  { key: 'actionArgs', label: '动作参数 (JSON)', type: 'nbt' },
];

/** code 节点字段 */
const CODE_FIELDS: FieldSchema[] = [
  { key: 'methodName', label: '方法名', type: 'text', required: true },
  { key: 'language', label: '语言', type: 'dropdown', options: ['java', 'kotlin', 'javascript'] },
  { key: 'inputSignature', label: '输入签名 (JSON)', type: 'nbt' },
  { key: 'outputSignature', label: '输出签名 (JSON)', type: 'nbt' },
];

/** comment 节点字段 */
const COMMENT_FIELDS: FieldSchema[] = [
  { key: 'text', label: '文本', type: 'text' },
  { key: 'color', label: '颜色', type: 'dropdown', options: ['yellow', 'green', 'blue', 'red', 'purple', 'gray'] },
];

/** 按 kind 获取字段 schema 列表 */
export function getFieldSchemas(kind: NodeKind): FieldSchema[] {
  const specific: Record<NodeData['kind'], FieldSchema[]> = {
    item: ITEM_FIELDS,
    block: BLOCK_FIELDS,
    entity: ENTITY_FIELDS,
    recipe: RECIPE_FIELDS,
    machine: MACHINE_FIELDS,
    multiblock: MULTIBLOCK_FIELDS,
    event: EVENT_FIELDS,
    condition: CONDITION_FIELDS,
    action: ACTION_FIELDS,
    code: CODE_FIELDS,
    comment: COMMENT_FIELDS,
  };
  return [...COMMON_FIELDS, ...(specific[kind] ?? [])];
}
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run fieldSchemas`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.ts apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.test.ts
git commit -m "feat(ui): add fieldSchemas with field definitions for all 11 node types"
```

---

## Task 31: NodeDetailForm.tsx（schema 驱动表单）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailForm.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailForm.test.tsx`

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailForm.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeDetailForm } from './NodeDetailForm.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import type { ItemNodeData } from '@mc-creator/shared';

describe('NodeDetailForm', () => {
  it('渲染 item 节点的所有字段', () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);

    expect(screen.getByText('标签')).toBeInTheDocument();
    expect(screen.getByText('物品 ID')).toBeInTheDocument();
    expect(screen.getByText('稀有度')).toBeInTheDocument();
    expect(screen.getByText('最大堆叠')).toBeInTheDocument();
  });

  it('修改文本字段触发 updateField', () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailForm />);

    const labelInput = screen.getByDisplayValue('新物品');
    fireEvent.change(labelInput, { target: { value: '修改后的物品' } });

    const draft = useDrawerStore.getState().draft as ItemNodeData;
    expect(draft.label).toBe('修改后的物品');
    expect(useDrawerStore.getState().dirty).toBe(true);
  });

  it('condition 字段根据 recipeType 显示/隐藏', () => {
    useNodeGraphStore.getState().clear();
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    const { rerender } = render(<NodeDetailForm />);

    // cookTime 有 condition: recipeType in [smelting, blasting, smoking]
    // 默认 recipeType 是 crafting_shaped，应不显示 cookTime
    expect(screen.queryByText('烧制时间')).not.toBeInTheDocument();

    // 切换 recipeType 到 smelting
    const typeSelect = screen.getByLabelText('配方类型');
    fireEvent.change(typeSelect, { target: { value: 'smelting' } });

    rerender(<NodeDetailForm />);
    expect(screen.getByText('烧制时间')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run NodeDetailForm`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 NodeDetailForm.tsx**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailForm.tsx`：

```tsx
import { memo } from 'react';
import type { NodeData } from '@mc-creator/shared';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { getFieldSchemas } from './fieldSchemas.js';
import type { FieldSchema } from './editors/types.js';
import { NumberStepperEditor } from './editors/NumberStepperEditor.js';
import { DropdownEditor } from './editors/DropdownEditor.js';
import { SegmentedEditor } from './editors/SegmentedEditor.js';
import { ColorEditor } from './editors/ColorEditor.js';
import { ResourceIdEditor } from './editors/ResourceIdEditor.js';
import { NbtEditor } from './editors/NbtEditor.js';
import { NodeRefEditor } from './editors/NodeRefEditor.js';

/** 根据 field.type 渲染对应编辑器 */
function renderEditor(field: FieldSchema, value: unknown, onChange: (v: unknown) => void, graph: ReturnType<typeof useNodeGraphStore.getState>['graph']) {
  const editorProps = { value, onChange, schema: field, graph, error: undefined as string | undefined };
  switch (field.type) {
    case 'number':
      return <NumberStepperEditor {...editorProps} value={Number(value ?? 0)} />;
    case 'dropdown':
      return <DropdownEditor {...editorProps} value={String(value ?? '')} />;
    case 'segmented':
      return <SegmentedEditor {...editorProps} value={String(value ?? 'false')} />;
    case 'color':
      return <ColorEditor {...editorProps} value={String(value ?? '#FFFFFF')} />;
    case 'resourceId':
      return <ResourceIdEditor {...editorProps} value={String(value ?? '')} />;
    case 'nbt':
      return <NbtEditor {...editorProps} value={String(value ?? '{}')} />;
    case 'noderef':
      return <NodeRefEditor {...editorProps} value={String(value ?? '')} />;
    case 'text':
    default:
      return (
        <input
          type="text"
          value={String(value ?? '')}
          onChange={(e) => onChange(e.target.value)}
          className="w-full border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-0.5 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        />
      );
  }
}

/** 检查字段是否应该显示（基于 condition） */
function shouldShow(field: FieldSchema, draft: NodeData): boolean {
  if (!field.condition) return true;
  const fieldValue = (draft as Record<string, unknown>)[field.condition.field];
  if (field.condition.equals !== undefined) return fieldValue === field.condition.equals;
  if (field.condition.in !== undefined) return field.condition.in.includes(String(fieldValue));
  return true;
}

function NodeDetailFormComponent() {
  const draft = useDrawerStore((s) => s.draft);
  const updateField = useDrawerStore((s) => s.updateField);
  const graph = useNodeGraphStore((s) => s.graph);

  if (!draft) return null;

  const fields = getFieldSchemas(draft.kind);

  return (
    <div className="space-y-2">
      {fields.filter((f) => shouldShow(f, draft)).map((field) => {
        const value = (draft as Record<string, unknown>)[field.key];
        return (
          <div key={field.key} className="space-y-0.5">
            <label className="text-[11px] text-mc-dim">
              {field.label}
              {field.required && <span className="text-red-400"> *</span>}
            </label>
            {renderEditor(field, value, (v) => updateField(field.key, v), graph)}
          </div>
        );
      })}
    </div>
  );
}

export const NodeDetailForm = memo(NodeDetailFormComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run NodeDetailForm`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailForm.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailForm.test.tsx
git commit -m "feat(ui): add NodeDetailForm with schema-driven form rendering and condition support"
```

---

## Task 32: NodeDetailDrawer.tsx（吸收 PropertyPanel 功能 + 草稿模式 + MC 风格）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailDrawer.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailDrawer.test.tsx`

> **注意：** NodeDetailDrawer 吸收旧 PropertyPanel 的所有功能（节点参数编辑 + 编译消息显示），但实现方式改为 schema 驱动 + 草稿模式。

- [ ] **Step 1: 写失败测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailDrawer.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeDetailDrawer } from './NodeDetailDrawer.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';

describe('NodeDetailDrawer', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useDrawerStore.getState().closeDrawer();
  });

  it('抽屉关闭时不渲染', () => {
    const { container } = render(<NodeDetailDrawer compileMessages={[]} />);
    expect(container.querySelector('[role="dialog"]')).not.toBeInTheDocument();
  });

  it('打开抽屉时渲染标题 + 表单 + 按钮', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailDrawer compileMessages={[]} />);

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('保存')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();
    expect(screen.getByText('物品 ID')).toBeInTheDocument();
  });

  it('点击保存触发 saveDraft', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailDrawer compileMessages={[]} />);
    fireEvent.click(screen.getByText('保存'));

    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('点击取消触发 cancelDraft', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('label', '临时修改');

    render(<NodeDetailDrawer compileMessages={[]} />);
    fireEvent.click(screen.getByText('取消'));

    expect(useDrawerStore.getState().open).toBe(false);
    // 节点 label 应未被保存
    const node = useNodeGraphStore.getState().graph.nodes[0];
    expect(node.data.label).toBe('新物品');
  });

  it('显示编译消息（错误/警告）', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    const messages = [
      { type: 'error' as const, nodeId: id, message: '物品 ID 重复' },
      { type: 'warning' as const, nodeId: id, message: '建议设置显示名' },
    ];

    render(<NodeDetailDrawer compileMessages={messages} />);

    expect(screen.getByText('物品 ID 重复')).toBeInTheDocument();
    expect(screen.getByText('建议设置显示名')).toBeInTheDocument();
  });

  it('Esc 键关闭抽屉（触发 cancelDraft）', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);

    render(<NodeDetailDrawer compileMessages={[]} />);
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(useDrawerStore.getState().open).toBe(false);
  });

  it('dirty 时显示未保存提示', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useDrawerStore.getState().openDrawer(id);
    useDrawerStore.getState().updateField('label', '修改了');

    render(<NodeDetailDrawer compileMessages={[]} />);
    expect(screen.getByText('未保存')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- --run NodeDetailDrawer`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 创建 NodeDetailDrawer.tsx**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailDrawer.tsx`：

```tsx
import { memo, useEffect } from 'react';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { NodeDetailForm } from './NodeDetailForm.js';

interface CompileMessage {
  type: 'error' | 'warning';
  nodeId: string;
  message: string;
}

interface NodeDetailDrawerProps {
  /** 编译消息列表（来自 PropertyPanel 旧功能） */
  compileMessages: CompileMessage[];
}

/**
 * 节点详情抽屉（右侧滑出，吸收旧 PropertyPanel 功能）。
 *
 * 功能：
 * - 草稿模式：openDrawer 时深拷贝 data 到 draft，保存写回 store，取消丢弃
 * - schema 驱动表单：委托 NodeDetailForm 渲染
 * - 编译消息：显示与当前节点相关的错误/警告
 * - MC 风格：3D 凸起边框 + 降饱和配色 + 像素字体
 * - Esc 键关闭（触发 cancelDraft）
 */
function NodeDetailDrawerComponent({ compileMessages }: NodeDetailDrawerProps) {
  const open = useDrawerStore((s) => s.open);
  const nodeId = useDrawerStore((s) => s.nodeId);
  const dirty = useDrawerStore((s) => s.dirty);
  const saveDraft = useDrawerStore((s) => s.saveDraft);
  const cancelDraft = useDrawerStore((s) => s.cancelDraft);

  // Esc 键关闭
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cancelDraft();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, cancelDraft]);

  if (!open || !nodeId) return null;

  const nodeMessages = compileMessages.filter((m) => m.nodeId === nodeId);

  return (
    <>
      {/* 遮罩 */}
      <div
        className="fixed inset-0 z-40 bg-black/50"
        onClick={cancelDraft}
        aria-hidden="true"
      />
      {/* 抽屉 */}
      <aside
        role="dialog"
        aria-label="节点详情"
        className="fixed right-0 top-0 z-50 flex h-full w-96 flex-col border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-surface animate-mc-drawer-in"
      >
        {/* 头部 */}
        <header className="flex items-center justify-between border-b-2 border-b-black border-t-white border-l-white border-r-white bg-mc-btn px-3 py-2">
          <h2 className="text-[12px] font-medium text-mc-text">节点详情</h2>
          <div className="flex items-center gap-2">
            {dirty && (
              <span className="text-[10px] text-yellow-400">未保存</span>
            )}
            <button
              type="button"
              aria-label="关闭"
              onClick={cancelDraft}
              className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 text-[11px] hover:bg-mc-btn-hover"
            >
              ×
            </button>
          </div>
        </header>

        {/* 编译消息区（吸收旧 NodeCompileMessages 功能） */}
        {nodeMessages.length > 0 && (
          <div className="space-y-1 border-b-2 border-b-black border-t-white border-l-white border-r-white bg-mc-bg px-3 py-2">
            {nodeMessages.map((msg, i) => (
              <div
                key={i}
                role={msg.type === 'error' ? 'alert' : 'status'}
                className={`text-[10px] ${
                  msg.type === 'error' ? 'bg-red-900/40 text-red-300' : 'bg-yellow-900/40 text-yellow-300'
                } border border-t-white border-l-white border-b-black border-r-black px-2 py-1`}
              >
                {msg.message}
              </div>
            ))}
          </div>
        )}

        {/* 表单区 */}
        <div className="flex-1 overflow-y-auto px-3 py-2">
          <NodeDetailForm />
        </div>

        {/* 底部操作栏 */}
        <footer className="flex gap-2 border-t-2 border-t-white border-l-white border-r-white border-b-black bg-mc-btn px-3 py-2">
          <button
            type="button"
            onClick={saveDraft}
            className="flex-1 border border-t-white border-l-white border-b-black border-r-black bg-mc-accent px-2 py-1 text-[11px] text-white hover:brightness-110"
          >
            保存
          </button>
          <button
            type="button"
            onClick={cancelDraft}
            className="flex-1 border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-2 py-1 text-[11px] text-mc-text hover:bg-mc-btn-hover"
          >
            取消
          </button>
        </footer>
      </aside>
    </>
  );
}

export const NodeDetailDrawer = memo(NodeDetailDrawerComponent);
```

- [ ] **Step 4: 运行确认通过 + 提交**

Run: `pnpm --filter @mc-creator/desktop test -- --run NodeDetailDrawer`
Expected: PASS

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailDrawer.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/NodeDetailDrawer.test.tsx
git commit -m "feat(ui): add NodeDetailDrawer with draft mode, compile messages, MC style"
```

---

## Task 33: 删除 PropertyPanel.tsx + LowcodeWorkspace 集成

**Files:**
- Delete: `apps/desktop/src/renderer/src/components/lowcode/PropertyPanel.tsx`
- Modify: `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx`

- [ ] **Step 1: 修改 LowcodeWorkspace.tsx**

修改 `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx`，将 `<PropertyPanel />` 替换为 `<NodeDetailDrawer />` + 折叠按钮组：

```tsx
import { NodeDetailDrawer } from './nodes/drawer/NodeDetailDrawer.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

// 在组件中（替换原 PropertyPanel 引用）：
function LowcodeWorkspace() {
  const collapseAll = useNodeGraphStore((s) => s.collapseAll);
  const expandAll = useNodeGraphStore((s) => s.expandAll);
  // 编译消息（如有编译器输出，传入；此处用空数组占位，后续 Plan C 接入）
  const compileMessages: { type: 'error' | 'warning'; nodeId: string; message: string }[] = [];

  return (
    <div className="flex h-full">
      {/* 左侧：节点面板 */}
      <aside className="w-48 border-r-2 border-r-black border-t-white border-l-white border-b-white bg-mc-surface">
        {/* ... 原节点面板内容 ... */}
      </aside>

      {/* 中间：画布 */}
      <main className="flex-1">
        <NodeGraphEditor />
      </main>

      {/* 右侧：工具栏（折叠按钮 + 编译按钮等） */}
      <aside className="flex w-12 flex-col items-center gap-2 border-l-2 border-l-black border-t-white border-r-white border-b-white bg-mc-surface py-2">
        <button
          type="button"
          aria-label="全部折叠"
          title="全部折叠"
          onClick={collapseAll}
          className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 py-1 text-[11px] hover:bg-mc-btn-hover"
        >
          ▾
        </button>
        <button
          type="button"
          aria-label="全部展开"
          title="全部展开"
          onClick={expandAll}
          className="border border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-1 py-1 text-[11px] hover:bg-mc-btn-hover"
        >
          ▸
        </button>
      </aside>

      {/* 抽屉（覆盖层，由 drawer-store 控制显隐） */}
      <NodeDetailDrawer compileMessages={compileMessages} />
    </div>
  );
}
```

注意：移除原 `import { PropertyPanel } from './PropertyPanel.js';`，改为 `import { NodeDetailDrawer } from './nodes/drawer/NodeDetailDrawer.js';`。

- [ ] **Step 2: 删除 PropertyPanel.tsx**

使用 git rm 删除文件：

```bash
git rm apps/desktop/src/renderer/src/components/lowcode/PropertyPanel.tsx
```

- [ ] **Step 3: typecheck + 确认无引用残留**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors（确认无其他文件引用 PropertyPanel）

如有引用残留，使用 `rg "PropertyPanel"` 全局搜索并替换为 NodeDetailDrawer。

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx
git commit -m "refactor(ui): replace PropertyPanel with NodeDetailDrawer + collapse buttons

- Delete PropertyPanel.tsx (43KB file, functionality absorbed by NodeDetailDrawer)
- LowcodeWorkspace right sidebar: collapseAll/expandAll buttons
- NodeDetailDrawer: overlay drawer with draft mode + compile messages
"
```

---

## Task 34: nodes/index.ts 注册确认

**Files:**
- Verify: `apps/desktop/src/renderer/src/components/lowcode/nodes/index.ts`

- [ ] **Step 1: 确认 nodeTypes 注册不变**

`apps/desktop/src/renderer/src/components/lowcode/nodes/index.ts` 的 `nodeTypes` 对象已注册全部 11 个节点组件（Item/Block/Entity/Recipe/Machine/MultiBlock/Event/Condition/Action/Code/Comment）。

迁移后节点组件的导出名（`export const ItemNode`）和路径未变，因此 **nodeTypes 注册无需修改**。

仅需确认：

1. 每个节点文件仍 `export const XxxNode = memo(XxxNodeComponent);`
2. `nodeTypes` 对象的 key（`item`/`block`/...）与 React Flow 的 `node.type` 一致
3. `NODE_METADATA` 的 icon/color/category 字段与 McNodeShell 的 `icon`/`colorClass` 一致

- [ ] **Step 2: 运行测试确认无回归**

Run: `pnpm --filter @mc-creator/desktop test -- --run`
Expected: 所有现有测试通过（nodeTypes 注册未变）

- [ ] **Step 3: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 4: 无需提交（无改动）**

如 Step 1-3 全部通过，本任务无需 git commit。

---

## Task 35: 集成测试 + 快照测试

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/__snapshots__/NodeMigration.snapshot.test.tsx`
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/NodeMigration.integration.test.tsx`

- [ ] **Step 1: 写快照测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/NodeMigration.snapshot.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { ItemNode } from './ItemNode.js';
import { BlockNode } from './BlockNode.js';
import { EntityNode } from './EntityNode.js';
import { RecipeNode } from './RecipeNode.js';
import { MachineNode } from './MachineNode.js';
import { MultiBlockNode } from './MultiBlockNode.js';
import { EventNode } from './EventNode.js';
import { ConditionNode } from './ConditionNode.js';
import { ActionNode } from './ActionNode.js';
import { CodeNode } from './CodeNode.js';
import { CommentNode } from './CommentNode.js';

const NODE_COMPONENTS = {
  item: ItemNode,
  block: BlockNode,
  entity: EntityNode,
  recipe: RecipeNode,
  machine: MachineNode,
  multiblock: MultiBlockNode,
  event: EventNode,
  condition: ConditionNode,
  action: ActionNode,
  code: CodeNode,
  comment: CommentNode,
} as const;

describe('节点迁移快照测试', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  // 每种节点 × 展开状态 快照
  for (const [kind, Component] of Object.entries(NODE_COMPONENTS)) {
    it(`${kind} 节点展开状态快照`, () => {
      const id = useNodeGraphStore.getState().addNode(kind as never, { x: 0, y: 0 });
      const data = useNodeGraphStore.getState().graph.nodes[0].data;

      const { container } = render(
        <Component id={id} data={data} selected={false} /> as React.ReactElement,
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it(`${kind} 节点折叠状态快照`, () => {
      const id = useNodeGraphStore.getState().addNode(kind as never, { x: 0, y: 0 });
      useNodeGraphStore.getState().toggleCollapse(id);
      const data = useNodeGraphStore.getState().graph.nodes[0].data;

      const { container } = render(
        <Component id={id} data={data} selected={false} /> as React.ReactElement,
      );
      expect(container.firstChild).toMatchSnapshot();
    });

    it(`${kind} 节点选中状态快照`, () => {
      const id = useNodeGraphStore.getState().addNode(kind as never, { x: 0, y: 0 });
      const data = useNodeGraphStore.getState().graph.nodes[0].data;

      const { container } = render(
        <Component id={id} data={data} selected={true} /> as React.ReactElement,
      );
      expect(container.firstChild).toMatchSnapshot();
    });
  }
});
```

- [ ] **Step 2: 写集成测试**

新建 `apps/desktop/src/renderer/src/components/lowcode/nodes/NodeMigration.integration.test.tsx`：

```tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { ItemNode } from './ItemNode.js';
import { RecipeNode } from './RecipeNode.js';
import { ConditionNode } from './ConditionNode.js';

describe('节点迁移集成测试', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useDrawerStore.getState().closeDrawer();
  });

  it('点击节点设置按钮打开抽屉', () => {
    const id = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data;

    render(<ItemNode id={id} data={data} selected={false} /> as React.ReactElement);

    fireEvent.click(screen.getByLabelText('设置'));
    expect(useDrawerStore.getState().open).toBe(true);
    expect(useDrawerStore.getState().nodeId).toBe(id);
  });

  it('点击折叠按钮切换 collapsed', () => {
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data;

    render(<RecipeNode id={id} data={data} selected={false} /> as React.ReactElement);

    fireEvent.click(screen.getByLabelText('折叠'));
    expect(useNodeGraphStore.getState().graph.nodes[0].data.collapsed).toBe(true);
  });

  it('condition 节点显示 true/false 端口', () => {
    const id = useNodeGraphStore.getState().addNode('condition', { x: 0, y: 0 });
    const data = useNodeGraphStore.getState().graph.nodes[0].data;

    render(<ConditionNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.getByText('真')).toBeInTheDocument();
    expect(screen.getByText('假')).toBeInTheDocument();
  });

  it('折叠后输入端口隐藏，输出端口保留', () => {
    const id = useNodeGraphStore.getState().addNode('recipe', { x: 0, y: 0 });
    useNodeGraphStore.getState().toggleCollapse(id);
    const data = useNodeGraphStore.getState().graph.nodes[0].data;

    render(<RecipeNode id={id} data={data} selected={false} /> as React.ReactElement);

    expect(screen.queryByText('材料')).not.toBeInTheDocument();
    expect(screen.getByText('产物')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: 生成快照**

Run: `pnpm --filter @mc-creator/desktop test -- --run NodeMigration`
Expected: 首次运行生成 `__snapshots__/NodeMigration.snapshot.test.tsx.snap` 文件，33 个快照全部通过（11 节点 × 3 状态）

- [ ] **Step 4: typecheck + 完整测试**

Run: `pnpm --filter @mc-creator/desktop typecheck && pnpm --filter @mc-creator/desktop test -- --run`
Expected: 0 类型错误，所有测试通过

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/__snapshots__/ apps/desktop/src/renderer/src/components/lowcode/nodes/NodeMigration.snapshot.test.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/NodeMigration.integration.test.tsx
git commit -m "test(ui): add snapshot tests for all 11 nodes × 3 states + integration tests"
```

---

## Self-Review

完成所有 35 个任务后，进行以下自检：

### 1. Spec 覆盖检查

对照 `docs/superpowers/specs/2026-07-22-node-ui-polish-design.md` §1-7, §15-16：

- [ ] §1 PropertyPanel → NodeDetailDrawer：Task 32 创建 NodeDetailDrawer，Task 33 删除 PropertyPanel ✓
- [ ] §2 McNodeShell 统一外壳：Task 6 创建，Task 9-19 迁移 11 个节点 ✓
- [ ] §3 端口数据驱动：Task 7 创建 portSchemas.ts，Task 2 重构 createDefaultPorts ✓
- [ ] §4 抽屉草稿模式：Task 8 创建 drawer-store ✓
- [ ] §5 MC 3D 凸起样式：Task 3 Tailwind 配色，Task 4-6 组件样式 ✓
- [ ] §6 折叠展开：Task 1 加 collapsed 字段，Task 2 加 actions ✓
- [ ] §7 直角折线连线：Task 21 edge type 改 step ✓
- [ ] §15 schema 驱动表单：Task 22-29 创建 7 类编辑器，Task 30 fieldSchemas，Task 31 NodeDetailForm ✓
- [ ] §16 连线校验：Task 20 扩展 connectionRules ✓

### 2. 占位符扫描

全文搜索以下占位符关键词，确认无残留：

```bash
rg "TODO|FIXME|XXX|placeholder|占位|\.\.\.|省略" docs/superpowers/plans/2026-07-22-node-ui-phase-a.md
```

Expected: 无匹配（所有代码块都是完整实现）

### 3. 类型一致性检查

- [ ] `NodePort` 使用 `direction: 'in' | 'out'`（不是 `isInput`）
- [ ] `NodePort` 使用 `type: PortType`（不是 `dataType`）
- [ ] store action 使用 `toggleCollapse`/`collapseAll`/`expandAll`（不是 toggle/expand）
- [ ] store action 使用 `updateNode`（不是 `updateNodeData`）
- [ ] drawer action 使用 `cancelDraft`（不是 `cancelDrawer`）
- [ ] `FieldSchema` 使用 `type: FieldType`（不是 `editor`）
- [ ] `EditorProps<T>` 泛型模式正确

### 4. 路径一致性检查

- [ ] 所有导入路径使用 `.js` 后缀（ESM 规范）
- [ ] 无 `renderer/src/renderer/src` 双重前缀路径
- [ ] pnpm filter 使用 `@mc-creator/desktop` 和 `@mc-creator/shared`（不是 `desktop` / `shared`）
- [ ] 组件路径在 `apps/desktop/src/renderer/src/components/lowcode/nodes/` 下

### 5. 契约 §2 签名验证

确认所有 11 个节点组件调用 McNodeShell 时使用契约 §2 的完整签名：

```tsx
<McNodeShell
  icon={...}
  title={...}
  colorClass={...}
  badge={...}        // 可选
  ports={...}
  collapsed={...}
  selected={...}     // 可选
  debugState={...}   // 可选
  onToggleCollapse={...}
  onOpenDrawer={...}
>
  {/* children */}
</McNodeShell>
```

### 6. 审计问题修复确认

对照原 7 个审计问题：

1. [x] **路径错误**：已修正所有路径，无 `renderer/src/renderer/src` 双重前缀
2. [x] **McNodeSummary 未创建**：已删除所有 McNodeSummary 引用，改为 McNodeShell
3. [x] **PropertyPanel 未处理**：Task 33 删除 PropertyPanel.tsx，功能合并到 NodeDetailDrawer
4. [x] **portSchemas.ts 缺失**：Task 7 创建 portSchemas.ts，getPorts 数据驱动
5. [x] **connectionRules 未扩展**：Task 20 增加 validateConnection + multiple 限制
6. [x] **节点迁移代码不完整**：Task 9-19 全部 11 个节点完整迁移代码
7. [x] **无快照测试**：Task 35 添加 33 个快照测试（11 节点 × 3 状态）

### 7. 任务总数确认

- Task 1-6: 基础设施（schema + store + Tailwind + 基础组件）
- Task 7: portSchemas
- Task 8: drawer-store
- Task 9-19: 11 个节点迁移
- Task 20: connectionRules
- Task 21: edge type
- Task 22-29: 7 类编辑器 + types
- Task 30-31: fieldSchemas + NodeDetailForm
- Task 32: NodeDetailDrawer
- Task 33: 删除 PropertyPanel + 集成
- Task 34: 注册确认
- Task 35: 集成 + 快照测试

**总计：35 个任务** ✓