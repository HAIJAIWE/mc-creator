/**
 * 依赖递归收集的测试。
 *
 * 为什么这组用例重要：前置下错的后果很隐蔽 —— 主文件装上了、
 * 启动时才发现缺 Fabric API，用户不会认为是"下载时少拉了前置"。
 * 所以五类边界必须钉死：
 *   1. required 才递归（optional / embedded / incompatible 都不动）
 *   2. **依赖版本按目标实例过滤**（MC 版本 + 加载器）；过滤后为空就不装，
 *      绝不拿一个不兼容的最新版充数
 *   3. 循环引用不会无限递归
 *   4. 拉不到某个依赖时不整体失败
 *   5. 版本里钉的精确 version_id 只在过滤结果内优先
 */
import { describe, it, expect, vi } from 'vitest';
import { collectRequiredDependencies, isDatapackVersion, pickPrimaryFile } from './dependencies.js';
import { ModrinthApiClient, type ModrinthVersion } from './api-client.js';

function ver(
  partial: Partial<ModrinthVersion> & { id: string; project_id: string },
): ModrinthVersion {
  return {
    version_number: '1.0.0',
    name: 'test',
    files: [
      {
        url: `https://cdn.test/${partial.id}.jar`,
        filename: `${partial.id}.jar`,
        primary: true,
        size: 1,
      },
    ],
    ...partial,
  } as ModrinthVersion;
}

type VersionsQuery = { loader?: string; mcVersion?: string };
type VersionsFor = ModrinthVersion[] | ((opts: VersionsQuery) => ModrinthVersion[]);

/**
 * 造一个假客户端。
 *
 * 值可以是数组（任何过滤条件都返回它 —— 模拟"源站只有这一版"），
 * 也可以是函数（按过滤条件返回 —— 用来模拟**精确过滤为空、放宽后才有结果**）。
 * `queries` 记录每次调用收到的过滤条件，用来钉"过滤条件真的传下去了"。
 */
function fakeClient(byProject: Record<string, VersionsFor>): {
  client: ModrinthApiClient;
  calls: string[];
  queries: Array<{ pid: string; opts: VersionsQuery }>;
} {
  const calls: string[] = [];
  const queries: Array<{ pid: string; opts: VersionsQuery }> = [];
  const client = {
    getVersions: vi.fn(async (pid: string, opts: VersionsQuery = {}) => {
      calls.push(pid);
      queries.push({ pid, opts });
      const entry = byProject[pid];
      if (!entry) throw new Error(`no versions for ${pid}`);
      return typeof entry === 'function' ? entry(opts) : entry;
    }),
  } as unknown as ModrinthApiClient;
  return { client, calls, queries };
}

describe('collectRequiredDependencies', () => {
  it('只递归 required：optional / embedded / incompatible 都不下载', async () => {
    const opt = ver({ id: 'v-opt', project_id: 'opt' });
    const emb = ver({ id: 'v-emb', project_id: 'emb' });
    const inc = ver({ id: 'v-inc', project_id: 'inc' });
    const { client, calls } = fakeClient({ opt: [opt], emb: [emb], inc: [inc] });

    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [
        { project_id: 'opt', dependency_type: 'optional' },
        { project_id: 'emb', dependency_type: 'embedded' },
        { project_id: 'inc', dependency_type: 'incompatible' },
      ],
    });

    const res = await collectRequiredDependencies(root, client);

    expect(res.dependencies).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it('required 会被下载，并记录依赖路径', async () => {
    const dep = ver({ id: 'v-dep', project_id: 'dep', version_number: '2.0.0' });
    const { client } = fakeClient({ dep: [dep] });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [{ project_id: 'dep', dependency_type: 'required' }],
    });

    const res = await collectRequiredDependencies(root, client);

    expect(res.dependencies).toHaveLength(1);
    expect(res.dependencies[0].projectId).toBe('dep');
    expect(res.dependencies[0].version.id).toBe('v-dep');
    // via 记录了「谁需要它」
    expect(res.dependencies[0].via.length).toBeGreaterThan(0);
  });

  it('递归多层：A → B → C 全部收集到', async () => {
    const b = ver({
      id: 'v-b',
      project_id: 'b',
      dependencies: [{ project_id: 'c', dependency_type: 'required' }],
    });
    const c = ver({ id: 'v-c', project_id: 'c' });
    const { client } = fakeClient({ b: [b], c: [c] });
    const a = ver({
      id: 'v-a',
      project_id: 'a',
      dependencies: [{ project_id: 'b', dependency_type: 'required' }],
    });

    const res = await collectRequiredDependencies(a, client);

    expect(res.dependencies.map((d) => d.projectId).sort()).toEqual(['b', 'c']);
  });

  /**
   * 这条替换掉了原来的「已在实例中的依赖不重复下载」。
   *
   * 原用例传的是 `new Set(['dep'])`（**project id**），而实现比的是
   * `already.has(pid)` —— 调用方传的却是**文件名**，两边永远对不上，
   * 那个"跳过已装"从来没生效过。真正防重复下载的是调用方落盘前的
   * 逐文件比对（`existsSync(depDir/filename)`），那一步是准的，也有测试钉
   * （见 `apps/desktop/src/main/modpack-install-files.test.ts` 同类思路）。
   * 所以这里不再留一个假的"已装跳过"，改成钉住**过滤条件真的传下去**。
   */
  it('过滤条件（MC 版本 + 加载器）原样传给 getVersions', async () => {
    const dep = ver({ id: 'v-dep', project_id: 'dep' });
    const { client, queries } = fakeClient({ dep: [dep] });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [{ project_id: 'dep', dependency_type: 'required' }],
    });

    await collectRequiredDependencies(root, client, { mcVersion: '1.20.1', loader: 'fabric' });

    expect(queries).toEqual([{ pid: 'dep', opts: { mcVersion: '1.20.1', loader: 'fabric' } }]);
  });

  /**
   * 实测的那个坑（2026-10）：1.20.1 + Fabric 实例装 WTHIT，前置被选成
   * `fabric-api 0.163.0+26.4` / `badpackets neo-0.12.2`（`game_versions` 只有 26.x）。
   * 现在的规则：**过滤后没有版本就一个都不装**，并把它报进 `skipped`。
   */
  it('过滤后一个版本都没有 → 不装（不拿不兼容的最新版充数）', async () => {
    const bad = ver({ id: 'v-new', project_id: 'dep', version_number: '0.163.0+26.4' });
    // 源站只有 26.x 的构建：按实例（1.20.1）过滤后为空
    const { client, queries } = fakeClient({
      dep: (opts) => (opts.mcVersion === '1.20.1' ? [] : [bad]),
    });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [{ project_id: 'dep', dependency_type: 'required' }],
    });

    const res = await collectRequiredDependencies(root, client, {
      mcVersion: '1.20.1',
      loader: 'fabric',
    });

    expect(res.dependencies).toEqual([]);
    expect(res.skipped).toContain('dep');
    // 两次查询都带 MC 版本，绝没有"不问条件直接取最新"的那一次
    expect(queries.map((q) => q.opts.mcVersion)).toEqual(['1.20.1', '1.20.1']);
    expect(queries.every((q) => q.opts.mcVersion === '1.20.1')).toBe(true);
  });

  it('选中的是过滤结果里最新的那版，不是全局最新版', async () => {
    const compatible = ver({ id: 'v-old', project_id: 'dep', version_number: '0.92.12+1.20.1' });
    const incompatible = ver({ id: 'v-new', project_id: 'dep', version_number: '0.163.0+26.4' });
    const { client } = fakeClient({
      dep: (opts) => (opts.mcVersion === '1.20.1' ? [compatible] : [incompatible, compatible]),
    });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [{ project_id: 'dep', dependency_type: 'required' }],
    });

    const res = await collectRequiredDependencies(root, client, {
      mcVersion: '1.20.1',
      loader: 'fabric',
    });

    expect(res.dependencies[0].version.id).toBe('v-old');
  });

  /**
   * 有些前置在源站上没有当前加载器的构建（或只用 `minecraft` 标记）。
   * 这时**退一步只按 MC 版本**：那一版至少 MC 版本是对的，
   * 比"一个都不装"或"装个 26.x 的"都好。
   */
  it('加载器过滤为空 → 放宽到只按 MC 版本再试一次', async () => {
    const onlyNeoforge = ver({ id: 'v-neo', project_id: 'dep' });
    const { client, queries } = fakeClient({
      dep: (opts) => (opts.loader === undefined ? [onlyNeoforge] : []),
    });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [{ project_id: 'dep', dependency_type: 'required' }],
    });

    const res = await collectRequiredDependencies(root, client, {
      mcVersion: '1.20.1',
      loader: 'fabric',
    });

    expect(res.dependencies[0].version.id).toBe('v-neo');
    // 第一次带加载器，第二次只带 MC 版本 —— 而**没有**任何一次是不带条件的
    expect(queries.map((q) => q.opts)).toEqual([
      { mcVersion: '1.20.1', loader: 'fabric' },
      { mcVersion: '1.20.1' },
    ]);
  });

  it('不过滤（缺省）时行为与旧版一致：取服务端给的第一版', async () => {
    const v1 = ver({ id: 'v-1', project_id: 'dep' });
    const v2 = ver({ id: 'v-2', project_id: 'dep' });
    const { client, queries } = fakeClient({ dep: [v1, v2] });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [{ project_id: 'dep', dependency_type: 'required' }],
    });

    const res = await collectRequiredDependencies(root, client);

    expect(res.dependencies[0].version.id).toBe('v-1');
    expect(queries[0].opts).toEqual({});
  });

  it('循环引用不会无限递归（A → B → A）', async () => {
    const a2 = ver({
      id: 'v-a',
      project_id: 'a',
      dependencies: [{ project_id: 'b', dependency_type: 'required' }],
    });
    const b2 = ver({
      id: 'v-b',
      project_id: 'b',
      dependencies: [{ project_id: 'a', dependency_type: 'required' }],
    });
    const { client } = fakeClient({ b: [b2], a: [a2] });

    // 根是 a：a → b → a，第二轮遇到 a 时应被 visited 拦下
    const res = await collectRequiredDependencies(a2, client);

    expect(res.dependencies.map((d) => d.projectId)).toEqual(['b']);
    expect(res.skipped).toContain('a');
  });

  it('拉不到某个依赖时不整体失败，其余照常收集', async () => {
    const good = ver({ id: 'v-good', project_id: 'good' });
    // 'bad' 不在 fake 的表里 → getVersions 抛错
    const { client } = fakeClient({ good: [good] });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [
        { project_id: 'bad', dependency_type: 'required' },
        { project_id: 'good', dependency_type: 'required' },
      ],
    });

    const res = await collectRequiredDependencies(root, client);

    expect(res.dependencies.map((d) => d.projectId)).toEqual(['good']);
    expect(res.skipped).toContain('bad');
  });

  it('声明了精确 version_id 时优先取那个版本', async () => {
    const v1 = ver({ id: 'v-old', project_id: 'dep', version_number: '1.0.0' });
    const v2 = ver({ id: 'v-new', project_id: 'dep', version_number: '2.0.0' });
    const { client } = fakeClient({ dep: [v2, v1] });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [{ project_id: 'dep', version_id: 'v-old', dependency_type: 'required' }],
    });

    const res = await collectRequiredDependencies(root, client);

    expect(res.dependencies[0].version.id).toBe('v-old');
  });

  /**
   * 钉的版本**只在过滤结果内**优先。
   *
   * 作者钉的 version_id 若与实例不兼容（数据质量问题时会出现），
   * 顺着退到过滤后的最新版 —— 而不是把钉的那版硬装上去。
   */
  it('钉的 version_id 不在过滤结果里 → 用过滤后的版本，不硬装', async () => {
    const compatible = ver({ id: 'v-ok', project_id: 'dep', version_number: '1.0.0' });
    const pinnedIncompatible = ver({ id: 'v-pinned', project_id: 'dep', version_number: '9.0.0' });
    const { client } = fakeClient({
      dep: (opts) => (opts.mcVersion === '1.20.1' ? [compatible] : [pinnedIncompatible]),
    });
    const root = ver({
      id: 'v-root',
      project_id: 'root',
      dependencies: [{ project_id: 'dep', version_id: 'v-pinned', dependency_type: 'required' }],
    });

    const res = await collectRequiredDependencies(root, client, { mcVersion: '1.20.1' });

    expect(res.dependencies[0].version.id).toBe('v-ok');
  });
});

/**
 * `isDatapackVersion` 决定依赖落 `mods/` 还是 `saves/<世界>/datapacks/`。
 *
 * 规则来自实测：Modrinth 上数据包构建的 `loaders` 恰好是 `["datapack"]`
 * （VeinMiner / Terralith / Dungeons and Taverns 每一版都是），mod 构建则是
 * `["neoforge"]` / `["fabric"]` 之类。项目级 `project_type` 对数据包是 `mod`，
 * 不能拿它判 —— 判错会把 `.zip` 塞进 `mods/`，加载器当 mod 扫直接崩。
 */
describe('isDatapackVersion', () => {
  it('loaders 恰好是 [datapack] → 是数据包构建', () => {
    expect(isDatapackVersion(ver({ id: 'v', project_id: 'p', loaders: ['datapack'] }))).toBe(true);
  });

  it('mod 构建（neoforge / fabric+quilt）→ 不是', () => {
    expect(isDatapackVersion(ver({ id: 'v', project_id: 'p', loaders: ['neoforge'] }))).toBe(false);
    expect(isDatapackVersion(ver({ id: 'v', project_id: 'p', loaders: ['fabric', 'quilt'] }))).toBe(
      false,
    );
  });

  it('同时标了 datapack 和 mod 加载器 → 不算纯数据包（宁可当 mod 处理）', () => {
    expect(
      isDatapackVersion(ver({ id: 'v', project_id: 'p', loaders: ['datapack', 'fabric'] })),
    ).toBe(false);
  });

  it('loaders 缺失 / 为空 → 不是（不猜）', () => {
    expect(isDatapackVersion(ver({ id: 'v', project_id: 'p' }))).toBe(false);
    expect(isDatapackVersion(ver({ id: 'v', project_id: 'p', loaders: [] }))).toBe(false);
  });
});

/**
 * 真网络冒烟：**上游此刻的真实行为**。
 *
 * `chooseVersion()` 整个逻辑都建在一个前提上：按 `{mcVersion, loader}` 过滤之后，
 * 服务端给的 `[0]` 就是能在该实例上跑的那一版。这条用例直接打 Modrinth 验证它。
 *
 * 实测（2026-10，WTHIT `fabric-8.21.1`，实例 1.20.1 + fabric）：
 *   - 不带过滤：`[0]` 是 `badpackets neo-0.12.2`（`game_versions` = 26.1–26.2）
 *     与 `fabric-api 0.163.0+26.4`（只有 `26.4-snapshot-4`）—— 装上去启动即崩
 *   - 带上过滤：`fabric-0.4.3` 与 `0.92.12+1.20.1`（`game_versions` 含 1.20.1）
 *
 * 这条变红时**别改断言**：要么上游改了过滤语义，要么 WTHIT 换了前置，
 * 两种情况都得重新确认 `chooseVersion()` 的前提还成不成立。
 */
describe('真网络冒烟：前置版本按实例过滤（上游此刻行为）', () => {
  it('1.20.1 + fabric 实例收集到的前置，每一个都支持 1.20.1', async () => {
    const client = new ModrinthApiClient();
    const roots = await client.getVersions('wthit', { mcVersion: '1.20.1', loader: 'fabric' });
    expect(roots.length).toBeGreaterThan(0);

    const { dependencies } = await collectRequiredDependencies(roots[0], client, {
      mcVersion: '1.20.1',
      loader: 'fabric',
    });

    // WTHIT 依赖 badpackets + fabric-api，所以这里必然有前置；
    // 没有前置就说明上游把依赖摘了，这条用例该重新看。
    expect(dependencies.length).toBeGreaterThan(0);
    for (const dep of dependencies) {
      expect(
        dep.version.game_versions,
        `${dep.projectId} 的版本 ${dep.version.version_number} 不支持 1.20.1`,
      ).toContain('1.20.1');
    }
  }, 30_000);
});

describe('pickPrimaryFile', () => {
  it('取 primary 标记的文件', () => {
    const v = ver({
      id: 'v',
      project_id: 'p',
      files: [
        { url: 'u1', filename: 'addon.jar', primary: false, size: 1 },
        { url: 'u2', filename: 'main.jar', primary: true, size: 2 },
      ],
    });
    expect(pickPrimaryFile(v)?.filename).toBe('main.jar');
  });

  it('没有 primary 标记时取第一个', () => {
    const v = ver({
      id: 'v',
      project_id: 'p',
      files: [
        { url: 'u1', filename: 'first.jar', primary: false, size: 1 },
        { url: 'u2', filename: 'second.jar', primary: false, size: 2 },
      ],
    });
    expect(pickPrimaryFile(v)?.filename).toBe('first.jar');
  });

  it('没有文件时返回 null', () => {
    expect(pickPrimaryFile(ver({ id: 'v', project_id: 'p', files: [] }))).toBeNull();
  });
});
