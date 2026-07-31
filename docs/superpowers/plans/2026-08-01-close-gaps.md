# 代码缺口修复计划 — 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复代码审计发现的 4 个真实功能缺口：(A) Fabric 事件注册映射不全（9 种事件生成 TODO 占位）、(B) condition/action 的 Java 实现全部为 TODO 占位、(C) 低代码 loop 节点的循环体 condition/procedure 编译占位、(D) 生物群系仍输出 1.21+ 废弃的 `surface_builder` 字段。

**现状证据：**

- `fabric-adapter.ts:922-944` — `fabricEventRegistration` 仅映射 tick/player_join/player_quit/block_break 4 种，其余（含 `player_right_click_block`）落入 `// TODO: 注册 ... 事件`
- `fabric-adapter.ts:866-891` — `check_<id>` 恒返回 `true`、`execute_<id>` 空方法体，全部 TODO 占位（NeoForge 同构）
- `compileNodeGraph.ts:844-876` — `compileLoopBody` 对 condition/procedure 只产出 `// TODO: loop body ... not yet compiled` 注释 + warning
- `datapack-generator.ts:515-522` — biome 输出废弃的 `surface_builder` 字段（1.21+ 忽略）

**事件/条件/动作全量清单（`mod-spec.ts:411-486`）：**

- eventType（13）：player_right_click_block / player_right_click_item / player_left_click / block_break / block_place / entity_death / entity_hurt / item_use / item_pickup / player_join / player_quit / tick / custom
- conditionType（11）：has_item / health_below / health_above / distance_less / distance_greater / is_day / is_night / is_raining / biome_is / block_is / custom
- actionType（13）：spawn_entity / give_item / take_item / teleport / damage / heal / set_block / remove_block / play_sound / send_message / summon_lightning / give_effect / custom

**约束（保持生成的 Java 可编译）：**

- Fabric 侧只映射「Fabric API 1.21 真实存在」的事件；无现成 API 的（entity_death / entity_hurt / block_place）保留 TODO 注释但写明原因
- check/execute 方法签名保持 `(Object event)`，内部用 `instanceof` 安全转型实现语义；转型不匹配时返回安全默认值（condition=false / action 空执行）
- 所有行为变更必须有测试先行（TDD：先改/加断言 → 红 → 实现 → 绿）

---

## Task 1: Fabric 事件注册补齐

**Files:**

- Modify: `packages/core/src/generators/mod/fabric-adapter.ts`
- Modify: `packages/core/src/generators/mod/fabric-adapter.test.ts`

**Fabric API 1.21 真实事件映射：**

| eventType | Fabric API |
| --------- | ---------- |
| player_right_click_block | `net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT`（lambda `(player, world, hand, hitResult) -> ActionResult`，调用 `handle_x(player)` 后返回 `ActionResult.PASS`） |
| player_right_click_item | `net.fabricmc.fabric.api.event.player.UseItemCallback.EVENT` |
| player_left_click | `net.fabricmc.fabric.api.event.player.AttackBlockCallback.EVENT` |
| item_use | `UseItemCallback.EVENT`（与 right_click_item 同回调，语义上区分） |
| item_pickup | `net.fabricmc.fabric.api.event.player.PlayerPickupItemCallback.EVENT`（lambda `(player, itemEntity) -> boolean`，调用后返回 `false` 表示不拦截） |
| entity_death / entity_hurt / block_place / custom | 保留 `// TODO:` 注释，补充「Fabric API 无现成事件，需 Mixin 实现」说明 |

- [ ] **Step 1:** 更新 `fabric-adapter.test.ts` 中 `player_right_click_block` 的断言（现断言 `contains('TODO: 注册 player_right_click_block 事件')` → 改为断言 `contains('UseBlockCallback.EVENT.register')`），先跑红
- [ ] **Step 2:** 实现 `fabricEventRegistration` 的 5 个新 case（UseBlockCallback / UseItemCallback / AttackBlockCallback / PlayerPickupItemCallback ×2）
- [ ] **Step 3:** 新增测试覆盖 item_pickup / item_use / player_left_click 注册代码
- [ ] **Step 4:** 跑 `packages/core` 测试全绿

**验证标准：** fabric-adapter.test 通过；生成代码无新增 TODO（entity_death/entity_hurt/block_place 除外，注释含原因说明）。

---

## Task 2: condition/action 的 Java 实现

**Files:**

- Modify: `packages/core/src/generators/mod/fabric-adapter.ts`
- Modify: `packages/core/src/generators/mod/neoforge-adapter.ts`
- Modify: `packages/core/src/generators/mod/fabric-adapter.test.ts` / `neoforge-adapter.test.ts`

**设计：** 在 adapter 中新增受保护方法 `conditionCheckCode(cond): string`（返回方法体）与 `actionExecuteCode(action): string`（返回方法体），两个 adapter 共用同一语义实现（Java 代码与 loader 无关，仅 import 有差异——用全限定名规避）。

**可安全转型实现的子集（其余保留 TODO 注释 + 说明）：**

| 类型 | Java 实现要点（event instanceof 转型） |
| ---- | -------------------------------------- |
| is_day / is_night | `event instanceof ServerLevel level` → `level.isDay()`（is_night 取反） |
| is_raining | `ServerLevel` → `level.isRaining()` |
| health_below / health_above | `ServerPlayer player` → `player.getHealth()` 与 `args.threshold` 比较 |
| has_item | `ServerPlayer` → `player.getInventory().countItem(Items.<id>) > 0`（未知 item 用 `Registry.ITEM.get(ResourceLocation.parse(id))`） |
| send_message | `ServerPlayer` → `player.sendSystemMessage(Component.literal(msg))` |
| damage / heal | `ServerPlayer` → `player.hurt(player.damageSources().generic(), amount)` / `player.heal(amount)` |
| give_item / take_item | `ServerPlayer` → `player.getInventory().place(new ItemStack(item, count))` / `player.getInventory().clear()`（take 简化：remove 指定数量用 `dropAll` 不实现，保留注释） |
| teleport | `ServerPlayer` → `player.teleportTo(level, x, y, z, yaw, pitch)`（args 缺省用玩家当前位置） |
| give_effect | `ServerPlayer` → `player.addEffect(new MobEffectInstance(MobEffects.<effect>, duration, amplifier))` |
| summon_lightning | `ServerLevel` → `level.addFreshEntity(new LightningBolt(EntityType.LIGHTNING_BOLT, level))` |
| distance_* / biome_is / block_is / spawn_entity / set_block / remove_block / play_sound / custom | 保留 TODO + 说明（需要更多上下文或复杂坐标逻辑） |

- [ ] **Step 1:** 抽取 `conditionCheckCode` / `actionExecuteCode` 到 fabric-adapter（protected），check/execute 方法体引用
- [ ] **Step 2:** 按上表实现子集；测试先行：为 is_day / send_message / give_item / heal 各加断言（`expect(content).toContain('level.isDay()')` 等）→ 红 → 绿
- [ ] **Step 3:** neoforge-adapter 复用（extend 或 copy 公共实现），更新 neoforge 测试
- [ ] **Step 4:** 全量 `packages/core` 测试绿

**验证标准：** 常用子集（≥8 个类型）产出真实 Java 逻辑；未实现类型保留带原因说明的 TODO。

---

## Task 3: loop 循环体 condition/procedure 编译

**Files:**

- Modify: `apps/desktop/src/renderer/src/lib/compileNodeGraph.ts`
- Modify: `apps/desktop/src/renderer/src/lib/e2e-pipeline.test.ts`

**现状：** `compileLoopBody` 只拼接 code 节点文本；condition 产出占位注释 + warning，procedure 同样占位。而主流程中 procedure 节点会被编译为 ProcedureSpec（`compileProcedureNode`），adapter 生成 `procedure_<name>(event);` 调用。

**设计（小步，不重构）：**

- [ ] **Step 1:** 主流程 `compileNodeGraph` 中，遍历 `graph.subgraphs` 时额外收集 loop 引用子图内的 condition 节点 → 加入 `spec.conditions`（带 `conditionId`，供 adapter 生成 `check_<id>` 方法）
- [ ] **Step 2:** `compileLoopBody` 中 condition 节点 → 输出 `if (check_<id>(event)) { ... }`（读取子图内 action/code 节点作为 if 体），移除占位注释；无下游时输出空 if + warning
- [ ] **Step 3:** 把 loop 子图内 procedure 节点合并进主流程 `procedures` 输出（复用 `compileProcedureNode` 语义：从子图节点收集 condition/action），`compileLoopBody` 中 procedure 节点 → `procedure_<name>(event);`
- [ ] **Step 4:** 更新 `e2e-pipeline.test.ts:656` 附近断言（现断言 `contains('TODO')`）→ 断言 `procedure_` 调用与 `check_` 条件存在；新增 loop body 含 condition + procedure 的端到端用例
- [ ] **Step 5:** 跑 `apps/desktop` 低代码相关测试绿

**验证标准：** 无新增「loop body ... not yet compiled」占位输出；loop 体内 condition/procedure 生成真实调用；e2e 断言更新通过。

---

## Task 4: 生物群系 surface_rule

**Files:**

- Modify: `packages/shared/src/schemas/datapack-spec.ts`
- Modify: `packages/core/src/generators/datapack/datapack-generator.ts`
- Modify: `packages/core/src/generators/datapack/datapack-generator.test.ts`

**设计：**

- [ ] **Step 1:** `BiomeSpec` 新增 `surfaceRule: z.record(z.unknown()).optional()`（完整 surface_rule JSON，优先级最高）
- [ ] **Step 2:** `generateBiome` 移除 `surface_builder` 输出；surface_rule 取值顺序：`spec.surfaceRule`（若为对象）→ `surfaceBuilder` 字符串映射：`'minecraft:grass'` → `{"type":"minecraft:grass"}`、`'minecraft:stone'` → `{"type":"minecraft:stone"}`、其余 JSON 字符串安全解析（`safeJsonParse`）→ 无值时不输出字段
- [ ] **Step 3:** 更新 datapack-generator.test.ts：断言 `surface_builder` 的用例改为断言 `surface_rule`；新增 surfaceRule 对象直通用例
- [ ] **Step 4:** `packages/shared` + `packages/core` 测试绿

**验证标准：** 生成 JSON 无 `surface_builder` 字段；`surface_rule` 按优先级正确输出。

---

## Task 5: 最终验证与提交

- [ ] **Step 1:** `pnpm -r typecheck` — 0 错误
- [ ] **Step 2:** `pnpm -r test` — 全部通过
- [ ] **Step 3:** `pnpm lint` — 0 errors（既有 warnings 忽略）
- [ ] **Step 4:** 按 Task 分组提交（commit message 遵循 conventional commits）：

  ```powershell
  git add packages/core/src/generators/mod/fabric-adapter.ts packages/core/src/generators/mod/fabric-adapter.test.ts
  git commit -m "feat(core): map more Fabric API events in ModEvents registration"
  git add packages/core/src/generators/mod/neoforge-adapter.ts packages/core/src/generators/mod/neoforge-adapter.test.ts
  git commit -m "feat(core): implement common condition/action Java logic for Fabric and NeoForge"
  git add apps/desktop/src/renderer/src/lib/compileNodeGraph.ts apps/desktop/src/renderer/src/lib/e2e-pipeline.test.ts
  git commit -m "feat(lowcode): compile condition and procedure nodes in loop bodies"
  git add packages/shared/src/schemas/datapack-spec.ts packages/core/src/generators/datapack/
  git commit -m "feat(datapack): emit surface_rule instead of deprecated surface_builder"
  ```

---

## 验证标准汇总

- [ ] Fabric 事件注册：5 个新事件映射真实 Fabric API，生成代码可编译
- [ ] condition/action：≥8 个常用类型产出真实 Java 逻辑（is_day/send_message/give_item/heal 等有断言）
- [ ] loop 循环体：condition/procedure 生成真实调用，无「not yet compiled」占位
- [ ] biome：无 `surface_builder`，有 `surface_rule`（含对象直通）
- [ ] typecheck / test / lint 全绿
