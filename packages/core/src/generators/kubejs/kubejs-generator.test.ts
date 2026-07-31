import { describe, it, expect } from 'vitest';
import { KubejsGenerator } from './kubejs-generator.js';
import { createDefaultRegistry } from '../index.js';

const validSpec = {
  packId: 'my_pack',
  packName: 'My Pack',
  description: '测试用 KubeJS 包',
  packFormat: 48,
  mcVersion: '1.21.1',
  recipes: [],
  tags: [],
  events: [],
  tooltips: [],
  registry: [],
  lang: {},
};

describe('KubejsGenerator', () => {
  const gen = new KubejsGenerator();

  it('type 字段为 kubejs', () => {
    expect(gen.type).toBe('kubejs');
  });

  it('loaders 包含 fabric / neoforge / quilt', () => {
    expect(gen.loaders).toEqual(['fabric', 'neoforge', 'quilt']);
    expect(gen.loaders).toHaveLength(3);
  });

  it('versions 包含 1.21.11 与 1.21.1', () => {
    expect(gen.versions).toContain('1.21.11');
    expect(gen.versions).toContain('1.21.1');
  });

  it('空 spec（所有列表为空）只生成 pack.mcmeta，且给出 warning', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('pack.mcmeta');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('未生成任何 KubeJS 脚本');
  });

  it('pack.mcmeta 内容含 pack_format 与 description', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const mcmeta = result.files.find((f) => f.path === 'pack.mcmeta');
    expect(mcmeta).toBeDefined();
    const parsed = JSON.parse(mcmeta!.content);
    expect(parsed.pack.pack_format).toBe(48);
    expect(parsed.pack.description).toBe('测试用 KubeJS 包');
  });

  it('description 为空时 pack.mcmeta 回退到 packName', async () => {
    const ctx = { spec: { ...validSpec, description: '' } } as any;
    const result = await gen.generate(ctx);
    const mcmeta = result.files.find((f) => f.path === 'pack.mcmeta');
    const parsed = JSON.parse(mcmeta!.content);
    expect(parsed.pack.description).toBe('My Pack');
  });

  it('含 shaped recipe 时生成 recipes.js 且使用 event.shaped', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'diamond_block',
          type: 'shaped',
          result: 'minecraft:diamond_block',
          count: 1,
          pattern: ['III', 'III', 'III'],
          key: { I: ['minecraft:diamond'] },
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'kubejs/server_scripts/recipes.js');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('ServerEvents.recipes(event => {');
    expect(recipes!.content).toContain("event.shaped('minecraft:diamond_block'");
    expect(recipes!.content).toContain('"III"');
    expect(recipes!.content).toContain('{I:');
  });

  it('含 shapeless recipe 时生成 event.shapeless 调用', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'shapeless_test',
          type: 'shapeless',
          result: 'minecraft:stick',
          count: 4,
          ingredients: ['minecraft:oak_planks'],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'kubejs/server_scripts/recipes.js');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain(
      "event.shapeless('4x minecraft:stick', ['minecraft:oak_planks']);",
    );
  });

  it('含 smelting / stonecutting recipe 生成对应 event 调用', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'smelting_test',
          type: 'smelting',
          result: 'minecraft:iron_ingot',
          count: 1,
          ingredients: ['minecraft:iron_ore'],
        },
        {
          id: 'stonecutting_test',
          type: 'stonecutting',
          result: 'minecraft:oak_stairs',
          count: 4,
          ingredients: ['minecraft:oak_planks'],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'kubejs/server_scripts/recipes.js');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain(
      "event.smelting('minecraft:iron_ingot', 'minecraft:iron_ore');",
    );
    expect(recipes!.content).toContain(
      "event.stonecutting('minecraft:oak_stairs', 'minecraft:oak_planks').count(4);",
    );
  });

  it('含 custom recipe 时使用 customCode 缩进嵌入', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'custom_test',
          type: 'custom',
          result: 'minecraft:custom',
          count: 1,
          customCode: "event.custom('foo');",
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'kubejs/server_scripts/recipes.js');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain("  event.custom('foo');");
  });

  it('P36: count > 1 时产物用 KubeJS 数量语法 (Nx item)', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'count_test',
          type: 'shapeless',
          result: 'minecraft:stick',
          count: 4,
          ingredients: ['minecraft:oak_planks'],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'kubejs/server_scripts/recipes.js');
    expect(recipes!.content).toContain(
      "event.shapeless('4x minecraft:stick', ['minecraft:oak_planks']);",
    );
  });

  it('P36: smelting 支持 xp/cookingTime 链式调用', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'smelt_xp',
          type: 'smelting',
          result: 'minecraft:iron_ingot',
          count: 1,
          ingredients: ['minecraft:iron_ore'],
          experience: 0.7,
          cookingTime: 300,
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'kubejs/server_scripts/recipes.js');
    expect(recipes!.content).toContain(
      "event.smelting('minecraft:iron_ingot', 'minecraft:iron_ore').xp(0.7).cookingTime(300);",
    );
  });

  it('P36: blasting/smoking 生成 event.blasting/event.smoking', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'blast_test',
          type: 'blasting',
          result: 'minecraft:iron_ingot',
          count: 1,
          ingredients: ['minecraft:iron_ore'],
        },
        {
          id: 'smoke_test',
          type: 'smoking',
          result: 'minecraft:cooked_beef',
          count: 1,
          ingredients: ['minecraft:beef'],
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'kubejs/server_scripts/recipes.js');
    expect(recipes!.content).toContain(
      "event.blasting('minecraft:iron_ingot', 'minecraft:iron_ore');",
    );
    expect(recipes!.content).toContain("event.smoking('minecraft:cooked_beef', 'minecraft:beef');");
  });

  it('含 tags 时生成 tags.js 且支持 replace + values', async () => {
    const spec = {
      ...validSpec,
      tags: [
        {
          id: 'my_tag',
          type: 'item',
          values: ['minecraft:diamond', 'minecraft:emerald'],
          replace: true,
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const tags = result.files.find((f) => f.path === 'kubejs/server_scripts/tags.js');
    expect(tags).toBeDefined();
    expect(tags!.content).toContain('ServerEvents.tags(event => {');
    expect(tags!.content).toContain("event.removeAll('item/my_tag');");
    expect(tags!.content).toContain("event.add('item/my_tag', 'minecraft:diamond');");
    expect(tags!.content).toContain("event.add('item/my_tag', 'minecraft:emerald');");
  });

  it('含 events 时生成 events.js，按 type 路由到 LevelEvents / BlockEvents', async () => {
    const spec = {
      ...validSpec,
      events: [
        {
          id: 'block_click',
          type: 'block.right_click',
          target: 'minecraft:stone',
          handler: 'console.log("clicked")',
        },
        {
          id: 'tick_event',
          type: 'tick',
          target: '',
          handler: 'console.log("tick")',
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const events = result.files.find((f) => f.path === 'kubejs/server_scripts/events.js');
    expect(events).toBeDefined();
    expect(events!.content).toContain("BlockEvents.RightClick('minecraft:stone', event => {");
    expect(events!.content).toContain('LevelEvents.tick(event => {');
  });

  it('含 tooltips 时生成 tooltips.js（含 advanced 模式）', async () => {
    const spec = {
      ...validSpec,
      tooltips: [
        {
          itemId: 'minecraft:diamond',
          lines: ['稀有'],
          advanced: false,
        },
        {
          itemId: 'minecraft:emerald',
          lines: ['高级提示'],
          advanced: true,
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const tips = result.files.find((f) => f.path === 'kubejs/client_scripts/tooltips.js');
    expect(tips).toBeDefined();
    expect(tips!.content).toContain('ItemEvents.tooltip(event => {');
    expect(tips!.content).toContain("event.add('minecraft:diamond', '稀有');");
    expect(tips!.content).toContain(
      "event.addAdvanced('minecraft:emerald', (item, advanced, text) => {",
    );
  });

  it('含 registry 时生成 registry.js，按 type 路由', async () => {
    const spec = {
      ...validSpec,
      registry: [
        { id: 'items', type: 'item', items: ['ruby', 'ruby_dust'], blocks: [] },
        { id: 'blocks', type: 'block', items: [], blocks: ['ruby_ore'] },
        { id: 'fluids', type: 'fluid', items: ['ruby_fluid'], blocks: [] },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const reg = result.files.find((f) => f.path === 'kubejs/startup_scripts/registry.js');
    expect(reg).toBeDefined();
    expect(reg!.content).toContain('StartupEvents.registry(event => {');
    expect(reg!.content).toContain("event.create('ruby');");
    expect(reg!.content).toContain("event.create('ruby_ore').material('rock');");
    expect(reg!.content).toContain("event.create('ruby_fluid').fluid();");
  });

  it('含 lang 时为每个 locale 生成对应语言文件', async () => {
    const spec = {
      ...validSpec,
      lang: {
        en_us: { 'item.my_pack.ruby': 'Ruby' },
        zh_cn: { 'item.my_pack.ruby': '红宝石' },
      },
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const en = result.files.find((f) => f.path === 'kubejs/assets/kubejs/lang/en_us.json');
    const zh = result.files.find((f) => f.path === 'kubejs/assets/kubejs/lang/zh_cn.json');
    expect(en).toBeDefined();
    expect(zh).toBeDefined();
    expect(JSON.parse(en!.content)['item.my_pack.ruby']).toBe('Ruby');
    expect(JSON.parse(zh!.content)['item.my_pack.ruby']).toBe('红宝石');
  });

  it('buildCmd 为空字符串（KubeJS 脚本不需编译）', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.buildCmd).toBe('');
  });

  it('invalid spec（packId 不合法）抛错', async () => {
    const badSpec = { ...validSpec, packId: 'INVALID-CAPS' };
    const ctx = { spec: badSpec } as any;
    await expect(gen.generate(ctx)).rejects.toThrow();
  });

  it('createDefaultRegistry 已注册 kubejs generator', () => {
    const registry = createDefaultRegistry();
    const g = registry.get('kubejs');
    expect(g).toBeDefined();
    expect(g!.type).toBe('kubejs');
  });

  it('通过 registry 生成 kubejs 也能成功', async () => {
    const registry = createDefaultRegistry();
    const g = registry.get('kubejs');
    expect(g).toBeDefined();
    const ctx = { spec: validSpec } as any;
    const result = await g!.generate(ctx);
    expect(result.files).toHaveLength(1); // 空 spec 只生成 pack.mcmeta
  });
});
