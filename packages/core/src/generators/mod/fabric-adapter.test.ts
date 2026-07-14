import { describe, it, expect } from 'vitest';
import { FabricAdapter } from './fabric-adapter.js';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = {
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [{ id: 'ruby', name: 'Ruby', maxStackSize: 64 }],
  blocks: [{ id: 'ruby_block', name: 'Ruby Block', material: 'metal', hardness: 5.0 }],
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
