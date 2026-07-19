import { describe, it, expect } from 'vitest';
import { QuiltAdapter } from './quilt-adapter.js';
import { ModSpec as ModSpecSchema } from '@mc-creator/shared';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = ModSpecSchema.parse({
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
});

const CTX: GeneratorContext = {
  loader: 'quilt',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('QuiltAdapter 元数据与构建脚本', () => {
  const adapter = new QuiltAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('生成 quilt.mod.json', () => {
    const qmj = files.find((f) => f.path === 'src/main/resources/quilt.mod.json');
    expect(qmj).toBeDefined();
    const json = JSON.parse(qmj!.content);
    // quilt_loader 字段存在
    expect(json.quilt_loader).toBeDefined();
    expect(json.quilt_loader.id).toBe('ruby_tools');
    expect(json.quilt_loader.group).toBe('com.example.ruby_tools');
    expect(json.quilt_loader.version).toBe('${version}');
    // metadata
    expect(json.quilt_loader.metadata.name).toBe('Ruby Tools');
    expect(json.quilt_loader.metadata.description).toBe('Adds ruby tools');
    // intermediate_mappings
    expect(json.quilt_loader.intermediate_mappings).toBe('net.fabricmc:intermediary');
    // depends 数组
    expect(Array.isArray(json.quilt_loader.depends)).toBe(true);
    const depIds = json.quilt_loader.depends.map((d: any) => d.id);
    expect(depIds).toContain('quilt_loader');
    expect(depIds).toContain('minecraft');
    expect(depIds).toContain('quilted_fabric_api');
    // entrypoints
    expect(json.entrypoints.main[0]).toBe('com.example.ruby_tools.RubyToolsMod');
  });

  it('不包含 fabric.mod.json', () => {
    expect(paths).not.toContain('src/main/resources/fabric.mod.json');
  });

  it('build.gradle 含 org.quiltmc.loom 与 officialMojangMappings', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('org.quiltmc.loom');
    expect(bg!.content).toContain('officialMojangMappings');
    // 依赖改为 quilt-loader / quilted-fabric-api
    expect(bg!.content).toContain('org.quiltmc:quilt-loader');
    expect(bg!.content).toContain('org.quiltmc.quilted-fabric-api:quilted-fabric-api');
    // processResources 匹配 quilt.mod.json
    expect(bg!.content).toContain('quilt.mod.json');
    expect(bg!.content).not.toContain('fabric.mod.json');
  });

  it('gradle.properties 含 quilt_loader_version 与 quilt_version', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('quilt_loader_version=0.27.0');
    expect(gp!.content).toContain('quilt_version=11.0.0-alpha.3+1.21.1');
    expect(gp!.content).toContain('minecraft_version=1.21.11');
    expect(gp!.content).toContain('maven_group=com.example.ruby_tools');
  });
});

describe('QuiltAdapter 复用 Fabric 逻辑', () => {
  const adapter = new QuiltAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('loader 标识为 quilt', () => {
    expect(adapter.loader).toBe('quilt');
  });

  it('Java 主类与 Fabric 一致（ModInitializer）', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('implements ModInitializer');
  });

  it('settings.gradle 与 lang/model/meta 资源文件均存在', () => {
    expect(paths).toContain('settings.gradle');
    expect(paths).toContain('src/main/resources/assets/ruby_tools/lang/en_us.json');
    expect(paths).toContain('src/main/resources/assets/ruby_tools/models/item/ruby.json');
    expect(paths).toContain('src/main/resources/ruby_tools_meta.json');
  });
});
