/**
 * Parchment 参数名映射配置（设计文档 §8.4）。
 *
 * Parchment 叠加在 Mojang 官方映射上，把无意义的 p_ 参数名变为可读名。
 * 配置写法按构建插件区分（Gradle DSL 不同）：
 * - ModDevGradle（NeoForge）：neoForge { parchment { minecraftVersion / mappingsVersion } } 块。
 *   依据：NeoForged Toolchain 文档 parchment 页（DSL 片段与 gradle.properties
 *   neoForge.parchment.* 等价；本生成器采用 DSL 块，以便与现有 DSL 拼接逻辑一致）。
 * - ForgeGradle（Forge）：minecraft { mappings channel: 'parchment', version: '<mappings>-<mc>' }，
 *   即用 parchment 单行替换 official 单行。
 *   依据：ParchmentMC getting-started（"Update your mappings channel and version to the
 *   parchment channel"）+ 社区 1.20.1 实例（Greate forge-1.20.1 分支 build.gradle；
 *   Forge 论坛缓存路径 1.20.1-47.4.0_mapped_parchment_2023.09.03-1.20.1）。
 *
 * 版本对照表说明（已在线核实，见下）：
 * - 数据源头：https://maven.parchmentmc.org（构建时解析构件的同一仓库），
 *   逐版本读 maven-metadata.xml 的 <release>（2026-10-06 实测）；
 *   文档页 https://parchmentmc.org/docs/getting-started 只给格式与 DSL 写法，
 *   版本徽章是图片无法抓取，故以仓库元数据为准。
 * - 缺条目的 MC 版本一律不输出 parchment 块（宁缺毋错：版本号写错会导致构建必败）；
 *   26.x 无构件（未混淆无需映射，与 fabric-gradle 无 mappings 行一致），正确缺席。
 */

/** Parchment 版本对照条目：MC 版本 → 该版本可用的 Parchment 映射版本。 */
export interface ParchmentMapping {
  /** Parchment 映射所针对的 MC 版本（一般等于表键）。 */
  minecraftVersion: string;
  /** Parchment 映射版本（形如 2023.09.03，不含 -MC 后缀；Forge 行由本模块拼出全版本）。 */
  mappingsVersion: string;
}

/**
 * MC 版本 → Parchment 映射版本对照表（集中常量，见文件头注释）。
 * 缺条目的 MC 版本对应两处 block 函数返回 null，调用方输出保持原样。
 */
export const PARCHMENT_VERSIONS: Record<string, ParchmentMapping> = {
  '1.20.1': { minecraftVersion: '1.20.1', mappingsVersion: '2023.09.03' },
  '1.20.4': { minecraftVersion: '1.20.4', mappingsVersion: '2024.04.14' },
  '1.20.6': { minecraftVersion: '1.20.6', mappingsVersion: '2024.06.16' },
  '1.21.1': { minecraftVersion: '1.21.1', mappingsVersion: '2024.11.17' },
  '1.21.5': { minecraftVersion: '1.21.5', mappingsVersion: '2025.06.15' },
  '1.21.11': { minecraftVersion: '1.21.11', mappingsVersion: '2025.12.20' },
};

/**
 * ModDevGradle 写法：neoForge / moddev DSL 内的 parchment { } 块。
 * 返回片段按 neoForge { } 块内缩进（4 空格）；legacy moddev 分支由调用方统一再缩进。
 * 无条目返回 null。
 */
export function parchmentModDevGradleBlock(mcVersion: string): string | null {
  const mapping = PARCHMENT_VERSIONS[mcVersion] ?? null;
  if (!mapping) return null;
  return [
    `    // Parchment 参数名映射（§8.4）：叠加于 Mojang 官方映射，把 p_ 参数名变可读（版本对照见 parchment.ts，maven 元数据已核实）`,
    `    parchment {`,
    `        minecraftVersion = "${mapping.minecraftVersion}"`,
    `        mappingsVersion = "${mapping.mappingsVersion}"`,
    `    }`,
  ].join('\n');
}

/**
 * ForgeGradle 写法：minecraft { } 块内的 mappings channel parchment 相关配置。
 * 返回片段按 minecraft { } 块内缩进（4 空格）。无条目返回 null。
 *
 * 注意：已核实的 ForgeGradle 写法是用 parchment 单行替换 official 单行；
 * 同时保留两行 active mappings 会依赖“后写优先”这一未核实语义（不要臆测 DSL），
 * 且既有用例已钉死 official 行，因此此处输出注释式 opt-in：默认构建行为不变，
 * 用户把注释行取消注释并替换 official 行即启用。
 */
export function parchmentForgeBlock(mcVersion: string): string | null {
  const mapping = PARCHMENT_VERSIONS[mcVersion] ?? null;
  if (!mapping) return null;
  return [
    `    // Parchment 参数名映射（§8.4）：启用时用下一行替换上面的 official mappings 行（版本对照见 parchment.ts，[待核实]）`,
    `    // mappings channel: 'parchment', version: '${mapping.mappingsVersion}-${mapping.minecraftVersion}'`,
  ].join('\n');
}
