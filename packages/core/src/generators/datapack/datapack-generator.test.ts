import { describe, it, expect } from 'vitest';
import { DatapackGenerator } from './datapack-generator.js';
import type { GeneratorContext, DatapackSpec } from '@mc-creator/shared';
import { RecipeSpec } from '@mc-creator/shared';

function makeCtx(spec: Partial<DatapackSpec>): GeneratorContext {
  return {
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'test_pack',
    spec: {
      modId: 'test_pack',
      version: '1.0.0',
      name: 'Test',
      description: '',
      items: [],
      blocks: [],
      ...spec,
    } as any,
    projectPath: '',
  };
}

describe('DatapackGenerator', () => {
  const gen = new DatapackGenerator();

  it('生成 pack.mcmeta', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        packName: 'My Pack',
        packFormat: 48,
      }),
    );
    const meta = result.files.find((f) => f.path === 'pack.mcmeta');
    expect(meta).toBeDefined();
    expect(JSON.parse(meta!.content).pack.pack_format).toBe(48);
  });

  it('生成 shaped 配方', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        recipes: [
          RecipeSpec.parse({
            id: 'diamond_sword_upgrade',
            type: 'crafting_shaped',
            result: 'minecraft:diamond_sword',
            count: 1,
            pattern: [' D', 'D '],
            key: { D: ['minecraft:diamond'] },
          }),
        ],
      }),
    );
    const recipe = result.files.find(
      (f) => f.path === 'data/my_pack/recipe/diamond_sword_upgrade.json',
    );
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed.type).toBe('minecraft:crafting_shaped');
    expect(parsed.result.id).toBe('minecraft:diamond_sword');
  });

  it('生成函数 mcfunction', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        functions: [
          {
            id: 'tick',
            commands: ['say hello', 'give @s minecraft:diamond 1'],
          },
        ],
      }),
    );
    const func = result.files.find((f) => f.path === 'data/my_pack/function/tick.mcfunction');
    expect(func).toBeDefined();
    expect(func!.content).toContain('say hello');
    expect(func!.content).toContain('give @s minecraft:diamond 1');
  });

  it('生成标签', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        tags: [
          {
            id: 'custom_items',
            type: 'item',
            values: ['minecraft:diamond', 'minecraft:emerald'],
            replace: false,
          },
        ],
      }),
    );
    const tag = result.files.find((f) => f.path === 'data/my_pack/tags/item/custom_items.json');
    expect(tag).toBeDefined();
    const parsed = JSON.parse(tag!.content);
    expect(parsed.values).toContain('minecraft:diamond');
  });

  it('buildCmd 为空（数据包不需编译）', async () => {
    const result = await gen.generate(makeCtx({ packId: 'p' }));
    expect(result.buildCmd).toBe('');
  });

  it('P10：生成战利品表 loot_tables（带子路径）', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        lootTables: [
          {
            namespace: 'my_pack',
            path: 'blocks/custom_block',
            type: 'block',
            pools: [
              {
                rolls: 2,
                entries: [
                  { name: 'my_pack:custom_item', weight: 3, count: 1 },
                  { name: 'minecraft:stick', weight: 1, count: 2 },
                ],
              },
            ],
          },
        ],
      }),
    );
    const loot = result.files.find(
      (f) => f.path === 'data/my_pack/loot_tables/block/blocks/custom_block.json',
    );
    expect(loot).toBeDefined();
    const parsed = JSON.parse(loot!.content);
    expect(parsed.type).toBe('minecraft:block');
    expect(parsed.pools[0].rolls).toBe(2);
    expect(parsed.pools[0].entries).toHaveLength(2);
  });

  it('P10：生成战利品表（简单路径）', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        lootTables: [
          {
            namespace: 'my_pack',
            path: 'custom_block',
            type: 'block',
            pools: [
              {
                rolls: 1,
                entries: [{ name: 'minecraft:diamond', weight: 1, count: 1 }],
              },
            ],
          },
        ],
      }),
    );
    const loot = result.files.find(
      (f) => f.path === 'data/my_pack/loot_tables/block/custom_block.json',
    );
    expect(loot).toBeDefined();
    const parsed = JSON.parse(loot!.content);
    expect(parsed.type).toBe('minecraft:block');
    expect(parsed.pools[0].rolls).toBe(1);
    expect(parsed.pools[0].entries[0].name).toBe('minecraft:diamond');
    expect(parsed.pools[0].entries[0].weight).toBe(1);
  });

  it('P10：生成 predicates', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        predicates: [
          {
            namespace: 'my_pack',
            path: 'has_diamond',
            condition: JSON.stringify({
              condition: 'minecraft:inventory_changed',
              items: ['minecraft:diamond'],
            }),
          },
        ],
      }),
    );
    const pred = result.files.find((f) => f.path === 'data/my_pack/predicates/has_diamond.json');
    expect(pred).toBeDefined();
    const parsed = JSON.parse(pred!.content);
    expect(parsed.condition.condition).toBe('minecraft:inventory_changed');
  });

  it('P10：生成 itemTags', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        itemTags: [
          {
            namespace: 'my_pack',
            tag: 'custom_items',
            values: ['my_pack:ruby', 'my_pack:sapphire'],
            replace: false,
          },
        ],
      }),
    );
    const tag = result.files.find((f) => f.path === 'data/my_pack/tags/item/custom_items.json');
    expect(tag).toBeDefined();
    const parsed = JSON.parse(tag!.content);
    expect(parsed.values).toContain('my_pack:ruby');
    expect(parsed.replace).toBe(false);
  });

  it('P10：生成 blockTags', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        blockTags: [
          {
            namespace: 'my_pack',
            tag: 'custom_blocks',
            values: ['my_pack:ruby_block'],
            replace: true,
          },
        ],
      }),
    );
    const tag = result.files.find((f) => f.path === 'data/my_pack/tags/block/custom_blocks.json');
    expect(tag).toBeDefined();
    const parsed = JSON.parse(tag!.content);
    expect(parsed.values).toContain('my_pack:ruby_block');
    expect(parsed.replace).toBe(true);
  });

  it('P10：默认空新字段不产生额外文件', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
      }),
    );
    expect(result.files).toHaveLength(1); // 仅 pack.mcmeta
  });

  // ===== 世界生成测试 =====

  it('生成维度类型', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        dimensionTypes: [
          {
            id: 'crystal_dim_type',
            fixedTime: 6000,
            hasSkyLight: true,
            hasCeiling: false,
            ultraWarm: false,
            natural: true,
            coordinateScale: 1.0,
            bedWorks: true,
            respawnAnchorWorks: false,
            minY: 0,
            height: 256,
            logicalHeight: 256,
            infiniburn: '#minecraft:infiniburn_overworld',
            effects: 'overworld',
            ambientLight: 0.1,
            piglinSafe: false,
          },
        ],
      }),
    );
    const dt = result.files.find(
      (f) => f.path === 'data/my_pack/dimension_type/crystal_dim_type.json',
    );
    expect(dt).toBeDefined();
    const parsed = JSON.parse(dt!.content);
    expect(parsed.fixed_time).toBe(6000);
    expect(parsed.has_skylight).toBe(true);
    expect(parsed.height).toBe(256);
    expect(parsed.effects).toBe('minecraft:overworld');
  });

  it('生成生物群系', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        biomes: [
          {
            id: 'crystal_plains',
            precipitation: 'rain',
            temperature: 0.7,
            temperatureModifier: 'none',
            downfall: 0.4,
            skyColor: 0x78a7ff,
            waterColor: 0x3f76e4,
            waterFogColor: 0x050533,
            fogColor: 0xc0d8ff,
            surfaceBuilder: 'minecraft:grass',
          },
        ],
      }),
    );
    const biome = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/biome/crystal_plains.json',
    );
    expect(biome).toBeDefined();
    const parsed = JSON.parse(biome!.content);
    expect(parsed.precipitation).toBe('rain');
    expect(parsed.temperature).toBe(0.7);
    expect(parsed.effects.sky_color).toBe(0x78a7ff);
  });

  it('生成 noise 维度', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        dimensions: [
          {
            id: 'crystal_world',
            dimensionType: 'my_pack:crystal_dim_type',
            generatorType: 'noise',
            biomeSource: 'multi_noise',
            biomes: ['my_pack:crystal_plains', 'minecraft:desert'],
            noiseSettings: 'minecraft:overworld',
            flatLayers: [],
          },
        ],
      }),
    );
    const dim = result.files.find((f) => f.path === 'data/my_pack/dimension/crystal_world.json');
    expect(dim).toBeDefined();
    const parsed = JSON.parse(dim!.content);
    expect(parsed.type).toBe('my_pack:crystal_dim_type');
    expect(parsed.generator.type).toBe('minecraft:noise');
    expect(parsed.generator.biome_source.type).toBe('minecraft:multi_noise');
    expect(parsed.generator.biome_source.biomes).toHaveLength(2);
  });

  it('生成 flat 维度', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        dimensions: [
          {
            id: 'flat_test',
            dimensionType: 'minecraft:overworld',
            generatorType: 'flat',
            biomeSource: 'fixed',
            biomes: ['minecraft:plains'],
            noiseSettings: 'minecraft:overworld',
            flatLayers: [
              { block: 'minecraft:bedrock', height: 1 },
              { block: 'minecraft:stone', height: 3 },
              { block: 'minecraft:dirt', height: 2 },
              { block: 'minecraft:grass_block', height: 1 },
            ],
          },
        ],
      }),
    );
    const dim = result.files.find((f) => f.path === 'data/my_pack/dimension/flat_test.json');
    expect(dim).toBeDefined();
    const parsed = JSON.parse(dim!.content);
    expect(parsed.generator.type).toBe('minecraft:flat');
    expect(parsed.generator.settings.layers).toHaveLength(4);
    expect(parsed.generator.settings.layers[0].block).toBe('minecraft:bedrock');
  });

  // ===== MC 新内容类型测试 =====

  it('生成自定义附魔', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        enchantments: [
          {
            id: 'soul_fire',
            description: 'enchantment.my_pack.soul_fire',
            minLevel: 1,
            maxLevel: 3,
            anvilCost: 2,
            slots: ['mainhand'],
            supportedItems: '#minecraft:enchantable/sword',
            weight: 8,
            maxCost: 8,
            isCurse: false,
            isTreasure: false,
          },
        ],
      }),
    );
    const ench = result.files.find((f) => f.path === 'data/my_pack/enchantment/soul_fire.json');
    expect(ench).toBeDefined();
    const parsed = JSON.parse(ench!.content);
    expect(parsed.description.translate).toBe('enchantment.my_pack.soul_fire');
    expect(parsed.weight).toBe(8);
    expect(parsed.slots).toContain('mainhand');
  });

  it('生成自定义状态效果', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        effects: [
          {
            id: 'radiance',
            description: 'effect.my_pack.radiance',
            color: 0xffd700,
            instant: false,
            beneficial: true,
          },
        ],
      }),
    );
    const eff = result.files.find((f) => f.path === 'data/my_pack/effect/radiance.json');
    expect(eff).toBeDefined();
    const parsed = JSON.parse(eff!.content);
    expect(parsed.color).toBe(0xffd700);
  });

  it('生成自定义损伤类型', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        damageTypes: [
          {
            id: 'soul_burn',
            messageType: 'default',
            scaling: 'always',
            exhaustion: 0.1,
          },
        ],
      }),
    );
    const dt = result.files.find((f) => f.path === 'data/my_pack/damage_type/soul_burn.json');
    expect(dt).toBeDefined();
    const parsed = JSON.parse(dt!.content);
    expect(parsed.message_type).toBe('minecraft:default');
    expect(parsed.scaling).toBe('minecraft:always');
  });

  it('生成自定义结构', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        structures: [
          {
            id: 'crystal_tower',
            templatePool: 'my_pack:crystal_tower/start_pool',
            placementType: 'jigsaw',
            maxDistance: 7,
            size: 7,
            startHeight:
              '{"type":"minecraft:uniform","min":{"absolute":60},"max":{"absolute":100}}',
            biomes: '#my_pack:has_crystal_tower',
            step: 'beard',
            useExpansionHack: false,
          },
        ],
      }),
    );
    const st = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/structure/crystal_tower.json',
    );
    expect(st).toBeDefined();
    const parsed = JSON.parse(st!.content);
    expect(parsed.type).toBe('minecraft:jigsaw');
    expect(parsed.template_pools).toContain('my_pack:crystal_tower/start_pool');
  });

  it('生成粒子', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        particles: [
          {
            id: 'crystal_sparkle',
            description: 'particle.my_pack.crystal_sparkle',
            override: false,
          },
        ],
      }),
    );
    const p = result.files.find((f) => f.path === 'data/my_pack/particle/crystal_sparkle.json');
    expect(p).toBeDefined();
  });

  it('生成盔甲纹饰', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        trimPatterns: [
          {
            id: 'crystal',
            templateItem: 'my_pack:crystal_armor_trim_smithing_template',
            description: 'trim_pattern.my_pack.crystal',
            decal: false,
          },
        ],
        trimMaterials: [
          {
            id: 'crystal',
            materialItem: 'my_pack:crystal_shard',
            color: '#00FFFF',
            description: 'trim_material.my_pack.crystal',
          },
        ],
      }),
    );
    const tp = result.files.find((f) => f.path === 'data/my_pack/trim_pattern/crystal.json');
    const tm = result.files.find((f) => f.path === 'data/my_pack/trim_material/crystal.json');
    expect(tp).toBeDefined();
    expect(tm).toBeDefined();
    const tmParsed = JSON.parse(tm!.content);
    expect(tmParsed.color).toBe('#00FFFF');
  });

  it('生成乐器', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        instruments: [
          {
            id: 'crystal_horn',
            soundEvent: 'my_pack:crystal_horn_sound',
            useDuration: 140,
            range: 300,
            description: 'instrument.my_pack.crystal_horn',
          },
        ],
      }),
    );
    const inst = result.files.find((f) => f.path === 'data/my_pack/instrument/crystal_horn.json');
    expect(inst).toBeDefined();
    const parsed = JSON.parse(inst!.content);
    expect(parsed.use_duration).toBe(140);
    expect(parsed.range).toBe(300);
  });

  it('生成结构集', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        structureSets: [
          {
            id: 'crystal_towers',
            structures: [
              { structure: 'my_pack:crystal_tower', weight: 1 },
              { structure: 'my_pack:crystal_tower_large', weight: 3 },
            ],
            placement: {
              type: 'minecraft:random_spread',
              spacing: 64,
              separation: 24,
              salt: 12345,
              frequency: 0.8,
              frequencyModifier: 'minecraft:beards',
            },
          },
        ],
      }),
    );
    const ss = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/structure_set/crystal_towers.json',
    );
    expect(ss).toBeDefined();
    const parsed = JSON.parse(ss!.content);
    expect(parsed.structures).toHaveLength(2);
    expect(parsed.structures[0].structure).toBe('my_pack:crystal_tower');
    expect(parsed.placement.spacing).toBe(64);
    expect(parsed.placement.frequency).toBe(0.8);
    expect(parsed.placement.frequency_modifier).toBe('minecraft:beards');
  });

  it('生成多噪声参数维度', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        dimensions: [
          {
            id: 'multi_noise_dim',
            dimensionType: 'minecraft:overworld',
            generatorType: 'noise',
            biomeSource: 'multi_noise',
            biomes: ['my_pack:plains', 'my_pack:desert'],
            noiseSettings: 'minecraft:overworld',
            flatLayers: [],
            multiNoiseParams: [
              {
                biome: 'my_pack:plains',
                temperature: 0.5,
                humidity: 0.3,
                continentalness: 0,
                erosion: 0,
                weirdness: 0,
                offset: 0,
              },
              {
                biome: 'my_pack:desert',
                temperature: 2.0,
                humidity: -0.5,
                continentalness: 0.5,
                erosion: 0,
                weirdness: 0,
                offset: 0.1,
              },
            ],
          },
        ],
      }),
    );
    const dim = result.files.find((f) => f.path === 'data/my_pack/dimension/multi_noise_dim.json');
    expect(dim).toBeDefined();
    const parsed = JSON.parse(dim!.content);
    expect(parsed.generator.biome_source.type).toBe('minecraft:multi_noise');
    expect(parsed.generator.biome_source.biomes).toHaveLength(2);
    expect(parsed.generator.biome_source.biomes[0].temperature).toBe(0.5);
    expect(parsed.generator.biome_source.biomes[1].temperature).toBe(2.0);
    expect(parsed.generator.biome_source.biomes[1].humidity).toBe(-0.5);
  });
});
