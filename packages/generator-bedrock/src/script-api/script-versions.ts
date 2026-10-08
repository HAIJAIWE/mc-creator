/**
 * 基岩版「包格式 / Script API 模块版本」查表（设计文档 §8.4「查表、禁止写死」）。
 *
 * 为什么必须查表而不是在生成器里写一个常量
 * ──────────────────────────────────────
 * 1) `format_version`：基岩 add-on 的 manifest format_version 是 2（3 仍是
 *    preview），但把「2」散落在生成器里，等 Minecraft 上调 manifest 语法时
 *    所有生成器都要跟着搜一遍字符串。集中成表后升级只改一处。
 *    来源：minecraft.wiki「Manifest.json」——format_version 为 1（skin pack）/
 *    2（resource、behavior、world template）/ 3（preview 新增）。
 * 2) `min_engine_version`：Script API 包必须声明**至少能提供所声明的
 *    `@minecraft/server` 版本**的引擎版本，写高了包直接加载失败。
 * 3) `@minecraft/server` / `@minecraft/server-ui` 依赖版本：manifest 里的
 *    `dependencies[].version` 决定脚本能看到的 API 面。声明一个游戏没有的
 *    版本 → import 失败、脚本不执行。
 *
 * 表项推导方式（2026-10 在线核验，npm registry 实抓）
 * ──────────────────────────────
 * npm 上每个稳定版 `X.Y.0` 都配有一串预发布标签，标签里的 MC 版本就是「该稳定版
 * 是从哪个 MC 分支上出来的」。**关键：预发布标签有两族，必须都查。**
 *
 *   - `<ver>-beta.<MC版本>-stable`      —— 来自 stable 分支
 *   - `<ver>-beta.<MC版本>-preview.<n>` —— 来自 preview 分支
 *
 * ⚠️ 只查 `-stable` 一族会**得出错误结论**。实测反例：`1.5.0` 与 `1.13.0`
 * **完全没有** `-stable` 标签，只有 `-preview` 标签
 * （`1.5.0-beta.1.20.20-preview.*`、`1.13.0-beta.1.21.10-preview.*`）。
 * 当时按 `-stable` 单族反推，误判这两个版本的来源并以为本表推导有误 ——
 * 合并两族后本表的推导全部成立。
 *
 * 两族合并后的真实来源（registry 实测节选）：
 *
 *   @minecraft/server   1.2.0←1.19.80 | 1.3.0←1.20.0   | 1.5.0←1.20.20
 *                       1.8.0←1.20.50 | 1.13.0←1.21.10 | 1.18.0←1.21.60
 *                       2.2.0←1.21.100 | 2.6.0←1.26.0 | 2.8.0←1.26.20
 *   @minecraft/server-ui 1.0.0←1.19.60 | 1.2.0←1.20.10 | 1.3.0←1.21.20
 *                       2.0.0←1.21.70 | 2.1.0←1.21.90
 *
 * 取值策略：**宁可低不取高**。声明的模块版本低于游戏内置版本是安全的（旧 API 面
 * 仍在）；高于游戏内置版本会直接 import 失败。所以本表只承诺「不超出」。
 *
 * 实测结论（2026-10，registry 逐条比对）：本表 16 个依赖声明**全部**覆盖其
 * `min_engine_version` 对应的 Bedrock 版本，故无 import 失败风险；其中 4 项
 * （1.20.1 / 1.20.4 / 26.1 / 26.2）比当时可用的最大版本低一档，属刻意的保守取值。
 * 该结论由 `packages/core/src/ci/verify-bedrock-script-versions.test.ts`
 * （`VERIFY_VERSIONS=1`）按上述两族标签自动复核，表漂移即测试失败。
 *
 * ⚠️ 表放在本包而非 `packages/shared/src/validation/pack-format.ts`：
 * 该文件已有资源包 pack_format 表（1.20.5 起资源包/数据包编号分家），但
 * 行为包 + Script API 模块版本是另一套编号体系，本次任务的文件改动范围限定在
 * `packages/generator-bedrock/`，故先就近建表；后续若放开 shared 的改动范围，
 * 应把本表合并进 pack-format.ts（§8.4 的「查表」是意图，就近建表不改变意图）。
 */

/** 单个 MC 版本对应的基岩包格式与 Script API 模块版本 */
export interface BedrockScriptVersions {
  /** 行为包 manifest format_version（1 = skin pack，2 = add-on，3 = preview） */
  packFormat: number;
  /** 行为包 header.min_engine_version，缺省走本表而非写死 */
  minEngineVersion: [number, number, number];
  /** @minecraft/server 稳定版依赖版本 */
  serverModule: string;
  /** @minecraft/server-ui 稳定版依赖版本（与 server 大版本对齐，见文件头推导） */
  serverUiModule: string;
}

/** MC 版本 → 基岩包格式 / Script API 模块版本 */
export const BEDROCK_SCRIPT_VERSIONS: Record<string, BedrockScriptVersions> = {
  '1.20.1': {
    packFormat: 2,
    minEngineVersion: [1, 20, 0],
    serverModule: '1.2.0',
    serverUiModule: '1.0.0',
  },
  '1.20.4': {
    packFormat: 2,
    minEngineVersion: [1, 20, 30],
    serverModule: '1.5.0',
    serverUiModule: '1.0.0',
  },
  '1.20.6': {
    packFormat: 2,
    minEngineVersion: [1, 20, 60],
    serverModule: '1.8.0',
    serverUiModule: '1.1.0',
  },
  '1.21.1': {
    packFormat: 2,
    minEngineVersion: [1, 21, 10],
    serverModule: '1.13.0',
    serverUiModule: '1.2.0',
  },
  '1.21.5': {
    packFormat: 2,
    minEngineVersion: [1, 21, 60],
    serverModule: '1.18.0',
    serverUiModule: '1.3.0',
  },
  '1.21.11': {
    packFormat: 2,
    minEngineVersion: [1, 21, 110],
    serverModule: '2.2.0',
    serverUiModule: '2.0.0',
  },
  '26.1': {
    packFormat: 2,
    minEngineVersion: [1, 26, 10],
    serverModule: '2.6.0',
    serverUiModule: '2.0.0',
  },
  '26.2': {
    packFormat: 2,
    minEngineVersion: [1, 26, 30],
    serverModule: '2.8.0',
    serverUiModule: '2.0.0',
  },
};

/**
 * 未知 MC 版本时的回退项：取表中**最旧**的一行。
 *
 * 为什么回退到最旧而不是最新：`min_engine_version` 声明高了包直接不加载，
 * `dependencies` 声明高了 import 直接失败 —— 对未知版本而言「保守」永远比
 * 「激进」安全。调用方应同时产出 warning 提示用户显式指定版本。
 */
const FALLBACK_KEY = '1.20.1';

export interface ResolvedScriptVersions {
  versions: BedrockScriptVersions;
  /** 是否命中查表（false 表示走了回退，调用方应产出 warning） */
  known: boolean;
}

/**
 * 按 MC 版本解析包格式与 Script API 模块版本；未命中走保守回退。
 *
 * @param mcVersion 调用方的目标 MC 版本字符串（ctx.mcVersion）
 * @param overrideServerModule 调用方显式指定的 @minecraft/server 版本（优先于查表）
 * @param overrideServerUiModule 调用方显式指定的 @minecraft/server-ui 版本
 */
export function resolveScriptVersions(
  mcVersion: string | undefined,
  overrideServerModule?: string,
  overrideServerUiModule?: string,
): ResolvedScriptVersions {
  const hit = mcVersion !== undefined ? BEDROCK_SCRIPT_VERSIONS[mcVersion] : undefined;
  const known = hit !== undefined;
  const base = hit ?? BEDROCK_SCRIPT_VERSIONS[FALLBACK_KEY];
  return {
    known,
    versions: {
      packFormat: base.packFormat,
      minEngineVersion: base.minEngineVersion,
      serverModule: overrideServerModule ?? base.serverModule,
      serverUiModule: overrideServerUiModule ?? base.serverUiModule,
    },
  };
}

/**
 * `@minecraft/server` 模块的 API 家族。
 *
 * 为什么要分家族：Script API 1.x 与 2.x 的事件集合**并不相同**（例如
 * `worldInitialize`（1.x）在 2.x 改名为 `worldLoad`；`chatSend` 系列在 2.x 被
 * 移除）。按单一白名单生成会产出 `.subscribe()` 调用一个不存在的属性 —— 那在
 * 运行时是 TypeError，整个脚本模块加载失败，一个事件写错会连带所有逻辑失效。
 * 故按家族各存一份**从官方 d.ts 实读**的事件表。
 */
export type ServerApiFamily = '1.x' | '2.x';

/** 由 `@minecraft/server` 版本号推导 API 家族（大版本 ≥ 2 即 2.x） */
export function serverApiFamilyOf(serverModuleVersion: string): ServerApiFamily {
  const major = Number.parseInt(serverModuleVersion.split('.')[0] ?? '', 10);
  return Number.isFinite(major) && major >= 2 ? '2.x' : '1.x';
}

/**
 * 实验性（beta）模块版本后缀。
 *
 * manifest 里「声明用了实验性 API」的真实载体就是依赖版本号上的 `-beta`
 * 后缀：微软官方 GameTest 教程与 Scripting 文档都用
 * `{ "module_name": "@minecraft/server", "version": "1.13.0-beta" }`
 * 表示实验性依赖，并要求世界侧开启「Beta APIs」实验。
 * （自 v1.21.120 起还可以写 `"version": "beta"` 跟随最新 beta，但那样就
 * 锁死了具体 beta 版本、无法复现，故仍拼具体版本号。）
 */
export function betaVersionSuffix(version: string): string {
  return version.includes('-beta') ? version : `${version}-beta`;
}
