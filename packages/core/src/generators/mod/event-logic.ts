/**
 * 条件/动作 Java 逻辑实现(事件上下文版本)。
 *
 * 生成代码引用 ModEvents.java 中的内部类 EventContext 字段(全限定名):
 * - player: ServerPlayer(可为 null)
 * - level: ServerLevel(可为 null)
 * - pos: BlockPos(可为 null)
 * - state: BlockState(可为 null)
 * - stack: ItemStack(可为 null)
 * - target: Entity(可为 null)
 *
 * 所有逻辑先判空再使用;无法满足上下文时安全返回默认值。
 */

/** 宽松条件结构：adapter 中的条件元素 conditionType 为 string（兼容增量 spec） */
export interface ConditionLike {
  conditionId?: string;
  conditionType: string;
  args?: Record<string, unknown>;
  customCode?: string;
  invert?: boolean;
}

/** 宽松动作结构：adapter 中的动作元素 actionType 为 string */
export interface ActionLike {
  actionId?: string;
  actionType: string;
  args?: Record<string, unknown>;
  customCode?: string;
}

/** 从 args 读取数值参数（兼容 number 与字符串），缺省返回默认值 */
function numArg(args: Record<string, unknown>, key: string, fallback: number): number {
  const v = args[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === 'number') return v;
  const n = Number(String(v).trim());
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

/** 生物群系 ID 转全限定 Java 表达式 */
function biomeLookupExpr(biomeId: string): string {
  return `net.minecraft.core.registries.BuiltInRegistries.BIOME.get(net.minecraft.resources.ResourceLocation.parse("${biomeId}"))`;
}

/** 方块 ID 转全限定 Java 表达式 */
function blockLookupExpr(blockId: string): string {
  return `net.minecraft.core.registries.BuiltInRegistries.BLOCK.get(net.minecraft.resources.ResourceLocation.parse("${blockId}"))`;
}

/** 条件类型 → Java 布尔表达式（读取 ctx 字段，判空安全），不匹配时返回 null */
function conditionExpr(cond: ConditionLike): string | null {
  const args = cond.args ?? {};
  switch (cond.conditionType) {
    case 'is_day':
      return `if (ctx.level != null) {\n            return ctx.level.isDay();\n        }\n        return false;`;
    case 'is_night':
      return `if (ctx.level != null) {\n            return !ctx.level.isDay();\n        }\n        return false;`;
    case 'is_raining':
      return `if (ctx.level != null) {\n            return ctx.level.isRaining();\n        }\n        return false;`;
    case 'health_below':
    case 'health_above': {
      const threshold = numArg(args, 'threshold', 10);
      const op = cond.conditionType === 'health_below' ? '<' : '>';
      return `if (ctx.player != null) {\n            return ctx.player.getHealth() ${op} ${threshold}f;\n        }\n        return false;`;
    }
    case 'has_item': {
      const item = strArg(args, 'item', 'minecraft:diamond');
      return `if (ctx.player != null) {\n            return ctx.player.getInventory().countItem(${itemLookupExpr(item)}) > 0;\n        }\n        return false;`;
    }
    case 'distance_less':
    case 'distance_greater': {
      const x = numArg(args, 'x', 0);
      const y = numArg(args, 'y', 64);
      const z = numArg(args, 'z', 0);
      const dist = numArg(args, 'distance', 10);
      const op = cond.conditionType === 'distance_less' ? '<' : '>';
      return `if (ctx.pos != null) {\n            double dx = ctx.pos.getX() - ${x}.0;\n            double dy = ctx.pos.getY() - ${y}.0;\n            double dz = ctx.pos.getZ() - ${z}.0;\n            return Math.sqrt(dx * dx + dy * dy + dz * dz) ${op} ${dist}.0;\n        }\n        return false;`;
    }
    case 'biome_is': {
      const biome = strArg(args, 'biome', 'minecraft:plains');
      return `if (ctx.level != null && ctx.pos != null) {\n            return ctx.level.getBiome(ctx.pos).is(${biomeLookupExpr(biome)});\n        }\n        return false;`;
    }
    case 'block_is': {
      const block = strArg(args, 'block', 'minecraft:stone');
      return `if (ctx.state != null) {\n            return ctx.state.is(${blockLookupExpr(block)});\n        }\n        return false;`;
    }
    case 'custom':
      // T2: 用户自定义条件代码（原样嵌入，需返回 boolean；按行加 8 空格缩进）
      if (cond.customCode && cond.customCode.trim()) {
        return cond.customCode
          .trim()
          .split('\n')
          .map((l) => `        ${l}`)
          .join('\n');
      }
      return null;
    default:
      return null;
  }
}

/** 动作类型 → Java 语句（读取 ctx 字段，判空安全），不匹配时返回 null */
function actionStatements(action: ActionLike): string | null {
  const args = action.args ?? {};
  switch (action.actionType) {
    case 'send_message': {
      const msg = strArg(args, 'message', 'Hello!');
      return `if (ctx.player != null) {\n            ctx.player.sendSystemMessage(net.minecraft.network.chat.Component.literal(${JSON.stringify(msg)}), false);\n        }`;
    }
    case 'damage': {
      const amount = numArg(args, 'amount', 2);
      return `if (ctx.player != null) {\n            ctx.player.hurt(ctx.player.damageSources().generic(), ${amount}f);\n        }`;
    }
    case 'heal': {
      const amount = numArg(args, 'amount', 2);
      return `if (ctx.player != null) {\n            ctx.player.heal(${amount}f);\n        }`;
    }
    case 'give_item': {
      const item = strArg(args, 'item', 'minecraft:diamond');
      const count = numArg(args, 'count', 1);
      return `if (ctx.player != null) {\n            ctx.player.getInventory().place(new net.minecraft.world.item.ItemStack(${itemLookupExpr(item)}, ${count}));\n        }`;
    }
    case 'take_item': {
      const item = strArg(args, 'item', 'minecraft:diamond');
      const count = numArg(args, 'count', 1);
      return `if (ctx.player != null) {\n            ctx.player.getInventory().removeItem(new net.minecraft.world.item.ItemStack(${itemLookupExpr(item)}, ${count}));\n        }`;
    }
    case 'teleport': {
      const x = numArg(args, 'x', 0);
      const y = numArg(args, 'y', 64);
      const z = numArg(args, 'z', 0);
      return `if (ctx.player != null) {\n            ctx.player.teleportTo(${x}, ${y}, ${z});\n        }`;
    }
    case 'give_effect': {
      const effect = strArg(args, 'effect', 'speed').toUpperCase();
      const duration = numArg(args, 'duration', 600);
      const amplifier = numArg(args, 'amplifier', 0);
      return `if (ctx.player != null) {\n            ctx.player.addEffect(new net.minecraft.world.effect.MobEffectInstance(net.minecraft.world.effect.MobEffects.${effect}, ${duration}, ${amplifier}));\n        }`;
    }
    case 'summon_lightning': {
      const x = numArg(args, 'x', 0);
      const y = numArg(args, 'y', 64);
      const z = numArg(args, 'z', 0);
      return `if (ctx.level != null) {\n            double lx = ctx.pos != null ? ctx.pos.getX() + 0.5 : ${x}.0;\n            double ly = ctx.pos != null ? ctx.pos.getY() : ${y}.0;\n            double lz = ctx.pos != null ? ctx.pos.getZ() + 0.5 : ${z}.0;\n            net.minecraft.world.entity.LightningBolt bolt = net.minecraft.world.entity.EntityType.LIGHTNING_BOLT.create(ctx.level);\n            if (bolt != null) {\n                bolt.moveTo(lx, ly, lz);\n                ctx.level.addFreshEntity(bolt);\n            }\n        }`;
    }
    case 'set_block': {
      const block = strArg(args, 'block', 'minecraft:stone');
      return `if (ctx.level != null && ctx.pos != null) {\n            ctx.level.setBlock(ctx.pos, ${blockLookupExpr(block)}.defaultBlockState(), 3);\n        }`;
    }
    case 'remove_block': {
      return `if (ctx.level != null && ctx.pos != null) {\n            ctx.level.setBlock(ctx.pos, net.minecraft.world.level.block.Blocks.AIR.defaultBlockState(), 3);\n        }`;
    }
    case 'play_sound': {
      const sound = strArg(args, 'sound', 'block.note_block.pling');
      const volume = numArg(args, 'volume', 1);
      const pitch = numArg(args, 'pitch', 1);
      return `if (ctx.level != null && ctx.pos != null) {\n            ctx.level.playSound(null, ctx.pos, net.minecraft.core.registries.BuiltInRegistries.SOUND_EVENT.get(net.minecraft.resources.ResourceLocation.parse("${sound}")), net.minecraft.sounds.SoundSource.PLAYERS, ${volume}f, ${pitch}f);\n        }`;
    }
    case 'spawn_entity': {
      const entityType = strArg(args, 'entity', 'minecraft:zombie');
      return `if (ctx.level != null && ctx.pos != null) {\n            net.minecraft.world.entity.EntityType<?> type = net.minecraft.core.registries.BuiltInRegistries.ENTITY_TYPE.get(net.minecraft.resources.ResourceLocation.parse("${entityType}"));\n            if (type != null) {\n                net.minecraft.world.entity.Entity e = type.create(ctx.level);\n                if (e != null) {\n                    e.moveTo(ctx.pos.getX() + 0.5, ctx.pos.getY(), ctx.pos.getZ() + 0.5);\n                    ctx.level.addFreshEntity(e);\n                }\n            }\n        }`;
    }
    case 'custom':
      // T2: 用户自定义动作代码（原样嵌入；按行加 8 空格缩进）
      if (action.customCode && action.customCode.trim()) {
        return action.customCode
          .trim()
          .split('\n')
          .map((l) => `        ${l}`)
          .join('\n');
      }
      return null;
    default:
      return null;
  }
}

/**
 * 生成 check_<id> 方法体。
 * 返回 null 表示该类型未实现（调用方回退到占位 TODO 注释）。
 */
export function conditionCheckBody(cond: ConditionLike): string | null {
  return conditionExpr(cond);
}

/**
 * 生成 execute_<id> 方法体。
 * 返回 null 表示该类型未实现（调用方回退到占位 TODO 注释）。
 */
export function actionExecuteBody(action: ActionLike): string | null {
  return actionStatements(action);
}
