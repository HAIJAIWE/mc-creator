import { describe, it, expect } from 'vitest';
import { CraftTweakerGenerator } from './crafttweaker-generator.js';
import { createDefaultRegistry } from '../index.js';

const validSpec = {
  packId: 'ct_pack',
  packName: 'CT Pack',
  description: 'CraftTweaker 测试包',
  packFormat: 48,
  mcVersion: '1.21.1',
  recipes: [],
  tags: [],
  events: [],
  tooltips: [],
  lang: {},
};

describe('CraftTweakerGenerator', () => {
  const gen = new CraftTweakerGenerator();

  it('type 字段为 crafttweaker', () => {
    expect(gen.type).toBe('crafttweaker');
  });

  it('loaders 包含 fabric / neoforge / quilt', () => {
    expect(gen.loaders).toEqual(['fabric', 'neoforge', 'quilt']);
    expect(gen.loaders).toHaveLength(3);
  });

  it('versions 包含 1.21.11 与 1.21.1', () => {
    expect(gen.versions).toContain('1.21.11');
    expect(gen.versions).toContain('1.21.1');
  });

  it('空 spec 只生成 pack.mcmeta 且给出 warning', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.files).toHaveLength(1);
    expect(result.files[0].path).toBe('pack.mcmeta');
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('未生成任何 CraftTweaker 脚本');
  });

  it('pack.mcmeta 内容含 pack_format 与 description', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const mcmeta = result.files.find((f) => f.path === 'pack.mcmeta');
    expect(mcmeta).toBeDefined();
    const parsed = JSON.parse(mcmeta!.content);
    expect(parsed.pack.pack_format).toBe(48);
    expect(parsed.pack.description).toBe('CraftTweaker 测试包');
  });

  it('pack_format 按 MC 版本自动映射（1.20.6 → 22）', async () => {
    const ctx = { spec: validSpec, mcVersion: '1.20.6' } as any;
    const result = await gen.generate(ctx);
    const mcmeta = result.files.find((f) => f.path === 'pack.mcmeta');
    expect(JSON.parse(mcmeta!.content).pack.pack_format).toBe(22);
    expect(result.warnings.some((w) => w.includes('pack_format'))).toBe(true);
  });

  it('description 为空时 pack.mcmeta 回退到 packName', async () => {
    const ctx = { spec: { ...validSpec, description: '' } } as any;
    const result = await gen.generate(ctx);
    const mcmeta = result.files.find((f) => f.path === 'pack.mcmeta');
    const parsed = JSON.parse(mcmeta!.content);
    expect(parsed.pack.description).toBe('CT Pack');
  });

  it('含 shaped recipe 时生成 recipes.zs 且使用 recipes.addShaped + <item> 语法', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'diamond_block',
          type: 'shaped',
          result: 'minecraft:diamond_block',
          count: 1,
          pattern: ['I I', 'III', 'I I'],
          key: { I: ['minecraft:diamond'] },
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'scripts/recipes.zs');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('recipes.addShaped(');
    expect(recipes!.content).toContain('<minecraft:diamond_block>');
    expect(recipes!.content).toContain('<minecraft:diamond>');
    expect(recipes!.content).toContain('null'); // pattern 中的空格位置用 null 填充
  });

  it('含 shaped recipe 且 count > 1 时产物用 :count 修饰', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'multi_output',
          type: 'shaped',
          result: 'minecraft:stick',
          count: 4,
          pattern: ['P'],
          key: { P: ['minecraft:oak_planks'] },
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'scripts/recipes.zs');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('<minecraft:stick>:4');
  });

  it('含 shapeless recipe 时使用 recipes.addShapeless', async () => {
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
    const recipes = result.files.find((f) => f.path === 'scripts/recipes.zs');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('recipes.addShapeless(');
    expect(recipes!.content).toContain('<minecraft:stick>:4');
    expect(recipes!.content).toContain('<minecraft:oak_planks>');
  });

  it('含 smelting / stonecutting 时分别使用 furnace / stoneCutter API', async () => {
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
    const recipes = result.files.find((f) => f.path === 'scripts/recipes.zs');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('furnace.addRecipe(');
    expect(recipes!.content).toContain('stoneCutter.addRecipe(');
    expect(recipes!.content).toContain('<minecraft:iron_ore>');
  });

  it('含 custom recipe 时直接使用 customCode', async () => {
    const spec = {
      ...validSpec,
      recipes: [
        {
          id: 'custom_test',
          type: 'custom',
          result: 'minecraft:custom',
          count: 1,
          customCode: '// custom ZenScript code',
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const recipes = result.files.find((f) => f.path === 'scripts/recipes.zs');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('// custom ZenScript code');
  });

  it('P37: smelting 支持 xp/cookTime 四参形式', async () => {
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
    const recipes = result.files.find((f) => f.path === 'scripts/recipes.zs');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain(
      'furnace.addRecipe(<minecraft:iron_ingot>, <minecraft:iron_ore>, 0.7, 300);',
    );
  });

  it('P37: blasting/smoking 分别用 blastFurnace/smoker API', async () => {
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
    const recipes = result.files.find((f) => f.path === 'scripts/recipes.zs');
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain(
      'blastFurnace.addRecipe(<minecraft:iron_ingot>, <minecraft:iron_ore>);',
    );
    expect(recipes!.content).toContain(
      'smoker.addRecipe(<minecraft:cooked_beef>, <minecraft:beef>);',
    );
  });

  it('含 tags 时生成 tags.zs 使用 <tag:items:...> 语法', async () => {
    const spec = {
      ...validSpec,
      tags: [
        {
          id: 'my_tag',
          type: 'item',
          values: ['minecraft:diamond'],
          replace: true,
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const tags = result.files.find((f) => f.path === 'scripts/tags.zs');
    expect(tags).toBeDefined();
    expect(tags!.content).toContain('<tag:items:minecraft:my_tag>');
    expect(tags!.content).toContain('.removeAll();');
    expect(tags!.content).toContain('.add(<minecraft:diamond>);');
  });

  it('含 entity_type tag 时使用 entity_types 复数形式', async () => {
    const spec = {
      ...validSpec,
      tags: [
        {
          id: 'my_entities',
          type: 'entity_type',
          values: ['minecraft:zombie'],
          replace: false,
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const tags = result.files.find((f) => f.path === 'scripts/tags.zs');
    expect(tags).toBeDefined();
    expect(tags!.content).toContain('<tag:entity_types:minecraft:my_entities>');
  });

  it('含 events 时生成 events.zs 使用 events.onXxx 语法', async () => {
    const spec = {
      ...validSpec,
      events: [
        {
          id: 'player_login',
          type: 'player.logged_in',
          target: '',
          handler: 'print("welcome")',
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const events = result.files.find((f) => f.path === 'scripts/events.zs');
    expect(events).toBeDefined();
    expect(events!.content).toContain(
      'events.onPlayerLoggedIn(function(event as PlayerLoggedInEvent) {',
    );
    expect(events!.content).toContain('print("welcome")');
  });

  it('含 tooltips 时生成 tooltips.zs 使用 <item>.addTooltip', async () => {
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
          lines: ['高级'],
          advanced: true,
        },
      ],
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const tips = result.files.find((f) => f.path === 'scripts/tooltips.zs');
    expect(tips).toBeDefined();
    expect(tips!.content).toContain('<minecraft:diamond>.addTooltip("稀有");');
    expect(tips!.content).toContain('<minecraft:emerald>.addAdvancedTooltip("高级");');
  });

  it('含 lang 时为每个 locale 生成 .zs 文件（仅注释形式）', async () => {
    const spec = {
      ...validSpec,
      lang: {
        en_us: { 'item.ct_pack.ruby': 'Ruby' },
        zh_cn: { 'item.ct_pack.ruby': '红宝石' },
      },
    };
    const ctx = { spec } as any;
    const result = await gen.generate(ctx);
    const en = result.files.find((f) => f.path === 'scripts/lang/en_us.zs');
    const zh = result.files.find((f) => f.path === 'scripts/lang/zh_cn.zs');
    expect(en).toBeDefined();
    expect(zh).toBeDefined();
    expect(en!.content).toContain('// item.ct_pack.ruby = "Ruby"');
    expect(zh!.content).toContain('// item.ct_pack.ruby = "红宝石"');
  });

  it('buildCmd 为空字符串（CraftTweaker 脚本不需编译）', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.buildCmd).toBe('');
  });

  it('invalid spec（packId 不合法）抛错', async () => {
    const badSpec = { ...validSpec, packId: 'INVALID-CAPS' };
    const ctx = { spec: badSpec } as any;
    await expect(gen.generate(ctx)).rejects.toThrow();
  });

  it('createDefaultRegistry 已注册 crafttweaker generator', () => {
    const registry = createDefaultRegistry();
    const g = registry.get('crafttweaker');
    expect(g).toBeDefined();
    expect(g!.type).toBe('crafttweaker');
  });

  it('通过 registry 生成 crafttweaker 也能成功', async () => {
    const registry = createDefaultRegistry();
    const g = registry.get('crafttweaker');
    expect(g).toBeDefined();
    const ctx = { spec: validSpec } as any;
    const result = await g!.generate(ctx);
    expect(result.files).toHaveLength(1); // 空 spec 只生成 pack.mcmeta
  });
});
