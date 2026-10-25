/**
 * 单个 mod 的依赖递归收集（Modrinth / CurseForge）。
 *
 * 为什么必须有：绝大多数 mod 不是自足的。Sodium 依赖 Fabric API，
 * 大部分 Fabric mod 依赖 Fabric API。没有前置的话下载下来装进实例，
 * 启动直接崩 —— 用户会认为「下载功能坏了」，而不是「少了个前置」。
 * PCL / HMCL 都会在下载时把前置一起拉下来（HMCL 文档：「如果该模组有前置，
 * HMCL 会自动提示，请先安装所有前置模组」）。
 *
 * 关键约束：**只在 required 上递归**。
 * - `optional`：装了可能更好，不装也能跑，不自动装（PCL 同样不装）
 * - `incompatible`：装它反而会坏，应该提示冲突而不是自动装
 * - `embedded`：已经打进主文件里了，再装一份是重复
 *
 * 关键约束 2：**依赖版本必须按目标实例过滤**（MC 版本 + 加载器）。
 * 取「依赖的最新版」在真实数据上会把 26.x 的 Fabric API 装进 1.20.1 实例 ——
 * 见 {@link chooseVersion} 里那份实测记录。
 */

import type { ModrinthApiClient, ModrinthVersion } from './api-client.js';

/** 递归收集的深度上限。超过就停手，不无限递归。
 *
 *  3 层足够覆盖 Fabric API → QSL → … 这类链；再深要么是环要么是病态数据。
 *  与 `visited`（本次递归已展开过的 project id）**双保险**：
 *  深度挡住病态长链，visited 挡住 A→B→A 这种环，避免栈被打爆。 */
const MAX_DEPTH = 3;

export interface DependencyDownload {
  /** Modrinth project id */
  projectId: string;
  /** 该依赖选中的版本（可直接用它的 files[].url 下载） */
  version: ModrinthVersion;
  /** 从根到它的依赖路径，用于展示「A 需要 B 需要 C」 */
  via: string[];
}

export interface CollectResult {
  /** 需要一起下载的依赖（按依赖深度浅→深，保证前置先下） */
  dependencies: DependencyDownload[];
  /** 循环引用 / 深度超限 / **找不到兼容版本**的项目 id（已在别处处理或放弃展开） */
  skipped: string[];
}

/**
 * 目标实例「能跑起来」的两个硬条件。
 *
 * 两个都是 Modrinth 服务端的过滤参数（`game_versions` / `loaders`），
 * 所以在选版本时就把不兼容的筛掉，而不是下完再比。
 */
export interface DependencyFilter {
  /** 实例的 MC 版本，如 `1.20.1`。 */
  mcVersion?: string;
  /** 实例的加载器（`fabric` / `neoforge`）。原版实例不传。 */
  loader?: string;
}

/**
 * 递归收集 required 依赖。
 *
 * @param version 根版本（用户点下载的那个）
 * @param client  Modrinth 客户端（复用已有的重试/超时/限流逻辑）
 * @param filter  目标实例的 MC 版本 / 加载器。**必传**才能保证装得对；
 *   缺省即"不过滤"（服务端返回的最新版），行为与旧版一致。
 * @param nameOf  由 project id 拿可读名（用于拼 via 路径）
 *
 * 这里**没有**"跳过已装"参数：想按 project id 跳过，得先把实例里已装的
 * 文件映射回 project id，而我们没有那份映射。以前那个参数声称收 project id，
 * 调用方传的却是文件名，两边永远对不上 —— 等于从没生效过。真正防重复下载的是
 * 调用方落盘前的逐文件比对（`existsSync(depDir/filename)`），那一步是准的。
 */
export async function collectRequiredDependencies(
  version: ModrinthVersion,
  client: ModrinthApiClient,
  filter: DependencyFilter = {},
  nameOf: (projectId: string) => string = (id) => id,
): Promise<CollectResult> {
  const out: DependencyDownload[] = [];
  const skipped: string[] = [];
  /**
   * 本次递归中已展开过的 project id，防环。
   *
   * **必须把根项目自己先放进来** —— 否则 A → B → A 这种环会把根 A
   * 当成一个新依赖收进去，用户平白多下一个自己的 mod。
   */
  const visited = new Set<string>([version.project_id]);

  async function walk(current: ModrinthVersion, depth: number, path: string[]): Promise<void> {
    if (depth > MAX_DEPTH) return;
    const deps = current.dependencies ?? [];
    for (const dep of deps) {
      // 只处理 required：optional 不自动装、incompatible 要提示、embedded 已内嵌
      if (dep.dependency_type !== 'required') continue;
      // `project_id` 可为 null（整合包用它表示「自带文件」）。
      // required 依赖没有 project_id 是病态数据，跳过而不是当成 "" 去查。
      const pid = dep.project_id;
      if (typeof pid !== 'string' || pid.length === 0) continue;
      // 环：本轮已展开过就别再展开
      if (visited.has(pid)) {
        skipped.push(pid);
        continue;
      }
      visited.add(pid);
      try {
        const chosen = await chooseVersion(client, pid, dep.version_id, filter);
        if (chosen === null) {
          // 过滤后一个可用版本都没有：少装并报出来，不塞一个跑不起来的充数
          skipped.push(pid);
          continue;
        }
        const nextPath = [...path, nameOf(pid)];
        out.push({ projectId: pid, version: chosen, via: nextPath });
        await walk(chosen, depth + 1, nextPath);
      } catch {
        // 拉不到就让用户自己装，不能因为一个依赖挂了就整个下载失败
        skipped.push(pid);
      }
    }
  }

  await walk(version, 0, [nameOf(version.project_id)]);
  return { dependencies: out, skipped };
}

/**
 * 给依赖挑一个**能在目标实例上跑**的版本。
 *
 * 为什么必须有这一步（实测，2026-10）：以前这里是 `getVersions(pid, {})` 取 `[0]`，
 * 也就是"最新版"。在 1.20.1 + Fabric 实例上下载 WTHIT，前置被选成
 *   - `fabric-api 0.163.0+26.4`（`game_versions` 只有 `26.4-snapshot-4`）
 *   - `badpackets neo-0.12.2`（`game_versions` 是 26.1–26.2）
 * 而正确版本是 `fabric-api 0.92.12+1.20.1` 与 `badpackets fabric-0.4.3`。
 * 把 26.x 的 Fabric API 装进 1.20.1 实例 = 启动即崩，而界面上写着"前置已装"。
 *
 * 两级策略：
 * 1. 按 `{mcVersion, loader}` 精确过滤（两个都是服务端参数，不兼容的压根不回）；
 * 2. 只有加载器过滤导致空结果时，退一步**只按 MC 版本**再问一次 —— 有些前置没有
 *    当前加载器的构建（或只用 `minecraft` 标记），但那一版至少 MC 版本是对的。
 * 退到底还是空 → `null`，调用方如实报"没装"。
 *
 * 版本里声明的精确 `version_id` **只在过滤结果内**优先（作者钉的版本通常最稳）；
 * 它若与实例不兼容就顺着退到过滤后的最新版，而不是硬装。
 */
async function chooseVersion(
  client: ModrinthApiClient,
  projectId: string,
  pinnedVersionId: string | null | undefined,
  filter: DependencyFilter,
): Promise<ModrinthVersion | null> {
  const pick = (list: ModrinthVersion[]): ModrinthVersion | null =>
    (pinnedVersionId ? list.find((v) => v.id === pinnedVersionId) : undefined) ?? list[0] ?? null;

  const strict: { mcVersion?: string; loader?: string } = {};
  if (filter.mcVersion !== undefined && filter.mcVersion !== '')
    strict.mcVersion = filter.mcVersion;
  if (filter.loader !== undefined && filter.loader !== '') strict.loader = filter.loader;

  const hit = pick(await client.getVersions(projectId, strict));
  if (hit !== null || strict.loader === undefined) return hit;

  const loose = strict.mcVersion === undefined ? {} : { mcVersion: strict.mcVersion };
  return pick(await client.getVersions(projectId, loose));
}

/**
 * 这一版文件是不是**数据包构建**。
 *
 * 判据是版本自己的 `loaders`：数据包构建恰好是 `["datapack"]`，mod 构建是
 * `["neoforge"]` / `["fabric","quilt"]` 之类（实测 VeinMiner / Terralith /
 * Dungeons and Taverns 的每一版都是二者之一，没有混合）。
 *
 * **不能用 project 的 `project_type`**：Modrinth 把数据包建模成
 * `project_type: "mod"`（实测 Terralith / Dungeons and Taverns / VeinMiner 全是
 * `mod` + `loaders: ["datapack", …]`）。按 project_type 判会把数据包 `.zip`
 * 塞进 `mods/`，而加载器会把 zip 当 mod 扫 —— 症状是启动崩。
 */
export function isDatapackVersion(version: ModrinthVersion): boolean {
  const loaders = version.loaders ?? [];
  return loaders.length > 0 && loaders.every((l) => l === 'datapack');
}

/**
 * 从 ModrinthVersion 里挑主文件（`primary: true` 的那个，或第一个）。
 *
 * 依赖下载时必须用它 —— 一个 version 可能有多个文件（主 mod + 附加），
 * 下错文件等于什么都没装。
 */
export function pickPrimaryFile(version: ModrinthVersion): ModrinthVersion['files'][number] | null {
  return version.files.find((f) => f.primary) ?? version.files[0] ?? null;
}
