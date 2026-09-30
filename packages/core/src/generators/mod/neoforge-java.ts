/**
 * NeoForge Adapter 的 Java 类生成域（Forge 1.20.1 / NeoForge 20.1 目标）。
 *
 * 目标映射：Mojang 官方映射（非 Yarn）。包与 API 全部按 1.20.1 Mojang 名编写，
 * 关键签名逐条经 javap 对 Mojang 官方映射服务端 jar + Forge 47 universal 核对：
 * - 注册：DeferredRegister.create(ForgeRegistries.*, MOD_ID) + RegistryObject
 * - 事件：MinecraftForge.EVENT_BUS.<Event>addListener(lambda)（Forge 总线，
 *   mod 总线收不到游戏事件）
 * - 菜单：IForgeMenuType.create（MenuType 构造器私有，不可 new）
 * - 流体：FluidType + ForgeFlowingFluid.Source/Flowing
 * - 生物群系/维度/结构：动态注册表，Java 侧只留 ID 常量，实体走数据包 JSON
 *  （见 worldgen-json-generator.ts，由 adapter 接 worldgen 类别）
 */
import type { FileNode } from '@mc-creator/shared';
import { javaEscape, packagePath } from './templates.js';
import { mojangConditionCheckBody, mojangActionExecuteBody } from './mojang-event-logic.js';
import { formatUnsupportedComment } from './unsupported.js';
import {
  defaultValueFor,
  javaTypeForMojang,
  machineRecipeCases,
  portTypeToJava,
  sanitizeIdent,
  toPascal,
  type ModSpecLike,
} from './mod-common.js';

/**
 * 根据 modelType 返回实体类名（Mojang 映射：类名无 Entity 后缀）。
 * custom 无具体类，用 Pig 占位（Entity 为抽象类，方法引用无法编译）。
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
      return 'Pig';
  }
}

/** 根据 modelType 返回实体工厂引用（Mojang 构造器均为 (EntityType, Level)） */
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
      return 'Pig::new';
  }
}

/** modelType 对应实体类的 Mojang 包（monster/animal） */
export function neoforgeEntityPackage(cls: string): string {
  switch (cls) {
    case 'Zombie':
    case 'Skeleton':
    case 'Creeper':
      return 'net.minecraft.world.entity.monster';
    case 'Pig':
    case 'Cow':
      return 'net.minecraft.world.entity.animal';
    default:
      return 'net.minecraft.world.entity';
  }
}

/** classification → Mojang MobCategory 映射 */
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

export function neoforgeModItemsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const fields = spec.items
    .map(
      (it) =>
        `    public static final RegistryObject<Item> ${it.id.toUpperCase()} = ITEMS.register("${it.id}", () -> new Item(new Item.Properties()));`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.world.item.Item;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public class ModItems {
    public static final DeferredRegister<Item> ITEMS = DeferredRegister.create(ForgeRegistries.ITEMS, ${mainCls}.MOD_ID);

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
      // 应用 spec 方块属性：BlockBehaviour.Properties（Mojang 名）
      const props = `BlockBehaviour.Properties.of().strength(${b.hardness}f, ${b.resistance ?? b.hardness}f)`;
      return `    public static final RegistryObject<Block> ${b.id.toUpperCase()} = BLOCKS.register("${b.id}", () -> new Block(${props}));`;
    })
    .join('\n');
  // 配套 BlockItem（无物品的方块无法进背包）：与方块同 id 注册
  const itemFields = spec.blocks
    .map(
      (b) =>
        `    public static final RegistryObject<Item> ${b.id.toUpperCase()}_ITEM = BLOCK_ITEMS.register("${b.id}", () -> new BlockItem(${b.id.toUpperCase()}.get(), new Item.Properties()));`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.world.item.BlockItem;
import net.minecraft.world.item.Item;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.state.BlockBehaviour;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public class ModBlocks {
    public static final DeferredRegister<Block> BLOCKS = DeferredRegister.create(ForgeRegistries.BLOCKS, ${mainCls}.MOD_ID);
    public static final DeferredRegister<Item> BLOCK_ITEMS = DeferredRegister.create(ForgeRegistries.ITEMS, ${mainCls}.MOD_ID);

${fields}

${itemFields}

    public static void register(IEventBus modEventBus) {
        BLOCKS.register(modEventBus);
        BLOCK_ITEMS.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModBlocks.java`,
    content,
  };
}

/**
 * Task D：生成 ModFluids.java（Forge 47 风格）。
 * FluidType + ForgeFlowingFluid.Source/Flowing 成对注册；木桶/流体方块暂用
 * 原版占位（WATER_BUCKET/WATER），配套资源见类注释。
 */
export function neoforgeModFluidsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const fields = (spec.fluids ?? [])
    .map((f) => {
      const upper = f.fluidId.toUpperCase();
      const pascal = toPascal(f.fluidId);
      return `    public static final RegistryObject<FluidType> ${upper}_TYPE = FLUID_TYPES.register("${f.fluidId}", () -> new FluidType(FluidType.Properties.create()));
    public static final RegistryObject<ForgeFlowingFluid.Source> ${upper} = FLUIDS.register("${f.fluidId}", () -> new ForgeFlowingFluid.Source(${pascal}Props()));
    public static final RegistryObject<ForgeFlowingFluid.Flowing> ${upper}_FLOWING = FLUIDS.register("${f.fluidId}_flowing", () -> new ForgeFlowingFluid.Flowing(${pascal}Props()));`;
    })
    .join('\n');
  // 每个流体独立的 Properties 方法（引用自身三项注册；lambda 延迟求值，无初始化顺序问题）
  const propsMethods = (spec.fluids ?? [])
    .map((f) => {
      const upper = f.fluidId.toUpperCase();
      const pascal = toPascal(f.fluidId);
      return `    // ${f.displayName}：木桶暂用原版占位（无配套流体方块，block() 从缺）；
    // 真实接线（流体方块/客户端渲染）需配套资源，见 docs
    private static ForgeFlowingFluid.Properties ${pascal}Props() {
        return new ForgeFlowingFluid.Properties(() -> ${upper}_TYPE.get(), () -> ${upper}.get(), () -> ${upper}_FLOWING.get())
            .bucket(() -> Items.WATER_BUCKET);
    }`;
    })
    .join('\n\n');
  const content = `package ${pkg};

import net.minecraft.world.item.Items;
import net.minecraft.world.level.material.Fluid;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.fluids.FluidType;
import net.minecraftforge.fluids.ForgeFlowingFluid;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public class ModFluids {
    public static final DeferredRegister<FluidType> FLUID_TYPES = DeferredRegister.create(ForgeRegistries.FLUID_TYPES.get(), ${mainCls}.MOD_ID);
    public static final DeferredRegister<Fluid> FLUIDS = DeferredRegister.create(ForgeRegistries.FLUIDS, ${mainCls}.MOD_ID);

${fields}

${propsMethods}

    public static void register(IEventBus modEventBus) {
        FLUID_TYPES.register(modEventBus);
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
 * Mod 侧生物群系：只保留 ID 常量。
 * 生物群系是动态注册表内容，实体走数据包 worldgen/biome JSON
 *（见 worldgen-json-generator.ts，由 adapter 接 worldgen 类别）。
 */
export function neoforgeModBiomesJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.biomes ?? [])
    .map(
      (b) =>
        `    // Biome: ${b.biomeId} — ${b.displayName}（动态注册表内容，见数据包注释）\n    public static final String ${b.biomeId.toUpperCase()}_ID = "${b.biomeId}";`,
    )
    .join('\n');
  const content = `package ${pkg};

public class ModBiomes {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
        // 生物群系为动态注册表内容：随 data/<modid>/worldgen/biome JSON 下发，上方常量仅作 Java 侧引用占位。
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModBiomes.java`,
    content,
  };
}

/**
 * Mod 侧维度：只保留 ID 常量（dimension_type + dimension 走数据包 JSON）。
 */
export function neoforgeModDimensionsJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.dimensions ?? [])
    .map(
      (d) =>
        `    // DimensionType: ${d.dimensionId} — ${d.displayName}（动态注册表内容，见数据包注释）\n    public static final String ${d.dimensionId.toUpperCase()}_ID = "${d.dimensionId}";`,
    )
    .join('\n');
  const content = `package ${pkg};

public class ModDimensions {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
        // 维度类型为动态注册表内容：随 data/<modid>/dimension_type + dimension JSON 下发，上方常量仅作 Java 侧引用占位。
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModDimensions.java`,
    content,
  };
}

/**
 * GUI 界面：生成 ModGuis.java（Forge 47）。
 * MenuType 经 IForgeMenuType.create（MenuType 构造器私有）；Screen 为客户端渲染骨架，
 * 需客户端绑定（MenuScreens.register），见注释。
 */
export function neoforgeModGuisJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
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
        private final SimpleContainer machineInv;

        public ${pascal}Menu(int id, Inventory inv) {
            super(${pascal.toUpperCase()}_MENU_TYPE.get(), id);
            this.machineInv = new SimpleContainer(${slotCount});
${slotAdds}
            // 玩家背包
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
        public ItemStack quickMoveStack(Player player, int index) {
            return ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(Player player) {
            return true;
        }
    }

    // ${pascal}Screen：GUI 渲染骨架（客户端类；需在客户端 setup 经 MenuScreens.register 绑定，见注释）
    public static class ${pascal}Screen extends AbstractContainerScreen<${pascal}Menu> {
        public ${pascal}Screen(${pascal}Menu menu, Inventory inv, Component title) {
            super(menu, inv, title);
            this.imageWidth = ${g.width};
            this.imageHeight = ${g.height};
        }

        @Override
        protected void renderBg(GuiGraphics graphics, float partialTick, int mouseX, int mouseY) {
            graphics.blit(new ResourceLocation(MOD_ID, "textures/gui/${g.guiId}.png"), this.leftPos, this.topPos, 0, 0, this.imageWidth, this.imageHeight);
        }

        @Override
        public void render(GuiGraphics graphics, int mouseX, int mouseY, float partialTick) {
            super.render(graphics, mouseX, mouseY, partialTick);
            this.renderTooltip(graphics, mouseX, mouseY);
        }
    }

    public static final RegistryObject<MenuType<${pascal}Menu>> ${pascal.toUpperCase()}_MENU_TYPE = MENUS.register("${g.guiId}", () -> new MenuType<>((id, inv) -> new ${pascal}Menu(id, inv), FeatureFlags.DEFAULT_FLAGS));`;
    })
    .join('\n\n');
  const content = `package ${pkg};

import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.client.gui.screens.inventory.AbstractContainerScreen;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public class ModGuis {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
    public static final DeferredRegister<MenuType<?>> MENUS = DeferredRegister.create(ForgeRegistries.MENU_TYPES, ${mainCls}.MOD_ID);
${guiClasses}

    public static void register(IEventBus modEventBus) {
        MENUS.register(modEventBus);
        // 客户端绑定（示例，需客户端 setup 调用）：
        // MenuScreens.register(RUBYGUI_MENU_TYPE.get(), RubyGuiMenuScreen::new);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModGuis.java`,
    content,
  };
}

/**
 * Mod 侧结构：只保留 ID 常量（structure/structure_set/template_pool 走数据包 JSON）。
 */
export function neoforgeModStructuresJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.structures ?? [])
    .map(
      (s) =>
        `    // Structure: ${s.structureId} — ${s.displayName}（startPool=${s.startPool}，动态注册表内容，见数据包注释）\n    public static final String ${s.structureId.toUpperCase()}_ID = "${s.structureId}";`,
    )
    .join('\n');
  const content = `package ${pkg};

public class ModStructures {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
        // 结构/结构集为动态注册表内容：随 data/<modid>/worldgen/structure + structure_set + template_pool JSON 下发，上方常量仅作 Java 侧引用占位。
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModStructures.java`,
    content,
  };
}

/**
 * 生成 ModRecipes.java：配方通过 datapack JSON 加载，Java 仅保留 ID 常量。
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
 * 生成 ModEntities.java：DeferredRegister(ForgeRegistries.ENTITY_TYPES) + Mojang Builder。
 * custom 模型无具体类，用 Pig 占位（Entity 抽象，方法引用无法编译）。
 */
export function neoforgeModEntitiesJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const entities = spec.entities ?? [];
  const fields = entities
    .map((e) => {
      const baseClass = neoforgeEntityBaseClass(e.modelType);
      const category = neoforgeMobCategory(e.classification);
      return `    // Entity: ${e.entityId} (${e.modelType}, ${e.classification}) — ${e.displayName}
    // maxHealth=${e.maxHealth}, attackDamage=${e.attackDamage}, movementSpeed=${e.movementSpeed}
    public static final RegistryObject<EntityType<${baseClass}>> ${e.entityId.toUpperCase()} = ENTITIES.register("${e.entityId}", () -> EntityType.Builder.<${baseClass}>of(${neoforgeEntityFactory(e.modelType)}, ${category}).sized(0.6f, 1.8f).build("${e.entityId}"));`;
    })
    .join('\n');
  const usedEntityClasses = [
    ...new Set(entities.map((e) => neoforgeEntityBaseClass(e.modelType))),
  ].sort();
  const entityImports = usedEntityClasses
    .map((c) => `import ${neoforgeEntityPackage(c)}.${c};`)
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
${entityImports}
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public class ModEntities {
    public static final DeferredRegister<EntityType<?>> ENTITIES = DeferredRegister.create(ForgeRegistries.ENTITY_TYPES, ${mainCls}.MOD_ID);

${fields}

    public static void register(IEventBus modEventBus) {
        ENTITIES.register(modEventBus);
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModEntities.java`,
    content,
  };
}

/**
 * 生成 ModMachines.java：BlockEntityType + MenuType 占位骨架（Forge 47）。
 * 注册用 Blocks.STONE 占位方块，保证可编译，注释提示替换为实际实现。
 */
export function neoforgeModMachinesJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const machines = spec.machines ?? [];
  const blockEntityFields = machines
    .map((m) => {
      const pascal = toPascal(m.machineId);
      const id = m.machineId.toUpperCase();
      return `    public static final RegistryObject<BlockEntityType<${pascal}BlockEntity>> ${id}_BE = BLOCK_ENTITIES.register("${m.machineId}", () -> BlockEntityType.Builder.of(${pascal}BlockEntity::new, Blocks.STONE).build(null));`;
    })
    .join('\n');
  const menuFields = machines
    .map((m) => {
      const pascal = toPascal(m.machineId);
      const id = m.machineId.toUpperCase();
      return `    public static final RegistryObject<MenuType<${pascal}Menu>> ${id}_MENU = MENUS.register("${m.machineId}", () -> new MenuType<>((mid, inv) -> new ${pascal}Menu(mid, inv), FeatureFlags.DEFAULT_FLAGS));`;
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
        private final SimpleContainer inventory = new SimpleContainer(${totalSlots});

        public ${pascal}BlockEntity(BlockPos pos, BlockState state) {
            super(${id}_BE.get(), pos, state);
        }

        // 能源 API：加/取/查
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

        // 槽位访问：输入槽在前，输出槽在后
        public SimpleContainer getInventory() { return inventory; }

        // tick 处理：耗能推进加工进度（输出槽有空间时）
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
                                var output = new net.minecraft.world.item.ItemStack(net.minecraftforge.registries.ForgeRegistries.ITEMS.getValue(new net.minecraft.resources.ResourceLocation(outId)), 1);
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
        private final SimpleContainer machineInv;

        public ${pascal}Menu(int id, Inventory inv) {
            super(${id}_MENU.get(), id);
            this.machineInv = new SimpleContainer(${totalSlots});
            // 机器槽位
            for (int i = 0; i < ${totalSlots}; i++) {
                this.addSlot(new Slot(machineInv, i, 8 + (i % 9) * 18, 18 + (i / 9) * 18));
            }
            // 玩家背包
            for (int row = 0; row < 3; row++) {
                for (int col = 0; col < 9; col++) {
                    this.addSlot(new Slot(inv, col + row * 9 + 9, 8 + col * 18, 84 + row * 18));
                }
            }
            // 快捷栏
            for (int col = 0; col < 9; col++) {
                this.addSlot(new Slot(inv, col, 8 + col * 18, 142));
            }
        }

        @Override
        public ItemStack quickMoveStack(Player player, int index) {
            return ItemStack.EMPTY;
        }

        @Override
        public boolean stillValid(Player player) {
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

import net.minecraft.core.BlockPos;
import net.minecraft.world.SimpleContainer;
import net.minecraft.world.entity.player.Inventory;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.flag.FeatureFlags;
import net.minecraft.world.inventory.AbstractContainerMenu;
import net.minecraft.world.inventory.MenuType;
import net.minecraft.world.inventory.Slot;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.entity.BlockEntity;
import net.minecraft.world.level.block.entity.BlockEntityType;
import net.minecraft.world.level.block.state.BlockState;
import net.minecraftforge.eventbus.api.IEventBus;
import net.minecraftforge.registries.DeferredRegister;
import net.minecraftforge.registries.ForgeRegistries;
import net.minecraftforge.registries.RegistryObject;

public class ModMachines {
    public static final DeferredRegister<BlockEntityType<?>> BLOCK_ENTITIES = DeferredRegister.create(ForgeRegistries.BLOCK_ENTITY_TYPES, ${mainCls}.MOD_ID);
    public static final DeferredRegister<MenuType<?>> MENUS = DeferredRegister.create(ForgeRegistries.MENU_TYPES, ${mainCls}.MOD_ID);

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
 * 代码片段是纯 Java 方法，无需 loader 特化。
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
 * 生成 ModEvents.java：事件处理逻辑（Forge 47）。
 *
 * 结构与 Fabric 一致，差异：
 * - 注册走 MinecraftForge.EVENT_BUS（Forge 总线；mod 总线收不到游戏事件），
 *   故 register() 无参；
 * - 条件/动作方法体走 mojang-event-logic.ts（Mojang 映射）；
 * - 过程签名走 javaTypeForMojang。
 */
export function neoforgeModEventsJava(spec: ModSpecLike, pkg: string, _mainCls: string): FileNode {
  const handlers = spec.eventHandlers ?? [];
  const conditions = spec.conditions ?? [];
  const actions = spec.actions ?? [];
  const procedures = spec.procedures ?? [];

  const conditionMap = new Map(conditions.map((c) => [c.conditionId, c]));
  const actionIdSet = new Set(actions.map((a) => a.actionId));
  const procedureNameMap = new Map(procedures.map((p) => [p.procedureId, p.procedureName]));

  // initialize() → register()：按 eventType 选择 Forge 事件，用显式泛型见证注册
  const registrations = handlers
    .map((h) => {
      const handlerMethod = `handle_${sanitizeIdent(h.handlerId)}`;
      const eventClass = neoforgeEventClass(h.eventType);
      const binding = eventClass
        ? `        net.minecraftforge.common.MinecraftForge.EVENT_BUS.<${eventClass}>addListener(event -> {
            EventContext ctx = new EventContext();
${neoforgeEventBindings(h.eventType)}
            ${handlerMethod}(ctx);
        });`
        : `        // custom 事件无标准 Forge 事件类：需手动订阅并调用 ${handlerMethod}(ctx)`;
      return `        // handlerId: ${h.handlerId} (eventType: ${h.eventType})
${binding}`;
    })
    .join('\n');

  const buildBody = (
    conditionIds: string[],
    actionIds: string[],
    procCallIds: string[],
    callArgs?: Record<string, string[]>,
  ): string => {
    const validCondIds = conditionIds.filter((cid) => conditionMap.has(cid));
    const validActionIds = actionIds.filter((aid) => actionIdSet.has(aid));

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

    if (validActionIds.length || procCallIds.length) {
      return `        // (无关联 condition，直接执行)
${[
  ...validActionIds.map((aid) => `        execute_${sanitizeIdent(aid)}(ctx);`),
  ...resolveProcCalls('        ').split('\n').filter(Boolean),
].join('\n')}`;
    }

    return '        // (无关联 condition 与 action)';
  };

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

  const procedureMethods = procedures
    .map((p) => {
      const methodName = `procedure_${sanitizeIdent(p.procedureName)}`;
      const body = buildBody(p.conditionIds, p.actionIds, p.procedureCallIds, p.procedureCallArgs);
      const paramList = (p.inputs ?? [])
        .map((inp) => `${javaTypeForMojang(inp.type)} ${inp.name}`)
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

  const conditionMethods = conditions
    .map((c) => {
      const methodName = `check_${sanitizeIdent(c.conditionId)}`;
      const body =
        mojangConditionCheckBody(c) ??
        `        ${formatUnsupportedComment('condition', c.conditionType, 'UNKNOWN_CONDITION')}
        return true;`;
      return `    // 条件: ${c.conditionId} (invert: ${c.invert})
    // conditionType: ${c.conditionType}
    // args: ${JSON.stringify(c.args)}
    private static boolean ${methodName}(EventContext ctx) {
${body}
    }`;
    })
    .join('\n\n');

  const actionMethods = actions
    .map((a) => {
      const methodName = `execute_${sanitizeIdent(a.actionId)}`;
      const body =
        mojangActionExecuteBody(a) ??
        `        ${formatUnsupportedComment('action', a.actionType, 'UNKNOWN_ACTION')}`;
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

  // 事件上下文：Mojang 映射全限定名
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

import net.minecraftforge.common.MinecraftForge;

public class ModEvents {
    public static final String MOD_ID = "${spec.modId}";
${eventContextClass}

${allMethods}

    public static void register() {
        // 游戏事件走 Forge 总线（mod 总线收不到，见类注释）
${registrations || '        // (无事件处理器)'}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModEvents.java`,
    content,
  };
}
