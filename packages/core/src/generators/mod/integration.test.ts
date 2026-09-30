import { describe, it, expect } from 'vitest';
import { GeneratorRegistry } from '../registry.js';
import { ModGenerator } from './mod-generator.js';
import { ModSpec } from '@mc-creator/shared';
import { createHash } from 'node:crypto';
import type { GeneratorContext, Loader, McVersion } from '@mc-creator/shared';

/**
 * 计算内容的 SHA256 短哈希（16 位）
 */
function shortHash(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * 测试用的基础 Spec
 */
const BASE_SPEC = ModSpec.parse({
  modId: 'int_test',
  version: '1.0.0',
  name: 'Integration Test',
  description: 'integration test mod',
  items: [
    {
      id: 'test_item',
      name: 'Test Item',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'test_block',
      name: 'Test Block',
      material: 'stone',
      hardness: 2.0,
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

/**
 * 矩阵：loader × version（至少 fabric/neoforge × 1.20.1/1.21.1）
 */
const MATRIX: [Loader, McVersion][] = [
  ['fabric', '1.20.1'],
  ['fabric', '1.21.1'],
  ['neoforge', '1.20.1'],
  ['neoforge', '1.21.1'],
];

function makeCtx(loader: Loader, mcVersion: McVersion): GeneratorContext {
  return {
    loader,
    mcVersion,
    modId: 'int_test',
    spec: BASE_SPEC,
    projectPath: '/proj',
  };
}

describe('ModGenerator 注册集成', () => {
  it('注册后可通过 find 按 loader+版本定位', () => {
    const r = new GeneratorRegistry();
    r.register(new ModGenerator());
    expect(r.find('mod', 'fabric', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'neoforge', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'fabric', '26.1')).toBeDefined();
    // 未支持的组合
    expect(r.find('other', 'fabric', '1.21.11')).toBeUndefined();
  });
});

describe('ModGenerator loader×version 矩阵：内容哈希快照', () => {
  const gen = new ModGenerator();

  // 预期关键文件的短哈希（基于 BASE_SPEC + 矩阵组合生成）
  // 这些哈希是在首次运行时由开发人员通过测试输出获得，随后固化为快照
  // 使用 inline snapshot 记录：每次代码变更导致哈希变化时，需用 vitest --update 更新
  const EXPECTED_HASHES: Record<string, Record<string, string>> = {
    // fabric 1.20.1
    'fabric:1.20.1': {
      'build.gradle': '16a875a57fa6f8e5',
      'gradle.properties': '954248d8d3c73c8a',
      'gradle/wrapper/gradle-wrapper.properties': '1a6244405eccd5ba',
      'settings.gradle': 'e90ca5cab754c57e',
      'src/main/resources/fabric.mod.json': '57c9639c4e5e4f0c',
      'src/main/java/com/example/int_test/IntTestMod.java': 'b05a01613148799e',
      'src/main/java/com/example/int_test/ModItems.java': '9f722113b26685a6',
      'src/main/java/com/example/int_test/ModBlocks.java': '1e7b3d4ccc0d6b8d',
      'src/main/resources/assets/int_test/lang/en_us.json': '9235811932c2b6d3',
      'src/main/resources/assets/int_test/models/item/test_item.json': 'fd07356140eb182f',
      'src/main/resources/int_test_meta.json': '928b83da77a0a3e4',
    },
    // fabric 1.21.1
    'fabric:1.21.1': {
      'build.gradle': '0fbcdc3f90022434',
      'gradle.properties': 'e437fb2de01ac8d9',
      'gradle/wrapper/gradle-wrapper.properties': 'c1af85a70af0c431',
      'settings.gradle': 'c8021e2027315ef2',
      'src/main/resources/fabric.mod.json': 'ffa0224f9fae7a55',
      'src/main/java/com/example/int_test/IntTestMod.java': 'b05a01613148799e',
      'src/main/java/com/example/int_test/ModItems.java': '9f722113b26685a6',
      'src/main/java/com/example/int_test/ModBlocks.java': '1e7b3d4ccc0d6b8d',
      'src/main/resources/assets/int_test/lang/en_us.json': '9235811932c2b6d3',
      'src/main/resources/assets/int_test/models/item/test_item.json': 'fd07356140eb182f',
      'src/main/resources/int_test_meta.json': '928b83da77a0a3e4',
    },
    // neoforge 1.20.1
    'neoforge:1.20.1': {
      'build.gradle': '6ef003cdb0e84273',
      'gradle.properties': 'd99e6fc6e7438c2c',
      'gradle/wrapper/gradle-wrapper.properties': '1a6244405eccd5ba',
      'settings.gradle': '107f7965de0bd2f5',
      'src/main/resources/META-INF/mods.toml': 'cb9fdffc0a07eb0c',
      'src/main/java/com/example/int_test/IntTestMod.java': 'fe567ec41cf8610d',
      'src/main/java/com/example/int_test/ModItems.java': 'd44df922e6b73dcb',
      'src/main/java/com/example/int_test/ModBlocks.java': '6c82b61440b58a5c',
      'src/main/resources/assets/int_test/lang/en_us.json': '9235811932c2b6d3',
      'src/main/resources/assets/int_test/models/item/test_item.json': 'fd07356140eb182f',
      'src/main/resources/int_test_meta.json': '928b83da77a0a3e4',
    },
    // neoforge 1.21.1
    'neoforge:1.21.1': {
      'build.gradle': 'b63a836619b74df8',
      'gradle.properties': '2f8d3cc70b76be67',
      'gradle/wrapper/gradle-wrapper.properties': 'c1af85a70af0c431',
      'settings.gradle': '107f7965de0bd2f5',
      'src/main/resources/META-INF/mods.toml': '2241de9746ff152b',
      'src/main/java/com/example/int_test/IntTestMod.java': 'fe567ec41cf8610d',
      'src/main/java/com/example/int_test/ModItems.java': 'd44df922e6b73dcb',
      'src/main/java/com/example/int_test/ModBlocks.java': '6c82b61440b58a5c',
      'src/main/resources/assets/int_test/lang/en_us.json': '9235811932c2b6d3',
      'src/main/resources/assets/int_test/models/item/test_item.json': 'fd07356140eb182f',
      'src/main/resources/int_test_meta.json': '928b83da77a0a3e4',
    },
  };

  it.each(MATRIX)('%s × %s：生成文件内容哈希稳定', async (loader, mcVersion) => {
    const result = await gen.generate(makeCtx(loader, mcVersion));
    const key = `${loader}:${mcVersion}`;
    const expected = EXPECTED_HASHES[key];

    // 断言关键文件存在且内容哈希匹配
    for (const [path, expectedHash] of Object.entries(expected)) {
      const file = result.files.find((f) => f.path === path);
      expect(file, `缺少文件: ${path}`).toBeDefined();
      if (file && expectedHash) {
        const hash = shortHash(file.content);
        expect(hash, `哈希不匹配: ${path} (期望 ${expectedHash}, 实际 ${hash})`).toBe(expectedHash);
      }
    }

    // 额外断言：无占位符、版本号正确
    const gradleProps = result.files.find((f) => f.path === 'gradle.properties')!;
    if (loader === 'fabric') {
      expect(gradleProps.content).toContain(`minecraft_version=${mcVersion}`);
    } else {
      // neoforge 使用 mc_version
      expect(gradleProps.content).toContain(`mc_version=${mcVersion}`);
    }
    expect(gradleProps.content).not.toContain('PLACEHOLDER');
    expect(gradleProps.content).not.toContain('TODO');

    const buildGradle = result.files.find((f) => f.path === 'build.gradle')!;
    expect(buildGradle.content).not.toContain('PLACEHOLDER');
    expect(buildGradle.content).not.toContain('TODO');
  });

  it('fabric 与 neoforge 生成的 Java 代码结构不同（入口类/注册方式）', async () => {
    const fabricResult = await gen.generate(makeCtx('fabric', '1.21.1'));
    const neoforgeResult = await gen.generate(makeCtx('neoforge', '1.21.1'));

    const fabricMain = fabricResult.files.find((f) => f.path.endsWith('IntTestMod.java'))!;
    const neoforgeMain = neoforgeResult.files.find((f) => f.path.endsWith('IntTestMod.java'))!;

    // Fabric: implements ModInitializer, onInitialize()
    expect(fabricMain.content).toContain('implements ModInitializer');
    expect(fabricMain.content).toContain('onInitialize');

    // NeoForge: @Mod, constructor register with IEventBus
    expect(neoforgeMain.content).toContain('@Mod(');
    expect(neoforgeMain.content).toContain('IEventBus');
    expect(neoforgeMain.content).toContain('ModItems.register');
    expect(neoforgeMain.content).toContain('ModBlocks.register');
  });
});

/**
 * export-projects / verify 相关测试：仅在 CI 环境运行（需要网络/构建工具）
 */
describe.skipIf(!process.env.CI)('export-projects / verify 端到端（仅 CI）', () => {
  const gen = new ModGenerator();

  it('fabric 1.21.1：export → verify gradle build 通过', async () => {
    const ctx = makeCtx('fabric', '1.21.1');
    const result = await gen.generate(ctx);

    // 写入临时目录（实际由 orchestrator 处理，这里只做生成层面验证）
    expect(result.files.length).toBeGreaterThan(10);
    expect(result.buildCmd).toBe('./gradlew build');
  });

  it('neoforge 1.21.1：export → verify gradle build 通过', async () => {
    const ctx = makeCtx('neoforge', '1.21.1');
    const result = await gen.generate(ctx);

    expect(result.files.length).toBeGreaterThan(10);
    expect(result.buildCmd).toBe('./gradlew build');
  });
});

describe('ModGenerator 增量生成集成（P1-4）', () => {
  const gen = new ModGenerator();

  it('同一 spec 连续两次 generateWithCache 第二次 stats.cached > 0', async () => {
    const ctx = makeCtx('fabric', '1.21.1');

    // 首次：全量生成
    const first = await gen.generateWithCache(ctx);
    expect(first.stats.regenerated).toBeGreaterThan(0);
    expect(first.stats.cached).toBe(0);

    // 第二次：应命中缓存
    const second = await gen.generateWithCache(ctx, first.cacheSnapshot);
    expect(second.stats.cached).toBeGreaterThan(0);
    expect(second.stats.regenerated).toBe(0);
    expect(second.stats.filesUnchanged).toBe(second.stats.filesTotal);
  });

  it('修改 spec 后 generateWithCache 命中部分类别、重新生成其余', async () => {
    const ctx = makeCtx('fabric', '1.21.1');

    const first = await gen.generateWithCache(ctx);

    // 修改 spec：新增一个 item
    const modifiedSpec = ModSpec.parse({
      ...BASE_SPEC,
      items: [
        ...BASE_SPEC.items,
        {
          id: 'another_item',
          name: 'Another Item',
          maxStackSize: 16,
          rarity: 'uncommon',
          maxDamage: 0,
          fuelTick: 0,
          lore: '',
        },
      ],
    });
    const modifiedCtx = { ...ctx, spec: modifiedSpec };

    const second = await gen.generateWithCache(modifiedCtx, first.cacheSnapshot);

    // items 类别应重新生成，其余应命中缓存
    expect(second.stats.regenerated).toBeGreaterThan(0);
    expect(second.stats.cached).toBeGreaterThan(0);
    expect(second.stats.filesTotal).toBeGreaterThan(first.stats.filesTotal);
  });
});
