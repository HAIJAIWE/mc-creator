/** Fabric Adapter 的 Java 类生成域。原样提取自 fabric-adapter.ts(脚本转换 this.x→x、修饰符→export function),行为不变。 */
import type { FileNode } from '@mc-creator/shared';
import { javaEscape, mainClassName, packagePath } from './templates.js';
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

/**
 * 生成 ModRecipes.java：仅生成 recipeId 常量定义。
 * Critical 修复：配方通过 datapack JSON 加载（data/<modid>/recipes/<id>.json），
 * 不应在 Java 中 Registry.register 一个 String 文本块为 Recipe<?> 类型（类型不匹配，无法编译）。
 * Java 文件仅保留 ID 常量供其他代码引用。
 */

export function fabricModRecipesJava(spec: ModSpecLike, pkg: string): FileNode {
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
 * 生成 ModEntities.java：用 Registry.register(Registries.ENTITY_TYPE, ...) 注册实体。
 * 使用 Yarn 映射（EntityType.Builder.create().setDimensions(w, h).build()），
 * 与 NeoForge 一致，配合 yarn mappings 构建。
 */

export function fabricModEntitiesJava(spec: ModSpecLike, pkg: string): FileNode {
  const entities = spec.entities ?? [];
  const mainCls = mainClassName(spec.modId);
  const fields = entities
    .map(
      (e) =>
        `    public static EntityType<${fabricEntityBaseClass(e.modelType)}> ${e.entityId.toUpperCase()};`,
    )
    .join('\n');
  const regs = entities
    .map((e) => {
      // 简化：根据 modelType 选择 SpawnGroup，根据 classification 映射
      const category = fabricYarnSpawnGroup(e.classification);
      const width = 0.6;
      const height = 1.8;
      return `        // Entity: ${e.entityId} (${e.modelType}, ${e.classification}) — ${e.displayName}
        // maxHealth=${e.maxHealth}, attackDamage=${e.attackDamage}, movementSpeed=${e.movementSpeed}
        // spawnWeight=${e.spawnWeight}, spawnBiomes=${JSON.stringify(e.spawnBiomes)}
        ${e.entityId.toUpperCase()} = Registry.register(Registries.ENTITY_TYPE, Identifier.of(${mainCls}.MOD_ID, "${e.entityId}"), EntityType.Builder.<${fabricEntityBaseClass(e.modelType)}>create(${fabricEntityFactoryYarn(e.modelType)}, ${category}).setDimensions(${width}f, ${height}f).build("${e.entityId}"));`;
    })
    .join('\n');
  // G-1 修复：实体字段/工厂引用具体实体类（ZombieEntity/SkeletonEntity/...），必须补对应 import，
  // 否则生成代码引用了未导入的类无法编译。Yarn 下具体类按 passive/mob 分包。
  const usedEntityClasses = [
    ...new Set(entities.map((e) => fabricEntityBaseClass(e.modelType))),
  ].sort();
  const entityImports = usedEntityClasses
    .map((c) => `import ${fabricEntityPackage(c)}.${c};`)
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.entity.EntityType;
import net.minecraft.entity.SpawnGroup;
${entityImports}
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModEntities {
${fields}

    public static void initialize() {
${regs}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModEntities.java`,
    content,
  };
}

/**
 * 生成 ModMachines.java：注册 BlockEntityType + ScreenHandlerType（可编译占位骨架）。
 *
 * G-2 修复：原实现引用不存在的 ModBlocks.${MACHINE_ID}（方块 id 与 machineId 不一定相同）
 * 和 ${Pascal}BlockEntity / ${Pascal}Menu 顶层类，生成代码无法编译。
 * 现在每个机器生成嵌套占位类（BlockEntity/Menu），注册时用 Blocks.STONE 占位方块，
 * 保证可编译，并注释提示替换为实际实现。
 */

export function fabricModMachinesJava(spec: ModSpecLike, pkg: string): FileNode {
  const machines = spec.machines ?? [];
  const mainCls = mainClassName(spec.modId);
  const fields = machines
    .map(
      (m) =>
        `    public static BlockEntityType<?> ${m.machineId.toUpperCase()}_BE;\n    public static ScreenHandlerType<?> ${m.machineId.toUpperCase()}_MENU;`,
    )
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
        private final net.minecraft.inventory.SimpleInventory inventory = new net.minecraft.inventory.SimpleInventory(${totalSlots});

        public ${pascal}BlockEntity(BlockPos pos, BlockState state) {
            super(${id}_BE, pos, state);
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
        public net.minecraft.inventory.SimpleInventory getInventory() { return inventory; }

        // tick 处理：耗能推进加工进度（输出槽有空间时）
        public void tickServer() {
            if (energy >= ENERGY_PER_TICK && progress < PROCESS_TIME) {
                energy -= ENERGY_PER_TICK;
                progress++;
            } else if (progress >= PROCESS_TIME) {
                progress = 0;
                // 配方映射：输入物品 ID → 输出物品 ID（未匹配时回退原样搬运）
                for (int i = 0; i < ${m.inputSlots}; i++) {
                    var stack = inventory.getStack(i);
                    if (!stack.isEmpty()) {
                        var outStack = inventory.getStack(${m.inputSlots});
                        if (outStack.isEmpty()) {
                            String outId = recipeOutput(stack.getItem().getTranslationKey());
                            if (outId != null) {
                                var output = new net.minecraft.item.ItemStack(net.minecraft.registry.Registries.ITEM.get(new net.minecraft.util.Identifier(outId)), 1);
                                inventory.setStack(${m.inputSlots}, output);
                                stack.decrement(1);
                            } else {
                                inventory.setStack(${m.inputSlots}, stack.copyWithCount(1));
                                stack.decrement(1);
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
    public static class ${pascal}Menu extends ScreenHandler {
        private final net.minecraft.inventory.SimpleInventory machineInv;

        public ${pascal}Menu(int id, PlayerInventory inv) {
            super(${id}_MENU, id);
            this.machineInv = new net.minecraft.inventory.SimpleInventory(${totalSlots});
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
        public net.minecraft.item.ItemStack quickMove(net.minecraft.entity.player.PlayerEntity player, int index) {
            return net.minecraft.item.ItemStack.EMPTY;
        }

        @Override
        public boolean canUse(net.minecraft.entity.player.PlayerEntity player) {
            return true;
        }
    }`;
    })
    .join('\n\n');
  const regs = machines
    .map((m) => {
      const pascal = toPascal(m.machineId);
      const id = m.machineId.toUpperCase();
      return `        // Machine: ${m.machineId} — ${m.displayName}
        // energyCapacity=${m.energyCapacity}, maxTransfer=${m.maxEnergyTransfer}
        // inputSlots=${m.inputSlots}, outputSlots=${m.outputSlots}
        // processTime=${m.defaultProcessTime}, energyPerTick=${m.defaultEnergyPerTick}
        // guiWidth=${m.guiWidth}, guiHeight=${m.guiHeight}
        // BlockEntityType.Builder.create 的 Factory 接口同样由 Fabric transitive AW 放行，loom 真构建可编译。
        ${id}_BE = Registry.register(Registries.BLOCK_ENTITY_TYPE, Identifier.of(${mainCls}.MOD_ID, "${m.machineId}"), BlockEntityType.Builder.create(${pascal}BlockEntity::new, Blocks.STONE).build(null));
        ${id}_MENU = Registry.register(Registries.SCREEN_HANDLER, Identifier.of(${mainCls}.MOD_ID, "${m.machineId}"), new ScreenHandlerType<>(${pascal}Menu::new, FeatureFlags.VANILLA_FEATURES));`;
    })
    .join('\n');
  const content = `package ${pkg};

import net.minecraft.block.Blocks;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.block.entity.BlockEntityType;
import net.minecraft.block.BlockState;
import net.minecraft.util.math.BlockPos;
import net.minecraft.screen.ScreenHandler;
import net.minecraft.screen.ScreenHandlerType;
import net.minecraft.screen.slot.Slot;
import net.minecraft.resource.featuretoggle.FeatureFlags;
import net.minecraft.entity.player.PlayerInventory;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class ModMachines {
${fields}
${placeholderClasses}

    public static void initialize() {
${regs}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModMachines.java`,
    content,
  };
}

/**
 * 生成 ModCustomCode.java：把每个 CustomCodeSnippetSpec 的 code 嵌入为独立方法。
 * 方法名取自 snippet.methodName，签名取自 inputSignature/outputSignature（PortType → Java 类型）。
 */

export function fabricModCustomCodeJava(spec: ModSpecLike, pkg: string): FileNode {
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
      // 缩进用户代码到方法体内部（8 空格）
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
 * 生成 ModMultiblocks.java：把每个 MultiBlockSpec 编译为常量（结构尺寸 + 控制器偏移）。
 * 简化：仅生成元数据常量，不实际注册结构（多方块注册 API 较复杂，留待后续完善）。
 */

export function fabricModMultiblocksJava(spec: ModSpecLike, pkg: string): FileNode {
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
 * 结构：
 *   - initialize()：按 eventType 选择 Fabric API 注册事件回调，回调内调用 handle_<handlerId>
 *   - handle_<handlerId>(Object event)：根据 conditionIds 生成 if 语句（invert 加 !），
 *     块内调用 actionIds 对应的 execute_<actionId>，以及 procedureCallIds 对应的 procedure_<name>
 *   - procedure_<procedureName>(Object event)：P1-3 过程方法（命名的可复用逻辑单元，
 *     含 conditionIds/actionIds/procedureCallIds，结构与 handle_ 同构；可被多个 event/procedure 调用）
 *   - check_<conditionId>(Object event)：条件检查方法（含 conditionType/args 注释，return true 占位）
 *   - execute_<actionId>(Object event)：动作执行方法（含 actionType/args 注释，空方法体占位）
 *
 * 简化：每个 conditionId 生成独立 if 块，块内调用所有 actionIds/procedureCallIds（control 边的
 * 精确嵌套关系在扁平结构中已丢失，需 P1.5+ 才能完整还原）。
 */

export function fabricModEventsJava(spec: ModSpecLike, pkg: string): FileNode {
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

  // initialize() 中的事件注册调用（按 eventType 选择 Fabric API，用全限定名避免 import 错误）
  const registrations = handlers
    .map((h) => {
      const handlerMethod = `handle_${sanitizeIdent(h.handlerId)}`;
      return `        // handlerId: ${h.handlerId} (eventType: ${h.eventType})
${fabricEventRegistration(h.eventType, handlerMethod)}`;
    })
    .join('\n');

  // 生成方法体（conditionIds → AND 合取 if 块 + actionIds/procedureCallIds 调用）。
  // handle_ 与 procedure_ 共用此逻辑，区别仅在方法签名与注释。
  // P40：callArgs 为 procedureCallId → 表达式数组（与被调过程 inputs 顺序对应），
  // 缺省表达式由 defaultValueFor 回退为该参数类型的默认值。
  const buildBody = (
    conditionIds: string[],
    actionIds: string[],
    procCallIds: string[],
    callArgs?: Record<string, string[]>,
  ): string => {
    // 过滤 dangling 引用：conditionId/actionId 必须在对应 spec 中存在
    const validCondIds = conditionIds.filter((cid) => {
      if (!conditionMap.has(cid)) {
        return false; // dangling：跳过
      }
      return true;
    });
    const validActionIds = actionIds.filter((aid) => {
      if (!actionIdSet.has(aid)) {
        return false; // dangling：跳过
      }
      return true;
    });

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

  // P2.2 block_place：Fabric 无现成放置事件，由 Mixin @Inject 调用的公开通知入口。
  // 构造 EventContext 并逐个调用 block_place 的 handle_ 方法（无 handler 时不生成）。
  const blockPlaceHandlers = handlers.filter((h) => h.eventType === 'block_place');
  const notifyBlockPlaced = blockPlaceHandlers.length
    ? `    // block_place 事件通知入口（由 ModBlockPlaceMixin @Inject 调用，Fabric API 无放置事件）
    public static void notifyBlockPlaced(net.minecraft.world.World level, net.minecraft.util.math.BlockPos pos, net.minecraft.block.BlockState state, net.minecraft.server.network.ServerPlayerEntity player) {
        EventContext ctx = new EventContext();
        ctx.level = level instanceof net.minecraft.server.world.ServerWorld sl ? sl : null;
        ctx.pos = pos;
        ctx.state = state;
        ctx.player = player;
${blockPlaceHandlers.map((h) => `        handle_${sanitizeIdent(h.handlerId)}(ctx);`).join('\n')}
    }`
    : '';

  // item_pickup：Fabric 无拾取事件，由 ModItemPickupMixin @Inject 调用的公开通知入口。
  const itemPickupHandlers = handlers.filter((h) => h.eventType === 'item_pickup');
  const notifyItemPickedup = itemPickupHandlers.length
    ? `    // item_pickup 事件通知入口（由 ModItemPickupMixin @Inject 调用，Fabric API 无拾取事件）
    public static void notifyItemPickedup(net.minecraft.world.World level, net.minecraft.server.network.ServerPlayerEntity player, net.minecraft.item.ItemStack stack) {
        EventContext ctx = new EventContext();
        ctx.level = level instanceof net.minecraft.server.world.ServerWorld sl ? sl : null;
        ctx.player = player;
        ctx.stack = stack;
${itemPickupHandlers.map((h) => `        handle_${sanitizeIdent(h.handlerId)}(ctx);`).join('\n')}
    }`
    : '';

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

  const allMethods = [
    handlerMethods,
    notifyBlockPlaced,
    notifyItemPickedup,
    procedureMethods,
    conditionMethods,
    actionMethods,
  ]
    .filter(Boolean)
    .join('\n\n');

  // 事件上下文：承载回调参数（Fabric 回调多参数在此绑定），供条件/动作逻辑读取
  const eventContextClass = `    // 事件上下文：回调参数绑定字段（事件未提供时保持 null，逻辑侧判空保护）
    private static class EventContext {
        net.minecraft.server.network.ServerPlayerEntity player = null;
        net.minecraft.server.world.ServerWorld level = null;
        net.minecraft.util.math.BlockPos pos = null;
        net.minecraft.block.BlockState state = null;
        net.minecraft.item.ItemStack stack = null;
        net.minecraft.entity.Entity target = null;
    }`;

  const content = `package ${pkg};

public class ModEvents {
${eventContextClass}

${allMethods}

    public static void initialize() {
        // 注册事件处理器（按 eventType 调用对应 Fabric API；用全限定名避免 import 错误）
${registrations || '        // (无事件处理器)'}
    }
}
`;
  return {
    path: `src/main/java/${packagePath(spec.modId)}/ModEvents.java`,
    content,
  };
}

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
      return `        // TODO: 注册 ${eventType} 事件（Fabric API 未映射）
        // ${handlerMethod}(new EventContext());`;
  }
}

/**
 * 把任意字符串转为合法 Java 标识符片段（用于 check_<id>/execute_<id>/handle_<id> 方法名后缀）。
 * 保留原大小写与下划线，仅把非法字符替换为下划线；首字符为数字时加 _ 前缀。
 *
 * P1 dogfood 修复：空字符串/纯特殊字符 → 返回 "unknown"（而非空标识符导致编译错误）。
 */
/**
 * P40：按 Java 类型返回默认值表达式（过程调用参数缺省时回退）。
 */

export function fabricEntityBaseClass(modelType: string): string {
  switch (modelType) {
    case 'zombie':
      return 'ZombieEntity';
    case 'skeleton':
      return 'SkeletonEntity';
    case 'creeper':
      return 'CreeperEntity';
    case 'pig':
      return 'PigEntity';
    case 'cow':
      return 'CowEntity';
    case 'custom':
    default:
      return 'Entity';
  }
}

/** modelType 对应实体类的 Yarn 包（passive/mob；Entity 在 entity 根包） */

export function fabricEntityPackage(cls: string): string {
  switch (cls) {
    case 'PigEntity':
    case 'CowEntity':
      return 'net.minecraft.entity.passive';
    case 'ZombieEntity':
    case 'SkeletonEntity':
    case 'CreeperEntity':
      return 'net.minecraft.entity.mob';
    default:
      return 'net.minecraft.entity';
  }
}

/** 根据 modelType 返回实体工厂引用（Yarn 映射，类名带 Entity 后缀） */

export function fabricEntityFactoryYarn(modelType: string): string {
  switch (modelType) {
    case 'zombie':
      return 'ZombieEntity::new';
    case 'skeleton':
      return 'SkeletonEntity::new';
    case 'creeper':
      return 'CreeperEntity::new';
    case 'pig':
      return 'PigEntity::new';
    case 'cow':
      return 'CowEntity::new';
    case 'custom':
    default:
      return 'Entity::new';
  }
}

/** classification → Yarn SpawnGroup 映射 */

export function fabricYarnSpawnGroup(classification: string): string {
  switch (classification) {
    case 'animal':
      return 'SpawnGroup.CREATURE';
    case 'monster':
      return 'SpawnGroup.MONSTER';
    case 'water_creature':
      return 'SpawnGroup.WATER_CREATURE';
    case 'ambient':
      return 'SpawnGroup.AMBIENT';
    case 'misc':
    default:
      return 'SpawnGroup.MISC';
  }
}
