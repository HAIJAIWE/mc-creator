import { describe, it, expect } from 'vitest';
import { LegacyFabricAdapter } from './legacy-fabric-adapter.js';
import { ModGenerator } from './mod-generator.js';
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
  loader: 'legacy_fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('LegacyFabricAdapter 元数据与构建脚本', () => {
  const adapter = new LegacyFabricAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('loader 标识为 legacy_fabric', () => {
    expect(adapter.loader).toBe('legacy_fabric');
  });

  it('生成 fabric.mod.json（路径与 Fabric 一致）', () => {
    expect(paths).toContain('src/main/resources/fabric.mod.json');
  });

  it('不包含 quilt.mod.json', () => {
    expect(paths).not.toContain('src/main/resources/quilt.mod.json');
  });

  it('build.gradle 含 fabric-loom 0.5-SNAPSHOT（旧版本，非 1.7-SNAPSHOT）', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain("fabric-loom");
    expect(bg!.content).toContain('0.5-SNAPSHOT');
    // 不应包含现代 Fabric 的 1.7-SNAPSHOT
    expect(bg!.content).not.toContain('1.7-SNAPSHOT');
  });

  it('build.gradle 用 Yarn mappings（含 yarn，非 officialMojangMappings）', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('yarn');
    // 旧 loom 不支持 officialMojangMappings，不应出现
    expect(bg!.content).not.toContain('officialMojangMappings');
  });

  it('build.gradle 用 Java 8（VERSION_1_8，非 VERSION_21）', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('VERSION_1_8');
    // 不应包含现代 Fabric 的 VERSION_21
    expect(bg!.content).not.toContain('VERSION_21');
  });

  it('gradle.properties 含 loader_version=0.12.12 与 yarn_version=', () => {
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('loader_version=0.12.12');
    expect(gp!.content).toContain('yarn_version=');
    // 1.16.5 是 Legacy Fabric 最常用版本
    expect(gp!.content).toContain('yarn_version=1.16.5+build.1');
  });
});

describe('LegacyFabricAdapter 端到端（通过 ModGenerator）', () => {
  it('ModGenerator.generate({ loader: "legacy_fabric" }) 产出 fabric.mod.json 且 build.gradle 用旧 loom', async () => {
    const gen = new ModGenerator();
    const result = await gen.generate(CTX);
    // fabric.mod.json 存在（与 Fabric 一致）
    expect(result.files.some((f) => f.path === 'src/main/resources/fabric.mod.json')).toBe(true);
    // build.gradle 用旧版本 0.5-SNAPSHOT
    const bg = result.files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('0.5-SNAPSHOT');
  });
});
