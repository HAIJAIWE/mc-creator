/** 注册类 Java 生成（物品/方块/流体/生物群系/维度/GUI/结构），Mojang 映射。 */
import type { FileNode } from '@mc-creator/shared';
import { javaEscape, packagePath } from '../templates.js';
import { toPascal, type ModSpecLike } from '../mod-common.js';

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
