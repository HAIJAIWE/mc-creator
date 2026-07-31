import { describe, it, expect } from 'vitest';
import { NeoForgeAdapter } from './neoforge-adapter.js';
import { ModGenerator } from './mod-generator.js';
import { BuildCache } from '../../builder/BuildCache.js';
import { ModSpec as ModSpecSchema } from '@mc-creator/shared';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

// === 测试用 spec 构造器 ===

function makeSpec(overrides: Record<string, unknown> = {}): ModSpec {
  const base = {
    modId: 'neoforge_tools',
    version: '1.0.0',
    name: 'NeoForge Tools',
    description: 'Incremental build test for NeoForge',
    items: [
      {
        id: 'sapphire',
        name: 'Sapphire',
        maxStackSize: 64,
        rarity: 'common',
        maxDamage: 0,
        fuelTick: 0,
        lore: '',
      },
    ],
    blocks: [
      {
        id: 'sapphire_block',
        name: 'Sapphire Block',
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
    loader: 'neoforge',
    mcVersion: '1.21.11',
    modId: spec.modId,
    spec,
    projectPath: '/proj',
  };
}

// === NeoForgeAdapter.translateWithCache 测试 ===

describe('NeoForgeAdapter P1-4 增量构建（translateWithCache）', () => {
  const adapter = new NeoForgeAdapter();

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

  it('修改单个 item：items 类别重新生成，其他命中', () => {
    const baseSpec = makeSpec();
    const cache = new BuildCache();

    // 首次构建
    adapter.translateWithCache(makeCtx(baseSpec), cache);

    // 修改 item 名称
    const modifiedSpec = makeSpec({
      items: [
        {
          id: 'sapphire',
          name: 'Sapphire Renamed',
          maxStackSize: 64,
          rarity: 'common',
          maxDamage: 0,
          fuelTick: 0,
          lore: '',
        },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(modifiedSpec), cache);

    // items + lang + mainClass(因 item name 影响 lang 但不影响 mainClass initCalls) 重新生成
    // 实际：items（name变了）+ lang（name变了）重新生成，metaJson 不受影响（metaJson 不含 item name）
    expect(result.stats.regenerated).toBeGreaterThanOrEqual(2);
    expect(result.stats.cached).toBeGreaterThan(0);
  });

  it('修改 block hardness：blocks 类别重新生成', () => {
    const baseSpec = makeSpec();
    const cache = new BuildCache();
    adapter.translateWithCache(makeCtx(baseSpec), cache);

    const modifiedSpec = makeSpec({
      blocks: [
        {
          id: 'sapphire_block',
          name: 'Sapphire Block',
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
    expect(result.stats.regenerated).toBeGreaterThanOrEqual(1);
    expect(result.stats.cached).toBeGreaterThan(0);
  });

  it('新增 event + procedure：events 类别重新生成 + mainClass', () => {
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
      procedures: [
        {
          procedureId: 'proc_1',
          procedureName: 'myProcedure',
          displayName: 'My Procedure',
          conditionIds: [],
          actionIds: [],
          procedureCallIds: [],
        },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(modifiedSpec), cache);

    // events 重新生成 + mainClass 重新生成（initCalls 多了 ModEvents.initialize()）
    expect(result.stats.regenerated).toBeGreaterThanOrEqual(2);

    const modEvents = result.files.find((f) => f.path.endsWith('ModEvents.java'));
    expect(modEvents).toBeDefined();
    // P1-3：验证 procedure 方法生成
    expect(modEvents!.content).toContain('procedure_myProcedure');
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

  it('AND 条件合取：多条件生成 && 连接而非独立 if', () => {
    const spec = makeSpec({
      eventHandlers: [
        {
          handlerId: 'evt_and',
          eventType: 'player_join',
          eventArgs: {},
          conditionIds: ['cond_1', 'cond_2'],
          actionIds: ['act_1'],
          procedureCallIds: [],
        },
      ],
      conditions: [
        { conditionId: 'cond_1', conditionType: 'has_item', args: {}, invert: false },
        { conditionId: 'cond_2', conditionType: 'is_day', args: {}, invert: true },
      ],
      actions: [{ actionId: 'act_1', actionType: 'spawn_entity', args: {} }],
    });

    const result = adapter.translateWithCache(makeCtx(spec), new BuildCache());
    const modEvents = result.files.find((f) => f.path.endsWith('ModEvents.java'));
    expect(modEvents).toBeDefined();
    // 验证 AND 合取：条件用 && 连接
    expect(modEvents!.content).toContain('&&');
    expect(modEvents!.content).toContain('!check_cond_2(event)');
    // 验证不会有多余的独立 if 块
    expect(modEvents!.content).not.toMatch(
      /if \(check_cond_1\(event\)\)\s*\{[^}]*execute_act_1[^}]*\}\s*if \(!check_cond_2\(event\)\)\s*\{/,
    );
  });

  it('procedure 调用：事件引用过程生成 procedure_<name>() 调用', () => {
    const spec = makeSpec({
      eventHandlers: [
        {
          handlerId: 'evt_proc',
          eventType: 'player_join',
          eventArgs: {},
          conditionIds: [],
          actionIds: [],
          procedureCallIds: ['proc_1'],
        },
      ],
      procedures: [
        {
          procedureId: 'proc_1',
          procedureName: 'giveReward',
          displayName: 'Give Reward',
          conditionIds: ['cond_1'],
          actionIds: ['act_1'],
          procedureCallIds: [],
        },
      ],
      conditions: [{ conditionId: 'cond_1', conditionType: 'has_item', args: {}, invert: false }],
      actions: [{ actionId: 'act_1', actionType: 'spawn_entity', args: {} }],
    });

    const result = adapter.translateWithCache(makeCtx(spec), new BuildCache());
    const modEvents = result.files.find((f) => f.path.endsWith('ModEvents.java'));
    expect(modEvents).toBeDefined();
    // 事件调用过程
    expect(modEvents!.content).toContain('procedure_giveReward(event)');
    // 过程方法含条件合取
    expect(modEvents!.content).toContain('procedure_giveReward');
    expect(modEvents!.content).toContain('check_cond_1(event)');
  });

  it('sanitizeIdent：连续下划线合并、数字前缀加_', () => {
    const spec = makeSpec({
      eventHandlers: [
        {
          handlerId: 'evt@special#1',
          eventType: 'player_join',
          eventArgs: {},
          conditionIds: ['cond__double'],
          actionIds: [],
          procedureCallIds: [],
        },
      ],
      conditions: [
        { conditionId: 'cond__double', conditionType: 'has_item', args: {}, invert: false },
      ],
    });

    const result = adapter.translateWithCache(makeCtx(spec), new BuildCache());
    const modEvents = result.files.find((f) => f.path.endsWith('ModEvents.java'));
    expect(modEvents).toBeDefined();
    // 特殊字符 → 下划线，数字前缀加 _
    expect(modEvents!.content).toContain('handle_evt_special_1');
    // 连续下划线合并
    expect(modEvents!.content).toContain('check_cond_double');
    // 不应出现双下划线
    expect(modEvents!.content).not.toContain('check_cond__double');
  });

  it('缓存键隔离：Fabric 与 NeoForge 缓存不串味', () => {
    const spec = makeSpec();
    const cache = new BuildCache();

    // 用 neoforge loader 构建一次
    const neoforgeCtx = makeCtx(spec);
    adapter.translateWithCache(neoforgeCtx, cache);

    // 验证缓存键隔离
    const neoforgeKey = BuildCache.buildKey(spec.modId, 'neoforge', 'items');
    const fabricKey = BuildCache.buildKey(spec.modId, 'fabric', 'items');
    expect(neoforgeKey).not.toBe(fabricKey);
    expect(cache.has(neoforgeKey)).toBe(true);
    expect(cache.has(fabricKey)).toBe(false);
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

    // 修改一个不影响 items/blocks 的字段（description 只影响 modsToml）
    const modifiedSpec = makeSpec({ description: 'changed description' });
    const second = adapter.translateWithCache(makeCtx(modifiedSpec), cache);

    // modsToml 重新生成
    expect(second.stats.regenerated).toBeGreaterThanOrEqual(1);
    // 大部分文件内容未变
    expect(second.stats.filesUnchanged).toBeGreaterThan(0);
    expect(second.stats.filesUnchanged).toBeLessThan(second.stats.filesTotal);
  });
});

// === ModGenerator.generateWithCache（NeoForge 端到端） ===

describe('ModGenerator P1-4 generateWithCache（NeoForge 端到端）', () => {
  const generator = new ModGenerator();

  it('首次构建返回统计与缓存快照（NeoForge loader）', async () => {
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
          id: 'sapphire',
          name: 'Super Sapphire',
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
