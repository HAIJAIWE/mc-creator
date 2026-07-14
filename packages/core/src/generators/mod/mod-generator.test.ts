import { describe, it, expect } from 'vitest';
import { ModGenerator } from './mod-generator.js';
import { ModSpec } from '@mc-creator/shared';
import type { GeneratorContext } from '@mc-creator/shared';
import { fs } from 'memfs';
import { Filesystem } from '../../filesystem/index.js';
import { Orchestrator } from '../../orchestrator/orchestrator.js';
import { MockProvider } from '../../model-provider/mock-provider.js';

const SPEC: ModSpec = {
  modId: 'demo',
  version: '1.0.0',
  name: 'Demo',
  description: 'demo mod',
  items: [{ id: 'ruby', name: 'Ruby', maxStackSize: 64, rarity: 'common', maxDamage: 0, fuelTick: 0, lore: '' }],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
};

describe('ModGenerator', () => {
  const gen = new ModGenerator();

  it('type/loaders/versions 声明正确', () => {
    expect(gen.type).toBe('mod');
    expect(gen.loaders).toEqual(['fabric', 'neoforge', 'quilt']);
    expect(gen.versions).toEqual(['1.21.11', '1.21.1', '26.1']);
  });

  it('fabric ctx → 生成 fabric.mod.json', async () => {
    const ctx: GeneratorContext = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: 'demo',
      spec: SPEC,
      projectPath: '/proj',
    };
    const result = await gen.generate(ctx);
    expect(result.files.some((f) => f.path === 'src/main/resources/fabric.mod.json')).toBe(true);
    expect(result.buildCmd).toBe('./gradlew build');
  });

  it('neoforge ctx → 生成 mods.toml', async () => {
    const ctx: GeneratorContext = {
      loader: 'neoforge',
      mcVersion: '1.21.11',
      modId: 'demo',
      spec: SPEC,
      projectPath: '/proj',
    };
    const result = await gen.generate(ctx);
    expect(result.files.some((f) => f.path === 'src/main/resources/META-INF/mods.toml')).toBe(true);
  });

  it('quilt ctx → 生成 quilt.mod.json', async () => {
    const ctx: GeneratorContext = {
      loader: 'quilt',
      mcVersion: '1.21.11',
      modId: 'demo',
      spec: SPEC,
      projectPath: '/proj',
    };
    const result = await gen.generate(ctx);
    expect(result.files.some((f) => f.path === 'src/main/resources/quilt.mod.json')).toBe(true);
    // 不应出现 fabric.mod.json
    expect(result.files.some((f) => f.path === 'src/main/resources/fabric.mod.json')).toBe(false);
  });
});

describe('ModGenerator 端到端（spec-first 流程）', () => {
  it('Orchestrator 生成 spec → ModGenerator 产出文件 → 写入 memfs', async () => {
    const validSpec = JSON.stringify({
      modId: 'magic_items',
      version: '1.0.0',
      name: 'Magic Items',
      description: 'adds magic',
      items: [{ id: 'magic_dust', name: 'Magic Dust', maxStackSize: 16 }],
      blocks: [],
    });
    const orchestrator = new Orchestrator(new MockProvider(validSpec));
    const spec = await orchestrator.generateModSpec('做一个魔法物品 mod');

    const gen = new ModGenerator();
    const ctx: GeneratorContext = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: spec.modId,
      spec,
      projectPath: '/proj',
    };
    const result = await gen.generate(ctx);

    // 写入 memfs
    const dfs = new Filesystem(fs as any);
    for (const file of result.files) {
      await dfs.writeFile(`/proj/${file.path}`, file.content);
    }

    // 验证关键文件存在
    expect(dfs.exists('/proj/src/main/resources/fabric.mod.json')).toBe(true);
    expect(dfs.exists('/proj/src/main/java/com/example/magic_items/MagicItemsMod.java')).toBe(true);
    expect(dfs.exists('/proj/src/main/java/com/example/magic_items/ModItems.java')).toBe(true);
    expect(dfs.readFile('/proj/src/main/resources/assets/magic_items/lang/en_us.json')).toContain('Magic Dust');
  });
});

describe('ModGenerator 黄金样本快照（防 Adapter 回归）', () => {
  const GOLDEN_SPEC: ModSpec = {
    modId: 'golden',
    version: '1.0.0',
    name: 'Golden',
    description: 'golden mod',
    items: [{ id: 'gold_dust', name: 'Gold Dust', maxStackSize: 64, rarity: 'common', maxDamage: 0, fuelTick: 0, lore: '' }],
    blocks: [{ id: 'gold_block', name: 'Gold Block', material: 'metal', hardness: 3.0, miningLevel: 0, lightLevel: 0, resistance: 6.0, soundType: 'stone', dropSelf: true, dropItem: '' }],
    license: 'MIT',
    authors: [],
    credits: '',
    dependencies: [],
    website: '',
  };

  it('fabric：文件路径列表快照稳定', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: 'golden',
      spec: GOLDEN_SPEC,
      projectPath: '/proj',
    });
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toMatchInlineSnapshot(`
      [
        "build.gradle",
        "gradle.properties",
        "settings.gradle",
        "src/main/java/com/example/golden/GoldenMod.java",
        "src/main/java/com/example/golden/ModBlocks.java",
        "src/main/java/com/example/golden/ModItems.java",
        "src/main/resources/assets/golden/lang/en_us.json",
        "src/main/resources/assets/golden/models/item/gold_dust.json",
        "src/main/resources/fabric.mod.json",
        "src/main/resources/golden_meta.json",
      ]
    `);
  });

  it('neoforge：文件路径列表快照稳定', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: 'neoforge',
      mcVersion: '1.21.11',
      modId: 'golden',
      spec: GOLDEN_SPEC,
      projectPath: '/proj',
    });
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toMatchInlineSnapshot(`
      [
        "build.gradle",
        "gradle.properties",
        "settings.gradle",
        "src/main/java/com/example/golden/GoldenMod.java",
        "src/main/java/com/example/golden/ModBlocks.java",
        "src/main/java/com/example/golden/ModItems.java",
        "src/main/resources/META-INF/mods.toml",
        "src/main/resources/assets/golden/lang/en_us.json",
        "src/main/resources/golden_meta.json",
      ]
    `);
  });
});

describe('ModGenerator P10：_meta.json 包含新字段', () => {
  const META_SPEC: ModSpec = {
    modId: 'meta_mod',
    version: '1.0.0',
    name: 'Meta Mod',
    description: 'meta test',
    license: 'Apache-2.0',
    authors: ['alice', 'bob'],
    credits: 'Thanks to community',
    website: 'https://example.com',
    dependencies: [
      { modId: 'fabric-api', version: '>=0.100', mandatory: true },
      { modId: 'sodium', version: '*', mandatory: false },
    ],
    items: [
      {
        id: 'magic_dust',
        name: 'Magic Dust',
        maxStackSize: 16,
        rarity: 'rare',
        maxDamage: 0,
        fuelTick: 200,
        lore: 'A sparkle of magic',
        food: { hunger: 6, saturation: 0.8 },
      },
    ],
    blocks: [
      {
        id: 'magic_block',
        name: 'Magic Block',
        material: 'metal',
        hardness: 4.5,
        miningLevel: 2,
        lightLevel: 12,
        resistance: 9.5,
        soundType: 'metal',
        dropSelf: false,
        dropItem: 'minecraft:stick',
      },
    ],
  };

  it('fabric：生成 _meta.json 含所有新字段', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: 'meta_mod',
      spec: META_SPEC,
      projectPath: '/proj',
    });
    const meta = result.files.find((f) => f.path === 'src/main/resources/meta_mod_meta.json');
    expect(meta).toBeDefined();
    const parsed = JSON.parse(meta!.content);
    expect(parsed.modId).toBe('meta_mod');
    expect(parsed.license).toBe('Apache-2.0');
    expect(parsed.authors).toEqual(['alice', 'bob']);
    expect(parsed.credits).toBe('Thanks to community');
    expect(parsed.website).toBe('https://example.com');
    expect(parsed.dependencies).toHaveLength(2);
    expect(parsed.dependencies[0]).toEqual({
      modId: 'fabric-api',
      version: '>=0.100',
      mandatory: true,
    });

    // 物品新字段
    const item = parsed.items[0];
    expect(item.id).toBe('magic_dust');
    expect(item.rarity).toBe('rare');
    expect(item.maxDamage).toBe(0);
    expect(item.fuelTick).toBe(200);
    expect(item.lore).toBe('A sparkle of magic');
    expect(item.food).toEqual({ hunger: 6, saturation: 0.8 });

    // 方块新字段
    const block = parsed.blocks[0];
    expect(block.id).toBe('magic_block');
    expect(block.miningLevel).toBe(2);
    expect(block.lightLevel).toBe(12);
    expect(block.resistance).toBe(9.5);
    expect(block.soundType).toBe('metal');
    expect(block.dropSelf).toBe(false);
    expect(block.dropItem).toBe('minecraft:stick');
  });

  it('neoforge：同样生成 _meta.json（内容与 fabric 一致）', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: 'neoforge',
      mcVersion: '1.21.11',
      modId: 'meta_mod',
      spec: META_SPEC,
      projectPath: '/proj',
    });
    const meta = result.files.find((f) => f.path === 'src/main/resources/meta_mod_meta.json');
    expect(meta).toBeDefined();
    const parsed = JSON.parse(meta!.content);
    expect(parsed.license).toBe('Apache-2.0');
    expect(parsed.authors).toEqual(['alice', 'bob']);
  });

  it('旧 spec 无新字段时仍能生成 _meta.json（向后兼容默认值）', async () => {
    // 通过 ModSpec.parse 模拟旧 spec（无任何新字段），zod 会填充默认值
    const parsed = ModSpec.parse({
      modId: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: '',
      items: [{ id: 'ruby', name: 'Ruby', maxStackSize: 64 }],
      blocks: [],
    });

    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: 'demo',
      spec: parsed,
      projectPath: '/proj',
    });
    const meta = result.files.find((f) => f.path === 'src/main/resources/demo_meta.json');
    expect(meta).toBeDefined();
    const metaJson = JSON.parse(meta!.content);
    expect(metaJson.license).toBe('MIT'); // 默认
    expect(metaJson.authors).toEqual([]); // 默认
    expect(metaJson.credits).toBe(''); // 默认
    expect(metaJson.dependencies).toEqual([]); // 默认
    expect(metaJson.items[0].rarity).toBe('common'); // 默认
    expect(metaJson.items[0].food).toBeNull(); // 默认
  });
});
