import { describe, it, expect } from 'vitest';
import { LauncherSpec } from './launcher-spec.js';

describe('LauncherSpec schema', () => {
  it('最小合法 spec（仅 launcherName + mcVersion）填充默认值', () => {
    const r = LauncherSpec.parse({ launcherName: 'my-launcher', mcVersion: '1.21.1' });
    expect(r.launcherType).toBe('official');
    expect(r.profileName).toBe('default');
    expect(r.loader).toBe('vanilla');
    expect(r.javaPath).toBe('');
    expect(r.jvmArgs).toBe('-Xmx2G -Xms1G');
    expect(r.memoryMin).toBe(1024);
    expect(r.memoryMax).toBe(2048);
    expect(r.accountType).toBe('offline');
    expect(r.username).toBe('Player');
    expect(r.uuid).toBe('');
    expect(r.serverAutorun).toBe('');
    expect(r.fullscreen).toBe(false);
    expect(r.resolutionWidth).toBe(854);
    expect(r.resolutionHeight).toBe(480);
  });

  it('launcherType 枚举校验', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', launcherType: 'unknown' }),
    ).toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', launcherType: 'pcl2' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', launcherType: 'hmcl' }),
    ).not.toThrow();
  });

  it('loader 枚举校验（含 vanilla）', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', loader: 'vanilla' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', loader: 'fabric' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', loader: 'unknown' }),
    ).toThrow();
  });

  it('accountType 枚举校验', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', accountType: 'offline' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', accountType: 'microsoft' }),
    ).not.toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', accountType: 'cracked' }),
    ).toThrow();
  });

  it('memoryMin 范围校验（>=512）', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', memoryMin: 256 }),
    ).toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', memoryMin: 512 }),
    ).not.toThrow();
  });

  it('memoryMax 范围校验（>=1024）', () => {
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', memoryMax: 512 }),
    ).toThrow();
    expect(() =>
      LauncherSpec.parse({ launcherName: 'x', mcVersion: '1.21.1', memoryMax: 1024 }),
    ).not.toThrow();
  });

  it('完整 spec round-trip', () => {
    const input = {
      launcherName: 'pcl2-profile',
      launcherType: 'pcl2' as const,
      profileName: 'survival',
      mcVersion: '1.20.4',
      loader: 'fabric' as const,
      javaPath: 'C:/java/jdk17/bin/java.exe',
      jvmArgs: '-Xmx4G -Xms2G',
      memoryMin: 2048,
      memoryMax: 4096,
      accountType: 'microsoft' as const,
      username: 'Alice',
      uuid: 'abc-123',
      serverAutorun: 'mc.example.com',
      fullscreen: true,
      resolutionWidth: 1920,
      resolutionHeight: 1080,
    };
    const r = LauncherSpec.parse(input);
    expect(r.launcherName).toBe('pcl2-profile');
    expect(r.launcherType).toBe('pcl2');
    expect(r.memoryMax).toBe(4096);
    expect(r.fullscreen).toBe(true);
  });
});
