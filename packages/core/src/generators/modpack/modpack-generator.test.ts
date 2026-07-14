import { describe, it, expect } from 'vitest';
import { ModpackGenerator } from './modpack-generator.js';
import type { GeneratorContext, ModpackSpec } from '@mc-creator/shared';

function makeCtx(spec: Partial<ModpackSpec>): GeneratorContext {
  return {
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'test_pack',
    spec: {
      modId: 'test_pack',
      version: '1.0.0',
      name: 'Test',
      description: '',
      items: [],
      blocks: [],
      ...spec,
    } as any,
    projectPath: '',
  };
}

const sampleMods = [
  { name: 'Sodium', projectId: 'proj-1', versionId: 'ver-1', fileName: 'sodium.jar' },
  { name: 'Iris', projectId: 'proj-2', versionId: 'ver-2', fileName: 'iris.jar' },
];

describe('ModpackGenerator', () => {
  const gen = new ModpackGenerator();

  it('生成 Modrinth 格式 modrinth.index.json', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      packName: 'My Pack',
      packVersion: '1.0.0',
      author: 'tester',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: sampleMods,
    }));
    const index = result.files.find((f) => f.path === 'modrinth.index.json');
    expect(index).toBeDefined();
    const parsed = JSON.parse(index!.content);
    expect(parsed.formatVersion).toBe(1);
    expect(parsed.game).toBe('minecraft');
    expect(parsed.name).toBe('My Pack');
    expect(parsed.files.length).toBe(2);
    expect(parsed.files[0].path).toBe('mods/sodium.jar');
    expect(parsed.dependencies.minecraft).toBe('1.21.11');
    expect(parsed.dependencies.fabric).toBe('0.16.9');
  });

  it('生成 CurseForge 格式 manifest.json', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'my_pack',
      packName: 'CF Pack',
      packVersion: '2.0.0',
      author: 'tester',
      format: 'curseforge',
      mcVersion: '1.21.11',
      loader: 'neoforge',
      loaderVersion: '21.1.1',
      mods: sampleMods,
    }));
    const manifest = result.files.find((f) => f.path === 'manifest.json');
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.manifestType).toBe('minecraftModpack');
    expect(parsed.minecraft.version).toBe('1.21.11');
    expect(parsed.minecraft.modLoaders[0].id).toBe('neoforge-21.1.1');
    expect(parsed.files.length).toBe(2);
  });

  it('生成 modlist.html（CurseForge 格式）', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'CF',
      format: 'curseforge',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: sampleMods,
    }));
    const html = result.files.find((f) => f.path === 'modlist.html');
    expect(html).toBeDefined();
    expect(html!.content).toContain('Sodium');
    expect(html!.content).toContain('Iris');
  });

  it('生成 overrides/README.txt', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'Test',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: [],
    }));
    const readme = result.files.find((f) => f.path === 'overrides/README.txt');
    expect(readme).toBeDefined();
    expect(readme!.content).toContain('Test');
  });

  it('空 mod 列表有警告', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'Empty',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: [],
    }));
    expect(result.warnings.length).toBe(1);
    expect(result.warnings[0]).toContain('未包含');
  });

  it('buildCmd 为空', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'T',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: sampleMods,
    }));
    expect(result.buildCmd).toBe('');
  });
});

describe('ModpackGenerator P10：新字段 credits/launchMessage/overrides', () => {
  const gen = new ModpackGenerator();

  it('Modrinth：credits 和 launchMessage 写入 modrinth.index.json', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'WithCredits',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: sampleMods,
      credits: 'Thanks to testers',
      launchMessage: 'Welcome to my pack!',
    }));
    const index = result.files.find((f) => f.path === 'modrinth.index.json');
    expect(index).toBeDefined();
    const parsed = JSON.parse(index!.content);
    expect(parsed.credits).toBe('Thanks to testers');
    expect(parsed.launchMessage).toBe('Welcome to my pack!');
  });

  it('CurseForge：credits 和 launchMessage 写入 manifest.json（自定义字段）', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'CF',
      format: 'curseforge',
      mcVersion: '1.21.11',
      loader: 'neoforge',
      loaderVersion: '21.1.1',
      mods: sampleMods,
      credits: 'CF credits',
      launchMessage: 'CF launch',
    }));
    const manifest = result.files.find((f) => f.path === 'manifest.json');
    expect(manifest).toBeDefined();
    const parsed = JSON.parse(manifest!.content);
    expect(parsed.credits).toBe('CF credits');
    expect(parsed.launchMessage).toBe('CF launch');
  });

  it('空 credits/launchMessage 不写入字段（避免污染输出）', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'NoCredits',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: sampleMods,
    }));
    const index = result.files.find((f) => f.path === 'modrinth.index.json');
    const parsed = JSON.parse(index!.content);
    expect(parsed.credits).toBeUndefined();
    expect(parsed.launchMessage).toBeUndefined();
  });

  it('overrides 文件按 path 加 overrides/ 前缀', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'WithOverrides',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: sampleMods,
      overrides: [
        { path: 'config/example.conf', content: '# example\nkey=value\n' },
        { path: 'options.txt', content: 'version:1' },
      ],
    }));
    const f1 = result.files.find((f) => f.path === 'overrides/config/example.conf');
    const f2 = result.files.find((f) => f.path === 'overrides/options.txt');
    expect(f1).toBeDefined();
    expect(f2).toBeDefined();
    expect(f1!.content).toContain('key=value');
    expect(f2!.content).toBe('version:1');
  });

  it('serverOverrides 文件按 path 加 server-overrides/ 前缀', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'WithServerOverrides',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: sampleMods,
      serverOverrides: [
        { path: 'server.conf', content: 'server-port=25565' },
      ],
    }));
    const f = result.files.find((f) => f.path === 'server-overrides/server.conf');
    expect(f).toBeDefined();
    expect(f!.content).toContain('server-port=25565');
  });

  it('默认空 overrides/serverOverrides 不产生额外文件（除 README）', async () => {
    const result = await gen.generate(makeCtx({
      packId: 'p',
      packName: 'Empty',
      format: 'modrinth',
      mcVersion: '1.21.11',
      loader: 'fabric',
      loaderVersion: '0.16.9',
      mods: sampleMods,
    }));
    // 仅 modrinth.index.json + overrides/README.txt
    expect(result.files).toHaveLength(2);
  });
});
