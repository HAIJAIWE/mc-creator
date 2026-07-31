# EventContext:事件参数绑定 + 后续方向排期

- 日期:2026-08-01
- 状态:计划
- 触发:用户确认六个开发方向(事件参数绑定 / Mixin 事件 / P40 / P36-37 / P41 / P30-34)

## 背景

当前 mod 生成器的问题:Fabric 回调多参数(如 `PlayerBlockBreakEvents` 有 world/player/pos/state/blockEntity),注册 lambda 却只把 player 压成单个 `Object event` 传给 handler,事件目标(方块位置/状态/物品实体)在 lambda 层即丢失。`eventArgs` 只进注释,不参与生成。

条件/动作只能硬编码操作玩家;`distance_less/greater`(需位置)、`biome_is`(需位置+level)、`block_is`(需 state)、`set_block/remove_block`(需 level+pos)、`spawn_entity`(需 level)均无法实现。

## 方案:EventContext 上下文对象

两个 loader(ModEvents.java)生成内部静态类,回调参数绑定为字段:

```java
private static class EventContext {
    ServerPlayer player = null;    // 全限定名
    ServerLevel level = null;
    BlockPos pos = null;
    BlockState state = null;
    ItemStack stack = null;
    Entity target = null;
}
```

签名统一:handle_/procedure_/check_/execute_ 收 `EventContext ctx`(原 `Object event`)。

### Fabric 绑定(按回调签名,Mojang 映射)

| eventType | 回调 | 绑定 |
|---|---|---|
| tick | END_SERVER_TICK(server) | level |
| player_join/quit | JOIN/LEAVE(player, server) | player, level |
| block_break | AFTER(world, player, pos, state, blockEntity) | player, level, pos, state |
| player_right_click_block | UseBlockCallback(player, world, hand, hitResult) | player, level, pos=hitResult.getBlockPos() |
| player_right_click_item / item_use | UseItemCallback(player, world, hand) | player, level, stack |
| player_left_click | AttackBlockCallback(player, world, hand, pos, direction) | player, level, pos |
| item_pickup | PlayerPickupItemCallback(player, itemEntity) | player, level, target, stack |
| entity_death/hurt/block_place | 需 Mixin(下项工作) | 保持 TODO |
| custom | default | 空 ctx |

### NeoForge 绑定(事件 getter)

| eventType | 事件类 | 绑定 |
|---|---|---|
| player_right_click_block | RightClickBlock | player=getEntity(), pos=getPos() |
| player_right_click_item/item_use | RightClickItem | player=getEntity(), stack=getItemStack() |
| player_left_click | LeftClickBlock | player=getEntity(), pos=getPos() |
| block_break | BlockEvent.BreakEvent | player=getPlayer(), pos=getPos(), state=getState() |
| block_place | BlockEvent.EntityPlaceEvent | entity=getEntity(), pos=getPos(), state=getBlockSnapshot().getReplacedBlock() |
| entity_death | LivingDeathEvent | target=getEntity() |
| entity_hurt | LivingHurtEvent | target=getEntity() |
| item_pickup | EntityItemPickupEvent | player=getEntity(), stack=getItem() |
| player_join/quit | PlayerLoggedInEvent/Out | player=getEntity() |
| tick | ServerTickEvent | level=getServer() |

### event-logic 改造(值从 ctx 读取,不再 instanceof 转型)

- is_day/is_night/is_raining:level → `if (ctx.level != null) return ctx.level.isDay();`
- health_below/above、has_item、send_message、damage、heal、give_item、take_item、give_effect:player → `if (ctx.player != null)`
- teleport:player + 坐标优先 `ctx.pos` 回退 x/y/z 参数
- summon_lightning:level → ctx.level,坐标优先 ctx.pos
- **新增实现**:
  - distance_less/distance_greater:`ctx.pos` 与 args(x/y/z) 的欧氏距离比较
  - biome_is:`ctx.level.getBiome(ctx.pos).is(BuiltInRegistries.BIOME.get(...))`
  - block_is:`ctx.state.is(BuiltInRegistries.BLOCK.get(...))`
  - set_block/remove_block:ctx.level + ctx.pos(未实现 → 用 args 或 ctx.pos)
  - spawn_entity:ctx.level + ctx.pos

## 验收标准

- fabric/neoforge 单测:断言 lambda 生成含 ctx 绑定(如 `ctx.pos = hitResult.getBlockPos();`),方法签名为 `EventContext ctx`
- event-logic 生成片段不再含 `event instanceof`
- e2e-pipeline 场景 5 断言更新:`check_lc1(event)` → `check_lc1(ctx)`
- distance_less/greater、biome_is、block_is 从「未实现 TODO」转为真实逻辑(单测断言生成体)
- `pnpm -r typecheck` / `pnpm -r test` / lint 全绿
- 独立 commit

## 后续方向(用户已确认,按序执行)

1. **[本项] 事件参数绑定(EventContext)**
2. **Mixin 事件补齐**:entity_death / entity_hurt / block_place(Fabric 侧生成 Mixin 类 + mixins.json,Fabric adapter 注册引用);NeoForge 侧已可直接用 addListener 补齐(无 Mixin 需求)
3. **P40 过程节点增强**:Procedure 封装 + PureCode 模式 + codeLock
4. **P36/P37 脚本生成器**:KubeJS / CraftTweaker 生成器增强
5. **P41 BuildCache**:构建缓存 + recipe-adapter 配方生成扩展
6. **P30-P34 UI 面**:专业图标 / Toast / Splitter / Dashboard 统计
