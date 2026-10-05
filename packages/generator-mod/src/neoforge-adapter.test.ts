import { describe, it, expect } from 'vitest';
import { NeoForgeAdapter } from './neoforge-adapter.js';
import { FOOJAY_RESOLVER_VERSION } from './neoforge-gradle.js';
import { ModSpec as ModSpecSchema } from '@mc-creator/shared';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
});

const CTX: GeneratorContext = {
  loader: 'neoforge',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('NeoForgeAdapter 元数据与构建脚本', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 mods.toml', () => {
    const toml = files.find((f) => f.path === 'src/main/resources/META-INF/mods.toml');
    expect(toml).toBeDefined();
    expect(toml!.content).toContain('modId = "ruby_tools"');
    expect(toml!.content).toContain('displayName = "Ruby Tools"');
    expect(toml!.content).toContain('loaderVersion');
  });

  it('生成 build.gradle 含 net.neoforged.moddev', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('net.neoforged.moddev');
  });

  it('ModDevGradle DSL 与插件大版本无关：恒为顶层 neoForge {}，绝不出现 moddev {} 包装', () => {
    // 主代理裁决（语义修正，2026-10 实测）：旧用例断言「1.0.x 用 moddev {} 包装、
    // 2.0 用顶层 neoForge {}」。实测两个大版本注册的扩展名**都是 neoForge**：
    //   1.0.21  → HAS_MODDEV=false, HAS_NEOFORGE=true
    //   2.0.143 → HAS_MODDEV=false, HAS_NEOFORGE=true
    // 带 moddev {} 包装的真实构建原文：
    //   > Could not find method moddev() for arguments [...] on root project 'mc-mod'
    //   > BUILD FAILED in 17s
    // 「按大版本分 DSL」这个前提本身是错的，因此旧用例的意图（版本感知）不再成立，
    // 改为：版本感知仍要保留（插件版本号与 Java 版本随 MC 变），但 DSL 形状全版本统一，
    // 并加一条回归守卫——`moddev {` 一旦被重新引入，本用例会立刻变红。
    const legacy = adapter.translate({ ...CTX, mcVersion: '1.20.4' });
    const legacyBg = legacy.find((f) => f.path === 'build.gradle');
    expect(legacyBg!.content).toContain("id 'net.neoforged.moddev' version '1.0.21'");
    expect(legacyBg!.content).toContain('\nneoForge {');
    expect(legacyBg!.content).not.toContain('moddev {');
    expect(legacyBg!.content).toContain('JavaLanguageVersion.of(17)');
    const legacy121 = adapter.translate({ ...CTX, mcVersion: '1.21.1' });
    const legacy121Bg = legacy121.find((f) => f.path === 'build.gradle');
    expect(legacy121Bg!.content).toContain('\nneoForge {');
    expect(legacy121Bg!.content).not.toContain('moddev {');
    expect(legacy121Bg!.content).toContain('JavaLanguageVersion.of(21)');
    const modern = adapter.translate({ ...CTX, mcVersion: '1.21.11' });
    const modernBg = modern.find((f) => f.path === 'build.gradle');
    expect(modernBg!.content).toContain("id 'net.neoforged.moddev' version '2.0.143'");
    expect(modernBg!.content).toContain('\nneoForge {');
    expect(modernBg!.content).not.toContain('moddev {');
    expect(modernBg!.content).toContain('JavaLanguageVersion.of(21)');
  });

  it('生成 gradle-wrapper.properties 且 Gradle 版本按 MC 版本选择', () => {
    const legacy = adapter.translate({ ...CTX, mcVersion: '1.20.6' });
    const legacyW = legacy.find((f) => f.path === 'gradle/wrapper/gradle-wrapper.properties');
    expect(legacyW).toBeDefined();
    expect(legacyW!.content).toContain('gradle-8.12-bin.zip');
    const modern = adapter.translate({ ...CTX, mcVersion: '26.1' });
    const modernW = modern.find((f) => f.path === 'gradle/wrapper/gradle-wrapper.properties');
    expect(modernW!.content).toContain('gradle-9.5.1-bin.zip');
  });

  it('生成 gradle.properties', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('mc_version=1.21.11');
  });
});

describe('NeoForgeAdapter toolchain 解析器（settings.gradle）', () => {
  const files = new NeoForgeAdapter().translate(CTX);
  const sg = files.find((f) => f.path === 'settings.gradle');

  it('build.gradle 用 java.toolchain，故 settings.gradle 必须带 foojay 解析器', () => {
    // 前提：build.gradle 走 java.toolchain（本仓只有 Forge/NeoForge 用 toolchain，
    // fabric/quilt/legacy-fabric 用的是 sourceCompatibility，不需要解析器）
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg!.content).toContain('java.toolchain.languageVersion = JavaLanguageVersion.of(21)');
    expect(sg).toBeDefined();
    expect(sg!.content).toContain(
      `id 'org.gradle.toolchains.foojay-resolver-convention' version '${FOOJAY_RESOLVER_VERSION}'`,
    );
  });

  it('foojay 解析器版本钉在实测值 0.10.0（+ Gradle 8.12 验证通过）', () => {
    // 实测：不带这一行 = 干净机器上 "No locally installed toolchains match and
    // toolchain download repositories have not been configured." → BUILD FAILED；
    // 带 0.10.0 则 BUILD SUCCESSFUL 且 Gradle 真的下载了 JDK（17.0.20.1+1 等）。
    // 版本号别随手改，要改先重跑一遍真实构建。
    expect(FOOJAY_RESOLVER_VERSION).toBe('0.10.0');
    expect(sg!.content).toContain("version '0.10.0'");
  });

  it('plugins 块在最前（Gradle 要求 settings 的 plugins 块只能出现在最前）', () => {
    // NeoForge 的 moddev 插件在 Gradle Portal 上，settings 里没有 pluginManagement 块；
    // 顺序约束依然成立：plugins { } 必须在任何其它语句（含 rootProject.name）之前。
    const pluginsIdx = sg!.content.indexOf('plugins {');
    const rootIdx = sg!.content.indexOf('rootProject.name');
    expect(pluginsIdx).toBeGreaterThanOrEqual(0);
    expect(sg!.content.startsWith('plugins {')).toBe(true);
    expect(pluginsIdx).toBeLessThan(rootIdx);
    // 形状：plugins 块闭括号 → 空行 → rootProject.name，且文件到此结束
    expect(sg!.content).toMatch(/\}\r?\n\r?\nrootProject\.name = 'mc-mod'\r?\n$/);
  });

  it('每个 MC 版本档位（Java 17 / 21 / 25）都带解析器，且 rootProject.name 未丢', () => {
    for (const mc of ['1.20.6', '1.21.1', '1.21.11', '26.1']) {
      const f = new NeoForgeAdapter().translate({ ...CTX, mcVersion: mc });
      const s = f.find((x) => x.path === 'settings.gradle');
      expect(s!.content).toContain('org.gradle.toolchains.foojay-resolver-convention');
      expect(s!.content).toContain("rootProject.name = 'mc-mod'");
    }
  });
});

describe('NeoForgeAdapter Java 入口与注册代码', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 @Mod 主类', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('package com.example.ruby_tools;');
    expect(main!.content).toContain('@Mod("ruby_tools")');
    expect(main!.content).toContain('IEventBus');
    expect(main!.content).toContain('ModItems.register(modEventBus)');
    expect(main!.content).toContain('ModBlocks.register(modEventBus)');
  });

  it('生成 ModItems（DeferredRegister Forge 风格 + 每个物品）', () => {
    const items = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModItems.java',
    );
    expect(items).toBeDefined();
    expect(items!.content).toContain('DeferredRegister<Item> ITEMS');
    expect(items!.content).toContain('ForgeRegistries.ITEMS');
    expect(items!.content).toContain('RegistryObject<Item> RUBY');
    expect(items!.content).toContain('ITEMS.register("ruby"');
    expect(items!.content).toContain('new Item(new Item.Properties())');
    expect(items!.content).not.toContain('registerSimpleItem');
    expect(items!.content).not.toContain('DeferredItem');
  });

  it('生成 ModBlocks（DeferredRegister Forge 风格 + 配套 BlockItem）', () => {
    const blocks = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModBlocks.java',
    );
    expect(blocks).toBeDefined();
    expect(blocks!.content).toContain('DeferredRegister<Block> BLOCKS');
    expect(blocks!.content).toContain('ForgeRegistries.BLOCKS');
    expect(blocks!.content).toContain('BlockBehaviour.Properties.of()');
    expect(blocks!.content).toContain('RUBY_BLOCK');
    expect(blocks!.content).toContain('RUBY_BLOCK_ITEM');
    expect(blocks!.content).not.toContain('DeferredBlock');
  });
});

describe('NeoForgeAdapter 资源文件', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 en_us.json 含物品与方块翻译键', () => {
    const lang = files.find(
      (f) => f.path === 'src/main/resources/assets/ruby_tools/lang/en_us.json',
    );
    expect(lang).toBeDefined();
    const json = JSON.parse(lang!.content);
    expect(json['item.ruby_tools.ruby']).toBe('Ruby');
    expect(json['block.ruby_tools.ruby_block']).toBe('Ruby Block');
  });
});

// === P1.4 新增字段消费测试 ===

const SPEC_P14: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  customCode: [
    {
      snippetId: 'code_1',
      language: 'java',
      code: 'return 42;',
      inputSignature: { in_0: 'integer' },
      outputSignature: { out_0: 'integer' },
      methodName: 'calculateAnswer',
    },
  ],
  multiblocks: [
    {
      structureId: 'altar_1',
      displayName: 'Altar',
      width: 3,
      height: 3,
      depth: 3,
      hollow: true,
      controllerOffset: { x: 1, y: 1, z: 1 },
    },
  ],
  eventHandlers: [
    {
      handlerId: 'evt_1',
      eventType: 'player_right_click_block',
      eventArgs: { hand: 'main_hand' },
      // P1.5：通过 conditionIds/actionIds 引用顶层 conditions/actions
      conditionIds: ['cond_1'],
      actionIds: ['act_1'],
    },
  ],
  conditions: [
    {
      conditionId: 'cond_1',
      conditionType: 'has_item',
      args: { item: 'minecraft:stick' },
      invert: false,
    },
  ],
  actions: [
    {
      actionId: 'act_1',
      actionType: 'give_item',
      args: { item: 'minecraft:diamond', count: 1 },
    },
  ],
});

const CTX_P14: GeneratorContext = {
  loader: 'neoforge',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P14,
  projectPath: '/proj',
};

describe('NeoForgeAdapter P1.4 字段消费（spec 非空时生成新文件）', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX_P14);
  const paths = files.map((f) => f.path);

  it('生成 ModCustomCode.java（customCode 非空时）', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModCustomCode.java');
    const code = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModCustomCode.java',
    );
    expect(code).toBeDefined();
    expect(code!.content).toContain('public class ModCustomCode');
    expect(code!.content).toContain('snippetId: code_1');
    expect(code!.content).toContain('public static int calculateAnswer(int in_0)');
    expect(code!.content).toContain('return 42;');
  });

  it('生成 ModMultiblocks.java（multiblocks 非空时）', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModMultiblocks.java');
    const mb = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModMultiblocks.java',
    );
    expect(mb).toBeDefined();
    expect(mb!.content).toContain('ALTAR_1_ID = "altar_1"');
    expect(mb!.content).toContain('尺寸: 3x3x3, 空心: true');
  });

  it('生成 ModEvents.java（eventHandlers 非空时，含真实 if/else 逻辑）', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    // 事件处理器方法（handle_<handlerId>）
    expect(events!.content).toContain('事件处理器: evt_1');
    expect(events!.content).toContain('private static void handle_evt_1(EventContext ctx)');
    // 条件检查方法（check_<conditionId>）+ 动作执行方法（execute_<actionId>）
    expect(events!.content).toContain('条件: cond_1');
    expect(events!.content).toContain('private static boolean check_cond_1(EventContext ctx)');
    expect(events!.content).toContain('动作: act_1');
    expect(events!.content).toContain('private static void execute_act_1(EventContext ctx)');
    // 真实 if 语句（非纯注释占位）
    expect(events!.content).toContain('if (check_cond_1(ctx))');
    expect(events!.content).toContain('execute_act_1(ctx);');
    // NeoForge 事件注册：Forge 总线 addListener（mod 总线收不到游戏事件）
    expect(events!.content).toContain('MinecraftForge.EVENT_BUS');
    expect(events!.content).toContain(
      'net.minecraftforge.event.entity.player.PlayerInteractEvent.RightClickBlock',
    );
    expect(events!.content).not.toContain('modEventBus.addListener');
    // 事件参数绑定：EventContext 类 + instanceof 守卫绑定（客户端不崩）
    expect(events!.content).toContain('private static class EventContext');
    expect(events!.content).toContain(
      'ctx.player = event.getEntity() instanceof net.minecraft.server.level.ServerPlayer sp ? sp : null;',
    );
    expect(events!.content).toContain('ctx.pos = event.getPos();');
  });

  it('NeoForge 事件参数绑定：block_place/entity_death/item_pickup 绑定对应 getter', () => {
    const SPEC_BIND: ModSpec = ModSpecSchema.parse({
      modId: 'ruby_tools',
      version: '1.0.0',
      name: 'Ruby Tools',
      description: 'Event binding test',
      items: [],
      blocks: [],
      license: 'MIT',
      authors: [],
      eventHandlers: [
        { handlerId: 'evt_place', eventType: 'block_place', eventArgs: {} },
        { handlerId: 'evt_death', eventType: 'entity_death', eventArgs: {} },
        { handlerId: 'evt_pickup', eventType: 'item_pickup', eventArgs: {} },
        { handlerId: 'evt_tick', eventType: 'tick', eventArgs: {} },
      ],
      conditions: [],
      actions: [],
    });
    const files = adapter.translate({ ...CTX_P14, spec: SPEC_BIND });
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    expect(events!.content).toContain('ctx.state = event.getBlockSnapshot().getReplacedBlock();');
    expect(events!.content).toContain('ctx.target = event.getEntity();');
    // getItem() 返回 ItemEntity，需 .getItem() 取 ItemStack
    expect(events!.content).toContain('ctx.stack = event.getItem().getItem();');
    // tick 按 Phase.END 过滤（START 阶段直接 return）
    expect(events!.content).toContain('TickEvent.Phase.END');
    expect(events!.content).toContain('ctx.level = event.getServer().overworld();');
  });

  it('mainClass 构造函数调用新的 register/initialize 方法（事件走 Forge 总线无参 register）', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('ModCustomCode.initialize()');
    expect(main!.content).toContain('ModMultiblocks.initialize()');
    expect(main!.content).toContain('ModEvents.register();');
  });
});

// === P1.3 新增字段消费测试（recipes/entities/machines） ===

const SPEC_P13: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  recipes: [
    {
      recipeId: 'ruby_sword_recipe',
      recipeType: 'crafting_shaped',
      inputs: [
        { item: 'minecraft:iron_ingot', count: 1, slot: 'A' },
        { item: 'minecraft:stick', count: 1, slot: 'B' },
      ],
      output: 'minecraft:ruby_sword',
      outputCount: 1,
      cookTime: 200,
      experience: 0,
      pattern: ['AB', 'BA'],
    },
  ],
  entities: [
    {
      entityId: 'ruby_golem',
      displayName: 'Ruby Golem',
      maxHealth: 100,
      attackDamage: 15,
      movementSpeed: 0.25,
      classification: 'animal',
      modelType: 'pig',
      spawnWeight: 10,
      spawnBiomes: ['plains'],
    },
  ],
  machines: [
    {
      machineId: 'ruby_furnace',
      displayName: 'Ruby Furnace',
      energyCapacity: 20000,
      maxEnergyTransfer: 200,
      inputSlots: 1,
      outputSlots: 1,
      defaultProcessTime: 100,
      defaultEnergyPerTick: 20,
      guiWidth: 176,
      guiHeight: 166,
    },
  ],
});

const CTX_P13: GeneratorContext = {
  loader: 'neoforge',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P13,
  projectPath: '/proj',
};

describe('NeoForgeAdapter P1.3 字段消费（recipes/entities/machines 非空时生成新文件）', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX_P13);
  const paths = files.map((f) => f.path);

  it('生成 ModRecipes.java / ModEntities.java / ModMachines.java', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModRecipes.java');
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModEntities.java');
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModMachines.java');
  });

  it('ModRecipes.java 含 register 与 recipeId', () => {
    const recipes = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModRecipes.java',
    );
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('RUBY_SWORD_RECIPE_ID');
    expect(recipes!.content).toContain('ruby_sword_recipe');
  });

  it('ModEntities.java 含 DeferredRegister(ForgeRegistries.ENTITY_TYPES) 与 entityId', () => {
    const entities = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEntities.java',
    );
    expect(entities).toBeDefined();
    expect(entities!.content).toContain('DeferredRegister<EntityType<?>> ENTITIES');
    expect(entities!.content).toContain('ForgeRegistries.ENTITY_TYPES');
    expect(entities!.content).toContain('RegistryObject<EntityType<Pig>> RUBY_GOLEM');
    expect(entities!.content).toContain('EntityType.Builder.<Pig>of(Pig::new');
    expect(entities!.content).toContain('.sized(0.6f, 1.8f).build("ruby_golem")');
    expect(entities!.content).toContain('ruby_golem');
    expect(entities!.content).toContain('Ruby Golem');
    expect(entities!.content).not.toContain('createEntities');
  });

  it('ModMachines.java 含 DeferredRegister(BLOCK_ENTITY_TYPES/MENU_TYPES) 与 machineId', () => {
    const machines = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModMachines.java',
    );
    expect(machines).toBeDefined();
    expect(machines!.content).toContain('ForgeRegistries.BLOCK_ENTITY_TYPES');
    expect(machines!.content).toContain('ForgeRegistries.MENU_TYPES');
    expect(machines!.content).toContain('RUBY_FURNACE_BE');
    expect(machines!.content).toContain(
      'BlockEntityType.Builder.of(RubyFurnaceBlockEntity::new, Blocks.STONE)',
    );
    expect(machines!.content).toContain(
      'new MenuType<>((mid, inv) -> new RubyFurnaceMenu(mid, inv), FeatureFlags.DEFAULT_FLAGS)',
    );
    expect(machines!.content).toContain('ruby_furnace');
    expect(machines!.content).toContain('Ruby Furnace');
    expect(machines!.content).not.toContain('IMenuTypeExtension');
  });

  it('mainClass 构造函数调用 P1.3 模块的 register/initialize', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('ModRecipes.initialize()');
    expect(main!.content).toContain('ModEntities.register(modEventBus)');
    expect(main!.content).toContain('ModMachines.register(modEventBus)');
  });
});

// === P1.5 真实事件处理逻辑测试（conditionIds/actionIds/invert） ===

const SPEC_P15_INVERT: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  eventHandlers: [
    {
      handlerId: 'evt_inv',
      eventType: 'tick',
      eventArgs: {},
      conditionIds: ['cond_inv'],
      actionIds: ['act_inv'],
    },
  ],
  conditions: [
    {
      conditionId: 'cond_inv',
      conditionType: 'is_night',
      args: {},
      invert: true,
    },
  ],
  actions: [
    {
      actionId: 'act_inv',
      actionType: 'summon_lightning',
      args: { count: 1 },
    },
  ],
});

const CTX_P15_INVERT: GeneratorContext = {
  loader: 'neoforge',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P15_INVERT,
  projectPath: '/proj',
};

describe('NeoForgeAdapter P1.5 真实事件处理逻辑生成', () => {
  it('invert=true 的 condition 生成 if (!check_<id>) 语句', () => {
    const adapter = new NeoForgeAdapter();
    const files = adapter.translate(CTX_P15_INVERT);
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    // invert: true → if (!check_cond_inv(ctx))
    expect(events!.content).toContain('if (!check_cond_inv(ctx))');
    expect(events!.content).toContain('execute_act_inv(ctx);');
    // 同时验证正向 if 不存在（避免误判）
    expect(events!.content).not.toContain('if (check_cond_inv(ctx))');
    // NeoForge tick 事件类名占位
    expect(events!.content).toContain('ServerTickEvent');
  });

  it('eventHandlers/conditions/actions 全为空时不生成 ModEvents.java', () => {
    const adapter = new NeoForgeAdapter();
    const files = adapter.translate(CTX);
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
  });
});

// === P40 过程输入参数测试（NeoForge 侧） ===

const SPEC_P40_PROC: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Procedure inputs test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  eventHandlers: [
    {
      handlerId: 'evt_1',
      eventType: 'player_join',
      eventArgs: {},
      conditionIds: [],
      actionIds: [],
      procedureCallIds: ['proc_1'],
      // P40：amount 传 5，item 缺省回退 ""
      procedureCallArgs: { proc_1: ['5', ''] },
    },
  ],
  conditions: [],
  actions: [],
  procedures: [
    {
      procedureId: 'proc_1',
      procedureName: 'grantReward',
      displayName: '发放奖励',
      inputs: [
        { name: 'amount', type: 'int' },
        { name: 'item', type: 'string' },
      ],
      conditionIds: [],
      actionIds: [],
      procedureCallIds: [],
    },
  ],
});

describe('NeoForgeAdapter P40 过程输入参数', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate({
    loader: 'neoforge',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_PROC,
    projectPath: '/proj',
  });
  const events = files.find(
    (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
  );

  it('过程方法签名携带类型化输入参数（string → String）', () => {
    expect(events!.content).toContain(
      'private static void procedure_grantReward(EventContext ctx, int amount, String item)',
    );
  });

  it('事件处理器按 procedureCallArgs 传参（缺省回退 ""）', () => {
    expect(events!.content).toContain('procedure_grantReward(ctx, 5, "");');
  });
});

// === Task D: 流体（NeoForge 侧） ===

const SPEC_P40_FLUID_NEO: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Fluid test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  fluids: [
    {
      fluidId: 'ruby_juice',
      displayName: 'Ruby Juice',
      color: 0xff0000,
      temperature: 300,
      viscosity: 1000,
      density: 1000,
      luminous: false,
    },
  ],
});

describe('NeoForgeAdapter Task D 流体', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate({
    loader: 'neoforge',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_FLUID_NEO,
    projectPath: '/proj',
  });

  it('生成 ModFluids.java 用 FluidType + ForgeFlowingFluid（Forge 47 风格）', () => {
    const fluids = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModFluids.java',
    );
    expect(fluids).toBeDefined();
    expect(fluids!.content).toContain('public class ModFluids');
    expect(fluids!.content).toContain('DeferredRegister<FluidType> FLUID_TYPES');
    expect(fluids!.content).toContain('ForgeRegistries.FLUID_TYPES.get()');
    expect(fluids!.content).toContain('DeferredRegister<Fluid> FLUIDS');
    expect(fluids!.content).toContain('ForgeRegistries.FLUIDS');
    expect(fluids!.content).toContain('RUBY_JUICE_TYPE');
    expect(fluids!.content).toContain('new ForgeFlowingFluid.Source(');
    expect(fluids!.content).toContain('new ForgeFlowingFluid.Flowing(');
    expect(fluids!.content).not.toContain('DeferredFluid');
    expect(fluids!.content).not.toContain('SimpleFluid');
  });

  it('mainClass 调用 ModFluids.register(modEventBus)', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModFluids.register(modEventBus);');
  });
});

// === 版本切换（26.1 → Java 25）===

describe('NeoForgeAdapter 版本切换', () => {
  it('1.21.x 生成 Java 21 toolchain', () => {
    const files21 = new NeoForgeAdapter().translate({
      loader: 'neoforge',
      mcVersion: '1.21.1',
      modId: 'ruby_tools',
      spec: SPEC_P40_FLUID_NEO,
      projectPath: '/proj',
    });
    const bg = files21.find((f) => f.path === 'build.gradle');
    expect(bg!.content).toContain('JavaLanguageVersion.of(21)');
  });

  it('26.1 生成 Java 25 toolchain（版本感知）', () => {
    const files26 = new NeoForgeAdapter().translate({
      loader: 'neoforge',
      mcVersion: '26.1',
      modId: 'ruby_tools',
      spec: SPEC_P40_FLUID_NEO,
      projectPath: '/proj',
    });
    const bg = files26.find((f) => f.path === 'build.gradle');
    expect(bg!.content).toContain('JavaLanguageVersion.of(25)');
  });
});

// === Mod 侧世界生成（生物群系 + 维度，NeoForge）===

const SPEC_P40_WORLDGEN_NEO: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Worldgen test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  biomes: [
    {
      biomeId: 'ruby_plains',
      displayName: 'Ruby Plains',
      precipitation: 'snow',
      temperature: -0.5,
      temperatureModifier: 'frozen',
      downfall: 0.9,
      skyColor: 0x78a7ff,
      waterColor: 0x3f76e4,
      waterFogColor: 0x050533,
      fogColor: 0xc0d8ff,
      surfaceBuilder: 'minecraft:grass',
      category: 'plains',
      spawnWeight: 10,
      spawnDimensions: ['minecraft:overworld'],
    },
  ],
  dimensions: [
    {
      dimensionId: 'ruby_dim',
      displayName: 'Ruby Dimension',
      baseType: 'overworld',
      fixedTime: null,
      hasSkyLight: true,
      hasCeiling: false,
      ultrawarm: false,
      natural: true,
      coordinateScale: 1.0,
      minY: -64,
      height: 384,
      logicalHeight: 384,
      ambientLight: 0,
      piglinSafe: false,
      bedWorks: true,
      respawnAnchorWorks: false,
      effects: 'overworld',
    },
  ],
});

describe('NeoForgeAdapter Mod 侧世界生成', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate({
    loader: 'neoforge',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_WORLDGEN_NEO,
    projectPath: '/proj',
  });

  it('生成 ModBiomes.java 只保留 ID 常量（动态注册表走数据包 JSON）', () => {
    const biomes = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModBiomes.java',
    );
    expect(biomes).toBeDefined();
    expect(biomes!.content).toContain('RUBY_PLAINS_ID = "ruby_plains"');
    expect(biomes!.content).not.toContain('DeferredRegister');
    expect(biomes!.content).not.toContain('BiomeBuilder');
  });

  it('生成生物群系 worldgen/biome JSON（原版 codec 形状）', () => {
    const bj = files.find(
      (f) => f.path === 'src/main/resources/data/ruby_tools/worldgen/biome/ruby_plains.json',
    );
    expect(bj).toBeDefined();
    const json = JSON.parse(bj!.content);
    expect(json.temperature).toBe(-0.5);
    expect(json.downfall).toBe(0.9);
    expect(json.has_precipitation).toBe(true);
    expect(json.temperature_modifier).toBe('frozen');
    expect(json.effects.sky_color).toBe(0x78a7ff);
    expect(json.effects.water_color).toBe(0x3f76e4);
  });

  it('生成 ModDimensions.java 只保留 ID 常量 + dimension/dimension_type JSON', () => {
    const dims = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModDimensions.java',
    );
    expect(dims).toBeDefined();
    expect(dims!.content).toContain('RUBY_DIM_ID = "ruby_dim"');
    expect(dims!.content).not.toContain('DeferredRegister');
    const dt = files.find(
      (f) => f.path === 'src/main/resources/data/ruby_tools/dimension_type/ruby_dim.json',
    );
    expect(dt).toBeDefined();
    const dtJson = JSON.parse(dt!.content);
    expect(dtJson.infiniburn).toBe('minecraft:infiniburn_overworld');
    expect(dtJson.effects).toBe('minecraft:overworld');
    expect(dtJson.has_raids).toBe(true);
    expect(dtJson.fixed_time).toBeUndefined();
    const dim = files.find(
      (f) => f.path === 'src/main/resources/data/ruby_tools/dimension/ruby_dim.json',
    );
    expect(dim).toBeDefined();
    expect(JSON.parse(dim!.content).type).toBe('ruby_tools:ruby_dim');
  });

  it('mainClass 调用 ModBiomes/ModDimensions initialize（非 register）', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModBiomes.initialize();');
    expect(main!.content).toContain('ModDimensions.initialize();');
  });
});

// === Task 3: GUI 界面（NeoForge）===

const SPEC_P40_GUI_NEO: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'GUI test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  guis: [
    {
      guiId: 'ruby_furnace_gui',
      displayName: 'Ruby Furnace GUI',
      width: 176,
      height: 166,
      slots: [
        { slotId: 'in_0', slotType: 'input', x: 0, y: 0 },
        { slotId: 'out_0', slotType: 'output', x: 80, y: 0 },
      ],
      showEnergyBar: false,
      showProgressBar: false,
    },
  ],
});

describe('NeoForgeAdapter Task 3 GUI', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate({
    loader: 'neoforge',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_GUI_NEO,
    projectPath: '/proj',
  });

  it('生成 ModGuis.java 用 DeferredRegister(MENU_TYPES) + new MenuType（AT 放行）', () => {
    const guis = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModGuis.java');
    expect(guis).toBeDefined();
    expect(guis!.content).toContain('DeferredRegister<MenuType<?>> MENUS');
    expect(guis!.content).toContain('ForgeRegistries.MENU_TYPES');
    expect(guis!.content).toContain(
      'new MenuType<>((id, inv) -> new RubyFurnaceGuiMenu(id, inv), FeatureFlags.DEFAULT_FLAGS)',
    );
    expect(guis!.content).toContain('RubyFurnaceGuiMenu');
    expect(guis!.content).not.toContain('IMenuTypeExtension');
  });

  it('mainClass 调用 ModGuis.register(modEventBus)', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModGuis.register(modEventBus);');
  });
});

// === Task 4: Mod 侧结构（NeoForge）===

const SPEC_P40_STRUCTURE_NEO: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Structure test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  structures: [
    {
      structureId: 'ruby_tower',
      displayName: 'Ruby Tower',
      startPool: 'ruby_tools:tower/start_pool',
      size: 7,
      maxDistance: 80,
      biomes: '#minecraft:is_overworld',
      terrainAdaptation: 'none',
      spacing: 48,
      separation: 16,
      salt: 12345,
    },
  ],
});

describe('NeoForgeAdapter Task 4 Mod 侧结构', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate({
    loader: 'neoforge',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_STRUCTURE_NEO,
    projectPath: '/proj',
  });

  it('生成 ModStructures.java 只保留 ID 常量 + structure/structure_set/template_pool JSON', () => {
    const structures = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModStructures.java',
    );
    expect(structures).toBeDefined();
    expect(structures!.content).toContain('RUBY_TOWER_ID = "ruby_tower"');
    expect(structures!.content).not.toContain('DeferredRegister');
    expect(structures!.content).not.toContain('JigsawStructure');
    const st = files.find(
      (f) => f.path === 'src/main/resources/data/ruby_tools/worldgen/structure/ruby_tower.json',
    );
    expect(st).toBeDefined();
    const stJson = JSON.parse(st!.content);
    expect(stJson.type).toBe('minecraft:jigsaw');
    expect(stJson.start_pool).toBe('ruby_tools:tower/start_pool');
    expect(stJson.terrain_adaptation).toBe('none');
    const ss = files.find(
      (f) => f.path === 'src/main/resources/data/ruby_tools/worldgen/structure_set/ruby_tower.json',
    );
    expect(ss).toBeDefined();
    expect(JSON.parse(ss!.content).placement.spread_type).toBe('triangular');
    const tp = files.find(
      (f) =>
        f.path ===
        'src/main/resources/data/ruby_tools/worldgen/template_pool/tower/start_pool.json',
    );
    expect(tp).toBeDefined();
    expect(JSON.parse(tp!.content).fallback).toBe('minecraft:empty');
  });

  it('mainClass 调用 ModStructures.initialize()（非 register）', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModStructures.initialize();');
  });
});
