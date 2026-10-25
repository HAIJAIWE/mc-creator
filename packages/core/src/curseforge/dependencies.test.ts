import { describe, it, expect } from 'vitest';
import {
  CF_RELATION_OPTIONAL,
  CF_RELATION_REQUIRED,
  dependenciesOf,
  requiredDependencyIds,
  toHints,
} from './dependencies.js';
import { curseforgeFileIdFromUrl } from './api-client.js';

/**
 * CurseForge 文件级依赖的判定。
 *
 * 这些用例的**依据全部来自实测**（2026-10-17 走 MCIM 镜像），不是照文档抄的：
 *
 *   | 观测到的关系对                                                | relationType |
 *   | ------------------------------------------------------------- | ------------ |
 *   | Iris Shaders → Sodium（没 Sodium 起不来）                     | 3            |
 *   | Xaero's Minimap (fabric) → Fabric API                         | 3            |
 *   | Xaero's Minimap → Xaero's World Map / Open Parties and Claims | 2            |
 *   | JEI 26.3 → MezzConfig / MezzConfigGUI                          | 3 / 2        |
 */
describe('CurseForge 依赖判定', () => {
  it('只有 relationType=3 算前置；2（可选）与其它值不算', () => {
    const file = {
      dependencies: [
        { modId: 1689768, relationType: CF_RELATION_REQUIRED }, // MezzConfig
        { modId: 1700987, relationType: CF_RELATION_OPTIONAL }, // MezzConfigGUI
        { modId: 1, relationType: 1 }, // EmbeddedLibrary（已打进 jar）
        { modId: 2, relationType: 4 }, // Tool
        { modId: 3, relationType: 5 }, // Incompatible
        { modId: 4, relationType: 6 }, // Include
      ],
    };
    expect(requiredDependencyIds(file)).toEqual([1689768]);
  });

  /**
   * `relationType` 缺失时当**必需**：源站将来删掉这个字段的话，宁可多报一句，
   * 也不能对可能的硬前置装聋作哑（"装上去起不来"比"多一句提示"贵得多）。
   */
  it('relationType 缺失时保守当必需', () => {
    expect(requiredDependencyIds({ dependencies: [{ modId: 7 }] })).toEqual([7]);
  });

  it('按 modId 去重（同一依赖出现两次只报一次）', () => {
    const file = {
      dependencies: [
        { modId: 306612, relationType: 3 },
        { modId: 306612, relationType: 3 },
        { modId: 306612, relationType: 2 },
      ],
    };
    // 第一次出现（必需）就定调；后面两条同 id 的丢掉
    expect(dependenciesOf(file)).toEqual([{ modId: 306612, relationType: 3 }]);
    expect(requiredDependencyIds(file)).toEqual([306612]);
  });

  it('没有依赖字段 / 空数组都安全', () => {
    expect(dependenciesOf({})).toEqual([]);
    expect(requiredDependencyIds({})).toEqual([]);
    expect(toHints({})).toEqual([]);
  });

  it('toHints 只给必需依赖，并带可点主页', () => {
    expect(
      toHints({
        dependencies: [
          { modId: 394468, relationType: 3 },
          { modId: 317780, relationType: 2 },
        ],
      }),
    ).toEqual([{ modId: 394468, url: 'https://www.curseforge.com/minecraft/mc-mods/394468' }]);
  });
});

/**
 * 从下载地址反推文件 id。
 *
 * 详情页的「按 URL 下载」路径手上只有 URL，要报前置就得先把文件 id 找回来。
 * 形状是实测的：`/files/{id 去尾三位}/{尾三位}/{文件名}`，六个样本全中。
 */
describe('curseforgeFileIdFromUrl', () => {
  it('实测地址能反推出 id（含走镜像的同路径地址）', () => {
    // 实测：JEI 26.3 neoforge 构建
    expect(
      curseforgeFileIdFromUrl(
        'https://edge.forgecdn.net/files/9221/721/jei-26.3-neoforge-31.15.0.79.jar',
      ),
    ).toBe(9221721);
    // 镜像只换根，路径不变
    expect(
      curseforgeFileIdFromUrl(
        'https://mod.mcimirror.top/files/9221/718/jei-26.3-fabric-31.15.0.79.jar',
      ),
    ).toBe(9221718);
  });

  it('尾三位带前导零也照样 1000 进制（不是字符串拼接）', () => {
    expect(curseforgeFileIdFromUrl('https://edge.forgecdn.net/files/10000/005/a.jar')).toBe(
      10000005,
    );
    expect(curseforgeFileIdFromUrl('https://edge.forgecdn.net/files/12/345/a.jar')).toBe(12345);
  });

  it('不是 CF 文件地址就返回 null —— 不猜', () => {
    expect(
      curseforgeFileIdFromUrl('https://cdn.modrinth.com/data/abc/versions/1/x.jar'),
    ).toBeNull();
    expect(curseforgeFileIdFromUrl('https://edge.forgecdn.net/files/9221/x.jar')).toBeNull();
    expect(curseforgeFileIdFromUrl('')).toBeNull();
  });
});
