import { describe, it, expect } from 'vitest';
import { NeoForgeAdapter } from './neoforge-adapter.js';
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

  it('生成 gradle.properties', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('mc_version=1.21.11');
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

  it('生成 ModItems（DeferredRegister + 每个物品）', () => {
    const items = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModItems.java',
    );
    expect(items).toBeDefined();
    expect(items!.content).toContain('DeferredRegister');
    expect(items!.content).toContain('RUBY');
    expect(items!.content).toContain('registerSimpleItem("ruby"');
  });

  it('生成 ModBlocks（DeferredRegister + 每个方块）', () => {
    const blocks = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModBlocks.java',
    );
    expect(blocks).toBeDefined();
    expect(blocks!.content).toContain('DeferredRegister');
    expect(blocks!.content).toContain('RUBY_BLOCK');
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
    // NeoForge 事件注册：真实 IEventBus.addListener 调用（非占位注释）
    expect(events!.content).toContain('modEventBus.addListener');
    expect(events!.content).toContain('PlayerInteractEvent.RightClickBlock');
    // 事件参数绑定：EventContext 类 + getter 绑定
    expect(events!.content).toContain('private static class EventContext');
    expect(events!.content).toContain(
      'ctx.player = (net.minecraft.server.level.ServerPlayer) event.getEntity();',
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
    expect(events!.content).toContain('ctx.stack = event.getItem();');
    expect(events!.content).toContain('ctx.level = event.getServer().overworld();');
  });

  it('mainClass 构造函数调用新的 initialize 方法', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('ModCustomCode.initialize()');
    expect(main!.content).toContain('ModMultiblocks.initialize()');
    expect(main!.content).toContain('ModEvents.initialize(modEventBus)');
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

  it('ModEntities.java 含 DeferredRegister 与 entityId', () => {
    const entities = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEntities.java',
    );
    expect(entities).toBeDefined();
    expect(entities!.content).toContain('DeferredRegister');
    expect(entities!.content).toContain('ruby_golem');
    expect(entities!.content).toContain('Ruby Golem');
  });

  it('ModMachines.java 含 DeferredRegister 与 machineId', () => {
    const machines = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModMachines.java',
    );
    expect(machines).toBeDefined();
    expect(machines!.content).toContain('DeferredRegister');
    expect(machines!.content).toContain('ruby_furnace');
    expect(machines!.content).toContain('Ruby Furnace');
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

  it('生成 ModFluids.java 用 DeferredRegister.Fluids', () => {
    const fluids = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModFluids.java',
    );
    expect(fluids).toBeDefined();
    expect(fluids!.content).toContain('public class ModFluids');
    expect(fluids!.content).toContain('DeferredRegister.Fluids FLUIDS');
    expect(fluids!.content).toContain('FLUIDS.register("ruby_juice"');
    expect(fluids!.content).toContain('DeferredFluid');
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

  it('生成 ModBiomes.java 用 DeferredRegister.Biomes', () => {
    const biomes = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModBiomes.java',
    );
    expect(biomes).toBeDefined();
    expect(biomes!.content).toContain('DeferredRegister.Biomes BIOMES');
    expect(biomes!.content).toContain('BIOMES.register("ruby_plains"');
    expect(biomes!.content).toContain('Precipitation.SNOW');
    expect(biomes!.content).toContain('temperatureAdjustment');
  });

  it('生成 ModDimensions.java 用 DeferredRegister<DimensionType>', () => {
    const dims = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModDimensions.java',
    );
    expect(dims).toBeDefined();
    expect(dims!.content).toContain('Registries.DIMENSION_TYPE');
    expect(dims!.content).toContain('DIMENSION_TYPES.register("ruby_dim"');
    expect(dims!.content).toContain('OptionalLong.empty()');
  });

  it('mainClass 调用 ModBiomes/ModDimensions register', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModBiomes.register(modEventBus);');
    expect(main!.content).toContain('ModDimensions.register(modEventBus);');
  });
});
