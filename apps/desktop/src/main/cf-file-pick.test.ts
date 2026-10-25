/**
 * CF 文件挑选的用例。
 *
 * fixture 的形状全部来自**线上实测**（2026-10-17 走 MCIM 镜像拉 JEI 238222 /
 * Sodium 394468 的 `/files`）：
 *   - `gameVersions` 在客户端出口已归一化（不含 `Client`/`Server`/loader 名）
 *   - `modLoaderNames` 是从 `gameVersions` 里认出来的（`modLoaders` 字段实测不存在）
 *   - `fileDate` / `releaseType` 是真实字段
 */
import { describe, it, expect } from 'vitest';
import type { CurseForgeFile } from '@mc-creator/core';
import { pickCurseForgeFile, describeCfFileNeed } from './cf-file-pick.js';

function file(over: Partial<CurseForgeFile> & { id: number }): CurseForgeFile {
  return {
    displayName: `file ${over.id}`,
    fileName: `file-${over.id}.jar`,
    fileLength: 1000,
    downloadUrl: `https://edge.forgecdn.net/files/${over.id}/x.jar`,
    gameVersions: [],
    modLoaderNames: [],
    ...over,
  };
}

/** JEI 的真实文件顺序：最新的在前，NeoForge 与 Fabric 交错。 */
const JEI_LIKE: CurseForgeFile[] = [
  file({
    id: 1,
    displayName: '31.15.0.79 for NeoForge 26.3',
    fileName: 'jei-26.3-neoforge-31.15.0.79.jar',
    gameVersions: ['26.3'],
    modLoaderNames: ['NeoForge'],
    fileDate: '2026-10-15T17:51:37.020Z',
    releaseType: 1,
  }),
  file({
    id: 2,
    displayName: '31.15.0.79 for Fabric 26.3',
    fileName: 'jei-26.3-fabric-31.15.0.79.jar',
    gameVersions: ['26.3'],
    modLoaderNames: ['Fabric'],
    fileDate: '2026-10-15T17:51:36.900Z',
    releaseType: 1,
  }),
  file({
    id: 3,
    displayName: '31.15.0.70 for Fabric 1.21.1',
    fileName: 'jei-1.21.1-fabric-31.15.0.70.jar',
    gameVersions: ['1.21.1'],
    modLoaderNames: ['Fabric'],
    fileDate: '2026-06-01T00:00:00.000Z',
    releaseType: 2,
  }),
];

describe('pickCurseForgeFile · 按实例挑文件', () => {
  it('Fabric 实例不拿最新的 NeoForge 文件（老实现取 files[0] 就是这个坑）', () => {
    const picked = pickCurseForgeFile(JEI_LIKE, { mcVersion: '26.3', loader: 'fabric' });
    expect(picked?.id).toBe(2);
    expect(picked?.fileName).toContain('fabric');
  });

  it('NeoForge 实例拿 NeoForge 文件', () => {
    expect(pickCurseForgeFile(JEI_LIKE, { mcVersion: '26.3', loader: 'neoforge' })?.id).toBe(1);
  });

  it('neoforge 不会被当成 forge（子串包含的经典坑）', () => {
    // 实例是 Forge：列表里只有 NeoForge 文件，就该老实返回 null，
    // 而不是"neoforge 里含 forge，也算匹配"。
    expect(pickCurseForgeFile(JEI_LIKE, { mcVersion: '26.3', loader: 'forge' })).toBeNull();
  });

  it('loader 名带版本后缀时也认得出（`forge-43.2.0`）', () => {
    const files = [
      file({
        id: 9,
        gameVersions: ['1.21.1'],
        modLoaderNames: ['forge-43.2.0'],
        fileDate: '2026-01-01T00:00:00.000Z',
      }),
    ];
    expect(pickCurseForgeFile(files, { mcVersion: '1.21.1', loader: 'forge' })?.id).toBe(9);
  });

  it('MC 版本对不上就返回 null（由调用方报"找不到兼容文件"）', () => {
    expect(pickCurseForgeFile(JEI_LIKE, { mcVersion: '1.7.10', loader: 'fabric' })).toBeNull();
  });

  it('不指定 loader 时只按 MC 版本挑（资源包 / 数据包走这条）', () => {
    const picked = pickCurseForgeFile(JEI_LIKE, { mcVersion: '26.3' });
    // 两条 26.3 都合格，取更新的那条（id 1 更新时间更晚）
    expect(picked?.id).toBe(1);
  });

  it('两个条件都不给时取最新的一个', () => {
    expect(pickCurseForgeFile(JEI_LIKE, {})?.id).toBe(1);
  });

  it('按 fileDate 排序，不依赖数组顺序（数组故意放成倒序）', () => {
    const reversed = [...JEI_LIKE].reverse();
    expect(pickCurseForgeFile(reversed, { mcVersion: '26.3' })?.id).toBe(1);
  });

  it('fileDate 缺失时保持原顺序，而不是把"不知道时间"的排到最后', () => {
    const files = [
      file({ id: 11, gameVersions: ['26.3'], modLoaderNames: ['Fabric'] }),
      file({
        id: 12,
        gameVersions: ['26.3'],
        modLoaderNames: ['Fabric'],
        fileDate: '2026-10-15T00:00:00.000Z',
      }),
    ];
    // 接口的顺序就是"最新的在前"，缺时间戳的按原顺序优先
    expect(pickCurseForgeFile(files, { mcVersion: '26.3', loader: 'fabric' })?.id).toBe(11);
  });

  it('空列表返回 null（不是抛错）', () => {
    expect(pickCurseForgeFile([], { mcVersion: '26.3' })).toBeNull();
  });
});

describe('describeCfFileNeed · 报错文案', () => {
  it('两个条件都有', () => {
    expect(describeCfFileNeed({ mcVersion: '1.21.1', loader: 'fabric' })).toBe('1.21.1 + fabric');
  });

  it('缺省时说不限制', () => {
    expect(describeCfFileNeed({})).toBe('任意 MC 版本');
    expect(describeCfFileNeed({ mcVersion: '26.3' })).toBe('26.3');
  });
});
