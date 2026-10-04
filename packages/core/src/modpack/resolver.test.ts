import { describe, it, expect } from 'vitest';
import {
  pickBestVersion,
  resolveFromMetadata,
  normalizeLoader,
  lockVersionToEntry,
} from './resolver.js';
import type { VersionMetadata } from './types.js';

function meta(partial: Partial<VersionMetadata> & { id: string }): VersionMetadata {
  return {
    versionNumber: '1.0.0',
    fileName: 'a.jar',
    downloadUrl: 'https://example.com/a.jar',
    fileSize: 100,
    gameVersions: ['1.21.1'],
    loaders: ['fabric'],
    dependencies: [],
    ...partial,
  };
}

describe('normalizeLoader', () => {
  it('legacy_fabric 视为 fabric', () => {
    expect(normalizeLoader('legacy_fabric')).toBe('fabric');
    expect(normalizeLoader('Fabric')).toBe('fabric');
  });
});

describe('pickBestVersion', () => {
  const versions = [
    meta({ id: 'v1', versionNumber: '1.0', gameVersions: ['1.20.1'], loaders: ['fabric'] }),
    meta({ id: 'v2', versionNumber: '2.0', gameVersions: ['1.21.1'], loaders: ['fabric'] }),
    meta({ id: 'v3', versionNumber: '3.0', gameVersions: ['1.21.1'], loaders: ['neoforge'] }),
  ];
  it('命中 loader+mc 的版本优先', () => {
    expect(pickBestVersion(versions, '1.21.1', 'fabric')?.id).toBe('v2');
    expect(pickBestVersion(versions, '1.21.1', 'neoforge')?.id).toBe('v3');
  });
  it('无 loader 命中时返回 null', () => {
    const onlyForge = [meta({ id: 'x', loaders: ['forge'], gameVersions: ['1.21.1'] })];
    expect(pickBestVersion(onlyForge, '1.21.1', 'fabric')).toBeNull();
  });
  it('空列表返回 null', () => {
    expect(pickBestVersion([], '1.21.1', 'fabric')).toBeNull();
  });
});

describe('lockVersionToEntry', () => {
  it('锁定哈希与版本元数据', () => {
    const e = lockVersionToEntry('proj-a', 'Mod A', meta({
      id: 'ver-1',
      versionNumber: '2.0',
      fileName: 'mod-a.jar',
      sha512: 'abc',
      sha1: 'def',
      gameVersions: ['1.21.1'],
      loaders: ['fabric'],
      dependencies: [{ projectId: 'dep-1', dependencyType: 'required' }],
    }));
    expect(e.versionId).toBe('ver-1');
    expect(e.versionNumber).toBe('2.0');
    expect(e.sha512).toBe('abc');
    expect(e.gameVersions).toEqual(['1.21.1']);
    expect(e.dependencies).toHaveLength(1);
    expect(e.source).toBe('modrinth');
  });
  it('数字 ID 识别为 curseforge', () => {
    const e = lockVersionToEntry('123456', 'CF', meta({ id: '99' }));
    expect(e.source).toBe('curseforge');
  });
});

describe('resolveFromMetadata', () => {
  it('锁定每个 mod 并生成依赖图', () => {
    const result = resolveFromMetadata(
      { mods: [{ projectId: 'a' }, { projectId: 'b' }], mcVersion: '1.21.1', loader: 'fabric' },
      {
        a: [meta({ id: 'va', versionNumber: '1.0', dependencies: [{ projectId: 'b', dependencyType: 'required' }] })],
        b: [meta({ id: 'vb', versionNumber: '1.0' })],
      },
      { a: 'Mod A', b: 'Mod B' },
    );
    expect(result.resolved).toHaveLength(2);
    expect(result.unresolved).toHaveLength(0);
    expect(result.graph.nodes).toHaveLength(2);
    expect(result.graph.edges).toHaveLength(1);
    expect(result.graph.edges[0]).toMatchObject({ from: 'a', to: 'b', kind: 'requires' });
    expect(result.conflicts).toHaveLength(0);
  });
  it('无元数据时进入 unresolved 并告警', () => {
    const result = resolveFromMetadata(
      { mods: [{ projectId: 'missing' }], mcVersion: '1.21.1', loader: 'fabric' },
      {},
    );
    expect(result.resolved).toHaveLength(0);
    expect(result.unresolved).toHaveLength(1);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});
