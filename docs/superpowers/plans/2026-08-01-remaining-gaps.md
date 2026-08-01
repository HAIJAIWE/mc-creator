# 剩余缺口实现计划 — 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户确认实现全部剩余缺口

## 缺口清单与实施顺序

### Task 1: 低代码补节点(Biome / Dimension / Fluid 节点)
- schema:node-graph-spec.ts 加 BiomeNodeData / DimensionNodeData / FluidNodeData
- compileNodeGraph:编译三个新节点(替换硬编码的空数组)
- 节点 UI:BiomeNode / DimensionNode / FluidNode 组件 + portSchemas + fieldSchemas + palette 注册
- 测试:compile 单测 + e2e

### Task 2: 机器实体逻辑(ModMachines 从壳到可用)
- MachineSpec 已有 inputSlots/outputSlots/energyCapacity/processTime
- fabric/neoforge adapter 生成:
  - BlockEntity:TickableBlockEntity 能源消耗、输入/输出槽 ItemStackHandler(无 API 依赖手写数组实现)
  - Menu:同步槽位、transferTo
- 测试:断言生成代码含槽位数组/能源字段

### Task 3: GUI 编辑器(容器界面)
- GuiSpec:containerName/width/height/slots[]/slotType/energyDisplay
- ModSpec.guis 数组
- fabric/neoforge 生成 GuiScreen 类 + 渲染
- 节点:GuiNode + 画布集成
- 测试

### Task 4: Mod 侧结构生成
- ModStructureSpec(结构注册,复用数据包 template_pool 概念)
- adapter 生成结构注册代码
- 测试

### Task 5: 项目依赖图 / 版本对比
- Dashboard 或独立面板:项目依赖可视化
- 版本对比:同 spec 两版本 diff
- 测试

### 协作编辑:需后端服务,超出单机 Electron 范围,不做(文档说明)

## 验收
- 每 Task:typecheck + 测试绿
- 最终全量测试绿,分组提交
