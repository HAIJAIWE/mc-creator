import { describe, it, expect } from 'vitest';
import { DatapackGenerator } from './datapack-generator.js';
import type { GeneratorContext, DatapackSpec } from '@mc-creator/shared';
import { RecipeSpec, ModRecipeSpec } from '@mc-creator/shared';

// recipes 字段允许同时传入 datapack RecipeSpec 和 ModRecipeSpec（运行时由 isModRecipe 区分），
// 因此用 Omit 移除原 recipes 类型约束后放宽为 any[]，其余字段仍保留 DatapackSpec 的类型约束。
function makeCtx(
  spec: Omit<Partial<DatapackSpec>, 'recipes'> & { recipes?: any[] },
): GeneratorContext {
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

  it('P10：生成战利品表 loot_table（带子路径）', async () => {
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
      (f) => f.path === 'data/my_pack/loot_table/block/blocks/custom_block.json',
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
      (f) => f.path === 'data/my_pack/loot_table/block/custom_block.json',
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
    const pred = result.files.find((f) => f.path === 'data/my_pack/predicate/has_diamond.json');
    expect(pred).toBeDefined();
    const parsed = JSON.parse(pred!.content);
    // 谓词文件顶层就是条件对象本身（MC 1.21 格式），不再包一层 condition
    expect(parsed.condition).toBe('minecraft:inventory_changed');
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
    // 1.21+：输出 surface_rule（替代废弃的 surface_builder），不再输出 surface_builder
    expect(parsed.surface_rule).toEqual({ type: 'minecraft:grass' });
    expect(parsed.surface_builder).toBeUndefined();
  });

  it('surfaceRule 对象直通输出（优先级高于 surfaceBuilder 推断）', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        biomes: [
          {
            id: 'custom_surface',
            precipitation: 'rain',
            temperature: 0.7,
            temperatureModifier: 'none',
            downfall: 0.4,
            skyColor: 0x78a7ff,
            waterColor: 0x3f76e4,
            waterFogColor: 0x050533,
            fogColor: 0xc0d8ff,
            surfaceBuilder: 'minecraft:grass',
            surfaceRule: { type: 'minecraft:stone' },
          },
        ],
      }),
    );
    const biome = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/biome/custom_surface.json',
    );
    expect(biome).toBeDefined();
    const parsed = JSON.parse(biome!.content);
    expect(parsed.surface_rule).toEqual({ type: 'minecraft:stone' });
    expect(parsed.surface_builder).toBeUndefined();
  });

  it('surfaceRule 为 JSON 字符串对象时按原样解析', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        biomes: [
          {
            id: 'json_surface',
            precipitation: 'none',
            temperature: 0.7,
            temperatureModifier: 'none',
            downfall: 0.4,
            skyColor: 0x78a7ff,
            waterColor: 0x3f76e4,
            waterFogColor: 0x050533,
            fogColor: 0xc0d8ff,
            surfaceBuilder: '{"type":"minecraft:the_end"}',
          },
        ],
      }),
    );
    const biome = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/biome/json_surface.json',
    );
    expect(biome).toBeDefined();
    const parsed = JSON.parse(biome!.content);
    expect(parsed.surface_rule).toEqual({ type: 'minecraft:the_end' });
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
    expect(parsed.message_id).toBe('default');
    expect(parsed.scaling).toBe('always');
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
    expect(parsed.start_pool).toBe('my_pack:crystal_tower/start_pool');
    expect(parsed.max_distance_from_center).toBe(7);
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

  it('Task A: 生成已配置特性 configured_feature', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        configuredFeatures: [
          {
            id: 'ruby_ore',
            type: 'minecraft:ore',
            config: {
              size: 8,
              discard_chance_on_air_exposure: 0.5,
              targets: [
                {
                  target: { block: 'minecraft:stone', state: {} },
                  state: { Name: 'my_pack:ruby_ore' },
                },
              ],
            },
          },
        ],
      }),
    );
    const cf = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/configured_feature/ruby_ore.json',
    );
    expect(cf).toBeDefined();
    const parsed = JSON.parse(cf!.content);
    expect(parsed.type).toBe('minecraft:ore');
    expect(parsed.config.size).toBe(8);
    expect(parsed.config.targets[0].state.Name).toBe('my_pack:ruby_ore');
  });

  it('Task A: type 无 minecraft: 前缀时自动补齐', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        configuredFeatures: [{ id: 'f1', type: 'ore', config: {} }],
      }),
    );
    const cf = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/configured_feature/f1.json',
    );
    expect(JSON.parse(cf!.content).type).toBe('minecraft:ore');
  });

  it('Task A: 生成已放置特性 placed_feature', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        placedFeatures: [
          {
            id: 'ruby_ore_placed',
            feature: 'my_pack:ruby_ore',
            placements: [
              { type: 'minecraft:count', count: 12 },
              { type: 'minecraft:heightmap', heightmap: 'OCEAN_FLOOR_WG' },
            ],
          },
        ],
      }),
    );
    const pf = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/placed_feature/ruby_ore_placed.json',
    );
    expect(pf).toBeDefined();
    const parsed = JSON.parse(pf!.content);
    expect(parsed.feature).toBe('my_pack:ruby_ore');
    expect(parsed.placement).toHaveLength(2);
    expect(parsed.placement[0].count).toBe(12);
  });

  it('Task A: 生成模板池 template_pool', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        templatePools: [
          {
            id: 'house/base',
            fallback: 'minecraft:empty',
            entries: [
              { template: 'my_pack:house/base_1', weight: 2 },
              { template: 'my_pack:house/base_2', weight: 1 },
            ],
          },
        ],
      }),
    );
    const pool = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/template_pool/house/base.json',
    );
    expect(pool).toBeDefined();
    const parsed = JSON.parse(pool!.content);
    expect(parsed.fallback).toBe('minecraft:empty');
    expect(parsed.elements).toHaveLength(2);
    expect(parsed.elements[0].element.location).toBe('my_pack:house/base_1');
    expect(parsed.elements[0].element.element_type).toBe('minecraft:single_pool_element');
    expect(parsed.elements[1].weight).toBe(1);
  });

  it('Task A: 生成处理器列表 processor_list', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        processorLists: [
          {
            id: 'crystal_towers_processors',
            processors: [
              { type: 'minecraft:block_age', config: { mossiness: 0.5 } },
              { type: 'minecraft:block_rotate', config: {} },
            ],
          },
        ],
      }),
    );
    const pl = result.files.find(
      (f) => f.path === 'data/my_pack/worldgen/processor_list/crystal_towers_processors.json',
    );
    expect(pl).toBeDefined();
    const parsed = JSON.parse(pl!.content);
    expect(parsed.processors).toHaveLength(2);
    expect(parsed.processors[0].processor_type).toBe('minecraft:block_age');
    expect(parsed.processors[0].mossiness).toBe(0.5);
  });

  it('Task A: processor type 无前缀时自动补齐', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        processorLists: [{ id: 'p1', processors: [{ type: 'block_ignore', config: {} }] }],
      }),
    );
    const pl = result.files.find((f) => f.path === 'data/my_pack/worldgen/processor_list/p1.json');
    expect(JSON.parse(pl!.content).processors[0].processor_type).toBe('minecraft:block_ignore');
  });

  it('Task B: 生成唱片机歌曲 jukebox_song', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        jukeboxSongs: [
          {
            id: 'my_disc',
            songItem: 'my_pack:my_disc',
            soundEvent: 'my_pack:music_disc.my_disc',
            lengthInSeconds: 200,
            comparatorOutput: 7,
            description: 'item.my_pack.my_disc.desc',
          },
        ],
      }),
    );
    const js = result.files.find((f) => f.path === 'data/my_pack/jukebox_song/my_disc.json');
    expect(js).toBeDefined();
    const parsed = JSON.parse(js!.content);
    expect(parsed.song_item).toBe('my_pack:my_disc');
    expect(parsed.length_in_seconds).toBe(200);
    expect(parsed.comparator_output).toBe(7);
  });

  it('Task B: 生成画作变体 painting_variant', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        paintingVariants: [
          { id: 'wide_art', assetId: 'my_pack:painting/wide_art', width: 2, height: 1 },
        ],
      }),
    );
    const pv = result.files.find((f) => f.path === 'data/my_pack/painting_variant/wide_art.json');
    expect(pv).toBeDefined();
    const parsed = JSON.parse(pv!.content);
    expect(parsed.asset_id).toBe('my_pack:painting/wide_art');
    expect(parsed.width).toBe(2);
    expect(parsed.height).toBe(1);
  });

  it('Task B: 生成狼变体 wolf_variant', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        wolfVariants: [
          {
            id: 'snowy_wolf',
            wildTexture: 'my_pack:entity/wolf/snowy_wolf',
            tameTexture: 'my_pack:entity/wolf/snowy_wolf_tame',
            angryTexture: 'my_pack:entity/wolf/snowy_wolf_angry',
            biomes: '#minecraft:is_snowy',
          },
        ],
      }),
    );
    const wv = result.files.find((f) => f.path === 'data/my_pack/wolf_variant/snowy_wolf.json');
    expect(wv).toBeDefined();
    const parsed = JSON.parse(wv!.content);
    expect(parsed.wild_texture).toBe('my_pack:entity/wolf/snowy_wolf');
    expect(parsed.tame_texture).toBe('my_pack:entity/wolf/snowy_wolf_tame');
    expect(parsed.angry_texture).toBe('my_pack:entity/wolf/snowy_wolf_angry');
    expect(parsed.biomes).toBe('#minecraft:is_snowy');
  });

  it('Task B: 生成旗帜图案 banner_pattern', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        bannerPatterns: [{ id: 'my_pattern', assetId: 'my_pack:my_pattern' }],
      }),
    );
    const bp = result.files.find((f) => f.path === 'data/my_pack/banner_pattern/my_pattern.json');
    expect(bp).toBeDefined();
    expect(JSON.parse(bp!.content).asset_id).toBe('my_pack:my_pattern');
  });

  it('Task B: 生成聊天类型 chat_type', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        chatTypes: [
          {
            id: 'my_chat',
            chat: { translationKey: 'chat.type.my_chat', parameters: ['sender', 'content'] },
            narration: {
              translationKey: 'chat.type.my_chat.narrate',
              parameters: ['sender', 'content'],
            },
          },
        ],
      }),
    );
    const ct = result.files.find((f) => f.path === 'data/my_pack/chat_type/my_chat.json');
    expect(ct).toBeDefined();
    const parsed = JSON.parse(ct!.content);
    expect(parsed.chat.translation_key).toBe('chat.type.my_chat');
    expect(parsed.narration.parameters).toContain('sender');
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

  // ===== ModSpec.recipes 消费测试（通过 modRecipeToDatapackRecipe 转换）=====

  it('消费 ModSpec.recipes：crafting_shapeless 转换并生成 JSON', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        recipes: [
          ModRecipeSpec.parse({
            recipeId: 'mod_shapeless_recipe',
            recipeType: 'crafting_shapeless',
            inputs: [
              { item: 'minecraft:iron_ingot', count: 1, slot: '' },
              { item: 'minecraft:stick', count: 1, slot: '' },
            ],
            output: 'minecraft:iron_pickaxe',
            outputCount: 1,
            cookTime: 200,
            experience: 0,
            pattern: [],
          }),
        ],
      }) as any,
    );
    const recipe = result.files.find(
      (f) => f.path === 'data/my_pack/recipe/mod_shapeless_recipe.json',
    );
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed.type).toBe('minecraft:crafting_shapeless');
    // datapack-generator 把 ingredients 数组包装成 [{item|tag: ...}] 形式（1.20.5+ 格式）
    expect(parsed.ingredients).toEqual([
      { item: 'minecraft:iron_ingot' },
      { item: 'minecraft:stick' },
    ]);
    expect(parsed.result.id).toBe('minecraft:iron_pickaxe');
    expect(parsed.result.count).toBe(1);
  });

  it('消费 ModSpec.recipes：crafting_shaped 转换并生成 pattern + key', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        recipes: [
          ModRecipeSpec.parse({
            recipeId: 'mod_shaped_recipe',
            recipeType: 'crafting_shaped',
            inputs: [
              { item: 'minecraft:diamond', count: 3, slot: 'D' },
              { item: 'minecraft:stick', count: 2, slot: 'S' },
            ],
            output: 'minecraft:diamond_pickaxe',
            outputCount: 1,
            cookTime: 200,
            experience: 0,
            pattern: ['DDD', ' S ', ' S '],
          }),
        ],
      }) as any,
    );
    const recipe = result.files.find(
      (f) => f.path === 'data/my_pack/recipe/mod_shaped_recipe.json',
    );
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed.type).toBe('minecraft:crafting_shaped');
    expect(parsed.pattern).toEqual(['DDD', ' S ', ' S ']);
    expect(parsed.key).toEqual({
      D: { item: 'minecraft:diamond' },
      S: { item: 'minecraft:stick' },
    });
    expect(parsed.result.id).toBe('minecraft:diamond_pickaxe');
  });

  it('消费 ModSpec.recipes：smelting 转换并生成 ingredient + cookingtime', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        recipes: [
          ModRecipeSpec.parse({
            recipeId: 'mod_smelting_recipe',
            recipeType: 'smelting',
            inputs: [{ item: 'minecraft:raw_iron', count: 1, slot: '' }],
            output: 'minecraft:iron_ingot',
            outputCount: 1,
            cookTime: 150,
            experience: 0.7,
            pattern: [],
          }),
        ],
      }) as any,
    );
    const recipe = result.files.find(
      (f) => f.path === 'data/my_pack/recipe/mod_smelting_recipe.json',
    );
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed.type).toBe('minecraft:smelting');
    expect(parsed.ingredient.item).toBe('minecraft:raw_iron');
    expect(parsed.cookingtime).toBe(150);
    expect(parsed.experience).toBe(0.7);
  });

  it('消费 ModSpec.recipes：stonecutting 转换并生成 source → ingredient', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        recipes: [
          ModRecipeSpec.parse({
            recipeId: 'mod_stonecutting_recipe',
            recipeType: 'stonecutting',
            inputs: [{ item: 'minecraft:stone', count: 1, slot: '' }],
            output: 'minecraft:stone_brick_stairs',
            outputCount: 1,
            cookTime: 200,
            experience: 0,
            pattern: [],
          }),
        ],
      }) as any,
    );
    const recipe = result.files.find(
      (f) => f.path === 'data/my_pack/recipe/mod_stonecutting_recipe.json',
    );
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed.type).toBe('minecraft:stonecutting');
    // datapack-generator 用 r.source ?? r.ingredients?.[0] 作为 ingredient.item（1.20.5+ 格式）
    expect(parsed.ingredient.item).toBe('minecraft:stone');
    expect(parsed.result).toBe('minecraft:stone_brick_stairs');
    expect(parsed.count).toBe(1);
  });

  it('混合 spec.recipes：同时包含 datapack RecipeSpec 与 ModRecipeSpec 都能生成 JSON', async () => {
    const result = await gen.generate(
      makeCtx({
        packId: 'my_pack',
        recipes: [
          // datapack 格式（原有行为）
          RecipeSpec.parse({
            id: 'datapack_style_recipe',
            type: 'crafting_shapeless',
            result: 'minecraft:emerald',
            count: 1,
            ingredients: ['minecraft:diamond'],
          }),
          // ModSpec 格式（新增行为，经转换）
          ModRecipeSpec.parse({
            recipeId: 'mod_style_recipe',
            recipeType: 'crafting_shapeless',
            inputs: [{ item: 'minecraft:iron_ingot', count: 1, slot: '' }],
            output: 'minecraft:iron_block',
            outputCount: 1,
            cookTime: 200,
            experience: 0,
            pattern: [],
          }),
        ],
      }) as any,
    );
    const datapackStyle = result.files.find(
      (f) => f.path === 'data/my_pack/recipe/datapack_style_recipe.json',
    );
    const modStyle = result.files.find(
      (f) => f.path === 'data/my_pack/recipe/mod_style_recipe.json',
    );
    expect(datapackStyle).toBeDefined();
    expect(modStyle).toBeDefined();
    expect(JSON.parse(datapackStyle!.content).result.id).toBe('minecraft:emerald');
    expect(JSON.parse(modStyle!.content).result.id).toBe('minecraft:iron_block');
  });
});
