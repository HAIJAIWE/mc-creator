import { describe, it, expect } from 'vitest';
import { QuiltAdapter } from './quilt-adapter.js';
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
  loader: 'quilt',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('QuiltAdapter 元数据与构建脚本', () => {
  const adapter = new QuiltAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('生成 quilt.mod.json', () => {
    const qmj = files.find((f) => f.path === 'src/main/resources/quilt.mod.json');
    expect(qmj).toBeDefined();
    const json = JSON.parse(qmj!.content);
    // quilt_loader 字段存在
    expect(json.quilt_loader).toBeDefined();
    expect(json.quilt_loader.id).toBe('ruby_tools');
    expect(json.quilt_loader.group).toBe('com.example.ruby_tools');
    expect(json.quilt_loader.version).toBe('${version}');
    // metadata
    expect(json.quilt_loader.metadata.name).toBe('Ruby Tools');
    expect(json.quilt_loader.metadata.description).toBe('Adds ruby tools');
    // intermediate_mappings
    expect(json.quilt_loader.intermediate_mappings).toBe('net.fabricmc:intermediary');
    // depends 数组
    expect(Array.isArray(json.quilt_loader.depends)).toBe(true);
    const depIds = json.quilt_loader.depends.map((d: any) => d.id);
    expect(depIds).toContain('quilt_loader');
    expect(depIds).toContain('minecraft');
    expect(depIds).toContain('quilted_fabric_api');
    // entrypoints
    expect(json.entrypoints.main[0]).toBe('com.example.ruby_tools.RubyToolsMod');
  });

  it('不包含 fabric.mod.json', () => {
    expect(paths).not.toContain('src/main/resources/fabric.mod.json');
  });

  it('build.gradle 含 org.quiltmc.loom 与 officialMojangMappings', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('org.quiltmc.loom');
    expect(bg!.content).toContain('officialMojangMappings');
    // 依赖改为 quilt-loader / quilted-fabric-api
    expect(bg!.content).toContain('org.quiltmc:quilt-loader');
    expect(bg!.content).toContain('org.quiltmc.quilted-fabric-api:quilted-fabric-api');
    // processResources 匹配 quilt.mod.json
    expect(bg!.content).toContain('quilt.mod.json');
    expect(bg!.content).not.toContain('fabric.mod.json');
  });

  it('gradle.properties 含 quilt_loader_version 与 quilt_version', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('quilt_loader_version=0.27.0');
    expect(gp!.content).toContain('quilt_version=11.0.0-alpha.3+1.21.1');
    expect(gp!.content).toContain('minecraft_version=1.21.11');
    expect(gp!.content).toContain('maven_group=com.example.ruby_tools');
  });
});

describe('QuiltAdapter 复用 Fabric 逻辑', () => {
  const adapter = new QuiltAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('loader 标识为 quilt', () => {
    expect(adapter.loader).toBe('quilt');
  });

  it('Java 主类与 Fabric 一致（ModInitializer）', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('implements ModInitializer');
  });

  it('settings.gradle 与 lang/model/meta 资源文件均存在', () => {
    expect(paths).toContain('settings.gradle');
    expect(paths).toContain('src/main/resources/assets/ruby_tools/lang/en_us.json');
    expect(paths).toContain('src/main/resources/assets/ruby_tools/models/item/ruby.json');
    expect(paths).toContain('src/main/resources/ruby_tools_meta.json');
  });
});

// === P1.4 新增字段消费测试（验证 QuiltAdapter 继承 FabricAdapter 的新字段处理） ===

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
  loader: 'quilt',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P14,
  projectPath: '/proj',
};

describe('QuiltAdapter P1.4 字段消费（继承 FabricAdapter）', () => {
  const adapter = new QuiltAdapter();
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

  it('spec 为空时不生成新文件（原始 CTX）', () => {
    const emptyFiles = adapter.translate(CTX);
    const emptyPaths = emptyFiles.map((f) => f.path);
    expect(emptyPaths).not.toContain('src/main/java/com/example/ruby_tools/ModCustomCode.java');
    expect(emptyPaths).not.toContain('src/main/java/com/example/ruby_tools/ModMultiblocks.java');
    expect(emptyPaths).not.toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
  });
});

// === P1.3 新增字段消费测试（验证 QuiltAdapter 继承 FabricAdapter 的 recipes/entities/machines 处理） ===

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
  loader: 'quilt',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P13,
  projectPath: '/proj',
};

describe('QuiltAdapter P1.3 字段消费（继承 FabricAdapter）', () => {
  const adapter = new QuiltAdapter();
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
