# 节点 UI 重构 · 共享契约

> 本文档定义三份 Plan（A/B/C）之间的共享接口、命名规范、架构决策。
> 所有 Plan 必须严格遵守本契约，确保跨 Plan 一致性。
> 以下是**最终决定**，不得在 Plan 中偏离。

---

## 1. 关键架构决策

### 1.1 PropertyPanel → NodeDetailDrawer（合并，不共存）

**决策：** 删除现有 `PropertyPanel.tsx`（43KB），其功能被 `NodeDetailDrawer.tsx` 吸收并增强。

- Plan A 创建 `NodeDetailDrawer.tsx`，包含 PropertyPanel 的全部现有功能（通用字段编辑、按节点类型渲染子表单、编译错误显示、删除/复制按钮）+ 新增草稿模式 + MC 风格
- Plan A 明确包含一个 Task：「删除 PropertyPanel.tsx，迁移其功能到 NodeDetailDrawer」
- `LowcodeWorkspace.tsx` 中 `<PropertyPanel />` 替换为 `<NodeDetailDrawer />`

### 1.2 模板系统（扩展现有，不新建）

**决策：** Plan B 扩展现有 `lib/nodeGraphTemplates.ts`，不新建 `templates/templateData.ts` / `TemplateCard.tsx` / `TemplateLibrary.tsx`。

- Plan B Task：向 `nodeGraphTemplates.ts` 追加更多预设模板（铁剑、钻石镐、金苹果等）
- Plan B Task：在现有 `NodePalette.tsx` 的模板区域增加搜索框 + 分类筛选下拉
- 现有 `NodeGraphTemplate` 类型、`TEMPLATE_CATEGORIES`、`NODE_GRAPH_TEMPLATES` 保持不变，只追加内容

### 1.3 portSchemas.ts（Plan A 创建）

**决策：** Plan A 新增一个 Task 创建 `nodes/portSchemas.ts`，把 `node-graph-store.ts:222-278` 的 `createDefaultPorts` 逻辑重构为数据驱动的 `getPorts(data: NodeData): NodePort[]`。

- `createDefaultPorts(kind)` 保留在 store 中（向后兼容），内部改为调用 `getPorts`
- 所有节点组件渲染端口时用 `node.ports`（已由 store 初始化），不运行时调 `getPorts`
- `getPorts(data)` 用于：动态端口场景（如 variable 节点的端口标签随 varName 变化、loop 节点的 loop_var 标签随 loopVarName 变化）

### 1.4 McNodeSummary（删除，用 children 替代）

**决策：** 从文件结构表删除 `McNodeSummary.tsx`。摘要内容通过 `McNodeShell` 的 `children` prop 传入。

---

## 2. McNodeShell 组件契约（最终签名）

```ts
interface McNodeShellProps {
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
  debugState?: 'breakpoint' | 'debugging' | null;
  /** 错误状态（编译错误/警告时头部变色） */
  errorState?: 'error' | 'warning' | null;
  /** 切换折叠回调 */
  onToggleCollapse: () => void;
  /** 打开抽屉回调（双击或点⚙） */
  onOpenDrawer: () => void;
  /** 摘要内容（展开时显示在头部下方） */
  children?: ReactNode;
}
```

**所有节点组件（原 11 种 + 新 4 种）必须使用此签名调用 McNodeShell。**

---

## 3. 节点组件模式（NodeProps 用法）

**正确模式（对齐现有 ItemNode.tsx）：**

```tsx
import type { NodeProps } from 'reactflow';
import type { VariableNodeData } from '@mc-creator/shared';

function VariableNodeComponent({ data, selected }: NodeProps<VariableNodeData>) {
  // data 直接就是 VariableNodeData，不需要 data.data
  const store = useNodeGraphStore();
  return (
    <McNodeShell
      icon="variable"
      title={data.label}
      colorClass="mc-variable"
      badge={data.isConstant ? 'const' : undefined}
      ports={/* 从 store 取 node.ports，或用 getPorts(data) */}
      collapsed={data.collapsed}
      selected={selected}
      onToggleCollapse={() => store.toggleCollapse(data.nodeId)}
      onOpenDrawer={() => useDrawerStore.getState().openDrawer(data.nodeId)}
    >
      <div className="text-[10px]">{data.varName} : {data.varType} = {String(data.value)}</div>
    </McNodeShell>
  );
}
```

**关键规则：**
- `NodeProps<T>` 的 T 是 **data 类型**（如 `VariableNodeData`），不是节点类型（`ModNode`）
- 直接解构 `data`，不要 `data.data`
- 测试渲染时直接传 `data` prop（不是 `node` prop）

---

## 4. Store Action 命名（最终）

### useNodeGraphStore（阶段 A/C 新增）

| Action | 签名 | Plan |
|--------|------|------|
| `toggleCollapse` | `(nodeId: string) => void` | A |
| `collapseAll` | `() => void` | A |
| `expandAll` | `() => void` | A |
| `encapsulateSubgraph` | `(nodeIds: string[], name: string) => string \| null` | C |
| `setEditingSubgraphId` | `(subgraphId: string \| null) => void` | C |
| `editingSubgraphId` | `string \| null`（state） | C |
| `addCustomNode` | `(typeId: string, position: {x,y}) => string` | C |

**已有 action 不改名：** `updateNode(nodeId, patch)`（不叫 updateNodeData）、`addNode`、`removeNode` 等。

### useDrawerStore（阶段 A 新增）

| Action/State | 签名 |
|--------------|------|
| `open` | `boolean` |
| `nodeId` | `string \| null` |
| `draft` | `NodeData \| null` |
| `dirty` | `boolean` |
| `errors` | `Record<string, string>` |
| `openDrawer` | `(nodeId: string) => void` |
| `closeDrawer` | `() => void` |
| `updateField` | `(key: string, value: unknown) => void` |
| `saveDraft` | `() => void` |
| `cancelDraft` | `() => void` |

**注意：** 用 `cancelDraft`（不叫 cancelDrawer），与 spec §15.1 一致。

---

## 5. 类型命名（最终，对齐代码库）

| 用途 | 类型名 | 字段 |
|------|--------|------|
| 端口定义 | `NodePort`（已有） | `id, label, type: PortType, direction: 'in'\|'out', required, multiple, defaultValue?` |
| 端口类型枚举 | `PortType`（已有） | 15 种 |
| 字段 schema | `FieldSchema`（Plan A 新建） | `key, label, type: FieldType, required?, min?, max?, step?, options?, dataType?, condition?` |
| 字段类型 | `FieldType` | `'text'\|'number'\|'dropdown'\|'noderef'\|'resourceId'\|'color'\|'nbt'\|'segmented'` |
| 编辑器 props | `EditorProps<T>` | `value: T, onChange, schema: FieldSchema, graph: NodeGraph, error?` |

**禁止使用：** `PortDef`、`PortDataType`、`kind: 'input'|'output'`（用 `direction: 'in'|'out'`）、`dataType` 字段名（用 `type`）。

---

## 6. 编译器契约

### ModSpec.customCode 类型

`customCode` 是 `CustomCodeSnippetSpec[]`（数组），不是字符串。

```ts
interface CustomCodeSnippetSpec {
  snippetId: string;
  language: string;
  code: string;
  inputSignature: string;
  outputSignature: string;
  methodName: string;
}
```

**variable/loop/custom 编译结果必须包装为 `CustomCodeSnippetSpec` 对象，push 到 `customCode` 数组，不能覆盖现有 code 节点的编译结果。**

### 编译器函数签名

```ts
// lib/compileVariable.ts
compileVariable(data: VariableNodeData): { snippet: CustomCodeSnippetSpec; varName: string }

// lib/compileLoop.ts
compileLoop(data: LoopNodeData, bodyCode: string): { snippet: CustomCodeSnippetSpec }

// lib/compileSubgraph.ts
inlineSubgraphNodes(graph: NodeGraph, manager: SubgraphManager): { graph: NodeGraph; warnings: string[] }
// 注意返回 { graph, warnings }，不是 NodeGraph & { warnings }

// lib/compileCustomNode.ts
compileCustomNode(data: SubgraphNodeData, fields: Record<string, unknown>): { snippet?: CustomCodeSnippetSpec; error?: string }
```

---

## 7. 子图/自定义节点契约

### subgraphManager（单例，不导出独立函数）

```ts
class SubgraphManager {
  register(sg: SubgraphDefinition): void
  get(id: string): SubgraphDefinition | undefined
  has(id: string): boolean
  list(): SubgraphDefinition[]
  remove(id: string): void
  clear(): void
  detectCycle(parentId: string, targetId: string): boolean
  serializeAll(): string
  deserializeAll(json: string): { ok: true } | { ok: false; error: string }
}
export const subgraphManager = new SubgraphManager();
```

**所有调用方用 `subgraphManager.get(id)`，不导出 `getSubgraph` 独立函数。**

### SubgraphDefinition / SubgraphPortMapping

```ts
interface SubgraphPortMapping {
  internalPortId: string;
  externalPortId: string;
  label: string;
  direction: 'in' | 'out';  // 不用 kind: 'input'|'output'
  type: PortType;            // 不用 dataType: PortDataType
}

interface SubgraphDefinition {
  id: string;
  name: string;
  nodes: ModNode[];
  edges: ModEdge[];
  portMappings: SubgraphPortMapping[];
}
```

### SubgraphNodeData

```ts
interface SubgraphNodeData extends BaseNodeData {
  kind: 'subgraph';
  subgraphId: string;        // 引用的子图 ID（自定义节点为空）
  subgraphName: string;      // 显示名缓存
  customTypeId: string | null; // 自定义节点类型 ID（普通子图为 null）
}
```

**portMappings 在 SubgraphDefinition 内（子图定义级别），不在 SubgraphNodeData 内。**

### customNodeRegistry（单例）

```ts
class CustomNodeRegistry {
  register(schema: CustomNodeSchema): void
  get(typeId: string): CustomNodeSchema | undefined
  has(typeId: string): boolean
  list(): CustomNodeSchema[]
  importJSON(json: string): { ok: true } | { ok: false; error: string }
  export(typeId: string): string
  exportAll(): string
  clear(): void
}
export const customNodeRegistry = new CustomNodeRegistry();
```

---

## 8. 外部 mod API 契约

### externalModList（不用 ipcClient.invoke）

```ts
// components/lowcode/custom/externalModList.ts
export interface ExternalMod { namespace: string; name: string; version: string; installed: boolean; }

// 通过 window.mcApi 读取（若可用），否则用 mock 列表
export async function listExternalMods(): Promise<ExternalMod[]>
export async function getModItems(namespace: string): Promise<string[]>
```

**不使用 `ipcClient.invoke('mod:listInstalled')`。** 改为 try `window.mcApi?.listInstalledMods?.()` 否则 mock。

### import 路径

Plan C Task 25 CodeNode import 增强用 `PRESET_IMPORTS` 常量映射，不动态调 IPC。

---

## 9. 命令与路径规范

### pnpm filter 名

- 桌面端：`pnpm --filter @mc-creator/desktop test` / `typecheck`
- 共享包：`pnpm --filter @mc-creator/shared test` / `typecheck`

### import 路径风格

统一用 `.js` 后缀（如 `import { McNodeShell } from './base/McNodeShell.js'`），与 ESM 规范一致。

### 文件路径

所有 Plan 中的文件路径用**绝对路径**（从 `apps/desktop/...` 或 `packages/shared/...` 开始），不用相对路径。

### 正确的文件路径前缀

- 渲染端组件：`apps/desktop/src/renderer/src/components/lowcode/...`
- 渲染端 store：`apps/desktop/src/renderer/src/store/...`
- 渲染端 lib：`apps/desktop/src/renderer/src/lib/...`
- 共享 schema：`packages/shared/src/schemas/...`

**不要多写 `renderer/src`（如 `apps/desktop/src/renderer/src/renderer/src/...` 是错误的）。**

---

## 10. 文件归属（哪个 Plan 创建什么）

### Plan A 创建

| 文件 | 职责 |
|------|------|
| `nodes/base/portColors.ts` | MC 降饱和配色 + Tailwind class 映射 |
| `nodes/base/McNodePort.tsx` | 端口组件（Handle + 标签 + MC 凹陷样式） |
| `nodes/base/McNodeHeader.tsx` | 头部组件（3D 凸起 + 色条 + 图标 + 标题 + 徽章 + 折叠/设置按钮 + 调试/错误标记） |
| `nodes/base/McNodeShell.tsx` | 统一节点壳（header + children + ports + collapsed 适配 + 调试高亮） |
| `nodes/portSchemas.ts` | `getPorts(data: NodeData): NodePort[]` 数据驱动端口 |
| `nodes/drawer/editors/types.ts` | FieldSchema + EditorProps + FieldType |
| `nodes/drawer/editors/NumberStepperEditor.tsx` | |
| `nodes/drawer/editors/DropdownEditor.tsx` | |
| `nodes/drawer/editors/SegmentedEditor.tsx` | |
| `nodes/drawer/editors/ColorEditor.tsx` | |
| `nodes/drawer/editors/ResourceIdEditor.tsx` | |
| `nodes/drawer/editors/NbtEditor.tsx` | |
| `nodes/drawer/editors/NodeRefEditor.tsx` | |
| `nodes/drawer/fieldSchemas.ts` | 各节点类型的字段定义 |
| `nodes/drawer/NodeDetailForm.tsx` | schema 驱动表单 |
| `nodes/drawer/NodeDetailDrawer.tsx` | 右侧抽屉（吸收 PropertyPanel 功能 + 草稿模式 + MC 风格） |
| `store/drawer-store.ts` | useDrawerStore |

### Plan A 修改

| 文件 | 改动 |
|------|------|
| `packages/shared/src/schemas/node-graph-spec.ts` | BaseNodeData 加 collapsed |
| `store/node-graph-store.ts` | toggleCollapse/collapseAll/expandAll + createDefaultPorts 调 getPorts |
| `components/lowcode/NodeGraphEditor.tsx` | edge type 改 step + 连线颜色 |
| `components/lowcode/LowcodeWorkspace.tsx` | PropertyPanel 替换为 NodeDetailDrawer + 折叠按钮 |
| `components/lowcode/nodes/*.tsx`（11 个） | 迁移到 McNodeShell |
| `components/lowcode/nodes/index.ts` | nodeTypes 注册 |
| `components/lowcode/connectionRules.ts` | multiple 限制 + 校验失败信息 |
| `tailwind.config.ts` | MC 降饱和配色注册 |

### Plan A 删除

| 文件 | 原因 |
|------|------|
| `components/lowcode/PropertyPanel.tsx` | 功能合并到 NodeDetailDrawer |

### Plan B 创建

| 文件 | 职责 |
|------|------|
| `nodes/drawer/fieldTooltips.ts` | 字段 MC 领域解释 |
| `nodes/drawer/FieldLabel.tsx` | 标签 + ? tooltip |
| `nodes/drawer/ErrorRecovery.tsx` | 错误恢复提示 |
| `onboarding/onboardingSteps.ts` | 引导步骤 |
| `onboarding/OnboardingTour.tsx` | 引导浮层 |

### Plan B 修改（不新建模板系统）

| 文件 | 改动 |
|------|------|
| `lib/nodeGraphTemplates.ts` | 追加更多预设模板 |
| `components/lowcode/NodePalette.tsx` | 模板区域加搜索 + 分类筛选 |
| `nodes/drawer/NodeDetailForm.tsx` | FieldLabel 包裹 + ErrorRecovery 接入 |
| `components/lowcode/LowcodeWorkspace.tsx` | OnboardingTour 集成 |

### Plan C 创建

| 文件 | 职责 |
|------|------|
| `nodes/VariableNode.tsx` | 变量节点 |
| `nodes/SubgraphNode.tsx` | 子图节点 |
| `nodes/LoopNode.tsx` | 循环节点 |
| `nodes/CustomNode.tsx` | 自定义节点 |
| `subgraph/subgraphManager.ts` | 子图注册表 |
| `subgraph/SubgraphBoundaryNode.tsx` | 边界节点 |
| `subgraph/SubgraphEditor.tsx` | 子图画布 |
| `subgraph/SubgraphWorkspace.tsx` | 子图编辑容器 |
| `custom/customNodeRegistry.ts` | 自定义节点注册表 |
| `custom/mustacheRender.ts` | Mustache 渲染 |
| `custom/CustomNodeImporter.tsx` | 导入对话框 |
| `custom/externalModList.ts` | 外部 mod 列表 |
| `lib/compileVariable.ts` | 变量编译 |
| `lib/compileSubgraph.ts` | 子图内联展开 |
| `lib/compileLoop.ts` | 循环编译 |
| `lib/compileCustomNode.ts` | 自定义节点编译 |
| `packages/shared/src/schemas/custom-node-schema.ts` | CustomNodeSchema |

### Plan C 修改

| 文件 | 改动 |
|------|------|
| `packages/shared/src/schemas/node-graph-spec.ts` | 新增 3 种 NodeKind + 3 种 NodeData + SubgraphDefinition + NodeGraph.subgraphs |
| `packages/shared/src/schemas/index.ts` | 导出 custom-node-schema |
| `store/node-graph-store.ts` | createDefaultNodeData/Ports 新增 3 分支 + encapsulateSubgraph + addCustomNode |
| `nodes/portSchemas.ts` | variable/subgraph/loop 端口 |
| `nodes/drawer/fieldSchemas.ts` | variable/subgraph/loop 字段 |
| `nodes/drawer/editors/ResourceIdEditor.tsx` | 外部 mod 命名空间 |
| `nodes/drawer/editors/NodeRefEditor.tsx` | 变量引用 |
| `components/lowcode/CodeNodeEditor.tsx` | import 快捷插入 |
| `nodes/index.ts` | 注册 4 种新节点 |
| `components/lowcode/NodePalette.tsx` | 高级分类 + 自定义节点导入 |
| `components/lowcode/NodeGraphEditor.tsx` | 右键封装子图 |
| `components/lowcode/LowcodeWorkspace.tsx` | SubgraphWorkspace 集成 |
| `lib/compileNodeGraph.ts` | 接入 4 编译器 + 依赖检测 |

---

## 11. Spec 更新要求

重写 Plan 时，若发现 Plan 与 Spec 不一致，**以本契约为准**，Plan 中注明「Spec §X.Y 待更新」。Spec 文件的更新留到三份 Plan 重写完成后统一进行。

需要更新 Spec 的已知点：
- §2.3 `PortDef` → `NodePort`，`kind` → `direction`，`dataType` → `type`
- §5.2 fieldSchemas 对齐实际 ItemNodeData 字段
- §12.3 portMappings 移到 SubgraphDefinition，SubgraphPortMapping 字段名
- §13.2 LoopNodeData 字段可选性
- §15.1 `cancelDrawer` → `cancelDraft`
- §15.2 `updateNodeData` → `updateNode`
