/** 注册类 Java 生成（物品/方块/流体/生物群系/维度/GUI/结构）。 */
import type { FileNode } from '@mc-creator/shared';
import { javaEscape, packagePath } from '../templates.js';
import { toPascal, type ModSpecLike } from '../mod-common.js';

export function fabricModItemsJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const fields = spec.items
    .map((it) => `    public static Item ${it.id.toUpperCase()};`)
    .join('\n');
  const regs = spec.items
    .map(
      (it) =>
        `        ${it.id.toUpperCase()} = Registry.register(Registries.ITEM, Identifier.of(${mainCls}.MOD_ID, "${it.id}"), new Item(new Item.Settings()));`,
    )
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.item.Item;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModItems {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModItems.java`,
    content,
  };
}

export function fabricModBlocksJava(spec: ModSpecLike, pkg: string, mainCls: string): FileNode {
  const fields = spec.blocks
    .map((b) => `    public static Block ${b.id.toUpperCase()};`)
    .join('\n');
  const regs = spec.blocks
    .map((b) => {
      const settings = `Block.Settings.create().strength(${b.hardness}f, ${b.resistance ?? b.hardness}f)`;
      return `        ${b.id.toUpperCase()} = Registry.register(Registries.BLOCK, Identifier.of(${mainCls}.MOD_ID, "${b.id}"), new Block(${settings}));`;
    })
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.block.Block;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModBlocks {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModBlocks.java`,
    content,
  };
}

/**
 * Task D：生成 ModFluids.java。
 * 流体注册：Registry.register(Registries.FLUID, ...)，每种流体生成一对
 * FlowableFluid 子类（Still/Flowing，最小可编译实现）。
 */

export function fabricModFluidsJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.fluids ?? [])
    .map((f) => {
      const upper = f.fluidId.toUpperCase();
      return `    public static net.minecraft.fluid.Fluid ${upper};\n    public static net.minecraft.fluid.Fluid ${upper}_FLOWING;`;
    })
    .join('\n');
  const regs = (spec.fluids ?? [])
    .map((f) => {
      const upper = f.fluidId.toUpperCase();
      const pascal = toPascal(f.fluidId);
      return `        // Fluid: ${f.fluidId} — 静止/流动成对注册。颜色/温度/粘度等表现层调优、
        // 木桶/流体方块接线需配套资源与客户端渲染，见类注释。
        ${upper} = Registry.register(Registries.FLUID, Identifier.of(MOD_ID, "${f.fluidId}"), new ${pascal}Fluid.Still());
        ${upper}_FLOWING = Registry.register(Registries.FLUID, Identifier.of(MOD_ID, "${f.fluidId}_flowing"), new ${pascal}Fluid.Flowing());`;
    })
    .join('\n');
  const classes = (spec.fluids ?? [])
    .map((f) => {
      const pascal = toPascal(f.fluidId);
      const upper = f.fluidId.toUpperCase();
      return `    // ${f.displayName}：最小可编译 FlowableFluid 实现（静止/流动）。
    // 不含木桶物品、流体方块与客户端渲染——配套资源见 docs。
    public static class ${pascal}Fluid extends net.minecraft.fluid.FlowableFluid {
        @Override public net.minecraft.fluid.Fluid getFlowing() { return ${upper}_FLOWING; }
        @Override public net.minecraft.fluid.Fluid getStill() { return ${upper}; }
        @Override protected boolean isInfinite(net.minecraft.world.World world) { return false; }
        @Override protected void beforeBreakingBlock(net.minecraft.world.WorldAccess world, net.minecraft.util.math.BlockPos pos, net.minecraft.block.BlockState state) { }
        @Override protected int getFlowSpeed(net.minecraft.world.WorldView world) { return 4; }
        @Override protected int getLevelDecreasePerBlock(net.minecraft.world.WorldView world) { return 1; }
        @Override public int getLevel(net.minecraft.fluid.FluidState state) { return 8; }
        @Override public boolean isStill(net.minecraft.fluid.FluidState state) { return this == getStill(); }
        // 以下为 Fluid 抽象方法占位实现（FlowableFluid 未覆盖的部分）：水样默认值。
        // 真实流体（木桶/流体方块/渲染/流量特性）需配套资源与客户端渲染，见类注释。
        @Override public net.minecraft.item.Item getBucketItem() { return net.minecraft.item.Items.WATER_BUCKET; }
        @Override protected boolean canBeReplacedWith(net.minecraft.fluid.FluidState state, net.minecraft.world.BlockView world, net.minecraft.util.math.BlockPos pos, net.minecraft.fluid.Fluid fluid, net.minecraft.util.math.Direction direction) { return false; }
        // 注：getVelocity 由 FlowableFluid 提供流速实现，此处不覆盖。
        @Override public int getTickRate(net.minecraft.world.WorldView world) { return 5; }
        @Override protected float getBlastResistance() { return 100.0f; }
        @Override public float getHeight(net.minecraft.fluid.FluidState state, net.minecraft.world.BlockView world, net.minecraft.util.math.BlockPos pos) { return 1.0f; }
        @Override public float getHeight(net.minecraft.fluid.FluidState state) { return 1.0f; }
        @Override protected net.minecraft.block.BlockState toBlockState(net.minecraft.fluid.FluidState state) { return net.minecraft.block.Blocks.WATER.getDefaultState(); }
        @Override public net.minecraft.util.shape.VoxelShape getShape(net.minecraft.fluid.FluidState state, net.minecraft.world.BlockView world, net.minecraft.util.math.BlockPos pos) { return net.minecraft.util.shape.VoxelShapes.fullCube(); }
        public static class Flowing extends ${pascal}Fluid { }
        public static class Still extends ${pascal}Fluid { }
    }`;
    })
    .join('\n\n');
  const content = `package ${pkg};

import net.minecraft.registry.Registry;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

public class ModFluids {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}
${classes}

    public static void initialize() {
${regs}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModFluids.java`,
    content,
  };
}

// === P1.3/P1.4 新增：消费 recipes/entities/machines/customCode/multiblocks/events ===

/**
 * Mod 侧生物群系：生成 ModBiomes.java。
 * Biome 属于动态注册表（数据驱动），不在 Registry.register 时序内直接注册；
 * 此处生成 public static final 常量持有构造好的对象（配套 worldgen 数据包 JSON 才实际生效），
 * initialize() 仅留注释，保证可编译且语义诚实。
 */

export function fabricModBiomesJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.biomes ?? [])
    .map((b) => {
      const c = (v?: number) => (v !== undefined ? `0x${v.toString(16).padStart(6, '0')}` : '0');
      const grass =
        b.grassColor !== undefined ? `\n                .grassColor(${c(b.grassColor)})` : '';
      const foliage =
        b.foliageColor !== undefined ? `\n                .foliageColor(${c(b.foliageColor)})` : '';
      // precipitation 在 Yarn 是 boolean（有无降水），'none' → false，其余 → true。
      const precip = b.precipitation === 'none' ? 'false' : 'true';
      return `    // Biome: ${b.biomeId} — ${b.displayName}（动态注册表内容，见类注释）
    public static final net.minecraft.world.biome.Biome ${b.biomeId.toUpperCase()} = new net.minecraft.world.biome.Biome.Builder()
            .precipitation(${precip})
            .temperature(${b.temperature}f)${b.temperatureModifier === 'frozen' ? '\n            .temperatureModifier(net.minecraft.world.biome.Biome.TemperatureModifier.FROZEN)' : ''}
            .downfall(${b.downfall}f)
            .effects(new net.minecraft.world.biome.BiomeEffects.Builder()
                .skyColor(${c(b.skyColor)})
                .waterColor(${c(b.waterColor)})
                .waterFogColor(${c(b.waterFogColor)})
                .fogColor(${c(b.fogColor)})${grass}${foliage}
                .build())
            .spawnSettings(net.minecraft.world.biome.SpawnSettings.INSTANCE)
            .generationSettings(net.minecraft.world.biome.GenerationSettings.INSTANCE)
            .build();`;
    })
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.registry.Registry;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

public class ModBiomes {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
        // 生物群系为动态注册表内容：随数据包 worldgen/biome JSON 下发，上方常量仅作 Java 侧引用占位。
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModBiomes.java`,
    content,
  };
}

/**
 * Mod 侧维度：生成 ModDimensions.java。
 * DimensionType 属于动态注册表（数据驱动），不在 Registry.register 时序内直接注册；
 * 此处生成 public static final 常量持有构造好的对象（配套 dimension_type 数据包 JSON 才实际生效），
 * initialize() 仅留注释。维度可通过 /execute in <modid>:<dim> 访问（需数据包）。
 */

export function fabricModDimensionsJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.dimensions ?? [])
    .map((d) => {
      const typeId = d.dimensionId.toUpperCase();
      const fixedTime =
        d.fixedTime !== null ? `OptionalLong.of(${d.fixedTime}L)` : 'OptionalLong.empty()';
      const infiniburn = `"minecraft:infiniburn_${d.baseType === 'nether' ? 'nether' : 'overworld'}"`;
      // effects 在 Yarn 是 Identifier（非 Optional），'none' 回落主世界 effects。
      const effects =
        d.effects === 'none'
          ? 'Identifier.of("minecraft", "overworld")'
          : `Identifier.of("minecraft", "${d.effects}")`;
      // MonsterSettings：piglinSafe 直传；hasRaids 取 !piglinSafe（主世界式默认；下界式取 false），
      // 光照测试与方块光上限用原版主世界值；精细世界生成请走数据包 dimension_type JSON。
      const monsterSettings = `new DimensionType.MonsterSettings(${d.piglinSafe}, ${!d.piglinSafe}, net.minecraft.util.math.intprovider.UniformIntProvider.create(0, 7), 0)`;
      return `    // DimensionType: ${d.dimensionId} — ${d.displayName}（动态注册表内容，见类注释）
    public static final net.minecraft.world.dimension.DimensionType ${typeId}_TYPE = new DimensionType(${fixedTime}, ${d.hasSkyLight}, ${d.hasCeiling}, ${d.ultrawarm}, ${d.natural}, ${d.coordinateScale}, ${d.bedWorks}, ${d.respawnAnchorWorks}, ${d.minY}, ${d.height}, ${d.logicalHeight}, net.minecraft.registry.tag.TagKey.of(net.minecraft.registry.RegistryKeys.BLOCK, new net.minecraft.util.Identifier(${infiniburn})), ${effects}, ${d.ambientLight}, ${monsterSettings});`;
    })
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.registry.Registry;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;
import net.minecraft.world.dimension.DimensionType;
import java.util.Optional;
import java.util.OptionalLong;

public class ModDimensions {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
        // 维度类型为动态注册表内容：随数据包 dimension_type JSON 下发，上方常量仅作 Java 侧引用占位。
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModDimensions.java`,
    content,
  };
}

/**
 * GUI 界面：生成 ModGuis.java。
 * 每个 GUI 生成 Menu + Screen 两个类：
 * - Menu：槽位布局（按 spec.slots 的 x/y 定位）+ 玩家背包
 * - Screen：渲染背景 + 可选能源/进度条 + 槽位提示
 * 生成可编译的骨架（无资源贴图时用默认背景）。
 */

export function fabricModGuisJava(spec: ModSpecLike, pkg: string): FileNode {
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
      const energyBar = g.showEnergyBar
        ? `\n            // 能源条（需 textures/gui/energy_bar.png 资源）
            graphics.drawTexture(net.minecraft.util.Identifier.of(MOD_ID, "textures/gui/energy_bar.png"), this.x + 8, this.y + 16, 0, 0, 14, 54);`
        : '';
      return `    // ${pascal}Menu：GUI 槽位布局（${slotCount} 槽）
    public static class ${pascal}Menu extends ScreenHandler {
        private final net.minecraft.inventory.SimpleInventory machineInv;

        public ${pascal}Menu(int id, PlayerInventory inv) {
            super(${pascal.toUpperCase()}_MENU_TYPE, id);
            this.machineInv = new net.minecraft.inventory.SimpleInventory(${slotCount});
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
        public net.minecraft.item.ItemStack quickMove(net.minecraft.entity.player.PlayerEntity player, int index) {
            return net.minecraft.item.ItemStack.EMPTY;
        }

        @Override
        public boolean canUse(net.minecraft.entity.player.PlayerEntity player) {
            return true;
        }
    }

    // ${pascal}Screen：GUI 渲染（客户端类，需客户端 jar 编译；服务端构建跳过）
    public static class ${pascal}Screen extends net.minecraft.client.gui.screen.ingame.HandledScreen<${pascal}Menu> {
        public ${pascal}Screen(${pascal}Menu menu, PlayerInventory inv, net.minecraft.text.Text title) {
            super(menu, inv, title);
            this.backgroundWidth = ${g.width};
            this.backgroundHeight = ${g.height};
        }

        @Override
        protected void drawBackground(net.minecraft.client.gui.DrawContext graphics, float partialTick, int mouseX, int mouseY) {
            graphics.drawTexture(net.minecraft.util.Identifier.of(MOD_ID, "textures/gui/${g.guiId}.png"), this.x, this.y, 0, 0, this.backgroundWidth, this.backgroundHeight);${energyBar}
        }

        @Override
        public void render(net.minecraft.client.gui.DrawContext graphics, int mouseX, int mouseY, float partialTick) {
            super.render(graphics, mouseX, mouseY, partialTick);
            this.drawMouseoverTooltip(graphics, mouseX, mouseY);
        }
    }

    public static final net.minecraft.screen.ScreenHandlerType<${pascal}Menu> ${pascal.toUpperCase()}_MENU_TYPE = new net.minecraft.screen.ScreenHandlerType<>(${pascal}Menu::new, net.minecraft.resource.featuretoggle.FeatureFlags.VANILLA_FEATURES);`;
    })
    .join('\n\n');
  const regs = (spec.guis ?? [])
    .map((g) => {
      const pascal = toPascal(g.guiId);
      // ScreenHandlerType 构造器/Factory 在 Yarn 为受限访问，Fabric transitive AW 已放行
      //（fabric-transitive-access-wideners-v1），loom 真构建可编译；裸 javac 会报访问错误，属预期内。
      return `        Registry.register(Registries.SCREEN_HANDLER, Identifier.of(MOD_ID, "${g.guiId}"), ${pascal.toUpperCase()}_MENU_TYPE);`;
    })
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.registry.Registry;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.slot.Slot;
import net.minecraft.entity.player.PlayerInventory;

public class ModGuis {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${guiClasses}

    public static void initialize() {
${regs}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModGuis.java`,
    content,
  };
}

/**
 * Mod 侧结构：生成 ModStructures.java。
 * Structure/StructureSet 属于动态注册表（数据驱动），不在 Registry.register 时序内直接注册；
 * 此处生成 public static final 常量持有构造好的对象（结构实际生成需配套 worldgen 数据包 JSON），
 * initialize() 仅留注释，保证可编译且语义诚实。
 */

export function fabricModStructuresJava(spec: ModSpecLike, pkg: string): FileNode {
  const fields = (spec.structures ?? [])
    .map((s) => {
      const id = s.structureId.toUpperCase();
      // 注意：startPool 指向数据包 template_pool（结构实际生成需配套 worldgen JSON）；
      // Java 侧传 null 占位（仅在实际生成时才解引用，无数据包时结构保持惰性）；
      // 空生物群系列表/空生成覆盖用显式泛型见证避免推断失败。
      return `    // Structure: ${s.structureId} — ${s.displayName}
    // startPool=${s.startPool}, size=${s.size}, maxDistance=${s.maxDistance}
    // biomes=${s.biomes}, terrainAdaptation=${s.terrainAdaptation}
    // spacing=${s.spacing}, separation=${s.separation}, salt=${s.salt}
    public static final net.minecraft.world.gen.structure.Structure ${id} = new net.minecraft.world.gen.structure.JigsawStructure(
            new net.minecraft.world.gen.structure.Structure.Config(
                net.minecraft.registry.entry.RegistryEntryList.<net.minecraft.world.biome.Biome>of(java.util.List.of()),
                java.util.Map.<net.minecraft.entity.SpawnGroup, net.minecraft.world.StructureSpawns>of(),
                net.minecraft.world.gen.GenerationStep.Feature.SURFACE_STRUCTURES,
                net.minecraft.world.gen.StructureTerrainAdaptation.${s.terrainAdaptation.toUpperCase()}
            ),
            null,
            ${s.size},
            net.minecraft.world.gen.heightprovider.ConstantHeightProvider.ZERO,
            false
        );
    public static final net.minecraft.structure.StructureSet ${id}_SET = new net.minecraft.structure.StructureSet(
            net.minecraft.registry.entry.RegistryEntry.<net.minecraft.world.gen.structure.Structure>of(${id}),
            new net.minecraft.world.gen.chunk.placement.RandomSpreadStructurePlacement(${s.spacing}, ${s.separation}, net.minecraft.world.gen.chunk.placement.SpreadType.TRIANGULAR, ${s.salt})
        );`;
    })
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.registry.Registry;
import net.minecraft.registry.Registries;
import net.minecraft.util.Identifier;

public class ModStructures {
    public static final String MOD_ID = "${javaEscape(spec.modId)}";
${fields}

    public static void initialize() {
        // 结构/结构集为动态注册表内容：随数据包 worldgen/structure + structure_set JSON 下发，上方常量仅作 Java 侧引用占位。
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModStructures.java`,
    content,
  };
}
