/**
 * CurseForge 侧的依赖处理（与 Modrinth 侧 dependencies.ts 并列）。
 *
 * 差别在于两边模型不同：
 * - Modrinth：版本级 `dependencies: [{project_id, version_id, dependency_type}]`，
 *   能精确知道依赖哪个版本、是不是可选 → **可以自动下载**。
 * - CurseForge：**文件级** `dependencies: [{modId, relationType}]`，没有版本号
 *   （拿不准该装哪个版本），所以**不自动下载**，只把「必需前置」列出来提示
 *   用户自己去装。
 *
 * ⚠️ 关于 `relationType`（曾经这里写着"没有必需/可选标记"，那是**错的**）：
 * 实测（2026-10-17，走 MCIM 镜像）拿真实关系对钉死的表 ——
 *
 *   | 关系对                                                      | relationType |
 *   | ----------------------------------------------------------- | ------------ |
 *   | Iris Shaders → Sodium（Iris 没 Sodium 起不来）               | 3            |
 *   | Xaero's Minimap (fabric) → Fabric API（Fabric mod 的硬前置） | 3            |
 *   | Xaero's Minimap → Xaero's World Map / Open Parties and Claims | 2            |
 *   | JEI 26.3 → MezzConfig / MezzConfigGUI                        | 3 / 2        |
 *
 * ⇒ 3 = 必需、2 = 可选（其余值照官方枚举名留着：1 内置库、4 工具、5 不兼容、
 * 6 内含）。**只有 3 值得报给用户** —— 把可选依赖也报成"缺前置会导致启动失败"
 * 就是虚惊一场（JEI 装上时会同时列出可选的 MezzConfigGUI）。
 *
 * 递归、自动下载都**不做**：把不该装的东西自动塞进实例比不装更糟（装错版本 =
 * 启动直接崩，而且用户不知道是谁装的）。
 */

import type { CurseForgeFileDependency } from './api-client.js';

/** `relationType`：必需的依赖（没有它加载器/游戏会报错）。 */
export const CF_RELATION_REQUIRED = 3;

/** `relationType`：可选的依赖（缺了少个功能，但能进游戏）。 */
export const CF_RELATION_OPTIONAL = 2;

export interface CfDependencyHint {
  /** 依赖的 modId（CF 项目 id） */
  modId: number;
  /** 项目主页，UI 做成可点链接让用户自己去看 */
  url: string;
}

/** 从一个 CF 文件里抽出它的依赖（去重，按 modId）。 */
export function dependenciesOf(file: {
  dependencies?: CurseForgeFileDependency[];
}): CurseForgeFileDependency[] {
  const seen = new Set<number>();
  const out: CurseForgeFileDependency[] = [];
  for (const d of file.dependencies ?? []) {
    if (seen.has(d.modId)) continue;
    seen.add(d.modId);
    out.push(d);
  }
  return out;
}

/**
 * 从一个 CF 文件里抽出**必需**依赖的 modId（去重）。
 *
 * `relationType` 缺失时按**必需**处理：源站将来把它删了的话，宁可多报一句
 * 也不能对可能的硬前置装聋作哑。
 */
export function requiredDependencyIds(file: {
  dependencies?: CurseForgeFileDependency[];
}): number[] {
  return dependenciesOf(file)
    .filter((d) => d.relationType === undefined || d.relationType === CF_RELATION_REQUIRED)
    .map((d) => d.modId);
}

/**
 * 把**必需**依赖变成可点击的提示。
 *
 * **不递归、不自动下载** —— 见文件头说明。
 */
export function toHints(file: { dependencies?: CurseForgeFileDependency[] }): CfDependencyHint[] {
  return requiredDependencyIds(file).map((modId) => ({
    modId,
    url: `https://www.curseforge.com/minecraft/mc-mods/${modId}`,
  }));
}
