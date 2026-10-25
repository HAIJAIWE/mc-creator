/**
 * 从 CurseForge 的文件列表里挑一个**能给目标实例用**的文件。
 *
 * ## 为什么需要挑
 *
 * `/mods/{id}/files` 返回的是这个项目的**全部**文件（按发布时间倒序），
 * 一份 NeoForge 构建和一份 Fabric 构建混在一起。老实现直接取 `files[0]`，
 * 于是「1.20.1 + Fabric 的实例」会拿到最新版的 **NeoForge** jar —— 装进去
 * 游戏起不来，而用户看到的是"下载成功了"。Modrinth 分支早就修过同一个坑
 * （见 `ipc/launcher.ts` 的 `versionFilterOf` 注释），CF 分支当时漏了。
 *
 * ## 为什么单独成文件
 *
 * 这段判据的输入是「源站的响应形状」，而那个形状**只能实测**：`modLoaders`
 * 字段整个不存在、loader 名混在 `gameVersions` 里、`fileDate` 才是排序依据。
 * 放在 IPC handler 里就没法为它写用例，只能靠"打开应用看一眼"。
 */
import { curseforgeLoaderKey, type CurseForgeFile } from '@mc-creator/core';

/** 目标实例对文件的要求。两个条件都可缺省（缺省 = 不按该项过滤）。 */
export interface CfFileNeed {
  /** 目标实例的 MC 版本（如 `1.21.1` / `26.3`） */
  mcVersion?: string;
  /**
   * 目标实例的加载器（如 `fabric` / `neoforge`）。
   *
   * ⚠️ 调用方要先处理掉 Modrinth 专有的 `datapack` 值 —— CF 侧没有这个
   * 加载器（数据包靠 classId 分类），传进来会让所有文件都匹配不上。
   */
  loader?: string;
}

/**
 * 返回最合适的一个文件；**没有能用的就返回 null**（由调用方报错）。
 *
 * 判定顺序：
 *   1. MC 版本必须命中（`gameVersions` 已由客户端归一化，不含 loader 名）
 *   2. 要 loader 时必须命中（经 `curseforgeLoaderKey` 归一：`forge-43.2.0`
 *      也算 forge，且 `neoforge` 不会被当成 `forge`）
 *   3. 多条命中时按 `fileDate` 倒序取最新 —— **不依赖接口的返回顺序**，
 *      接口当前是倒序但这属于行为不是承诺
 */
export function pickCurseForgeFile(
  files: readonly CurseForgeFile[],
  need: CfFileNeed,
): CurseForgeFile | null {
  const fits = files.filter((f) => {
    if (need.mcVersion !== undefined && !f.gameVersions.includes(need.mcVersion)) return false;
    if (need.loader === undefined) return true;
    return f.modLoaderNames.some((n) => curseforgeLoaderKey(n) === need.loader);
  });
  if (fits.length === 0) return null;
  return (
    [...fits].sort((a, b) => {
      const ta = Date.parse(a.fileDate ?? '');
      const tb = Date.parse(b.fileDate ?? '');
      // 日期缺失/不可解析时保持原顺序（返回 0），而不是把它排到最后 ——
      // 「不知道谁更新」不等于「它最旧」。
      if (Number.isNaN(ta) || Number.isNaN(tb)) return 0;
      return tb - ta;
    })[0] ?? null
  );
}

/** 给报错文案用：把要求说成人话（`1.21.1 + fabric`）。 */
export function describeCfFileNeed(need: CfFileNeed): string {
  return (
    `${need.mcVersion ?? '任意 MC 版本'}` + (need.loader === undefined ? '' : ` + ${need.loader}`)
  );
}
