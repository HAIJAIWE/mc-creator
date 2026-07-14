import { describe, it, expect } from 'vitest';
import { NeoForgeAdapter } from './neoforge-adapter.js';
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
