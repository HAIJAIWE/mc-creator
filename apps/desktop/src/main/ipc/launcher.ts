/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain, dialog, app, shell } from 'electron';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { join, basename, dirname, relative } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import * as nodeFs from 'fs';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { z } from 'zod';
import { LauncherService, resolveInside } from '../launcher-service.js';
import { InstanceRegistry } from '../instance-registry.js';
import { createVanillaServerInstance } from '../server-instance.js';
import { createResilientFetch } from '../resilient-fetch.js';
import { electronNetFetch } from '../electron-proxy-fetch.js';
import { serverRootDir } from './process-supervisor.js';
import {
  LAUNCHER_LIST_VERSIONS,
  LAUNCHER_DOWNLOAD,
  LAUNCHER_DOWNLOAD_PROGRESS,
  LAUNCHER_DOWNLOAD_SERVER,
  LAUNCHER_CREATE_SERVER_INSTANCE,
  LAUNCHER_LAUNCH,
  LAUNCHER_INSTALL_LOADER,
  LAUNCHER_LIST_MODS,
  LAUNCHER_INSTALL_MOD,
  LAUNCHER_REMOVE_MOD,
  LAUNCHER_INSTALL_SKIN,
  LAUNCHER_TOGGLE_MOD,
  LAUNCHER_LIST_INSTANCE_FILES,
  LAUNCHER_LIST_WORLDS,
  LauncherListWorldsRequest,
  LauncherListWorldsResponse,
  LAUNCHER_LOG_STREAM,
  LAUNCHER_LOG_STREAM_CHUNK,
  LAUNCHER_GAME_EXIT,
  LAUNCHER_READ_LATEST_LOG,
  LAUNCHER_LIST_CRASH_REPORTS,
  LAUNCHER_READ_CRASH_REPORT,
  LAUNCHER_LIST_INSTANCES,
  LAUNCHER_CREATE_INSTANCE,
  LAUNCHER_UPDATE_INSTANCE,
  LAUNCHER_DELETE_INSTANCE,
  LAUNCHER_OPEN_INSTANCE_FOLDER,
  LauncherListInstancesResponse,
  LauncherCreateInstanceRequest,
  LauncherCreateInstanceResponse,
  LauncherUpdateInstanceRequest,
  LauncherUpdateInstanceResponse,
  LauncherDeleteInstanceRequest,
  LauncherDeleteInstanceResponse,
  LauncherOpenInstanceFolderRequest,
  LauncherOpenInstanceFolderResponse,
  LauncherListVersionsResponse,
  LauncherDownloadRequest,
  LauncherDownloadResponse,
  LauncherDownloadServerRequest,
  LauncherDownloadServerResponse,
  LauncherCreateServerInstanceRequest,
  LauncherCreateServerInstanceResponse,
  LauncherLaunchRequest,
  LauncherLaunchResponse,
  LauncherInstallLoaderRequest,
  LauncherInstallLoaderResponse,
  LauncherListModsResponse,
  LauncherListModsRequest,
  LauncherInstallModRequest,
  LauncherInstallModResponse,
  LauncherRemoveModRequest,
  LauncherInstallSkinRequest,
  LauncherInstallSkinResponse,
  LauncherToggleModRequest,
  LauncherToggleModResponse,
  LauncherListInstanceFilesRequest,
  LauncherListInstanceFilesResponse,
  LauncherReadLatestLogRequest,
  LauncherReadLatestLogResponse,
  LauncherListCrashReportsRequest,
  LauncherListCrashReportsResponse,
  LauncherReadCrashReportRequest,
  LauncherReadCrashReportResponse,
  LauncherLogStreamRequest,
  LauncherLogStreamChunk,
  LAUNCHER_SEARCH_MODS,
  LAUNCHER_DOWNLOAD_MOD,
  LauncherSearchModsRequest,
  LauncherSearchModsResponse,
  LAUNCHER_GET_MOD_DETAIL,
  LauncherGetModDetailRequest,
  LauncherGetModDetailResponse,
  LAUNCHER_DOWNLOAD_URL,
  LauncherDownloadUrlRequest,
  LAUNCHER_INSTALL_MODPACK,
  LAUNCHER_CANCEL_MODPACK,
  LAUNCHER_MODPACK_PROGRESS,
  LAUNCHER_MOD_CN_ALIAS,
  LauncherModCnAliasRequest,
  LauncherModCnAliasResponse,
  LauncherInstallModpackRequest,
  LauncherInstallModpackResponse,
  LauncherCancelModpackRequest,
  LauncherCancelModpackResponse,
  LauncherDownloadUrlResponse,
  LauncherDownloadModRequest,
  type ContentKind,
  LAUNCHER_SKIN_LIST,
  LAUNCHER_SKIN_ADD_LOCAL,
  LAUNCHER_SKIN_ADD_URL,
  LAUNCHER_SKIN_ADD_MINESKIN,
  LAUNCHER_SKIN_REMOVE,
  LAUNCHER_SKIN_UPDATE,
  LAUNCHER_SKIN_MINESKIN_PAGE,
  LAUNCHER_SKIN_APPLY,
  LAUNCHER_SKIN_UNAPPLY,
  LAUNCHER_SKIN_LIST_APPLIED,
  LAUNCHER_SKIN_READ_PNG,
  LAUNCHER_PICK_FILES,
  LauncherSkinListResponse,
  LauncherSkinAddLocalRequest,
  LauncherSkinAddLocalResponse,
  LauncherSkinAddUrlRequest,
  LauncherSkinAddUrlResponse,
  LAUNCHER_SKIN_ADD_OFFICIAL,
  LauncherSkinAddOfficialRequest,
  LauncherSkinAddOfficialResponse,
  LauncherSkinAddMineskinRequest,
  LauncherSkinAddMineskinResponse,
  LauncherSkinMineskinPageRequest,
  LauncherSkinMineskinPageResponse,
  LauncherSkinRemoveRequest,
  LauncherSkinRemoveResponse,
  LauncherSkinUpdateRequest,
  LauncherSkinUpdateResponse,
  LauncherSkinApplyRequest,
  LauncherSkinApplyResponse,
  LauncherSkinUnapplyRequest,
  LauncherSkinUnapplyResponse,
  LauncherSkinListAppliedRequest,
  LauncherSkinListAppliedResponse,
  LauncherSkinReadPngRequest,
  LauncherSkinReadPngResponse,
  LauncherPickFilesRequest,
  LauncherPickFilesResponse,
  LauncherDownloadModResponse,
  type ModEntry,
  ModLoader,
  LOCATE_MC,
  MC_CHOOSE_DIR,
  INSTALL_MOD,
  LAUNCH_MC,
  InstallModRequest,
  LaunchMcRequest,
  type LocateMcRes,
  type McChooseDirRes,
  type InstallModRes,
  type LaunchMcRes,
} from '../../shared/ipc-channels.js';
import {
  typeFromWebsite,
  curseforgeLoaderKey,
  curseforgeFileIdFromUrl,
  requiredDependencyIds,
  collectRequiredDependencies,
  pickPrimaryFile,
  isDatapackVersion,
  parseMrpack,
  buildModpackManifestFromApi,
  buildCfModpackManifest,
  fetchMineSkinPage,
  downloadMineSkinPng,
  fetchOfficialSkin,
  downloadOfficialSkinPng,
  DEFAULT_SKIN_MODEL,
  searchMcmodAliases,
  pickEnglishNames,
  type MineSkinEntry as MineSkinEntryT,
  type ModpackManifest,
  type ModrinthApiClient,
  type ModrinthVersion,
  type ModrinthSearchHit,
  type ModrinthProject,
} from '@mc-creator/core';
import { loadCurseForgeConfig } from '../credentials/curseforge-config.js';
import { createCurseForgeClient, createModrinthClient } from '../market-clients.js';
import { launcherDataDir } from '../launcher-dir.js';
import { makeCandidateFetch, sourcePreferenceStore } from '../download-sources.js';
import { abortError, abortable, isAbortError, throwIfAborted } from '../abort.js';
import { dedupeInstanceName } from '../../shared/instance-name.js';
import { PLAY_LOADER_FILTERS, type PlayLoaderFilter } from '../../shared/play-loaders.js';
import type { InstanceRecord } from '../instance-registry.js';
import {
  SkinLibrary,
  applySkinToInstance,
  unapplySkinFromInstance,
  listAppliedSkins,
  ensureLocalSkinFirst,
} from '../skin-library.js';
import { removeOfflineSkinPack, writeOfflineSkinPack } from '../offline-skin-pack.js';
import { installModpackFiles } from '../modpack-install.js';
import { pickCurseForgeFile, describeCfFileNeed, type CfFileNeed } from '../cf-file-pick.js';
import { modpackLedgerRecorder, commitDownload, prunePackFiles } from '../download-index.js';
/**
 * `.mrpack` 下载上限（zip bomb 兜底）。
 *
 * 值与 core 的 `fetchMrpack` 默认值一致（64MB）—— 我们在主进程侧改走
 * `launcher.fetchContent`（需候选源 + 哈希校验），但这个上限不能丢：
 * 解包前先把"大得不像清单"的东西拦住。
 */
const MRPACK_MAX_BYTES = 64 * 1024 * 1024;

/**
 * 给 `installModpackFiles` 用的 fetch：**按下载源候选**依次尝试（含 5xx 重试与换源）。
 *
 * 语义与 `LauncherService.download` 的候选循环一致 —— 那套循环是本仓下载
 * 路径的老底子，而这个入口（整合包那几十上百个文件、批量落盘）以前是漏的：
 * 实测一次装包因为镜像偶发 502 丢了 7 个 mod。实现与理由见
 * `download-sources.ts` 的 `makeCandidateFetch`。
 */
const candidateFetch = makeCandidateFetch({
  readPreference: () => sourcePreferenceStore(launcherDataDir()).read(),
});

/**
 * 同项目旧文件替换（三处下载共用）。
 *
 * 重新下载一个已经下过的项目时，源站往往已经发了**文件名不同**的新构建
 * （实测 JEI：`…31.15.0.79.jar` → `…31.15.0.81.jar`）。不处理的话 `mods/`
 * 里会留下两个同 mod id 的 jar，NeoForge/Fabric 启动时以 `Duplicate mod`
 * 直接拒启动 —— 症状是"装了之后就打不开游戏"。实现见 `../download-index.js`
 * （账本只记启动器自己下过的文件，用户手放的 jar 不碰）。
 *
 * 账本写失败**不能**把一次成功的下载变成失败，所以这里全吞异常。
 */
function replacePreviousDownload(
  instanceDir: string | undefined,
  destDir: string,
  projectId: string,
  fileName: string,
  url?: string,
): void {
  if (instanceDir === undefined) return;
  try {
    commitDownload(instanceDir, {
      projectId,
      dir: relative(instanceDir, destDir),
      name: fileName,
      ...(url !== undefined ? { url } : {}),
    });
  } catch {
    // 见上：账本/清理失败不影响下载本身
  }
}

export function registerLauncherHandlers(): void {
  /**
   * Modrinth `project_type` → 本仓的 `ContentKind`。
   *
   * 依赖的落盘目录**由它自己的类型决定**，不能跟着主文件走 —— 资源包的依赖
   * 通常也是资源包，塞进 `mods/` 会被加载器当 mod 扫。
   *
   * 认不出来的类型（作者自设的分类）返回 null，由调用方报缺，不猜。
   */
  const modrinthProjectTypeToKind = (projectType: string | undefined): ContentKind | null => {
    switch (projectType) {
      case 'mod':
        return 'mod';
      case 'resourcepack':
        return 'resourcepack';
      case 'shader':
        return 'shader';
      case 'datapack':
        return 'datapack';
      default:
        return null;
    }
  };

  // ===== 游戏启动器（下载客户端 + 离线启动）=====

  const launcherDir = launcherDataDir();
  // 偏好用**共享实例**：设置页写偏好与这里读偏好必须是同一份缓存，
  // 否则会出现「切了没反应」（见 download-sources.ts 的 sourcePreferenceStore）
  //
  // fetch 走「直连优先、连接失败再走系统代理」：实测 `maven.neoforged.net`
  // 在本机直连必然 timeout（装 NeoForge 会一直失败），而 Chromium 网络栈
  // 认 Windows 系统代理，能通。见 resilient-fetch.ts。
  const launcher = new LauncherService(
    launcherDir,
    createResilientFetch({ direct: fetch, viaProxy: electronNetFetch }),
    {
      sourceStore: sourcePreferenceStore(launcherDir),
    },
  );
  // 实例注册表与 LauncherService 共用同一个 baseDir（两者都读 userData/mc-launcher）
  const instances = new InstanceRegistry(launcherDir);

  /**
   * 正在安装的整合包：取消通道靠它找到对应的 `AbortController`。
   *
   * key 带 sender id：不同窗口各自安装同一个整合包时，取消只该影响发起它的
   * 那个窗口。map 在 handler 的 `finally` 里删，安装结束后再点取消会得到
   * `ok:false`（不是错误，界面可以忽略）。
   */
  const modpackInstalls = new Map<string, { controller: AbortController; senderId: number }>();
  const modpackKey = (senderId: number, modId: string, versionId: string): string =>
    `${senderId}|${modId}|${versionId}`;

  /**
   * 正在运行的游戏与实时日志缓冲。
   *
   * ## 为什么日志流不能自己再 `launchGame`
   *
   * 旧实现里 `LAUNCHER_LOG_STREAM` 直接调用 `launchGame` 来拿 stdout。
   * 结果：游戏已经在跑时点「日志」tab，会**再启动一个 Minecraft**，
   * 两个进程抢同一个 `latest.log`（实测 log4j 报
   * `Unable to delete latest.log`），并且日志 tab 看到的是第二个进程。
   *
   * 现在「开始游戏」是唯一启动入口：它把 stdout/stderr 推进每个实例的
   * `GameLogSession`，日志流只是订阅者。没有运行中的会话就明确返回
   * done + 提示，而不是偷偷再起一个游戏。
   *
   * 缓冲最近 400 行：日志 tab 通常在进程启动后才挂载，重放能让它一打开
   * 就看到启动阶段的关键行，而不是从半截开始。
   */
  interface GameLogReceiver {
    send: (channel: string, payload: unknown) => void;
    isDestroyed?: () => boolean;
  }
  interface GameLogSession {
    lines: string[];
    receivers: Map<GameLogReceiver, string>;
    done: boolean;
  }
  const GAME_LOG_BUFFER = 400;
  const gameLogs = new Map<string, GameLogSession>();
  const runningGames = new Set<string>();

  const resetGameLog = (instanceId: string): void => {
    gameLogs.set(instanceId, { lines: [], receivers: new Map(), done: false });
  };

  const publishGameLog = (instanceId: string, line: string): void => {
    const session = gameLogs.get(instanceId);
    if (!session || session.done) return;
    session.lines.push(line);
    if (session.lines.length > GAME_LOG_BUFFER) {
      session.lines.splice(0, session.lines.length - GAME_LOG_BUFFER);
    }
    for (const [receiver, requestId] of session.receivers) {
      if (receiver.isDestroyed?.()) {
        session.receivers.delete(receiver);
        continue;
      }
      receiver.send(LAUNCHER_LOG_STREAM_CHUNK, {
        requestId,
        source: 'live',
        line,
        done: false,
      });
    }
  };

  const finishGameLog = (instanceId: string, errorLine?: string): void => {
    const session = gameLogs.get(instanceId);
    if (!session || session.done) return;
    if (errorLine) publishGameLog(instanceId, errorLine);
    session.done = true;
    for (const [receiver, requestId] of session.receivers) {
      if (receiver.isDestroyed?.()) continue;
      receiver.send(LAUNCHER_LOG_STREAM_CHUNK, {
        requestId,
        source: 'live',
        line: '',
        done: true,
      });
    }
    session.receivers.clear();
  };

  /**
   * 实例真正在用的游戏目录（注册表里可能被用户改成别的盘）。
   *
   * mods 目录现在是 `<gameDir>/mods`，所以每个碰 mods 的 handler 都必须
   * 拿到这个值 —— 少了它就会「装到 A、启动读 B」，表现为 mod 装了没反应。
   *
   * 查不到实例就返回 undefined：`LauncherService` 那边会退回缺省
   * `game/<version>`，与「实例不存在」时的行为一致，不会更糟。
   */
  const gameDirOf = (instanceId: string): string | undefined => instances.get(instanceId)?.gameDir;

  /**
   * 给「从网上下东西进这个实例」用的筛选条件：**目标实例的 MC 版本 + 加载器**。
   *
   * 没有这一步时，所有"取最新版"的路径都会把最新版（往往是给最新 MC 版本的）
   * 塞进老实例：实测 1.20.1 + Fabric 实例下载 WTHIT，前置被选成
   * `fabric-api 0.163.0+26.4` / `badpackets neo-0.12.2`（只有 26.x）——
   * 装完启动即崩，而界面写着"前置已装"。同类问题在"按 modId 下载主文件"
   * 那条路上更直接：`getVersions(pid, {})[0]` 拿的就是最新版。
   *
   * 加载器这一项**按内容类型给**，不能一律用实例加载器：
   * - `mod`：用实例加载器（Fabric / NeoForge）
   * - `datapack`：用 `datapack`。Modrinth 上数据包 `project_type` 是 `mod`，
   *   唯一能区分"数据包构建"与"mod 构建"的就是这个 loader 值。实测 Terralith /
   *   Dungeons and Taverns / Tectonic / Trek / Geophilic 的**最新版都是 mod 构建**
   *   （`.jar`），按"最新版"下载会得到一个装不进 `datapacks/` 的 jar
   * - `resourcepack` / `shader`：**不带加载器**。它们与加载器无关，硬套
   *   `loaders=["fabric"]` 会得到空列表（把本来能下成的资源包变成"找不到版本"）
   * - 原版实例（`vanilla`）不带加载器
   *
   * 查不到实例就只给 MC 版本以外的空条件 —— 与旧行为一致，不会更糟。
   */
  const versionFilterOf = (
    instanceId: string,
    contentKind: ContentKind,
  ): { mcVersion?: string; loader?: string } => {
    const inst = instances.get(instanceId);
    if (!inst) return {};
    const loader =
      contentKind === 'datapack'
        ? 'datapack'
        : contentKind === 'mod' && inst.loader !== 'vanilla'
          ? inst.loader
          : undefined;
    return {
      mcVersion: inst.versionId,
      ...(loader === undefined ? {} : { loader }),
    };
  };

  /**
   * ISO 时间字符串 → 毫秒时间戳；**解析不出来就 `undefined`**。
   *
   * `new Date(undefined).getTime()` 是 `NaN`，而 `NaN` 会被响应 schema
   * （`z.number()`）拒掉 —— 结果是「详情页整页报错」这种看着毫无头绪的症状。
   * 时间字段本来就只是"有就显示"，缺了不该让整页塌掉。
   */
  const parseTimeMs = (iso: string | null | undefined): number | undefined => {
    if (iso === null || iso === undefined || iso === '') return undefined;
    const t = Date.parse(iso);
    return Number.isFinite(t) ? t : undefined;
  };

  /**
   * CF 依赖 modId → 用户**看得懂**的提示文本（`名字（cf:id）`）。
   *
   * 光报 `cf:1689768` 用户无法行动 —— 不知道那是什么、也没法点。这里顺手问一次
   * 源站拿项目名；**取名字失败就退回 id**，提示文本不该因为多一次请求失败而丢掉。
   *
   * ⚠️ 只传**必需**依赖（`requiredDependencyIds`）：CF 的 `relationType=2` 是
   * 可选联动（实测：JEI→MezzConfigGUI、Xaero→Xaero's World Map），把可选依赖
   * 报成"缺前置会导致启动失败"是虚惊一场（见 `curseforge/dependencies.ts`）。
   */
  const describeCfDependencies = async (
    client: ReturnType<typeof createCurseForgeClient>,
    ids: number[],
  ): Promise<string[]> =>
    Promise.all(
      ids.map(async (id) => {
        try {
          const project = await client.getMod(id);
          return `${project.name}（cf:${id}）`;
        } catch {
          return `cf:${id}`;
        }
      }),
    );

  /**
   * **版本作用域** vs **实例作用域** —— 多实例之后每个 handler 都得挑对。
   *
   * | 作用域 | 键 | 例子 |
   * |---|---|---|
   * | **版本** | MC 版本号 | client.jar / libraries / assets / 加载器档案。
   *   这些按版本**共享**：26 MB jar + 几百 MB 库不该每个实例复制一份 |
   * | **实例** | 实例名（= 目录名） | mods / config / saves / 日志。
   *   这些必须**隔离**，否则两个整合包的 90 个 mod 混在一起 |
   *
   * `requireInstance()` 拿到的记录同时携带两侧的键：`inst.versionId`
   * （版本）与 `inst.gameDir` / `inst.id`（实例）。所以不需要 `versionOf()` ——
   * 曾有一个「按实例 id 查版本号、查不到就当成版本号」的兜底 helper，
   * 但它允许「实例不存在」这条静默通过，于是会在
   * `game/<不存在的名字>/` 里建目录。改成查不到就抛错。
   */
  const requireInstance = (instanceId: string): InstanceRecord => {
    const inst = instances.get(instanceId);
    if (!inst) throw new Error(`实例不存在: ${instanceId}`);
    return inst;
  };

  /**
   * 实例 → 真正要解析的档案 id。
   *
   * 实例记录只有 `versionId` + `loader`；加载器实例必须再找一次
   * `versions/` 下 `inheritsFrom === versionId` 且主类匹配的档案。
   * 两个启动入口（「开始游戏」和实时日志）都必须走这里，否则会出现
   * 「按钮启动了 Fabric、日志 tab 却启动原版」这种同一实例两套行为。
   */
  const resolveInstanceProfile = async (inst: InstanceRecord): Promise<string> => {
    if (inst.loader === 'vanilla') return inst.versionId;
    const profileId = await launcher.findLoaderProfile(inst.versionId, inst.loader);
    if (!profileId) {
      throw new Error(
        `实例「${inst.id}」没有找到 ${inst.loader} 加载器档案，请重新安装加载器后再启动。`,
      );
    }
    return profileId;
  };

  /**
   * projectId → 内容类型缓存。
   *
   * 存在的唯一理由是**限流**：Modrinth 按 IP 300 次/分，一次下载可能带几十个
   * 依赖（递归展开后更多），逐个 `getProject` 会把配额打光并触发 429。
   *
   * 做成 handler 内局部缓存而不是模块级，是为了别把上次的条目留到下次下载 ——
   * 类型是项目的属性不会变，但缓存无限增长是另一回事。
   */
  const projectKindCache = new Map<string, ContentKind | null>();

  /**
   * 中文词 → 英文名 的**进程内**缓存。
   *
   * 存在的唯一理由是 MC百科 限流（实测连续请求会 429）：用户在搜索框里
   * 每敲一个字符都会触发一次别名查询，不缓存等于自己把限额打光。
   *
   * 不做持久化：词条会变，而且 ini / json 落盘会引入读写时机问题；
   * 重启后第一批查询慢一点是可以接受的代价。
   */
  const cnAliasCache = new Map<string, z.infer<typeof LauncherModCnAliasResponse>>();

  /**
   * Modrinth 命中补拉的**进程内**缓存。
   *
   * 这条是下载页搜索慢的主因：搜索结果不带 loader / 支持版本 / 最新版本号，
   * 而列表行要显示它们，所以 `enrichModrinthHit` 对**每条命中**都发一次
   * `getVersions(projectId)` —— 一页 20 条就是 21 个并发请求打 Modrinth，
   * 切一次分类、翻一页都要重来一遍。
   *
   * 缓存键带筛选条件：`downloadUrl` 是按「当前选的版本/加载器」挑的，
   * 不带条件缓存会把 1.16.5 的链接发给 1.21 的用户（装上去直接崩）。
   *
   * 只做进程内、不落盘：版本信息会变，而落盘会引入读写时机与失效判断，
   * 换来的只是"重启后第一次搜索"那一下 —— 不值得。
   */
  const enrichCache = new Map<string, ModEntry>();

  /**
   * 装一个 Modrinth 项目的 required 依赖，返回没装上的文件名列表。
   *
   * `LAUNCHER_DOWNLOAD_MOD`（按 modId 解析）与 `LAUNCHER_DOWNLOAD_URL`
   * （按 URL 直下）**共用**这一份实现，理由很实际：列表行的下载按钮几乎总是
   * 走 URL 那条路（搜索结果里已经填好了 `downloadUrl`），而 URL 那条路原本
   * 压根不碰依赖 —— 于是「依赖下载」这个能力对真实用户流程而言是**死代码**：
   * 装完 Sodium 没有 Fabric API，界面一声不吭，用户进游戏才发现起不来。
   * 两条路各写一份又会漂，所以只留这一处。
   *
   * 依赖也按**它自己的类型**落盘，不跟着主文件走：资源包的 required 依赖通常
   * 也是资源包，塞进 `mods/` 会被加载器当 mod 扫并炸掉。拿不到类型时**不猜**，
   * 报进返回值让用户自己放 —— 猜错的后果（装到 mods/）是启动崩。
   *
   * 版本也必须按**目标实例**过滤（`filter`）：取依赖的最新版在实测里会把
   * `fabric-api 0.163.0+26.4` 装进 1.20.1 实例。详见 `chooseVersion()`。
   *
   * 失败不回滚主文件：主文件已下好，前置缺失只是提示。
   */
  const installModrinthDependencies = async (args: {
    version: ModrinthVersion;
    targetInstance: string;
    /** 数据包依赖要落到哪个世界；其余类型忽略。 */
    world: string | undefined;
    /** 目标实例的 MC 版本 / 加载器（见 `versionFilterOf`）。 */
    filter: { mcVersion?: string; loader?: string };
  }): Promise<string[]> => {
    const missing: string[] = [];
    const instGameDir = gameDirOf(args.targetInstance);
    try {
      const kindOfProject = async (pid: string): Promise<ContentKind | null> => {
        const cached = projectKindCache.get(pid);
        if (cached !== undefined) return cached;
        let kind: ContentKind | null = null;
        try {
          kind = modrinthProjectTypeToKind((await modrinthClient.getProject(pid)).project_type);
        } catch {
          kind = null;
        }
        projectKindCache.set(pid, kind);
        return kind;
      };
      /**
       * 依赖该放哪个目录。
       *
       * 先看**选中的那一版文件**是不是数据包构建（`loaders === ["datapack"]`），
       * 再看项目类型。理由：Modrinth 上数据包项目的 `project_type` 是 `mod`
       * （实测 Terralith / VeinMiner / Dungeons and Taverns 全是），只按
       * project_type 判会把数据包 `.zip` 塞进 `mods/`。
       */
      const depDirOf = async (dep: {
        projectId: string;
        version: ModrinthVersion;
      }): Promise<string> => {
        if (isDatapackVersion(dep.version)) {
          if (args.world === undefined) throw new Error('数据包依赖需要指定世界');
          return launcher.datapackDir(args.targetInstance, args.world, instGameDir);
        }
        const kind = await kindOfProject(dep.projectId);
        if (kind === null) throw new Error('无法确定依赖的内容类型');
        if (kind === 'datapack') {
          if (args.world === undefined) throw new Error('数据包依赖需要指定世界');
          return launcher.datapackDir(args.targetInstance, args.world, instGameDir);
        }
        return launcher.contentDir(args.targetInstance, kind, instGameDir);
      };

      const collected = await collectRequiredDependencies(
        args.version,
        modrinthClient,
        args.filter,
      );
      for (const dep of collected.dependencies) {
        const f = pickPrimaryFile(dep.version);
        if (!f) continue;
        let depDir: string;
        try {
          depDir = await depDirOf(dep);
        } catch {
          missing.push(`${f.filename}（无法确定该放哪个目录）`);
          continue;
        }
        const depDest = join(depDir, f.filename);
        if (nodeFs.existsSync(depDest)) continue;
        try {
          // 与主文件同一条路：候选源（官方 / 国内镜像）+ sha1 校验 + 重试。
          // 之前这里是裸 `fetch` —— 前置通常也在 `cdn.modrinth.com` 上，
          // 正好是最需要镜像的那一半流量。
          const depBuf = await launcher.fetchContent(f.url, {
            sha1: f.hashes?.sha1 ?? null,
            size: f.size ?? null,
          });
          await mkdir(depDir, { recursive: true });
          await nodeFs.writeFileSync(depDest, depBuf);
        } catch {
          // 单个前置失败（含校验不过）不影响其余前置：下面那一轮会统一报缺，
          // 用户看到的是「哪个前置没装上」，而不是整批中断
          continue;
        }
      }
      // 收集不到 / 下失败的，回报给 UI 提示用户手动处理
      for (const dep of collected.dependencies) {
        const f = pickPrimaryFile(dep.version);
        if (!f) continue;
        let depDir: string | null = null;
        try {
          depDir = await depDirOf(dep);
        } catch {
          depDir = null;
        }
        if (depDir && !nodeFs.existsSync(join(depDir, f.filename))) {
          missing.push(f.filename);
        }
      }
      missing.push(...collected.skipped);
    } catch (e) {
      missing.push(`依赖解析失败：${(e as Error).message}`);
    }
    return missing;
  };

  /**
   * 「数据包没给世界」的统一报错。
   *
   * 单独抽出来是因为三处要用（两个下载 handler + 各自的分支），而文案
   * 必须**说清原因**：原版没有实例级数据包目录，用户会以为程序坏了。
   */
  const missingWorldError = (): string =>
    '数据包必须指定要装进哪个世界（原版只有 saves/<世界>/datapacks/）。' +
    '请先选一个世界，或先创建世界。';

  /** 请求外部 API 时的 User-Agent（Modrinth / Mojang texture 都要求标识来源）。 */
  const USER_AGENT = 'mc-creator/0.2.0 (https://github.com/mc-creator)';

  /**
   * MineSkin 按 id 定位时要扫多少页。
   *
   * 上限存在的理由：源站**没有**「按 id 取详情」的端点（实测 `/get/{id}` 404），
   * 只能翻列表找。全扫公共库要十几次请求 —— 那是「点一下导入等十秒」的来源。
   * 所以给硬上限，找不到就明说，不让用户对着一个无限转的按钮。
   */
  const MINESKIN_SCAN_PAGES = 5;

  // ===== L1 实例注册表 =====

  /**
   * 剥掉值为 `undefined` 的键。
   *
   * 本项目开了 `exactOptionalPropertyTypes`：`Partial<InstanceRecord>` 的
   * `name?: string` 不接受显式 `undefined`，而 zod 的 `.optional()` 产出的是
   * `string | undefined`。注册表的 `setIf` 本来就会跳过 `undefined`，
   * 所以这里剥掉与直接传过去语义完全一致，只是让类型和意图都显式。
   */
  const definedOnly = <T extends Record<string, unknown>>(
    obj: T,
  ): { [K in keyof T]: Exclude<T[K], undefined> } => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(obj)) if (v !== undefined) out[k] = v;
    return out as { [K in keyof T]: Exclude<T[K], undefined> };
  };

  ipcMain.handle(
    LAUNCHER_LIST_INSTANCES,
    async (): Promise<z.infer<typeof LauncherListInstancesResponse>> => {
      try {
        const list = instances.list();
        // clientReady 是派生字段（客户端 jar 是否就位），注册表里不存，用 existsSync 现场算
        return {
          instances: list.map((i) => ({
            ...i,
            clientReady: existsSync(
              join(launcherDir, 'versions', i.versionId, `${i.versionId}.jar`),
            ),
          })),
          error: null,
        };
      } catch (e) {
        return { instances: [], error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_CREATE_INSTANCE,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherCreateInstanceResponse>> => {
      try {
        const req = LauncherCreateInstanceRequest.parse(raw);
        return { ok: true, instance: instances.create(definedOnly(req)), error: null };
      } catch (e) {
        return { ok: false, instance: null, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_UPDATE_INSTANCE,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherUpdateInstanceResponse>> => {
      try {
        const req = LauncherUpdateInstanceRequest.parse(raw);
        const updated = instances.update(req.id, definedOnly(req.patch));
        // 实例不存在必须能被看见：主键拼错不能当成成功
        return updated
          ? { ok: true, instance: updated, error: null }
          : { ok: false, instance: null, error: `实例不存在: ${req.id}` };
      } catch (e) {
        return { ok: false, instance: null, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_DELETE_INSTANCE,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherDeleteInstanceResponse>> => {
      try {
        const req = LauncherDeleteInstanceRequest.parse(raw);
        // remove() 返回是否真的删掉了记录：传错 id 时必须如实报错，
        // 否则 UI 会显示「删除成功」而列表纹丝不动。
        const removed = instances.remove(req.id);
        if (!removed) {
          return { ok: false, filesDeleted: false, error: `实例不存在: ${req.id}` };
        }
        let filesDeleted = false;
        if (req.deleteFiles) {
          // 只删该实例自己的子树：versions/<id>/ 与 game/<id>/，
          // 其余（assets / libraries 公共目录）不动。
          await rm(join(launcherDir, 'versions', req.id), { recursive: true, force: true });
          await rm(join(launcherDir, 'game', req.id), { recursive: true, force: true });
          filesDeleted = true;
        }
        return { ok: true, filesDeleted, error: null };
      } catch (e) {
        return { ok: false, filesDeleted: false, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_OPEN_INSTANCE_FOLDER,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherOpenInstanceFolderResponse>> => {
      try {
        const req = LauncherOpenInstanceFolderRequest.parse(raw);
        const record = instances.get(req.id);
        if (!record) {
          return { ok: false, path: null, error: `实例不存在: ${req.id}` };
        }
        // 用记录里的 gameDir，不按 id 现拼：整合包实例的目录来自包名，
        // 和实例 id 并不总是同一个字符串。
        const dir = record.gameDir ?? join(launcherDir, 'game', record.id);
        // 刚创建的实例可能还没生成目录；先建出来再打开，避免资源管理器报错。
        await mkdir(dir, { recursive: true });
        const openError = await shell.openPath(dir);
        return openError === ''
          ? { ok: true, path: dir, error: null }
          : { ok: false, path: dir, error: openError };
      } catch (e) {
        return { ok: false, path: null, error: (e as Error).message };
      }
    },
  );

  // 版本清单
  ipcMain.handle(
    LAUNCHER_LIST_VERSIONS,
    async (): Promise<z.infer<typeof LauncherListVersionsResponse>> => {
      try {
        const versions = await launcher.listVersions();
        return {
          versions: versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
        };
      } catch (e) {
        return { versions: [], error: (e as Error).message };
      }
    },
  );

  // 下载客户端（jar + assets + libraries 顺序执行）
  //
  // 进度必须转发给渲染层：这一步动辄几百 MB、几分钟起步。
  // 没有事件推送的话下载按钮会一直灰着，用户分不清"卡住了"还是"在跑"——
  // 那是又一种静默。**失败路径也必须发收口事件**，否则进度条永远停在中途。
  ipcMain.handle(
    LAUNCHER_DOWNLOAD,
    async (e, raw: unknown): Promise<z.infer<typeof LauncherDownloadResponse>> => {
      let versionId: string | null = null;
      const emit = (stage: string, done: number, total: number, finished = false): void => {
        if (e.sender.isDestroyed()) return;
        e.sender.send(LAUNCHER_DOWNLOAD_PROGRESS, {
          version: versionId,
          stage,
          done,
          total,
          finished,
        });
      };
      const finish = (ok: boolean): void => {
        if (e.sender.isDestroyed()) return;
        e.sender.send(LAUNCHER_DOWNLOAD_PROGRESS, {
          version: versionId,
          stage: 'done',
          done: 0,
          total: 0,
          finished: true,
          ok,
        });
      };
      try {
        const req = LauncherDownloadRequest.parse(raw);
        // ⚠️ 这一步同时做两件事：下载**版本产物**，并（或更新）建一个**实例**。
        //
        // 多实例之后这两者不再自动等价：`version` 是 MC 版本号（产物按它共享），
        // 而实例有自己的名字与目录。所以：
        // - `version` 决定下什么 jar / 库 / 资源
        // - `instanceName` 决定这个实例叫什么、game 目录在哪
        // - 传了 `instanceId` 就更新那个已有实例（重复下载同一版本时）
        versionId = req.version;
        emit('versions', 0, 1);
        const detail = await launcher.resolveVersion(req.version);
        emit('versions', 1, 1);
        await launcher.downloadClient(detail, emit);
        await launcher.downloadAssets(detail, emit);
        await launcher.downloadLibraries(detail, emit);

        /**
         * 建/更新实例。
         *
         * 名字没给就退回版本号 —— 那正是迁移出来的老实例的 id，
         * 这样「老用户重复下载同一版本」仍然更新同一条记录而不是多出一条。
         * 给了就用它（用户在弹框里起的名），并在撞名时加后缀 ——
         * 连点两次下载不该造出两个同名实例。
         */
        const desired = req.instanceName ?? req.instanceId ?? req.version;
        const finalName = dedupeInstanceName(
          desired,
          instances.list().map((i) => i.id),
        );
        const inst = instances.create({
          id: req.instanceId ?? finalName,
          name: req.instanceId ?? finalName,
          versionId: req.version,
          loader: 'vanilla',
          source: 'downloaded',
        });

        finish(true);
        return { ok: true, instanceId: inst.id };
      } catch (err) {
        finish(false);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 由已下载的 server.jar 建一个能启动的服务端实例。
  //
  // 渲染层只传 serverId + 版本 id；jar 路径、实例根目录、文件名全部由主进程
  // 推导（§10.6 同一纪律）。`acceptEula` 是**用户的决定**，所以它从渲染层
  // 传下来 —— 但主进程只在它为 true 时才写 eula=true，绝不代用户勾选。
  ipcMain.handle(
    LAUNCHER_CREATE_SERVER_INSTANCE,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherCreateServerInstanceResponse>> => {
      try {
        const req = LauncherCreateServerInstanceRequest.parse(raw);
        const serversRoot = serverRootDir();
        mkdirSync(serversRoot, { recursive: true });
        const jarPath = join(
          launcher.baseDir,
          'versions',
          req.version,
          `${req.version}-server.jar`,
        );
        const created = await createVanillaServerInstance({
          serversRoot,
          serverId: req.serverId,
          jarPath,
          versionId: req.version,
          acceptEula: req.acceptEula,
          // `exactOptionalPropertyTypes` 下不能显式传 undefined，
          // 所以只在真的有值时才带上这些键 —— 缺省值由被调方决定。
          ...(req.port !== undefined ? { port: req.port } : {}),
          ...(req.motd !== undefined ? { motd: req.motd } : {}),
          ...(req.maxPlayers !== undefined ? { maxPlayers: req.maxPlayers } : {}),
          ...(req.onlineMode !== undefined ? { onlineMode: req.onlineMode } : {}),
          ...(req.levelName !== undefined ? { levelName: req.levelName } : {}),
        });
        return created.ok
          ? {
              ok: true,
              serverDir: created.serverDir,
              jarLinked: created.jarLinked,
              eulaAccepted: created.eulaAccepted,
            }
          : { ok: false, error: created.error };
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 下载服务端 jar（PCL 版本行上的第三个按钮）
  //
  // 进度复用同一条 LAUNCHER_DOWNLOAD_PROGRESS 通道，只是多一个 'server' 阶段 ——
  // 服务端 jar 有 60 多 MB，同样是"几分钟起步"，同样不能没有推送。
  ipcMain.handle(
    LAUNCHER_DOWNLOAD_SERVER,
    async (e, raw: unknown): Promise<z.infer<typeof LauncherDownloadServerResponse>> => {
      let versionId: string | null = null;
      const emit = (stage: string, done: number, total: number, finished = false): void => {
        if (e.sender.isDestroyed()) return;
        e.sender.send(LAUNCHER_DOWNLOAD_PROGRESS, {
          version: versionId,
          stage,
          done,
          total,
          finished,
        });
      };
      const finish = (ok: boolean): void => {
        if (e.sender.isDestroyed()) return;
        e.sender.send(LAUNCHER_DOWNLOAD_PROGRESS, {
          version: versionId,
          stage: 'done',
          done: 0,
          total: 0,
          finished: true,
          ok,
        });
      };
      try {
        const req = LauncherDownloadServerRequest.parse(raw);
        versionId = req.version;
        emit('versions', 0, 1);
        const detail = await launcher.resolveVersion(req.version);
        emit('versions', 1, 1);
        const { path, kind } = await launcher.downloadServer(detail, emit);
        finish(true);
        return { ok: true, path, kind };
      } catch (err) {
        finish(false);
        return { ok: false, error: (err as Error).message };
      }
    },
  );

  // 启动游戏（离线模式）
  ipcMain.handle(
    LAUNCHER_LAUNCH,
    async (e, raw: unknown): Promise<z.infer<typeof LauncherLaunchResponse>> => {
      /** 已经登记为运行中的实例 id；catch 里据此回收日志会话。 */
      let runningId: string | null = null;
      try {
        const req = LauncherLaunchRequest.parse(raw);
        /**
         * ⚠️ 这里体现了多实例之后最关键的一处区分：
         *
         * | 要什么 | 用哪个 |
         * |---|---|
         * | 跑哪个 jar / 用哪些库 / 哪个资源索引 | `inst.versionId`（**版本作用域**）|
         * | mods / config / 存档在哪 | `inst.gameDir`（**实例作用域**）|
         *
         * 以前 `version` 一个值同时充当两者，所以看不出来。现在必须拆开 ——
         * 用实例 id 去 `resolveVersion` 会去找 `versions/<实例名>/`，
         * 那个目录不存在，于是启动报「客户端未下载」而用户明明下过。
         */
        const inst = requireInstance(req.instance);

        // 同一个实例只允许一个游戏进程。日志流不再自己 launch 之后，
        // 这里就是唯一的入口；重复调用直接拒绝，避免两个进程抢 latest.log。
        if (runningGames.has(inst.id)) {
          return { pid: 0, error: '该实例已经在运行，请先关闭当前游戏' };
        }
        runningGames.add(inst.id);
        runningId = inst.id;
        resetGameLog(inst.id);

        // 加载器实例要解析**加载器档案**，不能直接解析 `versionId`
        // （详见 `resolveInstanceProfile`）。
        const detail = await launcher.resolveVersion(await resolveInstanceProfile(inst));
        const result = await launcher.launchGame(detail, {
          username: req.username,
          memory: req.memory,
          // gameDir 用注册表的（用户可能在实例设置里改到别的盘）。
          // 渲染层那个 `req.gameDir` 只在实例不存在时才可能有用 ——
          // 而实例不存在时这里已经抛错了，所以**不再**回落到它，
          // 免得出现「实例指向 D 盘、启动却读 C 盘」。
          gameDir: inst.gameDir ?? launcher.gameDir(inst.id),
          // 实例级 Java 路径。不传的话 launchGame 用 PATH 里的 `java`，
          // 用户明明在实例里选过 JDK 也会被忽略。
          ...(inst.javaPath ? { javaPath: inst.javaPath } : {}),
          // 加载器只影响 JVM 参数（Fabric 那几个 -D…）。不传就让
          // launchGame 按档案链自己推断，避免这里复述一遍说错。
          ...(inst.loader !== 'vanilla' ? { loader: inst.loader } : {}),
          /**
           * 日志流：把 stdout/stderr 推给 `gameLogs` 里的订阅者。
           *
           * **这是唯一接到真实游戏进程 stdout 的地方**。日志 tab 只是
           * 订阅这个缓冲，绝不会为了拿日志再起一个游戏（旧实现就这么干，
           * 结果点一下日志 tab 就多开一个 Minecraft）。
           */
          onLog: (line) => publishGameLog(inst.id, line),
          /**
           * 退出事件：渲染层的「开始游戏」只拿到 pid，不订阅这个的话
           * 关掉游戏后按钮会永远停在「运行中」。失败路径不会走这里
           * （spawn 失败由 launchGame reject，见 `attachErrorGuard`）。
           */
          onExit: (info) => {
            runningGames.delete(inst.id);
            finishGameLog(inst.id);
            if (!e.sender.isDestroyed()) {
              e.sender.send(LAUNCHER_GAME_EXIT, {
                instance: inst.id,
                code: info.code,
                signal: info.signal,
              });
            }
          },
        });
        // 启动成功才记「最近游玩」；失败不应污染排序。
        instances.update(inst.id, { lastLaunchedAt: Date.now() });
        return { pid: result.pid };
      } catch (e) {
        const message = (e as Error).message;
        if (runningId) {
          runningGames.delete(runningId);
          // 失败也要给日志订阅者一个结束标记，否则面板会一直转圈
          finishGameLog(runningId, `启动失败：${message}`);
        }
        return { pid: 0, error: message };
      }
    },
  );

  // 安装加载器（Fabric / NeoForge）
  ipcMain.handle(
    LAUNCHER_INSTALL_LOADER,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherInstallLoaderResponse>> => {
      try {
        const req = LauncherInstallLoaderRequest.parse(raw);
        // installer 要的 `launcher_profiles.json` 里的 gameDir 必须是**这个实例的**
        // 游戏目录，否则 installer 会把东西铺到别的实例那儿去。
        const inst = req.instance !== undefined ? instances.get(req.instance) : null;
        await launcher.installLoader(
          req.version,
          req.loader,
          undefined,
          undefined,
          undefined,
          inst?.gameDir ?? undefined,
        );
        // 装完要改**实例**的 loader 字段 —— 不改的话实例列表仍显示原版，
        // 启动时 launchGame 也拿不到 loader（于是又跑成原版）。
        // 不同实例可以有不同加载器，所以按 instance 改而不是按 version。
        if (req.instance !== undefined) {
          instances.update(req.instance, { loader: req.loader });
        }
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // 列出已装 Mod
  ipcMain.handle(
    LAUNCHER_LIST_MODS,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherListModsResponse>> => {
      try {
        const req = LauncherListModsRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const mods = await launcher.listMods(inst.id, inst.gameDir);
        return { mods };
      } catch (e) {
        return { mods: [], error: (e as Error).message };
      }
    },
  );

  // 安装 Mod（Modrinth 文件直链）
  ipcMain.handle(
    LAUNCHER_INSTALL_MOD,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherInstallModResponse>> => {
      try {
        const req = LauncherInstallModRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const path = await launcher.installMod(inst.id, req.name, req.url, inst.gameDir, {
          sha1: req.sha1 ?? null,
          size: req.size ?? null,
        });
        return { ok: true, path };
      } catch (e) {
        return { ok: false, path: null, error: (e as Error).message };
      }
    },
  );

  // 删除 Mod
  ipcMain.handle(LAUNCHER_REMOVE_MOD, async (_e, raw: unknown) => {
    try {
      const req = LauncherRemoveModRequest.parse(raw);
      const inst = requireInstance(req.instance);
      await launcher.removeMod(inst.id, req.name, inst.gameDir);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
  });

  // 安装离线皮肤支持（CustomSkinLoader + 皮肤站配置）
  ipcMain.handle(
    LAUNCHER_INSTALL_SKIN,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherInstallSkinResponse>> => {
      try {
        const req = LauncherInstallSkinRequest.parse(raw);
        const inst = requireInstance(req.instance);
        await launcher.installSkinSupport(inst.id, req.skinApiUrl, undefined, inst.gameDir);
        // 装完立刻把 LocalSkin 顶到 loadlist 首位 ——
        // 否则之后「应用皮肤」会发现本地皮肤被皮肤站的盖住。
        ensureLocalSkinFirst(inst.gameDir ?? launcher.gameDir(inst.id));
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // ===== §5.9 本地皮肤库 =====
  //
  // 分三层，别混：
  // - 库（`skins/library/`）是**全局**的，同一张皮肤能应用到多个实例/玩家名
  // - 应用是**实例作用域**：复制到 `game/<实例>/CustomSkinLoader/LocalSkin/skins/<玩家名>.png`
  // - CustomSkinLoader（已装的 mod）读那个目录并显示，**不需要动启动参数**
  const skinLib = new SkinLibrary(join(launcherDir, 'skins'));

  ipcMain.handle(
    LAUNCHER_SKIN_LIST,
    async (): Promise<z.infer<typeof LauncherSkinListResponse>> => {
      try {
        return { entries: skinLib.list() };
      } catch (e) {
        return { entries: [], error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_SKIN_ADD_LOCAL,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinAddLocalResponse>> => {
      try {
        const req = LauncherSkinAddLocalRequest.parse(raw);
        // 读盘放在这里而不是渲染层：渲染层拿不到绝对路径的文件内容，
        // 而 dialog 只还一个路径。
        const png = readFileSync(req.path);
        const entry = skinLib.add({
          png,
          // 名字缺省用文件名去扩展名 —— 那是用户最认得的标签
          name: req.name ?? basename(req.path).replace(/\.png$/i, ''),
          ...(req.model !== undefined ? { model: req.model } : {}),
          source: 'file',
          origin: req.path,
        });
        return { entry };
      } catch (e) {
        return { entry: null, error: (e as Error).message };
      }
    },
  );

  /**
   * 按 UUID 导入正版皮肤。
   *
   * 只收 UUID 不收玩家名，理由见 `LAUNCHER_SKIN_ADD_OFFICIAL` 的注释：
   * Mojang 的名字→UUID 接口已废弃，而离线条 UUID 查不到线上账号。
   * 所以这里连猜都不猜 —— 输入不合法就直接说清楚「要 UUID 不是名字」。
   *
   * 模型用官方 profile 里的 `metadata.model`（classic / slim），
   * **不用** `variant`：实测它有一半是 `unknown`，靠不住。
   */
  ipcMain.handle(
    LAUNCHER_SKIN_ADD_OFFICIAL,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinAddOfficialResponse>> => {
      try {
        const req = LauncherSkinAddOfficialRequest.parse(raw);
        const info = await fetchOfficialSkin(req.uuid);
        const png = await downloadOfficialSkinPng(info.skinUrl);
        const entry = skinLib.add({
          png,
          name: `${info.playerName} 的正版皮肤`,
          model: req.model ?? info.model ?? DEFAULT_SKIN_MODEL,
          source: 'url',
          origin: info.skinUrl,
        });
        return { entry, playerName: info.playerName, hasCape: info.hasCape, error: null };
      } catch (e) {
        return { entry: null, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_SKIN_ADD_URL,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinAddUrlResponse>> => {
      try {
        const req = LauncherSkinAddUrlRequest.parse(raw);
        // 渲染层已经转好 PNG（源站图常是 WebP，见字段注释）：直接用字节，
        // 不再联网。这也不是「省一次请求」—— 主进程根本解不了 WebP。
        const png = req.pngBase64 === undefined ? null : Buffer.from(req.pngBase64, 'base64');
        if (png !== null && png.length === 0) {
          return { entry: null, error: '渲染层传来的 PNG 是空的' };
        }
        let bytes: Buffer;
        if (png !== null) {
          bytes = png;
        } else {
          // 直链下载：Mojang texture（`textures.minecraft.net/texture/<hash>`）
          // 与皮肤站直链都走这里。PNG 校验由 `skinLib.add` 兜底 —— 不预设
          // 对方一定是 PNG，让同一个 `parseSkinPng` 给出可读的中文错误。
          const res = await fetch(req.url, {
            headers: { 'User-Agent': USER_AGENT },
            signal: AbortSignal.timeout(20_000),
          });
          if (!res.ok) throw new Error(`下载皮肤失败: HTTP ${res.status}`);
          bytes = Buffer.from(await res.arrayBuffer());
        }
        const entry = skinLib.add({
          png: bytes,
          name: req.name ?? 'URL 皮肤',
          ...(req.model !== undefined ? { model: req.model } : {}),
          source: 'url',
          origin: req.url,
        });
        return { entry };
      } catch (e) {
        return { entry: null, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_SKIN_ADD_MINESKIN,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinAddMineskinResponse>> => {
      try {
        const req = LauncherSkinAddMineskinRequest.parse(raw);
        /**
         * 按 id 找那一页并定位条目。
         *
         * MineSkin 没有「按 id 取详情」的端点（实测 `/get/{id}` 404），
         * 所以得扫列表。公共库不大（实测几百页量级），且这是**用户主动点**
         * 的一次性操作，所以不缓存整个列表。
         */
        let entry: MineSkinEntryT | null = null;
        for (let page = 1; page <= MINESKIN_SCAN_PAGES && entry === null; page++) {
          const p = await fetchMineSkinPage(page);
          entry = p.entries.find((e) => e.id === req.mineskinId) ?? null;
          if (entry !== null || !p.hasMore) break;
        }
        if (entry === null) throw new Error(`MineSkin 上找不到皮肤 #${req.mineskinId}`);

        const stored = skinLib.add({
          png: await downloadMineSkinPng(entry),
          name: req.name ?? `MineSkin #${entry.id}`,
          ...(req.model !== undefined ? { model: req.model } : {}),
          source: 'mineskin',
          origin: String(entry.id),
        });
        return { entry: stored };
      } catch (e) {
        return { entry: null, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_SKIN_MINESKIN_PAGE,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinMineskinPageResponse>> => {
      try {
        const req = LauncherSkinMineskinPageRequest.parse(raw);
        const p = await fetchMineSkinPage(req.page ?? 1);
        return { entries: p.entries, page: p.page, hasMore: p.hasMore };
      } catch (e) {
        return { entries: [], page: 1, hasMore: false, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_SKIN_REMOVE,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinRemoveResponse>> => {
      try {
        const req = LauncherSkinRemoveRequest.parse(raw);
        skinLib.remove(req.id);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_SKIN_UPDATE,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinUpdateResponse>> => {
      try {
        const req = LauncherSkinUpdateRequest.parse(raw);
        const entry = skinLib.update(req.id, {
          ...(req.name !== undefined ? { name: req.name } : {}),
          ...(req.model !== undefined ? { model: req.model } : {}),
        });
        if (entry === null) return { entry: null, error: '皮肤不在库里' };
        return { entry };
      } catch (e) {
        return { entry: null, error: (e as Error).message };
      }
    },
  );

  /**
   * 应用皮肤到实例。
   *
   * ⚠️ 这一步是唯一会把 PNG 复制进 `<gameDir>/` 的地方，所以
   * 「playerName 非法」必须在这里被挡住 —— 渲染层的校验只是体验优化，
   * 不能当安全边界（IPC 请求可以直接构造）。
   *
   * 有两条路，都会走：
   * 1. **CSL LocalSkin**：按玩家名发皮肤，需要实例装着 CustomSkinLoader；
   *    64×32 的旧格式皮肤也走这条（游戏会自己镜像右肢）。
   * 2. **离线皮肤资源包**：覆盖默认皮肤贴图，**不需要任何 mod**，
   *    但对所有用默认皮肤的玩家都生效。版本/格式不支持时只回一句 note。
   *    理由与贴图路径的实测出处见 `offline-skin-pack.ts`。
   */
  ipcMain.handle(
    LAUNCHER_SKIN_APPLY,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinApplyResponse>> => {
      try {
        const req = LauncherSkinApplyRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const gameDir = inst.gameDir ?? launcher.gameDir(inst.id);
        // 顺序要紧：先走 CSL 那条路（它同时是玩家名/皮肤 id 的校验闸），
        // 资源包那条路只在这之后 —— 否则「皮肤不在库里」会抢在玩家名校验之前，
        // 路径穿越的防护就被绕过了。
        const { path } = applySkinToInstance({
          library: skinLib,
          instanceGameDir: gameDir,
          skinId: req.skinId,
          playerName: req.playerName,
        });
        let note: string | null = null;
        try {
          const entry = skinLib.get(req.skinId);
          if (entry === null) throw new Error(`皮肤不在库里: ${req.skinId}`);
          const pack = await writeOfflineSkinPack({
            instanceGameDir: gameDir,
            mcVersion: inst.versionId,
            width: entry.width,
            height: entry.height,
            png: readFileSync(skinLib.pngPath(req.skinId)),
          });
          note = pack.note;
        } catch (e) {
          // 资源包写失败不该让「应用」整体失败：CSL 那条路已经落盘了
          note = `离线皮肤资源包没写成：${(e as Error).message}`;
        }
        return { ok: true, path, note };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  /**
   * 读库里一张 PNG 的 data URL（供 2D/3D 预览）。
   *
   * 用 data URL 而不是 `file://`：Electron 渲染进程的 CSP 不放行 `file:`，
   * 而 skinview3d 的 `loadSkin` 接受任意 URL 字符串 —— data URL 不需要额外通道。
   *
   * 读失败返回 `dataUrl: null + error`，**不抛**：一张坏图不该让面板整个转红，
   * 2D 预览照常（只是显示不出），用户还能换一张。
   */
  ipcMain.handle(
    LAUNCHER_SKIN_READ_PNG,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinReadPngResponse>> => {
      try {
        const req = LauncherSkinReadPngRequest.parse(raw);
        if (!skinLib.pngExists(req.id)) return { dataUrl: null, error: '皮肤文件缺失' };
        const buf = readFileSync(skinLib.pngPath(req.id));
        return { dataUrl: `data:image/png;base64,${buf.toString('base64')}`, error: null };
      } catch (e) {
        return { dataUrl: null, error: (e as Error).message };
      }
    },
  );

  /**
   * 通用文件选择器（Electron `dialog.showOpenDialog`）。
   *
   * 为什么新增而不是复用 `nodeGraph.showOpenDialog`：那个只允许 `.json`
   * （它是为节点图持久化设计的）。皮肤导入要 `.png` —— 用同一个通道
   * 但换一个 filters 是**改既有调用方的行为**，不该顺手做。
   *
   * `filters` 缺省不限扩展名，但渲染层应该始终传 —— 「什么都能选」的
   * 文件选择器会给用户错误预期，而且失败原因（「这不是 PNG」）与
   * 「随便选什么」的提示对不上。
   */
  ipcMain.handle(
    LAUNCHER_PICK_FILES,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherPickFilesResponse>> => {
      try {
        const req = LauncherPickFilesRequest.parse(raw);
        const r = await dialog.showOpenDialog({
          title: req.title,
          properties: req.properties ?? ['openFile'],
          ...(req.filters !== undefined ? { filters: req.filters } : {}),
        });
        if (r.canceled || r.filePaths.length === 0) return { paths: [], error: null };
        return { paths: r.filePaths, error: null };
      } catch (e) {
        return { paths: [], error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_SKIN_UNAPPLY,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinUnapplyResponse>> => {
      try {
        const req = LauncherSkinUnapplyRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const gameDir = inst.gameDir ?? launcher.gameDir(inst.id);
        unapplySkinFromInstance({
          instanceGameDir: gameDir,
          playerName: req.playerName,
        });
        // 资源包是**按实例**覆盖默认皮肤、不按玩家名，所以只有「这个实例上
        // 再没有已应用皮肤」时它才该消失 —— 否则会把另一个玩家名的皮肤一起撤了。
        const rest = listAppliedSkins(gameDir);
        const note =
          rest.length === 0
            ? (await removeOfflineSkinPack({ instanceGameDir: gameDir })).note
            : null;
        return { ok: true, note };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_SKIN_LIST_APPLIED,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSkinListAppliedResponse>> => {
      try {
        const req = LauncherSkinListAppliedRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const applied = listAppliedSkins(inst.gameDir ?? launcher.gameDir(inst.id));
        return { applied };
      } catch (e) {
        return { applied: [], error: (e as Error).message };
      }
    },
  );

  // 启用/禁用已装 Mod（写/删 `.disabled` 标记文件）
  ipcMain.handle(
    LAUNCHER_TOGGLE_MOD,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherToggleModResponse>> => {
      try {
        const req = LauncherToggleModRequest.parse(raw);
        const inst = requireInstance(req.instance);
        await launcher.toggleMod(inst.id, req.name, req.enabled, inst.gameDir);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // 列出实例下的世界存档（L9）
  ipcMain.handle(
    LAUNCHER_LIST_WORLDS,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherListWorldsResponse>> => {
      try {
        const req = LauncherListWorldsRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const worlds = await launcher.listWorlds(inst.id, inst.gameDir);
        return { worlds, error: null };
      } catch (e) {
        return { worlds: [], error: (e as Error).message };
      }
    },
  );

  // 列出实例目录下一层条目（L8）
  ipcMain.handle(
    LAUNCHER_LIST_INSTANCE_FILES,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherListInstanceFilesResponse>> => {
      try {
        const req = LauncherListInstanceFilesRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const files = await launcher.listInstanceFiles(inst.id, req.path, inst.gameDir);
        return { files, error: null };
      } catch (e) {
        // 越界 / 无权限 / 版本未下载：回错误，不静默返回空列表
        return { files: [], error: (e as Error).message };
      }
    },
  );

  // ===== 游戏日志（L7）=====

  /** 读最近一次 `logs/latest.log`。目录/文件不存在 → 空数组（还没玩过而已）。 */
  ipcMain.handle(
    LAUNCHER_READ_LATEST_LOG,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherReadLatestLogResponse>> => {
      try {
        const req = LauncherReadLatestLogRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const lines = await launcher.readLatestLog(inst.id, inst.gameDir);
        return { lines, error: null };
      } catch (e) {
        return { lines: [], error: (e as Error).message };
      }
    },
  );

  /** 列崩溃报告文件。目录不存在 → 空数组。 */
  ipcMain.handle(
    LAUNCHER_LIST_CRASH_REPORTS,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherListCrashReportsResponse>> => {
      try {
        const req = LauncherListCrashReportsRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const files = await launcher.listCrashReports(inst.id, inst.gameDir);
        return { files, error: null };
      } catch (e) {
        return { files: [], error: (e as Error).message };
      }
    },
  );

  /**
   * 读单个崩溃报告。
   *
   * `filename` 是渲染层传进来的用户输入，路径穿越由
   * `LauncherService.readCrashReport` 内部的 `resolveInside` 拒绝，
   * 这里只负责把异常翻译成可见的 error（**不能**静默返回空串）。
   */
  ipcMain.handle(
    LAUNCHER_READ_CRASH_REPORT,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherReadCrashReportResponse>> => {
      try {
        const req = LauncherReadCrashReportRequest.parse(raw);
        const inst = requireInstance(req.instance);
        const content = await launcher.readCrashReport(inst.id, req.filename, inst.gameDir);
        return { content, error: null };
      } catch (e) {
        return { content: '', error: (e as Error).message };
      }
    },
  );

  /**
   * 实时游戏日志流（订阅者）。
   *
   * **不再在这里启动游戏**。日志来自 `LAUNCHER_LAUNCH` 建立的
   * `GameLogSession`；本 handler 只做三件事：
   *  1. 校验实例存在（主键拼错要报错，不能静默空流）；
   *  2. 重放缓冲区里最近的关键行，让后挂载的日志 tab 也能看到启动阶段；
   *  3. 登记 sender，之后由 `publishGameLog` 持续推 chunk。
   *
   * 约定（渲染层靠它过滤并发流）：每个 chunk 都带 `requestId`，
   * 游戏进程退出时补一条 `done: true` 的空行作为结束标记。
   */
  const startLogStream = async (sender: GameLogReceiver, raw: unknown): Promise<void> => {
    const send = (requestId: string, line: string, done: boolean): void => {
      if (sender.isDestroyed?.()) return;
      const chunk: z.infer<typeof LauncherLogStreamChunk> = {
        requestId,
        source: 'live',
        line,
        done,
      };
      sender.send(LAUNCHER_LOG_STREAM_CHUNK, chunk);
    };

    const req = LauncherLogStreamRequest.safeParse(raw);
    if (!req.success) {
      // 请求本身不合法：没有可信的 requestId 可回传，但尽力捞一个 raw.requestId
      // 让出错的那块面板能显示错误，而不是永远转圈。
      const fallbackId =
        typeof raw === 'object' &&
        raw !== null &&
        typeof (raw as { requestId?: unknown }).requestId === 'string'
          ? (raw as { requestId: string }).requestId
          : '';
      send(fallbackId, `日志流请求无效: ${req.error.issues[0]?.message ?? 'unknown'}`, true);
      return;
    }

    const { requestId, instance } = req.data;
    try {
      const inst = requireInstance(instance);
      const session = gameLogs.get(inst.id);
      if (!session) {
        send(requestId, '当前实例没有正在运行的游戏，请先点「开始游戏」', true);
        return;
      }

      // 先重放历史，再决定是否登记为持续订阅者。
      // 已结束的会话只回放 + done，不留在 receivers 里。
      for (const line of session.lines) send(requestId, line, false);
      if (session.done) {
        send(requestId, '', true);
        return;
      }
      session.receivers.set(sender, requestId);
    } catch (e) {
      // 实例不存在等错误也要给结束标记，否则 UI 侧永远等不到 done
      send(requestId, (e as Error).message, true);
    }
  };

  // 请求走 `handle`（渲染层 invoke），与 CHAT_STREAM / BUILD_STREAM 惯例一致；
  // 分片走 `LAUNCHER_LOG_STREAM_CHUNK` 的 webContents.send。
  ipcMain.handle(LAUNCHER_LOG_STREAM, (e, raw: unknown) => startLogStream(e.sender, raw));

  // === Minecraft 启动器（A 切片：离线账号，无需微软 OAuth）===
  type LauncherKind = 'official' | 'pcl2' | 'hmcl';
  const detectMinecraft = (): {
    mcDir: string | null;
    modsDir: string | null;
    launcherExe: string | null;
    launcher: LauncherKind | null;
  } => {
    const appData = app.getPath('appData');
    let mcDir: string | null = null;
    const defaultMc = join(appData, '.minecraft');
    if (nodeFs.existsSync(defaultMc)) mcDir = defaultMc;
    // launcher_profiles.json 可能覆盖 gameDir
    if (mcDir) {
      const profPath = join(mcDir, 'launcher_profiles.json');
      if (nodeFs.existsSync(profPath)) {
        try {
          const prof = JSON.parse(nodeFs.readFileSync(profPath, 'utf-8'));
          if (typeof prof.gameDir === 'string') mcDir = prof.gameDir;
        } catch {
          /* 忽略损坏的 JSON */
        }
      }
    }
    const modsDir = mcDir ? join(mcDir, 'mods') : null;

    const home = homedir();
    const pf = process.env.ProgramFiles;
    const pf86 = process.env['ProgramFiles(x86)'];
    // 用户常见放置便携启动器（PCL2/HMCL 为绿色 exe，无固定安装路径）的目录
    const scanDirs = [home, join(home, 'Desktop'), join(home, 'Downloads'), 'D:\\', 'C:\\'].filter(
      (d) => nodeFs.existsSync(d),
    );

    const candidates: { kind: LauncherKind; paths: string[] }[] = [
      {
        kind: 'official',
        paths: [
          pf86 && join(pf86, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
          pf && join(pf, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
          'C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe',
          'C:\\Program Files\\Minecraft Launcher\\MinecraftLauncher.exe',
        ].filter(Boolean) as string[],
      },
      { kind: 'pcl2', paths: scanDirs.map((d) => join(d, 'PCL2.exe')) },
      {
        kind: 'hmcl',
        paths: scanDirs.flatMap((d) => {
          try {
            return nodeFs
              .readdirSync(d)
              .filter((f) => /^HMCL.*\.exe$/i.test(f))
              .map((f) => join(d, f));
          } catch {
            return [];
          }
        }),
      },
    ];

    for (const group of candidates) {
      for (const p of group.paths) {
        if (nodeFs.existsSync(p)) return { mcDir, modsDir, launcherExe: p, launcher: group.kind };
      }
    }
    return { mcDir, modsDir, launcherExe: null, launcher: null };
  };

  ipcMain.handle(LOCATE_MC, (): LocateMcRes => {
    const { mcDir, modsDir, launcherExe, launcher } = detectMinecraft();
    return {
      found: !!mcDir,
      mcDir,
      modsDir,
      launcherExe,
      launcher,
      error: mcDir ? null : '未检测到 .minecraft 目录，请手动选择',
    };
  });

  ipcMain.handle(MC_CHOOSE_DIR, async (): Promise<McChooseDirRes> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle(INSTALL_MOD, async (_e, raw: unknown): Promise<InstallModRes> => {
    const { jarPath, mcDir: mcDirOpt } = InstallModRequest.parse(raw);
    const mcDir = mcDirOpt ?? detectMinecraft().mcDir;
    if (!mcDir) return { ok: false, modsDir: null, error: '未找到 .minecraft 目录，请先手动选择' };
    const modsDir = join(mcDir, 'mods');
    await mkdir(modsDir, { recursive: true });
    const dest = join(modsDir, basename(jarPath));
    await copyFile(jarPath, dest);
    return { ok: true, modsDir, error: null };
  });

  ipcMain.handle(LAUNCH_MC, async (_e, raw: unknown): Promise<LaunchMcRes> => {
    const { mcDir: _mcDirOpt } = LaunchMcRequest.parse(raw);
    const { launcherExe, launcher } = detectMinecraft();
    if (!launcherExe) {
      return {
        ok: false,
        method: null,
        launcher: null,
        error:
          '未找到任何启动器（官方 / PCL2 / HMCL）。请安装其一，或点「手动选择 .minecraft」后用自己的启动器打开游戏。',
      };
    }
    // 离线账号：直接拉起检测到的启动器，由其离线档案进入游戏，无需微软 token
    //
    // ⚠️ 必须等 'spawn' 再回 ok:true。
    // `detectMinecraft()` 的 existsSync 是**检测那一刻**的检查，之后文件被删、
    // 被杀软拦、0 字节 exe、权限不足，都会让 spawn 异步发 'error'。
    // 修复前这里既没监听器（EventEmitter 无 'error' 监听者 → 未捕获异常 → 主进程退出），
    // 又立刻返回 ok:true —— 用户看到"已启动"，其实什么都没发生。
    const child = spawn(launcherExe, [], { detached: true, stdio: 'ignore' });
    try {
      await new Promise<void>((res, rej) => {
        child.once('spawn', res);
        child.once('error', rej);
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      return {
        ok: false,
        method: null,
        launcher,
        error:
          code === 'EACCES'
            ? `启动器无执行权限：${launcherExe}`
            : `启动器拉起失败（${launcherExe}）：${(err as Error).message}`,
      };
    }
    // 确认起来了才 unref：失败时保持父进程引用，让上面的 catch 有机会执行完
    child.unref();
    return { ok: true, method: 'launcher', launcher, error: null };
  });

  // ===== 在线内容搜索/下载（Modrinth + CurseForge 聚合）=====
  const modrinthClient = createModrinthClient();

  /**
   * 把 Modrinth 搜索命中补成 UI 需要的 ModEntry。
   *
   * 搜索命中**不带** loader、支持版本、downloadUrl —— 那些得再打一次 version
   * 接口。（`latest_version` 和 `date_modified` 是免费的，命中里就有，直接取。）
   *
   * 补拉失败不抛：那条退回 gameVersions/loaders 空数组，UI 少显示一行而已，
   * 不能因为一个项目的 version 接口抽风就整页搜索失败。
   */
  /**
   * **批量**补拉一整页 Modrinth 命中。
   *
   * 每条命中单独 `getVersions(projectId)` 实测要 1.8 秒（20 次请求），
   * 而列表行只需要 loader / 支持版本 / 最新版本号 / downloadUrl。
   * 这些都能用**两次批量**拿到，实测 0.85 秒：
   *
   *   1. `getProjectsByIds(所有 project id)` —— 一次拿 100 条，含每项目的
   *      `loaders` 与 `game_versions`，还顺带给出最新的版本 id 列表
   *   2. `getVersionsByIds(每个项目的最新版本 id)` —— 一次拿 100 条，
   *      给出 `version_number` / `files`（→ downloadUrl）
   *
   * 任一步整体失败时**退回逐条补拉**：批量接口偶尔会 400（比如某个 id 已下架），
   * 但不能因此让整页搜索没有 loader 信息。逐条路径也会失败，但至少尽力了。
   */
  async function enrichModrinthHits(
    client: ModrinthApiClient,
    hits: ModrinthSearchHit[],
    contentType: 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader',
    filter: { gameVersion?: string; loader?: string },
  ): Promise<ModEntry[]> {
    if (hits.length === 0) return [];

    // 命中顺序必须保持：调用方直接 push 进 modrinthResults，
    // 顺序变了会让「按下载量排序」的搜索结果看起来是乱的。
    const projectIds = hits.map((h) => h.project_id);

    let projects: Map<string, ModrinthProject>;
    try {
      projects = await client.getProjectsByIds(projectIds);
    } catch {
      // 批量失败 → 退回逐条（慢但至少不空）
      const out: ModEntry[] = [];
      for (const hit of hits) {
        out.push(await enrichModrinthHit(client, hit, contentType, filter));
      }
      return out;
    }

    // 每个项目的**最新版本 id**。
    //
    // ⚠️ 两个坑，都实测过：
    // 1. `hit.latest_version` 是版本 **id**，不是版本号 —— 直接显示会是乱码 id。
    //    但它正是我们要的东西：拿它去 `getVersionsByIds` 一次覆盖整页。
    // 2. `project.versions` 是**最旧在前**的（实测 [0] 是 2021 年的老版本）。
    //    所以命中没给 `latest_version` 时，要取**最后一个**，不是第一个 ——
    //    取错会让用户下载到几年前的 jar（Sodium 实测会取到 mc1.16.3-0.1.0）。
    const latestVersionIds = hits
      .map((hit) => {
        const fromHit = hit.latest_version;
        if (fromHit !== undefined && fromHit !== '') return fromHit;
        const vs = projects.get(hit.project_id)?.versions ?? [];
        return vs.length > 0 ? vs[vs.length - 1]! : undefined;
      })
      .filter((v): v is string => typeof v === 'string');

    let versionById: Map<string, ModrinthVersion> = new Map();
    if (latestVersionIds.length > 0) {
      try {
        versionById = await client.getVersionsByIds(latestVersionIds);
      } catch {
        // 版本那批失败就只靠 project 的 loaders/gameVersions，downloadUrl 留空
        // （用户点下载时会走按 modId 解析的兜底路径）
        versionById = new Map();
      }
    }

    return hits.map((hit) => {
      const base: ModEntry = {
        id: `mr_${hit.project_id}`,
        name: hit.title,
        summary: hit.description,
        iconUrl: hit.icon_url ?? undefined,
        source: 'modrinth',
        contentType,
        gameVersions: [],
        loaders: [],
        slug: hit.slug,
        downloads: hit.downloads,
        categories: hit.categories,
        // `date_modified` 免费（命中里就有），别再为它花一次请求。
        // ⚠️ `latest_version` **不在这里填**：它是版本 id 不是版本号，
        // 填进去列表行会显示一串乱码 id。版本号要靠它去批量取版本才有。
        ...(hit.date_modified === undefined
          ? {}
          : { updatedAt: new Date(hit.date_modified).getTime() }),
      };

      const project = projects.get(hit.project_id);
      // 批量取回的版本数据（按命中对应的最新版本 id 查）
      const latestVersionId = hit.latest_version ?? project?.versions[project.versions.length - 1];
      const version = latestVersionId === undefined ? undefined : versionById.get(latestVersionId);

      /**
       * 只保留我们认的加载器（NeoForge / Fabric）。
       *
       * 清单来自 `shared/play-loaders.ts` —— 主进程这层整形、UI 的筛选器、
       * 详情页的分组是**同一件事**。历史上这里和 UI 各写一份，只是当时
       * 恰好一致，所以没有任何测试会红（漂移最危险的形态）。
       */
      const pickLoaders = (raw: readonly string[] | undefined): PlayLoaderFilter[] =>
        (raw ?? []).filter((l): l is PlayLoaderFilter =>
          (PLAY_LOADER_FILTERS as readonly string[]).includes(l),
        );

      if (project) {
        if (project.loaders.length > 0) base.loaders = pickLoaders(project.loaders);
        if (project.game_versions.length > 0) base.gameVersions = project.game_versions;
      }
      if (version) {
        // 版本里的 loaders 更准（项目级是历史累积，可能包含早已不支持的）
        if (version.loaders && version.loaders.length > 0) {
          base.loaders = pickLoaders(version.loaders);
        }
        if (version.version_number) base.latestVersion = version.version_number;
        if (version.game_versions?.length) base.gameVersions = version.game_versions;
        if (version.date_published) base.updatedAt = new Date(version.date_published).getTime();

        const primary = version.files.find((f) => f.primary) ?? version.files[0];
        if (primary) {
          if (primary.size) base.fileSize = primary.size;
          if (primary.hashes?.sha1) base.sha1 = primary.hashes.sha1;
          // 列表行的下载按钮直接用这条链接 —— 渲染层拿到 URL 就能下，
          // 不用再绕回主进程按 modId 解析一遍（那会重新选版本）。
          base.downloadUrl = primary.url;
        }
      }

      return base;
    });
  }

  async function enrichModrinthHit(
    client: ModrinthApiClient,
    hit: ModrinthSearchHit,
    contentType: 'mod' | 'modpack' | 'datapack' | 'resourcepack' | 'shader',
    /** 当前筛选条件：决定「下载」按钮取哪个版本的链接，而不是无脑取最新版。 */
    filter: { gameVersion?: string; loader?: string },
  ): Promise<ModEntry> {
    // 缓存键必须带筛选条件 —— downloadUrl 是按它挑的，不带就等于
    // 「把 1.16.5 的 jar 发给选了 1.21 的用户」。
    const cacheKey = `${hit.project_id}|${contentType}|${filter.gameVersion ?? ''}|${filter.loader ?? ''}`;
    const cached = enrichCache.get(cacheKey);
    if (cached) return cached;

    const base: ModEntry = {
      id: `mr_${hit.project_id}`,
      name: hit.title,
      summary: hit.description,
      iconUrl: hit.icon_url ?? undefined,
      source: 'modrinth',
      contentType,
      gameVersions: [],
      loaders: [],
      slug: hit.slug,
      downloads: hit.downloads,
      categories: hit.categories,
      // `date_modified` 免费（命中里就有），别再为它花一次请求。
      // ⚠️ `latest_version` 是版本 **id** 不是版本号，不能当显示字符串填进
      // `latestVersion`（会显示乱码 id）。下面的批量路径拿它去取版本才对。
      ...(hit.date_modified === undefined
        ? {}
        : { updatedAt: new Date(hit.date_modified).getTime() }),
    };
    try {
      /**
       * ⚠️ 这里**必须带筛选条件**。
       *
       * 无筛选的 `getVersions` 会把项目的**全部历史版本**拉下来：实测
       * Fabric API 的响应是 1.2MB / 1211 个版本 / 单次 22 秒。这条函数是
       * 批量富化失败后的**逐条兜底**，一页 20 条走无筛选就是分钟级 ——
       * 用户看到的是搜索页永远停在"加载中"。
       *
       * 带筛选后只回匹配的那几条，顺带让列表行显示的版本/加载器与
       * 「下载」按钮要拿的版本是同一个（否则行里写着 1.21、下下来是别的）。
       */
      const versions = await client.getVersions(hit.project_id, {
        ...(filter.gameVersion !== undefined ? { mcVersion: filter.gameVersion } : {}),
        ...(filter.loader !== undefined ? { loader: filter.loader } : {}),
      });
      const latest = versions[0];
      if (latest) {
        if (latest.version_number) base.latestVersion = latest.version_number;
        if (latest.game_versions?.length) base.gameVersions = latest.game_versions;
        if (latest.loaders?.length) {
          /**
           * 只保留我们认的加载器（NeoForge / Fabric）。清单来自
           * `shared/play-loaders.ts`（与 UI 筛选器、详情页分组是同一份）。
           *
           * 源站还会返回 forge / quilt / liteloader / rift，甚至 schema 枚举外的
           * 值。筛选器不提供它们，留在这里只会让结果行显示一串用户无法选中的
           * loader（如「Fabric / Forge / Quilt」），看着像支持其实选不了。
           */
          base.loaders = latest.loaders.filter((l): l is PlayLoaderFilter =>
            (PLAY_LOADER_FILTERS as readonly string[]).includes(l),
          );
        }
        if (latest.date_published) base.updatedAt = new Date(latest.date_published).getTime();

        /**
         * 按筛选条件挑版本。
         *
         * 用户在「版本」下拉选了 1.16.5，点下载就该拿到 1.16.5 的 jar，
         * 而不是项目最新版（可能只支持 1.21，装到 1.16 客户端上直接崩）。
         * 版本列表按发布时间倒序，命中**第一个**即最新匹配项。
         */
        const matches = (v: (typeof versions)[number]): boolean => {
          if (filter.gameVersion && !(v.game_versions ?? []).includes(filter.gameVersion)) {
            return false;
          }
          if (filter.loader && !(v.loaders ?? []).includes(filter.loader)) return false;
          return true;
        };
        const picked = versions.find(matches) ?? latest;
        const primary = picked.files.find((f) => f.primary) ?? picked.files[0];
        if (primary) {
          if (primary.size) base.fileSize = primary.size;
          if (primary.hashes?.sha1) base.sha1 = primary.hashes.sha1;
          // 列表行的下载按钮直接用这条链接 —— 渲染层拿到 URL 就能下，
          // 不用再绕回主进程按 modId 解析一遍（那会重新选版本）。
          base.downloadUrl = primary.url;
        }
      }
    } catch {
      // 补拉失败就用搜索命中原样返回，见上方注释。失败结果**不缓存** ——
      // 网络抖动不该让这个项目在一整个进程生命周期里都缺 loader 信息。
    }
    enrichCache.set(cacheKey, base);
    return base;
  }

  ipcMain.handle(
    LAUNCHER_SEARCH_MODS,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherSearchModsResponse>> => {
      const req = LauncherSearchModsRequest.parse(raw);
      const modrinthResults: ModEntry[] = [];
      const cfResults: ModEntry[] = [];
      const errors: string[] = [];
      /** 各源给出的命中总数。分页用 max —— 任一侧报的数都比"当前页条数"大才有意义。 */
      let totalCount = 0;
      /** 每个源各自的 offset/total，用于判断能否继续补拉（PCL 的 Storage.CurseForgeOffset 那套）。 */
      const cursor = { modrinth: 0, curseforge: 0 };
      const totals = { modrinth: -1, curseforge: -1 };

      // Modrinth 搜索
      try {
        if (req.source === 'all' || req.source === 'modrinth') {
          const searchOpts: {
            loader?: string;
            mcVersion?: string;
            limit?: number;
            offset?: number;
            contentType: typeof req.contentType;
            category?: string;
            index?: string;
          } = {
            limit: req.limit,
            offset: req.page * req.limit,
            contentType: req.contentType,
          };
          // 记录本源的取位与总数，供「补拉凑够」用（PCL 的 Storage.ModrinthOffset/Total）
          cursor.modrinth = req.page * req.limit;
          if (req.loader !== undefined) searchOpts.loader = req.loader;
          if (req.gameVersion !== undefined) searchOpts.mcVersion = req.gameVersion;
          if (req.category !== undefined && req.category !== '') {
            searchOpts.category = req.category;
          }
          // 排序：UI 一直传 `sort`，但此前这里**没有透传**（Modrinth 客户端也没这个
          // 参数），等于 UI 的意图全程落空。现在透传，见 api-client.search 的注释。
          if (req.sort !== undefined) searchOpts.index = req.sort;
          const { hits: modrinthHits, total } = await modrinthClient.search(req.query, searchOpts);
          totalCount = Math.max(totalCount, total);
          totals.modrinth = total;
          cursor.modrinth += modrinthHits.length;
          // 搜索命中不带 loader / 支持版本 / downloadUrl —— 列表行要显示它们，
          // 所以还得补一层。PCL 的「Fabric / NeoForge 1.16+」那一行就是这么来的。
          //
          // ⚠️ **不要**按命中逐个 `getVersions(projectId)`：一页 20 条就是 20 次
          // 请求，实测 1.8 秒（Modrinth 单次 ~100ms 但串起来就是这么久）。
          // 改用两次批量，实测 0.85 秒 —— 快一倍，信息一模一样：
          //   1. `getProjectsByIds` → 每项目的 loaders / 支持版本（版本 id 列表顺带拿到）
          //   2. `getVersionsByIds(各项目的最新版本 id)` → 最新版本号 / files（downloadUrl）
          const enriched = await enrichModrinthHits(modrinthClient, modrinthHits, req.contentType, {
            ...(req.gameVersion !== undefined ? { gameVersion: req.gameVersion } : {}),
            ...(req.loader !== undefined ? { loader: req.loader } : {}),
          });
          for (const item of enriched) {
            if (item) modrinthResults.push(item);
          }
        }
      } catch (e) {
        errors.push(`Modrinth: ${(e as Error).message}`);
      }

      // CurseForge 搜索（匿名访问被拒 —— 实测 api.curseforge.com 无 key 返回
      // 403 "Forbidden: API Key missing or invalid"，这是它单方面的强制，
      // Modrinth 则完全允许匿名）
      try {
        if (req.source === 'all' || req.source === 'curseforge') {
          // ⚠️ 这里以前判 `apiKey`：没配 key 就整个不查 CurseForge。
          // 现在**没 key 也能查**（走国内镜像时镜像自带 key，PCL 就是这样）；
          // 配了 key 则走官方源，且 key 不会发给镜像（见 `CurseForgeApiClient`）。
          // 于是这道闸没有了 —— 两边都不通时由下面的 catch 如实报错。
          const cfClient = createCurseForgeClient();
          const cfSearchOpts: {
            loader?: string;
            mcVersion?: string;
            limit?: number;
            index?: number;
            contentType: typeof req.contentType;
            sort: typeof req.sort;
          } = {
            limit: req.limit,
            index: req.page * req.limit,
            contentType: req.contentType,
            // 排序**必须传**：CF 不带 `sortField` 时的返回顺序等于没排
            // （实测：搜 "sodium" 头一条是 "Wick - Smooth & Dynamic Lights"）。
            // 渲染层的排序开关是全局的，Modrinth 走 `index`，CF 走
            // `sortField`，两边同一个"人话"（见 `CurseForgeSort`）。
            sort: req.sort,
          };
          cursor.curseforge = req.page * req.limit;
          if (req.loader !== undefined) cfSearchOpts.loader = req.loader;
          if (req.gameVersion !== undefined) cfSearchOpts.mcVersion = req.gameVersion;
          const { hits: cfHits, total: cfTotal } = await cfClient.search(req.query, cfSearchOpts);
          totalCount = Math.max(totalCount, cfTotal);
          totals.curseforge = cfTotal;
          cursor.curseforge += cfHits.length;
          /**
           * **二次类型过滤** —— CurseForge 的 `classId` 过滤并不可靠：
           * 资源包那个 class 里会混进数据包（PCL 对应 issue #8265）。
           * 唯一可靠的判据是 websiteUrl 的路径，所以这里按它反推真实类型再比一次。
           *
           * 这层过滤放在**服务端**而不是 UI：混进来的条目如果只在渲染层丢，
           * 会白占一整页 20 条的名额，用户看着就是「明明选了资源包却只有 2 条」。
           */
          for (const hit of cfHits) {
            const actual = typeFromWebsite(hit.websiteUrl);
            if (actual !== req.contentType) continue;
            // 数据包还有第二个特征：category id 5193。命中即判为数据包，
            // 防止 websiteUrl 缺失时兜底分类把它误收进资源包。
            if (req.contentType === 'resourcepack' && hit.categoryIds.includes(5193)) continue;
            cfResults.push({
              id: `cf_${hit.id}`,
              name: hit.name,
              summary: hit.summary,
              iconUrl: hit.logoUrl ?? undefined,
              source: 'curseforge',
              contentType: req.contentType,
              gameVersions: [],
              loaders: [],
              slug: hit.name.toLowerCase().replace(/\s+/g, '-'),
              downloads: hit.downloadCount,
              categories: hit.categories,
            });
          }
        }
      } catch (e) {
        errors.push(`CurseForge: ${(e as Error).message}`);
      }

      // 合并结果，mr_ 优先（PCL 的 ResourceSearcher 同样把 Modrinth 排在 CurseForge 前）。
      //
      // total 用的是**源站给的** totalCount，不是合并后的条数：
      // 一个源一页有 limit 条，去重后可能少于 limit，但用户该看到的
      // 「共 N 个结果」和「还有没有下一页」必须按源站点总数判断。
      //
      // 合并 / 跨源重排只做一次 —— 在补拉之后（见下面 `merged`）。
      // 这里原本还先算过一份 `deduped` 再排序，但补拉改成批量之后那份
      // 结果没人读了（补拉用的是 `rowsNow()`），留着只会让人以为
      // 「这里的排序有意义」。

      /**
       * 跨源重排：同一评分口径下比较下载量。
       *
       * 直接比 `downloads` 原始值会失真 —— 两个源的统计口径不同，
       * 同一个模组在 CF 上的数字往往比 MR 高，直接比会让 CF 整体压过 MR。
       * PCL 的处理是给每个源一个系数（ResourceSearcher.GetDownloadCountMult：
       * 模组/整合包 MR×5、资源包/光影 MR×4、数据包 CF×10），再取 log10 压缩量级。
       *
       * 这里沿用同一套系数 —— 它不是玄学，是「哪个源的下载量更接近真实安装量」的
       * 经验修正：Modrinth 的计数更全，所以同等真实热度下 MR 数值偏小，需要放大。
       */
      const platformMult = (e: ModEntry): number => {
        switch (e.contentType) {
          case 'mod':
          case 'modpack':
            return e.source === 'modrinth' ? 5 : 1;
          case 'datapack':
            return e.source === 'curseforge' ? 10 : 1;
          case 'resourcepack':
          case 'shader':
            return e.source === 'modrinth' ? 4 : 1;
          default:
            return 1;
        }
      };

      /**
       * **补拉凑够**（PCL ResourceSearcher 的 NextPage 循环）。
       *
       * 一次取回可能不满一整页，两个原因：
       *  1. CurseForge 的二次类型过滤把混进来的条目剔掉了（选「资源包」时最明显）；
       *  2. 某个源失败/未配置，只剩半个来源。
       *
       * 这时页面会稀稀拉拉 20 条里只有几条，用户看着像"就这些了"。
       * 所以只要**还有源没取尽**且本页明显不足，就再取一轮把它们补上。
       *
       * 上限 2 轮：再多也换不来多少内容，却会让冷门关键词明显变慢。
       */
      const canContinue = (): boolean =>
        (totals.modrinth > -1 && cursor.modrinth < totals.modrinth) ||
        (totals.curseforge > -1 && cursor.curseforge < totals.curseforge);
      /** 用户实际能看到的行数（按去重键算，和最终 merged 的口径一致）。 */
      const rowsNow = (): number =>
        new Set([...modrinthResults, ...cfResults].map((d) => d.slug ?? d.name.toLowerCase())).size;
      for (let round = 0; round < 2; round++) {
        /**
         * **本页够一页就别补。**
         *
         * 上面那段注释一直写着「本页明显不足才补」，但代码里从来没有这条
         * 判断 —— 于是每次搜索都会无条件多补两轮 Modrinth。补的那一轮走的是
         * **逐条**补拉（`enrichModrinthHit` → 每项目一次 `getVersions(无筛选)`），
         * 而那个请求在热门项目上是大件：实测 Fabric API 的版本列表 **1.2MB /
         * 1211 个版本 / 单次 22 秒**。20 条顺序走下来就是"搜索页永远停在
         * 加载中"（不是慢，是分钟级 + 超时重试）。
         *
         * 所以补拉的两个前提缺一不可：**本页不足** + **还有源没取尽**。
         */
        if (rowsNow() >= req.limit) break;
        const before = rowsNow();
        /** 已出现过的条目 id（跨轮共用，避免同一项目补两次）。 */
        const got = new Set([...modrinthResults, ...cfResults].map((d) => d.id));
        // 只补还够得着的源；取不到了就停，否则会空转
        if (
          totals.modrinth > -1 &&
          cursor.modrinth < totals.modrinth &&
          req.source !== 'curseforge'
        ) {
          try {
            const opts: Parameters<typeof modrinthClient.search>[1] = {
              limit: req.limit,
              offset: cursor.modrinth,
              contentType: req.contentType,
            };
            if (req.loader !== undefined) opts.loader = req.loader;
            if (req.gameVersion !== undefined) opts.mcVersion = req.gameVersion;
            if (req.category !== undefined && req.category !== '') opts.category = req.category;
            const more = await modrinthClient.search(req.query, opts);
            cursor.modrinth += more.hits.length;
            /**
             * 补拉也必须走**批量**富化（与主路径同一函数）。
             *
             * 老代码这里是 `for (hit) await enrichModrinthHit(...)` —— 逐条
             * 且每条都要拉全量版本列表，一页 20 条能跑成分钟级。顺序罗列在
             * 这里没有意义：结果最终要按下载量重排，不是按接口顺序。
             */
            const moreEnriched = await enrichModrinthHits(
              modrinthClient,
              more.hits,
              req.contentType,
              {
                ...(req.gameVersion !== undefined ? { gameVersion: req.gameVersion } : {}),
                ...(req.loader !== undefined ? { loader: req.loader } : {}),
              },
            );
            for (const full of moreEnriched) {
              if (full && !got.has(full.id)) {
                got.add(full.id);
                modrinthResults.push(full);
              }
            }
          } catch (e) {
            errors.push(`Modrinth: ${(e as Error).message}`);
            totals.modrinth = -1; // 失败就不再重试这一源
          }
        }
        if (!canContinue() || rowsNow() === before) break;
      }

      // 补拉后重新合并去重 + 重排（上面 sort 用的是补拉前的快照）
      const finalSeen = new Set<string>();
      const merged: ModEntry[] = [];
      for (const item of [...modrinthResults, ...cfResults]) {
        const key = item.slug ?? item.name.toLowerCase();
        if (!finalSeen.has(key)) {
          finalSeen.add(key);
          merged.push(item);
        }
      }
      merged.sort((a, b) => {
        const sa = Math.log10(Math.max(a.downloads ?? 0, 1) * platformMult(a));
        const sb = Math.log10(Math.max(b.downloads ?? 0, 1) * platformMult(b));
        return sb - sa;
      });

      /**
       * **不截断**去重后的结果。
       *
       * 两个源各返回 limit 条，去重后可能多于 limit（Modrinth 20 + CF 20 → 最多 40）。
       * 之前这里 `slice(0, req.limit)` 会把多出来的直接砍掉 —— 用户点「加载更多」
       * 时下一页永远补不齐，而且被砍掉的那半在下一轮 offset 里还会再出现，
       * 造成「加载更多没反应」。
       *
       * 上限由请求方自己控制（渲染层按需追加），这里给足即可。
       */
      return {
        mods: merged,
        total: totalCount,
        page: req.page,
        // 还有下一页 = 两个源都还没取尽。取 max 是保守的：任一源还有货就继续。
        hasMore: (req.page + 1) * req.limit < totalCount,
        curseForgeConfigured: loadCurseForgeConfig().apiKey !== '',
        error: errors.length > 0 ? errors.join('; ') : null,
      };
    },
  );

  ipcMain.handle(
    LAUNCHER_DOWNLOAD_MOD,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherDownloadModResponse>> => {
      const req = LauncherDownloadModRequest.parse(raw);
      /**
       * 数据包的目标世界校验**放在任何网络请求之前**。
       *
       * 不是为了省一次请求 —— 是因为原版只有 `saves/<世界>/datapacks/`，
       * 没有世界名就根本无处可放。而如果校验排在网络之后，用户看到的是
       * 「网络超时」或「版本找不到」，跟「你还没选世界」毫无关系。
       */
      if (req.contentKind === 'datapack' && req.world === undefined) {
        return {
          ok: false,
          path: null,
          mod: null,
          error: missingWorldError(),
        };
      }
      try {
        if (req.modId.startsWith('mr_')) {
          const projectId = req.modId.slice(3);
          /**
           * 版本**按目标实例过滤**（见 `versionFilterOf`）。
           *
           * 这条路径的语义是"给我装一个能跑的版本"，所以不能取最新版充数：
           * 实测 1.20.1 + Fabric 实例会拿到 26.x 的构建。数据包还必须按
           * `datapack` 过滤 —— 实测 Terralith / Dungeons and Taverns / Tectonic
           * 等项目的**最新版是 mod 构建**（`.jar`），不筛就会把一个 jar 放进
           * `saves/<世界>/datapacks/`（游戏不读）。
           */
          const filter = versionFilterOf(req.targetInstance, req.contentKind);
          const versions = await modrinthClient.getVersions(projectId, filter);
          if (versions.length === 0) {
            const need =
              `需要 ${filter.mcVersion ?? '任意 MC 版本'}` +
              (filter.loader === undefined ? '' : ` + ${filter.loader}`);
            return {
              ok: false,
              path: null,
              mod: null,
              error:
                `找不到与该实例兼容的版本（${need}）。` +
                (req.contentKind === 'datapack'
                  ? '这个项目可能只提供 mod 版：请在详情页选一个 .zip 的数据包版本，' +
                    '或改到「模组」分类下载。'
                  : '请在详情页手动挑一个版本。'),
            };
          }
          const latest = versions[0];
          const primaryFile = latest.files.find((f) => f.primary) ?? latest.files[0];
          if (!primaryFile) {
            return { ok: false, path: null, mod: null, error: 'No files found' };
          }
          const url = primaryFile.url;
          if (!url) {
            return { ok: false, path: null, mod: null, error: 'No download URL' };
          }
          /**
           * 落盘到**目标实例**里该内容类型对应的目录。
           *
           * 之前写的是 `join(launcherDir, 'mods')` —— 一个谁也不读的目录，
           * 下了等于没下，而且多实例必然互相串。
           *
           * ⚠️ 而且不能一律进 `mods/`：资源包/光影包/数据包放进去会被加载器
           * 当 mod 扫（见 `contentDir()` 的注释）。走 `contentDir()` 还有
           * 路径穿越防护（assertVersionId / resolveInside）。
           */
          const instGameDir = gameDirOf(req.targetInstance);
          const modsDir =
            req.contentKind === 'datapack'
              ? req.world === undefined
                ? null
                : launcher.datapackDir(req.targetInstance, req.world, instGameDir)
              : launcher.contentDir(req.targetInstance, req.contentKind, instGameDir);
          if (modsDir === null) {
            return { ok: false, path: null, mod: null, error: missingWorldError() };
          }
          await mkdir(modsDir, { recursive: true });
          const filename = primaryFile.filename ?? `${projectId}.jar`;
          const dest = join(modsDir, filename);
          // 候选源（官方 / 国内镜像）+ sha1 校验 + 重试，见 LauncherService.fetchContent
          const buf = await launcher.fetchContent(url, {
            sha1: primaryFile.hashes?.sha1 ?? null,
            size: primaryFile.size ?? null,
          });
          await nodeFs.writeFileSync(dest, buf);
          // 同项目换版本时把旧 jar 删掉：两个同 mod id 的 jar 会让游戏拒启动
          replacePreviousDownload(instGameDir, modsDir, req.modId, filename, url);

          /**
           * 连带下载 required 依赖（前置）—— 实现见 `installModrinthDependencies`。
           *
           * 少了这一步，用户下载 Sodium 却没装 Fabric API，装进实例启动直接崩 ——
           * 看起来像"下载功能坏了"。PCL / HMCL 都会把前置一起拉下来。
           *
           * 版本按**目标实例**过滤（`filter`）：不然会拿到给最新 MC 版本构建的前置。
           * 依赖是否已装由 `installModrinthDependencies` 里落盘前的逐文件比对判断。
           */
          const missingDeps = await installModrinthDependencies({
            version: latest,
            targetInstance: req.targetInstance,
            world: req.world,
            filter,
          });

          return {
            ok: true,
            path: dest,
            mod: {
              id: req.modId,
              name: latest.name ?? projectId,
              source: 'modrinth',
              contentType: 'mod',
              gameVersions: latest.game_versions ?? [],
              loaders: [],
            },
            error: null,
            ...(missingDeps.length > 0 ? { missingDependencies: missingDeps } : {}),
          };
        } else if (req.modId.startsWith('cf_')) {
          const modId = req.modId.slice(3);
          // 没配 key 也能下：走国内镜像时镜像自带 key（见 `CurseForgeApiClient`）。
          const cfClient = createCurseForgeClient();
          /**
           * 文件**按目标实例过滤**（与 Modrinth 分支同一套判据 `versionFilterOf`）。
           * 老实现直接取 `files[0]`（= 最新版，不管实例）—— 判据本身在
           * `cf-file-pick.ts`，那里也写了为什么它必须能被单测。
           */
          const filter = versionFilterOf(req.targetInstance, req.contentKind);
          const allFiles = await cfClient.getFiles(Number(modId), {});
          if (allFiles.length === 0) {
            return { ok: false, path: null, mod: null, error: 'No files found' };
          }
          // `datapack` 是 Modrinth 的 loader 值，CF 侧没有对应项（数据包靠
          // classId 分类），所以只用来判「不要按 loader 过滤」。
          const wantLoader = filter.loader === 'datapack' ? undefined : filter.loader;
          const need: CfFileNeed = {
            ...(filter.mcVersion !== undefined ? { mcVersion: filter.mcVersion } : {}),
            ...(wantLoader !== undefined ? { loader: wantLoader } : {}),
          };
          const latest = pickCurseForgeFile(allFiles, need);
          if (latest === null) {
            return {
              ok: false,
              path: null,
              mod: null,
              error:
                `找不到与该实例兼容的文件（需要 ${describeCfFileNeed(need)}）。` +
                '请在详情页手动挑一个版本。',
            };
          }
          const url = latest.downloadUrl;
          if (!url) {
            return { ok: false, path: null, mod: null, error: 'No download URL' };
          }
          /**
           * CF 的文件级依赖**有必需/可选标记**（`{modId, relationType}`，实测
           * 见 `packages/core/src/curseforge/dependencies.ts`），但**没有版本号**
           * —— 拿不准该装哪个版本，所以不自动下依赖，只把**必需**前置列出来
           * 让用户自己决定。可选的（`relationType=2`，如 JEI 的 MezzConfigGUI）
           * 不报：「缺前置会导致启动失败」这种话只能对真前置说。
           */
          const missingDeps = await describeCfDependencies(cfClient, requiredDependencyIds(latest));
          const instGameDir = gameDirOf(req.targetInstance);
          const modsDir =
            req.contentKind === 'datapack'
              ? req.world === undefined
                ? null
                : launcher.datapackDir(req.targetInstance, req.world, instGameDir)
              : launcher.contentDir(req.targetInstance, req.contentKind, instGameDir);
          if (modsDir === null) {
            return { ok: false, path: null, mod: null, error: missingWorldError() };
          }
          await mkdir(modsDir, { recursive: true });
          const filename = latest.fileName ?? `${modId}.jar`;
          const dest = join(modsDir, filename);
          // 候选源 + sha1 校验（CF 的 sha1 是 hashes 里 algo===1 那条）
          const buf = await launcher.fetchContent(url, {
            sha1: latest.hashes?.find((h) => h.algo === 1)?.value ?? null,
            size: latest.fileLength ?? null,
          });
          await nodeFs.writeFileSync(dest, buf);
          // 同项目换版本时把旧 jar 删掉：两个同 mod id 的 jar 会让游戏拒启动
          replacePreviousDownload(instGameDir, modsDir, req.modId, filename, url);
          return {
            ok: true,
            path: dest,
            mod: {
              id: req.modId,
              name: latest.displayName ?? modId,
              source: 'curseforge',
              contentType: 'mod',
              gameVersions: latest.gameVersions,
              // 之前恒为 `[]`（CF 的 `modLoaders` 字段实测根本不存在，见
              // `curseforgeLoaderNames`）—— 现在 loader 从 gameVersions 里认出来，
              // 「已装内容」列表才不至于把加载器一栏永远留空。
              //
              // 过一遍 `ModLoader` 枚举：认出来的名字要能进响应的 schema，
              // 认不出的（源站将来新增的加载器）宁可不报也不能塞进去。
              loaders: latest.modLoaderNames
                .map(curseforgeLoaderKey)
                .filter((l): l is (typeof ModLoader.options)[number] =>
                  (ModLoader.options as readonly string[]).includes(l),
                ),
            },
            error: null,
            ...(missingDeps.length > 0 ? { missingDependencies: missingDeps } : {}),
          };
        }
        return { ok: false, path: null, mod: null, error: 'Unknown mod source' };
      } catch (e) {
        return { ok: false, path: null, mod: null, error: (e as Error).message };
      }
    },
  );

  /**
   * 项目详情（PCL 点击搜索结果后弹出的那个页面）。
   *
   * 与搜索同构：mr_ / cf_ 前缀定来源，两边版本模型不同（Modrinth 一个 version
   * 多 files；CurseForge 一个 file 一条），统一映射成 ModVersion[]。
   * 任一侧失败只影响那一侧的数据，另一侧照样返回 —— 不整条 500。
   */
  ipcMain.handle(
    LAUNCHER_GET_MOD_DETAIL,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherGetModDetailResponse>> => {
      const req = LauncherGetModDetailRequest.parse(raw);
      try {
        if (req.modId.startsWith('mr_')) {
          const projectId = req.modId.slice(3);
          const [project, versions] = await Promise.all([
            modrinthClient.getProject(projectId),
            modrinthClient.getVersions(projectId, {}),
          ]);
          return {
            detail: {
              id: req.modId,
              name: project.title,
              summary: project.description,
              body: project.body,
              iconUrl: project.icon_url ?? undefined,
              source: 'modrinth',
              contentType: req.contentType,
              categories: project.categories,
              gameVersions: project.game_versions,
              // 与搜索侧保持一致：只暴露 UI 提供的 NeoForge / Fabric
              loaders: project.loaders.filter((l) => l === 'fabric' || l === 'neoforge'),
              downloads: project.downloads,
              wikiUrl: project.wiki_url,
              issuesUrl: project.issues_url,
              latestVersion: project.versions[0],
              publishedAt: parseTimeMs(project.published),
              updatedAt: parseTimeMs(project.updated),
              versions: versions.map((v) => ({
                id: v.id,
                versionNumber: v.version_number,
                name: v.name,
                datePublished: parseTimeMs(v.date_published),
                gameVersions: v.game_versions ?? [],
                loaders: v.loaders ?? [],
                files: v.files.map((f) => ({
                  filename: f.filename,
                  url: f.url,
                  size: f.size,
                  sha1: f.hashes?.sha1,
                  primary: f.primary,
                })),
              })),
            },
            error: null,
          };
        }
        if (req.modId.startsWith('cf_')) {
          const modId = Number(req.modId.slice(3));
          // 没配 key 也能看详情：走国内镜像时镜像自带 key
          const cfClient = createCurseForgeClient();
          const [project, files] = await Promise.all([
            cfClient.getMod(modId),
            cfClient.getFiles(modId, {}),
          ]);
          return {
            detail: {
              id: req.modId,
              name: project.name,
              summary: project.summary,
              /**
               * 长描述：**镜像不给**（实测 `/mods/{id}` 没有 `description`，
               * 也没有 `/mods/{id}/description` 端点，404）→ 退回 `summary`，
               * 至少让用户看到一句话，而不是一片空白。
               */
              body: project.description ?? project.summary,
              iconUrl: undefined,
              source: 'curseforge',
              contentType: req.contentType,
              // `categories` 按可选处理：老实现直接 `.map`，一旦某个项目少了
              // 这个字段，整页详情就是 `undefined.map` 报错。
              categories: (project.categories ?? []).map((c) => c.name),
              // 这两个都是**已经过 `CurseForgeApiClient` 归一化**的：gameVersions
              // 只含 MC 版本（源站的数组里混着 "Client"/"Server"/loader 名，直接
              // 摊平会把它们当版本 tab 显示出来），loader 名则是从同一个数组里
              // 认出来的（源站的 `modLoaders` 字段实测不存在）。
              //
              // ⚠️ 必须**去重**：这两份数据是 500 个文件摊平出来的，JEI 这种
              // 项目会得到 200 个 "NeoForge"、200 个 "Fabric" —— 详情页头部
              // 那一行会变成一堵复读墙（`loaders.join(' / ')`）。
              gameVersions: [...new Set(files.flatMap((f) => f.gameVersions))],
              loaders: [...new Set(files.flatMap((f) => f.modLoaderNames))],
              downloads: project.downloadCount,
              // ⚠️ 外链在 `links` 里，**不是**顶层的 `wikiUrl` / `issueTrackerUrl`
              // （实测 JEI：links={websiteUrl,wikiUrl,issuesUrl,sourceUrl}，
              // 而且 wikiUrl 可能是空串 —— 空串当"没有"，别渲染出个空链接）。
              wikiUrl: project.links?.wikiUrl || undefined,
              sourceUrl: project.links?.sourceUrl || undefined,
              issuesUrl: project.links?.issuesUrl || undefined,
              publishedAt: parseTimeMs(project.dateCreated),
              updatedAt: parseTimeMs(project.dateModified),
              versions: files.map((f) => ({
                id: String(f.id),
                versionNumber: f.displayName,
                name: f.fileName,
                // 源站 `fileDate`（ISO）。缺了就 undefined，渲染层照旧按接口顺序显示。
                datePublished: parseTimeMs(f.fileDate),
                // releaseType：1=release、2=beta、3=alpha（实测依据见
                // `CurseForgeFile.releaseType`）。别的数字一律不猜。
                versionType:
                  f.releaseType === 1
                    ? 'release'
                    : f.releaseType === 2
                      ? 'beta'
                      : f.releaseType === 3
                        ? 'alpha'
                        : undefined,
                gameVersions: f.gameVersions,
                loaders: f.modLoaderNames,
                downloads: undefined,
                files: f.downloadUrl
                  ? [
                      {
                        filename: f.fileName,
                        url: f.downloadUrl,
                        size: f.fileLength,
                        sha1: f.hashes?.find((h) => h.algo === 1)?.value,
                        primary: true,
                      },
                    ]
                  : [],
              })),
            },
            error: null,
          };
        }
        return { detail: null, error: '未知的来源前缀' };
      } catch (e) {
        return { detail: null, error: (e as Error).message };
      }
    },
  );

  /**
   * 按 URL 直下一个文件（详情页的具体文件行）。
   *
   * 复用与 `launcherDownloadMod` 相同的落盘目录，但**不做** modId 解析 ——
   * URL 是渲染层从版本数据里直接拿的，解析反而会下错文件。
   */
  ipcMain.handle(
    LAUNCHER_DOWNLOAD_URL,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherDownloadUrlResponse>> => {
      const req = LauncherDownloadUrlRequest.parse(raw);
      // 同 LAUNCHER_DOWNLOAD_MOD：先校验再联网，理由见 missingWorldError
      if (req.contentKind === 'datapack' && req.world === undefined) {
        return { ok: false, path: null, error: missingWorldError() };
      }
      try {
        // 只取末段当文件名：URL 的 path 里可能带查询串，且要防 ../ 穿越
        const raw = req.url.split('?')[0].split('/').pop() ?? '';
        const filename = req.filename ?? (raw || `download-${Date.now()}`);
        if (filename.includes('/') || filename.includes('\\') || filename === '..') {
          return { ok: false, path: null, error: `非法文件名: ${filename}` };
        }
        // 落盘到目标实例里**该内容类型对应的目录**。
        //
        // 关键点：不能再一律进 `mods/`。资源包/光影包/数据包进 `mods/` 会被
        // Fabric/NeoForge 的加载器当 mod 扫描并炸掉，而症状与「资源包」毫无
        // 关系。数据包还要具体到某个世界 —— 原版没有实例级数据包目录。
        // 依据见 `LauncherService.contentDir()` / `datapackDir()` 的注释。
        const gameDir = gameDirOf(req.targetInstance);
        const destDir =
          req.contentKind === 'datapack'
            ? // 没有世界名就无处可放，当场拒 —— 放进 mods/ 是错的，
              // 放进 gameDir/datapacks/ 原版也不读（那是 mod 才有的目录）
              req.world === undefined
              ? null
              : launcher.datapackDir(req.targetInstance, req.world, gameDir)
            : launcher.contentDir(req.targetInstance, req.contentKind, gameDir);
        if (destDir === null) {
          return { ok: false, path: null, error: missingWorldError() };
        }
        await mkdir(destDir, { recursive: true });
        const dest = join(destDir, filename);
        // 候选源（官方 / 国内镜像）+ 清单给的 sha1/size 校验。
        // 渲染层在详情页把 `ModVersionFile.sha1/size` 一起传过来（见 IPC schema）。
        const buf = await launcher.fetchContent(req.url, {
          sha1: req.sha1 ?? null,
          size: req.size ?? null,
        });
        await nodeFs.writeFileSync(dest, buf);
        // 同项目换版本时把旧文件删掉（两个同 mod id 的 jar 会让游戏拒启动）。
        // 没有 modId 的裸链接（用户贴的直链）认不出项目，就不动任何旧文件。
        if (req.modId !== undefined) {
          replacePreviousDownload(gameDir, destDir, req.modId, filename, req.url);
        }

        /**
         * 连带把 required 前置也下下来。
         *
         * 只有 Modrinth 能这么干：`collectRequiredDependencies` 需要版本对象
         * （依赖图挂在版本上），而这里手上只有一个 URL，得先把它定位回版本。
         *
         * CurseForge 侧**能**定位，但**不能**自动装（文件级依赖只有 modId，
         * 没有该装哪个版本的信息）—— 所以只核对出**必需**前置报给用户：
         * 靠 CF 自己的 URL 约定反推文件 id（`curseforgeFileIdFromUrl`），
         * 再问一次源站拿这个文件的依赖（`relationType=3` 才算前置，实测见
         * `packages/core/src/curseforge/dependencies.ts`）。反推不出来就如实说
         * 「没核对」—— 以前这里对**每次** CF 下载都喊一句「前置需手动安装」，
         * 连一个依赖都没有的 mod 也照喊。
         *
         * 定位不到就**说出来**，不静默跳过 —— 用户需要知道「这个 mod 的前置
         * 没跟着装」，否则装完起不来会以为是下载功能坏了。
         */
        const missingDeps: string[] = [];
        const modId = req.modId;
        if (modId === undefined) {
          missingDeps.push('（请求未带 modId，无法核对前置）');
        } else if (modId.startsWith('mr_')) {
          const projectId = modId.slice(3);
          try {
            const versions = await modrinthClient.getVersions(projectId);
            // 用「文件 URL 相同」来定位版本 —— 不能拿 versions[0]：
            // 详情页点的是用户选中的**那个文件**，可能是旧版本。
            const matched = versions.find((v) => v.files.some((f) => f.url === req.url));
            if (matched === undefined) {
              missingDeps.push('（未能把下载地址对应回版本，无法核对前置）');
            } else {
              missingDeps.push(
                ...(await installModrinthDependencies({
                  version: matched,
                  targetInstance: req.targetInstance,
                  world: req.world,
                  // 这条路径用户已经指定了具体文件（URL），但**前置**仍要按实例过滤：
                  // 1.20.1 实例不该被装上 26.x 的 Fabric API
                  filter: versionFilterOf(req.targetInstance, req.contentKind),
                })),
              );
            }
          } catch (e) {
            missingDeps.push(`前置解析失败：${(e as Error).message}`);
          }
        } else if (modId.startsWith('cf_')) {
          const fileId = curseforgeFileIdFromUrl(req.url);
          if (fileId === null) {
            missingDeps.push('（下载地址里没有 CurseForge 文件 id，前置未核对）');
          } else {
            try {
              const cfClient = createCurseForgeClient();
              const file = (await cfClient.getFilesByIds([fileId])).get(fileId);
              if (file === undefined) {
                missingDeps.push('（源站查不到该文件的依赖信息，前置未核对）');
              } else {
                missingDeps.push(
                  ...(await describeCfDependencies(cfClient, requiredDependencyIds(file))),
                );
              }
            } catch (e) {
              missingDeps.push(`前置解析失败：${(e as Error).message}`);
            }
          }
        }

        return {
          ok: true,
          path: dest,
          ...(missingDeps.length > 0 ? { missingDependencies: missingDeps } : {}),
          error: null,
        };
      } catch (e) {
        return { ok: false, path: null, error: (e as Error).message };
      }
    },
  );

  /**
   * 取整合包清单：`.mrpack` 优先，失败降级到纯 API。
   *
   * 两条路的差别不是「哪个更简洁」而是**有没有 overrides**：
   * `.mrpack` 里实测有 51 个配置文件（`options.txt`、各 mod 的 toml/json、
   * 18 个语言包）。纯 API 路线一个都拿不到，mod 会全跑默认参数 ——
   * 用户看到的是「整合包装了，但和没装一样」。
   *
   * 所以降级时会把这件事写进 `manifest.missing`，让 UI 如实说，而不是假装装全了。
   *
   * `.mrpack` 本身的失败（下载失败 / zip 损坏 / 没有 index.json）都在这里
   * 被吞掉并降级 —— 但**清单本身不合法**（不声明 MC 版本 / 要 Forge）必须抛出去：
   * 那种情况下纯 API 也拿不到正确结果，降级只会产生一个更难懂的错。
   */
  const loadManifestWithFallback = async (
    client: ModrinthApiClient,
    pack: ModrinthVersion,
    signal?: AbortSignal,
  ): Promise<ModpackManifest> => {
    throwIfAborted(signal);
    const primary = pack.files.find((f) => f.primary) ?? pack.files[0];
    if (primary?.url) {
      try {
        /**
         * ⚠️ 这里以前用 core 的 `fetchMrpack(url)`：它自己 `fetch` 一次，
         * **不认候选源** —— 走国内镜像的用户到这一步会退回直连官方 CDN
         * （整合包清单动辄几 MB，正好是最需要镜像的一步）。
         * 现在统一走 `launcher.fetchContent`：候选源 + sha1 校验 + 重试，
         * 解包仍是纯函数 `parseMrpack`。
         */
        const buf = await launcher.fetchContent(
          primary.url,
          { sha1: primary.hashes?.sha1 ?? null, size: primary.size ?? null },
          MRPACK_MAX_BYTES,
          signal,
        );
        throwIfAborted(signal);
        const manifest = parseMrpack(buf, {
          projectId: pack.project_id,
          versionId: pack.id,
          versionNumber: pack.version_number,
        });
        // CF 重定向条目补齐下载地址（走镜像，没配 key 也能补）
        await fillCurseForgeRedirects(client, manifest, signal);
        return manifest;
      } catch (e) {
        // 取消不是「清单坏了」：不能再降级去发 API 请求。
        if (isAbortError(e) || signal?.aborted) throw abortError();
        // 降级，但把原因记下来 —— 用户该知道配置没铺上
        const fallback = await abortable(buildModpackManifestFromApi(pack, client), signal);
        fallback.missing.push({
          name: '(.mrpack)',
          reason: `读取整合包清单失败，已降级为按 API 装 mod（配置不会铺）：${(e as Error).message}`,
        });
        return fallback;
      }
    }
    return abortable(buildModpackManifestFromApi(pack, client), signal);
  };

  /** 把清单里 CurseForge 重定向条目的下载地址补上。 */
  const fillCurseForgeRedirects = async (
    client: ModrinthApiClient,
    manifest: ModpackManifest,
    signal?: AbortSignal,
  ): Promise<void> => {
    for (const f of manifest.files) {
      throwIfAborted(signal);
      if (f.url !== null || !f.curseforge) continue;
      const url = await resolveCurseForgeRedirect(f.curseforge, signal);
      if (url) f.url = url;
    }
    void client;
  };

  /**
   * `curseforge:<projectId>:<fileId>` → 下载直链。
   *
   * 请求失败 / 拿不到文件 → 返回 null，让上层把该条目报成「装不了」并说明原因。
   * **不返回 403 地址**：那会让用户看到一个与失败原因毫无关系的 HTTP 错误。
   *
   * 这里以前要求 `cfApiKey`（"有 key 才做"）—— 现在不用了：走国内镜像时镜像
   * 自带 key，没配 key 也能把 CF 重定向补上（PCL 的整合包安装就是这么走的）。
   */
  const resolveCurseForgeRedirect = async (
    redirect?: {
      projectId: number;
      fileId: number;
    },
    signal?: AbortSignal,
  ): Promise<string | null> => {
    if (!redirect) return null;
    throwIfAborted(signal);
    try {
      const files = await abortable(
        createCurseForgeClient().getFiles(redirect.projectId, {}),
        signal,
      );
      throwIfAborted(signal);
      const f = files.find((x) => x.id === redirect.fileId);
      return f?.downloadUrl ?? null;
    } catch (e) {
      // 取消要往上传，不能被「拿不到直链」吞掉。
      if (isAbortError(e) || signal?.aborted) throw abortError();
      return null;
    }
  };

  /**
   * 安装整合包（**新建**一个实例）。
   *
   * 与 `launcherDownloadMod` 是两件不同的事：那条往**已有实例**塞一个 jar；
   * 这条要
   * 1. 取整合包完整清单（`.mrpack` 优先，见 `loadManifestWithFallback`）
   * 2. 按清单定的 MC 版本建实例、装对应加载器（**用清单指定的精确版本**）
   * 3. 铺 overrides 到 gameDir
   * 4. 把清单里的每个文件下到该实例
   *
   * ⚠️ **落到哪个目录由实例记录决定**：实例名 = 显示名 = 目录名（多实例），
   * 所以安装用的是 `create()` 返回记录里的 `gameDir`。以前这里拿 MC 版本号
   * 去现算 `game/<版本号>`，装完那个目录没有任何实例在读 —— 点「开始游戏」
   * 进去一个 mod 都没有（2026-10-18 实测）。
   *
   * 重名但**版本不同**时另起一个 `(2)` 名字（不覆盖别人的实例）；同名的同版本
   * 才是故意覆盖（重装 / 更新同一个整合包）。覆盖前渲染层会先问过用户。
   */
  /**
   * 中文词 → 英文项目名（MC百科 别名查询）。
   *
   * 带一个**进程内缓存**：MC百科 实测限流很凶（连着几个请求就 429），
   * 而用户在搜索框里改一个字符就会重查一次。缓存按 key 记忆，
   * 被限流的词不缓存（过一会儿可能就好了）。
   *
   * 失败**不抛**：别名查不到只是少个中文提示，不该让整个搜索失败 ——
   * 用户照样能用英文搜。
   */
  ipcMain.handle(
    LAUNCHER_MOD_CN_ALIAS,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherModCnAliasResponse>> => {
      try {
        const req = LauncherModCnAliasRequest.parse(raw);
        const cacheKey = `${req.key.trim().toLowerCase()}|${req.limit ?? 3}`;
        const hit = cnAliasCache.get(cacheKey);
        if (hit) return hit;

        const aliases = await searchMcmodAliases(req.key);
        const englishNames = pickEnglishNames(aliases, req.key, req.limit ?? 3);
        const res = { englishNames, aliases, error: null };
        // 只缓存"查到了"的：空结果可能是限流/页面结构变了，
        // 缓存空值会让用户改个词也一直看到"没有"。
        if (englishNames.length > 0) cnAliasCache.set(cacheKey, res);
        return res;
      } catch (e) {
        return { englishNames: [], aliases: [], error: (e as Error).message };
      }
    },
  );

  ipcMain.handle(
    LAUNCHER_INSTALL_MODPACK,
    async (e, raw: unknown): Promise<z.infer<typeof LauncherInstallModpackResponse>> => {
      let req: z.infer<typeof LauncherInstallModpackRequest>;
      try {
        req = LauncherInstallModpackRequest.parse(raw);
      } catch (err) {
        return { ok: false, error: (err as Error).message };
      }
      const isCurseForge = req.modId.startsWith('cf_');
      if (!req.modId.startsWith('mr_') && !isCurseForge) {
        return { ok: false, error: `未知的来源前缀: ${req.modId}` };
      }

      /**
       * 同一个包版本只允许一个安装任务。否则连点两下「安装」会同时往同一个
       * 实例目录写文件，取消也不知道该取消哪一个。
       */
      const installKey = modpackKey(e.sender.id, req.modId, req.versionId);
      if (modpackInstalls.has(installKey)) {
        return { ok: false, error: '这个整合包正在安装，请等待完成或先取消' };
      }
      const controller = new AbortController();
      const signal = controller.signal;
      modpackInstalls.set(installKey, { controller, senderId: e.sender.id });

      // 取消时也要把「已经做到哪一步」如实带回渲染层，不能只说一句「失败了」。
      let createdInstanceId: string | null = null;
      let createdGameDir: string | null = null;
      let installed = 0;
      const failed: Array<{ name: string; error: string | null }> = [];

      // 每次调用都现读配置 —— 用户可能刚在设置里填上 key（与搜索通道同一约定）。
      // ⚠️ **没 key 不再等于装不了**：CurseForge 侧每一环（清单、文件地址、
      // 重定向）走国内镜像时都由镜像自带 key（PCL 就是这么装的）。
      // 真正装不了的时候会由具体那一步如实抛错，不再在这里一刀切。
      const emit = (
        stage: string,
        done: number,
        total: number,
        instanceId: string,
        current?: string,
      ): void => {
        const msg = {
          instanceId,
          stage,
          done,
          total,
          ...(current !== undefined ? { current } : {}),
        };
        try {
          e.sender.send(LAUNCHER_MODPACK_PROGRESS, msg);
        } catch {
          // 渲染层已经关了：进度发不出去不该让安装失败
        }
      };

      try {
        const modrinthClient = createModrinthClient();
        // ---- 1. 解析清单 ----
        emit('resolve', 0, 1, req.versionId);

        /**
         * 两个源的清单结构**完全不同**，所以是两条独立路径而不是「统一成一个
         * manifest 再填字段」：
         *
         * | | Modrinth | CurseForge |
         * |---|---|---|
         * | 清单在哪 | 版本对象的 `files[]` + `.mrpack` 里的 overrides | 整合包 zip 里的 `manifest.json` |
         * | MC 版本 | `game_versions[0]` / `dependencies.minecraft` | `minecraft.version` |
         * | 加载器 | `loaders[0]` / `dependencies["fabric-loader"]` | `minecraft.modLoaders[].id` = `fabric-<ver>` |
         * | 文件地址 | CDN 直链 | 只有 projectID/fileID，要再查 API |
         *
         * 强行统一只会得到一个字段名写着「两者通用」、实际一半是空的类型。
         * 这里让两边都产出 `ModpackManifest` 这个**形状**（这是下游真正需要的），
         * 但产生方式各自独立。
         */
        const manifest: ModpackManifest = isCurseForge
          ? await (async () => {
              const cfClient = createCurseForgeClient();
              // 整合包 zip 本身是项目下的一个「文件」，要先定位到它
              const files = await abortable(
                cfClient.getFiles(Number(req.modId.slice(3)), {}),
                signal,
              );
              throwIfAborted(signal);
              const zipFile = files.find((f) => String(f.id) === req.versionId) ?? files[0] ?? null;
              if (!zipFile?.downloadUrl) {
                throw new Error('拿不到整合包文件的下载地址（项目可能已下架）');
              }
              // 走候选源（官方 / 国内镜像）+ sha1 校验，与 mod 文件同一条路
              const zipBuf = await launcher.fetchContent(
                zipFile.downloadUrl,
                {
                  sha1: zipFile.hashes?.find((h) => h.algo === 1)?.value ?? null,
                  size: zipFile.fileLength ?? null,
                },
                undefined,
                signal,
              );
              throwIfAborted(signal);
              const m = await abortable(
                buildCfModpackManifest(zipBuf, cfClient, {
                  projectId: Number(req.modId.slice(3)),
                  versionId: Number(req.versionId),
                }),
                signal,
              );
              return {
                projectId: req.modId,
                versionId: req.versionId,
                // CF 侧版本号就是文件的 displayName（实测形如 "1.2.3"）
                versionNumber: zipFile.displayName ?? '',
                mcVersion: m.mcVersion,
                loader: m.loader,
                loaderVersion: m.loaderVersion,
                files: m.files,
                overrides: m.overrides,
                missing: m.missing,
              };
            })()
          : await (async () => {
              const pack = await abortable(modrinthClient.getVersion(req.versionId), signal);
              return loadManifestWithFallback(modrinthClient, pack, signal);
            })();

        throwIfAborted(signal);
        const { mcVersion, loader } = manifest;
        // loader 为 null = 清单要求的加载器我们不支持（CF 的 Forge 整合包会走到这里）。
        // 硬装成 neoforge 会做出一个起不来的实例，比当场拒绝糟得多。
        if (!loader) {
          return {
            ok: false,
            error:
              manifest.missing.find((m) => m.reason.includes('加载器'))?.reason ??
              '整合包要求的加载器不受支持',
          };
        }
        // ---- 2. 建实例 + 装加载器 ----
        emit('loader', 0, 1, mcVersion, loader);

        /**
         * 实例名 = 显示名 = 目录名（见 `instance-registry.create`）。
         *
         * ⚠️ 但**同名 ≠ 同版本**时必须换一个不撞的名字：`create()` 撞 id 是
         * 就地覆盖，一个 1.21 的整合包会把「同名、装的是 26.3」那条记录连
         * `versionId` 一起改掉，目录里却还躺着 1.21 的旧 mods。
         * 同名的**同版本**实例才是故意覆盖（重装 / 更新同一个整合包 → 同一个
         * 目录，上一版留下的同名文件由账本的替换语义清掉）。
         */
        const packName = req.instanceName ?? mcVersion;
        const clash = instances
          .list()
          .find((i) => i.name === packName && i.versionId !== mcVersion);
        const instance = instances.create({
          versionId: mcVersion,
          name: clash
            ? dedupeInstanceName(
                packName,
                instances.list().map((i) => i.id),
              )
            : packName,
          loader: loader === 'fabric' ? 'fabric' : 'neoforge',
          source: 'downloaded',
          sourceVersion: manifest.versionNumber,
        });
        createdInstanceId = instance.id;
        // 在装加载器之前就把目录记下来：取消发生在下载客户端 / 加载器阶段时，
        // 渲染层也要能告诉用户「文件保留在哪个实例」。
        createdGameDir = instance.gameDir ?? launcher.gameDir(instance.id);
        throwIfAborted(signal);
        // 客户端 / 资源 / 库 —— 有了它们 launchGame 才跑得起来（版本级，与实例无关）
        const detail = await launcher.resolveVersion(mcVersion, signal);
        throwIfAborted(signal);
        emit('loader', 0, 3, instance.id);
        await launcher.downloadClient(detail, undefined, signal);
        throwIfAborted(signal);
        emit('loader', 1, 3, instance.id);
        await launcher.downloadAssets(detail, undefined, signal);
        throwIfAborted(signal);
        emit('loader', 2, 3, instance.id);
        await launcher.downloadLibraries(detail, undefined, signal);
        throwIfAborted(signal);
        emit('loader', 3, 3, instance.id);

        if (!(await launcher.isLoaderInstalled(mcVersion, loader as 'fabric' | 'neoforge'))) {
          await launcher.installLoader(
            mcVersion,
            loader as 'fabric' | 'neoforge',
            undefined,
            manifest.loaderVersion ?? undefined,
            signal,
          );
        }
        throwIfAborted(signal);

        // ---- 3. 铺清单 ----
        // **实例记录里的** gameDir，而不是 `gameDir(mcVersion)` 现算一个：
        // 实例 id = 整合包名字（多实例），现算出来的 `game/<版本号>` 没有任何
        // 实例在读 —— 装完点「开始游戏」进去一个 mod 都没有（实测踩过）。
        // 老记录可能没写 gameDir（类型上是 optional），回落到同一条默认推导，
        // 与 `launch` 等其它 handler 的写法保持一致。
        const gameDir = instance.gameDir ?? launcher.gameDir(instance.id);
        createdGameDir = gameDir;
        throwIfAborted(signal);
        await mkdir(gameDir, { recursive: true });

        // 3a. overrides：直接盖到 gameDir。
        //     这一步**必须在 mod 之前做完的语义上无所谓**（文件名不同），
        //     但放在前面能让用户更早看到「配置已经铺好了」。
        for (const o of manifest.overrides) {
          throwIfAborted(signal);
          try {
            const dest = resolveInside(gameDir, o.targetPath);
            await mkdir(dirname(dest), { recursive: true });
            await nodeFs.writeFileSync(dest, o.content);
            installed++;
            throwIfAborted(signal);
          } catch (err) {
            // 取消不是这个 override 写失败，不能记进 failed。
            if (isAbortError(err) || signal.aborted) throw abortError();
            failed.push({ name: `overrides/${o.targetPath}`, error: (err as Error).message });
          }
        }

        // 3b. 清单里的文件（下载 + sha1 校验 + 落盘，见 modpack-install.ts）
        //
        // 每落盘成功一个就记进下载账本（`modpackLedgerRecorder`）：装完之后用户再从
        // 搜索页下同一个 mod，账本才能认出「这是同一个项目的旧文件」并替换掉 ——
        // 否则两个同 mod id 的 jar 并排躺着，NeoForge 直接 `Duplicate mod` 拒启动。
        // 重装/更新同一个整合包时，它还会把上一版留下的旧文件清掉。
        const filesResult = await installModpackFiles({
          gameDir,
          files: manifest.files,
          resolveRedirect: (cf) => resolveCurseForgeRedirect(cf, signal),
          // 每个文件按候选源取（官方 → 国内镜像），见 candidateFetch
          fetchImpl: candidateFetch,
          onProgress: (i, total, f) => emit('mods', i, total, instance.id, f.displayName),
          onFileInstalled: modpackLedgerRecorder(gameDir, req.modId),
          signal,
        });
        installed += filesResult.installed;
        failed.push(...filesResult.failed);
        if (filesResult.cancelled) {
          return {
            ok: false,
            cancelled: true,
            instanceId: instance.id,
            gameDir,
            installed,
            failed,
            error: '安装已取消（已下载的文件保留在实例里）',
          };
        }
        throwIfAborted(signal);

        // 3c. 换版本清理：这个包上一版装过、新版清单里已经移除的文件。
        // 只认账本里带同一个 packId 的条目 —— 用户自己下的 mod / 手动丢进
        // mods/ 的文件不会被碰。放在铺完之后做，且**这批文件全部成功才清**：
        // 中途失败时旧文件还在，实例仍可回退到上一版。
        if (filesResult.failed.length === 0) {
          const removed = prunePackFiles(
            gameDir,
            req.modId,
            manifest.files.map((f) => f.targetPath),
          );
          if (removed.length > 0) {
            emit(
              'mods',
              manifest.files.length,
              manifest.files.length,
              instance.id,
              `清理 ${removed.length} 个旧文件`,
            );
          }
        }
        // 清单里装不了的（被删的版本、不安全的路径）也要如实报出来
        for (const m of manifest.missing) {
          failed.push({ name: m.name, error: m.reason });
        }
        // 收尾把进度条推到底（最后一条的 onProgress 之后还有 missing 要处理）
        emit('mods', manifest.files.length, manifest.files.length, instance.id);

        return {
          ok: installed > 0,
          instanceId: instance.id,
          gameDir,
          installed,
          failed,
          error: installed > 0 ? null : '没有任何文件装成功',
        };
      } catch (err) {
        const cancelled = signal.aborted || isAbortError(err);
        return {
          ok: false,
          ...(cancelled ? { cancelled: true } : {}),
          instanceId: createdInstanceId,
          gameDir: createdGameDir,
          installed,
          failed,
          error: cancelled ? '安装已取消（已下载的文件保留在实例里）' : (err as Error).message,
        };
      } finally {
        // 装完 / 失败 / 取消都要释放：否则同名整合包会永远被判定为「正在安装」。
        modpackInstalls.delete(installKey);
      }
    },
  );

  /**
   * 取消整合包安装。
   *
   * 只发信号，不直接返回安装结果：真正的收尾（保留已下文件、刷新实例）
   * 由 `LAUNCHER_INSTALL_MODPACK` 的返回值完成，避免两个通道各说一套。
   */
  ipcMain.handle(
    LAUNCHER_CANCEL_MODPACK,
    (_e, raw: unknown): z.infer<typeof LauncherCancelModpackResponse> => {
      try {
        const req = LauncherCancelModpackRequest.parse(raw);
        const entry = modpackInstalls.get(modpackKey(_e.sender.id, req.modId, req.versionId));
        if (!entry) {
          return {
            ok: false,
            cancelled: false,
            error: '没有正在进行的安装（可能已经结束）',
          };
        }
        entry.controller.abort();
        return { ok: true, cancelled: true, error: null };
      } catch (err) {
        return { ok: false, cancelled: false, error: (err as Error).message };
      }
    },
  );
}
