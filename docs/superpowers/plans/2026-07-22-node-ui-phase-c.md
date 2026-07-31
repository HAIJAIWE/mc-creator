# 节点 UI 重构 · 阶段 C：上限改进 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 新增 4 种高级节点（变量 / 子图 / 循环 / 自定义）+ 外部 mod API 引用，让高手用户能封装复用逻辑、批量处理、定义自己的节点类型，并跨 mod 引用 API。

**Architecture:** 3 种新 NodeKind（variable/subgraph/loop）走与原 11 种相同的 McNodeShell + portSchemas + fieldSchemas 数据驱动通道；自定义节点（CustomNode）复用 `kind: 'subgraph'` 数据（加 `customTypeId` 字段），由 SubgraphNode 组件按 `customTypeId` 路由到 CustomNode 渲染——避免污染 NodeKind 枚举；子图用独立 `subgraphManager` 单例注册表 + 独立 `SubgraphEditor` 画布；自定义节点用 JSON `CustomNodeSchema` 驱动 + `customNodeRegistry` 单例，代码模板用轻量 Mustache 自实现（不引第三方库）；编译器按 `variable → subgraph inline → loop → custom` 顺序扩展，每步独立可测；外部 mod API 用 `externalModList` 适配层（`window.mcApi?.listInstalledMods?.()` 否则 mock），编辑时不阻塞，编译时才检测依赖。

**Tech Stack:** React + TypeScript + Zustand + Zod + React Flow + Tailwind CSS + Vitest + Testing Library（无新依赖，Mustache 自实现）

**Spec:** `docs/superpowers/specs/2026-07-22-node-ui-polish-design.md`（§12 子图节点、§13 循环节点、§14 变量节点、§15 自定义节点、§16 外部 mod API）

> Spec §12-16 与共享契约有不一致处（portMappings 位置、字段名 direction/type、cancelDraft 等），**以共享契约为准**，Spec 待三份 Plan 完成后统一更新。

**Depends on:** Plan A 完成（McNodeShell / McNodeHeader / McNodePort / portSchemas.ts / fieldSchemas.ts / 7 类 editors / NodeDetailForm / NodeDetailDrawer / useDrawerStore / 折叠 actions / BaseNodeData.collapsed 已就绪）

**关键设计决策（贯穿全 Plan）：**
1. **McNodeShell 签名**：严格用契约 §2 的 `McNodeShellProps`（icon, title, colorClass, badge?, ports, collapsed, selected?, debugState?, errorState?, onToggleCollapse, onOpenDrawer, children?）
2. **NodeProps<T>**：T 是 data 类型（如 `VariableNodeData`），直接解构 `data`，不做 `data.data`
3. **CustomNode 路由**：CustomNode 不新增 NodeKind；SubgraphNode 组件检查 `data.customTypeId`，非空时委托给 CustomNodeContent 渲染
4. **customCode 是数组**：variable/loop/custom 编译结果包装为 `CustomCodeSnippetSpec` 对象，push 到 `customCode` 数组
5. **单例不导出独立函数**：`subgraphManager` / `customNodeRegistry` 是单例，调用方用 `subgraphManager.get(id)` / `customNodeRegistry.get(typeId)`
6. **外部 mod API**：用 `window.mcApi?.listInstalledMods?.()` 否则 mock，不用 `ipcClient.invoke`
7. **路径规范**：绝对路径从 `apps/desktop/...` 或 `packages/shared/...` 开始；import 用 `.js` 后缀；不要多写 `renderer/src`

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `packages/shared/src/schemas/custom-node-schema.ts` | CustomNodeSchema（自定义节点类型定义） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/VariableNode.tsx` | 变量节点组件 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/SubgraphNode.tsx` | 子图节点组件（路由到 CustomNode） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/LoopNode.tsx` | 循环节点组件 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/CustomNode.tsx` | 自定义节点内容组件（由 SubgraphNode 委托） |
| `apps/desktop/src/renderer/src/components/lowcode/subgraph/subgraphManager.ts` | 子图注册表单例 |
| `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphBoundaryNode.tsx` | 子图输入/输出边界节点 |
| `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphEditor.tsx` | 子图独立画布 |
| `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphWorkspace.tsx` | 子图编辑模式容器 |
| `apps/desktop/src/renderer/src/components/lowcode/custom/customNodeRegistry.ts` | 自定义节点注册表单例 |
| `apps/desktop/src/renderer/src/components/lowcode/custom/mustacheRender.ts` | 轻量 Mustache 渲染 |
| `apps/desktop/src/renderer/src/components/lowcode/custom/CustomNodeImporter.tsx` | 自定义节点 JSON 导入对话框 |
| `apps/desktop/src/renderer/src/components/lowcode/custom/externalModList.ts` | 外部 mod 列表适配层 |
| `apps/desktop/src/renderer/src/lib/compileVariable.ts` | 变量编译 |
| `apps/desktop/src/renderer/src/lib/compileSubgraph.ts` | 子图内联展开 |
| `apps/desktop/src/renderer/src/lib/compileLoop.ts` | 循环编译 |
| `apps/desktop/src/renderer/src/lib/compileCustomNode.ts` | 自定义节点编译 |

### 修改文件

| 文件 | 改动 |
|------|------|
| `packages/shared/src/schemas/node-graph-spec.ts` | 新增 variable/subgraph/loop NodeKind + 3 种 NodeData + SubgraphDefinition + SubgraphPortMapping + NodeGraph.subgraphs |
| `packages/shared/src/schemas/index.ts` | 导出 custom-node-schema |
| `apps/desktop/src/renderer/src/store/node-graph-store.ts` | createDefaultNodeData/Ports 新增 3 分支 + editingSubgraphId + encapsulateSubgraph + setEditingSubgraphId + addCustomNode |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.ts` | variable/subgraph/loop 端口（Plan A 创建，Plan C 修改） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.ts` | variable/subgraph/loop 字段（Plan A 创建，Plan C 修改） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.tsx` | 外部 mod 命名空间（Plan A 创建，Plan C 修改） |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.tsx` | 变量引用（Plan A 创建，Plan C 修改） |
| `apps/desktop/src/renderer/src/components/lowcode/CodeNodeEditor.tsx` | import 快捷插入 |
| `apps/desktop/src/renderer/src/components/lowcode/nodes/index.ts` | 注册 3 种新节点 + NODE_METADATA |
| `apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx` | 高级分类 + 自定义节点导入入口 |
| `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx` | 右键封装子图 |
| `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx` | SubgraphWorkspace 集成 |
| `apps/desktop/src/renderer/src/lib/compileNodeGraph.ts` | 接入 4 编译器 + 外部 mod 依赖检测 |

---

## Task 1: node-graph-spec.ts 新增 variable NodeKind + VariableNodeData

**Files:**
- Modify: `packages/shared/src/schemas/node-graph-spec.ts`（NodeKind 第 16-31 行，CommentNodeData 后追加 VariableNodeData）
- Test: `packages/shared/src/schemas/node-graph-spec.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `packages/shared/src/schemas/node-graph-spec.test.ts`：

```ts
import { NodeKind, VariableNodeData } from './node-graph-spec.js';

describe('NodeKind 扩展（阶段 C：variable）', () => {
  it('包含 variable', () => {
    expect(NodeKind.options).toContain('variable');
  });
});

describe('VariableNodeData', () => {
  it('常量 int 变量解析', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v1', label: '最大伤害', kind: 'variable',
      varName: 'MAX_DAMAGE', varType: 'int', value: 10, isConstant: true,
    });
    expect(v.varType).toBe('int');
    expect(v.isConstant).toBe(true);
    expect(v.value).toBe(10);
  });

  it('变量 string 解析', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v2', label: '玩家名', kind: 'variable',
      varName: 'playerName', varType: 'string', value: 'Steve', isConstant: false,
    });
    expect(v.isConstant).toBe(false);
  });

  it('varName 必须是合法标识符', () => {
    expect(() => VariableNodeData.parse({
      nodeId: 'v3', label: 'x', kind: 'variable',
      varName: '1invalid', varType: 'int', value: 0, isConstant: false,
    })).toThrow();
  });

  it('varType 必须在枚举内', () => {
    expect(() => VariableNodeData.parse({
      nodeId: 'v4', label: 'x', kind: 'variable',
      varName: 'x', varType: 'float', value: 0, isConstant: false,
    })).toThrow();
  });

  it('默认 isConstant=false', () => {
    const v = VariableNodeData.parse({
      nodeId: 'v5', label: 'x', kind: 'variable',
      varName: 'x', varType: 'int', value: 0,
    });
    expect(v.isConstant).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/shared test -- node-graph-spec`
Expected: FAIL — `variable` 不在 NodeKind 枚举，`VariableNodeData` 未导出

- [ ] **Step 3: 扩展 NodeKind + 实现 VariableNodeData**

修改 `packages/shared/src/schemas/node-graph-spec.ts` 第 16-31 行的 NodeKind：

```ts
export const NodeKind = z.enum([
  // 基础内容节点
  'item',
  'block',
  'entity',
  'recipe',
  'machine',
  'multiblock',
  // 逻辑节点
  'event',
  'condition',
  'action',
  // 高级节点
  'code',
  'comment',
  // 阶段 C 新增：上限提升节点
  'variable',
  'subgraph',
  'loop',
]);
export type NodeKind = z.infer<typeof NodeKind>;
```

在 `CommentNodeData`（第 340 行）之后、`NodeData` 联合类型（第 344 行）之前追加：

```ts
// === 阶段 C：变量节点 ===

export const VariableNodeData = BaseNodeData.extend({
  kind: z.literal('variable'),
  /** 变量名（Java 标识符） */
  varName: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
  /** 变量类型 */
  varType: z.enum(['int', 'double', 'string', 'boolean', 'item', 'block']),
  /** 值（类型按 varType，运行时校验） */
  value: z.unknown(),
  /** true=常量（static final），false=变量（实例字段） */
  isConstant: z.boolean().default(false),
});
export type VariableNodeData = z.infer<typeof VariableNodeData>;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/shared test -- node-graph-spec`
Expected: PASS（VariableNodeData 测试通过；subgraph/loop 测试此时未写不报错）

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/schemas/node-graph-spec.ts packages/shared/src/schemas/node-graph-spec.test.ts
git commit -m "feat(shared): add variable NodeKind + VariableNodeData schema"
```

---

## Task 2: node-graph-spec.ts 新增 subgraph NodeKind + SubgraphNodeData + SubgraphDefinition + SubgraphPortMapping

**Files:**
- Modify: `packages/shared/src/schemas/node-graph-spec.ts`
- Test: `packages/shared/src/schemas/node-graph-spec.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `node-graph-spec.test.ts`：

```ts
import { SubgraphDefinition, SubgraphNodeData, SubgraphPortMapping } from './node-graph-spec.js';

describe('NodeKind 扩展（阶段 C：subgraph）', () => {
  it('包含 subgraph', () => {
    expect(NodeKind.options).toContain('subgraph');
  });
});

describe('SubgraphPortMapping', () => {
  it('用 direction/type 字段（不是 kind/dataType）', () => {
    const m = SubgraphPortMapping.parse({
      internalPortId: 'in_1', externalPortId: 'input',
      label: '材料', direction: 'in', type: 'item_stack',
    });
    expect(m.direction).toBe('in');
    expect(m.type).toBe('item_stack');
  });

  it('direction 只接受 in/out', () => {
    expect(() => SubgraphPortMapping.parse({
      internalPortId: 'x', externalPortId: 'y', label: 'z', direction: 'input', type: 'item_stack',
    })).toThrow();
  });
});

describe('SubgraphDefinition', () => {
  it('最小子图解析（portMappings 默认空数组）', () => {
    const sg = SubgraphDefinition.parse({
      id: 'sg_1', name: '合成铁剑', nodes: [], edges: [],
    });
    expect(sg.name).toBe('合成铁剑');
    expect(sg.portMappings).toEqual([]);
  });

  it('portMappings 在 SubgraphDefinition 内', () => {
    const sg = SubgraphDefinition.parse({
      id: 'sg_1', name: 'x', nodes: [], edges: [],
      portMappings: [
        { internalPortId: 'in_1', externalPortId: 'input', label: '材料', direction: 'in', type: 'item_stack' },
        { internalPortId: 'out_1', externalPortId: 'output', label: '产物', direction: 'out', type: 'item_stack' },
      ],
    });
    expect(sg.portMappings).toHaveLength(2);
  });
});

describe('SubgraphNodeData', () => {
  it('引用子图解析', () => {
    const n = SubgraphNodeData.parse({
      nodeId: 'n1', label: '我的合成', kind: 'subgraph',
      subgraphId: 'sg_1', subgraphName: '合成铁剑', customTypeId: null,
    });
    expect(n.subgraphId).toBe('sg_1');
    expect(n.customTypeId).toBeNull();
  });

  it('customTypeId 非空时表示自定义节点', () => {
    const n = SubgraphNodeData.parse({
      nodeId: 'n2', label: '自定义合成台', kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: 'mymod:custom_crafter',
    });
    expect(n.customTypeId).toBe('mymod:custom_crafter');
  });

  it('默认 subgraphId/subgraphName 为空字符串，customTypeId 为 null', () => {
    const n = SubgraphNodeData.parse({
      nodeId: 'n3', label: 'x', kind: 'subgraph',
    });
    expect(n.subgraphId).toBe('');
    expect(n.subgraphName).toBe('');
    expect(n.customTypeId).toBeNull();
  });

  it('customFields 默认空对象，可存储自定义节点字段值', () => {
    const n = SubgraphNodeData.parse({
      nodeId: 'n4', label: 'x', kind: 'subgraph',
      customTypeId: 'mymod:crafter',
      customFields: { speed: 10, name: 'fast' },
    });
    expect(n.customFields).toEqual({ speed: 10, name: 'fast' });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/shared test -- node-graph-spec`
Expected: FAIL — `SubgraphDefinition` / `SubgraphNodeData` / `SubgraphPortMapping` 未导出

- [ ] **Step 3: 实现 SubgraphPortMapping + SubgraphDefinition + SubgraphNodeData**

在 `packages/shared/src/schemas/node-graph-spec.ts` 的 `VariableNodeData` 之后追加：

```ts
// === 阶段 C：子图 ===

/** 端口映射：子图内部边界节点端口 ↔ 子图节点对外端口 */
export const SubgraphPortMapping = z.object({
  internalPortId: z.string(),
  externalPortId: z.string(),
  label: z.string(),
  direction: z.enum(['in', 'out']),
  type: PortType,
});
export type SubgraphPortMapping = z.infer<typeof SubgraphPortMapping>;

/** 子图定义（存储在 NodeGraph.subgraphs） */
export const SubgraphDefinition = z.object({
  id: z.string(),
  name: z.string(),
  /** 子图内部节点（结构同主图节点，节点 id 在子图内唯一） */
  nodes: z.array(ModNode),
  /** 子图内部连线 */
  edges: z.array(ModEdge),
  /** 对外端口映射（在 SubgraphDefinition 内，不在 SubgraphNodeData 内） */
  portMappings: z.array(SubgraphPortMapping).default([]),
});
export type SubgraphDefinition = z.infer<typeof SubgraphDefinition>;

/**
 * 子图节点数据。
 * 也用于自定义节点：customTypeId 非空时为自定义节点，
 * 由 SubgraphNode 组件路由到 CustomNodeContent 渲染。
 */
export const SubgraphNodeData = BaseNodeData.extend({
  kind: z.literal('subgraph'),
  /** 引用的子图 ID（自定义节点为空字符串） */
  subgraphId: z.string().default(''),
  /** 子图显示名（缓存，避免每次查注册表） */
  subgraphName: z.string().default(''),
  /** 自定义节点类型 ID（如 'mymod:custom_crafter'），普通子图为 null */
  customTypeId: z.string().nullable().default(null),
  /**
   * 自定义节点字段值（仅 customTypeId 非空时使用）。
   * key 对应 CustomNodeSchema.fields[].key，value 为用户输入。
   * compileCustomNode 读取此字段渲染 codeTemplate。
   * 普通子图为空对象。
   */
  customFields: z.record(z.string(), z.unknown()).default({}),
});
export type SubgraphNodeData = z.infer<typeof SubgraphNodeData>;
```

> 注：`ModNode` 和 `ModEdge` 在本文件后面定义，Zod 支持 schema 前向引用（hoisting），无需调整顺序。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/shared test -- node-graph-spec`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/schemas/node-graph-spec.ts packages/shared/src/schemas/node-graph-spec.test.ts
git commit -m "feat(shared): add subgraph NodeKind + SubgraphDefinition + SubgraphNodeData"
```

---

## Task 3: node-graph-spec.ts 新增 loop NodeKind + LoopNodeData + NodeGraph.subgraphs

**Files:**
- Modify: `packages/shared/src/schemas/node-graph-spec.ts`（NodeData 联合类型 + NodeGraph）
- Test: `packages/shared/src/schemas/node-graph-spec.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `node-graph-spec.test.ts`：

```ts
import { LoopNodeData, NodeGraph } from './node-graph-spec.js';

describe('NodeKind 扩展（阶段 C：loop）', () => {
  it('包含 loop', () => {
    expect(NodeKind.options).toContain('loop');
  });
});

describe('LoopNodeData', () => {
  it('forEach 循环解析', () => {
    const l = LoopNodeData.parse({
      nodeId: 'l1', label: '遍历物品', kind: 'loop',
      loopType: 'forEach', condition: '', loopVarName: 'item', loopVarType: 'item',
      iterable: 'itemList',
    });
    expect(l.loopType).toBe('forEach');
    expect(l.iterable).toBe('itemList');
  });

  it('for 循环解析（init/condition/update）', () => {
    const l = LoopNodeData.parse({
      nodeId: 'l2', label: '计数循环', kind: 'loop',
      loopType: 'for', init: 'int i = 0', condition: 'i < 10', update: 'i++',
      loopVarName: 'i', loopVarType: 'int',
    });
    expect(l.init).toBe('int i = 0');
    expect(l.condition).toBe('i < 10');
  });

  it('while 循环解析', () => {
    const l = LoopNodeData.parse({
      nodeId: 'l3', label: 'while', kind: 'loop',
      loopType: 'while', condition: 'running',
      loopVarName: '', loopVarType: 'int',
    });
    expect(l.loopType).toBe('while');
  });

  it('init/update/iterable/bodySubgraphId 可选', () => {
    const l = LoopNodeData.parse({
      nodeId: 'l4', label: 'x', kind: 'loop',
      loopType: 'while', condition: 'true',
      loopVarName: '', loopVarType: 'int',
    });
    expect(l.init).toBeUndefined();
    expect(l.bodySubgraphId).toBeUndefined();
  });
});

describe('NodeGraph.subgraphs 字段', () => {
  it('默认空对象（向后兼容旧 JSON）', () => {
    const graph = NodeGraph.parse({
      version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [], edges: [],
    });
    expect(graph.subgraphs).toEqual({});
  });

  it('可解析 subgraphs 字段', () => {
    const graph = NodeGraph.parse({
      version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [], edges: [],
      subgraphs: { sg_1: { id: 'sg_1', name: '测试', nodes: [], edges: [], portMappings: [] } },
    });
    expect(Object.keys(graph.subgraphs)).toEqual(['sg_1']);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/shared test -- node-graph-spec`
Expected: FAIL — `LoopNodeData` 未导出，`graph.subgraphs` 为 undefined

- [ ] **Step 3: 实现 LoopNodeData + 扩展 NodeData 联合 + 扩展 NodeGraph**

在 `packages/shared/src/schemas/node-graph-spec.ts` 的 `SubgraphNodeData` 之后追加：

```ts
// === 阶段 C：循环节点 ===

export const LoopNodeData = BaseNodeData.extend({
  kind: z.literal('loop'),
  /** 循环类型 */
  loopType: z.enum(['for', 'forEach', 'while']),
  /** for 的初始化表达式（如 'int i = 0'） */
  init: z.string().optional(),
  /** 循环条件表达式（如 'i < 10'） */
  condition: z.string().default(''),
  /** for 的更新表达式（如 'i++'） */
  update: z.string().optional(),
  /** forEach 的可迭代对象（变量引用或表达式） */
  iterable: z.string().optional(),
  /** 循环变量名（如 i / item） */
  loopVarName: z.string().default(''),
  /** 循环变量类型 */
  loopVarType: z.enum(['int', 'item', 'block', 'string']).default('int'),
  /** 循环体子图 ID（复杂循环体用子图，可选） */
  bodySubgraphId: z.string().optional(),
});
export type LoopNodeData = z.infer<typeof LoopNodeData>;
```

修改 `NodeData` 联合类型（原第 344-356 行），追加 3 个新成员：

```ts
export const NodeData = z.discriminatedUnion('kind', [
  ItemNodeData,
  BlockNodeData,
  EntityNodeData,
  RecipeNodeData,
  MachineNodeData,
  MultiBlockNodeData,
  EventNodeData,
  ConditionNodeData,
  ActionNodeData,
  CodeNodeData,
  CommentNodeData,
  // 阶段 C 新增
  VariableNodeData,
  SubgraphNodeData,
  LoopNodeData,
]);
export type NodeData = z.infer<typeof NodeData>;
```

修改 `NodeGraph`（原第 394-410 行），追加 `subgraphs` 字段：

```ts
export const NodeGraph = z.object({
  /** 节点图版本（用于迁移） */
  version: z.literal(1).default(1),
  /** 项目 ID（关联 ModSpec.modId） */
  modId: z.string(),
  /** 画布元信息 */
  viewport: z
    .object({
      x: z.number(),
      y: z.number(),
      zoom: z.number(),
    })
    .default({ x: 0, y: 0, zoom: 1 }),
  nodes: z.array(ModNode),
  edges: z.array(ModEdge),
  /** 子图注册表（阶段 C）：id → SubgraphDefinition，旧 JSON 无此字段默认空对象 */
  subgraphs: z.record(z.string(), SubgraphDefinition).default({}),
});
export type NodeGraph = z.infer<typeof NodeGraph>;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/shared test -- node-graph-spec`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/schemas/node-graph-spec.ts packages/shared/src/schemas/node-graph-spec.test.ts
git commit -m "feat(shared): add loop NodeKind + LoopNodeData + NodeGraph.subgraphs"
```

---

## Task 4: custom-node-schema.ts（CustomNodeSchema）

**Files:**
- Create: `packages/shared/src/schemas/custom-node-schema.ts`
- Test: `packages/shared/src/schemas/custom-node-schema.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `packages/shared/src/schemas/custom-node-schema.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { CustomNodeSchema } from './custom-node-schema.js';

describe('CustomNodeSchema', () => {
  it('完整 schema 解析', () => {
    const s = CustomNodeSchema.parse({
      typeId: 'mymod:custom_crafter',
      label: '自定义合成台',
      description: '3x3 合成',
      icon: 'crafting-table',
      color: 'mc-custom',
      ports: [
        { id: 'in', label: '输入', type: 'item_stack', direction: 'in', required: false, multiple: true },
        { id: 'out', label: '产物', type: 'item_stack', direction: 'out', required: false, multiple: false },
      ],
      fields: [
        { key: 'speed', label: '速度', type: 'number', min: 1, max: 100 },
      ],
      codeTemplate: 'public class {{className}} { int {{field:speed}} = 1; }',
    });
    expect(s.typeId).toBe('mymod:custom_crafter');
    expect(s.ports).toHaveLength(2);
    expect(s.fields).toHaveLength(1);
  });

  it('typeId 必填', () => {
    expect(() => CustomNodeSchema.parse({ label: 'x' })).toThrow();
  });

  it('ports/fields 默认空数组', () => {
    const s = CustomNodeSchema.parse({
      typeId: 'x:y', label: 'x', description: '', icon: '', color: '', codeTemplate: '',
    });
    expect(s.ports).toEqual([]);
    expect(s.fields).toEqual([]);
  });

  it('codeTemplate 必填（可为空字符串）', () => {
    const s = CustomNodeSchema.parse({
      typeId: 'x:y', label: 'x', description: '', icon: '', color: '', codeTemplate: '',
    });
    expect(s.codeTemplate).toBe('');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/shared test -- custom-node-schema`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 custom-node-schema.ts**

创建 `packages/shared/src/schemas/custom-node-schema.ts`：

```ts
import { z } from 'zod';
import { NodePort, PortType } from './node-graph-spec.js';

/**
 * 自定义节点类型 schema（阶段 C）
 *
 * 高手用户可定义自己的节点类型：JSON schema 驱动端口和字段，
 * 代码模板用 Mustache 语法（{{field:key}}）注入字段值。
 * 自定义节点数据上挂 kind: 'subgraph' + customTypeId，由 SubgraphNode 路由到 CustomNodeContent 渲染。
 */

/** 字段 schema（与 Plan A 的 FieldSchema 对齐，但独立定义以避免循环依赖） */
export const CustomNodeFieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'number', 'dropdown', 'noderef', 'resourceId', 'color', 'nbt', 'segmented']),
  required: z.boolean().default(false),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  options: z.array(z.string()).optional(),
  dataType: PortType.optional(),
  condition: z
    .object({
      field: z.string(),
      equals: z.string().optional(),
      in: z.array(z.string()).optional(),
    })
    .optional(),
});
export type CustomNodeFieldSchema = z.infer<typeof CustomNodeFieldSchema>;

export const CustomNodeSchema = z.object({
  /** 类型 ID（如 'mymod:custom_crafter'，全局唯一） */
  typeId: z.string().min(1),
  /** 显示名 */
  label: z.string(),
  /** 描述 */
  description: z.string().default(''),
  /** 像素图标名 */
  icon: z.string().default(''),
  /** 头部色条 Tailwind class（如 'mc-custom'） */
  color: z.string().default('mc-code'),
  /** 端口定义（复用 NodePort） */
  ports: z.array(NodePort).default([]),
  /** 字段定义（复用 7 类编辑器） */
  fields: z.array(CustomNodeFieldSchema).default([]),
  /** Java 代码模板（Mustache 语法，{{field:key}} 注入字段值） */
  codeTemplate: z.string().default(''),
});
export type CustomNodeSchema = z.infer<typeof CustomNodeSchema>;
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/shared test -- custom-node-schema`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/schemas/custom-node-schema.ts packages/shared/src/schemas/custom-node-schema.test.ts
git commit -m "feat(shared): add CustomNodeSchema for custom node types"
```

---

## Task 5: schemas/index.ts 导出 custom-node-schema

**Files:**
- Modify: `packages/shared/src/schemas/index.ts`
- Test: 无（导出验证由后续 task 的 import 覆盖）

- [ ] **Step 1: 写失败测试**

创建临时验证测试 `packages/shared/src/schemas/index.test.ts`（若不存在）或追加：

```ts
import { describe, it, expect } from 'vitest';
import { CustomNodeSchema } from './index.js';

describe('schemas index 导出', () => {
  it('CustomNodeSchema 从 index 导出', () => {
    expect(CustomNodeSchema).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/shared test -- index`
Expected: FAIL — `CustomNodeSchema` 未从 index 导出

- [ ] **Step 3: 添加导出**

修改 `packages/shared/src/schemas/index.ts`，在末尾追加一行：

```ts
export * from './mod-spec.js';
export * from './generator.js';
export * from './datapack-spec.js';
export * from './kubejs-spec.js';
export * from './crafttweaker-spec.js';
export * from './modpack-spec.js';
export * from './server-spec.js';
export * from './skin-spec.js';
export * from './resource-pack-spec.js';
export * from './launcher-spec.js';
export * from './behavior-pack-spec.js';
export * from './node-graph-spec.js';
export * from './custom-node-schema.js';
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/shared test -- index`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add packages/shared/src/schemas/index.ts packages/shared/src/schemas/index.test.ts
git commit -m "feat(shared): export custom-node-schema from schemas index"
```

---

## Task 6: subgraphManager.ts（单例类）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/subgraph/subgraphManager.ts`
- Test: `apps/desktop/src/renderer/src/components/lowcode/subgraph/subgraphManager.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/subgraph/subgraphManager.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { subgraphManager } from './subgraphManager.js';
import type { SubgraphDefinition } from '@mc-creator/shared';

function makeSg(id: string, name = id): SubgraphDefinition {
  return { id, name, nodes: [], edges: [], portMappings: [] };
}

describe('subgraphManager（单例）', () => {
  beforeEach(() => {
    subgraphManager.clear();
  });

  it('register + get', () => {
    subgraphManager.register(makeSg('sg_1', '合成'));
    const sg = subgraphManager.get('sg_1');
    expect(sg?.name).toBe('合成');
  });

  it('has', () => {
    expect(subgraphManager.has('sg_1')).toBe(false);
    subgraphManager.register(makeSg('sg_1'));
    expect(subgraphManager.has('sg_1')).toBe(true);
  });

  it('list', () => {
    subgraphManager.register(makeSg('sg_1'));
    subgraphManager.register(makeSg('sg_2'));
    expect(subgraphManager.list()).toHaveLength(2);
  });

  it('remove', () => {
    subgraphManager.register(makeSg('sg_1'));
    subgraphManager.remove('sg_1');
    expect(subgraphManager.has('sg_1')).toBe(false);
  });

  it('detectCycle：无环返回 false', () => {
    subgraphManager.register(makeSg('sg_1'));
    expect(subgraphManager.detectCycle('sg_1', 'sg_2')).toBe(false);
  });

  it('detectCycle：sg_2 含 sg_1 子图节点，把 sg_1 放入 sg_2 会成环', () => {
    subgraphManager.register(makeSg('sg_1'));
    // sg_2 内部有一个 subgraph 节点引用 sg_1
    const sg2: SubgraphDefinition = {
      id: 'sg_2', name: 'parent', nodes: [], edges: [],
      portMappings: [],
      // 模拟 sg_2 引用 sg_1：detectCycle 通过 nodes 中 subgraph 节点的 subgraphId 检测
    };
    // 用 register + 手动塞节点的方式构造引用链
    subgraphManager.register({
      ...sg2,
      nodes: [{
        id: 'n_in_sg2', type: 'subgraph',
        position: { x: 0, y: 0 },
        data: { nodeId: 'n_in_sg2', label: 'child', note: '', disabled: false, kind: 'subgraph', subgraphId: 'sg_1', subgraphName: '', customTypeId: null, customFields: {}, collapsed: false },
        ports: [], selected: false,
      } as never],
    });
    // 把 sg_1 放入 sg_2 → sg_1 → sg_2 → sg_1 成环
    expect(subgraphManager.detectCycle('sg_2', 'sg_1')).toBe(true);
  });

  it('serializeAll + deserializeAll 往返', () => {
    subgraphManager.register(makeSg('sg_1', 'A'));
    const json = subgraphManager.serializeAll();
    subgraphManager.clear();
    const result = subgraphManager.deserializeAll(json);
    expect(result.ok).toBe(true);
    expect(subgraphManager.get('sg_1')?.name).toBe('A');
  });

  it('deserializeAll 非法 JSON 返回 error', () => {
    const result = subgraphManager.deserializeAll('not json');
    expect(result.ok).toBe(false);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- subgraphManager`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 subgraphManager.ts**

创建 `apps/desktop/src/renderer/src/components/lowcode/subgraph/subgraphManager.ts`：

```ts
import type { SubgraphDefinition } from '@mc-creator/shared';

/**
 * 子图注册表（单例，不导出独立 getSubgraph 函数）
 *
 * 维护全局子图定义，支持：
 * - register/get/has/list/remove 基础操作
 * - detectCycle：检测把 targetId 放入 parentId 是否成环（DFS 遍历 parentId 子图内的 subgraph 节点引用链）
 * - serializeAll/deserializeAll：JSON 持久化
 *
 * 子图定义也持久化到 NodeGraph.subgraphs（Zod schema），subgraphManager 作为运行时缓存 + 环检测能力。
 */
export class SubgraphManager {
  private map = new Map<string, SubgraphDefinition>();

  register(sg: SubgraphDefinition): void {
    this.map.set(sg.id, sg);
  }

  get(id: string): SubgraphDefinition | undefined {
    return this.map.get(id);
  }

  has(id: string): boolean {
    return this.map.has(id);
  }

  list(): SubgraphDefinition[] {
    return [...this.map.values()];
  }

  remove(id: string): void {
    this.map.delete(id);
  }

  clear(): void {
    this.map.clear();
  }

  /**
   * 检测把 targetId 子图放入 parentId 子图内部是否会成环。
   * 成环条件：从 targetId 出发，沿 parentId 内部 subgraph 节点的 subgraphId 引用链能回到 parentId。
   * 这里反向检测：从 parentId 出发，沿其内部 subgraph 节点引用链，看是否已经引用了 targetId。
   * 若 parentId 已经（直接或间接）引用 targetId，再把 targetId 放入 parentId 会形成 targetId → parentId → targetId 环。
   */
  detectCycle(parentId: string, targetId: string): boolean {
    if (parentId === targetId) return true;
    const visited = new Set<string>();
    const stack = [parentId];
    while (stack.length > 0) {
      const currentId = stack.pop()!;
      if (currentId === targetId) return true;
      if (visited.has(currentId)) continue;
      visited.add(currentId);
      const sg = this.map.get(currentId);
      if (!sg) continue;
      for (const node of sg.nodes) {
        if (node.data.kind === 'subgraph' && node.data.subgraphId) {
          stack.push(node.data.subgraphId);
        }
      }
    }
    return false;
  }

  serializeAll(): string {
    const obj: Record<string, SubgraphDefinition> = {};
    for (const [id, sg] of this.map) {
      obj[id] = sg;
    }
    return JSON.stringify(obj);
  }

  deserializeAll(json: string): { ok: true } | { ok: false; error: string } {
    try {
      const parsed = JSON.parse(json) as Record<string, SubgraphDefinition>;
      this.map.clear();
      for (const [id, sg] of Object.entries(parsed)) {
        this.map.set(id, sg);
      }
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }
}

export const subgraphManager = new SubgraphManager();
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- subgraphManager`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/subgraph/subgraphManager.ts apps/desktop/src/renderer/src/components/lowcode/subgraph/subgraphManager.test.ts
git commit -m "feat(lowcode): add subgraphManager singleton with cycle detection"
```

---

## Task 7: customNodeRegistry.ts（单例类）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/custom/customNodeRegistry.ts`
- Test: `apps/desktop/src/renderer/src/components/lowcode/custom/customNodeRegistry.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/custom/customNodeRegistry.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { customNodeRegistry } from './customNodeRegistry.js';
import type { CustomNodeSchema } from '@mc-creator/shared';

function makeSchema(typeId: string): CustomNodeSchema {
  return {
    typeId, label: typeId, description: '', icon: '', color: 'mc-code',
    ports: [], fields: [], codeTemplate: '',
  };
}

describe('customNodeRegistry（单例）', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('register + get', () => {
    customNodeRegistry.register(makeSchema('mymod:x'));
    const s = customNodeRegistry.get('mymod:x');
    expect(s?.typeId).toBe('mymod:x');
  });

  it('has', () => {
    expect(customNodeRegistry.has('mymod:x')).toBe(false);
    customNodeRegistry.register(makeSchema('mymod:x'));
    expect(customNodeRegistry.has('mymod:x')).toBe(true);
  });

  it('list', () => {
    customNodeRegistry.register(makeSchema('mymod:a'));
    customNodeRegistry.register(makeSchema('mymod:b'));
    expect(customNodeRegistry.list()).toHaveLength(2);
  });

  it('importJSON 合法 JSON 注册成功', () => {
    const json = JSON.stringify(makeSchema('mymod:imported'));
    const result = customNodeRegistry.importJSON(json);
    expect(result.ok).toBe(true);
    expect(customNodeRegistry.has('mymod:imported')).toBe(true);
  });

  it('importJSON 非法 JSON 返回 error', () => {
    const result = customNodeRegistry.importJSON('not json');
    expect(result.ok).toBe(false);
  });

  it('importJSON schema 校验失败返回 error', () => {
    const result = customNodeRegistry.importJSON(JSON.stringify({ typeId: '' }));
    expect(result.ok).toBe(false);
  });

  it('export 单个 schema', () => {
    customNodeRegistry.register(makeSchema('mymod:x'));
    const json = customNodeRegistry.export('mymod:x');
    const parsed = JSON.parse(json);
    expect(parsed.typeId).toBe('mymod:x');
  });

  it('exportAll 全部 schema', () => {
    customNodeRegistry.register(makeSchema('mymod:a'));
    customNodeRegistry.register(makeSchema('mymod:b'));
    const json = customNodeRegistry.exportAll();
    const parsed = JSON.parse(json);
    expect(parsed).toHaveLength(2);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- customNodeRegistry`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 customNodeRegistry.ts**

创建 `apps/desktop/src/renderer/src/components/lowcode/custom/customNodeRegistry.ts`：

```ts
import { CustomNodeSchema, type CustomNodeSchema as CustomNodeSchemaType } from '@mc-creator/shared';

/**
 * 自定义节点注册表（单例）
 *
 * 维护已注册的自定义节点类型（CustomNodeSchema），支持：
 * - register/get/has/list/clear 基础操作
 * - importJSON：从 JSON 字符串导入并注册（含 Zod 校验）
 * - export/exportAll：导出为 JSON 字符串（可分享给其他用户）
 */
export class CustomNodeRegistry {
  private map = new Map<string, CustomNodeSchemaType>();

  register(schema: CustomNodeSchemaType): void {
    this.map.set(schema.typeId, schema);
  }

  get(typeId: string): CustomNodeSchemaType | undefined {
    return this.map.get(typeId);
  }

  has(typeId: string): boolean {
    return this.map.has(typeId);
  }

  list(): CustomNodeSchemaType[] {
    return [...this.map.values()];
  }

  clear(): void {
    this.map.clear();
  }

  importJSON(json: string): { ok: true } | { ok: false; error: string } {
    try {
      const raw = JSON.parse(json);
      const result = CustomNodeSchema.safeParse(raw);
      if (!result.success) {
        return { ok: false, error: result.error.message };
      }
      this.register(result.data);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  }

  export(typeId: string): string {
    const schema = this.map.get(typeId);
    if (!schema) return '{}';
    return JSON.stringify(schema, null, 2);
  }

  exportAll(): string {
    return JSON.stringify(this.list(), null, 2);
  }
}

export const customNodeRegistry = new CustomNodeRegistry();
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- customNodeRegistry`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/custom/customNodeRegistry.ts apps/desktop/src/renderer/src/components/lowcode/custom/customNodeRegistry.test.ts
git commit -m "feat(lowcode): add customNodeRegistry singleton with import/export"
```

---

## Task 8: Store 新增 createDefaultNodeData/Ports 3 分支 + encapsulateSubgraph + setEditingSubgraphId + addCustomNode

**Files:**
- Modify: `apps/desktop/src/renderer/src/store/node-graph-store.ts`
- Test: `apps/desktop/src/renderer/src/store/node-graph-store.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/store/node-graph-store.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useNodeGraphStore } from './node-graph-store.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';

describe('createDefaultNodeData/Ports（阶段 C 新节点）', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({ graph: { ...useNodeGraphStore.getState().graph, modId: 'testmod' } });
  });

  it('addNode variable 创建默认数据 + 端口', () => {
    const id = useNodeGraphStore.getState().addNode('variable', { x: 0, y: 0 });
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    expect(node.data.kind).toBe('variable');
    if (node.data.kind === 'variable') {
      expect(node.data.varName).toBe('var1');
      expect(node.data.varType).toBe('int');
      expect(node.data.isConstant).toBe(false);
    }
    expect(node.ports).toHaveLength(1);
    expect(node.ports[0].direction).toBe('out');
  });

  it('addNode subgraph 创建默认数据 + 端口', () => {
    const id = useNodeGraphStore.getState().addNode('subgraph', { x: 0, y: 0 });
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    expect(node.data.kind).toBe('subgraph');
    if (node.data.kind === 'subgraph') {
      expect(node.data.subgraphId).toBe('');
      expect(node.data.customTypeId).toBeNull();
    }
  });

  it('addNode loop 创建默认数据 + 端口', () => {
    const id = useNodeGraphStore.getState().addNode('loop', { x: 0, y: 0 });
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    expect(node.data.kind).toBe('loop');
    if (node.data.kind === 'loop') {
      expect(node.data.loopType).toBe('for');
      expect(node.data.loopVarName).toBe('i');
    }
    expect(node.ports.some((p) => p.id === 'loop_var')).toBe(true);
    expect(node.ports.some((p) => p.id === 'body')).toBe(true);
    expect(node.ports.some((p) => p.id === 'done')).toBe(true);
  });
});

describe('encapsulateSubgraph', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({ graph: { ...useNodeGraphStore.getState().graph, modId: 'testmod' } });
  });

  it('把选中节点封装为子图，返回新 SubgraphNode id', () => {
    const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    const id2 = useNodeGraphStore.getState().addNode('item', { x: 100, y: 0 });
    const sgNodeId = useNodeGraphStore.getState().encapsulateSubgraph([id1, id2], '我的子图');
    expect(sgNodeId).not.toBeNull();
    const sgNode = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === sgNodeId)!;
    expect(sgNode.data.kind).toBe('subgraph');
    if (sgNode.data.kind === 'subgraph') {
      expect(sgNode.data.subgraphName).toBe('我的子图');
    }
    // 原节点移出主图
    expect(useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id1)).toBeUndefined();
    expect(useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id2)).toBeUndefined();
    // 子图注册到 graph.subgraphs
    expect(Object.keys(useNodeGraphStore.getState().graph.subgraphs)).toHaveLength(1);
  });

  it('空节点列表返回 null', () => {
    expect(useNodeGraphStore.getState().encapsulateSubgraph([], 'x')).toBeNull();
  });
});

describe('setEditingSubgraphId + editingSubgraphId', () => {
  it('setEditingSubgraphId 设置/清除', () => {
    useNodeGraphStore.getState().setEditingSubgraphId('sg_1');
    expect(useNodeGraphStore.getState().editingSubgraphId).toBe('sg_1');
    useNodeGraphStore.getState().setEditingSubgraphId(null);
    expect(useNodeGraphStore.getState().editingSubgraphId).toBeNull();
  });
});

describe('addCustomNode', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({ graph: { ...useNodeGraphStore.getState().graph, modId: 'testmod' } });
  });

  it('注册 schema 后 addCustomNode 创建带 customTypeId 的 subgraph 节点', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter', label: '合成台', description: '', icon: '', color: 'mc-code',
      ports: [], fields: [], codeTemplate: '',
    });
    const id = useNodeGraphStore.getState().addCustomNode('mymod:crafter', { x: 50, y: 50 });
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    expect(node.data.kind).toBe('subgraph');
    if (node.data.kind === 'subgraph') {
      expect(node.data.customTypeId).toBe('mymod:crafter');
      expect(node.data.subgraphName).toBe('合成台');
    }
  });

  it('未注册的 typeId 抛错', () => {
    expect(() => useNodeGraphStore.getState().addCustomNode('unregistered', { x: 0, y: 0 })).toThrow();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- node-graph-store`
Expected: FAIL — `encapsulateSubgraph` / `setEditingSubgraphId` / `addCustomNode` 不存在，variable/subgraph/loop 默认数据未创建

- [ ] **Step 3: 修改 store**

在 `apps/desktop/src/renderer/src/store/node-graph-store.ts` 顶部 import 区追加：

```ts
import { create } from 'zustand';
import type {
  NodeGraph,
  ModNode,
  ModEdge,
  NodeKind,
  NodeData,
  EditorMode,
  SubgraphDefinition,
} from '@mc-creator/shared';
import type { CompileResult } from '../lib/compileNodeGraph.js';
import {
  serializeGraph,
  safeDeserializeGraph,
} from '../lib/nodeGraphSerializer.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
```

在 `NodeGraphState` 接口中（`compileResult` 之后）追加新 state + actions：

```ts
interface NodeGraphState {
  // ... 现有字段 ...

  /** 阶段 C：当前正在编辑的子图 ID（null 表示编辑主图） */
  editingSubgraphId: string | null;

  // === 阶段 C：子图/自定义节点 ===
  /** 把选中节点封装为子图，返回新 SubgraphNode id（失败返回 null） */
  encapsulateSubgraph: (nodeIds: string[], name: string) => string | null;
  /** 设置当前编辑的子图 ID（null 回到主图） */
  setEditingSubgraphId: (subgraphId: string | null) => void;
  /** 添加自定义节点（基于 customNodeRegistry 中已注册的 schema） */
  addCustomNode: (typeId: string, position: { x: number; y: number }) => string;

  // ... 现有 actions ...
}
```

在 `createDefaultNodeData` 函数的 switch 中，`case 'comment'` 之后、`default` 之前追加 3 个分支：

```ts
    case 'variable':
      return {
        ...base,
        kind: 'variable',
        varName: 'var1',
        varType: 'int',
        value: 0,
        isConstant: false,
      } as NodeData;
    case 'subgraph':
      return {
        ...base,
        kind: 'subgraph',
        subgraphId: '',
        subgraphName: '',
        customTypeId: null,
        customFields: {},
      } as NodeData;
    case 'loop':
      return {
        ...base,
        kind: 'loop',
        loopType: 'for',
        init: 'int i = 0',
        condition: 'i < 10',
        update: 'i++',
        loopVarName: 'i',
        loopVarType: 'int',
      } as NodeData;
```

在 `createDefaultPorts` 函数的 switch 中，`case 'comment'` 之后、`default` 之前追加 3 个分支：

```ts
    case 'variable':
      return [
        { id: 'value', label: '变量', type: 'integer', direction: 'out', required: false, multiple: true },
      ];
    case 'subgraph':
      // 子图节点端口由 portMappings 动态生成，默认空（Plan C Task 9 的 getPorts 会处理）
      return [];
    case 'loop':
      return [
        { id: 'input', label: '输入', type: 'void', direction: 'in', required: false, multiple: false },
        { id: 'loop_var', label: '循环变量', type: 'integer', direction: 'out', required: false, multiple: true },
        { id: 'body', label: '循环体', type: 'void', direction: 'out', required: false, multiple: false },
        { id: 'done', label: '完成', type: 'void', direction: 'out', required: false, multiple: true },
      ];
```

在 `EMPTY_GRAPH` 常量后追加 `editingSubgraphId` 初始值，并在 store 创建函数中实现 3 个新 action。修改 `useNodeGraphStore = create<NodeGraphState>((set, get) => ({` 块：

```ts
export const useNodeGraphStore = create<NodeGraphState>((set, get) => ({
  graph: EMPTY_GRAPH,
  selectedNodeId: null,
  selectedEdgeId: null,
  undoStack: [],
  redoStack: [],
  compileResult: null,
  editingSubgraphId: null,

  // ... 现有 actions 保持不变（addNode/updateNode/removeNode/duplicateNode/moveNode/selectNode/addEdge/updateEdge/removeEdge/selectEdge/setViewport/setModId/commit/undo/redo/clear/loadGraph/setCompileResult/exportGraph/importGraph） ...

  // === 阶段 C：子图/自定义节点 ===

  encapsulateSubgraph: (nodeIds, name) => {
    if (nodeIds.length === 0) return null;
    const state = get();
    const { graph } = state;
    const selectedNodes = graph.nodes.filter((n) => nodeIds.includes(n.id));
    if (selectedNodes.length === 0) return null;

    // 收集选中节点之间的内部连线
    const selectedIdSet = new Set(nodeIds);
    const internalEdges = graph.edges.filter(
      (e) => selectedIdSet.has(e.source) && selectedIdSet.has(e.target),
    );
    // 外部连线 → portMappings
    const portMappings: SubgraphDefinition['portMappings'] = [];
    let inPortIdx = 0;
    let outPortIdx = 0;
    for (const edge of graph.edges) {
      if (selectedIdSet.has(edge.source) && !selectedIdSet.has(edge.target)) {
        // 内 → 外：输出端口
        portMappings.push({
          internalPortId: `${edge.source}:${edge.sourceHandle ?? 'out'}`,
          externalPortId: `out_${outPortIdx++}`,
          label: `输出${outPortIdx}`,
          direction: 'out' as const,
          type: 'any',
        });
      } else if (!selectedIdSet.has(edge.source) && selectedIdSet.has(edge.target)) {
        // 外 → 内：输入端口
        portMappings.push({
          internalPortId: `${edge.target}:${edge.targetHandle ?? 'in'}`,
          externalPortId: `in_${inPortIdx++}`,
          label: `输入${inPortIdx}`,
          direction: 'in' as const,
          type: 'any',
        });
      }
    }

    const sgId = genId('sg');
    const sgDef: SubgraphDefinition = {
      id: sgId,
      name,
      nodes: selectedNodes,
      edges: internalEdges,
      portMappings,
    };

    // 新 SubgraphNode 位置：选中节点质心
    const cx = selectedNodes.reduce((s, n) => s + n.position.x, 0) / selectedNodes.length;
    const cy = selectedNodes.reduce((s, n) => s + n.position.y, 0) / selectedNodes.length;
    const sgNodeId = genId('subgraph');
    const sgNode: ModNode = {
      id: sgNodeId,
      type: 'subgraph',
      position: { x: cx, y: cy },
      data: {
        nodeId: sgNodeId,
        label: name,
        note: '',
        disabled: false,
        collapsed: false,
        kind: 'subgraph',
        subgraphId: sgId,
        subgraphName: name,
        customTypeId: null,
        customFields: {},
      },
      ports: portMappings.map((m) => ({
        id: m.externalPortId,
        label: m.label,
        type: m.type,
        direction: m.direction,
        required: false,
        multiple: m.direction === 'in',
      })),
      selected: true,
    };

    // 从主图移除选中节点 + 相关连线，添加 SubgraphNode，注册子图
    const remainingNodeIds = new Set(graph.nodes.map((n) => n.id).filter((id) => !selectedIdSet.has(id)));
    set((s) => ({
      graph: {
        ...s.graph,
        nodes: [
          ...s.graph.nodes.filter((n) => !selectedIdSet.has(n.id)),
          sgNode,
        ],
        edges: s.graph.edges.filter(
          (e) => !(selectedIdSet.has(e.source) || selectedIdSet.has(e.target)),
        ),
        subgraphs: { ...s.graph.subgraphs, [sgId]: sgDef },
      },
      selectedNodeId: sgNodeId,
    }));
    void remainingNodeIds; // 保留用于未来扩展（外部连线重建）
    return sgNodeId;
  },

  setEditingSubgraphId: (subgraphId) => set({ editingSubgraphId: subgraphId }),

  addCustomNode: (typeId, position) => {
    const schema = customNodeRegistry.get(typeId);
    if (!schema) {
      throw new Error(`自定义节点类型未注册：${typeId}`);
    }
    const nodeId = genId('custom');
    const data = {
      nodeId,
      label: schema.label,
      note: '',
      disabled: false,
      collapsed: false,
      kind: 'subgraph' as const,
      subgraphId: '',
      subgraphName: schema.label,
      customTypeId: typeId,
      customFields: {},
    };
    const node: ModNode = {
      id: nodeId,
      type: 'subgraph',
      position,
      data,
      ports: schema.ports,
      selected: false,
    };
    set((s) => ({
      graph: { ...s.graph, nodes: [...s.graph.nodes, node] },
      selectedNodeId: nodeId,
    }));
    return nodeId;
  },
}));
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- node-graph-store`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/store/node-graph-store.ts apps/desktop/src/renderer/src/store/node-graph-store.test.ts
git commit -m "feat(store): add variable/subgraph/loop defaults + encapsulateSubgraph + addCustomNode"
```

---

## Task 9: portSchemas.ts 新增 variable/subgraph/loop 端口

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.ts`（Plan A 创建）
- Test: `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.test.ts`（追加）

> 前置：Plan A 已创建 `portSchemas.ts`，导出 `getPorts(data: NodeData): NodePort[]`，内含 11 种节点的 switch。Plan C 追加 3 个分支。

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { getPorts } from './portSchemas.js';
import type { VariableNodeData, SubgraphNodeData, LoopNodeData, NodeGraph } from '@mc-creator/shared';

describe('getPorts（阶段 C 新节点）', () => {
  it('variable 端口标签随 varName 变化', () => {
    const data: VariableNodeData = {
      nodeId: 'v1', label: 'x', note: '', disabled: false, kind: 'variable',
      varName: 'MAX_DAMAGE', varType: 'int', value: 10, isConstant: true, collapsed: false,
    };
    const ports = getPorts(data);
    expect(ports).toHaveLength(1);
    expect(ports[0].label).toBe('MAX_DAMAGE');
    expect(ports[0].direction).toBe('out');
    expect(ports[0].multiple).toBe(true);
  });

  it('variable 端口 type 随 varType 变化', () => {
    const data: VariableNodeData = {
      nodeId: 'v1', label: 'x', note: '', disabled: false, kind: 'variable',
      varName: 'x', varType: 'string', value: '', isConstant: false, collapsed: false,
    };
    const ports = getPorts(data);
    expect(ports[0].type).toBe('string');
  });

  it('subgraph 端口从 graph.subgraphs 的 portMappings 生成', () => {
    const data: SubgraphNodeData = {
      nodeId: 's1', label: '子图', note: '', disabled: false, kind: 'subgraph',
      subgraphId: 'sg_1', subgraphName: '测试', customTypeId: null, customFields: {}, collapsed: false,
    };
    // getPorts 第二参数可选传 graph（含 subgraphs）
    const graph = {
      version: 1 as const, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [], edges: [],
      subgraphs: {
        sg_1: {
          id: 'sg_1', name: '测试', nodes: [], edges: [],
          portMappings: [
            { internalPortId: 'in_1', externalPortId: 'input', label: '材料', direction: 'in', type: 'item_stack' },
            { internalPortId: 'out_1', externalPortId: 'output', label: '产物', direction: 'out', type: 'item_stack' },
          ],
        },
      },
    } as NodeGraph;
    const ports = getPorts(data, graph);
    expect(ports).toHaveLength(2);
    expect(ports.find((p) => p.id === 'input')?.label).toBe('材料');
    expect(ports.find((p) => p.id === 'output')?.direction).toBe('out');
  });

  it('subgraph 子图未找到时返回空数组', () => {
    const data: SubgraphNodeData = {
      nodeId: 's1', label: 'x', note: '', disabled: false, kind: 'subgraph',
      subgraphId: 'missing', subgraphName: '', customTypeId: null, customFields: {}, collapsed: false,
    };
    expect(getPorts(data)).toEqual([]);
  });

  it('loop 端口含 loop_var/body/done，loop_var 标签随 loopVarName 变化', () => {
    const data: LoopNodeData = {
      nodeId: 'l1', label: 'x', note: '', disabled: false, kind: 'loop',
      loopType: 'forEach', condition: '', loopVarName: 'item', loopVarType: 'item',
      iterable: 'items', collapsed: false,
    };
    const ports = getPorts(data);
    expect(ports.find((p) => p.id === 'loop_var')?.label).toBe('item');
    expect(ports.find((p) => p.id === 'body')).toBeDefined();
    expect(ports.find((p) => p.id === 'done')).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- portSchemas`
Expected: FAIL — getPorts 不处理 variable/subgraph/loop

- [ ] **Step 3: 修改 portSchemas.ts**

修改 `apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.ts`，把 `getPorts` 签名改为接受可选 graph 参数，并追加 3 个分支。完整的新 `getPorts` 函数（替换 Plan A 原有实现，保留原有 11 分支）：

```ts
import type { NodeData, NodePort, NodeGraph, VariableNodeData, SubgraphNodeData, LoopNodeData } from '@mc-creator/shared';

/**
 * 根据节点 data 生成端口列表（数据驱动）。
 * @param data 节点数据
 * @param graph 可选，子图节点需要查 graph.subgraphs 获取 portMappings
 */
export function getPorts(data: NodeData, graph?: NodeGraph): NodePort[] {
  switch (data.kind) {
    // === Plan A 原 11 分支保持不变 ===
    case 'item':
      return [{ id: 'out', label: '物品', type: 'item_stack', direction: 'out', required: false, multiple: false }];
    case 'block':
      return [{ id: 'out', label: '方块', type: 'block_state', direction: 'out', required: false, multiple: false }];
    case 'entity':
      return [{ id: 'out', label: '实体', type: 'entity', direction: 'out', required: false, multiple: false }];
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
      return [{ id: 'trigger', label: '触发', type: 'void', direction: 'out', required: false, multiple: true }];
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

    // === 阶段 C 新增 3 分支 ===
    case 'variable': {
      const v = data as VariableNodeData;
      return [
        { id: 'value', label: v.varName || '变量', type: varTypeToPortType(v.varType), direction: 'out', required: false, multiple: true },
      ];
    }
    case 'subgraph': {
      const s = data as SubgraphNodeData;
      if (!s.subgraphId || !graph) return [];
      const sg = graph.subgraphs[s.subgraphId];
      if (!sg) return [];
      return sg.portMappings.map((m) => ({
        id: m.externalPortId,
        label: m.label,
        type: m.type,
        direction: m.direction,
        required: false,
        multiple: m.direction === 'in',
      }));
    }
    case 'loop': {
      const l = data as LoopNodeData;
      return [
        { id: 'input', label: '输入', type: 'void', direction: 'in', required: false, multiple: false },
        { id: 'loop_var', label: l.loopVarName || '循环变量', type: loopVarTypeToPortType(l.loopVarType), direction: 'out', required: false, multiple: true },
        { id: 'body', label: '循环体', type: 'void', direction: 'out', required: false, multiple: false },
        { id: 'done', label: '完成', type: 'void', direction: 'out', required: false, multiple: true },
      ];
    }
    default:
      return [];
  }
}

function varTypeToPortType(varType: VariableNodeData['varType']): NodePort['type'] {
  switch (varType) {
    case 'int': return 'integer';
    case 'double': return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'item': return 'item_stack';
    case 'block': return 'block_state';
  }
}

function loopVarTypeToPortType(loopVarType: LoopNodeData['loopVarType']): NodePort['type'] {
  switch (loopVarType) {
    case 'int': return 'integer';
    case 'item': return 'item_stack';
    case 'block': return 'block_state';
    case 'string': return 'string';
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- portSchemas`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.ts apps/desktop/src/renderer/src/components/lowcode/nodes/portSchemas.test.ts
git commit -m "feat(lowcode): add variable/subgraph/loop port schemas"
```

---

## Task 10: VariableNode.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/VariableNode.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/nodes/VariableNode.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/nodes/VariableNode.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VariableNode } from './VariableNode.js';
import type { VariableNodeData } from '@mc-creator/shared';

vi.mock('./base/McNodeShell.js', () => ({
  McNodeShell: ({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) => (
    <div data-testid="mc-node-shell"><span data-testid="title">{title}</span>{badge && <span data-testid="badge">{badge}</span>}<div data-testid="children">{children}</div></div>
  ),
}));
vi.mock('../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (sel: (s: { toggleCollapse: () => void; graph: { nodes: { id: string; ports: unknown[] }[] } }) => unknown) =>
    sel({ toggleCollapse: () => {}, graph: { nodes: [{ id: 'v1', ports: [] }] } }),
}));
vi.mock('../drawer/NodeDetailDrawer.js', () => ({
  useDrawerStore: () => ({ openDrawer: () => {} }),
}));

describe('VariableNode', () => {
  it('渲染变量名 + 类型 + 值', () => {
    const data: VariableNodeData = {
      nodeId: 'v1', label: '最大伤害', note: '', disabled: false, kind: 'variable',
      varName: 'MAX_DAMAGE', varType: 'int', value: 10, isConstant: true, collapsed: false,
    };
    render(<VariableNode data={data} selected={false} />);
    expect(screen.getByTestId('title').textContent).toBe('最大伤害');
    expect(screen.getByTestId('badge').textContent).toBe('const');
    expect(screen.getByTestId('children').textContent).toContain('MAX_DAMAGE');
    expect(screen.getByTestId('children').textContent).toContain('int');
    expect(screen.getByTestId('children').textContent).toContain('10');
  });

  it('非常量时不显示 badge', () => {
    const data: VariableNodeData = {
      nodeId: 'v2', label: 'x', note: '', disabled: false, kind: 'variable',
      varName: 'currentHp', varType: 'int', value: 20, isConstant: false, collapsed: false,
    };
    render(<VariableNode data={data} selected={false} />);
    expect(screen.queryByTestId('badge')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- VariableNode`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 VariableNode.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/nodes/VariableNode.tsx`：

```tsx
import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { VariableNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useDrawerStore } from '../drawer/NodeDetailDrawer.js';

/**
 * 变量节点：定义全局变量/常量，可被其他节点引用。
 *
 * 端口：value (out, type 随 varType)
 * 颜色：mc-variable
 * 徽章：常量显示 'const'
 */
function VariableNodeComponent({ data, selected }: NodeProps<VariableNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const node = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === data.nodeId));

  return (
    <McNodeShell
      icon="variable"
      title={data.label || data.varName}
      colorClass="mc-variable"
      badge={data.isConstant ? 'const' : undefined}
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      onToggleCollapse={() => toggleCollapse(data.nodeId)}
      onOpenDrawer={() => openDrawer(data.nodeId)}
    >
      <div className="text-[10px] text-mc-mute">
        <span className="font-mono text-mc-text">{data.varName}</span>
        {' : '}
        <span className="text-mc-dim">{data.varType}</span>
        {' = '}
        <span className="font-mono text-mc-text">{String(data.value)}</span>
      </div>
    </McNodeShell>
  );
}

export const VariableNode = memo(VariableNodeComponent);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- VariableNode`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/VariableNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/VariableNode.test.tsx
git commit -m "feat(lowcode): add VariableNode component"
```

---

## Task 11: SubgraphNode.tsx（路由到 CustomNode）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/SubgraphNode.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/nodes/SubgraphNode.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/nodes/SubgraphNode.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubgraphNode } from './SubgraphNode.js';
import type { SubgraphNodeData } from '@mc-creator/shared';

vi.mock('./base/McNodeShell.js', () => ({
  McNodeShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="mc-node-shell"><span data-testid="title">{title}</span><div data-testid="children">{children}</div></div>
  ),
}));
vi.mock('../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (sel: (s: { toggleCollapse: () => void; setEditingSubgraphId: (id: string|null) => void; graph: { nodes: { id: string; ports: unknown[] }[]; subgraphs: Record<string, unknown> } }) => unknown) =>
    sel({ toggleCollapse: () => {}, setEditingSubgraphId: () => {}, graph: { nodes: [{ id: 's1', ports: [] }], subgraphs: {} } }),
}));
vi.mock('../drawer/NodeDetailDrawer.js', () => ({
  useDrawerStore: () => ({ openDrawer: () => {} }),
}));

describe('SubgraphNode', () => {
  it('普通子图渲染 subgraphName + 进入提示', () => {
    const data: SubgraphNodeData = {
      nodeId: 's1', label: '我的合成', note: '', disabled: false, kind: 'subgraph',
      subgraphId: 'sg_1', subgraphName: '合成铁剑', customTypeId: null, collapsed: false, customFields: {},
    };
    render(<SubgraphNode data={data} selected={false} />);
    expect(screen.getByTestId('title').textContent).toBe('我的合成');
    expect(screen.getByTestId('children').textContent).toContain('合成铁剑');
    expect(screen.getByTestId('children').textContent).toContain('双击进入子图');
  });

  it('customTypeId 非空时委托 CustomNodeContent（显示自定义节点内容）', () => {
    const data: SubgraphNodeData = {
      nodeId: 's2', label: '自定义合成台', note: '', disabled: false, kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: 'mymod:crafter', collapsed: false, customFields: {},
    };
    render(<SubgraphNode data={data} selected={false} />);
    // CustomNodeContent 渲染自定义节点摘要
    expect(screen.getByTestId('children').textContent).toContain('mymod:crafter');
  });

  it('子图未注册（subgraphId 找不到）显示警告', () => {
    const data: SubgraphNodeData = {
      nodeId: 's3', label: 'x', note: '', disabled: false, kind: 'subgraph',
      subgraphId: 'missing', subgraphName: '已删', customTypeId: null, collapsed: false, customFields: {},
    };
    render(<SubgraphNode data={data} selected={false} />);
    expect(screen.getByTestId('children').textContent).toContain('子图未找到');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- SubgraphNode`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 SubgraphNode.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/nodes/SubgraphNode.tsx`：

```tsx
import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { SubgraphNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { CustomNodeContent } from './CustomNode.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useDrawerStore } from '../drawer/NodeDetailDrawer.js';

/**
 * 子图节点：封装复用子图。
 *
 * 路由逻辑：data.customTypeId 非空 → 委托 CustomNodeContent（自定义节点）；
 * 否则渲染普通子图摘要（含双击进入子图编辑提示）。
 *
 * 数据上 kind 始终是 'subgraph'，不新增 'custom' NodeKind。
 */
function SubgraphNodeComponent({ data, selected }: NodeProps<SubgraphNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const setEditingSubgraphId = useNodeGraphStore((s) => s.setEditingSubgraphId);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const node = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === data.nodeId));
  const sg = useNodeGraphStore((s) =>
    data.subgraphId ? s.graph.subgraphs[data.subgraphId] : undefined,
  );

  // 自定义节点：委托 CustomNodeContent
  if (data.customTypeId) {
    return (
      <CustomNodeContent
        data={data}
        selected={selected}
        ports={node?.ports ?? []}
      />
    );
  }

  // 普通子图
  const subgraphFound = !!sg;
  return (
    <McNodeShell
      icon="subgraph"
      title={data.label || data.subgraphName || '子图'}
      colorClass="mc-subgraph"
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      errorState={!subgraphFound && data.subgraphId ? 'warning' : null}
      onToggleCollapse={() => toggleCollapse(data.nodeId)}
      onOpenDrawer={() => openDrawer(data.nodeId)}
    >
      {subgraphFound ? (
        <div className="text-[10px] text-mc-mute">
          <div>子图：{data.subgraphName}</div>
          <div className="text-mc-dim">双击进入子图编辑</div>
        </div>
      ) : (
        <div className="text-[10px] text-yellow-400">
          子图未找到：{data.subgraphId || '（空）'}
        </div>
      )}
      {/* 双击进入子图：React Flow 的 onNodeDoubleClick 在 NodeGraphEditor 处理，
          这里通过 data attribute 提示测试与无障碍 */}
      <span
        data-testid="subgraph-enter-hint"
        aria-label="双击进入子图"
        className="sr-only"
      >
        双击进入子图
      </span>
    </McNodeShell>
  );
}

export const SubgraphNode = memo(SubgraphNodeComponent);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- SubgraphNode`
Expected: PASS（CustomNodeContent 在 Task 13 创建，此处测试 mock 了它的行为——实际 Task 13 完成后真正集成）

> 注：此 Task 依赖 Task 13 的 CustomNodeContent。若 Task 13 未完成，测试中 SubgraphNode 的 customTypeId 分支会因 import 失败而报错。实现顺序上可先做 Task 13 再做 Task 11，或在此 Task 临时创建 CustomNode.tsx 占位（Task 13 再充实）。推荐：先做 Task 13，再做 Task 11。

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/SubgraphNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/SubgraphNode.test.tsx
git commit -m "feat(lowcode): add SubgraphNode with CustomNode routing"
```

---

## Task 12: LoopNode.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/LoopNode.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/nodes/LoopNode.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/nodes/LoopNode.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LoopNode } from './LoopNode.js';
import type { LoopNodeData } from '@mc-creator/shared';

vi.mock('./base/McNodeShell.js', () => ({
  McNodeShell: ({ title, badge, children }: { title: string; badge?: string; children: React.ReactNode }) => (
    <div data-testid="mc-node-shell"><span data-testid="title">{title}</span>{badge && <span data-testid="badge">{badge}</span>}<div data-testid="children">{children}</div></div>
  ),
}));
vi.mock('../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (sel: (s: { toggleCollapse: () => void; graph: { nodes: { id: string; ports: unknown[] }[] } }) => unknown) =>
    sel({ toggleCollapse: () => {}, graph: { nodes: [{ id: 'l1', ports: [] }] } }),
}));
vi.mock('../drawer/NodeDetailDrawer.js', () => ({
  useDrawerStore: () => ({ openDrawer: () => {} }),
}));

describe('LoopNode', () => {
  it('for 循环渲染 badge + 摘要', () => {
    const data: LoopNodeData = {
      nodeId: 'l1', label: '计数', note: '', disabled: false, kind: 'loop',
      loopType: 'for', init: 'int i = 0', condition: 'i < 10', update: 'i++',
      loopVarName: 'i', loopVarType: 'int', collapsed: false,
    };
    render(<LoopNode data={data} selected={false} />);
    expect(screen.getByTestId('title').textContent).toBe('计数');
    expect(screen.getByTestId('badge').textContent).toBe('for');
    expect(screen.getByTestId('children').textContent).toContain('i < 10');
  });

  it('forEach 循环渲染 iterable', () => {
    const data: LoopNodeData = {
      nodeId: 'l2', label: '遍历', note: '', disabled: false, kind: 'loop',
      loopType: 'forEach', condition: '', loopVarName: 'item', loopVarType: 'item',
      iterable: 'itemList', collapsed: false,
    };
    render(<LoopNode data={data} selected={false} />);
    expect(screen.getByTestId('badge').textContent).toBe('forEach');
    expect(screen.getByTestId('children').textContent).toContain('itemList');
  });

  it('while 循环渲染 condition', () => {
    const data: LoopNodeData = {
      nodeId: 'l3', label: 'while', note: '', disabled: false, kind: 'loop',
      loopType: 'while', condition: 'running', loopVarName: '', loopVarType: 'int', collapsed: false,
    };
    render(<LoopNode data={data} selected={false} />);
    expect(screen.getByTestId('badge').textContent).toBe('while');
    expect(screen.getByTestId('children').textContent).toContain('running');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- LoopNode`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 LoopNode.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/nodes/LoopNode.tsx`：

```tsx
import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { LoopNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useDrawerStore } from '../drawer/NodeDetailDrawer.js';

/**
 * 循环节点：for/forEach/while 批量逻辑。
 *
 * 端口：input (in, void), loop_var (out, 随 loopVarType), body (out, void), done (out, void)
 * 颜色：mc-loop
 * 徽章：循环类型（for/forEach/while）
 */
function LoopNodeComponent({ data, selected }: NodeProps<LoopNodeData>) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const node = useNodeGraphStore((s) => s.graph.nodes.find((n) => n.id === data.nodeId));

  return (
    <McNodeShell
      icon="loop"
      title={data.label || '循环'}
      colorClass="mc-loop"
      badge={data.loopType}
      ports={node?.ports ?? []}
      collapsed={data.collapsed}
      selected={selected}
      onToggleCollapse={() => toggleCollapse(data.nodeId)}
      onOpenDrawer={() => openDrawer(data.nodeId)}
    >
      <div className="text-[10px] text-mc-mute">
        {data.loopType === 'for' && (
          <div className="font-mono text-mc-text">
            for ({data.init ?? ''}; {data.condition}; {data.update ?? ''})
          </div>
        )}
        {data.loopType === 'forEach' && (
          <div className="font-mono text-mc-text">
            for ({data.loopVarType} {data.loopVarName} : {data.iterable ?? 'items'})
          </div>
        )}
        {data.loopType === 'while' && (
          <div className="font-mono text-mc-text">while ({data.condition})</div>
        )}
      </div>
    </McNodeShell>
  );
}

export const LoopNode = memo(LoopNodeComponent);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- LoopNode`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/LoopNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/LoopNode.test.tsx
git commit -m "feat(lowcode): add LoopNode component"
```

---

## Task 13: CustomNode.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/nodes/CustomNode.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/nodes/CustomNode.test.tsx`

> 此 Task 须在 Task 11（SubgraphNode）之前或同时完成，因 SubgraphNode import CustomNodeContent。

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/nodes/CustomNode.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CustomNodeContent } from './CustomNode.js';
import { customNodeRegistry } from '../custom/customNodeRegistry.js';
import type { SubgraphNodeData, NodePort } from '@mc-creator/shared';

vi.mock('./base/McNodeShell.js', () => ({
  McNodeShell: ({ title, children }: { title: string; children: React.ReactNode }) => (
    <div data-testid="mc-node-shell"><span data-testid="title">{title}</span><div data-testid="children">{children}</div></div>
  ),
}));

describe('CustomNodeContent', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('schema 已注册时渲染 label + typeId', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter', label: '自定义合成台', description: '3x3', icon: 'crafting-table', color: 'mc-custom',
      ports: [], fields: [], codeTemplate: '',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c1', label: '我的合成台', note: '', disabled: false, kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: 'mymod:crafter', collapsed: false, customFields: {},
    };
    render(<CustomNodeContent data={data} selected={false} ports={[]} />);
    expect(screen.getByTestId('title').textContent).toBe('我的合成台');
    expect(screen.getByTestId('children').textContent).toContain('mymod:crafter');
  });

  it('schema 未注册时显示警告', () => {
    const data: SubgraphNodeData = {
      nodeId: 'c2', label: 'x', note: '', disabled: false, kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: 'unregistered:type', collapsed: false, customFields: {},
    };
    render(<CustomNodeContent data={data} selected={false} ports={[]} />);
    expect(screen.getByTestId('children').textContent).toContain('自定义类型未注册');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- CustomNode`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 CustomNode.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/nodes/CustomNode.tsx`：

```tsx
import { memo } from 'react';
import type { NodePort, SubgraphNodeData } from '@mc-creator/shared';
import { McNodeShell } from './base/McNodeShell.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { useDrawerStore } from '../drawer/NodeDetailDrawer.js';
import { customNodeRegistry } from '../custom/customNodeRegistry.js';

/**
 * 自定义节点内容组件（由 SubgraphNode 在 data.customTypeId 非空时委托渲染）。
 *
 * 不直接注册到 React Flow nodeTypes——数据 kind 仍是 'subgraph'，
 * SubgraphNode 组件做路由。此组件复用 McNodeShell，schema 驱动端口和字段。
 */

interface CustomNodeContentProps {
  data: SubgraphNodeData;
  selected?: boolean;
  ports: NodePort[];
}

function CustomNodeContentComponent({ data, selected, ports }: CustomNodeContentProps) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const schema = data.customTypeId ? customNodeRegistry.get(data.customTypeId) : undefined;

  if (!schema) {
    return (
      <McNodeShell
        icon="custom"
        title={data.label || '自定义节点'}
        colorClass="mc-code"
        ports={ports}
        collapsed={data.collapsed}
        selected={selected}
        errorState="warning"
        onToggleCollapse={() => toggleCollapse(data.nodeId)}
        onOpenDrawer={() => openDrawer(data.nodeId)}
      >
        <div className="text-[10px] text-yellow-400">
          自定义类型未注册：{data.customTypeId}
        </div>
      </McNodeShell>
    );
  }

  return (
    <McNodeShell
      icon={schema.icon || 'custom'}
      title={data.label || schema.label}
      colorClass={schema.color || 'mc-code'}
      badge="custom"
      ports={ports.length > 0 ? ports : schema.ports}
      collapsed={data.collapsed}
      selected={selected}
      onToggleCollapse={() => toggleCollapse(data.nodeId)}
      onOpenDrawer={() => openDrawer(data.nodeId)}
    >
      <div className="text-[10px] text-mc-mute">
        <div className="font-mono text-mc-text">{schema.typeId}</div>
        {schema.description && <div className="text-mc-dim">{schema.description}</div>}
      </div>
    </McNodeShell>
  );
}

export const CustomNodeContent = memo(CustomNodeContentComponent);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- CustomNode`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/CustomNode.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/CustomNode.test.tsx
git commit -m "feat(lowcode): add CustomNodeContent component (schema-driven)"
```

---

## Task 14: SubgraphBoundaryNode.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphBoundaryNode.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphBoundaryNode.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphBoundaryNode.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubgraphBoundaryNode } from './SubgraphBoundaryNode.js';

vi.mock('../nodes/base/McNodeShell.js', () => ({
  McNodeShell: ({ title, badge, ports, children }: { title: string; badge?: string; ports: unknown[]; children: React.ReactNode }) => (
    <div data-testid="mc-node-shell"><span data-testid="title">{title}</span>{badge && <span data-testid="badge">{badge}</span>}<span data-testid="ports-count">{ports.length}</span><div data-testid="children">{children}</div></div>
  ),
}));

describe('SubgraphBoundaryNode', () => {
  it('input 边界节点渲染 badge=in', () => {
    render(<SubgraphBoundaryNode data={{ nodeId: 'b1', label: '输入', note: '', disabled: false, kind: 'comment', text: '', color: 'yellow', boundaryType: 'in', portLabel: '材料', portType: 'item_stack', collapsed: false }} selected={false} />);
    expect(screen.getByTestId('badge').textContent).toBe('in');
    expect(screen.getByTestId('children').textContent).toContain('材料');
  });

  it('output 边界节点渲染 badge=out', () => {
    render(<SubgraphBoundaryNode data={{ nodeId: 'b2', label: '输出', note: '', disabled: false, kind: 'comment', text: '', color: 'yellow', boundaryType: 'out', portLabel: '产物', portType: 'item_stack', collapsed: false }} selected={false} />);
    expect(screen.getByTestId('badge').textContent).toBe('out');
    expect(screen.getByTestId('children').textContent).toContain('产物');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- SubgraphBoundaryNode`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 SubgraphBoundaryNode.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphBoundaryNode.tsx`：

```tsx
import { memo } from 'react';
import type { NodeProps } from 'reactflow';
import type { CommentNodeData, NodePort, PortType } from '@mc-creator/shared';
import { McNodeShell } from '../nodes/base/McNodeShell.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

/**
 * 子图边界节点：定义子图的输入/输出端口。
 *
 * 复用 CommentNodeData（kind: 'comment'）作为数据载体，附加运行时字段
 * boundaryType/portLabel/portType（不进 Zod schema，由 SubgraphEditor 本地管理）。
 * 在子图画布中渲染为入口/出口标记。
 */

export interface SubgraphBoundaryNodeData extends CommentNodeData {
  /** 边界类型：in=子图输入，out=子图输出 */
  boundaryType: 'in' | 'out';
  /** 对外端口标签 */
  portLabel: string;
  /** 对外端口类型 */
  portType: PortType;
}

interface SubgraphBoundaryNodeProps extends NodeProps<SubgraphBoundaryNodeData> {}

function SubgraphBoundaryNodeComponent({ data, selected }: SubgraphBoundaryNodeProps) {
  const toggleCollapse = useNodeGraphStore((s) => s.toggleCollapse);
  const ports: NodePort[] = [
    {
      id: data.boundaryType === 'in' ? 'out' : 'in',
      label: data.portLabel,
      type: data.portType,
      direction: data.boundaryType === 'in' ? 'out' : 'in',
      required: false,
      multiple: data.boundaryType === 'in',
    },
  ];

  return (
    <McNodeShell
      icon="boundary"
      title={data.label || (data.boundaryType === 'in' ? '输入' : '输出')}
      colorClass="mc-subgraph"
      badge={data.boundaryType}
      ports={ports}
      collapsed={data.collapsed}
      selected={selected}
      onToggleCollapse={() => toggleCollapse(data.nodeId)}
      onOpenDrawer={() => {}}
    >
      <div className="text-[10px] text-mc-mute">
        <span className="text-mc-text">{data.portLabel}</span>
        {' : '}
        <span className="text-mc-dim">{data.portType}</span>
      </div>
    </McNodeShell>
  );
}

export const SubgraphBoundaryNode = memo(SubgraphBoundaryNodeComponent);
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- SubgraphBoundaryNode`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphBoundaryNode.tsx apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphBoundaryNode.test.tsx
git commit -m "feat(lowcode): add SubgraphBoundaryNode for subgraph I/O"
```

---

## Task 15: SubgraphEditor.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphEditor.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphEditor.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphEditor.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubgraphEditor } from './SubgraphEditor.js';
import type { SubgraphDefinition } from '@mc-creator/shared';

vi.mock('reactflow', () => ({
  default: ({ children }: { children: React.ReactNode }) => <div data-testid="reactflow">{children}</div>,
  Background: () => <div data-testid="background" />,
  Controls: () => <div data-testid="controls" />,
  MiniMap: () => <div data-testid="minimap" />,
}));

const mockSg: SubgraphDefinition = {
  id: 'sg_1', name: '测试子图', nodes: [], edges: [], portMappings: [],
};

describe('SubgraphEditor', () => {
  it('渲染子图名 + React Flow 画布', () => {
    render(<SubgraphEditor subgraph={mockSg} onChange={() => {}} />);
    expect(screen.getByText('测试子图')).toBeInTheDocument();
    expect(screen.getByTestId('reactflow')).toBeInTheDocument();
  });

  it('渲染边界节点添加按钮', () => {
    render(<SubgraphEditor subgraph={mockSg} onChange={() => {}} />);
    expect(screen.getByText('添加输入边界')).toBeInTheDocument();
    expect(screen.getByText('添加输出边界')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- SubgraphEditor`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 SubgraphEditor.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphEditor.tsx`：

```tsx
import { useCallback, useMemo } from 'react';
import ReactFlow, { Background, BackgroundVariant, Controls, MiniMap, type Node, type Edge } from 'reactflow';
import 'reactflow/dist/style.css';
import type { SubgraphDefinition, ModNode, ModEdge } from '@mc-creator/shared';
import { SubgraphBoundaryNode } from './SubgraphBoundaryNode.js';

interface SubgraphEditorProps {
  /** 编辑的子图定义 */
  subgraph: SubgraphDefinition;
  /** 子图内容变更回调 */
  onChange: (sg: SubgraphDefinition) => void;
}

const subgraphNodeTypes = { boundary: SubgraphBoundaryNode };

/**
 * 子图独立画布：在 SubgraphWorkspace 内渲染，编辑子图内部节点 + 边界节点。
 *
 * 边界节点（type: 'boundary'）定义子图对外端口，保存时映射到 portMappings。
 */
export function SubgraphEditor({ subgraph, onChange }: SubgraphEditorProps) {
  const flowNodes: Node[] = useMemo(() => {
    const inner: Node[] = subgraph.nodes.map((n: ModNode) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: n.data,
      selected: n.selected,
    }));
    const boundaries: Node[] = subgraph.portMappings.map((m) => ({
      id: `boundary_${m.externalPortId}`,
      type: 'boundary',
      position: m.direction === 'in' ? { x: -200, y: 0 } : { x: 200, y: 0 },
      data: {
        nodeId: `boundary_${m.externalPortId}`,
        label: m.label,
        note: '',
        disabled: false,
        kind: 'comment',
        text: '',
        color: 'yellow',
        collapsed: false,
        boundaryType: m.direction,
        portLabel: m.label,
        portType: m.type,
      },
    }));
    return [...inner, ...boundaries];
  }, [subgraph]);

  const flowEdges: Edge[] = useMemo(
    () => subgraph.edges.map((e: ModEdge) => ({
      id: e.id, source: e.source, target: e.target,
      sourceHandle: e.sourceHandle, targetHandle: e.targetHandle,
    })),
    [subgraph],
  );

  const addBoundary = useCallback(
    (direction: 'in' | 'out') => {
      const idx = subgraph.portMappings.length;
      const externalPortId = `${direction}_${idx}`;
      const newMapping = {
        internalPortId: externalPortId,
        externalPortId,
        label: direction === 'in' ? `输入${idx + 1}` : `输出${idx + 1}`,
        direction,
        type: 'item_stack' as const,
      };
      onChange({
        ...subgraph,
        portMappings: [...subgraph.portMappings, newMapping],
      });
    },
    [subgraph, onChange],
  );

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-mc-border px-3 py-1 text-xs text-mc-text">
        子图：{subgraph.name}
        <span className="ml-2 text-mc-mute">({subgraph.nodes.length} 节点)</span>
      </div>
      <div className="flex-1">
        <ReactFlow
          nodes={flowNodes}
          edges={flowEdges}
          nodeTypes={subgraphNodeTypes}
          fitView
        >
          <Background variant={BackgroundVariant.Dots} gap={12} size={1} />
          <Controls />
          <MiniMap />
        </ReactFlow>
      </div>
      <div className="flex gap-2 border-t border-mc-border p-2">
        <button
          type="button"
          onClick={() => addBoundary('in')}
          className="rounded-mc bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text hover:bg-mc-surface-3"
        >
          添加输入边界
        </button>
        <button
          type="button"
          onClick={() => addBoundary('out')}
          className="rounded-mc bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text hover:bg-mc-surface-3"
        >
          添加输出边界
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- SubgraphEditor`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphEditor.tsx apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphEditor.test.tsx
git commit -m "feat(lowcode): add SubgraphEditor canvas with boundary nodes"
```

---

## Task 16: SubgraphWorkspace.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphWorkspace.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphWorkspace.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphWorkspace.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SubgraphWorkspace } from './SubgraphWorkspace.js';

vi.mock('./SubgraphEditor.js', () => ({
  SubgraphEditor: ({ subgraph }: { subgraph: { name: string } }) => (
    <div data-testid="subgraph-editor">{subgraph.name}</div>
  ),
}));
vi.mock('../../store/node-graph-store.js', () => ({
  useNodeGraphStore: (sel: (s: { editingSubgraphId: string | null; setEditingSubgraphId: (id: string|null) => void; graph: { subgraphs: Record<string, { id: string; name: string; nodes: never[]; edges: never[]; portMappings: never[] }> } }) => unknown) =>
    sel({
      editingSubgraphId: 'sg_1',
      setEditingSubgraphId: () => {},
      graph: { subgraphs: { sg_1: { id: 'sg_1', name: '我的子图', nodes: [], edges: [], portMappings: [] } } },
    }),
}));

describe('SubgraphWorkspace', () => {
  it('渲染子图编辑器 + 返回按钮', () => {
    render(<SubgraphWorkspace />);
    expect(screen.getByTestId('subgraph-editor').textContent).toBe('我的子图');
    expect(screen.getByText('返回主图')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- SubgraphWorkspace`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 SubgraphWorkspace.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphWorkspace.tsx`：

```tsx
import { useCallback } from 'react';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { SubgraphEditor } from './SubgraphEditor.js';

/**
 * 子图编辑模式容器：当 editingSubgraphId 非 null 时由 LowcodeWorkspace 渲染，
 * 替代主 NodeGraphEditor。顶栏含子图名 + 返回主图按钮。
 */
export function SubgraphWorkspace() {
  const editingSubgraphId = useNodeGraphStore((s) => s.editingSubgraphId);
  const setEditingSubgraphId = useNodeGraphStore((s) => s.setEditingSubgraphId);
  const sg = useNodeGraphStore((s) =>
    editingSubgraphId ? s.graph.subgraphs[editingSubgraphId] : undefined,
  );

  const handleBack = useCallback(() => {
    setEditingSubgraphId(null);
  }, [setEditingSubgraphId]);

  const handleChange = useCallback(
    (updated: typeof sg) => {
      if (!editingSubgraphId || !updated) return;
      useNodeGraphStore.setState((s) => ({
        graph: {
          ...s.graph,
          subgraphs: { ...s.graph.subgraphs, [editingSubgraphId]: updated },
        },
      }));
    },
    [editingSubgraphId],
  );

  if (!editingSubgraphId || !sg) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-1">
        <button
          type="button"
          onClick={handleBack}
          className="rounded-mc bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text hover:bg-mc-surface-3"
        >
          ← 返回主图
        </button>
        <span className="text-xs text-mc-mute">编辑子图</span>
      </div>
      <div className="flex-1">
        <SubgraphEditor subgraph={sg} onChange={handleChange} />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- SubgraphWorkspace`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphWorkspace.tsx apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphWorkspace.test.tsx
git commit -m "feat(lowcode): add SubgraphWorkspace container with back button"
```

---

## Task 17: mustacheRender.ts

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/custom/mustacheRender.ts`
- Test: `apps/desktop/src/renderer/src/components/lowcode/custom/mustacheRender.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/custom/mustacheRender.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { renderMustache } from './mustacheRender.js';

describe('renderMustache', () => {
  it('替换 {{field:key}} 占位符', () => {
    const result = renderMustache('int {{field:speed}} = 1;', { speed: '50' });
    expect(result).toBe('int 50 = 1;');
  });

  it('多字段替换', () => {
    const result = renderMustache(
      'public class {{field:className}} { int {{field:speed}}; }',
      { className: 'MyBlock', speed: '10' },
    );
    expect(result).toBe('public class MyBlock { int 10; }');
  });

  it('字段值转义 Java 特殊字符（防止注入）', () => {
    const result = renderMustache('String x = "{{field:name}}";', { name: 'a"; evil(); "' });
    // 双引号和反斜杠转义
    expect(result).not.toContain('evil()');
    expect(result).toContain('\\"');
  });

  it('字段缺失保留原占位符', () => {
    const result = renderMustache('{{field:missing}}', {});
    expect(result).toBe('{{field:missing}}');
  });

  it('非字符串字段值转为字符串', () => {
    const result = renderMustache('count = {{field:n}}', { n: 42 });
    expect(result).toBe('count = 42');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- mustacheRender`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 mustacheRender.ts**

创建 `apps/desktop/src/renderer/src/components/lowcode/custom/mustacheRender.ts`：

```ts
/**
 * 轻量 Mustache 渲染（自实现，不引第三方库）
 *
 * 仅支持 {{field:key}} 语法：用 fields[key] 替换占位符。
 * 替换值做 Java 字符串转义（转义双引号、反斜杠、换行），防止代码注入。
 * 字段缺失时保留原占位符（便于用户发现遗漏）。
 */

const FIELD_PATTERN = /\{\{field:([a-zA-Z0-9_]+)\}\}/g;

export function renderMustache(template: string, fields: Record<string, unknown>): string {
  return template.replace(FIELD_PATTERN, (match, key: string) => {
    if (!(key in fields)) return match;
    const raw = fields[key];
    const str = raw === null || raw === undefined ? '' : String(raw);
    return escapeJavaString(str);
  });
}

/** Java 字符串字面量转义（防止字段值注入 Java 代码） */
function escapeJavaString(s: string): string {
  return s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- mustacheRender`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/custom/mustacheRender.ts apps/desktop/src/renderer/src/components/lowcode/custom/mustacheRender.test.ts
git commit -m "feat(lowcode): add lightweight Mustache renderer with Java escaping"
```

---

## Task 18: externalModList.ts

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/custom/externalModList.ts`
- Test: `apps/desktop/src/renderer/src/components/lowcode/custom/externalModList.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/custom/externalModList.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { listExternalMods, getModItems, type ExternalMod } from './externalModList.js';

describe('externalModList', () => {
  const originalMcApi = (window as { mcApi?: unknown }).mcApi;

  beforeEach(() => {
    (window as { mcApi?: unknown }).mcApi = undefined;
  });

  afterEach(() => {
    (window as { mcApi?: unknown }).mcApi = originalMcApi;
  });

  it('window.mcApi 不存在时用 mock 列表', async () => {
    const mods = await listExternalMods();
    expect(mods.length).toBeGreaterThan(0);
    expect(mods.some((m: ExternalMod) => m.namespace === 'minecraft')).toBe(true);
  });

  it('window.mcApi.listInstalledMods 存在时调用真实 API', async () => {
    (window as { mcApi?: unknown }).mcApi = {
      listInstalledMods: vi.fn().mockResolvedValue([
        { namespace: 'create', name: 'Create', version: '0.5.1', installed: true },
      ]),
    };
    const mods = await listExternalMods();
    expect(mods).toHaveLength(1);
    expect(mods[0].namespace).toBe('create');
  });

  it('window.mcApi.listInstalledMods 抛错时回退 mock', async () => {
    (window as { mcApi?: unknown }).mcApi = {
      listInstalledMods: vi.fn().mockRejectedValue(new Error('IPC fail')),
    };
    const mods = await listExternalMods();
    expect(mods.length).toBeGreaterThan(0);
  });

  it('getModItems mock 返回物品列表', async () => {
    const items = await getModItems('minecraft');
    expect(Array.isArray(items)).toBe(true);
    expect(items).toContain('iron_ingot');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- externalModList`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 externalModList.ts**

创建 `apps/desktop/src/renderer/src/components/lowcode/custom/externalModList.ts`：

```ts
/**
 * 外部 mod 列表适配层（不用 ipcClient.invoke）
 *
 * 优先调 window.mcApi?.listInstalledMods?.()（若可用），
 * 否则用 mock 列表兜底。编辑时不阻塞，编译时才检测依赖。
 */

export interface ExternalMod {
  namespace: string;
  name: string;
  version: string;
  installed: boolean;
}

const MOCK_MODS: ExternalMod[] = [
  { namespace: 'minecraft', name: 'Minecraft', version: '1.20.1', installed: true },
  { namespace: 'forge', name: 'Forge API', version: '47.2.0', installed: true },
  { namespace: 'fabric', name: 'Fabric API', version: '0.90.0', installed: true },
  { namespace: 'jei', name: 'Just Enough Items', version: '15.2.0', installed: true },
  { namespace: 'create', name: 'Create', version: '0.5.1', installed: false },
];

const MOCK_ITEMS: Record<string, string[]> = {
  minecraft: ['iron_ingot', 'gold_ingot', 'diamond', 'stick', 'crafting_table'],
  forge: ['forge:energy', 'forge:fluid'],
  fabric: ['fabric:tags'],
  jei: ['jei:tooltip'],
  create: ['create:cogwheel', 'create:shaft', 'create:mechanical_press'],
};

export async function listExternalMods(): Promise<ExternalMod[]> {
  try {
    const api = (window as { mcApi?: { listInstalledMods?: () => Promise<ExternalMod[]> } }).mcApi;
    if (api?.listInstalledMods) {
      const mods = await api.listInstalledMods();
      return mods.length > 0 ? mods : MOCK_MODS;
    }
  } catch {
    // IPC 失败，回退 mock
  }
  return MOCK_MODS;
}

export async function getModItems(namespace: string): Promise<string[]> {
  try {
    const api = (window as { mcApi?: { getModItems?: (ns: string) => Promise<string[]> } }).mcApi;
    if (api?.getModItems) {
      return await api.getModItems(namespace);
    }
  } catch {
    // 回退 mock
  }
  return MOCK_ITEMS[namespace] ?? [];
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- externalModList`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/custom/externalModList.ts apps/desktop/src/renderer/src/components/lowcode/custom/externalModList.test.ts
git commit -m "feat(lowcode): add externalModList adapter with window.mcApi + mock fallback"
```

---

## Task 19: CustomNodeImporter.tsx

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/custom/CustomNodeImporter.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/custom/CustomNodeImporter.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/custom/CustomNodeImporter.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { CustomNodeImporter } from './CustomNodeImporter.js';
import { customNodeRegistry } from './customNodeRegistry.js';

describe('CustomNodeImporter', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('渲染导入按钮 + 隐藏文件输入', () => {
    render(<CustomNodeImporter onClose={() => {}} />);
    expect(screen.getByText('导入自定义节点')).toBeInTheDocument();
    expect(screen.getByTestId('file-input')).toBeInTheDocument();
  });

  it('选择合法 JSON 文件后注册成功并显示提示', async () => {
    const onClose = vi.fn();
    render(<CustomNodeImporter onClose={onClose} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const schema = {
      typeId: 'mymod:test', label: '测试', description: '', icon: '', color: 'mc-code',
      ports: [], fields: [], codeTemplate: '',
    };
    const file = new File([JSON.stringify(schema)], 'test.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(customNodeRegistry.has('mymod:test')).toBe(true);
      expect(screen.getByText(/导入成功/)).toBeInTheDocument();
    });
  });

  it('选择非法 JSON 显示错误', async () => {
    render(<CustomNodeImporter onClose={() => {}} />);
    const input = screen.getByTestId('file-input') as HTMLInputElement;
    const file = new File(['not json'], 'bad.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => {
      expect(screen.getByText(/导入失败/)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- CustomNodeImporter`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 CustomNodeImporter.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/custom/CustomNodeImporter.tsx`：

```tsx
import { useState, useCallback, useRef } from 'react';
import { customNodeRegistry } from './customNodeRegistry.js';

interface CustomNodeImporterProps {
  onClose: () => void;
}

/**
 * 自定义节点 JSON 导入对话框。
 *
 * 用户选择 JSON 文件 → 读取 → customNodeRegistry.importJSON（含 Zod 校验）
 * → 成功显示提示，失败显示错误。
 */
export function CustomNodeImporter({ onClose }: CustomNodeImporterProps) {
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const result = customNodeRegistry.importJSON(text);
      if (result.ok) {
        setMessage({ type: 'success', text: `导入成功：${file.name}` });
      } else {
        setMessage({ type: 'error', text: `导入失败：${result.error}` });
      }
    } catch (err) {
      setMessage({ type: 'error', text: `导入失败：${(err as Error).message}` });
    }
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-labelledby="custom-importer-title"
      onClick={onClose}
    >
      <div
        className="w-[400px] rounded-mc-lg border border-mc-border bg-mc-surface p-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="custom-importer-title" className="mb-3 text-sm font-medium text-mc-text">
          导入自定义节点
        </h2>
        <input
          ref={inputRef}
          data-testid="file-input"
          type="file"
          accept="application/json,.json"
          onChange={handleFile}
          className="mb-3 block w-full text-[11px] text-mc-mute file:mr-2 file:rounded-mc file:border-0 file:bg-mc-surface-2 file:px-2 file:py-1 file:text-[11px] file:text-mc-text"
        />
        {message && (
          <div
            className={`mb-3 rounded-mc px-2 py-1 text-[11px] ${
              message.type === 'success' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-red-500/20 text-red-300'
            }`}
            role="status"
          >
            {message.text}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-mc bg-mc-surface-2 px-3 py-1 text-[11px] text-mc-text hover:bg-mc-surface-3"
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- CustomNodeImporter`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/custom/CustomNodeImporter.tsx apps/desktop/src/renderer/src/components/lowcode/custom/CustomNodeImporter.test.tsx
git commit -m "feat(lowcode): add CustomNodeImporter dialog with JSON validation"
```

---

## Task 20: fieldSchemas.ts 新增 variable/subgraph/loop 字段

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.ts`（Plan A 创建）
- Test: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.test.ts`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { FIELD_SCHEMAS } from './fieldSchemas.js';

describe('FIELD_SCHEMAS（阶段 C 新节点）', () => {
  it('variable 含 varName/varType/value/isConstant 字段', () => {
    const fields = FIELD_SCHEMAS.variable;
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('varName');
    expect(keys).toContain('varType');
    expect(keys).toContain('value');
    expect(keys).toContain('isConstant');
  });

  it('subgraph 含 subgraphName 字段', () => {
    const fields = FIELD_SCHEMAS.subgraph;
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('subgraphName');
  });

  it('loop 含 loopType/condition/loopVarName/loopVarType 字段', () => {
    const fields = FIELD_SCHEMAS.loop;
    const keys = fields.map((f) => f.key);
    expect(keys).toContain('loopType');
    expect(keys).toContain('condition');
    expect(keys).toContain('loopVarName');
    expect(keys).toContain('loopVarType');
  });

  it('loop init/update/iterable 字段有条件显示', () => {
    const fields = FIELD_SCHEMAS.loop;
    const initField = fields.find((f) => f.key === 'init');
    expect(initField?.condition).toBeDefined();
    const iterableField = fields.find((f) => f.key === 'iterable');
    expect(iterableField?.condition).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- fieldSchemas`
Expected: FAIL — FIELD_SCHEMAS 不含 variable/subgraph/loop 键

- [ ] **Step 3: 修改 fieldSchemas.ts**

在 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.ts` 的 `FIELD_SCHEMAS` 对象中追加 3 个新键（保留 Plan A 原有 11 个键不变）：

```ts
import type { NodeKind } from '@mc-creator/shared';
import type { FieldSchema } from './editors/types.js';

export const FIELD_SCHEMAS: Record<NodeKind, FieldSchema[]> = {
  // === Plan A 原 11 个键保持不变 ===
  item: [/* Plan A 内容 */] as FieldSchema[],
  block: [/* Plan A 内容 */] as FieldSchema[],
  entity: [/* Plan A 内容 */] as FieldSchema[],
  recipe: [/* Plan A 内容 */] as FieldSchema[],
  machine: [/* Plan A 内容 */] as FieldSchema[],
  multiblock: [/* Plan A 内容 */] as FieldSchema[],
  event: [/* Plan A 内容 */] as FieldSchema[],
  condition: [/* Plan A 内容 */] as FieldSchema[],
  action: [/* Plan A 内容 */] as FieldSchema[],
  code: [/* Plan A 内容 */] as FieldSchema[],
  comment: [/* Plan A 内容 */] as FieldSchema[],

  // === 阶段 C 新增 3 键 ===
  variable: [
    { key: 'varName', label: '变量名', type: 'text', required: true },
    { key: 'varType', label: '变量类型', type: 'dropdown', required: true,
      options: ['int', 'double', 'string', 'boolean', 'item', 'block'] },
    { key: 'value', label: '初始值', type: 'text' },
    { key: 'isConstant', label: '常量', type: 'segmented', options: ['false', 'true'] },
  ],
  subgraph: [
    { key: 'label', label: '显示名', type: 'text', required: true },
    { key: 'subgraphName', label: '子图名', type: 'text' },
    { key: 'subgraphId', label: '子图 ID', type: 'text' },
  ],
  loop: [
    { key: 'loopType', label: '循环类型', type: 'segmented', required: true,
      options: ['for', 'forEach', 'while'] },
    { key: 'loopVarName', label: '循环变量名', type: 'text' },
    { key: 'loopVarType', label: '循环变量类型', type: 'dropdown',
      options: ['int', 'item', 'block', 'string'] },
    { key: 'init', label: '初始化', type: 'text',
      condition: { field: 'loopType', equals: 'for' } },
    { key: 'condition', label: '条件', type: 'text', required: true },
    { key: 'update', label: '更新', type: 'text',
      condition: { field: 'loopType', equals: 'for' } },
    { key: 'iterable', label: '可迭代对象', type: 'text',
      condition: { field: 'loopType', equals: 'forEach' } },
    { key: 'bodySubgraphId', label: '循环体子图', type: 'noderef' },
  ],
};
```

> 注：`/* Plan A 内容 */` 占位表示 Plan A 已填写的字段数组，Plan C 不改动这些键的内容，只追加 3 个新键。实际实现时保留 Plan A 的原始数组。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- fieldSchemas`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.ts apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/fieldSchemas.test.ts
git commit -m "feat(lowcode): add variable/subgraph/loop field schemas"
```

---

## Task 21: ResourceIdEditor.tsx 外部 mod 命名空间

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.tsx`（Plan A 创建）
- Test: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ResourceIdEditor } from './ResourceIdEditor.js';

describe('ResourceIdEditor 外部 mod 命名空间', () => {
  const originalMcApi = (window as { mcApi?: unknown }).mcApi;

  beforeEach(() => {
    (window as { mcApi?: unknown }).mcApi = undefined;
  });

  afterEach(() => {
    (window as { mcApi?: unknown }).mcApi = originalMcApi;
  });

  it('命名空间下拉含 minecraft + mock 外部 mod', async () => {
    render(<ResourceIdEditor value="minecraft:iron_ingot" onChange={() => {}} schema={{ key: 'id', label: 'ID', type: 'resourceId' }} graph={{ version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], subgraphs: {} }} />);
    await waitFor(() => {
      expect(screen.getByTestId('namespace-select')).toBeInTheDocument();
    });
    const select = screen.getByTestId('namespace-select') as HTMLSelectElement;
    expect(select.innerHTML).toContain('minecraft');
    expect(select.innerHTML).toContain('create');
  });

  it('切换命名空间更新 value', async () => {
    let value = 'minecraft:iron_ingot';
    render(<ResourceIdEditor value={value} onChange={(v) => { value = v; }} schema={{ key: 'id', label: 'ID', type: 'resourceId' }} graph={{ version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [], edges: [], subgraphs: {} }} />);
    await waitFor(() => {
      expect(screen.getByTestId('namespace-select')).toBeInTheDocument();
    });
    fireEvent.change(screen.getByTestId('namespace-select'), { target: { value: 'create' } });
    expect(value.startsWith('create:')).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- ResourceIdEditor`
Expected: FAIL — 命名空间下拉未含外部 mod

- [ ] **Step 3: 修改 ResourceIdEditor.tsx**

修改 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.tsx`，增加外部 mod 命名空间加载。完整新组件（替换 Plan A 原有实现，保留原有校验逻辑）：

```tsx
import { useEffect, useState, useCallback } from 'react';
import type { FieldSchema, EditorProps } from './types.js';
import type { NodeGraph } from '@mc-creator/shared';
import { listExternalMods, type ExternalMod } from '../../custom/externalModList.js';

const RESOURCE_ID_RE = /^[a-z0-9_]+:[a-z0-9_/]+$/;

export function ResourceIdEditor({ value, onChange, error }: EditorProps<string>) {
  const [mods, setMods] = useState<ExternalMod[]>([
    { namespace: 'minecraft', name: 'Minecraft', version: '', installed: true },
  ]);
  const [modId, setModId] = useState('minecraft');

  useEffect(() => {
    let mounted = true;
    listExternalMods().then((m) => {
      if (mounted) setMods(m);
    });
    return () => { mounted = false; };
  }, []);

  const [ns, path] = (value || '').split(':');
  const currentNs = ns || modId;
  const currentPath = path || '';

  const handleNsChange = useCallback((newNs: string) => {
    setModId(newNs);
    onChange(`${newNs}:${currentPath}`);
  }, [currentPath, onChange]);

  const handlePathChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(`${currentNs}:${e.target.value}`);
  }, [currentNs, onChange]);

  const valid = RESOURCE_ID_RE.test(value || '');

  return (
    <div className="flex flex-col gap-1">
      <div className="flex gap-1">
        <select
          data-testid="namespace-select"
          value={currentNs}
          onChange={(e) => handleNsChange(e.target.value)}
          className="rounded-mc border border-mc-border bg-mc-surface px-1 py-0.5 text-[11px] text-mc-text"
        >
          {mods.map((m) => (
            <option key={m.namespace} value={m.namespace}>
              {m.namespace}{m.installed ? '' : ' (未安装)'}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={currentPath}
          onChange={handlePathChange}
          placeholder="path（如 iron_sword）"
          className={`flex-1 rounded-mc border bg-mc-surface px-2 py-0.5 text-[11px] text-mc-text outline-none ${valid ? 'border-mc-border' : 'border-red-500'}`}
        />
      </div>
      {!valid && value && (
        <div className="text-[10px] text-red-400">应为 modid:path 格式（全小写+下划线）</div>
      )}
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- ResourceIdEditor`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/ResourceIdEditor.test.tsx
git commit -m "feat(lowcode): add external mod namespace to ResourceIdEditor"
```

---

## Task 22: NodeRefEditor.tsx 变量引用

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.tsx`（Plan A 创建）
- Test: `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { NodeRefEditor } from './NodeRefEditor.js';

const graph = {
  version: 1 as const, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
  nodes: [
    { id: 'v1', type: 'variable', position: { x: 0, y: 0 }, data: { nodeId: 'v1', label: '最大伤害', note: '', disabled: false, kind: 'variable', varName: 'MAX_DAMAGE', varType: 'int', value: 10, isConstant: true, collapsed: false }, ports: [], selected: false },
    { id: 'i1', type: 'item', position: { x: 0, y: 0 }, data: { nodeId: 'i1', label: '铁剑', note: '', disabled: false, kind: 'item', itemId: 'iron_sword', displayName: '铁剑', category: 'sword', maxStackSize: 1, maxDamage: 250, rarity: 'common', glow: false, collapsed: false }, ports: [], selected: false },
  ],
  edges: [], subgraphs: {},
};

describe('NodeRefEditor 变量引用', () => {
  it('schema.dataType 指定类型时列出匹配的变量节点', () => {
    render(<NodeRefEditor value="" onChange={() => {}} schema={{ key: 'dmg', label: '伤害', type: 'noderef', dataType: 'integer' }} graph={graph} />);
    const select = screen.getByTestId('noderef-select') as HTMLSelectElement;
    expect(select.innerHTML).toContain('MAX_DAMAGE');
  });

  it('未指定 dataType 时列出所有节点', () => {
    render(<NodeRefEditor value="" onChange={() => {}} schema={{ key: 'ref', label: '引用', type: 'noderef' }} graph={graph} />);
    const select = screen.getByTestId('noderef-select') as HTMLSelectElement;
    expect(select.innerHTML).toContain('铁剑');
    expect(select.innerHTML).toContain('MAX_DAMAGE');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- NodeRefEditor`
Expected: FAIL — NodeRefEditor 未过滤变量节点

- [ ] **Step 3: 修改 NodeRefEditor.tsx**

修改 `apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.tsx`，增加变量节点过滤。完整新组件：

```tsx
import { useCallback, useMemo } from 'react';
import type { EditorProps } from './types.js';
import type { NodeGraph, NodeData, VariableNodeData, PortType } from '@mc-creator/shared';

/** varType → PortType 映射（用于按 dataType 过滤变量节点） */
function varTypeToPortType(varType: VariableNodeData['varType']): PortType {
  switch (varType) {
    case 'int': return 'integer';
    case 'double': return 'number';
    case 'string': return 'string';
    case 'boolean': return 'boolean';
    case 'item': return 'item_stack';
    case 'block': return 'block_state';
  }
}

export function NodeRefEditor({ value, onChange, schema, graph, error }: EditorProps<string>) {
  const options = useMemo(() => {
    const dataType = schema.dataType;
    return graph.nodes
      .filter((n) => {
        if (!dataType) return true;
        if (n.data.kind === 'variable') {
          return varTypeToPortType(n.data.varType) === dataType;
        }
        // 非变量节点：按端口类型匹配（简化：item 节点匹配 item_stack）
        return true;
      })
      .map((n) => ({
        id: n.id,
        label: n.data.label || (n.data.kind === 'variable' ? n.data.varName : n.id),
        kind: n.data.kind,
      }));
  }, [graph.nodes, schema.dataType]);

  const handleChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  }, [onChange]);

  return (
    <div className="flex flex-col gap-1">
      <select
        data-testid="noderef-select"
        value={value || ''}
        onChange={handleChange}
        className="rounded-mc border border-mc-border bg-mc-surface px-2 py-0.5 text-[11px] text-mc-text"
      >
        <option value="">（未选择）</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label} ({o.kind})
          </option>
        ))}
      </select>
      {error && <div className="text-[10px] text-red-400">{error}</div>}
    </div>
  );
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- NodeRefEditor`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.tsx apps/desktop/src/renderer/src/components/lowcode/nodes/drawer/editors/NodeRefEditor.test.tsx
git commit -m "feat(lowcode): add variable node filtering to NodeRefEditor"
```

---

## Task 23: CodeNodeEditor.tsx import 快捷插入

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/CodeNodeEditor.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/CodeNodeEditor.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/components/lowcode/CodeNodeEditor.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CodeNodeEditor } from './CodeNodeEditor.js';

// 复用现有测试的 mock 模式
vi.mock('@monaco-editor/react', () => ({
  default: ({ value, onChange }: { value: string; onChange: (v: string) => void }) => (
    <textarea data-testid="monaco" value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

describe('CodeNodeEditor import 快捷插入', () => {
  it('渲染 import 快捷插入按钮区域', () => {
    const store = useNodeGraphStore.getState();
    const id = store.addNode('code', { x: 0, y: 0 });
    render(<CodeNodeEditor nodeId={id} onClose={() => {}} />);
    expect(screen.getByText('import 快捷插入')).toBeInTheDocument();
    expect(screen.getByText('Forge API')).toBeInTheDocument();
  });

  it('点击 Forge API 按钮插入 import 到代码顶部', () => {
    const store = useNodeGraphStore.getState();
    const id = store.addNode('code', { x: 0, y: 0 });
    render(<CodeNodeEditor nodeId={id} onClose={() => {}} />);
    fireEvent.click(screen.getByText('Forge API'));
    const node = useNodeGraphStore.getState().graph.nodes.find((n) => n.id === id)!;
    if (node.data.kind === 'code') {
      expect(node.data.code).toContain('import net.minecraftforge');
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- CodeNodeEditor`
Expected: FAIL — import 快捷插入按钮不存在

- [ ] **Step 3: 修改 CodeNodeEditor.tsx**

在 `apps/desktop/src/renderer/src/components/lowcode/CodeNodeEditor.tsx` 的 Monaco 编辑器区域上方插入 import 快捷插入按钮。在 `import` 区追加常量，在 Monaco `<Editor>` 之前插入按钮栏。

在文件顶部 import 区后追加 `PRESET_IMPORTS` 常量：

```ts
/** 预置 import 快捷插入（不动态调 IPC，用静态映射） */
const PRESET_IMPORTS: { label: string; importLine: string }[] = [
  { label: 'Forge API', importLine: 'import net.minecraftforge.eventbus.api.SubscribeEvent;\nimport net.minecraftforge.fml.common.Mod;' },
  { label: 'Fabric API', importLine: 'import net.fabricmc.fabric.api.event.EventFactory;\nimport net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents;' },
  { label: 'JEI', importLine: 'import mezz.jei.api.IModPlugin;\nimport mezz.jei.api.JeiPlugin;' },
  { label: 'Create', importLine: 'import com.simibubi.create.content.contrast.Contrast;' },
];
```

在 Monaco `<Editor>` 组件之前（`<div className="flex-1 overflow-hidden" ...>` 内部最前面）插入 import 按钮栏：

```tsx
{/* import 快捷插入按钮栏（阶段 C 外部 mod API 增强） */}
<div className="flex items-center gap-1 border-b border-mc-border bg-mc-surface-2 px-4 py-1">
  <span className="text-[10px] text-mc-dim">import 快捷插入：</span>
  {PRESET_IMPORTS.map((p) => (
    <button
      key={p.label}
      type="button"
      onClick={() => {
        const newCode = `${p.importLine}\n\n${code}`;
        setCode(newCode);
        syncToStore({ code: newCode });
      }}
      className="rounded-mc bg-mc-surface px-2 py-0.5 text-[10px] text-mc-text hover:bg-mc-surface-3"
    >
      {p.label}
    </button>
  ))}
</div>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- CodeNodeEditor`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/CodeNodeEditor.tsx apps/desktop/src/renderer/src/components/lowcode/CodeNodeEditor.test.tsx
git commit -m "feat(lowcode): add preset import quick-insert to CodeNodeEditor"
```

---

## Task 24: nodes/index.ts 注册 3 新节点 + NODE_METADATA

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/nodes/index.ts`
- Test: 无（由 Task 25 NodePalette 集成覆盖）

> 注：只注册 variable/subgraph/loop 三个 React Flow type。CustomNode 不单独注册（SubgraphNode 路由到 CustomNodeContent）。

- [ ] **Step 1: 写失败测试**

创建临时验证 `apps/desktop/src/renderer/src/components/lowcode/nodes/index.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { nodeTypes, NODE_METADATA, NODE_CATEGORIES } from './index.js';

describe('nodes/index（阶段 C 注册）', () => {
  it('nodeTypes 含 variable/subgraph/loop', () => {
    expect(nodeTypes.variable).toBeDefined();
    expect(nodeTypes.subgraph).toBeDefined();
    expect(nodeTypes.loop).toBeDefined();
  });

  it('NODE_METADATA 含 variable/subgraph/loop，category=advanced', () => {
    const kinds = NODE_METADATA.map((m) => m.kind);
    expect(kinds).toContain('variable');
    expect(kinds).toContain('subgraph');
    expect(kinds).toContain('loop');
    expect(NODE_METADATA.find((m) => m.kind === 'variable')?.category).toBe('advanced');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- nodes/index`
Expected: FAIL — variable/subgraph/loop 未注册

- [ ] **Step 3: 修改 nodes/index.ts**

修改 `apps/desktop/src/renderer/src/components/lowcode/nodes/index.ts`，追加 3 个 import + 3 个 nodeTypes + 3 个 NODE_METADATA：

```ts
import type { NodeKind } from '@mc-creator/shared';
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
import { VariableNode } from './VariableNode.js';
import { SubgraphNode } from './SubgraphNode.js';
import { LoopNode } from './LoopNode.js';

export const nodeTypes = {
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
  // 阶段 C 新增
  variable: VariableNode,
  subgraph: SubgraphNode,
  loop: LoopNode,
} as const;

export type NodeTypeRegistry = typeof nodeTypes;

export interface NodeMeta {
  kind: NodeKind;
  label: string;
  description: string;
  icon: string;
  category: 'content' | 'logic' | 'advanced';
  color: string;
}

export const NODE_METADATA: NodeMeta[] = [
  // ... 原 11 项保持不变 ...
  // 阶段 C 新增
  {
    kind: 'variable',
    label: '变量',
    description: '全局变量/常量，可被其他节点引用',
    icon: 'variable',
    category: 'advanced',
    color: 'cyan',
  },
  {
    kind: 'subgraph',
    label: '子图',
    description: '封装复用子图，支持嵌套',
    icon: 'subgraph',
    category: 'advanced',
    color: 'violet',
  },
  {
    kind: 'loop',
    label: '循环',
    description: 'for/forEach/while 批量逻辑',
    icon: 'loop',
    category: 'advanced',
    color: 'emerald',
  },
];

export const NODE_CATEGORIES: { id: NodeMeta['category']; label: string }[] = [
  { id: 'content', label: '内容节点' },
  { id: 'logic', label: '逻辑节点' },
  { id: 'advanced', label: '高级节点' },
];
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- nodes/index`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/nodes/index.ts apps/desktop/src/renderer/src/components/lowcode/nodes/index.test.ts
git commit -m "feat(lowcode): register variable/subgraph/loop node types"
```

---

## Task 25: NodePalette.tsx 高级分类 + 自定义节点导入

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/NodePalette.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/components/lowcode/NodePalette.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette.js';
import { customNodeRegistry } from './custom/customNodeRegistry.js';

vi.mock('../../store/node-graph-store.js', () => ({
  useNodeGraphStore: () => ({ addNode: vi.fn(), commit: vi.fn(), loadGraph: vi.fn() }),
}));

describe('NodePalette 阶段 C', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('高级分类含变量/子图/循环节点', () => {
    render(<NodePalette />);
    expect(screen.getByText('变量')).toBeInTheDocument();
    expect(screen.getByText('子图')).toBeInTheDocument();
    expect(screen.getByText('循环')).toBeInTheDocument();
  });

  it('渲染「导入自定义节点」按钮', () => {
    render(<NodePalette />);
    expect(screen.getByText('导入自定义节点')).toBeInTheDocument();
  });

  it('点击导入按钮打开 CustomNodeImporter 对话框', () => {
    render(<NodePalette />);
    fireEvent.click(screen.getByText('导入自定义节点'));
    // CustomNodeImporter 对话框标题
    expect(screen.getByText('导入自定义节点', { selector: 'h2' })).toBeInTheDocument();
  });

  it('注册自定义节点后显示在「自定义节点」分区', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter', label: '合成台', description: '', icon: '', color: 'mc-code',
      ports: [], fields: [], codeTemplate: '',
    });
    render(<NodePalette />);
    expect(screen.getByText('合成台')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- NodePalette`
Expected: FAIL — 变量/子图/循环节点未显示，导入按钮不存在

- [ ] **Step 3: 修改 NodePalette.tsx**

修改 `apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx`，在顶部 import 区追加：

```ts
import { useState, memo, useCallback } from 'react';
import type { NodeKind } from '@mc-creator/shared';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { NODE_METADATA, NODE_CATEGORIES, type NodeMeta } from './nodes/index.js';
import {
  NODE_GRAPH_TEMPLATES,
  TEMPLATE_CATEGORIES,
  type NodeGraphTemplate,
} from '../../lib/nodeGraphTemplates.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';
import { customNodeRegistry } from './custom/customNodeRegistry.js';
import { CustomNodeImporter } from './custom/CustomNodeImporter.js';
```

在 `NodePaletteComponent` 函数体顶部追加 import dialog 状态：

```ts
function NodePaletteComponent({ onNodeDragStart, onNodeClick, disableCodeNode, onTemplateClick }: NodePaletteProps) {
  const [search, setSearch] = useState('');
  const [showImporter, setShowImporter] = useState(false);
  const [customNodes] = useState(() => customNodeRegistry.list());
  const addCustomNode = useNodeGraphStore((s) => s.addCustomNode);
```

在模板区域之前插入「导入自定义节点」按钮 + 自定义节点列表分区：

```tsx
{/* 自定义节点分区（阶段 C） */}
<div className="border-t border-mc-border p-2" role="group" aria-label="自定义节点">
  <div className="mb-1 flex items-center justify-between">
    <div className="text-[10px] font-semibold uppercase tracking-wider text-mc-mute">
      🧩 自定义节点
    </div>
    <button
      type="button"
      onClick={() => setShowImporter(true)}
      className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-text hover:bg-mc-surface-3"
    >
      导入自定义节点
    </button>
  </div>
  {customNodes.length === 0 ? (
    <div className="text-[10px] text-mc-dim">未导入自定义节点</div>
  ) : (
    <div className="grid grid-cols-1 gap-1">
      {customNodes.map((schema) => (
        <button
          key={schema.typeId}
          type="button"
          draggable
          onDragStart={(e) => {
            e.dataTransfer.setData('application/custom-node-typeid', schema.typeId);
            e.dataTransfer.effectAllowed = 'move';
          }}
          onClick={() => addCustomNode(schema.typeId, { x: 100, y: 100 })}
          className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1.5 text-left text-xs text-mc-text hover:border-mc-accent"
        >
          <McIcon scope="pixel" name={schema.icon || 'custom'} size={14} aria-hidden="true" />
          <div className="flex-1">
            <div className="font-medium text-mc-text">{schema.label}</div>
            <div className="truncate text-[10px] text-mc-mute">{schema.typeId}</div>
          </div>
        </button>
      ))}
    </div>
  )}
</div>
{showImporter && (
  <CustomNodeImporter onClose={() => setShowImporter(false)} />
)}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- NodePalette`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx apps/desktop/src/renderer/src/components/lowcode/NodePalette.test.tsx
git commit -m "feat(lowcode): add advanced category + custom node import to NodePalette"
```

---

## Task 26: NodeGraphEditor.tsx 右键封装子图

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodeGraphEditor } from './NodeGraphEditor.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

vi.mock('reactflow', () => ({
  default: ({ onPaneContextMenu, onNodeContextMenu }: { onPaneContextMenu?: (e: React.MouseEvent) => void; onNodeContextMenu?: (e: React.MouseEvent) => void }) => (
    <div data-testid="reactflow" onContextMenu={(e) => { e.preventDefault(); onNodeContextMenu?.(e); }} />
  ),
  Background: () => null, Controls: () => null, MiniMap: () => null, MarkerType: {},
}));

describe('NodeGraphEditor 右键封装子图', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({ graph: { ...useNodeGraphStore.getState().graph, modId: 'test' } });
  });

  it('右键节点弹出菜单含「封装为子图」', () => {
    const id1 = useNodeGraphStore.getState().addNode('item', { x: 0, y: 0 });
    useNodeGraphStore.getState().addNode('item', { x: 100, y: 0 });
    render(<NodeGraphEditor readOnly={false} />);
    fireEvent.contextMenu(screen.getByTestId('reactflow'));
    expect(screen.getByText('封装为子图')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- NodeGraphEditor`
Expected: FAIL — 右键菜单不含「封装为子图」

- [ ] **Step 3: 修改 NodeGraphEditor.tsx**

在 `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx` 中追加右键菜单状态 + `onNodeContextMenu` 处理。在组件函数体顶部追加：

```ts
const [contextMenu, setContextMenu] = useState<{ x: number; y: number; visible: boolean } | null>(null);
const encapsulateSubgraph = useNodeGraphStore((s) => s.encapsulateSubgraph);
const selectedNodes = useNodeGraphStore((s) => s.graph.nodes.filter((n) => n.selected));

const handleNodeContextMenu = useCallback((e: React.MouseEvent) => {
  e.preventDefault();
  setContextMenu({ x: e.clientX, y: e.clientY, visible: true });
}, []);

const handleEncapsulate = useCallback(() => {
  const ids = selectedNodes.map((n) => n.id);
  if (ids.length === 0) return;
  const name = window.prompt('输入子图名称：', '新子图');
  if (!name) return;
  encapsulateSubgraph(ids, name);
  setContextMenu(null);
}, [selectedNodes, encapsulateSubgraph]);
```

在 `<ReactFlow>` 组件上追加 `onNodeContextMenu={handleNodeContextMenu}` 属性。

在组件返回的 JSX 末尾（`</ReactFlow>` 之后）追加右键菜单：

```tsx
{contextMenu?.visible && (
  <div
    className="fixed z-50 rounded-mc border border-mc-border bg-mc-surface py-1 shadow-lg"
    style={{ left: contextMenu.x, top: contextMenu.y }}
  >
    <button
      type="button"
      onClick={handleEncapsulate}
      disabled={selectedNodes.length === 0}
      className="block w-full px-3 py-1 text-left text-[11px] text-mc-text hover:bg-mc-surface-2 disabled:opacity-40"
    >
      封装为子图{selectedNodes.length > 0 ? `（${selectedNodes.length} 节点）` : '（需先选中节点）'}
    </button>
  </div>
)}
```

在顶部 import 区追加 `useState` 和 `useCallback`（若未导入）。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- NodeGraphEditor`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.test.tsx
git commit -m "feat(lowcode): add right-click encapsulate-subgraph menu"
```

---

## Task 27: LowcodeWorkspace.tsx SubgraphWorkspace 集成

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.test.tsx`（追加）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LowcodeWorkspace } from './LowcodeWorkspace.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

vi.mock('./NodeGraphEditor.js', () => ({
  NodeGraphEditor: () => <div data-testid="main-editor" />,
}));
vi.mock('./subgraph/SubgraphWorkspace.js', () => ({
  SubgraphWorkspace: () => <div data-testid="subgraph-workspace" />,
}));

describe('LowcodeWorkspace SubgraphWorkspace 集成', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('editingSubgraphId 为 null 时显示主编辑器', () => {
    useNodeGraphStore.setState({ editingSubgraphId: null });
    render(<LowcodeWorkspace />);
    expect(screen.getByTestId('main-editor')).toBeInTheDocument();
    expect(screen.queryByTestId('subgraph-workspace')).toBeNull();
  });

  it('editingSubgraphId 非 null 时显示 SubgraphWorkspace', () => {
    useNodeGraphStore.setState({ editingSubgraphId: 'sg_1' });
    render(<LowcodeWorkspace />);
    expect(screen.getByTestId('subgraph-workspace')).toBeInTheDocument();
    expect(screen.queryByTestId('main-editor')).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- LowcodeWorkspace`
Expected: FAIL — SubgraphWorkspace 未集成

- [ ] **Step 3: 修改 LowcodeWorkspace.tsx**

在 `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx` 顶部 import 区追加：

```ts
import { SubgraphWorkspace } from './subgraph/SubgraphWorkspace.js';
```

在组件函数体中读取 `editingSubgraphId`：

```ts
const editingSubgraphId = useNodeGraphStore((s) => s.editingSubgraphId);
```

在主画布 `<NodeGraphEditor />` 渲染处改为条件渲染（editingSubgraphId 非 null 时渲染 SubgraphWorkspace 替代主画布）：

```tsx
{/* 阶段 C：编辑子图时用 SubgraphWorkspace 替代主画布 */}
{editingSubgraphId ? (
  <SubgraphWorkspace />
) : (
  <NodeGraphEditor readOnly={readOnly} />
)}
```

> 注：节点库（NodePalette）和抽屉（NodeDetailDrawer）保持显示，只有中间画布区切换。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- LowcodeWorkspace`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.test.tsx
git commit -m "feat(lowcode): integrate SubgraphWorkspace into LowcodeWorkspace"
```

---

## Task 28: compileVariable.ts

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/compileVariable.ts`
- Test: `apps/desktop/src/renderer/src/lib/compileVariable.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/lib/compileVariable.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { compileVariable } from './compileVariable.js';
import type { VariableNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

describe('compileVariable', () => {
  it('常量 int 编译为 static final 字段', () => {
    const data: VariableNodeData = {
      nodeId: 'v1', label: '最大伤害', note: '', disabled: false, kind: 'variable',
      varName: 'MAX_DAMAGE', varType: 'int', value: 10, isConstant: true, collapsed: false,
    };
    const { snippet, varName } = compileVariable(data);
    expect(varName).toBe('MAX_DAMAGE');
    expect(snippet.snippetId).toBe('v1');
    expect(snippet.language).toBe('java');
    expect(snippet.code).toContain('public static final int MAX_DAMAGE = 10;');
    expect(snippet.methodName).toBe('MAX_DAMAGE');
  });

  it('变量 string 编译为实例字段', () => {
    const data: VariableNodeData = {
      nodeId: 'v2', label: '玩家名', note: '', disabled: false, kind: 'variable',
      varName: 'playerName', varType: 'string', value: 'Steve', isConstant: false, collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('public String playerName = "Steve";');
    expect(snippet.code).not.toContain('static final');
  });

  it('boolean 编译', () => {
    const data: VariableNodeData = {
      nodeId: 'v3', label: 'x', note: '', disabled: false, kind: 'variable',
      varName: 'enabled', varType: 'boolean', value: true, isConstant: true, collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('public static final boolean enabled = true;');
  });

  it('item 类型编译为 ItemStack 引用', () => {
    const data: VariableNodeData = {
      nodeId: 'v4', label: 'x', note: '', disabled: false, kind: 'variable',
      varName: 'defaultItem', varType: 'item', value: 'iron_sword', isConstant: false, collapsed: false,
    };
    const { snippet } = compileVariable(data);
    expect(snippet.code).toContain('ItemStack');
    expect(snippet.code).toContain('iron_sword');
  });

  it('返回类型是 CustomCodeSnippetSpec', () => {
    const data: VariableNodeData = {
      nodeId: 'v5', label: 'x', note: '', disabled: false, kind: 'variable',
      varName: 'x', varType: 'int', value: 0, isConstant: false, collapsed: false,
    };
    const { snippet } = compileVariable(data);
    const _: CustomCodeSnippetSpec = snippet;
    expect(_.snippetId).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- compileVariable`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 compileVariable.ts**

创建 `apps/desktop/src/renderer/src/lib/compileVariable.ts`：

```ts
import type { VariableNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

/**
 * 编译变量节点为 Java 字段声明，包装为 CustomCodeSnippetSpec。
 *
 * - isConstant=true → public static final
 * - isConstant=false → public 实例字段
 * - item/block 类型用 ItemStack/BlockState 引用
 *
 * 返回 { snippet, varName }，由 compileNodeGraph push 到 customCode 数组。
 */
export function compileVariable(data: VariableNodeData): { snippet: CustomCodeSnippetSpec; varName: string } {
  const javaType = varTypeToJava(data.varType);
  const javaValue = formatValue(data.value, data.varType);
  const modifier = data.isConstant ? 'public static final' : 'public';
  const code = `${modifier} ${javaType} ${data.varName} = ${javaValue};`;

  return {
    snippet: {
      snippetId: data.nodeId,
      language: 'java',
      code,
      inputSignature: {},
      outputSignature: {},
      methodName: data.varName,
    },
    varName: data.varName,
  };
}

function varTypeToJava(varType: VariableNodeData['varType']): string {
  switch (varType) {
    case 'int': return 'int';
    case 'double': return 'double';
    case 'string': return 'String';
    case 'boolean': return 'boolean';
    case 'item': return 'ItemStack';
    case 'block': return 'BlockState';
  }
}

function formatValue(value: unknown, varType: VariableNodeData['varType']): string {
  switch (varType) {
    case 'int':
      return String(Number(value) || 0);
    case 'double':
      return `${Number(value) || 0.0}`;
    case 'string':
      return `"${String(value).replace(/"/g, '\\"')}"`;
    case 'boolean':
      return value ? 'true' : 'false';
    case 'item':
      return `new ItemStack(Items.${String(value).toUpperCase()})`;
    case 'block':
      return `Blocks.${String(value).toUpperCase()}.defaultBlockState()`;
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- compileVariable`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/compileVariable.ts apps/desktop/src/renderer/src/lib/compileVariable.test.ts
git commit -m "feat(lowcode): add compileVariable (variable → Java field snippet)"
```

---

## Task 29: compileSubgraph.ts

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/compileSubgraph.ts`
- Test: `apps/desktop/src/renderer/src/lib/compileSubgraph.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/lib/compileSubgraph.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { inlineSubgraphNodes } from './compileSubgraph.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import type { NodeGraph, SubgraphDefinition, ModNode } from '@mc-creator/shared';

function makeItem(id: string): ModNode {
  return {
    id, type: 'item', position: { x: 0, y: 0 },
    data: { nodeId: id, label: id, note: '', disabled: false, kind: 'item', itemId: id, displayName: id, category: 'misc', maxStackSize: 64, maxDamage: 0, rarity: 'common', glow: false, collapsed: false },
    ports: [], selected: false,
  };
}

describe('inlineSubgraphNodes', () => {
  beforeEach(() => {
    subgraphManager.clear();
  });

  it('返回 { graph, warnings }（不是交叉类型）', () => {
    const graph: NodeGraph = {
      version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [], edges: [], subgraphs: {},
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    expect(result).toHaveProperty('graph');
    expect(result).toHaveProperty('warnings');
    expect(Array.isArray(result.warnings)).toBe(true);
  });

  it('无子图节点时原样返回', () => {
    const graph: NodeGraph = {
      version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeItem('i1')], edges: [], subgraphs: {},
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    expect(result.graph.nodes).toHaveLength(1);
    expect(result.warnings).toHaveLength(0);
  });

  it('把子图节点内联展开为内部节点', () => {
    const innerSg: SubgraphDefinition = {
      id: 'sg_1', name: '内层', nodes: [makeItem('inner_1')], edges: [], portMappings: [],
    };
    subgraphManager.register(innerSg);
    const sgNode: ModNode = {
      id: 's1', type: 'subgraph', position: { x: 0, y: 0 },
      data: { nodeId: 's1', label: '子图', note: '', disabled: false, kind: 'subgraph', subgraphId: 'sg_1', subgraphName: '内层', customTypeId: null, customFields: {}, collapsed: false },
      ports: [], selected: false,
    };
    const graph: NodeGraph = {
      version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode], edges: [], subgraphs: { sg_1: innerSg },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    // 子图节点被替换为内部节点
    expect(result.graph.nodes.some((n) => n.id.startsWith('inner_1'))).toBe(true);
    expect(result.graph.nodes.find((n) => n.id === 's1')).toBeUndefined();
  });

  it('子图未找到时加 warning，保留原节点', () => {
    const sgNode: ModNode = {
      id: 's1', type: 'subgraph', position: { x: 0, y: 0 },
      data: { nodeId: 's1', label: 'x', note: '', disabled: false, kind: 'subgraph', subgraphId: 'missing', subgraphName: '', customTypeId: null, customFields: {}, collapsed: false },
      ports: [], selected: false,
    };
    const graph: NodeGraph = {
      version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode], edges: [], subgraphs: {},
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.graph.nodes).toHaveLength(1);
  });

  it('循环引用检测：子图引用自身时加 warning 不递归', () => {
    const sgDef: SubgraphDefinition = {
      id: 'sg_self', name: '自引用', nodes: [], edges: [],
      portMappings: [],
    };
    // 构造 sg_self 内部有一个 subgraph 节点引用 sg_self
    sgDef.nodes = [{
      id: 'inner_sg', type: 'subgraph', position: { x: 0, y: 0 },
      data: { nodeId: 'inner_sg', label: 'inner', note: '', disabled: false, kind: 'subgraph', subgraphId: 'sg_self', subgraphName: '', customTypeId: null, customFields: {}, collapsed: false },
      ports: [], selected: false,
    }];
    subgraphManager.register(sgDef);
    const sgNode: ModNode = {
      id: 's1', type: 'subgraph', position: { x: 0, y: 0 },
      data: { nodeId: 's1', label: 'x', note: '', disabled: false, kind: 'subgraph', subgraphId: 'sg_self', subgraphName: '', customTypeId: null, customFields: {}, collapsed: false },
      ports: [], selected: false,
    };
    const graph: NodeGraph = {
      version: 1, modId: 'test', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode], edges: [], subgraphs: { sg_self: sgDef },
    };
    const result = inlineSubgraphNodes(graph, subgraphManager);
    expect(result.warnings.some((w) => w.includes('循环引用') || w.includes('cycle'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- compileSubgraph`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 compileSubgraph.ts**

创建 `apps/desktop/src/renderer/src/lib/compileSubgraph.ts`：

```ts
import type { NodeGraph, ModNode, SubgraphDefinition } from '@mc-creator/shared';
import type { SubgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';

/**
 * 子图内联展开：把主图中的 subgraph 节点替换为其引用的子图内部节点。
 *
 * 返回 { graph: NodeGraph; warnings: string[] }（不是交叉类型）。
 * - 子图未找到：加 warning，保留原节点
 * - 循环引用（DFS visited 检测）：加 warning，不递归展开
 * - 嵌套子图：递归展开（带 visited 防环）
 * - 自定义节点（customTypeId 非空）：跳过（由 compileCustomNode 处理）
 */
export function inlineSubgraphNodes(
  graph: NodeGraph,
  manager: SubgraphManager,
): { graph: NodeGraph; warnings: string[] } {
  const warnings: string[] = [];
  const visited = new Set<string>();

  function expand(node: ModNode, depth: number): ModNode[] {
    if (depth > 32) {
      warnings.push(`子图嵌套过深（>32），可能存在循环引用：${node.id}`);
      return [node];
    }
    if (node.data.kind !== 'subgraph') return [node];
    // 自定义节点不在此处理
    if (node.data.customTypeId) return [node];
    const sgId = node.data.subgraphId;
    if (!sgId) return [node];
    if (visited.has(sgId)) {
      warnings.push(`子图循环引用：${sgId}（跳过展开）`);
      return [node];
    }
    visited.add(sgId);
    const sg: SubgraphDefinition | undefined =
      manager.get(sgId) ?? graph.subgraphs[sgId];
    if (!sg) {
      warnings.push(`子图未找到：${sgId}（节点 ${node.id}）`);
      visited.delete(sgId);
      return [node];
    }
    const expanded: ModNode[] = [];
    for (const inner of sg.nodes) {
      expanded.push(...expand(inner, depth + 1));
    }
    visited.delete(sgId);
    return expanded;
  }

  const newNodes: ModNode[] = [];
  for (const node of graph.nodes) {
    newNodes.push(...expand(node, 0));
  }

  return {
    graph: { ...graph, nodes: newNodes },
    warnings,
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- compileSubgraph`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/compileSubgraph.ts apps/desktop/src/renderer/src/lib/compileSubgraph.test.ts
git commit -m "feat(lowcode): add inlineSubgraphNodes (returns {graph, warnings})"
```

---

## Task 30: compileLoop.ts

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/compileLoop.ts`
- Test: `apps/desktop/src/renderer/src/lib/compileLoop.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/lib/compileLoop.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { compileLoop } from './compileLoop.js';
import type { LoopNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

describe('compileLoop', () => {
  it('for 循环编译为 Java for 代码', () => {
    const data: LoopNodeData = {
      nodeId: 'l1', label: '计数', note: '', disabled: false, kind: 'loop',
      loopType: 'for', init: 'int i = 0', condition: 'i < 10', update: 'i++',
      loopVarName: 'i', loopVarType: 'int', collapsed: false,
    };
    const { snippet } = compileLoop(data, '// body');
    expect(snippet.snippetId).toBe('l1');
    expect(snippet.code).toContain('for (int i = 0; i < 10; i++)');
    expect(snippet.code).toContain('// body');
  });

  it('forEach 循环编译为 Java for-each', () => {
    const data: LoopNodeData = {
      nodeId: 'l2', label: '遍历', note: '', disabled: false, kind: 'loop',
      loopType: 'forEach', condition: '', loopVarName: 'item', loopVarType: 'item',
      iterable: 'itemList', collapsed: false,
    };
    const { snippet } = compileLoop(data, '// do something');
    expect(snippet.code).toContain('for (ItemStack item : itemList)');
    expect(snippet.code).toContain('// do something');
  });

  it('while 循环编译为 Java while', () => {
    const data: LoopNodeData = {
      nodeId: 'l3', label: 'w', note: '', disabled: false, kind: 'loop',
      loopType: 'while', condition: 'running', loopVarName: '', loopVarType: 'int', collapsed: false,
    };
    const { snippet } = compileLoop(data, '// body');
    expect(snippet.code).toContain('while (running)');
    expect(snippet.code).toContain('// body');
  });

  it('返回类型是 { snippet }（CustomCodeSnippetSpec）', () => {
    const data: LoopNodeData = {
      nodeId: 'l4', label: 'x', note: '', disabled: false, kind: 'loop',
      loopType: 'for', init: 'int i = 0', condition: 'i<1', update: 'i++',
      loopVarName: 'i', loopVarType: 'int', collapsed: false,
    };
    const result = compileLoop(data, '');
    const _: CustomCodeSnippetSpec = result.snippet;
    expect(_.snippetId).toBe('l4');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- compileLoop`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 compileLoop.ts**

创建 `apps/desktop/src/renderer/src/lib/compileLoop.ts`：

```ts
import type { LoopNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

/**
 * 编译循环节点为 Java 循环代码，包装为 CustomCodeSnippetSpec。
 * bodyCode 是循环体代码（由调用方从子图或动作节点编译得到）。
 *
 * 返回 { snippet }，由 compileNodeGraph push 到 customCode 数组。
 */
export function compileLoop(data: LoopNodeData, bodyCode: string): { snippet: CustomCodeSnippetSpec } {
  const header = buildLoopHeader(data);
  const code = `${header} {\n  ${bodyCode}\n}`;

  return {
    snippet: {
      snippetId: data.nodeId,
      language: 'java',
      code,
      inputSignature: {},
      outputSignature: {},
      methodName: `loop_${data.nodeId}`,
    },
  };
}

function buildLoopHeader(data: LoopNodeData): string {
  switch (data.loopType) {
    case 'for':
      return `for (${data.init ?? 'int i = 0'}; ${data.condition}; ${data.update ?? 'i++'})`;
    case 'forEach': {
      const javaType = loopVarTypeToJava(data.loopVarType);
      const varName = data.loopVarName || 'item';
      const iterable = data.iterable || 'items';
      return `for (${javaType} ${varName} : ${iterable})`;
    }
    case 'while':
      return `while (${data.condition})`;
  }
}

function loopVarTypeToJava(varType: LoopNodeData['loopVarType']): string {
  switch (varType) {
    case 'int': return 'int';
    case 'item': return 'ItemStack';
    case 'block': return 'BlockState';
    case 'string': return 'String';
  }
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- compileLoop`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/compileLoop.ts apps/desktop/src/renderer/src/lib/compileLoop.test.ts
git commit -m "feat(lowcode): add compileLoop (for/forEach/while → Java snippet)"
```

---

## Task 31: compileCustomNode.ts

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/compileCustomNode.ts`
- Test: `apps/desktop/src/renderer/src/lib/compileCustomNode.test.ts`

> 依赖：Task 7（customNodeRegistry 单例）、Task 17（mustacheRender）、Task 2（SubgraphNodeData.customFields）

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/lib/compileCustomNode.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { compileCustomNode } from './compileCustomNode.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import type { SubgraphNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';

describe('compileCustomNode', () => {
  beforeEach(() => {
    customNodeRegistry.clear();
  });

  it('schema 已注册 + fields 齐全时返回 snippet（Mustache 渲染）', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter',
      label: '合成台',
      description: '',
      icon: '',
      color: 'mc-code',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: true }],
      codeTemplate: 'int speed = {{field:speed}};',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c1', label: 'x', note: '', disabled: false, kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: 'mymod:crafter',
      customFields: { speed: 42 }, collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.error).toBeUndefined();
    expect(result.snippet).toBeDefined();
    expect(result.snippet!.code).toBe('int speed = 42;');
    expect(result.snippet!.language).toBe('java');
    expect(result.snippet!.snippetId).toBe('c1');
    // 返回类型是 CustomCodeSnippetSpec
    const _: CustomCodeSnippetSpec = result.snippet!;
    expect(_.snippetId).toBe('c1');
  });

  it('customTypeId 为 null 时返回 error', () => {
    const data: SubgraphNodeData = {
      nodeId: 'c2', label: 'x', note: '', disabled: false, kind: 'subgraph',
      subgraphId: 'sg_1', subgraphName: '', customTypeId: null,
      customFields: {}, collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeUndefined();
    expect(result.error).toContain('customTypeId');
  });

  it('schema 未注册时返回 error', () => {
    const data: SubgraphNodeData = {
      nodeId: 'c3', label: 'x', note: '', disabled: false, kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: 'unregistered:type',
      customFields: {}, collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeUndefined();
    expect(result.error).toContain('未注册');
  });

  it('required 字段缺失时返回 error', () => {
    customNodeRegistry.register({
      typeId: 'mymod:required',
      label: 'x', description: '', icon: '', color: '',
      ports: [],
      fields: [{ key: 'speed', label: '速度', type: 'number', required: true }],
      codeTemplate: 'int {{field:speed}};',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c4', label: 'x', note: '', disabled: false, kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: 'mymod:required',
      customFields: {}, collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeUndefined();
    expect(result.error).toContain('speed');
  });

  it('字段值做 Java 转义（防止注入）', () => {
    customNodeRegistry.register({
      typeId: 'mymod:escape',
      label: 'x', description: '', icon: '', color: '',
      ports: [], fields: [],
      codeTemplate: 'String x = "{{field:name}}";',
    });
    const data: SubgraphNodeData = {
      nodeId: 'c5', label: 'x', note: '', disabled: false, kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: 'mymod:escape',
      customFields: { name: 'a"; evil(); "' }, collapsed: false,
    };
    const result = compileCustomNode(data, data.customFields);
    expect(result.snippet).toBeDefined();
    expect(result.snippet!.code).not.toContain('evil()');
    expect(result.snippet!.code).toContain('\\"');
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- compileCustomNode`
Expected: FAIL — 文件不存在

- [ ] **Step 3: 创建 compileCustomNode.ts**

创建 `apps/desktop/src/renderer/src/lib/compileCustomNode.ts`：

```ts
import type { SubgraphNodeData, CustomCodeSnippetSpec } from '@mc-creator/shared';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import { renderMustache } from '../components/lowcode/custom/mustacheRender.js';

/**
 * 编译自定义节点为 Java 代码片段，包装为 CustomCodeSnippetSpec。
 *
 * 流程：
 * 1. 从 data.customTypeId 查 customNodeRegistry 取 schema
 * 2. 校验 required 字段（fields 中 required=true 的 key 必须在 fields 参数中存在且非空）
 * 3. 用 renderMustache 把 schema.codeTemplate 与 fields 合并渲染
 * 4. 包装为 CustomCodeSnippetSpec 返回
 *
 * 失败时返回 { error }（不抛异常，由调用方收集到 errors）：
 * - customTypeId 为 null：非自定义节点，不应调此函数
 * - schema 未注册：自定义类型已删除或未导入
 * - required 字段缺失：用户需填写
 *
 * 返回 { snippet?, error? }，由 compileNodeGraph push 到 customCode 数组。
 */
export function compileCustomNode(
  data: SubgraphNodeData,
  fields: Record<string, unknown>,
): { snippet?: CustomCodeSnippetSpec; error?: string } {
  if (!data.customTypeId) {
    return { error: `节点 ${data.nodeId} 的 customTypeId 为 null，不能作为自定义节点编译` };
  }
  const schema = customNodeRegistry.get(data.customTypeId);
  if (!schema) {
    return { error: `自定义节点类型未注册：${data.customTypeId}（节点 ${data.nodeId}）` };
  }

  // 校验 required 字段
  for (const field of schema.fields) {
    if (!field.required) continue;
    const val = fields[field.key];
    if (val === undefined || val === null || val === '') {
      return { error: `自定义节点 ${data.nodeId} 缺少必填字段：${field.key}（${field.label}）` };
    }
  }

  const code = renderMustache(schema.codeTemplate, fields);

  return {
    snippet: {
      snippetId: data.nodeId,
      language: 'java',
      code,
      inputSignature: {},
      outputSignature: {},
      methodName: `custom_${data.nodeId}`,
    },
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- compileCustomNode`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/compileCustomNode.ts apps/desktop/src/renderer/src/lib/compileCustomNode.test.ts
git commit -m "feat(lowcode): add compileCustomNode (Mustache render → Java snippet)"
```

---

## Task 32: compileNodeGraph.ts 接入 4 编译器 + 外部 mod 依赖检测

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/compileNodeGraph.ts`
- Test: `apps/desktop/src/renderer/src/lib/compileNodeGraph.test.ts`（追加）

> 依赖：Task 28（compileVariable）、Task 29（compileSubgraph/inlineSubgraphNodes）、Task 30（compileLoop）、Task 31（compileCustomNode）、Task 18（externalModList）

- [ ] **Step 1: 写失败测试**

追加到 `apps/desktop/src/renderer/src/lib/compileNodeGraph.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { compileNodeGraph, preloadExternalMods } from './compileNodeGraph.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import type { NodeGraph, ModNode, SubgraphDefinition } from '@mc-creator/shared';

function makeVariable(id: string, varName: string): ModNode {
  return {
    id, type: 'variable', position: { x: 0, y: 0 },
    data: { nodeId: id, label: varName, note: '', disabled: false, kind: 'variable',
      varName, varType: 'int', value: 10, isConstant: true, collapsed: false },
    ports: [], selected: false,
  };
}

function makeLoop(id: string): ModNode {
  return {
    id, type: 'loop', position: { x: 0, y: 0 },
    data: { nodeId: id, label: 'loop', note: '', disabled: false, kind: 'loop',
      loopType: 'for', init: 'int i = 0', condition: 'i < 3', update: 'i++',
      loopVarName: 'i', loopVarType: 'int', collapsed: false },
    ports: [], selected: false,
  };
}

function makeCustom(id: string, typeId: string, fields: Record<string, unknown> = {}): ModNode {
  return {
    id, type: 'subgraph', position: { x: 0, y: 0 },
    data: { nodeId: id, label: 'custom', note: '', disabled: false, kind: 'subgraph',
      subgraphId: '', subgraphName: '', customTypeId: typeId, customFields: fields, collapsed: false },
    ports: [], selected: false,
  };
}

describe('compileNodeGraph 阶段 C 集成', () => {
  beforeEach(() => {
    subgraphManager.clear();
    customNodeRegistry.clear();
  });

  it('变量节点编译后 customCode 数组含变量 snippet', () => {
    const graph: NodeGraph = {
      version: 1, modId: 'testmod', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeVariable('v1', 'MAX')], edges: [], subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    expect(result.errors).toHaveLength(0);
    const varSnippet = result.spec.customCode.find((c) => c.snippetId === 'v1');
    expect(varSnippet).toBeDefined();
    expect(varSnippet!.code).toContain('MAX');
  });

  it('子图节点先内联展开再编译（customTypeId 为 null）', () => {
    const innerItem: ModNode = {
      id: 'inner_1', type: 'item', position: { x: 0, y: 0 },
      data: { nodeId: 'inner_1', label: 'inner', note: '', disabled: false, kind: 'item',
        itemId: 'inner_item', displayName: 'Inner', category: 'misc',
        maxStackSize: 64, maxDamage: 0, rarity: 'common', glow: false, collapsed: false },
      ports: [], selected: false,
    };
    const sgDef: SubgraphDefinition = {
      id: 'sg_1', name: '内层', nodes: [innerItem], edges: [], portMappings: [],
    };
    subgraphManager.register(sgDef);
    const sgNode: ModNode = {
      id: 's1', type: 'subgraph', position: { x: 0, y: 0 },
      data: { nodeId: 's1', label: 'sg', note: '', disabled: false, kind: 'subgraph',
        subgraphId: 'sg_1', subgraphName: '内层', customTypeId: null, customFields: {}, collapsed: false },
      ports: [], selected: false,
    };
    const graph: NodeGraph = {
      version: 1, modId: 'testmod', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [sgNode], edges: [], subgraphs: { sg_1: sgDef },
    };
    const result = compileNodeGraph(graph);
    // 内联后 inner_1 被编译为 item
    expect(result.spec.items.some((i) => i.id === 'inner_item')).toBe(true);
  });

  it('循环节点编译后 customCode 含循环代码', () => {
    const graph: NodeGraph = {
      version: 1, modId: 'testmod', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeLoop('l1')], edges: [], subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    const loopSnippet = result.spec.customCode.find((c) => c.snippetId === 'l1');
    expect(loopSnippet).toBeDefined();
    expect(loopSnippet!.code).toContain('for (');
  });

  it('自定义节点编译后 customCode 含 Mustache 渲染结果', () => {
    customNodeRegistry.register({
      typeId: 'mymod:crafter', label: 'x', description: '', icon: '', color: '',
      ports: [], fields: [{ key: 'speed', label: '速度', type: 'number', required: false }],
      codeTemplate: 'int s = {{field:speed}};',
    });
    const graph: NodeGraph = {
      version: 1, modId: 'testmod', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeCustom('c1', 'mymod:crafter', { speed: 99 })], edges: [], subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    const customSnippet = result.spec.customCode.find((c) => c.snippetId === 'c1');
    expect(customSnippet).toBeDefined();
    expect(customSnippet!.code).toBe('int s = 99;');
  });

  it('自定义节点 schema 未注册时报 error', () => {
    const graph: NodeGraph = {
      version: 1, modId: 'testmod', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [makeCustom('c2', 'unregistered:type')], edges: [], subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    expect(result.errors.some((e) => e.includes('未注册'))).toBe(true);
  });

  it('外部 mod 命名空间引用检测（installed=false 加 warning）', () => {
    // 预加载外部 mod 缓存：create 标记为未安装
    preloadExternalMods([{ namespace: 'create', installed: false }]);
    // 物品 itemId 引用 create:cog
    const itemNode: ModNode = {
      id: 'i1', type: 'item', position: { x: 0, y: 0 },
      data: { nodeId: 'i1', label: 'x', note: '', disabled: false, kind: 'item',
        itemId: 'create:cog', displayName: 'Cog', category: 'misc',
        maxStackSize: 64, maxDamage: 0, rarity: 'common', glow: false, collapsed: false },
      ports: [], selected: false,
    };
    const graph: NodeGraph = {
      version: 1, modId: 'testmod', viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [itemNode], edges: [], subgraphs: {},
    };
    const result = compileNodeGraph(graph);
    expect(result.warnings.some((w) => w.includes('create'))).toBe(true);
    // 清理缓存，避免影响后续测试
    preloadExternalMods([{ namespace: 'create', installed: true }]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- compileNodeGraph`
Expected: FAIL — variable/loop/custom 节点未编译到 customCode，子图未内联展开

- [ ] **Step 3: 修改 compileNodeGraph.ts**

在 `apps/desktop/src/renderer/src/lib/compileNodeGraph.ts` 顶部 import 区追加（在现有 import 之后）：

```ts
import { compileVariable } from './compileVariable.js';
import { inlineSubgraphNodes } from './compileSubgraph.js';
import { compileLoop } from './compileLoop.js';
import { compileCustomNode } from './compileCustomNode.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
```

> 注：`listExternalMods`（异步）不在编译器内调用。编译器用同步的 `isExternalModInstalled` 读 `installedExternalModsCache` 缓存。调用方（LowcodeWorkspace）在编译前异步调 `listExternalMods().then(preloadExternalMods)` 填充缓存。

在 `compileNodeGraph` 函数体最前面（`const warnings: string[] = [];` 之后、`// 过滤禁用节点` 之前）插入子图内联展开：

```ts
  // === 阶段 C：子图内联展开 ===
  // 把 customTypeId 为 null 的 subgraph 节点替换为其引用的子图内部节点。
  // customTypeId 非空的 subgraph 节点（自定义节点）不展开，由 compileCustomNode 处理。
  const inlineResult = inlineSubgraphNodes(graph, subgraphManager);
  warnings.push(...inlineResult.warnings);
  const inlinedGraph = inlineResult.graph;
```

把后续所有 `graph` 引用改为 `inlinedGraph`（包括 `activeNodes` 过滤、`compileRecipeNode(graph, ...)`、`compileEventNode(graph, ...)` 等需要查连线的函数调用）。具体地，把：

```ts
  const activeNodes = inlinedGraph.nodes.filter((n) => !n.data.disabled);
```

以及所有 `graph.nodes` → `inlinedGraph.nodes`、`graph.edges` → `inlinedGraph.edges`（在 compileRecipeNode/compileEventNode 调用处）。`graph.modId` 改为 `inlinedGraph.modId`。

在 `// === 编译代码节点 ===` 段之后、`// === 编译多方块结构 ===` 段之前，插入变量/循环节点编译：

```ts
  // === 阶段 C：编译变量节点 ===
  // variable → Java 字段声明，push 到 customCode 数组（不覆盖 code 节点结果）
  for (const node of activeNodes) {
    if (node.data.kind !== 'variable') continue;
    try {
      const { snippet } = compileVariable(node.data);
      customCode.push(snippet);
    } catch (e) {
      errors.push(`变量节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }

  // === 阶段 C：编译循环节点 ===
  // loop → Java 循环代码，bodyCode 从 bodySubgraphId 子图编译（无则空体）
  for (const node of activeNodes) {
    if (node.data.kind !== 'loop') continue;
    try {
      const bodyCode = compileLoopBody(inlinedGraph, node.data.bodySubgraphId);
      const { snippet } = compileLoop(node.data, bodyCode);
      customCode.push(snippet);
    } catch (e) {
      errors.push(`循环节点 ${node.id} 编译失败：${(e as Error).message}`);
    }
  }
```

在 `// === 编译事件/条件/动作节点 ===` 段之后、`const spec: ModSpec = {` 之前，插入自定义节点编译 + 外部 mod 依赖检测：

```ts
  // === 阶段 C：编译自定义节点 ===
  // subgraph 节点中 customTypeId 非空的为自定义节点，用 compileCustomNode 渲染 codeTemplate。
  // customTypeId 为 null 的 subgraph 节点已在前面内联展开，此处不应再出现。
  for (const node of activeNodes) {
    if (node.data.kind !== 'subgraph') continue;
    if (node.data.customTypeId) {
      const result = compileCustomNode(node.data, node.data.customFields);
      if (result.error) {
        errors.push(`自定义节点 ${node.id} 编译失败：${result.error}`);
      } else if (result.snippet) {
        customCode.push(result.snippet);
      }
    }
  }

  // === 阶段 C：外部 mod 依赖检测 ===
  // 扫描所有物品/方块/配方的 id 和 customCode，提取 modid 命名空间，
  // 与已安装外部 mod 列表比对，未安装的加 warning（不阻断编译）。
  // 注意：listExternalMods 是异步函数，但编译器同步执行——此处用同步 mock 列表兜底，
  // 真正的已安装列表由 preload/prebuild 阶段异步预取并缓存到 module-level 变量。
  const externalNamespaces = collectExternalNamespaces(items, blocks, recipes, customCode, inlinedGraph.modId);
  for (const ns of externalNamespaces) {
    if (!isExternalModInstalled(ns)) {
      warnings.push(`引用了外部 mod 命名空间「${ns}」，但该 mod 未安装，运行时可能缺失依赖`);
    }
  }
```

在文件末尾（最后一个辅助函数之后）追加 `compileLoopBody` + `collectExternalNamespaces` + `isExternalModInstalled` 辅助函数：

```ts
// === 阶段 C 辅助函数 ===

/**
 * 编译循环节点的循环体：从 bodySubgraphId 引用的子图中提取代码节点/动作节点的代码，
 * 拼接为循环体代码字符串。无 bodySubgraphId 或子图未找到时返回空注释。
 */
function compileLoopBody(graph: NodeGraph, bodySubgraphId?: string): string {
  if (!bodySubgraphId) return '// no body';
  const sg = subgraphManager.get(bodySubgraphId) ?? graph.subgraphs[bodySubgraphId];
  if (!sg) return '// body subgraph not found';
  const lines: string[] = [];
  for (const node of sg.nodes) {
    if (node.data.kind === 'code') {
      lines.push(node.data.code);
    } else if (node.data.kind === 'action') {
      lines.push(`// action: ${node.data.actionType}`);
    }
  }
  return lines.length > 0 ? lines.join('\n  ') : '// empty body';
}

/**
 * 收集所有引用的外部 mod 命名空间（排除 'minecraft' 和当前 modId）。
 * 扫描物品/方块/配方的 id（modid:path 格式）和 customCode 中的 import 语句。
 */
function collectExternalNamespaces(
  items: ItemSpec[],
  blocks: BlockSpec[],
  recipes: ModRecipeSpec[],
  customCode: CustomCodeSnippetSpec[],
  currentModId: string,
): Set<string> {
  const namespaces = new Set<string>();
  const extractNs = (id: string) => {
    const idx = id.indexOf(':');
    if (idx > 0) {
      const ns = id.substring(0, idx);
      if (ns !== 'minecraft' && ns !== currentModId) {
        namespaces.add(ns);
      }
    }
  };
  for (const item of items) extractNs(item.id);
  for (const block of blocks) extractNs(block.id);
  for (const recipe of recipes) {
    extractNs(recipe.output);
    for (const input of recipe.inputs) extractNs(input.item);
  }
  for (const cc of customCode) {
    // 扫描 import 语句中的包名（com.xxx.yyy → xxx 作为 modid 猜测）
    const importMatches = cc.code.matchAll(/import\s+com\.([a-z0-9_]+)\./gi);
    for (const m of importMatches) {
      namespaces.add(m[1]);
    }
  }
  return namespaces;
}

/** 已安装外部 mod 缓存（由 preload 阶段异步填充，编译器同步读取） */
let installedExternalModsCache: Set<string> | null = null;

/**
 * 检查外部 mod 是否已安装（同步，读缓存）。
 * 缓存为 null 时（未 preload）默认返回 true（不误报），避免阻塞编译。
 * preload 阶段调 listExternalMods().then(mods => 更新缓存)。
 */
export function preloadExternalMods(mods: Array<{ namespace: string; installed: boolean }>): void {
  installedExternalModsCache = new Set(
    mods.filter((m) => m.installed).map((m) => m.namespace),
  );
}

function isExternalModInstalled(namespace: string): boolean {
  if (!installedExternalModsCache) return true; // 未 preload，不误报
  return installedExternalModsCache.has(namespace);
}
```

> 注：`listExternalMods` 是异步函数，编译器本身同步执行。`preloadExternalMods` 导出供调用方（如 LowcodeWorkspace 在编译前）异步预取已安装 mod 列表并填充缓存。编译器内部用 `isExternalModInstalled` 同步读缓存。

- [ ] **Step 4: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- compileNodeGraph`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/compileNodeGraph.ts apps/desktop/src/renderer/src/lib/compileNodeGraph.test.ts
git commit -m "feat(lowcode): integrate variable/subgraph/loop/custom compilers + external mod dep check"
```

---

## Task 33: 阶段 C 端到端集成测试

**Files:**
- Create: `apps/desktop/src/renderer/src/lib/phase-c.integration.test.ts`

> 依赖：Task 1-32 全部完成。本 Task 不写新实现代码，仅验证端到端流程。

- [ ] **Step 1: 写集成测试**

创建 `apps/desktop/src/renderer/src/lib/phase-c.integration.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { compileNodeGraph, preloadExternalMods } from './compileNodeGraph.js';
import { useNodeGraphStore } from '../store/node-graph-store.js';
import { subgraphManager } from '../components/lowcode/subgraph/subgraphManager.js';
import { customNodeRegistry } from '../components/lowcode/custom/customNodeRegistry.js';
import type { NodeGraph, ModNode } from '@mc-creator/shared';

/**
 * 阶段 C 端到端集成测试
 *
 * 验证 spec §11-14 的核心流程：
 * 1. 变量节点 → 编译 → customCode 含 Java 字段声明
 * 2. 封装子图 → 内联展开 → 编译 → 内部节点出现在 spec.items
 * 3. 循环节点 → 编译 → customCode 含 Java 循环代码
 * 4. 导入自定义节点 → 编译 → Mustache 渲染 codeTemplate
 * 5. 混合图：变量 + 物品 + 子图 + 循环 + 自定义节点共存编译
 */
describe('阶段 C 端到端集成', () => {
  beforeEach(() => {
    subgraphManager.clear();
    customNodeRegistry.clear();
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: { ...useNodeGraphStore.getState().graph, modId: 'integ_test' },
    });
    // 默认所有外部 mod 已安装（不触发 warning）
    preloadExternalMods([]);
  });

  it('流程 1：添加变量节点 → 编译 → customCode 含变量 snippet', () => {
    const store = useNodeGraphStore.getState();
    const varId = store.addNode('variable', { x: 0, y: 0 });
    // 修改变量名和值
    useNodeGraphStore.getState().updateNode(varId, { varName: 'MAX_SPEED', value: 100, isConstant: true });
    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    expect(result.errors).toHaveLength(0);
    const snippet = result.spec.customCode.find((c) => c.snippetId === varId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('MAX_SPEED');
    expect(snippet!.code).toContain('100');
    expect(snippet!.code).toContain('static final');
  });

  it('流程 2：封装子图 → 内联展开 → 编译 → 内部 item 出现在 spec.items', () => {
    const store = useNodeGraphStore.getState();
    const id1 = store.addNode('item', { x: 0, y: 0 });
    useNodeGraphStore.getState().updateNode(id1, { itemId: 'sword_1', displayName: '剑' });
    const id2 = store.addNode('item', { x: 100, y: 0 });
    useNodeGraphStore.getState().updateNode(id2, { itemId: 'shield_1', displayName: '盾' });

    // 封装为子图
    const sgNodeId = useNodeGraphStore.getState().encapsulateSubgraph([id1, id2], '装备包');
    expect(sgNodeId).not.toBeNull();

    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    // 内联后两个 item 被编译到 spec.items
    expect(result.spec.items.some((i) => i.id === 'sword_1')).toBe(true);
    expect(result.spec.items.some((i) => i.id === 'shield_1')).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('流程 3：添加循环节点 → 编译 → customCode 含 Java 循环', () => {
    const store = useNodeGraphStore.getState();
    const loopId = store.addNode('loop', { x: 0, y: 0 });
    useNodeGraphStore.getState().updateNode(loopId, {
      loopType: 'forEach',
      loopVarName: 'item',
      loopVarType: 'item',
      iterable: 'items',
    });
    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    const snippet = result.spec.customCode.find((c) => c.snippetId === loopId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('for (');
    expect(snippet!.code).toContain('ItemStack');
    expect(snippet!.code).toContain('item');
  });

  it('流程 4：导入自定义节点 → 编译 → Mustache 渲染 codeTemplate', () => {
    // 注册自定义节点 schema
    customNodeRegistry.register({
      typeId: 'integ:crafter',
      label: '集成合成台',
      description: '测试用',
      icon: 'crafting-table',
      color: 'mc-custom',
      ports: [],
      fields: [
        { key: 'speed', label: '速度', type: 'number', required: true, min: 1, max: 100 },
        { key: 'name', label: '名称', type: 'text', required: false },
      ],
      codeTemplate: 'public class Crafter { int speed = {{field:speed}}; String name = "{{field:name}}"; }',
    });

    // 通过 store 添加自定义节点
    const nodeId = useNodeGraphStore.getState().addCustomNode('integ:crafter', { x: 50, y: 50 });
    // 填写字段值
    useNodeGraphStore.getState().updateNode(nodeId, {
      customFields: { speed: 42, name: 'FastCrafter' },
    });

    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    expect(result.errors).toHaveLength(0);
    const snippet = result.spec.customCode.find((c) => c.snippetId === nodeId);
    expect(snippet).toBeDefined();
    expect(snippet!.code).toContain('speed = 42');
    expect(snippet!.code).toContain('FastCrafter');
  });

  it('流程 5：混合图（变量 + 物品 + 子图 + 循环 + 自定义）共存编译', () => {
    // 1. 变量节点
    const varId = useNodeGraphStore.getState().addNode('variable', { x: 0, y: 0 });
    useNodeGraphStore.getState().updateNode(varId, { varName: 'COUNT', varType: 'int', value: 5, isConstant: true });

    // 2. 物品节点
    const itemId = useNodeGraphStore.getState().addNode('item', { x: 100, y: 0 });
    useNodeGraphStore.getState().updateNode(itemId, { itemId: 'gem_1', displayName: '宝石' });

    // 3. 循环节点
    const loopId = useNodeGraphStore.getState().addNode('loop', { x: 200, y: 0 });
    useNodeGraphStore.getState().updateNode(loopId, { loopType: 'for', condition: 'i < COUNT', init: 'int i = 0', update: 'i++' });

    // 4. 自定义节点
    customNodeRegistry.register({
      typeId: 'integ:mixed',
      label: '混合自定义', description: '', icon: '', color: '',
      ports: [], fields: [{ key: 'power', label: '力量', type: 'number', required: true }],
      codeTemplate: 'int power = {{field:power}};',
    });
    const customId = useNodeGraphStore.getState().addCustomNode('integ:mixed', { x: 300, y: 0 });
    useNodeGraphStore.getState().updateNode(customId, { customFields: { power: 999 } });

    // 5. 封装物品+循环为子图
    const sgNodeId = useNodeGraphStore.getState().encapsulateSubgraph([itemId, loopId], '复合逻辑');
    expect(sgNodeId).not.toBeNull();

    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);

    // 变量编译到 customCode
    expect(result.spec.customCode.some((c) => c.snippetId === varId)).toBe(true);
    // 物品内联展开后编译到 items
    expect(result.spec.items.some((i) => i.id === 'gem_1')).toBe(true);
    // 循环内联展开后编译到 customCode
    expect(result.spec.customCode.some((c) => c.snippetId === loopId)).toBe(true);
    // 自定义节点编译到 customCode
    expect(result.spec.customCode.some((c) => c.snippetId === customId && c.code.includes('999'))).toBe(true);
    // 无致命错误
    expect(result.errors).toHaveLength(0);
  });

  it('流程 6：自定义节点 required 字段缺失 → 编译报 error', () => {
    customNodeRegistry.register({
      typeId: 'integ:strict',
      label: '严格', description: '', icon: '', color: '',
      ports: [],
      fields: [{ key: 'Required', label: '必填', type: 'text', required: true }],
      codeTemplate: 'String x = "{{field:Required}}";',
    });
    const nodeId = useNodeGraphStore.getState().addCustomNode('integ:strict', { x: 0, y: 0 });
    // 不填 Required 字段（customFields 为空）
    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    expect(result.errors.some((e) => e.includes(nodeId) && e.includes('Required'))).toBe(true);
  });

  it('流程 7：子图循环引用检测 → 编译加 warning', () => {
    // 构造 sg_a 内部引用 sg_b，sg_b 内部引用 sg_a
    const sgA: ModNode = {
      id: 'node_in_a', type: 'subgraph', position: { x: 0, y: 0 },
      data: { nodeId: 'node_in_a', label: 'a', note: '', disabled: false, kind: 'subgraph',
        subgraphId: 'sg_b', subgraphName: 'B', customTypeId: null, customFields: {}, collapsed: false },
      ports: [], selected: false,
    };
    const sgB: ModNode = {
      id: 'node_in_b', type: 'subgraph', position: { x: 0, y: 0 },
      data: { nodeId: 'node_in_b', label: 'b', note: '', disabled: false, kind: 'subgraph',
        subgraphId: 'sg_a', subgraphName: 'A', customTypeId: null, customFields: {}, collapsed: false },
      ports: [], selected: false,
    };
    useNodeGraphStore.getState().clear();
    useNodeGraphStore.setState({
      graph: {
        version: 1, modId: 'cycle_test', viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [sgA], edges: [],
        subgraphs: {
          sg_a: { id: 'sg_a', name: 'A', nodes: [sgB], edges: [], portMappings: [] },
          sg_b: { id: 'sg_b', name: 'B', nodes: [], edges: [], portMappings: [] },
        },
      },
    });
    const graph = useNodeGraphStore.getState().graph;
    const result = compileNodeGraph(graph);
    expect(result.warnings.some((w) => w.includes('循环引用') || w.includes('cycle'))).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- phase-c.integration`
Expected: PASS — 所有 7 个端到端流程通过

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/phase-c.integration.test.ts
git commit -m "test(lowcode): add phase C end-to-end integration tests (7 flows)"
```

---

## 阶段 C 完成检查清单

- [ ] 所有 33 个 Task 的 Step 4 测试均 PASS
- [ ] `pnpm --filter @mc-creator/shared typecheck` 无错误
- [ ] `pnpm --filter @mc-creator/desktop typecheck` 无错误
- [ ] `pnpm --filter @mc-creator/shared test` 全部通过
- [ ] `pnpm --filter @mc-creator/desktop test` 全部通过
- [ ] Spec §11（变量节点）覆盖：Task 1/9/10/20/28
- [ ] Spec §12（子图节点）覆盖：Task 2/6/9/11/14/15/16/20/26/27/29
- [ ] Spec §13（循环节点）覆盖：Task 3/9/12/20/30
- [ ] Spec §14.1（自定义节点）覆盖：Task 4/5/7/13/17/19/24/25/31
- [ ] Spec §14.2（外部 mod API）覆盖：Task 18/21/23/32
- [ ] 共享契约 §2 McNodeShell 签名：所有节点组件遵守
- [ ] 共享契约 §3 NodeProps<T> 泛型：T 是 data 类型
- [ ] 共享契约 §6 编译器契约：customCode 为数组，4 编译器返回类型正确
- [ ] 共享契约 §7 单例模式：subgraphManager/customNodeRegistry
- [ ] 共享契约 §8 外部 API：window.mcApi（不用 ipcClient.invoke）
- [ ] 共享契约 §9 路径规范：.js 后缀，无多余 renderer/src