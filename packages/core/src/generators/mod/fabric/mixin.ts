/** Mixin 支持（block_place / item_pickup 及 mixins.json）。 */
import type { FileNode } from '@mc-creator/shared';
import { packagePath } from '../templates.js';
import { type ModSpecLike } from '../mod-common.js';

/**
 * P2.2 block_place 的 Mixin 支持（Fabric API 无放置事件）。
 * 生成 ModBlockPlaceMixin.java（@Inject BlockItem.place 公开单参重载的 RETURN 后通知
 * ModEvents.notifyBlockPlaced）。mixins.json 由 fabricMixinsJson 统一生成。
 * 无 block_place handler 时返回空数组（不生成任何文件）。
 */

export function fabricBlockPlaceMixinFiles(spec: ModSpecLike, pkg: string): FileNode[] {
  const hasBlockPlace = (spec.eventHandlers ?? []).some((h) => h.eventType === 'block_place');
  if (!hasBlockPlace) return [];

  const mixinClass = `package ${pkg}.mixin;

import net.minecraft.util.ActionResult;
import net.minecraft.item.BlockItem;
import net.minecraft.item.ItemPlacementContext;
import net.minecraft.world.World;
import net.minecraft.block.BlockState;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

@Mixin(BlockItem.class)
public class ModBlockPlaceMixin {
    // P2.2: 方块放置成功后通知 ModEvents（Fabric API 无现成放置事件）。
    // @Inject 目标为唯一的 public place(ItemPlacementContext)（另一个 place(ctx, state)
    // 重载是 protected 辅助方法，签名不同，不会双触发）；描述符写全以锁定目标。
    @Inject(method = "place(Lnet/minecraft/item/ItemPlacementContext;)Lnet/minecraft/util/ActionResult;", at = @At("RETURN"))
    private void onBlockPlaced(ItemPlacementContext context, CallbackInfoReturnable<ActionResult> cir) {
        if (cir.getReturnValue().isAccepted()) {
            World world = context.getWorld();
            net.minecraft.util.math.BlockPos pos = context.getBlockPos();
            BlockState state = world.getBlockState(pos);
            net.minecraft.entity.player.PlayerEntity player = context.getPlayer();
            net.minecraft.server.network.ServerPlayerEntity sp = player instanceof net.minecraft.server.network.ServerPlayerEntity p ? p : null;
            ${pkg}.ModEvents.notifyBlockPlaced(world, pos, state, sp);
        }
    }
}
`;

  // 注意：mixins.json 由 fabricMixinsJson 统一生成（多 Mixin 共用一个文件），
  // 此处只返回 Mixin 类文件，避免同路径重复。
  return [
    {
      path: `src/main/java/${packagePath(spec.modId)}/mixin/ModBlockPlaceMixin.java`,
      content: mixinClass,
    },
  ];
}

/**
 * item_pickup 的 Mixin 支持（Fabric API 无拾取事件）。
 * 生成 ModItemPickupMixin.java（@Inject ItemEntity.onPlayerCollision 的 TAIL 后通知
 * ModEvents.notifyItemPickedup）。mixins.json 与 block_place 共用一个文件
 * （见 fabricMixinsJson），无 item_pickup handler 时返回空数组。
 * 注意：碰撞尝试即触发（背包满时 vanilla 也会拒绝），服务端用 instanceof 守卫。
 */

export function fabricItemPickupMixinFiles(spec: ModSpecLike, pkg: string): FileNode[] {
  const hasItemPickup = (spec.eventHandlers ?? []).some((h) => h.eventType === 'item_pickup');
  if (!hasItemPickup) return [];

  const mixinClass = `package ${pkg}.mixin;

import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.server.network.ServerPlayerEntity;
import net.minecraft.server.world.ServerWorld;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

@Mixin(ItemEntity.class)
public class ModItemPickupMixin {
    // 碰撞尝试即触发（背包满时 vanilla 也会拒绝）；客户端世界直接返回
    @Inject(method = "onPlayerCollision(Lnet/minecraft/entity/player/PlayerEntity;)V", at = @At("TAIL"))
    private void onItemPickedUp(PlayerEntity player, CallbackInfo ci) {
        if (((ItemEntity) (Object) this).getWorld() instanceof ServerWorld) {
            ${pkg}.ModEvents.notifyItemPickedup(
                ((ItemEntity) (Object) this).getWorld(),
                (ServerPlayerEntity) player,
                ((ItemEntity) (Object) this).getStack());
        }
    }
}
`;

  return [
    {
      path: `src/main/java/${packagePath(spec.modId)}/mixin/ModItemPickupMixin.java`,
      content: mixinClass,
    },
  ];
}

/**
 * Mixin 配置（block_place / item_pickup 共用）：列出实际生成的 Mixin 类。
 * 无 Mixin 事件时返回空数组（fabric.mod.json 也不声明，避免悬空引用启动崩溃）。
 */

export function fabricMixinsJson(spec: ModSpecLike, pkg: string): FileNode[] {
  const names: string[] = [];
  if ((spec.eventHandlers ?? []).some((h) => h.eventType === 'block_place')) {
    names.push('ModBlockPlaceMixin');
  }
  if ((spec.eventHandlers ?? []).some((h) => h.eventType === 'item_pickup')) {
    names.push('ModItemPickupMixin');
  }
  if (!names.length) return [];
  return [
    {
      path: `src/main/resources/${spec.modId}.mixins.json`,
      content: JSON.stringify(
        {
          required: true,
          package: `${pkg}.mixin`,
          compatibilityLevel: 'JAVA_17',
          mixins: names,
          injectors: { defaultRequire: 1 },
        },
        null,
        2,
      ),
    },
  ];
}
