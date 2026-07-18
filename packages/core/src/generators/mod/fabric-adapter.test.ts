import { describe, it, expect } from 'vitest';
import { FabricAdapter } from './fabric-adapter.js';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = {
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [{ id: 'ruby', name: 'Ruby', maxStackSize: 64, rarity: 'common', maxDamage: 0, fuelTick: 0, lore: '' }],
  blocks: [{ id: 'ruby_block', name: 'Ruby Block', material: 'metal', hardness: 5.0, miningLevel: 0, lightLevel: 0, resistance: 6.0, soundType: 'stone', dropSelf: true, dropItem: '' }],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
};

const CTX: GeneratorContext = {
  loader: 'fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('FabricAdapter 元数据与构建脚本', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('生成 fabric.mod.json', () => {
    const fmj = files.find((f) => f.path === 'src/main/resources/fabric.mod.json');
    expect(fmj).toBeDefined();
    const json = JSON.parse(fmj!.content);
    expect(json.id).toBe('ruby_tools');
    expect(json.name).toBe('Ruby Tools');
    expect(json.entrypoints.main[0]).toBe('com.example.ruby_tools.RubyToolsMod');
  });

  it('生成 build.gradle 含 fabric-loom 与 officialMojangMappings', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain("fabric-loom");
    expect(bg!.content).toContain("officialMojangMappings");
  });

  it('生成 settings.gradle 与 gradle.properties', () => {
    expect(paths).toContain('settings.gradle');
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('minecraft_version=1.21.11');
    expect(gp!.content).toContain('maven_group=com.example.ruby_tools');
  });
});

describe('FabricAdapter Java 入口与注册代码', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);

  it('生成 ModInitializer 主类', () => {
    const main = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java');
    expect(main).toBeDefined();
    expect(main!.content).toContain('package com.example.ruby_tools;');
    expect(main!.content).toContain('implements ModInitializer');
    expect(main!.content).toContain('onInitialize()');
    expect(main!.content).toContain('ModItems.initialize()');
    expect(main!.content).toContain('ModBlocks.initialize()');
  });

  it('生成 ModItems（Registry.register + 每个物品）', () => {
    const items = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModItems.java');
    expect(items).toBeDefined();
    expect(items!.content).toContain('Registry.register');
    expect(items!.content).toContain('RUBY');
    expect(items!.content).toContain('"ruby"');
  });

  it('生成 ModBlocks（Registry.register + 每个方块）', () => {
    const blocks = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModBlocks.java');
    expect(blocks).toBeDefined();
    expect(blocks!.content).toContain('Registry.register');
    expect(blocks!.content).toContain('RUBY_BLOCK');
    expect(blocks!.content).toContain('"ruby_block"');
  });
});

describe('FabricAdapter 资源文件', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);

  it('生成 en_us.json 含物品与方块翻译键', () => {
    const lang = files.find((f) => f.path === 'src/main/resources/assets/ruby_tools/lang/en_us.json');
    expect(lang).toBeDefined();
    const json = JSON.parse(lang!.content);
    expect(json['item.ruby_tools.ruby']).toBe('Ruby');
    expect(json['block.ruby_tools.ruby_block']).toBe('Ruby Block');
  });

  it('生成物品模型 JSON', () => {
    const model = files.find((f) => f.path === 'src/main/resources/assets/ruby_tools/models/item/ruby.json');
    expect(model).toBeDefined();
    const json = JSON.parse(model!.content);
    expect(json.parent).toBe('minecraft:item/generated');
  });
});
