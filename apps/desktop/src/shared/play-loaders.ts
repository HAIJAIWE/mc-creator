/**
 * 我们认的模组加载器（**玩游戏时装哪个**）—— 全应用唯一一份。
 *
 * ## 四处曾经各自手写同一份清单
 *
 * 1. `DownloadTab` 的加载器下拉（`<option>` 里手写 neoforge / fabric）
 * 2. `CurseForgeSearchPanel` 的文件筛选 chips（同样手写，还多列了 forge / quilt）
 * 3. `ModDetailView` 的 loader 角标与版本分组（`SUPPORTED_LOADERS` / `SUPPORTED`）
 * 4. 主进程 `ipc/launcher.ts` 的搜索富化（两处 `const KNOWN = [...]`）
 *
 * 四份**当时恰好一致**（除了 2 多列了两个），所以没有任何测试会红 ——
 * 这是漂移最危险的形态：没人改它，但它已经不一致了；某天有人「顺手补全」
 * 其中一处，行为就开始分叉。现在统一指到这里。
 *
 * ## 这是第三份「加载器清单」，别和另外两份混用
 *
 * - `@mc-creator/shared` 的 `LOADERS`：全量枚举（含已停更的），给类型用。
 * - `shared/generator-descriptors.ts` 的 `SUPPORTED_GENERATOR_LOADERS`：
 *   「**生成** mod 项目时面向哪个平台」。
 * - 本文件：`PLAY_LOADER_FILTERS`，「**玩游戏时**装哪个加载器」。
 *
 * 三者领域不同，取值范围也不完全一样（生成器侧有 `forge` 适配器，
 * 但下载侧不认它）。所以是三个常量 —— 但**同一个领域内只能有一份**。
 *
 * ## 与 IPC 契约的关系（谁管谁）
 *
 * 「能装哪几个加载器」在协议层是 schema：`LauncherInstallLoaderRequest.loader`
 * 与 `InstanceLoader`。schema 是**契约**，是权威；本常量是**策略**。
 * 两者今天取值一致（`InstanceLoader` = 本清单 + `vanilla`），但不是靠人眼维持 ——
 * `play-loaders.test.ts` 里有断言把两者钉在一起：谁单独改了 schema，测试会红，
 * 逼出一次有意识的决定。**刻意不**让 schema 从数组反向生成：契约应该能独立
 * 存在（契约改了要影响编译期类型，而不是被一个 UI 数组牵着走）。
 *
 * ## 为什么只有两个
 *
 * 实测 1.21.1 上 NeoForge / Fabric 下载量几乎持平（23547 / 22663），
 * 是当下的双主力；Forge 已停止大版本更新（团队转做 NeoForge），
 * Quilt 生态体量小。都不进筛选器。
 *
 * ## ⚠️ 拿掉一个加载器 ≠ 列表里看不到它
 *
 * 两个筛选入口（`DownloadTab` 的加载器下拉、`CurseForgeSearchPanel` 的文件
 * 筛选）**默认都是「全部」**，各自把「全部」映射成「不加筛选条件」：
 * 前者请求时不带 `loader`，后者渲染全部文件。所以这份清单决定的是
 * 「能**只看**哪几个」，不是「能**看到**哪几个」—— 别为了它去动搜索范围。
 * （主进程那两处富化不一样：那是**真的**把值从数据里剔掉了。）
 */
export const PLAY_LOADER_FILTERS = ['neoforge', 'fabric'] as const;

/** 筛选器里开放的值。 */
export type PlayLoaderFilter = (typeof PLAY_LOADER_FILTERS)[number];
