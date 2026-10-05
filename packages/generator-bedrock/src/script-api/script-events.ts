/**
 * `world.afterEvents` / `world.beforeEvents` 事件白名单与字段绑定表。
 *
 * 为什么必须逐个事件登记字段，而不是只记一个订阅路径
 * ───────────────────────────────────────────────────
 * Script API 同一个事件在不同版本上**字段名不同、是否存在也不同**：
 * - `EntityDieAfterEvent` 提供 `deadEntity`（不是 `entity`）；
 * - `PlayerSpawnAfterEvent` 提供 `player` + `initialSpawn` + `dimension`；
 * - `PlayerBreakBlockBeforeEvent` 提供 `player` + `block` + `cancel`；
 * - 1.x 的 `worldInitialize` 在 2.x 改名为 `worldLoad`。
 * 生成器如果只认「事件名 = 订阅路径」，不去核实该版本上这个事件的字段，
 * 就会产出 `event.entity.addTag(...)` 这种在 `deadEntity` 事件上必然
 * TypeError 的代码 —— 运行时抛错会让整个脚本模块加载失败，
 * 一个事件名写错就连带包里所有逻辑一起哑掉。
 *
 * 所以本文件把「事件名 → 可安全引用的字段表达式」显式登记，
 * 并按 ServerApiFamily 分成两份从官方 d.ts 实读的表。
 * 未登记的事件一律走 `unsupported.ts`（不生成 subscribe，产出显性占位 + 清单）。
 *
 * 来源：npm `@minecraft/server` 的 `index.d.ts`
 * - 1.x 族实读版本：`1.13.0`
 * - 2.x 族实读版本：`2.2.0`
 */

import type { ServerApiFamily } from './script-versions.js';

/** 一次事件回调里可用的绑定表达式（JS 源码片段，插入到处理器函数体内） */
export interface EventBinding {
  /** 主实体表达式（addTag/addEffect/give_item 等实体动作用它） */
  entity?: string;
  /** 次实体表达式（攻击来源等；生成时绑定为局部变量 `other`） */
  otherEntity?: string;
  /** 玩家表达式（定向 sendMessage / 显示表单用它） */
  player?: string;
  /** 方块表达式（set_block 定位 / 给方块打标签用它） */
  block?: string;
  /** 维度表达式（spawn_entity / play_sound 需要 dimension） */
  dimension?: string;
  /** 该事件是否支持 `event.cancel = true`（仅 before 事件） */
  cancellable?: boolean;
}

/** `world.afterEvents.<name>` 已验证事件（两个家族各自实读） */
const AFTER_EVENTS: Record<ServerApiFamily, Record<string, EventBinding>> = {
  // 实读自 @minecraft/server@1.13.0 的 WorldAfterEvents（1.x 有 worldInitialize）
  '1.x': {
    entitySpawn: { entity: 'event.entity', dimension: 'event.dimension' },
    entityDie: { entity: 'event.deadEntity', dimension: 'event.deadEntity.dimension' },
    entityHurt: {
      entity: 'event.hurtEntity',
      otherEntity: 'event.damagingEntity',
      dimension: 'event.hurtEntity.dimension',
    },
    entityRemove: { entity: 'event.entity', dimension: 'event.entity.dimension' },
    entityLoad: { entity: 'event.entity', dimension: 'event.entity.dimension' },
    playerSpawn: { entity: 'event.player', player: 'event.player', dimension: 'event.dimension' },
    playerJoin: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
    },
    playerLeave: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
    },
    playerBreakBlock: {
      entity: 'event.player',
      player: 'event.player',
      block: 'event.block',
      dimension: 'event.block.dimension',
    },
    playerPlaceBlock: {
      entity: 'event.player',
      player: 'event.player',
      block: 'event.block',
      dimension: 'event.dimension',
    },
    playerGameModeChange: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
    },
    playerInteractWithBlock: {
      entity: 'event.player',
      player: 'event.player',
      block: 'event.block',
      dimension: 'event.block.dimension',
    },
    playerInteractWithEntity: {
      entity: 'event.player',
      player: 'event.player',
      otherEntity: 'event.target',
      dimension: 'event.player.dimension',
    },
    itemUse: {
      entity: 'event.source',
      player: 'event.source',
      dimension: 'event.source.dimension',
    },
    // 1.x 独有：世界初始化完成（2.x 改名为 worldLoad）
    worldInitialize: {},
  },
  // 实读自 @minecraft/server@2.2.0 的 WorldAfterEvents
  '2.x': {
    entitySpawn: { entity: 'event.entity', dimension: 'event.dimension' },
    entityDie: { entity: 'event.deadEntity', dimension: 'event.deadEntity.dimension' },
    entityHurt: {
      entity: 'event.hurtEntity',
      otherEntity: 'event.damagingEntity',
      dimension: 'event.hurtEntity.dimension',
    },
    entityRemove: { entity: 'event.entity', dimension: 'event.entity.dimension' },
    entityLoad: { entity: 'event.entity', dimension: 'event.entity.dimension' },
    playerSpawn: { entity: 'event.player', player: 'event.player', dimension: 'event.dimension' },
    playerJoin: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
    },
    playerLeave: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
    },
    playerBreakBlock: {
      entity: 'event.player',
      player: 'event.player',
      block: 'event.block',
      dimension: 'event.block.dimension',
    },
    playerPlaceBlock: {
      entity: 'event.player',
      player: 'event.player',
      block: 'event.block',
      dimension: 'event.dimension',
    },
    playerGameModeChange: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
    },
    playerInteractWithBlock: {
      entity: 'event.player',
      player: 'event.player',
      block: 'event.block',
      dimension: 'event.block.dimension',
    },
    playerInteractWithEntity: {
      entity: 'event.player',
      player: 'event.player',
      otherEntity: 'event.target',
      dimension: 'event.player.dimension',
    },
    itemUse: {
      entity: 'event.source',
      player: 'event.source',
      dimension: 'event.source.dimension',
    },
    // 2.x 独有：世界加载完成（1.x 名为 worldInitialize）
    worldLoad: {},
  },
};

/**
 * `world.beforeEvents.<name>` 已验证事件。
 *
 * before 事件比 after 事件少得多（2.x 实读只有 10 个），且 `cancel` 的语义
 * 各不相同（`EntityRemoveBeforeEvent.cancel = true` 阻止删除、
 * `PlayerBreakBlockBeforeEvent.cancel = true` 阻止破坏）。这里只登记
 * 「cancel 可用且字段安全」的那几个。
 */
const BEFORE_EVENTS: Record<ServerApiFamily, Record<string, EventBinding>> = {
  '1.x': {
    playerBreakBlock: {
      entity: 'event.player',
      player: 'event.player',
      block: 'event.block',
      dimension: 'event.block.dimension',
      cancellable: true,
    },
    playerGameModeChange: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
      cancellable: true,
    },
    playerLeave: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
      cancellable: true,
    },
    entityRemove: {
      entity: 'event.entity',
      dimension: 'event.entity.dimension',
      cancellable: true,
    },
    itemUse: {
      entity: 'event.source',
      player: 'event.source',
      dimension: 'event.source.dimension',
      cancellable: true,
    },
  },
  '2.x': {
    playerBreakBlock: {
      entity: 'event.player',
      player: 'event.player',
      block: 'event.block',
      dimension: 'event.block.dimension',
      cancellable: true,
    },
    playerGameModeChange: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
      cancellable: true,
    },
    playerLeave: {
      entity: 'event.player',
      player: 'event.player',
      dimension: 'event.player.dimension',
      cancellable: true,
    },
    entityRemove: {
      entity: 'event.entity',
      dimension: 'event.entity.dimension',
      cancellable: true,
    },
    itemUse: {
      entity: 'event.source',
      player: 'event.source',
      dimension: 'event.source.dimension',
      cancellable: true,
    },
  },
};

/** 取指定家族的 after 事件绑定表（只读快照） */
export function afterEventBindings(
  family: ServerApiFamily,
): Readonly<Record<string, EventBinding>> {
  return AFTER_EVENTS[family];
}

/** 取指定家族的 before 事件绑定表（只读快照） */
export function beforeEventBindings(
  family: ServerApiFamily,
): Readonly<Record<string, EventBinding>> {
  return BEFORE_EVENTS[family];
}

/**
 * `tick` 是个特例：`world.afterEvents.tick` **不存在**，逐 tick 逻辑要走
 * `system.runInterval`。它与其它事件混在同一张 spec 列表里，是因为对作者来说
 * 是同一个心智模型（「每 tick / 某事件发生时」），由生成器负责分流。
 */
export const TICK_EVENT_NAME = 'tick';

/** after 事件订阅路径前缀 */
export const AFTER_EVENTS_PATH = 'world.afterEvents';
/** before 事件订阅路径前缀 */
export const BEFORE_EVENTS_PATH = 'world.beforeEvents';
