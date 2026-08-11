/**
 * CI 项目导出（Gradle 编译矩阵用）。
 *
 * 普通 `pnpm test` 只跑本地断言；设置 CI_EXPORT_DIR 后会把
 * 全部 MC 版本 × fabric/neoforge 的最小 Mod 项目写入该目录，
 * 供 GitHub Actions 接着执行真实 Gradle 编译。
 */
import { describe, it, expect } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { ModGenerator } from '../generators/mod/mod-generator.js';
import { MC_VERSIONS, ModSpec } from '@mc-creator/shared';
import type { GeneratorContext, McVersion } from '@mc-creator/shared';
import type { Loader } from '@mc-creator/shared';

const outDir = process.env.CI_EXPORT_DIR;
const MOD_LOADERS: Loader[] = ['fabric', 'neoforge'];

const MIN_SPEC = ModSpec.parse({
  modId: 'demo',
  version: '1.0.0',
  name: 'Demo',
  description: 'CI smoke-test mod',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
});

async function exportProject(root: string, loader: Loader, mcVersion: McVersion) {
  const gen = new ModGenerator();
  const ctx: GeneratorContext = {
    loader,
    mcVersion,
    modId: 'demo',
    spec: MIN_SPEC,
    projectPath: '',
  };
  const result = await gen.generate(ctx);
  for (const f of result.files) {
    const p = join(root, `${mcVersion}-${loader}`, f.path);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, f.content);
  }
  return result;
}

describe('CI 项目导出（本地断言，始终运行）', () => {
  const gen = new ModGenerator();

  it('最小 spec × fabric 1.21.11 产出 build.gradle 与 wrapper 配置', async () => {
    const result = await gen.generate({
      loader: 'fabric',
      mcVersion: '1.21.11',
      modId: 'demo',
      spec: MIN_SPEC,
      projectPath: '',
    });
    expect(result.files.some((f) => f.path === 'build.gradle')).toBe(true);
    expect(result.files.some((f) => f.path === 'gradle/wrapper/gradle-wrapper.properties')).toBe(
      true,
    );
  });
});

describe.skipIf(!outDir)('CI 项目导出（写盘）', () => {
  it('导出全部 MC 版本 × fabric/neoforge 到 CI_EXPORT_DIR', async () => {
    for (const mc of MC_VERSIONS) {
      for (const loader of MOD_LOADERS) {
        await exportProject(outDir!, loader, mc);
      }
    }
  });
});
