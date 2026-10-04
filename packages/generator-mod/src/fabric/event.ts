/** 事件注册与主类（Fabric API 事件回调 + ModInitializer 入口）。 */
import type { FileNode } from '@mc-creator/shared';
import { javaEscape, packagePath } from '../templates.js';
import { formatUnsupportedComment } from '../unsupported.js';
import { type ModSpecLike } from '../mod-common.js';

/**
 * 根据 eventType 生成 Fabric 事件注册调用（用全限定名避免 import 错误）。
 * 使用 Yarn 映射：
 * - ServerPlayerEntity（Yarn 对应 Mojang 的 ServerPlayer）
 * - ServerWorld（Yarn 对应 Mojang 的 ServerLevel）
 *
 * P1 dogfood 修复：ServerPlayerEvents.JOIN/LEAVE 回调签名含 ServerPlayerEntity + MinecraftServer。
 * P2.1 事件参数绑定：回调多参数绑定为 EventContext 字段，不再只传 player。
 */

export function fabricEventRegistration(eventType: string, handlerMethod: string): string {
  switch (eventType) {
    case 'tick':
      return `        net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register(server -> {
            EventContext ctx = new EventContext();
            ctx.level = server.getOverworld();
            ${handlerMethod}(ctx);
        });`;
    case 'player_join':
      return `        net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
            EventContext ctx = new EventContext();
            ctx.player = handler.player;
            ctx.level = (net.minecraft.server.world.ServerWorld) handler.player.getWorld();
            ${handlerMethod}(ctx);
        });`;
    case 'player_quit':
      return `        net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
            EventContext ctx = new EventContext();
            ctx.player = handler.player;
            ctx.level = (net.minecraft.server.world.ServerWorld) handler.player.getWorld();
            ${handlerMethod}(ctx);
        });`;
    case 'block_break':
      return `        net.fabricmc.fabric.api.event.player.PlayerBlockBreakEvents.AFTER.register((world, player, pos, state, blockEntity) -> {
            EventContext ctx = new EventContext();
            ctx.level = (net.minecraft.server.world.ServerWorld) world;
            ctx.player = (net.minecraft.server.network.ServerPlayerEntity) player;
            ctx.pos = pos;
            ctx.state = state;
            ${handlerMethod}(ctx);
        });`;
    case 'player_right_click_block':
      return `        net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register((player, world, hand, hitResult) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.network.ServerPlayerEntity) player;
            ctx.level = (net.minecraft.server.world.ServerWorld) world;
            ctx.pos = hitResult.getBlockPos();
            ${handlerMethod}(ctx);
            return net.minecraft.util.ActionResult.PASS;
        });`;
    case 'player_right_click_item':
    case 'item_use':
      return `        net.fabricmc.fabric.api.event.player.UseItemCallback.EVENT.register((player, world, hand) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.network.ServerPlayerEntity) player;
            ctx.level = (net.minecraft.server.world.ServerWorld) world;
            ctx.stack = player.getStackInHand(hand);
            ${handlerMethod}(ctx);
            return net.minecraft.util.TypedActionResult.pass(player.getStackInHand(hand));
        });`;
    case 'player_left_click':
      return `        net.fabricmc.fabric.api.event.player.AttackBlockCallback.EVENT.register((player, world, hand, pos, direction) -> {
            EventContext ctx = new EventContext();
            ctx.player = (net.minecraft.server.network.ServerPlayerEntity) player;
            ctx.level = (net.minecraft.server.world.ServerWorld) world;
            ctx.pos = pos;
            ${handlerMethod}(ctx);
            return net.minecraft.util.ActionResult.PASS;
        });`;
    case 'item_pickup':
      // Fabric API 无拾取事件：由 ModItemPickupMixin 在 ItemEntity.onPlayerCollision 后调用 notifyItemPickedup
      return `        // item_pickup: Fabric API 无拾取事件，由 ModItemPickupMixin @Inject 触发
        // ModEvents.notifyItemPickedup(world, player, stack) 已在 Mixin 中调用`;
    case 'entity_death':
      // Fabric API ServerLivingEntityEvents.AFTER_DEATH：实体死亡后触发（target 绑定死亡实体）
      return `        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DEATH.register((entity, source) -> {
            EventContext ctx = new EventContext();
            ctx.target = entity;
            ctx.level = (net.minecraft.server.world.ServerWorld) entity.getWorld();
            ${handlerMethod}(ctx);
        });`;
    case 'entity_hurt':
      // Fabric API ServerLivingEntityEvents.ALLOW_DAMAGE：受伤时触发（返回 true 不取消伤害）
      return `        net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.ALLOW_DAMAGE.register((entity, source, amount) -> {
            EventContext ctx = new EventContext();
            ctx.target = entity;
            ctx.level = (net.minecraft.server.world.ServerWorld) entity.getWorld();
            ${handlerMethod}(ctx);
            return true;
        });`;
    case 'block_place':
      // Fabric API 无现成放置事件：由 ModBlockPlaceMixin 在 BlockItem.place 后调用 notifyBlockPlaced
      return `        // block_place: Fabric API 无放置事件，由 ModBlockPlaceMixin @Inject 触发
        // ModEvents.notifyBlockPlaced(level, pos, state, player) 已在 Mixin 中调用`;
    default:
      return `        ${formatUnsupportedComment('event', eventType, 'UNKNOWN_EVENT')}
        // ${handlerMethod}(new EventContext());`;
  }
}

/**
 * 把任意字符串转为合法 Java 标识符片段（用于 check_<id>/execute_<id>/handle_<id> 方法名后缀）。
 * 保留原大小写与下划线，仅把非法字符替换为下划线；首字符为数字时加 _ 前缀。
 *
 * P1 dogfood 修复：空字符串/纯特殊字符 → 返回 "unknown"（而非空标识符导致编译错误）。
 */

export function fabricMainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  // 条件性生成子模块初始化调用（仅当 spec 中对应字段非空时）
  const initCalls: string[] = ['ModItems.initialize();', 'ModBlocks.initialize();'];
  if (spec.recipes?.length) initCalls.push('ModRecipes.initialize();');
  if (spec.entities?.length) initCalls.push('ModEntities.initialize();');
  if (spec.fluids?.length) initCalls.push('ModFluids.initialize();');
  if (spec.biomes?.length) initCalls.push('ModBiomes.initialize();');
  if (spec.dimensions?.length) initCalls.push('ModDimensions.initialize();');
  if (spec.guis?.length) initCalls.push('ModGuis.initialize();');
  if (spec.structures?.length) initCalls.push('ModStructures.initialize();');
  if (spec.machines?.length) initCalls.push('ModMachines.initialize();');
  if (spec.customCode?.length) initCalls.push('ModCustomCode.initialize();');
  if (spec.multiblocks?.length) initCalls.push('ModMultiblocks.initialize();');
  if (
    spec.eventHandlers?.length ||
    spec.conditions?.length ||
    spec.actions?.length ||
    spec.procedures?.length
  ) {
    initCalls.push('ModEvents.initialize();');
  }
  const content = `package ${pkg};

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public class ${mainCls} implements ModInitializer {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
    public static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        ${initCalls.join('\n        ')}
        LOGGER.info("Initializing ${javaEscape(spec.name)}");
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/${mainCls}.java`,
    content,
  };
}
