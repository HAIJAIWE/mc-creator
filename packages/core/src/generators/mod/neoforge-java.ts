/**
 * NeoForge Adapter 的 Java 类生成域。
 *
 * 从 neoforge-adapter.ts 提取：@Mod 入口 + 13 个 Mod* Java 类生成器 +
 * NeoForge 事件/实体辅助映射。保持与重构前完全一致的行为（模板字符串原样）。
 */
import type { FileNode } from '@mc-creator/shared';
import { javaEscape, packagePath } from './templates.js';
import { conditionCheckBody, actionExecuteBody } from './event-logic.js';
import {
  defaultValueFor,
  javaTypeFor,
  machineRecipeCases,
  portTypeToJava,
  sanitizeIdent,
  toPascal,
  type ModSpecLike,
} from './mod-common.js';

/** 根据 modelType 返回实体基类名
 * Major 修复：返回具体类名（Zombie/Skeleton/...）而非基类（Mob/Animal），
 * 使 EntityType<T>、Builder.<T>of(factory, ...)、factory 三者泛型一致。
 */
export function neoforgeEntityBaseClass(modelType: string): string {
  switch (modelType) {
    case 'zombie':
      return 'Zombie';
    case 'skeleton':
      return 'Skeleton';
    case 'creeper':
      return 'Creeper';
    case 'pig':
      return 'Pig';
    case 'cow':
      return 'Cow';
    case 'custom':
    default:
      return 'Entity';
  }
}

/** 根据 modelType 返回实体工厂引用 */
export function neoforgeEntityFactory(modelType: string): string {
  switch (modelType) {
    case 'zombie':
      return 'Zombie::new';
    case 'skeleton':
      return 'Skeleton::new';
    case 'creeper':
      return 'Creeper::new';
    case 'pig':
      return 'Pig::new';
    case 'cow':
      return 'Cow::new';
    case 'custom':
    default:
      return 'Entity::new';
  }
}

/** classification → NeoForge MobCategory 映射 */
export function neoforgeMobCategory(classification: string): string {
  switch (classification) {
    case 'animal':
      return 'MobCategory.CREATURE';
    case 'monster':
      return 'MobCategory.MONSTER';
    case 'water_creature':
      return 'MobCategory.WATER_CREATURE';
    case 'ambient':
      return 'MobCategory.AMBIENT';
    case 'misc':
    default:
      return 'MobCategory.MISC';
  }
}

/** eventType → NeoForge 事件类名映射（简化） */
export function neoforgeEventClass(eventType: string): string {
  switch (eventType) {
    case 'player_right_click_block':
      return 'net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.RightClickBlock';
    case 'player_right_click_item':
      return 'net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.RightClickItem';
    case 'player_left_click':
      return 'net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.LeftClickBlock';
    case 'block_break':
      return 'net.neoforged.neoforge.event.level.BlockEvent.BreakEvent';
    case 'block_place':
      return 'net.neoforged.neoforge.event.level.BlockEvent.EntityPlaceEvent';
    case 'entity_death':
      return 'net.neoforged.neoforge.event.entity.living.LivingDeathEvent';
    case 'entity_hurt':
      return 'net.neoforged.neoforge.event.entity.living.LivingHurtEvent';
    case 'item_use':
      return 'net.neoforged.neoforge.event.entity.player.PlayerInteractEvent.RightClickItem';
    case 'item_pickup':
      return 'net.neoforged.neoforge.event.entity.player.EntityItemPickupEvent';
    case 'player_join':
      return 'net.neoforged.neoforge.event.entity.player.PlayerEvent.PlayerLoggedInEvent';
    case 'player_quit':
      return 'net.neoforged.neoforge.event.entity.player.PlayerEvent.PlayerLoggedOutEvent';
    case 'tick':
      return 'net.neoforged.neoforge.event.tick.ServerTickEvent';
    case 'custom':
    default:
      return 'net.neoforged.neoforge.event.GenericEvent';
  }
}

/**
 * 根据 eventType 生成 NeoForge 事件对象 → EventContext 字段绑定语句（缩进 12 空格）。
 * P2.1 事件参数绑定：事件 getter 绑定到上下文，条件/动作逻辑从中读取。
 */
export function neoforgeEventBindings(eventType: string): string {
  const bind = (assignments: string[]): string =>
    assignments.map((a) => `            ${a}`).join('\n');
  switch (eventType) {
    case 'tick':
      return bind(['ctx.level = event.getServer().overworld();']);
    case 'player_join':
    case 'player_quit':
      return bind([
        'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
        'ctx.level = (net.minecraft.server.level.ServerLevel) event.getEntity().level();',
      ]);
    case 'player_right_click_block':
      return bind([
        'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
        'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
        'ctx.pos = event.getPos();',
      ]);
    case 'player_right_click_item':
    case 'item_use':
      return bind([
        'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
        'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
        'ctx.stack = event.getItemStack();',
      ]);
    case 'player_left_click':
      return bind([
        'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
        'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
        'ctx.pos = event.getPos();',
      ]);
    case 'block_break':
      return bind([
        'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getPlayer();',
        'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
        'ctx.pos = event.getPos();',
        'ctx.state = event.getState();',
      ]);
    case 'block_place':
      return bind([
        'ctx.target = event.getEntity();',
        'ctx.level = (net.minecraft.server.level.ServerLevel) event.getLevel();',
        'ctx.pos = event.getPos();',
        'ctx.state = event.getBlockSnapshot().getReplacedBlock();',
      ]);
    case 'entity_death':
    case 'entity_hurt':
      return bind([
        'ctx.target = event.getEntity();',
        'ctx.level = (net.minecraft.server.level.ServerLevel) event.getEntity().level();',
      ]);
    case 'item_pickup':
      return bind([
        'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
        'ctx.level = (net.minecraft.server.level.ServerLevel) event.getEntity().level();',
        'ctx.stack = event.getItem();',
      ]);
    case 'custom':
    default:
      return '            // (custom 事件无标准绑定)';
  }
}

export function neoforgeMainClass(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  // 条件性生成子模块 register(modEventBus)/initialize() 调用：
  // - 需 DeferredRegister 的模块（items/blocks/entities/machines/events）用 register(modEventBus)
  // - 纯数据/代码片段模块（recipes/customCode/multiblocks）用 initialize()
  const registerCalls: string[] = [
    'ModItems.register(modEventBus);',
    'ModBlocks.register(modEventBus);',
  ];
  if (spec.recipes?.length) registerCalls.push('ModRecipes.initialize();');
  if (spec.entities?.length) registerCalls.push('ModEntities.register(modEventBus);');
  if (spec.fluids?.length) registerCalls.push('ModFluids.register(modEventBus);');
  if (spec.biomes?.length) registerCalls.push('ModBiomes.register(modEventBus);');
  if (spec.dimensions?.length) registerCalls.push('ModDimensions.register(modEventBus);');
  if (spec.guis?.length) registerCalls.push('ModGuis.register(modEventBus);');
  if (spec.structures?.length) registerCalls.push('ModStructures.register(modEventBus);');
  if (spec.machines?.length) registerCalls.push('ModMachines.register(modEventBus);');
  if (spec.customCode?.length) registerCalls.push('ModCustomCode.initialize();');
  if (spec.multiblocks?.length) registerCalls.push('ModMultiblocks.initialize();');
  if (
    spec.eventHandlers?.length ||
    spec.conditions?.length ||
    spec.actions?.length ||
    spec.procedures?.length
  ) {
    registerCalls.push('ModEvents.initialize(modEventBus);');
  }
  const content = `package ${pkg};

import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
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

export function neoforgeModItemsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const fields = spec.items
    .map(
      (it) =>
        `    public static final DeferredItem<Item> ${it.id.toUpperCase()} = ITEMS.registerSimpleItem("${it.id}");`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.world.item.Item;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModItems {
    public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        ITEMS.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModItems.java`,
    content,
  };
}

export function neoforgeModBlocksJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const fields = spec.blocks
    .map((b) => {
      // 应用 spec 方块属性（与 Fabric 一致：hardness/resistance，其余默认）
      const props = `Block.Properties.of().strength(${b.hardness}f, ${b.resistance ?? b.hardness}f)`;
      return `    public static final DeferredBlock<Block> ${b.id.toUpperCase()} = BLOCKS.register("${b.id}", () -> new Block(${props}));`;
    })
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.world.level.block.Block;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBlock;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModBlocks {
    public static final DeferredRegister.Blocks BLOCKS = DeferredRegister.createBlocks(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        BLOCKS.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModBlocks.java`,
    content,
  };
}

/**
 * Task D：生成 ModFluids.java（NeoForge DeferredRegister 风格）。
 * 流体用 DeferredRegister.Fluids + 自定义 SimpleFluid 子类。
 */
export function neoforgeModFluidsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const fields = (spec.fluids ?? [])
    .map(
      (f) =>
        `    public static final DeferredFluid<net.minecraft.world.level.material.Fluid> ${f.fluidId.toUpperCase()} = FLUIDS.register("${f.fluidId}", () -> new SimpleFluid());`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.world.level.material.SimpleFluid;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredFluid;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModFluids {
    public static final DeferredRegister.Fluids FLUIDS = DeferredRegister.createFluids(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        FLUIDS.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModFluids.java`,
    content,
  };
}

/**
 * Mod 侧生物群系：生成 ModBiomes.java（NeoForge DeferredRegister.Biomes 风格）。
 */
export function neoforgeModBiomesJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const fields = (spec.biomes ?? [])
    .map(
      (b) =>
        `    public static final DeferredBiome<net.minecraft.world.level.biome.Biome> ${b.biomeId.toUpperCase()} = BIOMES.register("${b.biomeId}", () -> new net.minecraft.world.level.biome.Biome.BiomeBuilder()
            .precipitation(net.minecraft.world.level.biome.Biome.Precipitation.${b.precipitation.toUpperCase()})
            .temperature(${b.temperature}f)${b.temperatureModifier === 'frozen' ? '\n            .temperatureAdjustment(net.minecraft.world.level.biome.Biome.TemperatureModifier.FROZEN)' : ''}
            .downfall(${b.downfall}f)
            .specialEffects(new net.minecraft.world.level.biome.BiomeSpecialEffects.Builder()
                .skyColor(${b.skyColor})
                .waterColor(${b.waterColor})
                .waterFogColor(${b.waterFogColor})
                .fogColor(${b.fogColor})${b.grassColor !== undefined ? `\n                .grassColorOverride(${b.grassColor})` : ''}${b.foliageColor !== undefined ? `\n                .foliageColorOverride(${b.foliageColor})` : ''}
                .build())
            .mobSpawnSettings(net.minecraft.world.level.biome.MobSpawnSettings.EMPTY)
            .generationSettings(net.minecraft.world.level.biome.BiomeGenerationSettings.EMPTY)
            .build());`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredBiome;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModBiomes {
    public static final DeferredRegister.Biomes BIOMES = DeferredRegister.createBiomes(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        BIOMES.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModBiomes.java`,
    content,
  };
}

/**
 * Mod 侧维度：生成 ModDimensions.java（NeoForge）。
 * 注册 DimensionType，维度可通过 /execute in <modid>:<dim> 访问。
 */
export function neoforgeModDimensionsJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.dimensions ?? [])
    .map(
      (d) =>
        `    public static final DeferredHolder<DimensionType, DimensionType> ${d.dimensionId.toUpperCase()}_TYPE = DIMENSION_TYPES.register("${d.dimensionId}", () -> new DimensionType(${d.fixedTime !== null ? `OptionalLong.of(${d.fixedTime}L)` : 'OptionalLong.empty()'}, ${d.hasSkyLight}, ${d.hasCeiling}, ${d.ultrawarm}, ${d.natural}, ${d.coordinateScale}, ${d.bedWorks}, ${d.respawnAnchorWorks}, ${d.minY}, ${d.height}, ${d.logicalHeight}, ResourceLocation.parse("minecraft:infiniburn_${d.baseType === 'nether' ? 'nether' : 'overworld'}"), ${d.effects === 'none' ? 'Optional.empty()' : `Optional.of(ResourceLocation.fromNamespaceAndPath("minecraft", "${d.effects}"))`}, ${d.ambientLight}, ${d.piglinSafe}));`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.level.dimension.DimensionType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;
import java.util.Optional;
import java.util.OptionalLong;

public class ModDimensions {
    public static final DeferredRegister<DimensionType> DIMENSION_TYPES = DeferredRegister.create(Registries.DIMENSION_TYPE, "${javaEscape(spec.modId)}");

${fields}

    public static void register(IEventBus modEventBus) {
        DIMENSION_TYPES.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModDimensions.java`,
    content,
  };
}

/**
 * GUI 界面：生成 ModGuis.java（NeoForge）。
 * 每个 GUI 生成 Menu（槽位布局）+ Screen（渲染骨架）。
 */
export function neoforgeModGuisJava(spec: ModSpecLike, pkg: string): FileNode {
  const guiClasses = (spec.guis ?? [])
    .map((g) => {
      const pascal = toPascal(g.guiId);
      const slotCount = g.slots.length;
      const slotAdds = g.slots
        .map(
          (s) =>
            `        this.addSlot(new Slot(machineInv, ${g.slots.indexOf(s)}, ${8 + s.x}, ${18 + s.y}));`,
        )
        .join('\n');
      return `    // ${pascal}Menu：GUI 槽位布局（${slotCount} 槽）
    public static class ${pascal}Menu extends AbstractContainerMenu {
        private final net.minecraft.world.SimpleContainer machineInv;

        public ${pascal}Menu(int id, Inventory inv) {
            super(${pascal.toUpperCase()}_MENU_TYPE.get(), id);
            this.machineInv = new net.minecraft.world.SimpleContainer(${slotCount});
${slotAdds}
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(inv, col + row * 9 + 9, 8 + col * 18, ${g.height - 82} + row * 18));
                }
            }
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(inv, col, 8 + col * 18, ${g.height - 24}));
            }
        }

        @Override
        public net.minecraft.world.item.ItemStack quickMoveStack(net.minecraft.world.entity.player.Player player, int index) {
            return net.minecraft.world.item.ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(net.minecraft.world.entity.player.Player player) {
            return true;
        }
    }

    // ${pascal}Screen：GUI 渲染骨架（客户端）
    public static class ${pascal}Screen extends net.minecraft.client.gui.screens.inventory.AbstractContainerScreen<${pascal}Menu> {
        public ${pascal}Screen(${pascal}Menu menu, Inventory inv, net.minecraft.network.chat.Component title) {
            super(menu, inv, title);
            this.imageWidth = ${g.width};
            this.imageHeight = ${g.height};
        }

        @Override
        protected void renderBg(net.minecraft.client.gui.GuiGraphics graphics, float partialTick, int mouseX, int mouseY) {
            graphics.blit(net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(MOD_ID, "textures/gui/${g.guiId}.png"), this.leftPos, this.topPos, 0, 0, this.imageWidth, this.imageHeight);
        }

        @Override
        public void render(net.minecraft.client.gui.GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            super.render(graphics, mouseX, mouseY, partialTick);
            this.renderTooltip(graphics, mouseX, mouseY);
        }
    }

    public static final net.neoforged.neoforge.registries.DeferredHolder<net.minecraft.world.inventory.MenuType<?>, net.minecraft.world.inventory.MenuType<${pascal}Menu>> ${pascal.toUpperCase()}_MENU_TYPE = MENUS.register("${g.guiId}", () -> IMenuTypeExtension.create(${pascal}Menu::new));`;
    })
    .join('\n\n');
  const content = `package ${pkg};

import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.entity.player.Inventory;
import net.neoforged.neoforge.common.extensions.IMenuTypeExtension;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModGuis {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
    public static final DeferredRegister<net.minecraft.world.inventory.MenuType<?>> MENUS = DeferredRegister.create(net.minecraft.core.registries.Registries.MENU, MOD_ID);
${guiClasses}

    public static void initialize() {
        // NeoForge DeferredRegister 通过 register() 注册
    }

    public static void register(net.neoforged.bus.api.IEventBus modEventBus) {
        MENUS.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModGuis.java`,
    content,
  };
}

/**
 * Mod 侧结构：生成 ModStructures.java（NeoForge DeferredRegister 风格）。
 */
export function neoforgeModStructuresJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.structures ?? [])
    .map(
      (s) =>
        `    public static final DeferredHolder<net.minecraft.world.level.levelgen.structure.Structure, net.minecraft.world.level.levelgen.structure.Structure> ${s.structureId.toUpperCase()} = STRUCTURES.register("${s.structureId}", () -> new net.minecraft.world.level.levelgen.structure.structures.JigsawStructure(
                net.minecraft.world.level.levelgen.structure.Structure.StructureSettingsHolder.empty(),
                net.minecraft.resources.ResourceLocation.fromNamespaceAndPath(MOD_ID, "${s.startPool}"),
                ${s.size},
                net.minecraft.world.level.levelgen.heightproviders.ConstantHeight.of(net.minecraft.world.level.levelgen.WorldGenContext.EMPTY),
                false,
                net.minecraft.world.level.levelgen.structure.terrainadaptation.TerrainAdjustment.${s.terrainAdaptation.toUpperCase()}
            ));`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.core.registries.Registries;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModStructures {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
    public static final DeferredRegister<net.minecraft.world.level.levelgen.structure.Structure> STRUCTURES = DeferredRegister.create(Registries.STRUCTURE, MOD_ID);
${fields}

    public static void register(IEventBus modEventBus) {
        STRUCTURES.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModStructures.java`,
    content,
  };
}

/**
 * 生成 ModRecipes.java：NeoForge 的配方也通过 datapack JSON 加载，
 * Critical 修复：配方通过 datapack JSON 加载，不应在 Java 中 register 一个 String 为 Recipe<?>。
 * Java 类仅保留 ID 常量。
 */
export function neoforgeModRecipesJava(spec: ModSpecLike, pkg: string): FileNode {
  const recipes = spec.recipes ?? [];
  const fields = recipes
    .map((r) => `    public static final String ${r.recipeId.toUpperCase()}_ID = "${r.recipeId}";`)
    .join('\n');
  const comments = recipes
    .map(
      (r) =>
        `        // ${r.recipeId} (${r.recipeType}) → ${r.output} x${r.outputCount}: 通过 datapack JSON 加载`,
    )
    .join('\n');

  const content = `package ${pkg};

public class ModRecipes {
    public static final String MOD_ID = "${spec.modId}";

${fields}

    public static void initialize() {
${comments}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModRecipes.java`,
    content,
  };
}

/**
 * 生成 ModEntities.java：用 DeferredRegister 注册 EntityType。
 * P0 dogfood 修复：使用 Supplier<EntityType<T>> 而非不存在的 DeferredEntity<T>，
 * .sized() 替代 .dimensions()，.build(ResourceKey) 替代 .build()
 */
export function neoforgeModEntitiesJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const entities = spec.entities ?? [];
  const fields = entities
    .map((e) => {
      const baseClass = neoforgeEntityBaseClass(e.modelType);
      return `    public static final Supplier<EntityType<${baseClass}>> ${e.entityId.toUpperCase()} = ENTITIES.register("${e.entityId}", () -> EntityType.Builder.<${baseClass}>of(${neoforgeEntityFactory(e.modelType)}, ${neoforgeMobCategory(e.classification)}).sized(0.6f, 1.8f).build(ResourceKey.create(Registries.ENTITY_TYPE, ResourceLocation.fromNamespaceAndPath(${mainCls}.MOD_ID, "${e.entityId}"))));`;
    })
    .join('\n');
  const comments = entities
    .map(
      (e) =>
        `        // ${e.entityId} (${e.displayName}): maxHealth=${e.maxHealth}, attackDamage=${e.attackDamage}, speed=${e.movementSpeed}, weight=${e.spawnWeight}, biomes=${JSON.stringify(e.spawnBiomes)}`,
    )
    .join('\n');
  const content = `package ${pkg};

import java.util.function.Supplier;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModEntities {
    public static final DeferredRegister.Entities ENTITIES = DeferredRegister.createEntities(${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        ENTITIES.register(modEventBus);
${comments}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModEntities.java`,
    content,
  };
}

/**
 * 生成 ModMachines.java：用 DeferredRegister 注册 BlockEntityType 和 MenuType。
 *
 * G-2 修复：原实现引用不存在的 ModBlocks.${MACHINE_ID}（方块 id 与 machineId 不一定相同）
 * 和 ${Pascal}BlockEntity / ${Pascal}Menu 顶层类，生成代码无法编译。
 * 现在每个机器生成嵌套占位类（BlockEntity/Menu），注册时用 Blocks.STONE 占位方块，
 * 保证可编译，并注释提示替换为实际实现。
 */
export function neoforgeModMachinesJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const machines = spec.machines ?? [];
  const blockEntityFields = machines
    .map((m) => {
      const pascal = toPascal(m.machineId);
      const id = m.machineId.toUpperCase();
      return `    public static final DeferredHolder<BlockEntityType<?>, BlockEntityType<?>> ${id}_BE = BLOCK_ENTITIES.register("${m.machineId}", () -> BlockEntityType.Builder.of(${pascal}BlockEntity::new, Blocks.STONE).build(null));`;
    })
    .join('\n');
  const menuFields = machines
    .map((m) => {
      const pascal = toPascal(m.machineId);
      const id = m.machineId.toUpperCase();
      return `    public static final DeferredHolder<MenuType<?>, MenuType<?>> ${id}_MENU = MENUS.register("${m.machineId}", () -> IMenuTypeExtension.create(${pascal}Menu::new));`;
    })
    .join('\n');
  const placeholderClasses = machines
    .map((m) => {
      const pascal = toPascal(m.machineId);
      const id = m.machineId.toUpperCase();
      const totalSlots = m.inputSlots + m.outputSlots;
      return `    // ${pascal}BlockEntity：能源存储 + 输入/输出槽位 + 简易加工
    public static class ${pascal}BlockEntity extends BlockEntity {
        public static final int ENERGY_CAPACITY = ${m.energyCapacity};
        public static final int ENERGY_PER_TICK = ${m.defaultEnergyPerTick};
        public static final int PROCESS_TIME = ${m.defaultProcessTime};
        private int energy = 0;
        private int progress = 0;
        private final net.minecraft.world.SimpleContainer inventory = new net.minecraft.world.SimpleContainer(${totalSlots});

        public ${pascal}BlockEntity(BlockPos pos, BlockState state) {
            super(${id}_BE.get(), pos, state);
        }

        public int getEnergy() { return energy; }
        public int getMaxEnergy() { return ENERGY_CAPACITY; }
        public int receiveEnergy(int amount) {
            int accepted = Math.min(amount, ENERGY_CAPACITY - energy);
            energy += accepted;
            return accepted;
        }
        public int extractEnergy(int amount) {
            int taken = Math.min(amount, energy);
            energy -= taken;
            return taken;
        }

        public net.minecraft.world.SimpleContainer getInventory() { return inventory; }

        public void tickServer() {
            if (energy >= ENERGY_PER_TICK && progress < PROCESS_TIME) {
                energy -= ENERGY_PER_TICK;
                progress++;
            } else if (progress >= PROCESS_TIME) {
                progress = 0;
                // 配方映射：输入物品 ID → 输出物品 ID（未匹配时回退原样搬运）
                for (int i = 0; i < ${m.inputSlots}; i++) {
                    var stack = inventory.getItem(i);
                    if (!stack.isEmpty()) {
                        var outStack = inventory.getItem(${m.inputSlots});
                        if (outStack.isEmpty()) {
                            String outId = recipeOutput(stack.getItem().getDescriptionId());
                            if (outId != null) {
                                var output = new net.minecraft.world.item.ItemStack(net.minecraft.core.registries.BuiltInRegistries.ITEM.get(net.minecraft.resources.ResourceLocation.parse(outId)), 1);
                                inventory.setItem(${m.inputSlots}, output);
                                stack.shrink(1);
                            } else {
                                inventory.setItem(${m.inputSlots}, stack.copyWithCount(1));
                                stack.shrink(1);
                            }
                        }
                        break;
                    }
                }
            }
        }

        // 配方映射查找（从 spec 生成）
        private static String recipeOutput(String inputItemId) {
            String id = inputItemId.replace("item.", "").replace(".", ":");
            switch (id) {
${machineRecipeCases(m)}
                default:
                    return null;
            }
        }
    }

    // ${pascal}Menu：输入槽(0..${m.inputSlots - 1}) + 输出槽(${m.inputSlots}..${totalSlots - 1}) + 玩家背包(9×3)
    public static class ${pascal}Menu extends AbstractContainerMenu {
        private final net.minecraft.world.SimpleContainer machineInv;

        public ${pascal}Menu(int id, Inventory inv) {
            super(${id}_MENU.get(), id);
            this.machineInv = new net.minecraft.world.SimpleContainer(${totalSlots});
            for (int i = 0; i < ${totalSlots}; i++) {
                this.addSlot(new Slot(machineInv, i, 8 + (i % 9) * 18, 18 + (i / 9) * 18));
            }
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(inv, col + row * 9 + 9, 8 + col * 18, 84 + row * 18));
                }
            }
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(inv, col, 8 + col * 18, 142));
            }
        }

        @Override
        public net.minecraft.world.item.ItemStack quickMoveStack(net.minecraft.world.entity.player.Player player, int index) {
            return net.minecraft.world.item.ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(net.minecraft.world.entity.player.Player player) {
            return true;
        }
    }`;
    })
    .join('\n\n');
  const comments = machines
    .map(
      (m) =>
        `        // ${m.machineId} (${m.displayName}): energyCap=${m.energyCapacity}, transfer=${m.maxEnergyTransfer}, in=${m.inputSlots}, out=${m.outputSlots}, time=${m.defaultProcessTime}, ept=${m.defaultEnergyPerTick}, gui=${m.guiWidth}x${m.guiHeight}`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraft.core.BlockPos;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.extensions.IMenuTypeExtension;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

public class ModMachines {
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES = DeferredRegister.create(net.minecraft.core.registries.Registries.BLOCK_ENTITY_TYPE, ${mainCls}.MOD_ID);
    public static final DeferredRegister<MenuType<?>> MENUS = DeferredRegister.create(net.minecraft.core.registries.Registries.MENU, ${mainCls}.MOD_ID);

${blockEntityFields}
${menuFields}
${placeholderClasses}

    public static void register(IEventBus modEventBus) {
        BLOCK_ENTITIES.register(modEventBus);
        MENUS.register(modEventBus);
${comments}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModMachines.java`,
    content,
  };
}

/**
 * 生成 ModCustomCode.java：与 Fabric 一致，把每个 snippet 嵌入为独立方法。
 * NeoForge 没有 Fabric 的 initialize() 模式，但代码片段是纯 Java 方法，无需 loader 特化。
 */
export function neoforgeModCustomCodeJava(spec: ModSpecLike, pkg: string): FileNode {
  const snippets = spec.customCode ?? [];
  const methods = snippets
    .map((s) => {
      const methodName = s.methodName || 'process';
      const inputParams = Object.entries(s.inputSignature)
        .map(([k, v]) => `${portTypeToJava(v)} ${k}`)
        .join(', ');
      const outputEntries = Object.entries(s.outputSignature);
      const outputType =
        outputEntries.length === 1
          ? portTypeToJava(outputEntries[0][1])
          : outputEntries.length > 1
            ? 'Object'
            : 'void';
      const userCode = s.code || '// (empty)';
      const indentedCode = userCode
        .split('\n')
        .map((line) => `        ${line}`)
        .join('\n');
      return `    // snippetId: ${s.snippetId} (language: ${s.language})
    // inputSignature:  ${JSON.stringify(s.inputSignature)}
    // outputSignature: ${JSON.stringify(s.outputSignature)}
    public static ${outputType} ${methodName}(${inputParams}) {
${indentedCode}
    }`;
    })
    .join('\n\n');

  const content = `package ${pkg};

public class ModCustomCode {
    public static final String MOD_ID = "${spec.modId}";

${methods}

    public static void initialize() {
        // Custom code snippets loaded (${snippets.length} snippet(s))
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModCustomCode.java`,
    content,
  };
}

/**
 * 生成 ModMultiblocks.java：与 Fabric 一致，生成结构尺寸常量。
 */
export function neoforgeModMultiblocksJava(spec: ModSpecLike, pkg: string): FileNode {
  const multiblocks = spec.multiblocks ?? [];
  const constants = multiblocks
    .map((m) => {
      const name = m.structureId.toUpperCase();
      return `    // 结构: ${m.structureId} (${m.displayName})
    // 尺寸: ${m.width}x${m.height}x${m.depth}, 空心: ${m.hollow}
    // 控制器偏移: (${m.controllerOffset.x}, ${m.controllerOffset.y}, ${m.controllerOffset.z})
    public static final String ${name}_ID = "${m.structureId}";
    public static final int ${name}_WIDTH = ${m.width};
    public static final int ${name}_HEIGHT = ${m.height};
    public static final int ${name}_DEPTH = ${m.depth};
    public static final boolean ${name}_HOLLOW = ${m.hollow};
    public static final int ${name}_CONTROLLER_X = ${m.controllerOffset.x};
    public static final int ${name}_CONTROLLER_Y = ${m.controllerOffset.y};
    public static final int ${name}_CONTROLLER_Z = ${m.controllerOffset.z};`;
    })
    .join('\n');
  const content = `package ${pkg};

public class ModMultiblocks {
    public static final String MOD_ID = "${spec.modId}";

${constants}

    public static void initialize() {
        // Multiblock structures registered (${multiblocks.length} structure(s))
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModMultiblocks.java`,
    content,
  };
}

/**
 * 生成 ModEvents.java：根据 conditionIds/actionIds/procedureCallIds 引用生成事件处理逻辑。
 *
 * 结构与 Fabric 一致：
 *   - initialize()：按 eventType 用 IEventBus.addListener 注册
 *   - handle_<handlerId>(Object event)：根据 conditionIds 生成 if 语句（invert 加 !），
 *     块内调用 actionIds 对应的 execute_<actionId>，以及 procedureCallIds 对应的 procedure_<name>
 *   - procedure_<procedureName>(Object event)：P1-3 过程方法（命名的可复用逻辑单元，
 *     含 conditionIds/actionIds/procedureCallIds，结构与 handle_ 同构；可被多个 event/procedure 调用）
 *   - check_<conditionId>(Object event)：条件检查方法（return true 占位）
 *   - execute_<actionId>(Object event)：动作执行方法（空方法体占位）
 *
 * 多条件使用 AND 合取（与 Fabric 同步修复：旧版独立 if → actions 重复执行 N 次）
 */
export function neoforgeModEventsJava(spec: ModSpecLike, pkg: string, _mainCls: string): FileNode {
  const handlers = spec.eventHandlers ?? [];
  const conditions = spec.conditions ?? [];
  const actions = spec.actions ?? [];
  const procedures = spec.procedures ?? [];

  // 构建 conditionId → ConditionSpec 映射（用于查找 invert 状态 + dangling 检测）
  const conditionMap = new Map(conditions.map((c) => [c.conditionId, c]));
  // 构建 actionId Set（用于 dangling 检测）
  const actionIdSet = new Set(actions.map((a) => a.actionId));
  // P1-3：构建 procedureId → procedureName 映射（用于解析 procedureCallIds → 方法名）
  const procedureNameMap = new Map(procedures.map((p) => [p.procedureId, p.procedureName]));

  // initialize() 中的事件注册调用（NeoForge: 用 IEventBus.addListener 注册）
  // P2 dogfood：从注释占位升级为实际 addListener 调用代码
  // P2.1 事件参数绑定：事件对象 getter 绑定为 EventContext 字段
  const registrations = handlers
    .map((h) => {
      const handlerMethod = `handle_${sanitizeIdent(h.handlerId)}`;
      const eventClass = neoforgeEventClass(h.eventType);
      return `        // handlerId: ${h.handlerId} (eventType: ${h.eventType})
        modEventBus.addListener(${eventClass}.class, event -> {
            EventContext ctx = new EventContext();
${neoforgeEventBindings(h.eventType)}
            ${handlerMethod}(ctx);
        });`;
    })
    .join('\n');

  // 生成方法体（conditionIds → AND 合取 if 块 + actionIds/procedureCallIds 调用）。
  // handle_ 与 procedure_ 共用此逻辑，区别仅在方法签名与注释。
  // P40：callArgs 为 procedureCallId → 表达式数组（缺省回退参数类型默认值）。
  const buildBody = (
    conditionIds: string[],
    actionIds: string[],
    procCallIds: string[],
    callArgs?: Record<string, string[]>,
  ): string => {
    // 过滤 dangling 引用：conditionId/actionId 必须在对应 spec 中存在
    const validCondIds = conditionIds.filter((cid) => conditionMap.has(cid));
    const validActionIds = actionIds.filter((aid) => actionIdSet.has(aid));

    // 把过程调用 id 列表解析为 procedure_<name>(ctx, args...) 调用语句（缩进由调用方决定）
    const resolveProcCalls = (indent: string): string =>
      procCallIds.length
        ? procCallIds
            .map((pid) => {
              const name = procedureNameMap.get(pid);
              if (!name) return `${indent}// (未知过程: ${pid})`;
              const args = callArgs?.[pid] ?? [];
              const proc = procedures.find((p) => p.procedureId === pid);
              const defaults = (proc?.inputs ?? []).map((inp) => defaultValueFor(inp.type));
              const exprs = (proc?.inputs ?? []).map((inp, i) => args[i] || defaults[i]);
              const argList = exprs?.length ? `, ${exprs.join(', ')}` : '';
              return `${indent}procedure_${sanitizeIdent(name)}(ctx${argList});`;
            })
            .join('\n')
        : '';

    // 多条件使用 AND 合取：所有条件都满足时才执行动作
    // 修复：旧版为每个条件独立 if → actions 重复执行 N 次
    if (validCondIds.length > 0) {
      const combinedCheck = validCondIds
        .map((cid) => {
          const cond = conditionMap.get(cid);
          const invert = cond?.invert ?? false;
          return `${invert ? '!' : ''}check_${sanitizeIdent(cid)}(ctx)`;
        })
        .join(' && ');
      const actionCalls = validActionIds.length
        ? validActionIds.map((aid) => `            execute_${sanitizeIdent(aid)}(ctx);`).join('\n')
        : '';
      const innerProcCalls = resolveProcCalls('            ');
      const innerBody =
        [actionCalls, innerProcCalls].filter(Boolean).join('\n') ||
        '            // (无关联 action)';
      return `        if (${combinedCheck}) {
${innerBody}
        }`;
    }

    // 无条件：直接执行
    if (validActionIds.length || procCallIds.length) {
      return `        // (无关联 condition，直接执行)
${[
  ...validActionIds.map((aid) => `        execute_${sanitizeIdent(aid)}(ctx);`),
  ...resolveProcCalls('        ').split('\n').filter(Boolean),
].join('\n')}`;
    }

    return '        // (无关联 condition 与 action)';
  };

  // 每个事件处理器的 handle_<handlerId> 方法
  const handlerMethods = handlers
    .map((h) => {
      const handlerName = `handle_${sanitizeIdent(h.handlerId)}`;
      const body = buildBody(
        h.conditionIds ?? [],
        h.actionIds ?? [],
        h.procedureCallIds ?? [],
        h.procedureCallArgs,
      );
      return `    // 事件处理器: ${h.handlerId} (eventType: ${h.eventType})
    // eventArgs: ${JSON.stringify(h.eventArgs)}
    private static void ${handlerName}(EventContext ctx) {
${body}
    }`;
    })
    .join('\n\n');

  // P1-3：过程方法（命名的可复用逻辑单元，可被 event/procedure 调用）
  // P40：inputs 参数生成方法签名（procedure_<name>(ctx, type name, ...)）
  const procedureMethods = procedures
    .map((p) => {
      const methodName = `procedure_${sanitizeIdent(p.procedureName)}`;
      const body = buildBody(p.conditionIds, p.actionIds, p.procedureCallIds, p.procedureCallArgs);
      const paramList = (p.inputs ?? [])
        .map((inp) => `${javaTypeFor(inp.type)} ${inp.name}`)
        .join(', ');
      const signature = paramList ? `EventContext ctx, ${paramList}` : 'EventContext ctx';
      return `    // 过程: ${p.procedureId} (name: ${p.procedureName})
    // inputs: ${JSON.stringify(p.inputs ?? [])}
    // 可被 event/procedure 调用，复用此方法
    private static void ${methodName}(${signature}) {
${body}
    }`;
    })
    .join('\n\n');

  // 条件检查方法（遍历 spec.conditions 全量生成，含未被 handler 引用的）
  const conditionMethods = conditions
    .map((c) => {
      const methodName = `check_${sanitizeIdent(c.conditionId)}`;
      // P1-7：常见条件类型生成真实检查逻辑（event-logic.ts），其余保留 TODO
      const body =
        conditionCheckBody(c) ??
        `        // TODO: 实现 ${c.conditionType} 检查逻辑
        return true;`;
      return `    // 条件: ${c.conditionId} (invert: ${c.invert})
    // conditionType: ${c.conditionType}
    // args: ${JSON.stringify(c.args)}
    private static boolean ${methodName}(EventContext ctx) {
${body}
    }`;
    })
    .join('\n\n');

  // 动作执行方法（遍历 spec.actions 全量生成，含未被 handler 引用的）
  const actionMethods = actions
    .map((a) => {
      const methodName = `execute_${sanitizeIdent(a.actionId)}`;
      // P1-7：常见动作类型生成真实执行逻辑（event-logic.ts），其余保留 TODO
      const body = actionExecuteBody(a) ?? `        // TODO: 实现 ${a.actionType} 执行逻辑`;
      return `    // 动作: ${a.actionId}
    // actionType: ${a.actionType}
    // args: ${JSON.stringify(a.args)}
    private static void ${methodName}(EventContext ctx) {
${body}
    }`;
    })
    .join('\n\n');

  const allMethods = [handlerMethods, procedureMethods, conditionMethods, actionMethods]
    .filter(Boolean)
    .join('\n\n');

  // 事件上下文：承载回调参数（NeoForge 事件 getter 在此绑定），供条件/动作逻辑读取
  const eventContextClass = `    // 事件上下文：回调参数绑定字段（事件未提供时保持 null，逻辑侧判空保护）
    private static class EventContext {
        net.minecraft.server.level.ServerPlayer player = null;
        net.minecraft.server.level.ServerLevel level = null;
        net.minecraft.core.BlockPos pos = null;
        net.minecraft.world.level.block.state.BlockState state = null;
        net.minecraft.world.item.ItemStack stack = null;
        net.minecraft.world.entity.Entity target = null;
    }`;

  const content = `package ${pkg};

import net.neoforged.bus.api.IEventBus;

public class ModEvents {
    public static final String MOD_ID = "${spec.modId}";
${eventContextClass}

${allMethods}

    public static void initialize(IEventBus modEventBus) {
${registrations || '        // (无事件处理器)'}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModEvents.java`,
    content,
  };
}
