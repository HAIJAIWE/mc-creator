/**
 * 版本 → 更新日志链接。
 *
 * 拆成独立模块而不是塞在 `DownloadTab.tsx` 里：它是个纯函数，
 * 既不该和组件挤在一个文件里（`react-refresh/only-export-components`），
 * 也值得被单独测试 —— URL 规则错了不会报错，只会静默跳到 404 页。
 */

/** 中文 Minecraft Wiki 的版本页前缀。 */
export const WIKI_ORIGIN = 'https://zh.minecraft.wiki/w/';

/**
 * 该版本的更新日志地址。
 *
 * 页面标题形如「Java版26.3」，所以规则就是把版本号拼在 `Java版` 后面。
 * 正式版与快照版**同规则**（实测 `Java版26.4-snapshot-3` 返回 200）。
 *
 * 版本号做 `encodeURIComponent`：目前所有真实版本号（`1.21.11`、
 * `26.4-snapshot-3`、`b1.7.3`、`15w14a`）都不会被改动，但把用户
 * 提供的字符串直接拼进 URL 是不设防的 —— 编码后至少不会拼出畸形地址。
 */
export function wikiUrlFor(versionId: string): string {
  return `${WIKI_ORIGIN}Java版${encodeURIComponent(versionId)}`;
}
