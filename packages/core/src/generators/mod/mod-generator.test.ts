import { describe, it, expect } from 'vitest';
import { ModGenerator } from './mod-generator.js';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';
import { fs } from 'memfs';
import { Filesystem } from '../../filesystem/index.js';
import { Orchestrator } from '../../orchestrator/orchestrator.js';
import { MockProvider } from '../../model-provider/mock-provider.js';

const SPEC: ModSpec = {
  modId: 'demo',
  version: '1.0.0',
  name: 'Demo',
  description: 'demo mod',
  items: [{ id: 'ruby', name: 'Ruby', maxStackSize: 64 }],
  blocks: [],
};

describe('ModGenerator', () => {
  const gen = new ModGenerator();

  it('type/loaders/versions 声明正确', () => {
    expect(gen.type).toBe('mod');
    expect(gen.loaders).toEqual(['fabric', 'neoforge']);
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
    items: [{ id: 'gold_dust', name: 'Gold Dust', maxStackSize: 64 }],
    blocks: [{ id: 'gold_block', name: 'Gold Block', material: 'metal', hardness: 3.0 }],
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
      ]
    `);
  });
});
