/**
 * LOADER_VERSIONS 过期检测（联网）。
 *
 * 设置 VERIFY_VERSIONS=1 后运行（CI 每周定时任务 / 手动）：
 *   - fabric-api：对比 Modrinth 各 MC 版本最新版本号
 *   - neoforge：对比 maven.neoforged.net maven-metadata 各分支最新版本号
 * 任一快照过期 → 测试失败并显示最新值，提示人工更新 loader.ts。
 * 查询失败（网络/版本未发布）→ SKIP 打印提示，不误报。
 */
import { describe, it, expect } from 'vitest';
import { LOADER_VERSIONS, MC_VERSIONS } from '@mc-creator/shared';
import type { McVersion } from '@mc-creator/shared';
import { ModrinthApiClient } from '../modrinth/api-client.js';

const enabled = process.env.VERIFY_VERSIONS === '1';
const client = new ModrinthApiClient();

async function latestFabricApi(mc: string): Promise<string | null> {
  try {
    const versions = await client.getVersions('fabric-api', {
      mcVersion: mc,
      loader: 'fabric',
    });
    return versions[0]?.version_number ?? null;
  } catch {
    return null;
  }
}

/** NeoForge 快照版本号 → maven 分支前缀（'21.11.42' → '21.11'，'26.2.0.41-beta' → '26.2'） */
function neoforgeBranch(mc: McVersion): string {
  return LOADER_VERSIONS[mc].neoforgeVersion.split('.').slice(0, 2).join('.');
}

async function latestNeoForge(branch: string): Promise<string | null> {
  try {
    const res = await fetch(
      'https://maven.neoforged.net/releases/net/neoforged/neoforge/maven-metadata.xml',
      {
        headers: { 'User-Agent': 'mc-creator/0.0.0' },
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!res.ok) return null;
    const xml = await res.text();
    const versions = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map((m) => m[1]!);
    const branchVersions = versions.filter((v) => v.startsWith(`${branch}.`));
    return branchVersions.sort().at(-1) ?? null;
  } catch {
    return null;
  }
}

describe.skipIf(!enabled)('LOADER_VERSIONS 过期检测（联网）', () => {
  it.each(MC_VERSIONS.map((v) => [v] as const))(
    '%s：fabric-api 快照与 Modrinth 最新一致',
    async (mc) => {
      const latest = await latestFabricApi(mc);
      const expected = LOADER_VERSIONS[mc].fabricApiVersion;
      if (latest === null) {
        console.log(`SKIP ${mc}: fabric-api 查询失败或 Modrinth 未发布该版本（快照 ${expected}）`);
        return;
      }
      expect(latest, `快照 ${expected} 已过期，Modrinth 最新为 ${latest}，请更新 loader.ts`).toBe(
        expected,
      );
    },
    30_000,
  );

  it.each(MC_VERSIONS.map((v) => [v] as const))(
    '%s：neoforge 快照与 maven-metadata 最新一致',
    async (mc) => {
      const latest = await latestNeoForge(neoforgeBranch(mc));
      const expected = LOADER_VERSIONS[mc].neoforgeVersion;
      if (latest === null) {
        console.log(
          `SKIP ${mc}: NeoForge maven-metadata 查询失败（快照 ${expected}，可能本机网络受限）`,
        );
        return;
      }
      expect(
        latest,
        `快照 ${expected} 已过期，maven-metadata 最新为 ${latest}，请更新 loader.ts`,
      ).toBe(expected);
    },
    30_000,
  );
});
