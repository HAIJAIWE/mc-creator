# Node Library Architecture / 节点库架构设计

> **Version**: 1.0  
> **License**: Apache-2.0 (Independent Implementation)  
> **Target**: Minecraft Java Edition 1.20.1+ / Fabric (MVP)

---

## 1. Overview / 概览

### English

This document defines the architecture of our **independent node library** for visual low-code Minecraft mod development. It is a **clean-room implementation** — we only reference MCreator's procedure semantics for compatibility analysis; all code, templates, and designs are original.

### 中文

本文档定义了我们**独立节点库**的架构，用于 Minecraft 模组的可视化低代码开发。这是**清洁室实现** —— 仅参考 MCreator 的过程语义做兼容性分析；所有代码、模板、设计均为原创。

---

## 2. Design Principles / 设计原则

| Principle / 原则                    | Description / 说明                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------------- |
| **Type-First / 类型优先**           | Strong port type system (not string-based like Blockly) / 强端口类型系统，非 Blockly 式字符串校验 |
| **Semantic Aggregation / 语义聚合** | 1 node ≈ 3-5 MCreator blocks via generics / 1 个泛型节点 ≈ 3-5 个 MCreator 碎片块                 |
| **Multi-Target IR / 多目标 IR**     | NodeGraph → IR → Adapter (Fabric/Forge/NeoForge) / 节点图 → 中间表示 → 适配器                     |
| **Apache-2.0 Clean / 许可纯净**     | Zero GPL contamination, fully commercializable / 零 GPL 污染，完全可商用                          |
| **Bilingual Docs / 双语文档**       | Every definition has zh/en for global contributors / 每个定义均含中英双语                         |

---

## 3. Architecture Layers / 架构分层

```
┌─────────────────────────────────────────────────────────────────┐
│  USER LAYER (Frontend) / 用户层 (前端)                            │
│  React Flow + CoreNode + NodePalette + NodeDetailDrawer         │
└─────────────────────────────────────────────────────────────────┘
                              │ NodeGraph JSON (IR)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  COMPILATION PIPELINE / 编译管线                                   │
│  TypeCheck → TopoSort → IR Optimize → Template Render           │
└─────────────────────────────────────────────────────────────────┘
                              │ Java Code Fragments
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  TARGET ADAPTERS / 目标适配器层                                     │
│  FabricAdapter (MVP) │ ForgeAdapter (V2) │ NeoForgeAdapter (V3)  │
└─────────────────────────────────────────────────────────────────┘
                              │ Generated Files
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│  MINECRAFT MOD PROJECT / Minecraft 模组项目                        │
│  src/main/java/... + fabric.mod.json + build.gradle             │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. Core Data Structures / 核心数据结构

### 4.1 NodeDefinition / 节点定义

```typescript
// packages/shared/src/node-library/NodeDefinition.ts

interface NodeDefinition {
  // Identity / 标识
  id: string; // "spawn_entity"
  namespace: 'core' | 'custom' | 'plugin';
  version: number; // 1

  // Display / 显示
  label: string; // "生成实体" / "Spawn Entity"
  description: string; // "在指定位置生成一个实体" / "Spawn an entity at position"
  category: NodeCategory; // "event" | "getter" | "condition" | "action" | "flow" | "variable"
  subcategory: NodeSubcategory; // "entity" | "block" | "player" | "world" | "math" | "logic" | "effect"

  // Visual / 视觉
  icon: string; // McIcon name: "spawn"
  color: NodeColor; // "red" | "orange" | "cyan" | "yellow" | "emerald" | "violet" | "purple" | "blue" | "pink" | "gray" | "gold" | "teal" | "indigo"

  // Type System / 类型系统 (核心差异化)
  inputs: PortDefinition[]; // 输入端口
  outputs: PortDefinition[]; // 输出端口

  // Code Generation / 代码生成
  template: string; // "procedures/action/spawn_entity.mustache"
  templateData?: (data: NodeData) => TemplateContext;

  // Metadata / 元数据 (合规追踪)
  sourceApi: string[]; // ["net.minecraft.world.entity.EntityType", "net.minecraft.world.level.Level"]
  useCases: string[]; // ["自定义怪物生成", "刷怪笼", "BOSS 召唤"]
  aggregatedFrom: string[]; // ["MCreator: entity_spawn_at", "entity_spawn_x/y/z"]

  // Constraints / 约束
  constraints?: NodeConstraints;
  deprecated?: boolean;
  replacementId?: string;
}
```

### 4.2 Port Type System / 端口类型系统

```typescript
// packages/shared/src/node-library/PortType.ts

type PortType =
  // Primitive / 基础类型
  | 'number'
  | 'integer'
  | 'boolean'
  | 'string'
  // Minecraft Core / 核心类型
  | 'entity'
  | 'entity_type'
  | 'player'
  | 'block_pos'
  | 'vec3'
  | 'direction'
  | 'block_state'
  | 'block'
  | 'item_stack'
  | 'item'
  | 'fluid'
  | 'biome'
  | 'dimension'
  // Collections / 容器
  | 'entity_list'
  | 'item_list'
  | 'block_pos_list'
  // Special / 特殊
  | 'nbt'
  | 'any'
  | 'void' // void = control flow
  | 'damage_source'
  | 'sound_event'
  | 'particle_type'
  | 'potion_effect'
  | 'enchantment';

interface PortDefinition {
  id: string; // "position"
  label: string; // "位置" / "Position"
  type: PortType; // "vec3"
  direction: 'input' | 'output';
  required: boolean; // false = optional
  defaultValue?: unknown; // literal or expression
  description?: string; // zh/en
  multiple?: boolean; // multi-connection (e.g., recipe ingredients)
  visibilityCondition?: string; // conditional visibility (expression)
}
```

### 4.3 Node Categories / 节点分类 (6 大类 + 子分类)

| Category / 类别      | Subcategory / 子分类                                | Count / 数量 | Purpose / 用途                  |
| -------------------- | --------------------------------------------------- | ------------ | ------------------------------- |
| **event** / 触发器   | entity, block, player, world                        | **12**       | Program entry points / 程序入口 |
| **getter** / 数据源  | entity, block, item, player, world, math            | **19**       | Read-only queries / 只读查询    |
| **condition** / 条件 | logic, entity, block, world, player                 | **14**       | Boolean branching / 布尔分支    |
| **action** / 动作    | entity, block, item, player, world, effect, utility | **27**       | Side effects / 副作用执行       |
| **flow** / 控制流    | loop, branch, jump                                  | **5**        | Control flow / 控制流           |
| **variable** / 变量  | global, local, procedure                            | **6**        | State & reuse / 状态与复用      |

**Total / 总计**: **88 core nodes** (event 16 + getter 19 + condition 15 + action 27 + flow 5 + variable 6)

---

## 5. Directory Structure / 目录结构

```
packages/
├── shared/
│   └── src/
│       └── node-library/
│           ├── NodeDefinition.ts          # 核心接口定义
│           ├── PortType.ts                # 端口类型系统
│           ├── NodeRegistry.ts            # 注册表 (运行时)
│           ├── categories.ts              # 分类定义 (双语)
│           ├── constraints.ts             # 约束系统
│           └── index.ts
│
├── codegen/
│   └── src/
│       ├── templates/
│       │   └── procedures/                # Mustache 模板 (按分类)
│       │       ├── event/
│       │       ├── getter/
│       │       ├── condition/
│       │       ├── action/
│       │       ├── flow/
│       │       └── variable/
│       ├── adapters/
│       │   ├── FabricAdapter.ts           # Fabric 代码生成 (MVP)
│       │   ├── AdapterInterface.ts        # 适配器契约
│       │   └── JavaRenderer.ts            # 通用 Java 渲染工具
│       ├── compiler/
│       │   ├── NodeGraphCompiler.ts       # 图 → Java
│       │   ├── TypeChecker.ts             # 类型检查
│       │   └── IROptimizer.ts             # IR 优化
│       └── index.ts
│
└── desktop/
    └── src/renderer/src/components/lowcode/nodes/
        ├── registry.ts                    # 前端注册表 (同步自 shared)
        ├── core-nodes/                    # 核心节点定义 (按分类文件)
        │   ├── event-nodes.ts             # 12 Event
        │   ├── getter-nodes.ts            # 19 Getter
        │   ├── condition-nodes.ts         # 14 Condition
        │   ├── action-nodes.ts            # 27 Action
        │   ├── flow-nodes.ts              # 5 Flow
        │   └── variable-nodes.ts          # 6 Variable
        │   ├── action-nodes.ts            # 27 Action
        │   ├── flow-nodes.ts              # 5 Flow
        │   └── variable-nodes.ts          # 6 Variable
        ├── CoreNode.tsx                   # 通用渲染组件
        └── index.ts
```

---

## 6. Code Generation Flow / 代码生成流程

```typescript
async function compileNodeGraph(
  graph: NodeGraph,
  options: CompileOptions,
): Promise<CompilationResult> {
  // 1. Type Check / 类型检查
  const typeErrors = TypeChecker.check(graph);
  if (typeErrors.length) return { errors: typeErrors };

  // 2. Topological Sort + Dependency Analysis / 拓扑排序 + 依赖分析
  const executionOrder = topologicalSort(graph);

  // 3. Build Template Context / 构建模板上下文
  const context = buildTemplateContext(graph, executionOrder);

  // 4. Select Adapter / 选择适配器
  const adapter = getAdapter(options.targetLoader); // FabricAdapter

  // 5. Render Templates / 渲染模板
  const files = await adapter.render(context);

  // 6. Write Files / 写入项目
  await writeFiles(files, options.outputDir);

  return { files, warnings: [] };
}
```

---

## 7. Template Design / 模板设计

### 7.1 Mustache Template Example / 模板示例

```mustache
{{!-- templates/procedures/action/spawn_entity.mustache --}}
{{#serverOnly}}
// Server-side only / 仅服务端执行
if (!level.isClientSide()) {
{{/serverOnly}}

    // Resolve entity type / 解析实体类型
    EntityType<?> entityType = {{entityTypeExpr}};

    // Calculate spawn position / 计算生成位置
    BlockPos spawnPos = {{positionExpr}};
    Vec3 spawnVec = Vec3.atBottomCenterOf(spawnPos);

    // Spawn entity / 生成实体
    Entity entity = entityType.create(level);
    if (entity != null) {
        entity.moveTo(spawnVec.x, spawnVec.y, spawnVec.z, {{yawExpr}}, {{pitchExpr}});
        level.addFreshEntity(entity);

        {{#if outputPorts.entity}}
        // Output to port / 输出到端口
        {{outputPorts.entity}} = entity;
        {{/if}}
    }

{{#serverOnly}}
}
{{/serverOnly}}
```

### 7.2 Template Context Variables / 模板上下文变量

| Variable                | Type    | Description                                  |
| ----------------------- | ------- | -------------------------------------------- |
| `entityTypeExpr`        | string  | Java expression resolving to `EntityType<?>` |
| `positionExpr`          | string  | Java expression resolving to `BlockPos`      |
| `yawExpr` / `pitchExpr` | string  | Rotation expressions                         |
| `outputPorts.*`         | string  | Output port variable names                   |
| `serverOnly`            | boolean | Whether to wrap in `!level.isClientSide()`   |

---

## 8. First Batch: Event Nodes / 首批：Event 触发器 (16 个)

| Node ID / 节点ID            | Label (zh/en)                            | Trigger / 触发时机         | Outputs / 输出                                                    | Source API / 原版 API                   |
| --------------------------- | ---------------------------------------- | -------------------------- | ----------------------------------------------------------------- | --------------------------------------- |
| `on_block_break`            | 方块被破坏 / Block Broken                | Player breaks block        | `world`, `block_pos`, `player`, `block_state`                     | `BlockEvent.BreakEvent`                 |
| `on_block_place`            | 方块被放置 / Block Placed                | Player places block        | `world`, `block_pos`, `player`, `block_state`, `item_stack`       | `BlockEvent.EntityPlaceEvent`           |
| `on_entity_death`           | 实体死亡 / Entity Death                  | Entity dies                | `world`, `entity`, `damage_source`, `player?`                     | `LivingDeathEvent`                      |
| `on_entity_hurt`            | 实体受伤 / Entity Hurt                   | Entity hurt (pre)          | `world`, `entity`, `damage_source`, `amount`                      | `LivingHurtEvent`                       |
| `on_player_interact_block`  | 玩家右键方块 / Player Right-Click Block  | Player right-clicks block  | `world`, `player`, `block_pos`, `direction`, `hand`, `item_stack` | `PlayerInteractEvent.RightClickBlock`   |
| `on_player_interact_entity` | 玩家右键实体 / Player Right-Click Entity | Player right-clicks entity | `world`, `player`, `entity`, `hand`, `item_stack`                 | `PlayerInteractEvent.EntityInteract`    |
| `on_player_use_item`        | 玩家使用物品 / Player Use Item           | Player starts using item   | `world`, `player`, `item_stack`, `hand`                           | `PlayerInteractEvent.RightClickItem`    |
| `on_player_join`            | 玩家加入 / Player Join                   | Player joins server        | `world`, `player`                                                 | `ServerPlayConnectionEvents.JOIN`       |
| `on_player_quit`            | 玩家退出 / Player Quit                   | Player leaves server       | `world`, `player`                                                 | `ServerPlayConnectionEvents.DISCONNECT` |
| `on_player_attack_block`    | 玩家左键方块 / Player Attack Block       | Player left-clicks block   | `world`, `player`, `block_pos`, `direction`, `hand`, `item_stack` | `AttackBlockCallback`                   |
| `on_item_pickup`            | 玩家拾取物品 / Player Pickup Item        | Item pickup (Mixin stub)   | `world`, `player`, `item_stack`                                   | — (needs Mixin)                         |
| `on_world_tick`             | 世界每 Tick / World Tick                 | Server tick end            | `world`, `tick_count`                                             | `LevelEvent.Tick`                       |
| `on_player_tick`            | 玩家每 Tick / Player Tick                | Player tick                | `world`, `player`, `tick_count`                                   | `PlayerEvent.Tick`                      |
| `on_entity_spawn`           | 实体生成 / Entity Spawn                  | Entity joins world         | `world`, `entity`                                                 | `EntityJoinLevelEvent`                  |
| `on_block_neighbor_change`  | 邻居方块变化 / Neighbor Block Change     | Neighbor update            | `world`, `block_pos`, `neighbor_pos`, `block_state`               | `NeighborNotifyEvent`                   |
| `on_explosion`              | 爆炸发生 / Explosion                     | Explosion detonates        | `world`, `explosion_center`, `radius`, `affected_blocks`          | `ExplosionEvent.Detonate`               |

**Each Event Node Outputs / 每个 Event 节点输出**:

- `void` control flow (next action) / 控制流出口
- Context data ports per table above / 上下文数据端口

---

## 9. Development Workflow / 开发工作流

### 9.1 Per Node Checklist / 单节点清单

| Step                | Artifact                                          | Verification                            |
| ------------------- | ------------------------------------------------- | --------------------------------------- |
| 1. Design / 设计    | `NodeDefinition` + `PortDefinition[]`             | Type-check passes / 类型检查通过        |
| 2. Template / 模板  | `.mustache` in `templates/procedures/{category}/` | Renders valid Java / 生成合法 Java      |
| 3. Adapter / 适配器 | `FabricAdapter` integration                       | Compiles in test mod / 测试模组编译通过 |
| 4. Test / 测试      | Unit + Integration                                | 2505 tests pass / 全测试通过            |
| 5. Docs / 文档      | Bilingual in definition + this file               | Complete / 完整                         |

### 9.2 Compliance / 合规

- **Clean Room**: Only read MCreator Wiki/source for semantics; never copy JSON/FTL
- **Attribution**: `aggregatedFrom` field tracks reference sources
- **License**: All output Apache-2.0

---

## 10. Roadmap / 路线图

| Phase         | Target                | Nodes   | Deliverable                                           |
| ------------- | --------------------- | ------- | ----------------------------------------------------- |
| **MVP (Now)** | Fabric 1.20.1         | 88 core | Event + Getter + Condition + Action + Flow + Variable |
| **V1.1**      | Forge/NeoForge        | +15     | Adapter plugins                                       |
| **V1.2**      | Custom Nodes          | ∞       | Plugin SDK + Marketplace                              |
| **V2.0**      | Bedrock / Data-driven | —       | Cross-edition IR                                      |

---

## 11. Pipeline Unification / 管线统一

旧粗粒度逻辑（event / condition / action）加载时按事件闭包整体迁入 88
（`apps/desktop/src/renderer/src/lib/migrateLegacyLogic.ts`，同 id 换 kind +
重建端口 + 补数据边 + 控制把手重映射）。单节点语义对不上时做 1:N 展开：
`health_below/above` → `get_entity_health` + `compare_numbers`，
`distance_less/greater` → `get_distance` + `compare_numbers`，
`biome_is` → `get_biome_at` + `compare_strings`（合成节点 id 派生
`<原id>__src`）。预览经 `useUnifiedCompile` 单入口双引擎分区合并；
旧三件已从新建面板下架（渲染 + 编译保留给缺口链）。

Known gaps kept legacy / 整链保留旧管线的缺口（永久）：
仅 `custom` 事件/条件/动作（用户手写 Java，走代码节点）。
结构性保留（与类型无关）：缺上下文（事件无 player/pos）、调过程、
共享下游、禁用/锁定链同样整链保留。
`on_item_pickup` 无稳定 Fabric API（旧管线曾引用不存在的
`PlayerPickupItemCallback`），新侧已改走
Mixin 接线（`@Inject` 到 vanilla 方法，见 §11.2），旧管线亦改走
`ModItemPickupMixin`（`@Inject ItemEntity.onPlayerCollision` TAIL +
`notifyItemPickedup` 入口）；诚实语义限制
（仅通知、无取消；pickup 按碰撞尝试触发）写在模板注释与文档里。

### 11.1 Mappings 与 javac 冒烟 / Mappings & javac smoke

- 新管线（`packages/codegen`）目标为 **Yarn 映射**
  （build.gradle：`mappings "net.fabricmc:yarn:1.20.1+build.1:v2"`；
  无 `loom {}` 配置块——loom 1.9 默认即 Yarn，不认 `mappings "yarn"`
  写法）：Mojang 官方映射下
  `TypedActionResult` / `ActionResult` 等 registrar 必需类型只有
  intermediary 名、无 official 名，4 个订阅块无法编译，故从 Mojang
  切到 Yarn。83→88 定义的 sourceApi、全部 91 模板、
  `java-types` 类型/默认值、`node-renderer` 字面量解析、
  `fabric-events` 订阅表均按 Yarn 名编写，并逐条对 yarn 1.20.1
  tiny 映射核对（Y/N 审计）。
- `packages/codegen/src/javac-smoke.test.ts`：kitchen-sink 图覆盖全部
  88 kind、全接线（16 个事件过程）→ 真编译 → 落盘 → 对手写最小
  Yarn 版 MC/Fabric 桩（`test-fixtures/mc-stubs`，成员形状对标
  1.20.1 Yarn）跑 `javac`，断言 0 错误；无 JDK 环境自动跳过。
  该测试累计抓到：locals 与方法形参重声明、注册器跨类裸调方法、
  getter 语句被发射器丢弃、Mojang/Yarn 名混用（如 `is`→`isOf`、
  `getDayTime`→`getTimeOfDay`、`BuiltInRegistries`→`Registries`）、
  跨方法变量作用域（游离控制节点）、`Entity.age` 桩缺字段。
- 真实 Gradle 构建（2026-09，Gradle 8.14.3 + JDK 17，loom 1.9.2）：
  kitchen-sink 全量产物 `gradle build` **BUILD SUCCESSFUL**
  （含 `compileJava` + `remapJar`，产出 `KitchenSink-1.0.0.jar`：
  7 个类 + `fabric.mod.json` + `mixins.json` + refmap）。
  此前手搭 loom 等价链（tiny-remapper 直编）已先验过 `javac` 0 错误。
  真构建抓到的模板 bug（已修）：fabric-api 的 group 写错
  （`net.fabricmc:fabric-api` 实为 `net.fabricmc.fabric-api:fabric-api`）；
  `fabric-mixin-compile-extensions:1.1.0` 版本不存在且多余，已删
  （loom 自带 Mixin 注解处理）；`settings.gradle` 的
  `useModule("com.fabricmc:fabric-loom:…")` group 写错，
  应为 `net.fabricmc:fabric-loom`；`fabric_loader_version`
  属性名与模板引用不一致，已统一；`loom {}` 块整体删除
  （loom 1.9 不认旧写法）。环境坑：Gradle 官方发行版走 GitHub
  （用腾讯镜像解决）；JDK 26 跑不动 Gradle（Groovy major-70），
  本体与 toolchain 均用 JDK 17；`JAVA_HOME` 含空格在 `cmd /c`
  下触发 gradle.bat 校验误报，改走 `PATH` 置顶 JDK 17。
  早前手写桩掩盖的两处真 bug（已修）：
  `grant_item` 调了不存在的 `PlayerInventory.addStack`（实为私有），
  改为公开的 `insertStack`；`on_entity_spawn` 订阅表包路径写错
  （`entity.event.v1` → 实际的 `event.lifecycle.v1.ServerEntityEvents`，
  旧错桩已删除并按实物重建）。其余 11 路订阅的 lambda 形状、
  全部过程方法体经真编译确认无误。
- 已知分裂（已关闭，2026-09）：旧管线（`packages/core` 生成器、
  desktop 本地 `compileNodeGraph/compileVariable.ts`）已迁到 Yarn
  映射（`mappings "net.fabricmc:yarn:…:v2"`，`promoteToPurecode` 的
  build.gradle 模板同步；`detectMixedMappingConflict` 在 apply 时拦截
  新旧映射混用）。旧管线全量产物（12 种事件 × 10 种条件 × 12 种动作 +
  物品/方块/流体/生物群系/维度/GUI/结构/实体/机器 + 双 Mixin）经
  **真实 Gradle 构建验证**（Gradle 8.14.3 + JDK 17 + loom 1.9.2，
  `gradle build` **BUILD SUCCESSFUL**，`compileJava` + `remapJar`，
  产出 `oldpipe-1.0.0.jar`：21 个类 + refmap）。
  迁移中抓到的旧管线 Yarn bug（已修，均经 `javap` 对真 yarn
  1.20.1 服务端/客户端 jar 核对）：`Registries.register` 不存在
  （静态方法在 `Registry` 上，全文件替换，legacy 适配器同病同修）；
  `FabricItemSettings`（fabric-item-api 未在最小依赖中）改回
  `new Item.Settings()`；`PigEntity` 等具体类按 passive/mob 分包
  import；`EntityType.Builder.sized` 实为 `setDimensions`；
  `Biome.Builder`/`BiomeEffects`（旧名 `BiomeBuilder`/
  `BiomeSpecialEffects`）、`effects`/`spawnSettings`
  （旧名 `specialEffects`/`mobSpawnSettings`）、
  `GenerationSettings.INSTANCE`；`DimensionType` effects 为
  `Identifier`（2-arg `of`）、infiniburn 用 `new Identifier(单串)`；
  `Biome/DimensionType/Structure/StructureSet` 属动态注册表，
  改为 `public static final` 常量占位（配套数据包 JSON 才实际生效，
  `initialize()` 留注释，不再 `Registry.register`）；
  `Structure.Config` 泛型用显式见证
  （`RegistryEntryList.<Biome>of(List.of())` 等）；
  `FlowableFluid` 补全 `Fluid` 抽象方法
  （`isStill`/`toBlockState`/`getBlastResistance` 等，水样占位值）；
  `server.overworld()` → `server.getOverworld()`；
  `getDescriptionId()` → `getTranslationKey()`；
  `BlockItem.place` 注释纠正（唯一 public 单参 + protected 辅助，
  描述符锁定无双触发）。
  裸 `javac` 探针剩余 5 个错误全部来自
  `ScreenHandlerType` 构造器/Factory 与
  `BlockEntityType.Builder.create` 的 Factory 接口访问级别，
  二者均被 `fabric-transitive-access-wideners-v1` 放行
  （AW 文件实测含 `class_3917$class_3918` accessible +
  构造器、`class_2591$class_5559` extendable），真 loom 构建
  0 错误证实。附带：共享 `LOADER_VERSIONS` 的 1.20.1
  `fabricLoomVersion` 由 `1.7-SNAPSHOT` 升到 `1.9.2`
  （1.7-SNAPSHOT 与 Gradle 8.14 不兼容；1.20.4/1.20.6/1.21.1
  行未动，疑似同病，待验）。
  旧管线（仅服务 `custom` 链）的 Mojang 订阅写法已随迁移删除，
  无残留。

### 11.2 Mixin 接线表 / Mixin wiring

无稳定 Fabric API 的 4 种触发器走 Mixin（`@Inject`，notify-only，
无取消；`cancel_event` 仍是 no-op）。方法描述符逐条经 `javap`
对真实 yarn 映射 1.20.1 服务端 jar 核对；生成类对真 MC +
sponge-mixin 编译通过。

| 触发器                     | 目标类                           | 注入方法                                                                                                                                                             | 语义限制                                       |
| -------------------------- | -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| `on_block_place`           | `ServerPlayerInteractionManager` | `interactBlock(…):ActionResult` TAIL，guard `cir.getReturnValue().isAccepted()`                                                                                      | 右键交互被接受才触发（含开 GUI，不只放置）     |
| `on_block_neighbor_change` | `World`                          | 3-arg 与 5-arg `updateNeighbor` 各注一个 TAIL（已证无委托，不会双触发）；5-arg 参数顺序按 javadoc（`pos`/`sourcePos`）                                               | 客户端世界由 `instanceof ServerWorld` 守卫过滤 |
| `on_explosion`             | `World`                          | 10-arg `createExplosion` TAIL（其余 4 个重载经字节码证实漏斗进它，一注全覆盖）；`radius` 取 `power`，`affected_blocks` 取 `cir.getReturnValue().getAffectedBlocks()` | 只覆盖 `World.createExplosion` 路径            |
| `on_item_pickup`           | `ItemEntity`                     | `onPlayerCollision(PlayerEntity):V` TAIL                                                                                                                             | 碰撞尝试即触发（背包满时 vanilla 也会拒绝）    |

实现约定：mixin 类中 `this` 在编译期是 mixin 类型，一律经
`(Object)` 强转访问目标成员（javac 可验，不用 `@Shadow` 魔法）；
服务端判断统一用 `instanceof ServerWorld` 守卫，避免客户端
`ClassCastException`。`fabric.mod.json` 的 `mixins` 键仅在存在
Mixin 事件时生成（悬空引用会让 Fabric Loader 启动崩溃）。

---

## 12. References / 参考

- [MCreator Procedure System](https://mcreator.net/wiki/procedure-system) — _Semantic reference only_
- [Minecraft Wiki: Events](https://minecraft.wiki/w/Event) — _Vanilla API source_
- [Fabric Wiki: Events](https://fabricmc.net/wiki/tutorial:events) — _Target API_
- [Apache-2.0 License](https://www.apache.org/licenses/LICENSE-2.0) — _Our license_
