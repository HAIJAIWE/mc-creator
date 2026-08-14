import { describe, expect, it } from 'vitest';
import { BehaviorEntityGenerator } from './behavior-entity-generator.js';
import type { BehaviorEntitySpec } from '@mc-creator/shared';

const baseSpec: BehaviorEntitySpec = {
  packId: 'myaddon',
  packName: 'My Addon',
  description: '测试附加包',
  packFormat: 2,
  mcVersion: [1, 21, 0],
  header: {},
  dependencies: [],
  entities: [
    {
      id: 'goblin',
      name: '哥布林',
      health: 24,
      attackDamage: 4,
      movementSpeed: 0.3,
      knockbackResistance: 0,
      fireImmune: false,
      scale: 0.9,
      xp: 8,
      despawn: true,
      hostile: true,
      geometry: 'zombie',
      mainColor: '#4a7c2f',
      accentColor: '#ffdd00',
      goals: [
        { type: 'melee', priority: 3, speedMultiplier: 1.1 },
        { type: 'idle_wander', priority: 5, speedMultiplier: 0.8 },
      ],
      targetTypes: ['player', 'villager'],
      drops: [
        { item: 'minecraft:bone', count: 2, chance: 0.8 },
        { item: 'minecraft:emerald', count: 1, chance: 0.1 },
      ],
      customComponents: [],
      customEvents: {},
    },
  ],
  lang: {
    en_US: { 'entity.myaddon:goblin.name': 'Goblin' },
  },
};

async function run(spec: BehaviorEntitySpec) {
  const gen = new BehaviorEntityGenerator();
  return gen.generate({ spec: spec as never } as never);
}

describe('BehaviorEntityGenerator', () => {
  it('outputs manifest with header/modules/dependencies', async () => {
    const { files } = await run(baseSpec);
    const manifest = JSON.parse(files.find((f) => f.path === 'manifest.json')!.content);
    expect(manifest.format_version).toBe(2);
    expect(manifest.header.name).toBe('My Addon');
    expect(manifest.header.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(manifest.modules[0].type).toBe('data');
    expect(manifest.dependencies).toEqual([]);
  });

  it('generates behavior file with base components', async () => {
    const { files } = await run(baseSpec);
    const raw = files.find((f) => f.path === 'entities/goblin.behavior.json')!.content;
    const json = JSON.parse(raw);
    expect(json.format_version).toBe('1.21.0');
    const entity = json['minecraft:entity'];
    expect(entity.description.identifier).toBe('myaddon:goblin');
    expect(entity.description.is_spawnable).toBe(true);
    const c = entity.components;
    expect(c['minecraft:health']).toEqual({ value: 24, max: 24 });
    expect(c['minecraft:attack']).toEqual({ damage: 4 });
    expect(c['minecraft:movement']).toEqual({ value: 0.3 });
    expect(c['minecraft:scale']).toEqual({ value: 0.9 });
    expect(c['minecraft:collision_box']).toEqual({ width: 0.54, height: 1.62 });
    expect(c['minecraft:fire_immune']).toBeUndefined();
    expect(c['minecraft:experience_reward']).toEqual({ on_death: 8 });
  });

  it('maps goals to behavior components', async () => {
    const { files } = await run(baseSpec);
    const c = JSON.parse(files.find((f) => f.path === 'entities/goblin.behavior.json')!.content)[
      'minecraft:entity'
    ].components;
    expect(c['minecraft:behavior.melee_attack']).toEqual({
      priority: 3,
      speed_multiplier: 1.1,
      track_target: true,
      require_complete_path: false,
    });
    expect(c['minecraft:behavior.random_stroll']).toEqual({
      priority: 5,
      speed_multiplier: 0.8,
    });
  });

  it('adds shooter + ranged_attack when ranged goal present', async () => {
    const { files } = await run({
      ...baseSpec,
      entities: [
        {
          ...baseSpec.entities[0],
          goals: [
            { type: 'ranged', priority: 2, speedMultiplier: 1, attackRange: 24, attackInterval: 3 },
          ],
        },
      ],
    });
    const c = JSON.parse(files.find((f) => f.path === 'entities/goblin.behavior.json')!.content)[
      'minecraft:entity'
    ].components;
    expect(c['minecraft:shooter']).toEqual({ def: 'minecraft:arrow' });
    expect(c['minecraft:behavior.ranged_attack']).toEqual({
      priority: 2,
      speed_multiplier: 1,
      attack_interval_min: 1.5,
      attack_interval_max: 3,
      attack_radius: 24,
    });
  });

  it('generates nearest_attackable_target from targetTypes for hostile', async () => {
    const { files } = await run(baseSpec);
    const c = JSON.parse(files.find((f) => f.path === 'entities/goblin.behavior.json')!.content)[
      'minecraft:entity'
    ].components;
    const target = c['minecraft:behavior.nearest_attackable_target'];
    expect(target.priority).toBe(2);
    expect(target.entity_types).toHaveLength(2);
    expect(target.entity_types[0].filters.any_of[0].value).toBe('player');
    expect(target.entity_types[0].max_dist).toBe(16);
  });

  it('omits attack target when non-hostile or zero damage', async () => {
    const { files } = await run({
      ...baseSpec,
      entities: [{ ...baseSpec.entities[0], hostile: false }],
    });
    const c = JSON.parse(files.find((f) => f.path === 'entities/goblin.behavior.json')!.content)[
      'minecraft:entity'
    ].components;
    expect(c['minecraft:behavior.nearest_attackable_target']).toBeUndefined();
  });

  it('merges customComponents with override warning', async () => {
    const { files, warnings } = await run({
      ...baseSpec,
      entities: [
        {
          ...baseSpec.entities[0],
          customComponents: [{ 'minecraft:attack': { damage: 99 } }],
        },
      ],
    });
    const c = JSON.parse(files.find((f) => f.path === 'entities/goblin.behavior.json')!.content)[
      'minecraft:entity'
    ].components;
    expect(c['minecraft:attack']).toEqual({ damage: 99 });
    expect(warnings.some((w) => w.includes('覆盖了组件 minecraft:attack'))).toBe(true);
  });

  it('merges customEvents into events', async () => {
    const { files } = await run({
      ...baseSpec,
      entities: [
        {
          ...baseSpec.entities[0],
          customEvents: {
            'myaddon:on_spawn': { add: { component_groups: ['minecraft:variant1'] } },
          },
        },
      ],
    });
    const json = JSON.parse(files.find((f) => f.path === 'entities/goblin.behavior.json')!.content);
    expect(json['minecraft:entity'].events).toEqual({
      'myaddon:on_spawn': { add: { component_groups: ['minecraft:variant1'] } },
    });
  });

  it('generates client_entity with geometry, textures and spawn egg', async () => {
    const { files } = await run(baseSpec);
    const json = JSON.parse(
      files.find((f) => f.path === 'entity/goblin.client_entity.json')!.content,
    );
    const desc = json['minecraft:client_entity'].description;
    expect(desc.identifier).toBe('myaddon:goblin');
    expect(desc.geometry.default).toBe('geometry.zombie');
    expect(desc.textures.default).toBe('textures/entity/goblin');
    expect(desc.spawn_egg).toEqual({ base_color: '#4a7c2f', overlay_color: '#ffdd00' });
  });

  it('generates 64x64 entity texture PNG', async () => {
    const { files } = await run(baseSpec);
    const buf = files.find((f) => f.path === 'textures/entity/goblin.png')!;
    expect(buf.content.startsWith('iVBOR')).toBe(true);
    const png = Buffer.from(buf.content, 'base64');
    const ihdr = png.subarray(16, 24);
    expect(ihdr.readUInt32BE(0)).toBe(64);
    expect(ihdr.readUInt32BE(4)).toBe(64);
  });

  it('generates loot table for drops', async () => {
    const { files } = await run(baseSpec);
    const json = JSON.parse(
      files.find((f) => f.path === 'loot_tables/entities/goblin.json')!.content,
    );
    expect(json.pools[0].entries).toHaveLength(2);
    expect(json.pools[0].entries[0].name).toBe('minecraft:bone');
    expect(json.pools[0].entries[0].functions[0].count).toEqual({ min: 1, max: 2 });
    expect(json.pools[0].entries[1].weight).toBe(90);
  });

  it('skips loot table when no drops', async () => {
    const { files } = await run({
      ...baseSpec,
      entities: [{ ...baseSpec.entities[0], drops: [] }],
    });
    expect(files.find((f) => f.path === 'loot_tables/entities/goblin.json')).toBeUndefined();
  });

  it('generates lang files with generated + user entries', async () => {
    const { files } = await run(baseSpec);
    const zh = files.find((f) => f.path === 'texts/zh_CN.lang')!.content;
    expect(zh).toContain('entity.myaddon:goblin.name=哥布林');
    const en = files.find((f) => f.path === 'texts/en_US.lang')!.content;
    expect(en).toContain('entity.myaddon:goblin.name=Goblin');
  });

  it('adds warning when no entities defined', async () => {
    const { warnings } = await run({ ...baseSpec, entities: [] });
    expect(warnings.some((w) => w.includes('未生成任何实体'))).toBe(true);
  });
});
