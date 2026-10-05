const fs = require('fs');
const path = require('path');

// Build the project object programmatically to avoid escaping issues
const fabricModJson = JSON.stringify(
  {
    schemaVersion: 1,
    id: 'demo_mod',
    version: '1.0.0',
    name: 'Demo Mod',
    description: '一个包含示例物品、方块和配方的演示模组',
    authors: ['MC Creator'],
    license: 'MIT',
    environment: 'client',
    entrypoints: { main: ['com.example.demo.DemoMod'] },
    mixins: ['demo_mod.mixins.json'],
    depends: { fabricloader: '>=0.14.0', minecraft: '~1.21.1', 'fabric-api': '*' },
  },
  null,
  2,
);

const lootTableJson = JSON.stringify(
  {
    type: 'minecraft:block',
    pools: [
      {
        rolls: 1,
        entries: [
          {
            type: 'item',
            name: 'demo_mod:ruby',
            functions: [
              {
                function: 'minecraft:set_count',
                count: { min: 1, max: 3 },
              },
            ],
          },
        ],
      },
    ],
  },
  null,
  2,
);

const recipes = {
  ruby_sword: JSON.stringify(
    {
      type: 'minecraft:crafting_shaped',
      pattern: ['R', 'R', 'S'],
      key: { R: { item: 'demo_mod:ruby' }, S: { item: 'minecraft:stick' } },
      result: { id: 'demo_mod:ruby_sword', count: 1 },
    },
    null,
    2,
  ),
  ruby_pickaxe: JSON.stringify(
    {
      type: 'minecraft:crafting_shaped',
      pattern: ['RRR', ' S ', ' S '],
      key: { R: { item: 'demo_mod:ruby' }, S: { item: 'minecraft:stick' } },
      result: { id: 'demo_mod:ruby_pickaxe', count: 1 },
    },
    null,
    2,
  ),
  ruby_block: JSON.stringify(
    {
      type: 'minecraft:crafting_shaped',
      pattern: ['RRR', 'RRR', 'RRR'],
      key: { R: { item: 'demo_mod:ruby' } },
      result: { id: 'demo_mod:ruby_block', count: 1 },
    },
    null,
    2,
  ),
  ruby_block_to_ruby: JSON.stringify(
    {
      type: 'minecraft:crafting_shapeless',
      ingredients: [{ item: 'demo_mod:ruby_block' }],
      result: { id: 'demo_mod:ruby', count: 9 },
    },
    null,
    2,
  ),
};

const demoModJava = `package com.example.demo;

import net.fabricmc.api.ModInitializer;
import net.minecraft.item.Item;
import net.minecraft.block.Block;
import net.minecraft.registry.Registries;
import net.minecraft.registry.Registry;
import net.minecraft.util.Identifier;

public class DemoMod implements ModInitializer {
    public static final String MOD_ID = "demo_mod";
    
    // 物品
    public static final Item RUBY = registerItem("ruby", new Item(new Item.Settings().maxCount(64).rarity(Rarity.UNCOMMON)));
    public static final Item SAPPHIRE = registerItem("sapphire", new Item(new Item.Settings().maxCount(64).rarity(Rarity.RARE)));
    public static final Item RUBY_SWORD = registerItem("ruby_sword", new SwordItem(ToolMaterials.RUBY, 6, -2.4f, new Item.Settings().maxDamage(500).rarity(Rarity.RARE)));
    public static final Item RUBY_PICKAXE = registerItem("ruby_pickaxe", new PickaxeItem(ToolMaterials.RUBY, 4, -2.8f, new Item.Settings().maxDamage(500).rarity(Rarity.RARE)));
    
    // 方块
    public static final Block RUBY_BLOCK = registerBlock("ruby_block", new Block(AbstractBlock.Settings.create().strength(5.0f, 6.0f).sounds(BlockSoundGroup.METAL).requiresTool().luminance(0)));
    public static final Block RUBY_ORE = registerBlock("ruby_ore", new OreBlock(AbstractBlock.Settings.create().strength(3.0f, 3.0f).requiresTool(), UniformIntProvider.create(1, 3)));
    public static final Block DEEPSLATE_RUBY_ORE = registerBlock("deepslate_ruby_ore", new OreBlock(AbstractBlock.Settings.create().strength(4.5f, 4.5f).requiresTool(), UniformIntProvider.create(1, 3)));

    @Override
    public void onInitialize() {
        // 注册物品、方块、配方等
    }

    private static Item registerItem(String name, Item item) {
        return Registry.register(Registries.ITEM, new Identifier(MOD_ID, name), item);
    }

    private static Block registerBlock(String name, Block block) {
        return Registry.register(Registries.BLOCK, new Identifier(MOD_ID, name), block);
    }
}`;

const project = {
  id: 'demo-mod-001',
  name: 'Demo Mod (示例模组)',
  generatorType: 'mod',
  loader: 'fabric',
  mcVersion: '1.21.1',
  description: '一个包含示例物品、方块和配方的演示模组',
  spec: {
    modId: 'demo_mod',
    name: 'Demo Mod',
    version: '1.0.0',
    description: '一个包含示例物品、方块和配方的演示模组',
    authors: ['MC Creator'],
    license: 'MIT',
    environment: 'client',
    entrypoints: { main: ['com.example.demo.DemoMod'] },
    mixins: ['demo_mod.mixins.json'],
    depends: { fabricloader: '>=0.14.0', minecraft: '~1.21.1', 'fabric-api': '*' },
    items: [
      {
        id: 'ruby',
        name: '红宝石',
        maxStackSize: 64,
        rarity: 'uncommon',
        food: { hunger: 2, saturation: 0.3 },
      },
      { id: 'sapphire', name: '蓝宝石', maxStackSize: 64, rarity: 'rare' },
      {
        id: 'ruby_sword',
        name: '红宝石剑',
        maxStackSize: 1,
        maxDamage: 500,
        rarity: 'rare',
        tool: { type: 'sword', miningLevel: 3, speed: 8.0, attackDamage: 6, attackSpeed: 1.6 },
      },
      {
        id: 'ruby_pickaxe',
        name: '红宝石镐',
        maxStackSize: 1,
        maxDamage: 500,
        rarity: 'rare',
        tool: { type: 'pickaxe', miningLevel: 3, speed: 8.0, attackDamage: 4 },
      },
    ],
    blocks: [
      {
        id: 'ruby_block',
        name: '红宝石块',
        material: 'metal',
        hardness: 5.0,
        resistance: 6.0,
        harvestTool: 'pickaxe',
        miningLevel: 2,
        lightLevel: 0,
        soundType: 'metal',
        creativeTab: 'building_blocks',
      },
      {
        id: 'ruby_ore',
        name: '红宝石矿石',
        material: 'stone',
        hardness: 3.0,
        resistance: 3.0,
        harvestTool: 'pickaxe',
        miningLevel: 2,
        creativeTab: 'building_blocks',
      },
      {
        id: 'deepslate_ruby_ore',
        name: '深板岩红宝石矿石',
        material: 'stone',
        hardness: 4.5,
        resistance: 4.5,
        harvestTool: 'pickaxe',
        miningLevel: 2,
        creativeTab: 'building_blocks',
      },
    ],
    recipes: [
      {
        type: 'crafting_shaped',
        pattern: ['R', 'R', 'S'],
        key: { R: 'demo_mod:ruby', S: 'minecraft:stick' },
        result: { id: 'demo_mod:ruby_sword', count: 1 },
      },
      {
        type: 'crafting_shaped',
        pattern: ['RRR', ' S ', ' S '],
        key: { R: 'demo_mod:ruby', S: 'minecraft:stick' },
        result: { id: 'demo_mod:ruby_pickaxe', count: 1 },
      },
      {
        type: 'crafting_shaped',
        pattern: ['RRR', 'RRR', 'RRR'],
        key: { R: 'demo_mod:ruby' },
        result: { id: 'demo_mod:ruby_block', count: 1 },
      },
      {
        type: 'crafting_shapeless',
        ingredients: ['demo_mod:ruby_block'],
        result: { id: 'demo_mod:ruby', count: 9 },
      },
    ],
    lootTables: [
      {
        pool: {
          rolls: 1,
          entries: [
            {
              type: 'item',
              name: 'demo_mod:ruby',
              weight: 1,
              functions: [{ function: 'set_count', count: { min: 1, max: 3 } }],
            },
          ],
        },
      },
    ],
  },
  files: [
    { path: 'fabric.mod.json', content: fabricModJson },
    {
      path: 'src/main/resources/data/demo_mod/loot_tables/blocks/ruby_ore.json',
      content: lootTableJson,
    },
    {
      path: 'src/main/resources/data/demo_mod/recipes/ruby_sword.json',
      content: recipes.ruby_sword,
    },
    {
      path: 'src/main/resources/data/demo_mod/recipes/ruby_pickaxe.json',
      content: recipes.ruby_pickaxe,
    },
    {
      path: 'src/main/resources/data/demo_mod/recipes/ruby_block.json',
      content: recipes.ruby_block,
    },
    {
      path: 'src/main/resources/data/demo_mod/recipes/ruby_block_to_ruby.json',
      content: recipes.ruby_block_to_ruby,
    },
    { path: 'src/main/java/com/example/demo/DemoMod.java', content: demoModJava },
  ],
  createdAt: '2026-10-02T12:00:00.000Z',
  updatedAt: '2026-10-02T12:00:00.000Z',
};

const projectPath = path.join(
  process.env.APPDATA || process.env.USERPROFILE + '/AppData/Roaming',
  'mc-creator',
  'projects',
  'demo-mod-001.json',
);
fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
console.log('Demo project created at:', projectPath);
