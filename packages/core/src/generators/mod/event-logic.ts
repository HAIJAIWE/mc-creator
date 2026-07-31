/**
 * 事件条件/动作的 Java 方法体生成（Fabric 与 NeoForge 共享）。
 *
 * check_<id>(Object event) / execute_<id>(Object event) 的方法体：
 * 事件对象通过 instanceof 安全转型为 ServerPlayer / ServerLevel，
 * 转型不匹配时条件返回 false、动作静默跳过，保证生成的代码始终可编译。
 *
 * 已实现常用子集；其余类型保留 TODO 注释并说明原因。
 * 全部使用全限定名，避免 import 缺失导致编译错误。
 */

import type { ConditionSpec, ActionSpec } from '@mc-creator/shared';

/** 从 args 读取数值参数（兼容 number 与字符串），缺省返回默认值 */
function numArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** 从 args 读取字符串参数，缺省返回默认值 */
function strArg(args: Record<string, unknown>, key: string, fallback: string): string {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  return String(v);
}

/** 资源 ID 转全限定 Java 表达式：Registry.ITEM.get(ResourceLocation.parse("minecraft:diamond")) */
function itemLookupExpr(itemId: string): string {
  return `net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse("${itemId}"))`;
}

const SERVER_PLAYER = 'net.minecraft.server.level.ServerPlayer';
const SERVER_LEVEL = 'net.minecraft.server.level.ServerLevel';

/** 条件类型 → Java 布尔表达式（含 instanceof 转型检查），不匹配时返回 false */
function conditionExpr(cond: ConditionSpec): string | null {
  const args = cond.args ?? {};
  switch (cond.conditionType) {
    case 'is_day':
      return `if (event instanceof ${SERVER_LEVEL} level) {\n            return level.isDay();\n        }\n        return false;`;
    case 'is_night':
      return `if (event instanceof ${SERVER_LEVEL} level) {\n            return !level.isDay();\n        }\n        return false;`;
    case 'is_raining':
      return `if (event instanceof ${SERVER_LEVEL} level) {\n            return level.isRaining();\n        }\n        return false;`;
    case 'health_below':
    case 'health_above': {
      const threshold = numArg(args, 'threshold', 10);
      const op = cond.conditionType === 'health_below' ? '<' : '>';
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            return player.getHealth() ${op} ${threshold}f;\n        }\n        return false;`;
    }
    case 'has_item': {
      const item = strArg(args, 'item', 'minecraft:diamond');
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            return player.getInventory().countItem(${itemLookupExpr(item)}) > 0;\n        }\n        return false;`;
    }
    case 'distance_less':
    case 'distance_greater':
      return `        // TODO: 实现 ${cond.conditionType} 检查逻辑（需要位置上下文，当前事件对象无法提供）\n        return false;`;
    case 'biome_is':
    case 'block_is':
    case 'custom':
    default:
      return null;
  }
}

/** 动作类型 → Java 语句（含 instanceof 转型检查），不匹配时静默跳过 */
function actionStatements(action: ActionSpec): string | null {
  const args = action.args ?? {};
  switch (action.actionType) {
    case 'send_message': {
      const msg = strArg(args, 'message', 'Hello!');
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            player.sendSystemMessage(net.minecraft.network.chat.Component.literal(${JSON.stringify(msg)}), false);\n        }`;
    }
    case 'damage': {
      const amount = numArg(args, 'amount', 2);
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            player.hurt(player.damageSources().generic(), ${amount}f);\n        }`;
    }
    case 'heal': {
      const amount = numArg(args, 'amount', 2);
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            player.heal(${amount}f);\n        }`;
    }
    case 'give_item': {
      const item = strArg(args, 'item', 'minecraft:diamond');
      const count = numArg(args, 'count', 1);
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            player.getInventory().place(new net.minecraft.world.item.ItemStack(${itemLookupExpr(item)}, ${count}));\n        }`;
    }
    case 'take_item': {
      const item = strArg(args, 'item', 'minecraft:diamond');
      const count = numArg(args, 'count', 1);
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            player.getInventory().removeItem(new net.minecraft.world.item.ItemStack(${itemLookupExpr(item)}, ${count}));\n        }`;
    }
    case 'teleport': {
      const x = numArg(args, 'x', 0);
      const y = numArg(args, 'y', 64);
      const z = numArg(args, 'z', 0);
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            player.teleportTo(${x}, ${y}, ${z});\n        }`;
    }
    case 'give_effect': {
      const effect = strArg(args, 'effect', 'speed').toUpperCase();
      const duration = numArg(args, 'duration', 600);
      const amplifier = numArg(args, 'amplifier', 0);
      return `if (event instanceof ${SERVER_PLAYER} player) {\n            player.addEffect(new net.minecraft.world.effect.MobEffectInstance(net.minecraft.world.effect.MobEffects.${effect}, ${duration}, ${amplifier}));\n        }`;
    }
    case 'summon_lightning': {
      const x = numArg(args, 'x', 0);
      const y = numArg(args, 'y', 64);
      const z = numArg(args, 'z', 0);
      return `if (event instanceof ${SERVER_LEVEL} level) {\n            net.minecraft.world.entity.LightningBolt bolt = net.minecraft.world.entity.EntityType.LIGHTNING_BOLT.create(level);\n            if (bolt != null) {\n                bolt.moveTo(${x}, ${y}, ${z});\n                level.addFreshEntity(bolt);\n            }\n        }`;
    }
    case 'spawn_entity':
    case 'set_block':
    case 'remove_block':
    case 'play_sound':
    case 'custom':
    default:
      return null;
  }
}

/**
 * 生成 check_<id> 方法体。
 * 返回 null 表示该类型未实现（调用方回退到占位 TODO 注释）。
 */
export function conditionCheckBody(cond: ConditionSpec): string | null {
  return conditionExpr(cond);
}

/**
 * 生成 execute_<id> 方法体。
 * 返回 null 表示该类型未实现（调用方回退到占位 TODO 注释）。
 */
export function actionExecuteBody(action: ActionSpec): string | null {
  return actionStatements(action);
}
