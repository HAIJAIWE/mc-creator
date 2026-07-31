import { describe, it, expect } from 'vitest';
import { LauncherGenerator } from './launcher-generator.js';
import { createDefaultRegistry } from '../index.js';

const validSpec = {
  launcherName: 'MyLauncher',
  launcherType: 'hmcl' as const,
  profileName: 'default',
  mcVersion: '1.21.1',
  loader: 'fabric' as const,
  javaPath: '/usr/bin/java',
  jvmArgs: '-Xmx2G -Xms1G',
  memoryMin: 1024,
  memoryMax: 2048,
  accountType: 'offline' as const,
  username: 'Player1',
  uuid: 'abc-123',
  serverAutorun: 'mc.example.com',
  fullscreen: false,
  resolutionWidth: 854,
  resolutionHeight: 480,
};

describe('LauncherGenerator', () => {
  const gen = new LauncherGenerator();

  it('type 字段为 launcher', () => {
    expect(gen.type).toBe('launcher');
  });

  it('loaders 包含所有 5 种 loader', () => {
    expect(gen.loaders).toEqual(['fabric', 'neoforge', 'quilt', 'legacy_fabric', 'vanilla']);
    expect(gen.loaders).toHaveLength(5);
  });

  it('versions 包含 1.21.1', () => {
    expect(gen.versions).toContain('1.21.1');
  });

  it('generate 返回 8 个文件', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.files).toHaveLength(8);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      'README.txt',
      'config/theme.json',
      'launch.ps1',
      'launcher.json',
      'profiles.json',
      'start.bat',
      'start.sh',
      'versions.json',
    ]);
  });

  it('launcher.json 内容正确', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const launcher = result.files.find((f) => f.path === 'launcher.json');
    expect(launcher).toBeDefined();
    const parsed = JSON.parse(launcher!.content);
    expect(parsed.name).toBe('MyLauncher');
    expect(parsed.type).toBe('hmcl');
    expect(parsed.mcVersion).toBe('1.21.1');
    expect(parsed.loader).toBe('fabric');
    expect(parsed.java.path).toBe('/usr/bin/java');
    expect(parsed.java.args).toBe('-Xmx2G -Xms1G');
    expect(parsed.java.memoryMin).toBe(1024);
    expect(parsed.java.memoryMax).toBe(2048);
    expect(parsed.display.fullscreen).toBe(false);
    expect(parsed.display.width).toBe(854);
    expect(parsed.display.height).toBe(480);
    expect(parsed.serverAutorun).toBe('mc.example.com');
  });

  it('profiles.json 是数组且含 1 个 profile', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const profiles = result.files.find((f) => f.path === 'profiles.json');
    expect(profiles).toBeDefined();
    const parsed = JSON.parse(profiles!.content);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].name).toBe('default');
    expect(parsed[0].accountType).toBe('offline');
    expect(parsed[0].username).toBe('Player1');
    expect(parsed[0].uuid).toBe('abc-123');
    expect(parsed[0].mcVersion).toBe('1.21.1');
    expect(parsed[0].loader).toBe('fabric');
  });

  it('start.bat 内容包含 javaPath', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const bat = result.files.find((f) => f.path === 'start.bat');
    expect(bat).toBeDefined();
    expect(bat!.content).toContain('@echo off');
    expect(bat!.content).toContain('/usr/bin/java');
    expect(bat!.content).toContain('-Xmx2048M -Xms1024M');
    expect(bat!.content).toContain('minecraft-1.21.1-fabric.jar');
    expect(bat!.content).toContain('pause');
  });

  it('空 javaPath 时 start.bat 回退到 java', async () => {
    const ctx = { spec: { ...validSpec, javaPath: '' } } as any;
    const result = await gen.generate(ctx);
    const bat = result.files.find((f) => f.path === 'start.bat');
    expect(bat).toBeDefined();
    expect(bat!.content).toContain('"java" -Xmx2048M');
    expect(bat!.content).not.toContain('/usr/bin/java');
  });

  it('空 javaPath 时 start.sh 也回退到 java', async () => {
    const ctx = { spec: { ...validSpec, javaPath: '' } } as any;
    const result = await gen.generate(ctx);
    const sh = result.files.find((f) => f.path === 'start.sh');
    expect(sh).toBeDefined();
    expect(sh!.content).toContain('#!/bin/sh');
    expect(sh!.content).toContain('"java" -Xmx2048M');
  });

  it('launch.ps1 内容正确', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const ps1 = result.files.find((f) => f.path === 'launch.ps1');
    expect(ps1).toBeDefined();
    expect(ps1!.content).toContain('# MyLauncher 启动脚本');
    expect(ps1!.content).toContain('& "/usr/bin/java"');
    expect(ps1!.content).toContain('minecraft-1.21.1-fabric.jar');
  });

  it('versions.json 含 compatibleLoaders 5 项', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const versions = result.files.find((f) => f.path === 'versions.json');
    expect(versions).toBeDefined();
    const parsed = JSON.parse(versions!.content);
    expect(parsed.mcVersion).toBe('1.21.1');
    expect(parsed.loader).toBe('fabric');
    expect(parsed.compatibleLoaders).toEqual([
      'fabric',
      'neoforge',
      'quilt',
      'legacy_fabric',
      'vanilla',
    ]);
    expect(parsed.compatibleLoaders).toHaveLength(5);
  });

  it('config/theme.json 路径正确且内容含 launcherName', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const theme = result.files.find((f) => f.path === 'config/theme.json');
    expect(theme).toBeDefined();
    const parsed = JSON.parse(theme!.content);
    expect(parsed.launcherName).toBe('MyLauncher');
    expect(parsed.launcherType).toBe('hmcl');
    expect(parsed.theme).toBe('default');
    expect(parsed.accentColor).toBe('#4A90E2');
  });

  it('README.txt 包含启动器名和版本信息', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    const readme = result.files.find((f) => f.path === 'README.txt');
    expect(readme).toBeDefined();
    expect(readme!.content).toContain('MyLauncher 启动器配置说明');
    expect(readme!.content).toContain('MC 版本: 1.21.1');
    expect(readme!.content).toContain('加载器: fabric');
    expect(readme!.content).toContain('mc.example.com');
  });

  it('buildCmd 为 java -jar minecraft-<mcVersion>-<loader>.jar', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.buildCmd).toBe('java -jar minecraft-1.21.1-fabric.jar');
  });

  it('warnings 为空数组', async () => {
    const ctx = { spec: validSpec } as any;
    const result = await gen.generate(ctx);
    expect(result.warnings).toEqual([]);
  });

  it('invalid spec（缺少必填 launcherName）抛错', async () => {
    const badSpec = { ...validSpec, launcherName: undefined };
    const ctx = { spec: badSpec } as any;
    await expect(gen.generate(ctx)).rejects.toThrow();
  });

  it('invalid spec（缺少必填 mcVersion）抛错', async () => {
    const badSpec = { ...validSpec, mcVersion: undefined };
    const ctx = { spec: badSpec } as any;
    await expect(gen.generate(ctx)).rejects.toThrow();
  });

  it('createDefaultRegistry 已注册 launcher generator', () => {
    const registry = createDefaultRegistry();
    const gen = registry.get('launcher');
    expect(gen).toBeDefined();
    expect(gen!.type).toBe('launcher');
  });

  it('通过 registry 生成 launcher 也能成功', async () => {
    const registry = createDefaultRegistry();
    const gen = registry.get('launcher');
    expect(gen).toBeDefined();
    const ctx = { spec: validSpec } as any;
    const result = await gen!.generate(ctx);
    expect(result.files).toHaveLength(8);
  });
});
