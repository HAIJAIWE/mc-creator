import { describe, it, expect } from 'vitest';
import { GeneratorRegistry } from './registry.js';
import { createDefaultRegistry } from './index.js';
import type { Generator } from './types.js';
import type { LauncherSpec } from '@mc-creator/shared';

const modGen = (loaders: any[], versions: any[]): Generator => ({
  type: 'mod',
  loaders,
  versions,
  generate: async () => ({ files: [], warnings: [], buildCmd: '' }),
});

describe('GeneratorRegistry', () => {
  it('注册后可按 type 取', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric'], ['1.21.11']));
    expect(r.get('mod')?.type).toBe('mod');
  });

  it('find 匹配 loader+版本', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric', 'neoforge'], ['1.21.11']));
    expect(r.find('mod', 'fabric', '1.21.11')).toBeDefined();
    expect(r.find('mod', 'fabric', '26.1')).toBeUndefined();
  });

  it('list 返回全部', () => {
    const r = new GeneratorRegistry();
    r.register(modGen(['fabric'], ['1.21.11']));
    expect(r.list()).toHaveLength(1);
  });
});

// 端到端集成测试：验证 createDefaultRegistry 注册了全部 7 种 generator，
// 且 launcher generator（P0 修复新增）能正确生成 8 个文件。
describe('createDefaultRegistry 端到端', () => {
  // 注意：此列表必须与 GENERATOR_TYPES（apps/desktop/src/shared/ipc-channels.ts）保持一致。
  const EXPECTED_TYPES = [
    'mod',
    'datapack',
    'modpack',
    'server',
    'resource_pack',
    'skin',
    'launcher',
    'kubejs',
    'crafttweaker',
  ] as const;

  it('注册了全部 9 种 generator', () => {
    const registry = createDefaultRegistry();
    for (const type of EXPECTED_TYPES) {
      expect(registry.get(type), `generator "${type}" should be registered`).toBeDefined();
    }
    expect(registry.list()).toHaveLength(9);
  });

  it('launcher generator 端到端生成 8 个文件', async () => {
    const registry = createDefaultRegistry();
    const gen = registry.get('launcher');
    expect(gen).toBeDefined();

    const spec: LauncherSpec = {
      launcherName: 'TestLauncher',
      launcherType: 'hmcl',
      profileName: 'default',
      mcVersion: '1.21.1',
      loader: 'fabric',
      javaPath: '/usr/bin/java',
      jvmArgs: '-Xmx2G -Xms1G',
      memoryMin: 1024,
      memoryMax: 2048,
      accountType: 'offline',
      username: 'Player1',
      uuid: 'abc-123',
      serverAutorun: 'mc.example.com',
      fullscreen: false,
      resolutionWidth: 854,
      resolutionHeight: 480,
    };

    const result = await gen!.generate({
      loader: 'fabric',
      mcVersion: '1.21.1',
      modId: 'launcher-test',
      spec: spec as any,
      projectPath: '',
    });

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
    expect(result.warnings).toEqual([]);
    expect(result.buildCmd).toBe('java -jar minecraft-1.21.1-fabric.jar');
  });

  it('launcher generator 支持 vanilla loader 且 javaPath 空时回退到 java', async () => {
    const registry = createDefaultRegistry();
    const gen = registry.get('launcher');

    const spec: LauncherSpec = {
      launcherName: 'VanillaLauncher',
      launcherType: 'official',
      profileName: 'default',
      mcVersion: '1.21.1',
      loader: 'vanilla',
      javaPath: '',
      jvmArgs: '-Xmx2G',
      memoryMin: 512,
      memoryMax: 1024,
      accountType: 'offline',
      username: 'Player',
      uuid: '',
      serverAutorun: '',
      fullscreen: true,
      resolutionWidth: 1280,
      resolutionHeight: 720,
    };

    const result = await gen!.generate({
      loader: 'vanilla',
      mcVersion: '1.21.1',
      modId: 'vanilla-test',
      spec: spec as any,
      projectPath: '',
    });

    expect(result.files).toHaveLength(8);
    // javaPath 为空时 start.bat 应回退到 'java'
    const startBat = result.files.find((f) => f.path === 'start.bat');
    expect(startBat?.content).toContain('java -Xmx1024M -Xms512M');
    // buildCmd 应反映 vanilla loader
    expect(result.buildCmd).toBe('java -jar minecraft-1.21.1-vanilla.jar');
  });
});
