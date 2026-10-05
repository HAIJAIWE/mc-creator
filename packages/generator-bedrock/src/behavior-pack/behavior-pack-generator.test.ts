import { describe, it, expect } from 'vitest';
import { BehaviorPackGenerator } from './behavior-pack-generator.js';

const validSpec = {
  packId: 'bp_pack',
  packName: 'BP Pack',
  description: '行为包测试',
  packFormat: 2,
  mcVersion: [1, 21, 0],
  header: {
    name: 'My Behavior Pack',
    description: '一个测试行为包',
    uuid: '12345678-1234-1234-1234-123456789abc',
    version: [1, 0, 0],
    min_engine_version: [1, 21, 0],
  },
  dependencies: [],
  entities: [],
  recipes: [],
  lootTables: [],
};

describe('BehaviorPackGenerator', () => {
  const gen = new BehaviorPackGenerator();

  it('type 字段为 behavior_pack', () => {
    expect(gen.type).toBe('behavior_pack');
  });

  it('loaders 包含 fabric / neoforge', () => {
    expect(gen.loaders).toEqual(['fabric', 'neoforge']);
    expect(gen.loaders).toHaveLength(2);
  });

  it('versions 包含 1.21.11 与 1.21.1', () => {
    expect(gen.versions).toContain('1.21.11');
    expect(gen.versions).toContain('1.21.1');
  });

  it('空 spec（无 entities/recipes/loot）只生成 manifest.json', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('manifest.json');
    expect(result.warnings).toEqual([]);
  });

  it('manifest.json 含 header uuid / modules / dependencies', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const manifest = result.files.find((f) => f.path === 'manifest.json');
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.format_version).toBe(2);
    expect(parsed.header.name).toBe('My Behavior Pack');
    expect(parsed.header.description).toBe('一个测试行为包');
    expect(parsed.header.uuid).toBe('12345678-1234-1234-1234-123456789abc');
    expect(parsed.header.version).toEqual([1, 0, 0]);
    expect(parsed.header.min_engine_version).toEqual([1, 21, 0]);
    expect(parsed.modules).toHaveLength(1);
    expect(parsed.modules[0].type).toBe('data');
    expect(parsed.modules[0].uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(parsed.dependencies).toEqual([]);
  });

  it('header.uuid 为空时 manifest.json 自动生成 uuid v4', async () => {
    const spec = { ...validSpec, header: { ...validSpec.header, uuid: '' } };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const manifest = result.files.find((f) => f.path === 'manifest.json');
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.header.uuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('含 entity 时生成 entities/<id>.json', async () => {
    const spec = {
      ...validSpec,
      entities: [
        {
          identifier: 'bp_pack:test_mob',
          components: { 'minecraft:health': { value: 20, max: 20 } },
          events: { 'minecraft:become_angry': { add: { component_groups: ['angry'] } } },
          description_groups: [],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const entity = result.files.find((f) => f.path === 'entities/test_mob.json');
    expect(entity).toBeDefined();
    const parsed = JSON.parse(entity!.content);
    expect(parsed.format_version).toBe('1.21.0');
    expect(parsed['minecraft:entity'].description.identifier).toBe('bp_pack:test_mob');
    expect(parsed['minecraft:entity'].description.is_spawnable).toBe(true);
    expect(parsed['minecraft:entity'].description.is_summonable).toBe(true);
    expect(parsed['minecraft:entity'].components['minecraft:health'].value).toBe(20);
    expect(parsed['minecraft:entity'].events['minecraft:become_angry']).toBeDefined();
  });

  it('含 entity 且 events 为空时不输出 events 字段', async () => {
    const spec = {
      ...validSpec,
      entities: [
        {
          identifier: 'bp_pack:simple_mob',
          components: { 'minecraft:health': { value: 10 } },
          events: {},
          description_groups: [],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const entity = result.files.find((f) => f.path === 'entities/simple_mob.json');
    expect(entity).toBeDefined();
    const parsed = JSON.parse(entity!.content);
    expect(parsed['minecraft:entity'].events).toBeUndefined();
  });

  it('含 shaped_crafting recipe 时生成 recipes/<id>.json', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          identifier: 'bp_pack:diamond_sword',
          type: 'shaped_crafting',
          result: 'minecraft:diamond_sword',
          count: 1,
          pattern: ['D', 'D', 'S'],
          key: { D: ['minecraft:diamond'], S: ['minecraft:stick'] },
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipe = result.files.find((f) => f.path === 'recipes/diamond_sword.json');
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed.format_version).toBe('1.21.0');
    expect(parsed['minecraft:recipe_shaped'].description.identifier).toBe('bp_pack:diamond_sword');
    expect(parsed['minecraft:recipe_shaped'].tags).toEqual(['crafting_table']);
    expect(parsed['minecraft:recipe_shaped'].pattern).toEqual(['D', 'D', 'S']);
    expect(parsed['minecraft:recipe_shaped'].result.item).toBe('minecraft:diamond_sword');
    expect(parsed['minecraft:recipe_shaped'].result.count).toBe(1);
  });

  it('含 shapeless_crafting recipe 时使用 minecraft:recipe_shapeless', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          identifier: 'bp_pack:shapeless_test',
          type: 'shapeless_crafting',
          result: 'minecraft:stick',
          count: 4,
          items: ['minecraft:oak_planks'],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipe = result.files.find((f) => f.path === 'recipes/shapeless_test.json');
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed['minecraft:recipe_shapeless']).toBeDefined();
    expect(parsed['minecraft:recipe_shapeless'].ingredients).toEqual([
      { item: 'minecraft:oak_planks' },
    ]);
    expect(parsed['minecraft:recipe_shapeless'].result.count).toBe(4);
  });

  it('含 furnace recipe 时使用 minecraft:recipe_furnace', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          identifier: 'bp_pack:furnace_test',
          type: 'furnace',
          result: 'minecraft:iron_ingot',
          count: 1,
          items: ['minecraft:iron_ore'],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipe = result.files.find((f) => f.path === 'recipes/furnace_test.json');
    expect(recipe).toBeDefined();
    const parsed = JSON.parse(recipe!.content);
    expect(parsed['minecraft:recipe_furnace']).toBeDefined();
    expect(parsed['minecraft:recipe_furnace'].tags).toEqual(['furnace']);
    expect(parsed['minecraft:recipe_furnace'].input).toBe('minecraft:iron_ore');
    expect(parsed['minecraft:recipe_furnace'].output).toBe('minecraft:iron_ingot');
  });

  it('含 loot_table 时生成 loot_tables/<path>.json', async () => {
    const spec = {
      ...validSpec,
      lootTables: [
        {
          path: 'entities/zombie',
          pools: [
            {
              rolls: 1,
              entries: [
                { type: 'item', name: 'minecraft:rotten_flesh', weight: 1, count: 1 },
                { type: 'item', name: 'minecraft:iron_ingot', weight: 2, count: 1 },
              ],
            },
          ],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const loot = result.files.find((f) => f.path === 'loot_tables/entities/zombie.json');
    expect(loot).toBeDefined();
    const parsed = JSON.parse(loot!.content);
    expect(parsed.format_version).toBe('1.21.0');
    expect(parsed['minecraft:loot_table'].pools).toHaveLength(1);
    expect(parsed['minecraft:loot_table'].pools[0].rolls).toBe(1);
    expect(parsed['minecraft:loot_table'].pools[0].entries).toHaveLength(2);
    expect(parsed['minecraft:loot_table'].pools[0].entries[0].type).toBe('minecraft:item');
    expect(parsed['minecraft:loot_table'].pools[0].entries[0].name).toBe('minecraft:rotten_flesh');
    expect(parsed['minecraft:loot_table'].pools[0].entries[0].weight).toBe(1);
  });

  it('含完整 spec（entity + recipe + loot）时生成 4 个文件', async () => {
    const spec = {
      ...validSpec,
      entities: [
        {
          identifier: 'bp_pack:mob',
          components: {},
          events: {},
          description_groups: [],
        },
      ],
      recipes: [
        {
          identifier: 'bp_pack:r',
          type: 'shaped_crafting',
          result: 'minecraft:dirt',
          count: 1,
          pattern: ['D'],
          key: { D: ['minecraft:diamond'] },
        },
      ],
      lootTables: [
        {
          path: 'chests/test',
          pools: [{ rolls: 1, entries: [] }],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    expect(result.files).toHaveLength(4);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'entities/mob.json',
      'loot_tables/chests/test.json',
      'manifest.json',
      'recipes/r.json',
    ]);
  });

  it('buildCmd 为空字符串（行为包不需编译）', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.buildCmd).toBe('');
  });
});

/**
 * Script API 集成（设计文档 §6.3）。
 *
 * 与上面那组用例并存：上面的 14 条锁的是「没传 spec.script 时的既有行为」，
 * 这里锁的是「传了 spec.script 之后新产出的结构与自洽性」，两条互不覆盖。
 */
describe('BehaviorPackGenerator · Script API', () => {
  const gen = new BehaviorPackGenerator();

  /** 最小可用 script spec：注册一个 after 事件 */
  const minimalScript = {
    events: [
      { event: 'entitySpawn', phase: 'after', actions: [{ kind: 'add_tag', tag: 'mc_tag' }] },
    ],
  };

  /** 生成并解析 manifest */
  async function genWith(spec: Record<string, unknown>, ctxExtra: Record<string, unknown> = {}) {
    const ctx = { spec: { ...validSpec, ...spec }, ...ctxExtra } as any;
    const result = await gen.generate(ctx);
    const manifestFile = result.files.find((f) => f.path === 'manifest.json');
    return {
      result,
      manifest: JSON.parse(manifestFile!.content),
      paths: result.files.map((f) => f.path),
    };
  }

  it('未传 spec.script 时产物与从前完全一致（无 scripts/、manifest 无 script 模块、无 experiments）', async () => {
    const { result, manifest, paths } = await genWith({});
    expect(paths).toEqual(['manifest.json']);
    expect(result.warnings).toEqual([]);
    expect(result.unimplemented).toBeUndefined();
    expect(manifest.modules).toHaveLength(1);
    expect(manifest.modules[0].type).toBe('data');
    expect(manifest.experiments).toBeUndefined();
    expect(manifest.dependencies).toEqual([]);
  });

  it('传了 spec.script 时产出 scripts/main.js，且 manifest 出现 script 模块', async () => {
    const { paths, manifest } = await genWith({ script: minimalScript });
    expect(paths).toContain('scripts/main.js');
    const scriptModule = manifest.modules.find((m: { type: string }) => m.type === 'script');
    expect(scriptModule).toBeDefined();
    // manifest 的 language 只有 "javascript" 一个合法值；写 typescript 的包不加载
    expect(scriptModule.language).toBe('javascript');
    expect(scriptModule.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(scriptModule.version).toEqual(validSpec.header.version);
  });

  it('⚠️ manifest 的 script.entry 指向真实产出的文件（清单与产物不能对不上）', async () => {
    const { manifest, paths } = await genWith({ script: minimalScript });
    const scriptModule = manifest.modules.find((m: { type: string }) => m.type === 'script');
    expect(scriptModule.entry).toBe('scripts/main.js');
    // 关键断言：entry 命中的路径必须真的在 files 里
    expect(paths).toContain(scriptModule.entry);
    const entryFile = (await genWith({ script: minimalScript })).result.files.find(
      (f) => f.path === 'scripts/main.js',
    );
    expect(entryFile).toBeDefined();
    expect(entryFile!.content.length).toBeGreaterThan(0);
    expect(entryFile!.path).toBe(scriptModule.entry);
  });

  it('script 模块的 uuid 与 data 模块 / header uuid 三者互不相同', async () => {
    const { manifest } = await genWith({ script: minimalScript });
    const uuids = manifest.modules.map((m: { uuid: string }) => m.uuid);
    expect(new Set(uuids).size).toBe(uuids.length);
    expect(uuids).not.toContain(manifest.header.uuid);
  });

  it('experimentalApi=false：is_experimental 为 false、无 experiments 节、依赖不带 -beta', async () => {
    const spec = {
      script: { ...minimalScript, experimentalApi: false },
      entities: [
        {
          identifier: 'bp_pack:exp_mob',
          components: {},
          events: {},
          description_groups: [],
        },
      ],
    };
    const { manifest, result } = await genWith(spec);
    const entity = JSON.parse(
      result.files.find((f) => f.path === 'entities/exp_mob.json')!.content,
    );
    expect(entity['minecraft:entity'].description.is_experimental).toBe(false);
    expect(manifest.experiments).toBeUndefined();
    const serverDep = manifest.dependencies.find(
      (d: { module_name?: string }) => d.module_name === '@minecraft/server',
    );
    expect(serverDep.version).not.toContain('-beta');
  });

  it('experimentalApi=true：is_experimental 与 experiments 节一致，且依赖带 -beta', async () => {
    const spec = {
      script: { ...minimalScript, experimentalApi: true },
      entities: [
        {
          identifier: 'bp_pack:exp_mob',
          components: {},
          events: {},
          description_groups: [],
        },
      ],
    };
    const { manifest, result } = await genWith(spec);
    const entity = JSON.parse(
      result.files.find((f) => f.path === 'entities/exp_mob.json')!.content,
    );
    // 三者同源：is_experimental、experiments 节、-beta 依赖后缀
    expect(entity['minecraft:entity'].description.is_experimental).toBe(true);
    expect(manifest.experiments).toEqual({ gametest: true });
    const serverDep = manifest.dependencies.find(
      (d: { module_name?: string }) => d.module_name === '@minecraft/server',
    );
    expect(serverDep.version).toMatch(/-beta$/);
  });

  it('experimentalApi=true 时 warning 提示「Beta APIs 是世界侧开关、manifest 打不开」', async () => {
    const { result } = await genWith({ script: { ...minimalScript, experimentalApi: true } });
    expect(result.warnings.join('\n')).toContain('Beta APIs');
    expect(result.warnings.join('\n')).toContain('世界侧开关');
  });

  it('is_experimental 不再硬编码：experimentalApi 切换会改变实体产物', async () => {
    const base = {
      entities: [{ identifier: 'bp_pack:m', components: {}, events: {}, description_groups: [] }],
    };
    const off = await genWith({ ...base, script: { ...minimalScript, experimentalApi: false } });
    const on = await genWith({ ...base, script: { ...minimalScript, experimentalApi: true } });
    const read = (r: typeof off) =>
      JSON.parse(r.result.files.find((f) => f.path === 'entities/m.json')!.content)[
        'minecraft:entity'
      ].description.is_experimental;
    expect(read(off)).toBe(false);
    expect(read(on)).toBe(true);
  });

  it('产物 import 的每个模块都在 manifest.dependencies 里有对应 module_name', async () => {
    const spec = {
      script: {
        ...minimalScript,
        forms: [{ kind: 'modal', id: 'confirm', title: '确认', button1: '否', button2: '是' }],
      },
    };
    const { manifest, result } = await genWith(spec, { mcVersion: '1.21.11' });
    const scriptFile = result.files.find((f) => f.path === 'scripts/main.js')!;
    const imported = [...scriptFile.content.matchAll(/from '(@minecraft\/[^']+)'/g)].map(
      (m) => m[1],
    );
    expect(imported.length).toBeGreaterThan(0);
    const declared = manifest.dependencies
      .filter((d: { module_name?: string }) => typeof d.module_name === 'string')
      .map((d: { module_name: string }) => d.module_name);
    // 双向一致：import ⊆ 依赖，且依赖 ⊆ import（不声明用不到的，也不漏声明用到的）
    expect(imported.sort()).toEqual([...declared].sort());
  });

  it('不使用表单时不产生 server-ui 依赖（不声明用不到的模块）', async () => {
    const { manifest } = await genWith({ script: minimalScript });
    expect(
      manifest.dependencies.some(
        (d: { module_name?: string }) => d.module_name === '@minecraft/server-ui',
      ),
    ).toBe(false);
  });

  it('使用表单时 server-ui 既在 import 也在 dependencies', async () => {
    const spec = {
      script: {
        ...minimalScript,
        forms: [{ kind: 'modal', id: 'confirm', title: '确认', button1: '否', button2: '是' }],
      },
    };
    const { manifest, result } = await genWith(spec);
    const scriptFile = result.files.find((f) => f.path === 'scripts/main.js')!;
    expect(scriptFile.content).toContain("from '@minecraft/server-ui'");
    const uiDep = manifest.dependencies.find(
      (d: { module_name?: string }) => d.module_name === '@minecraft/server-ui',
    );
    expect(uiDep).toBeDefined();
    expect(uiDep.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('声明 server-admin / server-net 时不生成假 import，而是登记未实现清单', async () => {
    const spec = {
      script: { ...minimalScript, modules: ['server', 'server-admin', 'server-net'] },
    };
    const { manifest, result } = await genWith(spec);
    const scriptFile = result.files.find((f) => f.path === 'scripts/main.js')!;
    expect(scriptFile.content).not.toContain('@minecraft/server-admin');
    expect(scriptFile.content).not.toContain('@minecraft/server-net');
    // 依赖表里同样不能出现（否则游戏会因无法加载该模块而拒绝整个包）
    expect(
      manifest.dependencies.some((d: { module_name?: string }) =>
        ['@minecraft/server-admin', '@minecraft/server-net'].includes(d.module_name ?? ''),
      ),
    ).toBe(false);
    const types = (result.unimplemented ?? []).map((u) => u.type);
    expect(types).toContain('module:@minecraft/server-admin');
    expect(types).toContain('module:@minecraft/server-net');
    for (const item of result.unimplemented ?? []) {
      if (item.type?.startsWith('module:')) {
        expect(item.reason).toContain('docs/unsupported.md#');
        expect(result.warnings.join('\n')).toContain(item.type);
      }
    }
  });

  it('事件注册带幂等 guard（无重复累积），且产物里没有裸的顶层 subscribe', async () => {
    const { result } = await genWith({
      script: {
        events: [
          { event: 'entitySpawn', phase: 'after', actions: [] },
          { event: 'entitySpawn', phase: 'after', actions: [{ kind: 'add_tag', tag: 't' }] },
          { event: 'tick', phase: 'after', interval: 20, actions: [] },
        ],
      },
    });
    const content = result.files.find((f) => f.path === 'scripts/main.js')!.content;
    expect(content).toContain('let __mcCreatorEventsRegistered = false;');
    expect(content).toContain('if (__mcCreatorEventsRegistered) {');
    expect(content).toContain('__mcCreatorEventsRegistered = true;');
    // 同一事件声明两次也只订阅一次
    expect((content.match(/world\.afterEvents\.entitySpawn\.subscribe/g) ?? []).length).toBe(1);
    // tick 用句柄做二次幂等
    expect(content).toContain('let __mcCreatorTickJob = null;');
    expect(content).toContain('if (__mcCreatorTickJob === null) {');
    // 顶层不得直接 subscribe（否则重载世界会累积监听）
    expect(content).not.toMatch(/^world\.\w+\.\w+\.subscribe/m);
  });

  it('manifest 依赖版本随 ctx.mcVersion 查表变化（§8.4 查表，不写死）', async () => {
    const a = await genWith({ script: minimalScript }, { mcVersion: '1.21.1' });
    const b = await genWith({ script: minimalScript }, { mcVersion: '1.21.11' });
    const ver = (m: { dependencies: Array<{ module_name?: string; version: string }> }) =>
      m.dependencies.find((d) => d.module_name === '@minecraft/server')!.version;
    expect(ver(a.manifest)).toBe('1.13.0');
    expect(ver(b.manifest)).toBe('2.2.0');
    expect(ver(a.manifest)).not.toBe(ver(b.manifest));
  });

  it('spec 显式给的 min_engine_version / packFormat 优先于查表', async () => {
    const { manifest } = await genWith({ script: minimalScript }, { mcVersion: '1.21.11' });
    expect(manifest.header.min_engine_version).toEqual([1, 21, 0]);
    expect(manifest.format_version).toBe(2);
  });

  it('未知 mcVersion 走保守回退且给出警告（不静默选个新版本）', async () => {
    const { result, manifest } = await genWith({ script: minimalScript }, { mcVersion: '9.9.9' });
    expect(result.warnings.join('\n')).toContain('不在 Script API 版本表内');
    const dep = manifest.dependencies.find(
      (d: { module_name?: string }) => d.module_name === '@minecraft/server',
    );
    // 回退到最旧一档（1.2.0），宁可低不取高
    expect(dep.version).toBe('1.2.0');
  });

  it('spec.script 非法时降级为「不生成脚本」+ 警告，不让整个生成抛错', async () => {
    const { result, paths } = await genWith({ script: { events: [{ actions: [] }] } });
    expect(paths).toEqual(['manifest.json']);
    expect(result.warnings.join('\n')).toContain('spec.script 校验失败');
  });

  it('含 Script API 时 JSON 目录产物与既有行为一致（不互相干扰）', async () => {
    const spec = {
      script: minimalScript,
      entities: [
        {
          identifier: 'bp_pack:mob',
          components: { 'minecraft:health': { value: 20 } },
          events: {},
          description_groups: [],
        },
      ],
      recipes: [],
      lootTables: [],
    };
    const { paths } = await genWith(spec);
    expect(paths.sort()).toEqual(['entities/mob.json', 'manifest.json', 'scripts/main.js']);
  });

  it('buildCmd 仍为空字符串（脚本是 JS，不需要编译）', async () => {
    const { result } = await genWith({ script: minimalScript });
    expect(result.buildCmd).toBe('');
  });
});
