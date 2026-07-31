import { describe, it, expect } from 'vitest';
import { FabricAdapter } from './fabric-adapter.js';
import { ModGenerator } from './mod-generator.js';
import { BuildCache } from '../../builder/BuildCache.js';
import { ModSpec as ModSpecSchema } from '@mc-creator/shared';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

// === 测试用 spec 构造器 ===

function makeSpec(overrides: Record<string, unknown> = {}): ModSpec {
  // 先构造完整对象再 parse，确保覆盖的 items/blocks 也经过 Zod 默认值填充
  const base = {
    modId: 'ruby_tools',
    version: '1.0.0',
    name: 'Ruby Tools',
    description: 'Incremental build test',
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
  };
  return ModSpecSchema.parse({ ...base, ...overrides });
}

function makeCtx(spec: ModSpec): GeneratorContext {
  return {
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: spec.modId,
    spec,
    projectPath: '/proj',
  };
}

// === FabricAdapter.translateWithCache 测试 ===

describe('FabricAdapter P1-4 增量构建（translateWithCache）', () => {
  const adapter = new FabricAdapter();

  it('首次构建：所有类别重新生成，cached=0', () => {
    const ctx = makeCtx(makeSpec());
    const cache = new BuildCache();
    const result = adapter.translateWithCache(ctx, cache);

    expect(result.stats.cached).toBe(0);
    expect(result.stats.regenerated).toBe(result.stats.total);
    expect(result.stats.filesTotal).toBeGreaterThan(0);
    expect(result.files.length).toBe(result.stats.filesTotal);
  });

  it('二次构建（spec 未变）：所有类别命中缓存，regenerated=0', () => {
    const ctx = makeCtx(makeSpec());
    const cache = new BuildCache();

    // 首次构建
    const first = adapter.translateWithCache(ctx, cache);
    expect(first.stats.regenerated).toBe(first.stats.total);

    // 二次构建（复用同一 cache，spec 未变）
    const second = adapter.translateWithCache(ctx, cache);
    expect(second.stats.cached).toBe(second.stats.total);
    expect(second.stats.regenerated).toBe(0);

    // 文件内容与首次完全一致
    expect(second.files).toEqual(first.files);
    // 文件级增量：所有文件内容未变
    expect(second.stats.filesUnchanged).toBe(second.files.length);
  });

  it('修改单个 item：仅 items 类别重新生成，其他命中', () => {
    const baseSpec = makeSpec();
    const cache = new BuildCache();

    // 首次构建
    adapter.translateWithCache(makeCtx(baseSpec), cache);

    // 修改 item 名称（只影响 items / lang / models / metaJson 类别）
    const modifiedSpec = makeSpec({
      items: [
        {
          id: 'ruby',
          name: 'Ruby Renamed', // 改名
          maxStackSize: 64,
          rarity: 'common',
          maxDamage: 0,
          fuelTick: 0,
          lore: '',
        },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(modifiedSpec), cache);

    // items 重新生成（name 变了）
    // lang 重新生成（item name 变了）
    // models 重新生成？不，models 只依赖 modId + item id，id 没变 → 命中
    // metaJson 重新生成？metaJson 不含 item name，只含 rarity/maxDamage 等 → 命中
    // 所以只有 items + lang 重新生成
    expect(result.stats.regenerated).toBe(2);
    expect(result.stats.cached).toBe(result.stats.total - 2);

    // 验证 ModItems.java 仍是 1 个文件（id 没变，只是内容变了）
    const modItems = result.files.find((f) => f.path.endsWith('ModItems.java'));
    expect(modItems).toBeDefined();
  });

  it('修改 item 的 maxDamage：items + metaJson 重新生成', () => {
    const baseSpec = makeSpec();
    const cache = new BuildCache();
    adapter.translateWithCache(makeCtx(baseSpec), cache);

    // 修改 maxDamage（影响 items 类别 + metaJson 类别，metaJson 含 maxDamage）
    const modifiedSpec = makeSpec({
      items: [
        {
          id: 'ruby',
          name: 'Ruby',
          maxStackSize: 64,
          rarity: 'common',
          maxDamage: 100, // 改了
          fuelTick: 0,
          lore: '',
        },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(modifiedSpec), cache);
    // items 重新生成 + metaJson 重新生成
    expect(result.stats.regenerated).toBe(2);
  });

  it('修改单个 block：blocks 类别重新生成，items 命中', () => {
    const baseSpec = makeSpec();
    const cache = new BuildCache();
    adapter.translateWithCache(makeCtx(baseSpec), cache);

    const modifiedSpec = makeSpec({
      blocks: [
        {
          id: 'ruby_block',
          name: 'Ruby Block',
          material: 'metal',
          hardness: 10.0, // 改了
          miningLevel: 0,
          lightLevel: 0,
          resistance: 6.0,
          soundType: 'stone',
          dropSelf: true,
          dropItem: '',
        },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(modifiedSpec), cache);
    // blocks 重新生成（hardness 变了）
    // 其他类别（items 等）命中
    expect(result.stats.regenerated).toBeGreaterThanOrEqual(1);
    expect(result.stats.cached).toBeGreaterThan(0);
  });

  it('新增 recipe：recipes 类别从无到有重新生成 + mainClass 重新生成', () => {
    const baseSpec = makeSpec({ recipes: [] });
    const cache = new BuildCache();
    adapter.translateWithCache(makeCtx(baseSpec), cache);

    // 新增 recipe（recipes 从空到非空 → mainClass 的 initCalls 变化）
    const modifiedSpec = makeSpec({
      recipes: [
        {
          recipeId: 'ruby_recipe',
          recipeType: 'crafting_shaped',
          inputs: [{ item: 'minecraft:stick', count: 1, slot: 'A' }],
          output: 'ruby',
          outputCount: 1,
          cookTime: 200,
          experience: 0,
          pattern: ['A'],
        },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(modifiedSpec), cache);

    // recipes 重新生成（从空到非空）
    // mainClass 重新生成（initCalls 多了 ModRecipes.initialize()）
    expect(result.stats.regenerated).toBeGreaterThanOrEqual(2);

    // 应生成 ModRecipes.java
    const modRecipes = result.files.find((f) => f.path.endsWith('ModRecipes.java'));
    expect(modRecipes).toBeDefined();
  });

  it('新增 event：events 类别从无到有 + mainClass 重新生成', () => {
    const baseSpec = makeSpec();
    const cache = new BuildCache();
    adapter.translateWithCache(makeCtx(baseSpec), cache);

    const modifiedSpec = makeSpec({
      eventHandlers: [
        {
          handlerId: 'evt_1',
          eventType: 'player_join',
          eventArgs: {},
          conditionIds: [],
          actionIds: [],
          procedureCallIds: [],
        },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(modifiedSpec), cache);

    // events 重新生成 + mainClass 重新生成
    expect(result.stats.regenerated).toBeGreaterThanOrEqual(2);

    const modEvents = result.files.find((f) => f.path.endsWith('ModEvents.java'));
    expect(modEvents).toBeDefined();
    expect(modEvents!.content).toContain('handle_evt_1');
  });

  it('修改 event 类型：events 类别重新生成，其他命中', () => {
    const baseSpec = makeSpec({
      eventHandlers: [
        {
          handlerId: 'evt_1',
          eventType: 'player_join',
          eventArgs: {},
          conditionIds: [],
          actionIds: [],
          procedureCallIds: [],
        },
      ],
    });
    const cache = new BuildCache();
    adapter.translateWithCache(makeCtx(baseSpec), cache);

    // 修改 eventType（不影响 mainClass，因为事件存在性没变）
    const modifiedSpec = makeSpec({
      eventHandlers: [
        {
          handlerId: 'evt_1',
          eventType: 'tick', // 改了
          eventArgs: {},
          conditionIds: [],
          actionIds: [],
          procedureCallIds: [],
        },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(modifiedSpec), cache);
    // 只有 events 重新生成
    expect(result.stats.regenerated).toBe(1);
    expect(result.stats.cached).toBe(result.stats.total - 1);
  });

  it('切换 loader：缓存不串味（缓存键含 loader）', () => {
    const spec = makeSpec();
    const cache = new BuildCache();

    // 用 fabric loader 构建一次
    const fabricCtx: GeneratorContext = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: spec.modId,
      spec,
      projectPath: '/proj',
    };
    adapter.translateWithCache(fabricCtx, cache);

    // 模拟切到 neoforge（用同一 cache，但 FabricAdapter 的 loader 是 fabric）
    // 这里验证缓存键的隔离性：同一类别名 + 不同 loader 应该是不同的缓存键
    const fabricKey = BuildCache.buildKey(spec.modId, 'fabric', 'items');
    const neoforgeKey = BuildCache.buildKey(spec.modId, 'neoforge', 'items');
    expect(fabricKey).not.toBe(neoforgeKey);
    expect(cache.has(fabricKey)).toBe(true);
    expect(cache.has(neoforgeKey)).toBe(false);
  });

  it('translate() 与 translateWithCache(空缓存) 产出相同文件', () => {
    const ctx = makeCtx(makeSpec());

    // 全量 translate
    const fullFiles = adapter.translate(ctx);

    // 增量 translateWithCache（空缓存 = 全量生成）
    const cache = new BuildCache();
    const incremental = adapter.translateWithCache(ctx, cache);

    expect(incremental.files).toEqual(fullFiles);
  });

  it('缓存快照可持久化（JSON 序列化往返）', () => {
    const ctx = makeCtx(makeSpec());
    const cache = new BuildCache();
    adapter.translateWithCache(ctx, cache);

    // 序列化 → 反序列化
    const json = JSON.stringify(cache.snapshot());
    const restored = JSON.parse(json);

    // 用恢复的快照做二次构建，应全部命中
    const cache2 = new BuildCache();
    cache2.load(restored);
    const result = adapter.translateWithCache(ctx, cache2);

    expect(result.stats.cached).toBe(result.stats.total);
    expect(result.stats.regenerated).toBe(0);
  });

  it('文件级增量统计：未变文件被正确识别', () => {
    const baseSpec = makeSpec();
    const cache = new BuildCache();

    // 首次构建
    const first = adapter.translateWithCache(makeCtx(baseSpec), cache);

    // 修改一个不影响的字段（比如 description，只影响 fabricModJson）
    const modifiedSpec = makeSpec({ description: 'changed description' });
    const second = adapter.translateWithCache(makeCtx(modifiedSpec), cache);

    // fabricModJson 重新生成（description 变了）
    expect(second.stats.regenerated).toBeGreaterThanOrEqual(1);
    // 大部分文件内容未变
    expect(second.stats.filesUnchanged).toBeGreaterThan(0);
    expect(second.stats.filesUnchanged).toBeLessThan(second.stats.filesTotal);
  });
});

// === ModGenerator.generateWithCache 端到端测试 ===

describe('ModGenerator P1-4 generateWithCache（端到端）', () => {
  const generator = new ModGenerator();

  it('首次构建返回统计与缓存快照', async () => {
    const ctx = makeCtx(makeSpec());
    const result = await generator.generateWithCache(ctx);

    expect(result.files.length).toBeGreaterThan(0);
    expect(result.stats).toBeDefined();
    expect(result.cacheSnapshot).toBeDefined();
    expect(result.buildCmd).toBe('./gradlew build');
  });

  it('二次构建传入上次快照：全部命中缓存', async () => {
    const ctx = makeCtx(makeSpec());

    // 首次构建
    const first = await generator.generateWithCache(ctx);
    expect(first.stats.regenerated).toBe(first.stats.total);

    // 二次构建传入上次快照
    const second = await generator.generateWithCache(ctx, first.cacheSnapshot);
    expect(second.stats.cached).toBe(second.stats.total);
    expect(second.stats.regenerated).toBe(0);

    // 文件内容一致
    expect(second.files).toEqual(first.files);
  });

  it('修改 spec 后增量构建：部分命中部分重新生成', async () => {
    const baseSpec = makeSpec();
    const ctx = makeCtx(baseSpec);

    // 首次构建
    const first = await generator.generateWithCache(ctx);

    // 修改 item
    const modifiedSpec = makeSpec({
      items: [
        {
          id: 'ruby',
          name: 'Super Ruby',
          maxStackSize: 32,
          rarity: 'rare',
          maxDamage: 50,
          fuelTick: 0,
          lore: '',
        },
      ],
    });

    const second = await generator.generateWithCache(makeCtx(modifiedSpec), first.cacheSnapshot);

    // 部分命中部分重新生成
    expect(second.stats.cached).toBeGreaterThan(0);
    expect(second.stats.regenerated).toBeGreaterThan(0);
    expect(second.stats.cached + second.stats.regenerated).toBe(second.stats.total);
  });
});
