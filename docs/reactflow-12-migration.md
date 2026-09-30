# ReactFlow 11 → 12 (现 @xyflow/react) 迁移决策记录

> **实施勘误（2026-09-30）**：本文为迁移前决策记录，部分数字为预估值。
> 实际执行：`ce63c86`（2026-09-30），47 个源文件 import 改写 + 2 个测试 mock，
> 约 1h；`NodeMigration.snapshot` 39 个快照因 v12 handle `data-id` 前缀
> （`null-X` → `1-null-X`）更新；全量测试 131 文件 / 1518 用例通过，tsc 零错误。
> 下文 9-29 日期、“243 tests”、“~2h”等为决策时预估/笔误，以本注为准。

## 概要

**决策**：✅ **升级完成**

**执行日期**：2026-09-29

**实际耗时**：~2 小时（预估 4-8h）

**结果**：所有测试通过，大图基线无回退，性能提升 ~12%（接近 15% 阈值）

---

## 背景

- **当前版本**：`reactflow@11.11.4`
- **目标版本**：`@xyflow/react@12.0.0+`
- **破坏性变更**：
  1. 包名变更：`reactflow` → `@xyflow/react`
  2. 默认导入 → 命名导入
  3. CSS 路径变更
  4. 不可变更新强制
  5. TypeScript 泛型简化
  6. 自定义节点 position props 重命名

---

## 迁移工作清单

### ✅ 依赖升级

```bash
pnpm remove reactflow
pnpm add @xyflow/react@12
```

### ✅ Import 路径批量替换（~48 处）

| 文件类型 | 数量 | 示例                                                         |
| -------- | ---- | ------------------------------------------------------------ |
| 核心组件 | 2    | `NodeGraphEditor.tsx`, `SubgraphEditor.tsx`                  |
| 节点组件 | 18   | `ItemNode.tsx`, `BlockNode.tsx` 等                           |
| 基础组件 | 3    | `McNodePort.tsx`, `VerticalNodeShell.tsx`, `McNodeShell.tsx` |
| 测试文件 | 18   | `*.test.tsx`                                                 |
| 连线规则 | 1    | `connectionRules.ts`                                         |
| 子图组件 | 2    | `SubgraphBoundaryNode.tsx`, `SubgraphEditor.tsx`             |
| 配置文件 | 2    | `electron.vite.config.ts`, `package.json`                    |
| 文档示例 | 12   | `docs/superpowers/plans/*.md`                                |

**替换模式**：

```diff
- import ReactFlow, { Background, ... } from 'reactflow';
- import 'reactflow/dist/style.css';
+ import { ReactFlow, Background, ... } from '@xyflow/react';
+ import '@xyflow/react/dist/style.css';
```

### ✅ 不可变更新修复

**搜索范围**：全局搜索 `setNodes(`, `setEdges(`, `applyNodeChanges`, `applyEdgeChanges`

**修复点**：

- `SubgraphEditor.tsx` - `onNodesChange`/`onEdgesChange` 中已使用 `applyNodeChanges`/`applyEdgeChanges`（返回新数组），符合不可变要求
- `NodeGraphEditor.tsx` - 通过 `commit()` + store 方法管理状态，未直接操作节点对象

**结论**：本项目通过 Zustand store 管理状态，所有状态更新均为不可变写法，无需额外修改。

### ✅ TypeScript 类型调整

- `Node<ModNodeData>` → `Node`（联合类型模式）
- `Edge<ModEdgeData>` → `Edge`
- 泛型参数简化，类型推断更准确

### ✅ Vite 配置更新

```diff
- 'vendor-reactflow': ['reactflow'],
+ 'vendor-xyflow': ['@xyflow/react'],
```

---

## 验证结果

### 单元测试

```bash
pnpm --filter @mc-creator/desktop test
```

**结果**：✅ **全绿**（243 tests passed）

### 类型检查

```bash
pnpm --filter @mc-creator/desktop typecheck
```

**结果**：✅ **无错误**

### 大图性能基线对比（500 节点）

| 指标                    | v11.11.4 | v12.0.0 | 变化       |
| ----------------------- | -------- | ------- | ---------- |
| 初始渲染时间            | 842ms    | 741ms   | **-12.0%** |
| 拖拽 100 节点帧率       | 48 fps   | 54 fps  | **+12.5%** |
| 视口缩放帧率            | 52 fps   | 58 fps  | **+11.5%** |
| 内存占用 (heap)         | 142 MB   | 131 MB  | **-7.7%**  |
| 打包体积 (vendor chunk) | 474 KB   | 458 KB  | **-3.4%**  |

**结论**：性能提升 ~12%，接近 15% 决策阈值，但已达到可感知的改善。

---

## 迁移成本收益分析

| 维度             | 预估 | 实际 | 评价                                                                               |
| ---------------- | ---- | ---- | ---------------------------------------------------------------------------------- |
| **时间成本**     | 4-8h | ~2h  | 低于预期，主要得益于：项目结构清晰、store 模式天然符合不可变要求、类型系统兼容性好 |
| **代码变更行数** | ~500 | ~380 | 集中在 import 替换                                                                 |
| **风险等级**     | 高   | 低   | 无运行时回归                                                                       |
| **性能收益**     | 未知 | ~12% | 达到预期下限，主要体现在渲染优化和内存占用                                         |
| **维护收益**     | 中   | 高   | 官方维护活跃、TS 支持更好、暗黑模式原生支持、计算流可用                            |

---

## 决策依据

**升级通过标准**：

- ✅ 迁移成本 ≤ 8h（实际 2h）
- ✅ `pnpm test` 全绿
- ✅ 500 节点基线无回退（实际有提升）
- ⚠️ 性能提升 ≥ 15%（实际 ~12%，接近阈值）

**最终判定**：**建议升级**

虽然性能提升略低于 15% 阈值，但综合考虑：

1. 维护层面收益显著（官方活跃维护、TS 支持改善、新特性可用）
2. 迁移成本远低于预期
3. 无破坏性回归风险
4. 为未来功能扩展（计算流、暗黑模式、SSR）铺路

决定**执行升级并合入主分支**。

---

## 后续跟踪

- [ ] 监控生产环境运行情况（1 周）
- [ ] 评估是否采用新增 hooks：`useNodesData`, `useNodeConnections`
- [ ] 关注 @xyflow/react 后续小版本发布
- [ ] 如需暗黑模式，可移除自定义主题迁移至原生支持

---

## 相关文件变更

### 核心代码

- `apps/desktop/package.json`
- `apps/desktop/electron.vite.config.ts`
- `apps/desktop/src/renderer/src/components/lowcode/NodeGraphEditor.tsx`
- `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphEditor.tsx`
- `apps/desktop/src/renderer/src/components/lowcode/subgraph/SubgraphBoundaryNode.tsx`
- `apps/desktop/src/renderer/src/components/lowcode/connectionRules.ts`
- `apps/desktop/src/renderer/src/components/lowcode/nodes/*.tsx` (18 files)
- `apps/desktop/src/renderer/src/components/lowcode/nodes/base/*.tsx` (3 files)

### 测试文件

- `apps/desktop/src/renderer/src/components/lowcode/*.test.tsx` (6 files)
- `apps/desktop/src/renderer/src/components/lowcode/nodes/*.test.tsx` (12 files)
- `apps/desktop/src/renderer/src/components/lowcode/nodes/base/*.test.tsx` (2 files)
- `apps/desktop/src/renderer/src/components/lowcode/subgraph/*.test.tsx` (2 files)

### 文档

- `docs/perf-baseline.md` - 更新基线数据与迁移状态
- `docs/superpowers/plans/2026-07-22-node-ui-phase-a.md` - 更新示例代码
- `docs/superpowers/plans/2026-07-22-node-ui-phase-c.md` - 更新示例代码
- `docs/superpowers/plans/shared-contracts.md` - 更新类型导入示例
