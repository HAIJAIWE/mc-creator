/** 主类入口与 Forge 事件类/参数绑定映射。 */
import type { FileNode } from '@mc-creator/shared';
import { javaEscape, packagePath } from '../templates.js';
import { type ModSpecLike } from '../mod-common.js';

export function neoforgeMainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  // 条件性生成子模块 register(modEventBus)/initialize() 调用
  const registerCalls: string[] = [
    'ModItems.register(modEventBus);',
    'ModBlocks.register(modEventBus);',
  ];
  if (spec.recipes?.length) registerCalls.push('ModRecipes.initialize();');
  if (spec.entities?.length) registerCalls.push('ModEntities.register(modEventBus);');
  if (spec.fluids?.length) registerCalls.push('ModFluids.register(modEventBus);');
  if (spec.biomes?.length) registerCalls.push('ModBiomes.initialize();');
  if (spec.dimensions?.length) registerCalls.push('ModDimensions.initialize();');
  if (spec.guis?.length) registerCalls.push('ModGuis.register(modEventBus);');
  if (spec.structures?.length) registerCalls.push('ModStructures.initialize();');
  if (spec.machines?.length) registerCalls.push('ModMachines.register(modEventBus);');
  if (spec.customCode?.length) registerCalls.push('ModCustomCode.initialize();');
  if (spec.multiblocks?.length) registerCalls.push('ModMultiblocks.initialize();');
  if (
    spec.eventHandlers?.length ||
    spec.conditions?.length ||
    spec.actions?.length ||
    spec.procedures?.length
  ) {
    // 游戏事件走 Forge 总线（ModEvents.register 无参），与 DeferredRegister 的 modEventBus 区分
    registerCalls.push('ModEvents.register();');
  }
  const content = `package ${pkg};

import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fml.common.Mod;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

@Mod("${javaEscape(spec.modId)}")
public class ${mainCls} {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    public ${mainCls}(IEventBus modEventBus) {
        ${registerCalls.join('\n        ')}
        LOGGER.info("Initializing ${javaEscape(spec.name)}");
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/${mainCls}.java`,
    content,
  };
}

/**
 * eventType → Forge 47 事件类名（net.minecraftforge.event.*）。
 * custom 无标准事件，返回 null（调用方生成注释桩，不 import 不存在的类）。
 */
export function neoforgeEventClass(eventType: string): string | null {
  switch (eventType) {
    case 'player_right_click_block':
      return 'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickBlock';
    case 'player_right_click_item':
      return 'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickItem';
    case 'player_left_click':
      return 'net.minecraftforge.event.entity.player.PlayerInteractEvent.LeftClickBlock';
    case 'block_break':
      return 'net.minecraftforge.event.level.BlockEvent.BreakEvent';
    case 'block_place':
      return 'net.minecraftforge.event.level.BlockEvent.EntityPlaceEvent';
    case 'entity_death':
      return 'net.minecraftforge.event.entity.living.LivingDeathEvent';
    case 'entity_hurt':
      return 'net.minecraftforge.event.entity.living.LivingHurtEvent';
    case 'item_use':
      return 'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickItem';
    case 'item_pickup':
      return 'net.minecraftforge.event.entity.player.EntityItemPickupEvent';
    case 'player_join':
      return 'net.minecraftforge.event.entity.player.PlayerEvent.PlayerLoggedInEvent';
    case 'player_quit':
      return 'net.minecraftforge.event.entity.player.PlayerEvent.PlayerLoggedOutEvent';
    case 'tick':
      return 'net.minecraftforge.event.TickEvent.ServerTickEvent';
    case 'custom':
    default:
      return null;
  }
}

/**
 * 根据 eventType 生成 Forge 事件对象 → EventContext 字段绑定语句（缩进 12 空格）。
 * 约定：level 一律 instanceof ServerLevel 守卫（客户端事件不崩）；
 * player 一律 instanceof ServerPlayer 守卫（客户端玩家不是 ServerPlayer）。
 */
export function neoforgeEventBindings(eventType: string): string {
  const bind = (assignments: string[]): string =>
    assignments.map((a) => `            ${a}`).join('\n');
  const SL = 'net.minecraft.server.level.ServerLevel';
  const SP = 'net.minecraft.server.level.ServerPlayer';
  switch (eventType) {
    case 'tick':
      return bind([
        'if (event.phase != net.minecraftforge.event.TickEvent.Phase.END) return;',
        'ctx.level = event.getServer().overworld();',
      ]);
    case 'player_join':
    case 'player_quit':
      return bind([
        `ctx.player = event.getEntity() instanceof ${SP} sp ? sp : null;`,
        `ctx.level = event.getEntity().level() instanceof ${SL} sl ? sl : null;`,
      ]);
    case 'player_right_click_block':
    case 'player_left_click':
      return bind([
        `ctx.player = event.getEntity() instanceof ${SP} sp ? sp : null;`,
        `ctx.level = event.getLevel() instanceof ${SL} sl ? sl : null;`,
        'ctx.pos = event.getPos();',
      ]);
    case 'player_right_click_item':
    case 'item_use':
      return bind([
        `ctx.player = event.getEntity() instanceof ${SP} sp ? sp : null;`,
        `ctx.level = event.getLevel() instanceof ${SL} sl ? sl : null;`,
        'ctx.stack = event.getItemStack();',
      ]);
    case 'block_break':
      return bind([
        `ctx.player = event.getPlayer() instanceof ${SP} sp ? sp : null;`,
        `ctx.level = event.getLevel() instanceof ${SL} sl ? sl : null;`,
        'ctx.pos = event.getPos();',
        'ctx.state = event.getState();',
      ]);
    case 'block_place':
      return bind([
        'ctx.target = event.getEntity();',
        `ctx.level = event.getLevel() instanceof ${SL} sl ? sl : null;`,
        'ctx.pos = event.getPos();',
        'ctx.state = event.getBlockSnapshot().getReplacedBlock();',
      ]);
    case 'entity_death':
    case 'entity_hurt':
      return bind([
        'ctx.target = event.getEntity();',
        `ctx.level = event.getEntity().level() instanceof ${SL} sl ? sl : null;`,
      ]);
    case 'item_pickup':
      return bind([
        `ctx.player = event.getEntity() instanceof ${SP} sp ? sp : null;`,
        `ctx.level = event.getEntity().level() instanceof ${SL} sl ? sl : null;`,
        'ctx.stack = event.getItem().getItem();',
      ]);
    case 'custom':
    default:
      return '            // (custom 事件无标准绑定)';
  }
}
