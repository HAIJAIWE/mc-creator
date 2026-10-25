import { describe, it, expect } from 'vitest';
import { curseforgeToMetadata } from './adapters.js';

/**
 * CF 文件 → 统一元数据的依赖映射。
 *
 * ⚠️ 老实现把**所有** CF 依赖都写成 `dependencyType: 'required'` —— 当时以为
 * 那边的 `dependencies` 只是一串裸 modId（见 `curseforge/dependencies.ts`
 * 的文件头）。实测每条形如 `{modId, relationType}`，`3=必需 / 2=可选`
 * （Iris→Sodium、Xaero→Fabric API、JEI→MezzConfig 三组真实关系钉过）。
 *
 * 于是整合包预览里，可选联动（Xaero's World Map、MezzConfigGUI 这类）会被
 * 当成"缺了会坏"。这条用例把映射钉住。
 */
describe('curseforgeToMetadata 的依赖映射', () => {
  const baseFile = {
    id: 9221721,
    displayName: '31.15.0.79 for NeoForge 26.3',
    fileName: 'jei-26.3-neoforge-31.15.0.79.jar',
    fileLength: 1234567,
    downloadUrl: 'https://edge.forgecdn.net/files/9221/721/jei.jar',
    gameVersions: ['26.3'],
    modLoaderNames: ['NeoForge'],
  };

  it('relationType 3→required、2→optional、1/6→embedded、5→incompatible', () => {
    const meta = curseforgeToMetadata(238222, {
      ...baseFile,
      dependencies: [
        { modId: 1689768, relationType: 3 }, // MezzConfig：硬前置
        { modId: 1700987, relationType: 2 }, // MezzConfigGUI：可选
        { modId: 1, relationType: 1 }, // EmbeddedLibrary：已打进 jar
        { modId: 2, relationType: 6 }, // Include：已包含
        { modId: 3, relationType: 5 }, // Incompatible
      ],
    });

    expect(meta.dependencies).toEqual([
      { projectId: '1689768', dependencyType: 'required' },
      { projectId: '1700987', dependencyType: 'optional' },
      { projectId: '1', dependencyType: 'embedded' },
      { projectId: '2', dependencyType: 'embedded' },
      { projectId: '3', dependencyType: 'incompatible' },
    ]);
  });

  /**
   * `relationType` 缺失 / 没见过的值 → 维持老行为（当必需）。
   * 宁可多报一条"缺前置"，也不能对可能的硬前置装聋作哑。
   */
  it('relationType 缺失或未知时保守当 required', () => {
    const meta = curseforgeToMetadata(1, {
      ...baseFile,
      dependencies: [
        { modId: 10 },
        { modId: 11, relationType: 4 },
        { modId: 12, relationType: 99 },
      ],
    });
    expect(meta.dependencies).toEqual([
      { projectId: '10', dependencyType: 'required' },
      { projectId: '11', dependencyType: 'required' },
      { projectId: '12', dependencyType: 'required' },
    ]);
  });

  it('没有依赖时不编造（空数组）', () => {
    expect(curseforgeToMetadata(1, baseFile).dependencies).toEqual([]);
    expect(curseforgeToMetadata(1, { ...baseFile, dependencies: [] }).dependencies).toEqual([]);
  });

  it('sha1 / loader 归一化不受影响（回归面）', () => {
    const meta = curseforgeToMetadata(238222, {
      ...baseFile,
      hashes: [
        { value: 'deadbeef', algo: 1 },
        { value: 'cafe', algo: 2 },
      ],
    });
    expect(meta.sha1).toBe('deadbeef');
    expect(meta.loaders).toEqual(['neoforge']);
    expect(meta.id).toBe('9221721');
    expect(meta.versionNumber).toBe('31.15.0.79 for NeoForge 26.3');
  });
});
