import { describe, it, expect } from 'vitest';
import { LegacyFabricAdapter } from './legacy-fabric-adapter.js';
import { ModGenerator } from './mod-generator.js';
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
  loader: 'legacy_fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('LegacyFabricAdapter 元数据与构建脚本', () => {
  const adapter = new LegacyFabricAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('loader 标识为 legacy_fabric', () => {
    expect(adapter.loader).toBe('legacy_fabric');
  });

  it('生成 fabric.mod.json（路径与 Fabric 一致）', () => {
    expect(paths).toContain('src/main/resources/fabric.mod.json');
  });

  it('不包含 quilt.mod.json', () => {
    expect(paths).not.toContain('src/main/resources/quilt.mod.json');
  });

  it('build.gradle 含 fabric-loom 0.5-SNAPSHOT（旧版本，非 1.7-SNAPSHOT）', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('fabric-loom');
    expect(bg!.content).toContain('0.5-SNAPSHOT');
    // 不应包含现代 Fabric 的 1.7-SNAPSHOT
    expect(bg!.content).not.toContain('1.7-SNAPSHOT');
  });

  it('build.gradle 用 Yarn mappings（含 yarn，非 officialMojangMappings）', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('yarn');
    // 旧 loom 不支持 officialMojangMappings，不应出现
    expect(bg!.content).not.toContain('officialMojangMappings');
  });

  it('build.gradle 用 Java 8（VERSION_1_8，非 VERSION_21）', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('VERSION_1_8');
    // 不应包含现代 Fabric 的 VERSION_21
    expect(bg!.content).not.toContain('VERSION_21');
  });

  it('gradle.properties 含 loader_version=0.12.12 与 yarn_version=', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('loader_version=0.12.12');
    expect(gp!.content).toContain('yarn_version=');
    // 1.16.5 是 Legacy Fabric 最常用版本
    expect(gp!.content).toContain('yarn_version=1.16.5+build.1');
  });
});

describe('LegacyFabricAdapter 端到端（通过 ModGenerator）', () => {
  it('ModGenerator.generate({ loader: "legacy_fabric" }) 产出 fabric.mod.json 且 build.gradle 用旧 loom', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate(CTX);
    // fabric.mod.json 存在（与 Fabric 一致）
    expect(result.files.some((f) => f.path === 'src/main/resources/fabric.mod.json')).toBe(true);
    // build.gradle 用旧版本 0.5-SNAPSHOT
    const bg = result.files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('0.5-SNAPSHOT');
  });
});

// === P1.4 新增字段消费测试（验证 LegacyFabricAdapter 继承 FabricAdapter 的新字段处理） ===

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
    },
  ],
});

const CTX_P14: GeneratorContext = {
  loader: 'legacy_fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P14,
  projectPath: '/proj',
};

describe('LegacyFabricAdapter P1.4 字段消费（继承 FabricAdapter）', () => {
  const adapter = new LegacyFabricAdapter();
  const files = adapter.translate(CTX_P14);
  const paths = files.map((f) => f.path);

  it('生成 ModCustomCode.java / ModMultiblocks.java / ModEvents.java', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModCustomCode.java');
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModMultiblocks.java');
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
  });

  it('mainClass 的 onInitialize 调用新的 initialize 方法', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('ModCustomCode.initialize()');
    expect(main!.content).toContain('ModMultiblocks.initialize()');
    expect(main!.content).toContain('ModEvents.initialize()');
  });
});

// === P1.3 新增字段消费测试（验证 LegacyFabricAdapter 继承 FabricAdapter 的 recipes/entities/machines 处理） ===

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
  loader: 'legacy_fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P13,
  projectPath: '/proj',
};

describe('LegacyFabricAdapter P1.3 字段消费（继承 FabricAdapter）', () => {
  const adapter = new LegacyFabricAdapter();
  const files = adapter.translate(CTX_P13);
  const paths = files.map((f) => f.path);

  it('生成 ModRecipes.java / ModEntities.java / ModMachines.java', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModRecipes.java');
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModEntities.java');
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModMachines.java');
  });

  it('ModRecipes/ModEntities/ModMachines 含 Registry.register 与对应 id', () => {
    const recipes = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModRecipes.java',
    );
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('RUBY_SWORD_RECIPE_ID');
    expect(recipes!.content).toContain('ruby_sword_recipe');

    const entities = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEntities.java',
    );
    expect(entities).toBeDefined();
    expect(entities!.content).toContain('Registry.register');
    expect(entities!.content).toContain('ruby_golem');

    const machines = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModMachines.java',
    );
    expect(machines).toBeDefined();
    expect(machines!.content).toContain('Registry.register');
    expect(machines!.content).toContain('ruby_furnace');
  });

  it('mainClass 的 onInitialize 调用 P1.3 模块的 initialize', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('ModRecipes.initialize()');
    expect(main!.content).toContain('ModEntities.initialize()');
    expect(main!.content).toContain('ModMachines.initialize()');
  });
});
