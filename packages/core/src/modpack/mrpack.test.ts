import { describe, it, expect } from 'vitest';
import {
  buildMrpackPlan,
  validateModrinthIndex,
  loaderToMrpackKey,
  describeMrpackFormat,
} from './mrpack.js';
import type { ModpackSpec } from '@mc-creator/shared';

function spec(partial: Partial<ModpackSpec> = {}): ModpackSpec {
  return {
    packId: 'test_pack',
    packName: 'Test Pack',
    packVersion: '1.0.0',
    author: '',
    description: '',
    format: 'modrinth',
    mcVersion: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.9',
    mods: [],
    credits: '',
    overrides: [],
    serverOverrides: [],
    launchMessage: '',
    ...partial,
  };
}

describe('loaderToMrpackKey', () => {
  it('fabric/quilt 用 -loader 后缀', () => {
    expect(loaderToMrpackKey('fabric')).toBe('fabric-loader');
    expect(loaderToMrpackKey('quilt')).toBe('quilt-loader');
    expect(loaderToMrpackKey('neoforge')).toBe('neoforge');
  });
});

describe('buildMrpackPlan', () => {
  it('生成规范 dependencies（含 fabric-loader + 兼容 fabric 键）', () => {
    const plan = buildMrpackPlan(spec());
    const deps = plan.indexJson.dependencies as Record<string, string>;
    expect(deps.minecraft).toBe('1.21.1');
    expect(deps['fabric-loader']).toBe('0.16.9');
    expect(deps['fabric']).toBe('0.16.9');
  });
  it('文件含 path/hashes/env/downloads/fileSize', () => {
    const plan = buildMrpackPlan(
      spec({
        mods: [
          {
            name: 'Sodium',
            projectId: 'Aqlfj9dU',
            versionId: 'ver-1',
            fileName: 'sodium.jar',
            fileSize: 123,
            downloadUrl: 'https://example.com/sodium.jar',
            sha512: 'a'.repeat(128),
            sha1: 'b'.repeat(40),
            envClient: 'required',
            envServer: 'unsupported',
          },
        ],
      }),
    );
    const files = plan.indexJson.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('mods/sodium.jar');
    expect(files[0]?.hashes).toEqual({ sha512: 'a'.repeat(128), sha1: 'b'.repeat(40) });
    expect(files[0]?.env).toEqual({ client: 'required', server: 'unsupported' });
  });
  it('缺哈希/直链时占位并告警', () => {
    const plan = buildMrpackPlan(
      spec({ mods: [{ name: 'X', projectId: 'p', versionId: 'v', fileName: 'x.jar' }] }),
    );
    expect(plan.warnings.length).toBeGreaterThan(0);
    const files = plan.indexJson.files as Array<{ hashes: Record<string, string> }>;
    expect(files[0]?.hashes.sha512).toHaveLength(128);
  });
  it('产物可通过 validateModrinthIndex', () => {
    const plan = buildMrpackPlan(
      spec({ mods: [{ name: 'X', projectId: 'p', versionId: 'v', fileName: 'x.jar', downloadUrl: 'https://x/y.jar' }] }),
    );
    expect(validateModrinthIndex(plan.indexJson).ok).toBe(true);
  });
});

describe('describeMrpackFormat', () => {
  it('说明含关键结构', () => {
    const doc = describeMrpackFormat();
    expect(doc).toContain('modrinth.index.json');
    expect(doc).toContain('overrides/');
    expect(doc).toContain('file:project:writeStream');
  });
});
