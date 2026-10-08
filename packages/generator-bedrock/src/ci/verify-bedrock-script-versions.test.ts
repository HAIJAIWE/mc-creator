/**
 * `BEDROCK_SCRIPT_VERSIONS` 过期检测（联网，`VERIFY_VERSIONS=1` 门控）。
 *
 * 与 `verify-loader-versions.test.ts` 同属「钉住的快照必须有自动巡检」这一套机制。
 * 存在理由（不是形式主义）：这张表里的每个值都是**手抄的**外部事实，
 * 而 §21 明确要求「实现前核对官方文档」。手工核对一次就过期了 ——
 * Minecraft 每个版本都会带新的 `@minecraft/server`。
 *
 * ## 本测试要抓的是哪一类错
 *
 * 不是「版本号写错了」这种一眼能看出的错，而是**悄悄变得不安全**：
 * 声明的 `@minecraft/server` 版本在该 `min_engine_version` 对应的 Bedrock
 * 版本里**不存在** → 游戏侧 `import` 失败 → 整个脚本模块加载失败，
 * 一行事件写错会连带全部逻辑不执行。这类错本地测不出来，只能对着 npm 实抓。
 *
 * ## 预发布标签必须查两族（这是本测试最容易被写错的地方）
 *
 * npm 上每个稳定版 `X.Y.0` 都有预发布标签，但有**两族**：
 *   - `<ver>-beta.<MC>-stable`      （stable 分支）
 *   - `<ver>-beta.<MC>-preview.<n>` （preview 分支）
 *
 * 实测 `1.5.0` / `1.13.0` / `1.19.0` **没有** `-stable` 标签，只有 `-preview`。
 * 只按 `-stable` 反推会误判这三个版本的来源，进而误以为本表推导有错
 * （这个错误本会话真实犯过一次，见 script-versions.ts 文件头注释）。
 *
 * 查询失败（网络/registry 变更）→ SKIP 打印提示，不误报。
 */
import { describe, it, expect } from 'vitest';
import { BEDROCK_SCRIPT_VERSIONS } from '../script-api/script-versions.js';

const enabled = process.env.VERIFY_VERSIONS === '1';

/** Bedrock 版本号比较（1.21.100 与 1.21.9 必须按数值比而非字符串）。 */
function cmpBedrock(a: string, b: string): number {
  const A = a.split('.').map(Number);
  const B = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (A[i] ?? 0) - (B[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

interface RegistryShape {
  versions?: Record<string, unknown>;
}

/** 稳定版 → 它覆盖到的 Bedrock 版本集合（**两族标签合并**）。 */
async function coverageByStable(pkg: string): Promise<Map<string, Set<string>> | null> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
      headers: { 'User-Agent': 'mc-creator/0.0.0' },
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return null;
    const doc = (await res.json()) as RegistryShape;
    if (!doc.versions) return null;
    const map = new Map<string, Set<string>>();
    for (const v of Object.keys(doc.versions)) {
      // 同时匹配 -stable 与 -preview 两族
      const m = /^(\d+\.\d+\.\d+)-beta\.(\d+\.\d+\.\d+)-/.exec(v);
      if (!m) continue;
      const [, stable, bedrock] = m;
      if (!map.has(stable)) map.set(stable, new Set());
      map.get(stable)!.add(bedrock);
    }
    return map;
  } catch {
    return null;
  }
}

describe.skipIf(!enabled)('BEDROCK_SCRIPT_VERSIONS 过期检测（联网）', () => {
  const entries = Object.entries(BEDROCK_SCRIPT_VERSIONS);

  it.each(['@minecraft/server', '@minecraft/server-ui'])(
    '%s：表里声明的每个版本都真实发布过',
    async (pkg) => {
      const field = pkg.endsWith('-ui') ? 'serverUiModule' : 'serverModule';
      const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(pkg)}`, {
        headers: { 'User-Agent': 'mc-creator/0.0.0' },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) {
        console.log(`SKIP ${pkg}: registry 返回 ${res.status}`);
        return;
      }
      const doc = (await res.json()) as RegistryShape;
      const published = doc.versions ?? {};
      const missing = entries
        .map(([mc, v]) => [mc, v[field]] as const)
        .filter(([, ver]) => !(ver in published))
        .map(([mc, ver]) => `${mc} 声明的 ${ver}`);
      // 声明一个不存在的版本 → manifest 依赖装不上，必须硬失败
      expect(missing, `${pkg} 有未发布版本：\n  ${missing.join('\n  ')}`).toEqual([]);
    },
    30_000,
  );

  it.each(['@minecraft/server', '@minecraft/server-ui'])(
    '%s：每个声明版本都覆盖其 min_engine_version 对应的 Bedrock 版本',
    async (pkg) => {
      const field = pkg.endsWith('-ui') ? 'serverUiModule' : 'serverModule';
      const cov = await coverageByStable(pkg);
      if (cov === null) {
        console.log(`SKIP ${pkg}: registry 查询失败（可能本机网络受限）`);
        return;
      }
      const broken: string[] = [];
      for (const [mc, v] of entries) {
        const [bedMajor, bedMinor, bedPatch] = v.minEngineVersion;
        const bed = `${bedMajor}.${bedMinor}.${bedPatch}`;
        const covered = cov.get(v[field]);
        if (!covered) {
          broken.push(
            `${mc}: ${v[field]} 在 registry 上找不到任何预发布标签，` +
              `无法证明它覆盖 Bedrock ${bed}`,
          );
          continue;
        }
        const hits = [...covered].filter((x) => cmpBedrock(x, bed) <= 0);
        if (hits.length === 0) {
          broken.push(
            `${mc}: 声明 ${v[field]} 但它覆盖的 Bedrock 版本是 ` +
              `${[...covered].slice(0, 4).join(',')}，都不 ≤ ${bed} —— 会 import 失败`,
          );
        }
      }
      expect(
        broken,
        `${pkg} 有无法覆盖 min_engine_version 的声明：\n  ${broken.join('\n  ')}`,
      ).toEqual([]);
    },
    60_000,
  );

  it('保守取值报告：声明值低于当时可用最大值的项（仅提示，不失败）', async () => {
    const cov = await coverageByStable('@minecraft/server');
    if (cov === null) {
      console.log('SKIP: registry 查询失败');
      return;
    }
    for (const [mc, v] of entries) {
      const bed = v.minEngineVersion.join('.');
      const higher = [...cov.entries()]
        .filter(([ver]) => cmpBedrock(ver, v.serverModule) > 0)
        .filter(([, mcs]) => [...mcs].some((x) => cmpBedrock(x, bed) <= 0))
        .map(([ver]) => ver)
        .sort();
      if (higher.length > 0) {
        console.log(
          `提示 ${mc}: 声明 ${v.serverModule}，但 ${bed} 当时已有更高版本可用（${higher.join(', ')}）`,
        );
      }
    }
    // 这条只打印，不做断言 —— 保守取值是刻意策略（见 script-versions.ts 文件头）
    expect(true).toBe(true);
  });
});
