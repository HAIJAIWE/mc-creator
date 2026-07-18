import { describe, it, expect } from 'vitest';
import { NeoForgeAdapter } from './neoforge-adapter.js';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = {
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
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

const CTX: GeneratorContext = {
  loader: 'neoforge',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('NeoForgeAdapter 元数据与构建脚本', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 mods.toml', () => {
    const toml = files.find((f) => f.path === 'src/main/resources/META-INF/mods.toml');
    expect(toml).toBeDefined();
    expect(toml!.content).toContain('modId = "ruby_tools"');
    expect(toml!.content).toContain('displayName = "Ruby Tools"');
    expect(toml!.content).toContain('loaderVersion');
  });

  it('生成 build.gradle 含 net.neoforged.moddev', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('net.neoforged.moddev');
  });

  it('生成 gradle.properties', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('mc_version=1.21.11');
  });
});

describe('NeoForgeAdapter Java 入口与注册代码', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 @Mod 主类', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('package com.example.ruby_tools;');
    expect(main!.content).toContain('@Mod("ruby_tools")');
    expect(main!.content).toContain('IEventBus');
    expect(main!.content).toContain('ModItems.register(modEventBus)');
    expect(main!.content).toContain('ModBlocks.register(modEventBus)');
  });

  it('生成 ModItems（DeferredRegister + 每个物品）', () => {
    const items = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModItems.java',
    );
    expect(items).toBeDefined();
    expect(items!.content).toContain('DeferredRegister');
    expect(items!.content).toContain('RUBY');
    expect(items!.content).toContain('registerSimpleItem("ruby"');
  });

  it('生成 ModBlocks（DeferredRegister + 每个方块）', () => {
    const blocks = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModBlocks.java',
    );
    expect(blocks).toBeDefined();
    expect(blocks!.content).toContain('DeferredRegister');
    expect(blocks!.content).toContain('RUBY_BLOCK');
  });
});

describe('NeoForgeAdapter 资源文件', () => {
  const adapter = new NeoForgeAdapter();
  const files = adapter.translate(CTX);

  it('生成 en_us.json 含物品与方块翻译键', () => {
    const lang = files.find(
      (f) => f.path === 'src/main/resources/assets/ruby_tools/lang/en_us.json',
    );
    expect(lang).toBeDefined();
    const json = JSON.parse(lang!.content);
    expect(json['item.ruby_tools.ruby']).toBe('Ruby');
    expect(json['block.ruby_tools.ruby_block']).toBe('Ruby Block');
  });
});
