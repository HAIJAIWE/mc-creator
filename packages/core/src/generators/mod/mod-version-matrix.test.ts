import { describe, it, expect } from 'vitest';
import { ModGenerator } from './mod-generator.js';
import {
  ModSpec as ModSpecSchema,
  MC_VERSIONS,
  javaVersionFor,
  gradleVersionFor,
  getLoaderVersions,
} from '@mc-creator/shared';
import type { GeneratorContext, Loader, ModSpec, McVersion } from '@mc-creator/shared';

const SPEC: ModSpec = ModSpecSchema.parse({
  modId: 'matrix_mod',
  version: '1.0.0',
  name: 'Matrix Mod',
  description: 'Matrix test',
  items: [{ id: 'matrix_item', name: 'Matrix Item' }],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
});

const MOD_LOADERS: Loader[] = ['fabric', 'neoforge', 'quilt', 'legacy_fabric'];

function makeCtx(loader: Loader, mcVersion: McVersion): GeneratorContext {
  return {
    loader,
    mcVersion,
    modId: 'matrix_mod',
    spec: SPEC,
    projectPath: '/proj',
  };
}

describe('版本×loader 矩阵（防回归）', () => {
  const gen = new ModGenerator();

  it.each(MOD_LOADERS.flatMap((l) => MC_VERSIONS.map((v) => [l, v] as const)))(
    '%s × %s：生成成功且关键文件齐全',
    async (loader, mcVersion) => {
      const result = await gen.generate(makeCtx(loader, mcVersion));
      const paths = result.files.map((f) => f.path);
      expect(paths).toContain('build.gradle');
      expect(paths).toContain('gradle.properties');
      expect(paths).toContain('gradle/wrapper/gradle-wrapper.properties');
    },
  );

  it.each(MC_VERSIONS.map((v) => [v] as const))(
    '%s：gradle-wrapper.properties 的 Gradle 版本与 gradleVersionFor 一致',
    async (mcVersion) => {
      const result = await gen.generate(makeCtx('fabric', mcVersion));
      const wrapper = result.files.find(
        (f) => f.path === 'gradle/wrapper/gradle-wrapper.properties',
      );
      expect(wrapper!.content).toContain(`gradle-${gradleVersionFor(mcVersion)}-bin.zip`);
    },
  );

  it.each(MC_VERSIONS.map((v) => [v] as const))(
    '%s：fabric 脚本插件 ID 按混淆/非混淆分支，Java 依赖与 javaVersionFor 一致',
    async (mcVersion) => {
      const files = (await gen.generate(makeCtx('fabric', mcVersion))).files;
      const bg = files.find((f) => f.path === 'build.gradle')!.content;
      const fmj = JSON.parse(
        files.find((f) => f.path === 'src/main/resources/fabric.mod.json')!.content,
      );
      if (mcVersion.startsWith('26.')) {
        expect(bg).toContain("id 'net.fabricmc.fabric-loom'");
        expect(bg).not.toContain('officialMojangMappings');
      } else {
        expect(bg).toContain("id 'fabric-loom'");
        expect(bg).toContain('officialMojangMappings');
      }
      expect(fmj.depends.java).toBe(`>=${javaVersionFor('fabric', mcVersion)}`);
    },
  );

  it.each(MC_VERSIONS.map((v) => [v] as const))(
    '%s：neoforge 脚本 DSL 分支正确且版本号来自 LOADER_VERSIONS',
    async (mcVersion) => {
      const files = (await gen.generate(makeCtx('neoforge', mcVersion))).files;
      const bg = files.find((f) => f.path === 'build.gradle')!.content;
      const versions = getLoaderVersions(mcVersion);
      const isLegacyMdg = mcVersion.startsWith('1.20.') || mcVersion === '1.21.1';
      expect(bg).toContain(versions.neoforgeVersion);
      if (isLegacyMdg) {
        expect(bg).toContain("id 'net.neoforged.moddev' version '1.0.21'");
        expect(bg).toContain('moddev {\n    neoForge {');
      } else {
        expect(bg).toContain("id 'net.neoforged.moddev' version '2.0.143'");
        expect(bg).toContain('\nneoForge {');
      }
    },
  );

  it('26.2 × neoforge 给出 beta 警告；26.2 × fabric 给出核对警告；1.20.1 × neoforge 给出占位提示（isPlaceholder）', async () => {
    const beta = await gen.generate(makeCtx('neoforge', '26.2'));
    expect(beta.warnings.some((w) => w.includes('beta'))).toBe(true);
    const fabric262 = await gen.generate(makeCtx('fabric', '26.2'));
    expect(fabric262.warnings.some((w) => w.includes('26.2'))).toBe(true);
    expect(fabric262.warnings.some((w) => w.includes('beta'))).toBe(false);
    expect(getLoaderVersions('1.20.1').isPlaceholder).toBe(true);
  });

  it('legacy_fabric × 当前任意版本均给出 Legacy Fabric 范围警告', async () => {
    const result = await gen.generate(makeCtx('legacy_fabric', '1.21.11'));
    expect(result.warnings.some((w) => w.includes('Legacy Fabric'))).toBe(true);
  });
});
