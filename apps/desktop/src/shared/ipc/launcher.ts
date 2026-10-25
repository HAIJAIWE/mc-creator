import { z } from 'zod';
import type { SkinSource as CoreSkinSource } from '@mc-creator/core';

/** 游戏启动器（下载客户端 + 离线启动） */
export const LAUNCHER_LIST_VERSIONS = 'launcher:listVersions';
export const LAUNCHER_DOWNLOAD = 'launcher:download';
/**
 * 下载进度事件（主进程 → 渲染层）。
 *
 * 客户端 + assets + libraries 通常是几百 MB、几分钟起步；没有进度事件的话
 * 下载按钮会一直灰着，用户无从判断是卡住了还是在跑。
 * 载荷直接复用 `LauncherService` 的 `DownloadProgress` 形状：
 * stage ∈ versions/client/assets/libraries，外加 done 收尾标记。
 */
export const LAUNCHER_DOWNLOAD_PROGRESS = 'launcher:download:progress';

/**
 * 下载进度事件载荷（主进程 → 渲染层）。
 *
 * `finished: true` 是**收口标记**，让 UI 有确定的结束点而不是悬着等 promise ——
 * 失败路径也必须发（`ok: false`），否则失败时进度条永远停在中途。
 */
export const LauncherDownloadProgressSchema = z.object({
  /** 目标版本 id；解析出版本之前的事件为 null。 */
  version: z.string().nullable(),
  /** versions / client / assets / libraries / server；收口时为 'done'。 */
  stage: z.enum(['versions', 'client', 'assets', 'libraries', 'server', 'done']),
  done: z.number(),
  total: z.number(),
  finished: z.boolean(),
  /** 收口且失败时为 false。 */
  ok: z.boolean().optional(),
});
export type LauncherDownloadProgress = z.infer<typeof LauncherDownloadProgressSchema>;
export const LAUNCHER_LAUNCH = 'launcher:launch';
export const LAUNCHER_INSTALL_LOADER = 'launcher:installLoader';
export const LAUNCHER_INSTALL_SKIN = 'launcher:installSkin';

// ===== 实例目录（L8）=====
export const LAUNCHER_LIST_INSTANCE_FILES = 'launcher:listInstanceFiles';

export const LauncherListInstanceFilesRequest = z.object({
  /** 实例 id。浏览的是这个实例的 `game/` 目录。 */
  instance: z.string().min(1),
  /** 相对 `game/<实例>/` 的路径；'' 表示根。越界由主进程 resolveInside 拒绝。 */
  path: z.string().default(''),
});

export const InstanceFileInfo = z.object({
  name: z.string(),
  path: z.string(),
  isDirectory: z.boolean(),
  /** 软链：不跟随，故不 stat 目标（size/may be undefined） */
  isSymlink: z.boolean().optional(),
  size: z.number().optional(),
  modifiedAt: z.number().optional(),
});

// ===== 世界列表（L9）=====
export const LAUNCHER_LIST_WORLDS = 'launcher:listWorlds';

/**
 * 列出实例的世界（`<gameDir>/saves/`）。
 *
 * 字段是 `instance` 而不是 `version` —— 存档是**实例作用域**的。
 * 多实例之后两个实例可以各有自己的世界列表。
 */
export const LauncherListWorldsRequest = z.object({
  instance: z.string().min(1),
});

export const WorldInfo = z.object({
  /** `saves/` 下的目录名（玩家起的，可能无意义） */
  dirName: z.string(),
  /** `level.dat` 里的真实世界名；解析失败时回落到 dirName */
  levelName: z.string(),
  /** level.dat 的 LastPlayed（毫秒时间戳）；读不到时用目录 mtime 兜底 */
  lastPlayed: z.number().optional(),
  gameMode: z.string().optional(),
  mcVersion: z.string().optional(),
  /** 递归统计的世界占用字节数（region 区块文件才是大头） */
  sizeBytes: z.number().optional(),
  /** false 表示 level.dat 损坏/读不了 —— 存档仍在，只是元数据不可用 */
  readable: z.boolean(),
});

export const LauncherListWorldsResponse = z.object({
  worlds: z.array(WorldInfo),
  error: z.string().nullable().optional(),
});

export type WorldInfo = z.infer<typeof WorldInfo>;
export type LauncherListWorldsReq = z.infer<typeof LauncherListWorldsRequest>;
export type LauncherListWorldsRes = z.infer<typeof LauncherListWorldsResponse>;

export const LauncherListInstanceFilesResponse = z.object({
  files: z.array(InstanceFileInfo),
  error: z.string().nullable().optional(),
});

/**
 * 给实例装加载器。
 *
 * **两个字段都有必要**，因为这是少数「版本作用域 + 实例作用域」都要碰的操作：
 * - `version` —— 加载器档案装进 `versions/<versionId>/`（版本级共享）
 * - `instance` —— 要把**这个实例**的 `loader` 字段改掉；不同实例可以有不同加载器
 *
 * 少传 `instance` 会导致装完加载器、实例仍显示原版，启动时又跑成原版。
 */
export const LauncherInstallLoaderRequest = z.object({
  version: z.string(),
  loader: z.enum(['fabric', 'neoforge']),
  /** 实例 id；传了就同步更新它的 `loader` 字段。 */
  instance: z.string().optional(),
});
export const LauncherInstallLoaderResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});
export type LauncherInstallLoaderRequest = z.infer<typeof LauncherInstallLoaderRequest>;
export type LauncherInstallLoaderResponse = z.infer<typeof LauncherInstallLoaderResponse>;

export const LauncherInstallSkinRequest = z.object({
  /** 实例 id（mod 与配置都装进这个实例的 gameDir）。 */
  instance: z.string(),
  skinApiUrl: z.string().default('https://littleskin.cn/api/yggdrasil'),
});
export const LauncherInstallSkinResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});
export type LauncherInstallSkinRequest = z.infer<typeof LauncherInstallSkinRequest>;
export type LauncherInstallSkinResponse = z.infer<typeof LauncherInstallSkinResponse>;

// ===== §5.9 本地皮肤库 =====
export const LAUNCHER_SKIN_LIST = 'launcher:skinList';
export const LAUNCHER_SKIN_ADD_LOCAL = 'launcher:skinAddLocal';
export const LAUNCHER_SKIN_ADD_URL = 'launcher:skinAddUrl';
export const LAUNCHER_SKIN_ADD_MINESKIN = 'launcher:skinAddMineskin';
export const LAUNCHER_SKIN_ADD_OFFICIAL = 'launcher:skinAddOfficial';
export const LAUNCHER_SKIN_REMOVE = 'launcher:skinRemove';
export const LAUNCHER_SKIN_UPDATE = 'launcher:skinUpdate';
export const LAUNCHER_SKIN_MINESKIN_PAGE = 'launcher:skinMineskinPage';
export const LAUNCHER_SKIN_APPLY = 'launcher:skinApply';
export const LAUNCHER_SKIN_UNAPPLY = 'launcher:skinUnapply';
export const LAUNCHER_SKIN_LIST_APPLIED = 'launcher:skinListApplied';
export const LAUNCHER_SKIN_READ_PNG = 'launcher:skinReadPng';

/**
 * 皮肤来源的运行时 schema。
 *
 * 手写字面量而不是从 core 的 `SKIN_SOURCES` 导入：`shared/` 全目录不 import
 * core 的**值**（它是纯 IPC 契约层，preload 只依赖 zod）。代价是这份字面量
 * 可能与 core 漂移 —— 所以下面用 `_skinSourceDriftGuard` 在编译期钉住。
 *
 * 上一轮就是这么漂的：handler 标 `source: 'mineskin'`、UI 显示 `mojang`，
 * 编译不报错、单测不报错，只有用户看得见。
 */
export const SkinSource = z.enum(['file', 'url', 'mineskin']);

/**
 * 精确相等断言。相等则解析为 `true`；**不等则解析为一个 tuple**，
 * 于是下面的 `= true` 会编译失败。
 */
type AssertExact<A, B> = [A] extends [B]
  ? [B] extends [A]
    ? true
    : ['schema ⊂ core', B]
  : ['core ⊂ schema', A];

/**
 * 编译期漂移守卫：schema 的取值集合与 core 的 `SkinSource` 双向一致。
 *
 * 两个方向都要查 —— 只查一个的话，漏掉的恰恰是另一半漂移。
 *
 * 它没有运行时作用，价值全在**类型**：漂了就编译不过，而不是像上一轮那样
 * 编译照过、单测照过，只有用户在库里看到错的来源标签。
 *
 * `import type` 不产生运行时依赖，不破坏 shared 的边界。
 */
const _skinSourceDriftGuard: AssertExact<z.infer<typeof SkinSource>, CoreSkinSource> = true;
// `void` 是为了让 TS 的 noUnusedLocals 放过它 —— 该选项**不认 `_` 前缀**
// （eslint 才认）。守卫的意义在类型检查，不在运行时。
void _skinSourceDriftGuard;

/** 库条目（字段名与 `main/skin-library.ts` 的 `SkinEntry` 逐字段对应）。 */
export const SkinEntry = z.object({
  id: z.string(),
  name: z.string(),
  model: z.enum(['classic', 'slim']),
  source: SkinSource,
  width: z.number(),
  height: z.number(),
  sizeBytes: z.number(),
  createdAt: z.number(),
  origin: z.string().nullable().optional(),
});
export type SkinEntry = z.infer<typeof SkinEntry>;

export const LauncherSkinListResponse = z.object({
  entries: z.array(SkinEntry),
  error: z.string().nullable().optional(),
});

/**
 * 从本地文件导入。
 *
 * `path` 是主进程直接读的绝对路径 —— 不用 `dialog.showOpenDialog`：
 * 那要给渲染层开一个文件选择器，而库的导入按钮本来就该带着
 * 「选哪个文件」的上下文。路径由渲染层从 dialog 拿，或由拖拽给。
 */
export const LauncherSkinAddLocalRequest = z.object({
  path: z.string().min(1),
  name: z.string().optional(),
  model: z.enum(['classic', 'slim']).optional(),
});
export const LauncherSkinAddLocalResponse = z.object({
  entry: SkinEntry.nullable().optional(),
  error: z.string().nullable().optional(),
});

/** 从 URL 导入（Mojang texture 直链、任意皮肤站直链）。 */
export const LauncherSkinAddUrlRequest = z.object({
  url: z.string().url(),
  name: z.string().optional(),
  model: z.enum(['classic', 'slim']).optional(),
  /**
   * 已经在渲染层转好的 PNG（base64，**不带** data URL 前缀）。
   *
   * 什么时候需要它：源站给的常常不是 PNG。实测 MC百科（mcmod.cn）图床
   * `access-control-allow-origin: *`、可以直接 fetch，但**站上全是 WebP**，
   * 而皮肤库校验看 PNG magic —— 不先转一遍，每一条 MC百科 链接都会报
   * 「不是有效的皮肤 PNG」，而用户手里的链接明明是好的。
   *
   * 主进程侧用 Chromium 转不了（Electron 44 的 `nativeImage` 实测
   * 解不了 WebP，Windows 走 WIC），所以放渲染层转完再传字节过来。
   *
   * 给了它就不再联网 fetch（`url` 仍要传，用于记 `origin`）。
   */
  pngBase64: z.string().optional(),
});
export const LauncherSkinAddUrlResponse = z.object({
  entry: SkinEntry.nullable().optional(),
  error: z.string().nullable().optional(),
});

/** 从 MineSkin 公共库导入（id 取自 `skinMineskinPage`）。 */
/**
 * 按 UUID 导入正版皮肤。
 *
 * 为什么是 UUID 而不是玩家名：Mojang 的 `api.mojang.com/names/{name}`
 * 已被废弃（实测 ECONNRESET），离线条 UUID 又查不到线上账号 ——
 * 「名字→UUID」这一环断了，所以只能收 UUID。
 */
export const LauncherSkinAddOfficialRequest = z.object({
  /** 32 位或 36 位（带横线）的十六进制 UUID。 */
  uuid: z.string().min(1),
  model: z.enum(['classic', 'slim']).optional(),
});
export const LauncherSkinAddOfficialResponse = z.object({
  entry: SkinEntry.nullable().optional(),
  /** Mojang 返回的玩家名 —— 用来确认「这 UUID 是不是你要的那个人」。 */
  playerName: z.string().nullable().optional(),
  /**
   * 有没有正版披风。
   *
   * ⚠️ 目前**只导皮肤**：皮肤库是按玩家名索引的皮肤存放处，没有披风的位置。
   * 报上来是为了让 UI 能说「这个账号有披风，但本启动器现在不装」，
   * 而不是让用户以为看到了全部。
   */
  hasCape: z.boolean().optional(),
  error: z.string().nullable().optional(),
});

export const LauncherSkinAddMineskinRequest = z.object({
  /** MineSkin 的数字 id。 */
  mineskinId: z.number(),
  name: z.string().optional(),
  model: z.enum(['classic', 'slim']).optional(),
});
export const LauncherSkinAddMineskinResponse = z.object({
  entry: SkinEntry.nullable().optional(),
  error: z.string().nullable().optional(),
});

export const LauncherSkinRemoveRequest = z.object({
  id: z.string().min(1),
});
export const LauncherSkinRemoveResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const LauncherSkinUpdateRequest = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  model: z.enum(['classic', 'slim']).optional(),
});
export const LauncherSkinUpdateResponse = z.object({
  entry: SkinEntry.nullable().optional(),
  error: z.string().nullable().optional(),
});

/** 翻一页公共皮肤库。 */
export const LauncherSkinMineskinPageRequest = z.object({
  page: z.number().optional(),
});

/** 公共库一页。字段照 MineSkin 实测响应（没有名字/作者）。 */
export const MineSkinEntry = z.object({
  id: z.number(),
  uuid: z.string(),
  textureUrl: z.string(),
  time: z.number().nullable().optional(),
});
export const LauncherSkinMineskinPageResponse = z.object({
  entries: z.array(MineSkinEntry),
  page: z.number(),
  hasMore: z.boolean(),
  error: z.string().nullable().optional(),
});

/**
 * 应用皮肤到实例。
 *
 * ⚠️ `playerName` 会**直接变成文件名**（`LocalSkin/skins/<playerName>.png`），
 * 所以主进程必须校验 —— 这里是唯一挡得住 `../xxx` 的地方。
 */
export const LauncherSkinApplyRequest = z.object({
  skinId: z.string().min(1),
  /** 实例 id（皮肤落到它的 gameDir）。 */
  instance: z.string().min(1),
  playerName: z.string().min(1),
});
export const LauncherSkinApplyResponse = z.object({
  ok: z.boolean(),
  /** 落盘后的绝对路径（UI 展示「装到哪了」）。 */
  path: z.string().nullable().optional(),
  /**
   * 顺带的说明：离线皮肤资源包写成了、还是这条路走不通（及原因）。
   *
   * 「应用皮肤」有两条路（CSL 的 LocalSkin + 覆盖默认皮肤贴图的资源包），
   * 其中一条没走通**不等于失败** —— 所以用 note 说明，不用 error。
   */
  note: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** 取消应用。幂等 —— 没有就是没有。 */
export const LauncherSkinUnapplyRequest = z.object({
  instance: z.string().min(1),
  playerName: z.string().min(1),
});
export const LauncherSkinUnapplyResponse = z.object({
  ok: z.boolean(),
  /** 离线皮肤资源包是否跟着一起删了（清空最后一个已应用皮肤时才会删）。 */
  note: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** 列出实例上已应用的皮肤（读磁盘，不是读库索引）。 */
export const LauncherSkinListAppliedRequest = z.object({
  instance: z.string().min(1),
});
export const AppliedSkin = z.object({
  playerName: z.string(),
  path: z.string(),
  sizeBytes: z.number(),
});
export const LauncherSkinListAppliedResponse = z.object({
  applied: z.array(AppliedSkin),
  error: z.string().nullable().optional(),
});

/**
 * 读库里一张 PNG 的 data URL（供 2D/3D 预览）。
 *
 * 用 data URL 而不是 `file://`：Electron 渲染进程的 CSP 不放行 `file:`，
 * 而 skinview3d 的 `loadSkin` 接受任意 URL 字符串 —— data URL 不需要额外通道。
 */
export const LauncherSkinReadPngRequest = z.object({
  id: z.string().min(1),
});
export const LauncherSkinReadPngResponse = z.object({
  dataUrl: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

/**
 * 选择本地文件。
 *
 * 通用通道，不限定用途 —— 弹 Electron 的 `dialog.showOpenDialog`。
 * 放在 launcher 命名空间下是因为目前只有启动器的「导入」用它，
 * 且它属于 launcher 的资源管理域。
 */
export const LAUNCHER_PICK_FILES = 'launcher:pickFiles';

export const LauncherPickFilesRequest = z.object({
  title: z.string().min(1),
  filters: z.array(z.object({ name: z.string(), extensions: z.array(z.string()) })).optional(),
  properties: z.array(z.enum(['openFile', 'multiSelections'])).optional(),
});
export const LauncherPickFilesResponse = z.object({
  paths: z.array(z.string()),
  error: z.string().nullable().optional(),
});

// 类型导出（schema 的 z.infer，与文件里其他通道同一惯例）
export type SkinEntryT = z.infer<typeof SkinEntry>;
export type LauncherSkinListRes = z.infer<typeof LauncherSkinListResponse>;
export type LauncherSkinAddLocalReq = z.infer<typeof LauncherSkinAddLocalRequest>;
export type LauncherSkinAddLocalRes = z.infer<typeof LauncherSkinAddLocalResponse>;
export type LauncherSkinAddUrlReq = z.infer<typeof LauncherSkinAddUrlRequest>;
export type LauncherSkinAddUrlRes = z.infer<typeof LauncherSkinAddUrlResponse>;
export type LauncherSkinAddMineskinReq = z.infer<typeof LauncherSkinAddMineskinRequest>;
export type LauncherSkinAddOfficialReq = z.infer<typeof LauncherSkinAddOfficialRequest>;
export type LauncherSkinAddOfficialRes = z.infer<typeof LauncherSkinAddOfficialResponse>;
export type LauncherSkinAddMineskinRes = z.infer<typeof LauncherSkinAddMineskinResponse>;
export type LauncherSkinRemoveReq = z.infer<typeof LauncherSkinRemoveRequest>;
export type LauncherSkinRemoveRes = z.infer<typeof LauncherSkinRemoveResponse>;
export type LauncherSkinUpdateReq = z.infer<typeof LauncherSkinUpdateRequest>;
export type LauncherSkinUpdateRes = z.infer<typeof LauncherSkinUpdateResponse>;
export type LauncherSkinMineskinPageReq = z.infer<typeof LauncherSkinMineskinPageRequest>;
export type LauncherSkinMineskinPageRes = z.infer<typeof LauncherSkinMineskinPageResponse>;
export type LauncherSkinApplyReq = z.infer<typeof LauncherSkinApplyRequest>;
export type LauncherSkinApplyRes = z.infer<typeof LauncherSkinApplyResponse>;
export type LauncherSkinUnapplyReq = z.infer<typeof LauncherSkinUnapplyRequest>;
export type LauncherSkinUnapplyRes = z.infer<typeof LauncherSkinUnapplyResponse>;
export type LauncherSkinListAppliedReq = z.infer<typeof LauncherSkinListAppliedRequest>;
export type LauncherSkinListAppliedRes = z.infer<typeof LauncherSkinListAppliedResponse>;
export type MineSkinEntryT = z.infer<typeof MineSkinEntry>;
export type LauncherSkinReadPngReq = z.infer<typeof LauncherSkinReadPngRequest>;
export type LauncherSkinReadPngRes = z.infer<typeof LauncherSkinReadPngResponse>;
export type LauncherPickFilesReq = z.infer<typeof LauncherPickFilesRequest>;
export type LauncherPickFilesRes = z.infer<typeof LauncherPickFilesResponse>;

// ===== §5.8 微软账户（正版第一路径）=====

export const ACCOUNT_MS_LOGIN = 'mcAccount:login';
export const ACCOUNT_MS_LIST = 'mcAccount:list';
export const ACCOUNT_MS_SWITCH = 'mcAccount:switch';
export const ACCOUNT_MS_REMOVE = 'mcAccount:remove';
export const ACCOUNT_MS_CAPE = 'mcAccount:cape';
/** 第三方认证站闸门（§1.2 / §19）：查询状态 + 显式启用。 */
export const THIRD_PARTY_AUTH_STATUS = 'mcAccount:thirdPartyAuthStatus';
export const THIRD_PARTY_AUTH_ENABLE = 'mcAccount:thirdPartyAuthEnable';

/** 账户摘要。**结构上就没有 token 字段** —— §13.2 的第一道防线。 */
export const McAccountSummary = z.object({
  /** 无连字符的 profile UUID。 */
  id: z.string(),
  /** Minecraft 玩家名（不是 XBox 昵称）。 */
  username: z.string(),
  /** 带连字符的 UUID（启动参数 --uuid 用）。 */
  uuid: z.string(),
  /** false = 该微软账户没有 Java 版档案（刚买 / 只有 Game Pass）。 */
  hasMinecraftProfile: z.boolean(),
  /** 正版披风图片直链（profile.capes 里 ACTIVE 的那件）；无则 null。 */
  activeCapeUrl: z.string().nullable(),
  lastUsedAt: z.number(),
  /** token 是否仍在有效期内（false = 启动前需要刷新）。 */
  tokenFresh: z.boolean(),
});
export type McAccountSummaryRes = z.infer<typeof McAccountSummary>;

/** 单个披风。 */
export const McCapeInfo = z.object({
  capeId: z.string(),
  imageUrl: z.string(),
  active: z.boolean(),
  alias: z.string().nullable(),
});
export type McCapeInfoRes = z.infer<typeof McCapeInfo>;

export const McLoginResponse = z.object({
  ok: z.boolean(),
  account: McAccountSummary.nullable(),
  /** 无 Java 版档案时的可执行提示；正常为 null。 */
  warning: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

export const McAccountListResponse = z.object({
  accounts: z.array(McAccountSummary),
  activeId: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const McSwitchAccountRequest = z.object({ id: z.string().min(1) });
export const McSwitchAccountResponse = z.object({
  ok: z.boolean(),
  account: McAccountSummary.nullable(),
  error: z.string().nullable().optional(),
});

export const McRemoveAccountRequest = z.object({ id: z.string().min(1) });
export const McRemoveAccountResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

/** 无参请求（当前账户的披风）。 */
export const McCapeResponse = z.object({
  cape: McCapeInfo.nullable(),
  error: z.string().nullable().optional(),
});

/**
 * 第三方认证站状态（§1.2 / §19）。
 *
 * `enabled` 只表示「配置层面打开了」；**即使为 true 也仍需每次显式确认**
 * 才能真正授权（见 `ThirdPartyAuthGate.authorize`）。把这两件事分开表达，
 * 免得 UI 把 `enabled === true` 画成「已授权」。
 */
export const ThirdPartyAuthStatusResponse = z.object({
  /** 配置层面的开关（默认 false）。 */
  enabled: z.boolean(),
  /** 当前提示文案版本；与当前版本不一致 = 需要重新确认。 */
  noticeVersion: z.string(),
  /** 是否已确认过当前版本的提示。 */
  acknowledged: z.boolean(),
  error: z.string().nullable().optional(),
});

export const ThirdPartyAuthEnableRequest = z.object({
  version: z.string().min(1),
  skinApiUrl: z.string().url(),
  /**
   * UI 侧「我已阅读 §1.2 风险提示」的勾选。**只是把原文交给用户看的入口**，
   * 不构成授权：真正的授权由主进程弹出的原生确认框决定。
   */
  acknowledgedRisk: z.literal(true),
});
export const ThirdPartyAuthEnableResponse = z.object({
  ok: z.boolean(),
  /** 被拒原因（disabled_by_default / confirm_declined / ...），成功时 null。 */
  deniedReason: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const LauncherListVersionsResponse = z.object({
  versions: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      releaseTime: z.string(),
    }),
  ),
  error: z.string().nullable().optional(),
});

/**
 * 下载客户端（jar + assets + libraries），并建/更新一个实例。
 *
 * **版本产物与实例是两件事**（多实例之后）：
 * - `version` 决定下哪个版本的 jar/库/资源 —— 这些按**版本共享**
 * - `instanceName` / `instanceId` 决定这个实例叫什么、游戏数据放哪
 */
export const LauncherDownloadRequest = z.object({
  /** MC 版本号（产物按它共享）。 */
  version: z.string(),
  /**
   * 实例名（= `game/<名字>/`）。缺省用 `version`。
   *
   * 必须是合法目录名 —— 渲染层应该在弹框里先校验
   * （`checkInstanceName`），主进程也会再验一次，不信任前端。
   */
  instanceName: z.string().optional(),
  /**
   * 已有实例的 id。传了就更新那一条，而不是新建 ——
   * 「重新下载这个实例的客户端」走这条路。
   */
  instanceId: z.string().optional(),
});
export type LauncherDownloadRequest = z.infer<typeof LauncherDownloadRequest>;
export const LauncherDownloadResponse = z.object({
  ok: z.boolean(),
  /** 建出来/更新后的实例 id。渲染层要刷新实例列表。 */
  instanceId: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});
export type LauncherDownloadResponse = z.infer<typeof LauncherDownloadResponse>;

// ===== 服务端下载（对标 PCL 的「下载服务端」按钮）=====
export const LAUNCHER_DOWNLOAD_SERVER = 'launcher:downloadServer';

export const LauncherDownloadServerRequest = z.object({ version: z.string() });
export const LauncherDownloadServerResponse = z.object({
  ok: z.boolean(),
  /** 落盘绝对路径；失败时为 null。 */
  path: z.string().nullable().optional(),
  /**
   * 实测出来的 jar 形态：`bundler` = 1.18 起的引导器（首次运行才下载本体），
   * `standalone` = 独立包，`unknown` = 头部认不出来（不猜）。
   */
  kind: z.enum(['bundler', 'standalone', 'unknown']).nullable().optional(),
  error: z.string().nullable().optional(),
});

// ===== 由下载好的 server.jar 建一个能启动的服务端实例 =====
//
// 通道名刻意是 `launcher:` 前缀且不含执行语义动词 —— §10.6 规定
// 「除 PROCESS_LAUNCH 外不得有执行语义动词」，这里只创建目录与文件，
// 不 spawn 任何东西。
export const LAUNCHER_CREATE_SERVER_INSTANCE = 'launcher:createServerInstance';

export const LauncherCreateServerInstanceRequest = z.object({
  /** 实例 id；单段名，越界由主进程 isValidServerId 拒绝。 */
  serverId: z.string().min(1),
  /** 版本 id；主进程据此定位已下载的 `versions/<id>/<id>-server.jar`。 */
  version: z.string().min(1),
  port: z.number().int().min(1).max(65565).optional(),
  /** 用户输入；主进程会做 properties 转义。 */
  motd: z.string().max(256).optional(),
  maxPlayers: z.number().int().min(0).max(4096).optional(),
  onlineMode: z.boolean().optional(),
  levelName: z.string().max(64).optional(),
  /**
   * 用户是否已接受 Minecraft EULA。
   *
   * **只有 true 才写 `eula=true`。** 应用不代用户勾选 —— 与 kernel-server
   * 的 `EULA_NOT_ACCEPTED` 同一纪律。
   */
  acceptEula: z.boolean().default(false),
});

export const LauncherCreateServerInstanceResponse = z.object({
  ok: z.boolean(),
  /** 实例目录绝对路径。 */
  serverDir: z.string().nullable().optional(),
  /** jar 是硬链接（true）还是复制（false）。 */
  jarLinked: z.boolean().nullable().optional(),
  /** 是否写了 eula=true。 */
  eulaAccepted: z.boolean().nullable().optional(),
  error: z.string().nullable().optional(),
});

/**
 * 启动游戏。
 *
 * ⚠️ 字段名是 `instance` 而不是 `version` —— 多实例之后这两件事不再相等：
 * 实例名决定 mods / config / 存档，MC 版本号决定跑哪个 jar。
 * 沿用 `version` 这个名字会让「用实例名去查版本档案」这种错误
 * 在类型上完全看不出来（都是 string），而它报的是「客户端未下载」，
 * 与真正原因（找错目录）毫无关系。
 */
export const LauncherLaunchRequest = z.object({
  /** 实例 id（= `game/<instance>/` 的目录名）。 */
  instance: z.string(),
  username: z.string().default('Steve'),
  memory: z.string().default('2G'),
  /**
   * 覆盖游戏目录。**少用** —— 主进程以注册表里的实例配置为准
   * （用户可能在实例设置里改到别的盘），这个字段只在没有实例时才有意义。
   *
   * 刻意用 `.optional()` 而不是 `.default('')`：默认空串会让 zod 的 **input**
   * 类型把它变成必填，于是每个调用方都得显式写一个 `gameDir: ''` 掩饰它
   * 「其实不需要」这个事实。可选更诚实。
   */
  gameDir: z.string().optional(),
});
export const LauncherLaunchResponse = z.object({
  pid: z.number(),
  error: z.string().nullable().optional(),
});
export type LauncherLaunchRequest = z.infer<typeof LauncherLaunchRequest>;
export type LauncherLaunchResponse = z.infer<typeof LauncherLaunchResponse>;

// === Minecraft 启动器（A 切片原为「离线账号，无需微软 OAuth」；===
// === 2026-10 起 §1.2 决策「正版为第一路径」，微软 OAuth 见上方 ACCOUNT_MS_* ===)
export const LOCATE_MC = 'mc:locate';
export const MC_CHOOSE_DIR = 'mc:chooseDir';
export const INSTALL_MOD = 'mc:installMod';
export const LAUNCH_MC = 'mc:launch';

export const LocateMcResponse = z.object({
  found: z.boolean(),
  mcDir: z.string().nullable(),
  modsDir: z.string().nullable(),
  launcherExe: z.string().nullable(),
  launcher: z.enum(['official', 'pcl2', 'hmcl']).nullable(),
  error: z.string().nullable().optional(),
});
export type LocateMcRes = z.infer<typeof LocateMcResponse>;

export const McChooseDirResponse = z.object({ path: z.string().nullable() });
export type McChooseDirRes = z.infer<typeof McChooseDirResponse>;

export const InstallModRequest = z.object({
  jarPath: z.string().min(1),
  mcDir: z.string().optional(),
});
export const InstallModResponse = z.object({
  ok: z.boolean(),
  modsDir: z.string().nullable(),
  error: z.string().nullable().optional(),
});
export type InstallModReq = z.infer<typeof InstallModRequest>;
export type InstallModRes = z.infer<typeof InstallModResponse>;

export const LaunchMcRequest = z.object({ mcDir: z.string().optional() });
export const LaunchMcResponse = z.object({
  ok: z.boolean(),
  method: z.string().nullable(),
  launcher: z.enum(['official', 'pcl2', 'hmcl']).nullable(),
  error: z.string().nullable().optional(),
});
export type LaunchMcReq = z.infer<typeof LaunchMcRequest>;
export type LaunchMcRes = z.infer<typeof LaunchMcResponse>;

// ===== 模组管理（L6）=====
export const LAUNCHER_LIST_MODS = 'launcher:listMods';
export const LAUNCHER_INSTALL_MOD = 'launcher:installMod';
export const LAUNCHER_REMOVE_MOD = 'launcher:removeMod';
export const LAUNCHER_TOGGLE_MOD = 'launcher:toggleMod';

export const ModInfo = z.object({
  name: z.string(),
  enabled: z.boolean(),
  size: z.number().optional(),
  modifiedAt: z.number().optional(),
  // 可选：来自 Modrinth/CurseForge 的元数据
  version: z.string().optional(),
  description: z.string().optional(),
  authors: z.array(z.string()).optional(),
});

/**
 * ⚠️ 以下 mod 相关请求的字段名从 `version` 改成了 `instance`。
 *
 * 它们操作的全是**实例作用域**的数据（`<gameDir>/mods/`），而
 * `version` 是**版本作用域**（`versions/<v>/`）。多实例之后两者不再相等，
 * 沿用 `version` 会让「用实例名去查版本档案」在类型上完全看不出来 ——
 * 而它报的是「客户端未下载」，与真正原因对不上。
 */
export const LauncherListModsRequest = z.object({
  /** 实例 id（= `game/<instance>/mods/`）。 */
  instance: z.string(),
});

export const LauncherListModsResponse = z.object({
  mods: z.array(ModInfo),
  error: z.string().nullable().optional(),
});

export const LauncherInstallModRequest = z.object({
  instance: z.string(),
  name: z.string(),
  url: z.string(),
  /**
   * 清单给的 sha1 / 体积。**能给就给** —— 下载会按候选源取（官方 / 国内镜像），
   * 镜像在中间；没有校验就只能信"HTTP 200 等于文件是对的"。
   */
  sha1: z.string().optional(),
  size: z.number().optional(),
});

export const LauncherInstallModResponse = z.object({
  ok: z.boolean(),
  path: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const LauncherRemoveModRequest = z.object({
  instance: z.string(),
  name: z.string(),
});

export const LauncherRemoveModResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const LauncherToggleModRequest = z.object({
  instance: z.string(),
  name: z.string(),
  enabled: z.boolean(),
});

export const LauncherToggleModResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

// ===== 日志流（L7）=====
export const LAUNCHER_LOG_STREAM = 'launcher:logStream';
export const LAUNCHER_LOG_STREAM_CHUNK = 'launcher:logStream:chunk';

/**
 * 游戏进程退出事件（主进程 → 渲染层）。
 *
 * 「开始游戏」的 IPC 只返回 pid，之后进程何时结束渲染层无从得知；
 * 没有这个事件的话按钮会永远停在「运行中 <pid>」，用户关掉游戏后
 * 必须重开应用才能再启动。`instance` 用于确认退出的是当前那一个实例。
 */
export const LAUNCHER_GAME_EXIT = 'launcher:gameExit';

export const LauncherGameExitEvent = z.object({
  /** 实例 id（不是 versionId）。 */
  instance: z.string(),
  code: z.number().nullable(),
  signal: z.string().nullable(),
});
export type LauncherGameExit = z.infer<typeof LauncherGameExitEvent>;

export const LogSource = z.enum(['live', 'latest', 'crash']);
export type LogSource = z.infer<typeof LogSource>;

/**
 * 实时日志流（启动游戏并把 stdout 逐行转回来）。
 *
 * `instance` 是实例 id —— 主进程据此拿到 versionId（跑哪个 jar）与 gameDir
 * （mods/存档在哪），渲染层不需要知道这两个的区别。
 */
export const LauncherLogStreamRequest = z.object({
  instance: z.string(),
  requestId: z.string(),
});

export const LauncherLogStreamChunk = z.object({
  requestId: z.string(),
  source: LogSource,
  line: z.string(),
  done: z.boolean(),
});

export const LauncherReadLatestLogRequest = z.object({
  /** 实例 id（日志写在 `<gameDir>/logs/latest.log`）。 */
  instance: z.string(),
});

export const LauncherReadLatestLogResponse = z.object({
  lines: z.array(z.string()),
  error: z.string().nullable().optional(),
});

export const LAUNCHER_READ_LATEST_LOG = 'launcher:readLatestLog';
export const LAUNCHER_LIST_CRASH_REPORTS = 'launcher:listCrashReports';
export const LAUNCHER_READ_CRASH_REPORT = 'launcher:readCrashReport';

export const LauncherListCrashReportsRequest = z.object({
  instance: z.string(),
});

export const LauncherListCrashReportsResponse = z.object({
  files: z.array(z.string()),
  error: z.string().nullable().optional(),
});

export const LauncherReadCrashReportRequest = z.object({
  instance: z.string(),
  filename: z.string(),
});

export const LauncherReadCrashReportResponse = z.object({
  content: z.string(),
  error: z.string().nullable().optional(),
});

// Mod Management (L6) types
export type ModInfo = z.infer<typeof ModInfo>;
export type LauncherListModsReq = z.infer<typeof LauncherListModsRequest>;
export type LauncherListModsRes = z.infer<typeof LauncherListModsResponse>;
export type LauncherInstallModReq = z.infer<typeof LauncherInstallModRequest>;
export type LauncherInstallModRes = z.infer<typeof LauncherInstallModResponse>;
export type LauncherRemoveModReq = z.infer<typeof LauncherRemoveModRequest>;
export type LauncherRemoveModRes = z.infer<typeof LauncherRemoveModResponse>;
export type LauncherToggleModReq = z.infer<typeof LauncherToggleModRequest>;
export type LauncherToggleModRes = z.infer<typeof LauncherToggleModResponse>;

// ===== 在线模组搜索/下载（Modrinth / CurseForge 聚合）=====
/** 内容类型：决定搜索哪个分类。与 DownloadTab 的 CATEGORIES 对齐。 */
export const ContentType = z.enum(['mod', 'modpack', 'datapack', 'resourcepack', 'shader']);

/**
 * 「这类内容该放哪个目录」的判据。
 *
 * 与 `ContentType` 的区别：`ContentType` 是**源站分类**（搜索/详情用），
 * 这里说的是**落盘位置**。两者现在一一对应，但概念不同 ——
 * `modpack` 不是靠目录区分的（它是整套铺进 gameDir），所以它是留着的
 * 「兜底 mod 目录」而不是「整合包目录」。
 *
 * ⚠️ **皮肤刻意不在这里**（下载页有「皮肤」分类，但它不走这个枚举）：
 * 其余五类的模型都是「往实例的某个目录里丢文件」，而皮肤是**按玩家名索引**
 * 的 —— 同一张皮肤要给 Steve 和 Alex 就是两个文件，落在
 * `game/<实例>/CustomSkinLoader/LocalSkin/skins/<玩家名>.png`，
 * 没有「这个分类该放哪」这种单一目录可言。
 *
 * 所以皮肤走的是皮肤库那套通道（`LAUNCHER_SKIN_*`），不是
 * `LAUNCHER_DOWNLOAD_*`。硬把它塞进来的话，`contentDir()` 的 `default`
 * 分支会把它安静地落到 `mods/` —— 一张 PNG 躺在 mods/ 里既不生效也没人读，
 * 正是「看起来装好了、其实没装」的那类坑。
 *
 * 落盘约定见 `launcher-service.ts` 的 `contentDir()` 注释（那里有依据）。
 */
export const ContentKind = z.enum(['mod', 'modpack', 'datapack', 'resourcepack', 'shader']);
export type ContentKind = z.infer<typeof ContentKind>;
export type ContentType = z.infer<typeof ContentType>;

/** 模组加载器。 */
export const ModLoader = z.enum(['fabric', 'forge', 'neoforge', 'quilt', 'liteloader', 'rift']);
export type ModLoader = z.infer<typeof ModLoader>;

/** 统一的模组条目（聚合 Modrinth + CurseForge 后的统一模型）。 */
export const ModEntry = z.object({
  /** 唯一标识：Modrinth 用 project_id，CurseForge 用 id。前缀区分来源：mr_ / cf_。 */
  id: z.string(),
  /** 显示名称。 */
  name: z.string(),
  /** 简短描述。 */
  summary: z.string().optional(),
  /** 作者列表。 */
  authors: z.array(z.string()).optional(),
  /** 图标 URL。 */
  iconUrl: z.string().optional(),
  /** 来源：'modrinth' | 'curseforge'。 */
  source: z.enum(['modrinth', 'curseforge']),
  /** 内容类型。 */
  contentType: ContentType,
  /** 支持的游戏版本列表。 */
  gameVersions: z.array(z.string()),
  /** 支持的加载器列表。 */
  loaders: z.array(ModLoader),
  /** 最新版本号。 */
  latestVersion: z.string().optional(),
  /** 最新版本的下载 URL（由详情接口填充）。 */
  downloadUrl: z.string().optional(),
  /** 最新版本的文件大小（字节）。 */
  fileSize: z.number().optional(),
  /** 最新版本的 SHA1。 */
  sha1: z.string().optional(),
  /** 更新时间（毫秒时间戳）。 */
  updatedAt: z.number().optional(),
  /** 下载量（Modrinth downloads / CurseForge downloadCount）。 */
  downloads: z.number().optional(),
  /** 分类标签（Modrinth categories / CurseForge categories），原样保留英文键，UI 负责译中文。 */
  categories: z.array(z.string()).optional(),
  /** Modrinth 的 project_id 或 CurseForge 的 slug。用于构建详情页链接。 */
  slug: z.string().optional(),
});
export type ModEntry = z.infer<typeof ModEntry>;

/** 搜索请求。 */
export const LauncherSearchModsRequest = z.object({
  /** 搜索关键词。 */
  query: z.string().default(''),
  /** 内容类型。 */
  contentType: ContentType,
  /** 游戏版本筛选（如 '1.20.1'）。 */
  gameVersion: z.string().optional(),
  /** 加载器筛选。 */
  loader: ModLoader.optional(),
  /** 分类筛选（Modrinth 的 categories）。 */
  category: z.string().optional(),
  /** 页码（从 0 开始）。 */
  page: z.number().int().min(0).default(0),
  /** 每页数量。 */
  limit: z.number().int().min(1).max(100).default(20),
  /** 排序：'relevance' | 'downloads' | 'updated' | 'newest'。 */
  sort: z.enum(['relevance', 'downloads', 'updated', 'newest']).default('relevance'),
  /** 来源筛选：'all' | 'modrinth' | 'curseforge'。 */
  source: z.enum(['all', 'modrinth', 'curseforge']).default('all'),
});
export type LauncherSearchModsRequest = z.infer<typeof LauncherSearchModsRequest>;

/** 搜索响应。 */
export const LauncherSearchModsResponse = z.object({
  /** 模组列表。 */
  mods: z.array(ModEntry),
  /** 总数（用于分页）。 */
  total: z.number().int().min(0),
  /** 当前页。 */
  page: z.number().int().min(0),
  /** 是否有下一页。 */
  hasMore: z.boolean(),
  /**
   * 用户**自己配了** CurseForge API Key 吗。
   *
   * ⚠️ 这个名字容易被读成「CurseForge 能不能用」—— 不是。没配 key 也**能**搜
   * CurseForge（走国内镜像时镜像自带 key，PCL 同款）。这个字段只用来在用户
   * 主动选 CurseForge 时解释一句「你现在走的是镜像的 key，填自己的可走官方源」
   * （default=true，兼容旧主进程）。
   */
  curseForgeConfigured: z.boolean().default(true),
  error: z.string().nullable().optional(),
});
export type LauncherSearchModsResponse = z.infer<typeof LauncherSearchModsResponse>;

/**
 * 下载模组请求（使用搜索结果中的 ModEntry.id）。
 *
 * **mod 和整合包不是一回事**，落盘方式也不同：
 * - mod：一个 jar 丢进实例的 `mods/`，登记到该实例
 * - 整合包：见 `LauncherInstallModpackRequest`，要建实例 + 铺一堆文件 + 装加载器
 *
 * 所以这里的 `targetInstance` 是**必填**的 —— 没有目标实例就没地方放，
 * 不能像之前那样兜底塞进一个全局共享目录（那个目录没有任何代码会读它，
 * 等于下载白下载）。
 */
export const LauncherDownloadModRequest = z.object({
  /** ModEntry.id（带前缀 mr_ / cf_）。 */
  modId: z.string(),
  /** 目标版本（可选，不传则用最新版本）。 */
  version: z.string().optional(),
  /**
   * 目标实例的 versionId。
   *
   * 必填：下载必须落到某个具体实例，否则多实例会互相串。
   */
  targetInstance: z.string().min(1),
  /** 内容类型，决定落盘目录。缺省 `'mod'`；资源包/光影/数据包必须显式传。 */
  contentKind: ContentKind.default('mod'),
  /** 数据包的目标世界（`saves/` 下目录名）；只有 `datapack` 需要。 */
  world: z.string().optional(),
});
export type LauncherDownloadModRequest = z.infer<typeof LauncherDownloadModRequest>;

/** 下载模组响应。 */
export const LauncherDownloadModResponse = z.object({
  ok: z.boolean(),
  /** 落盘绝对路径。 */
  path: z.string().nullable().optional(),
  /** 模组元数据（用于 UI 显示）。 */
  mod: ModEntry.nullable().optional(),
  /**
   * 没能一起下下来的前置依赖（文件名或 project id）。
   *
   * 主文件已经下好，这里只是提醒用户还有东西要补 —— 没有它的话用户会
   * 以为装好了，启动时才发现缺 Fabric API。
   */
  missingDependencies: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
});
export type LauncherDownloadModResponse = z.infer<typeof LauncherDownloadModResponse>;

/**
 * 按 URL 直接下载一个文件（详情页点某个具体版本时用）。
 *
 * 与 `LauncherDownloadModRequest` 的分工：后者传 modId，由主进程解析
 * 出"最新版本"再下；这里 URL 已经在渲染层手上（详情页每一行都带），
 * 用户点的就是那一个文件，不能再绕道 modId —— 否则会下错版本。
 */
export const LauncherDownloadUrlRequest = z.object({
  url: z.string().url(),
  /** 落盘文件名。不传则从 URL 末段推断。 */
  filename: z.string().optional(),
  /**
   * 目标实例的 versionId。与 `LauncherDownloadModRequest` 同理：**必填**。
   */
  targetInstance: z.string().min(1),
  /**
   * 内容类型，决定落盘到 gameDir 下的哪个目录。
   *
   * 缺省 `'mod'` —— 但**别依赖这个缺省**：`mods/` 是加载器扫描目录，
   * 资源包/光影包/数据包放进去会被当 mod 加载而崩。
   * 传错的后果比报错更糟，所以渲染层必须按当前分类显式传。
   */
  contentKind: ContentKind.default('mod'),
  /**
   * 数据包的目标世界（`saves/` 下的目录名）。
   *
   * ⚠️ 只有 `contentKind === 'datapack'` 才需要，且**那时它必填** ——
   * 原版只有世界级数据包目录，没有实例级的（`<gameDir>/datapacks/` 是
   * *Global Datapacks* 这个 mod 加的，不是原版功能）。
   */
  world: z.string().optional(),
  /**
   * 这个文件属于哪个项目（`mr_` / `cf_` 前缀，见 `ModEntry.id`）。
   *
   * ⚠️ **别省**。省了它这条通道就只下主文件、不碰依赖：搜索结果里已经填好
   * `downloadUrl`，列表行的下载按钮几乎总是走这条 —— 于是「下载 Sodium」
   * 不会带 Fabric API，装进实例直接起不来，而界面一声不吭。
   *
   * 有了它，主进程才能把 URL 定位回版本对象，再递归 required 前置
   * （与 `LAUNCHER_DOWNLOAD_MOD` 共用同一份实现）。
   */
  modId: z.string().optional(),
  /**
   * 清单给的 sha1 / 体积（详情页每一行都带）。
   *
   * **别漏传**：下载按候选源取（官方 / 国内镜像），镜像在中间 —— 不校验就只能
   * 信"HTTP 200 等于文件是对的"，而代理截断、CDN 错误页都会给 200。
   * 缺省不传 = 退回只看 HTTP 状态（老调用方兼容），但那是降级，不是常态。
   */
  sha1: z.string().optional(),
  size: z.number().optional(),
});
export type LauncherDownloadUrlRequest = z.infer<typeof LauncherDownloadUrlRequest>;

export const LauncherDownloadUrlResponse = z.object({
  ok: z.boolean(),
  path: z.string().nullable().optional(),
  /**
   * 没能一起下下来的前置（文件名）。
   *
   * 与 `LauncherDownloadModResponse` 同义。**给了 `modId` 就应该尽力解析**；
   * 解析不了（版本已下架 / URL 对不上）也要在这里说出来，不能静默跳过 ——
   * 用户需要知道「这个 mod 可能缺前置」。
   */
  missingDependencies: z.array(z.string()).optional(),
  error: z.string().nullable().optional(),
});
export type LauncherDownloadUrlResponse = z.infer<typeof LauncherDownloadUrlResponse>;

/** 项目版本里的单个可下载文件。 */
export const ModVersionFile = z.object({
  /** 文件名（如 sodium-fabric-0.6.0+mc1.21.jar）。 */
  filename: z.string(),
  /** 下载直链。 */
  url: z.string(),
  /** 文件大小（字节）。 */
  size: z.number().optional(),
  /** SHA1（用于校验）。 */
  sha1: z.string().optional(),
  /** 是否为主文件（同版本多文件时取它）。 */
  primary: z.boolean().optional(),
  /** 该文件自己的支持版本 / loader（可能比版本级更细）。 */
  gameVersions: z.array(z.string()).optional(),
  loaders: z.array(z.string()).optional(),
});
export type ModVersionFile = z.infer<typeof ModVersionFile>;

/** 项目的一个版本（详情页折叠面板的一行）。 */
export const ModVersion = z.object({
  /** 版本 id（下载时用它定位文件）。 */
  id: z.string(),
  /** 版本号（展示用，如 0.6.0+mc1.21）。 */
  versionNumber: z.string(),
  /** 版本名（部分项目有更友好的名字）。 */
  name: z.string().optional(),
  /** 该版本发布的日期（毫秒时间戳）。 */
  datePublished: z.number().optional(),
  /** 版本类型：release / beta / alpha。 */
  versionType: z.enum(['release', 'beta', 'alpha']).optional(),
  gameVersions: z.array(z.string()),
  loaders: z.array(z.string()),
  /** 下载量（部分源给到版本级）。 */
  downloads: z.number().optional(),
  files: z.array(ModVersionFile),
});
export type ModVersion = z.infer<typeof ModVersion>;

/** 项目详情（详情页头部那份）。 */
export const ModProjectDetail = z.object({
  /** 与搜索结果一致的 id（mr_ / cf_ 前缀）。 */
  id: z.string(),
  name: z.string(),
  /** 一句话简介。 */
  summary: z.string().optional(),
  /** Markdown 长描述。 */
  body: z.string().optional(),
  iconUrl: z.string().optional(),
  source: z.enum(['modrinth', 'curseforge']),
  contentType: ContentType,
  categories: z.array(z.string()),
  gameVersions: z.array(z.string()),
  loaders: z.array(z.string()),
  downloads: z.number().optional(),
  /** 主页 / 百科 / issue 跟踪等外链。 */
  wikiUrl: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional(),
  issuesUrl: z.string().nullable().optional(),
  /** 最新版本号（项目级冗余，省一次请求）。 */
  latestVersion: z.string().optional(),
  publishedAt: z.number().optional(),
  updatedAt: z.number().optional(),
  /** 全部版本（详情页按 loader / 版本分组展开的就是这些）。 */
  versions: z.array(ModVersion),
});
export type ModProjectDetail = z.infer<typeof ModProjectDetail>;

/** 项目详情请求。 */
export const LauncherGetModDetailRequest = z.object({
  /** ModEntry.id（带 mr_ / cf_ 前缀）。 */
  modId: z.string(),
  /** 内容类型：渲染层当前所在分类，详情页据此决定返回哪种详情的元数据。 */
  contentType: ContentType,
});
export type LauncherGetModDetailRequest = z.infer<typeof LauncherGetModDetailRequest>;

/** 项目详情响应。 */
export const LauncherGetModDetailResponse = z.object({
  detail: ModProjectDetail.nullable().optional(),
  error: z.string().nullable().optional(),
});
export type LauncherGetModDetailResponse = z.infer<typeof LauncherGetModDetailResponse>;

// ===== IPC 通道名 =====
export const LAUNCHER_SEARCH_MODS = 'launcher:searchMods';
export const LAUNCHER_DOWNLOAD_MOD = 'launcher:downloadMod';
export const LAUNCHER_GET_MOD_DETAIL = 'launcher:getModDetail';
export const LAUNCHER_DOWNLOAD_URL = 'launcher:downloadUrl';
export const LAUNCHER_INSTALL_MODPACK = 'launcher:installModpack';
export const LAUNCHER_CANCEL_MODPACK = 'launcher:cancelModpack';
export const LAUNCHER_MODPACK_PROGRESS = 'launcher:modpackProgress';

/**
 * 中文词 → 英文项目名（MC百科 别名查询）。
 *
 * 为什么要它：Modrinth / CurseForge 都只有英文名，搜「钠」什么都出不来。
 * MC百科 有中文名（实测 `?key=钠` → Sodium），但它**不托管任何文件** ——
 * 词条页里 `.jar` 出现 0 次、下载 URL 0 处，外链全是跳转壳，解开指向
 * Modrinth / CurseForge / GitHub。所以只拿它**查词**，数据仍走 Modrinth/CF，
 * 这也是 PCL 的做法（其详情页「转到 Modrinth」旁边那个「转到 MC 百科」是外链）。
 */
export const LAUNCHER_MOD_CN_ALIAS = 'launcher:modCnAlias';

export const LauncherModCnAliasRequest = z.object({
  /** 用户输入的原词（中文或中英混排）。 */
  key: z.string().min(1),
  /** 最多返回几个英文名。缺省 3。 */
  limit: z.number().int().positive().max(10).optional(),
});
export const LauncherModCnAliasResponse = z.object({
  /** 建议拿去搜 Modrinth/CF 的英文名，按可信度降序。 */
  englishNames: z.array(z.string()),
  /** 全部候选（英文名 / 中文名 / 词条 id / 简介），供 UI 展示"这是谁的中文名"。 */
  aliases: z.array(
    z.object({
      mcmodId: z.string(),
      cnName: z.string(),
      enName: z.string(),
      summary: z.string(),
    }),
  ),
  error: z.string().nullable().optional(),
});
export type LauncherModCnAliasReq = z.infer<typeof LauncherModCnAliasRequest>;
export type LauncherModCnAliasRes = z.infer<typeof LauncherModCnAliasResponse>;

/**
 * 安装整合包请求。
 *
 * **和单个 mod 下载是两件事**，不能共用一条通道：
 *
 * | | 单个 mod | 整合包 |
 * |---|---|---|
 * | 目标 | 已存在的实例 | **新建**一个实例 |
 * | MC 版本 | 实例已定 | 整合包清单里定 |
 * | 加载器 | 实例已定 | 清单里定，要**装** |
 * | 文件 | 1 个 jar | 清单里全部（实测 Fabulously Optimized 有 55 个）|
 * | config/ | 不碰 | 整合包带 overrides 就得铺 |
 *
 * 共用一条通道的后果是「装整合包时 targetInstance 指向哪个」永远说不清 ——
 * 整合包还没有实例可指。
 */
export const LauncherInstallModpackRequest = z.object({
  /** ModEntry.id（带 `mr_` / `cf_` 前缀）。 */
  modId: z.string(),
  /**
   * 选中的版本 id。
   *
   * Modrinth：version id（如 `D35n5vLL`）。
   * 必填 —— 整合包动辄几百个版本，不指定就没有「装哪一版」这回事。
   */
  versionId: z.string().min(1),
  /** 实例显示名。缺省用项目名。 */
  instanceName: z.string().optional(),
});
export type LauncherInstallModpackRequest = z.infer<typeof LauncherInstallModpackRequest>;

/** 整合包安装的逐项结果。 */
export const ModpackInstallItem = z.object({
  /** 文件名（显示用）。 */
  name: z.string(),
  /** 失败原因；null = 成功。 */
  error: z.string().nullable().optional(),
});
export type ModpackInstallItem = z.infer<typeof ModpackInstallItem>;

export const LauncherInstallModpackResponse = z.object({
  ok: z.boolean(),
  /** 建出来的实例 id（= MC 版本号）；失败时 null。 */
  instanceId: z.string().nullable().optional(),
  /** 实例的游戏目录。 */
  gameDir: z.string().nullable().optional(),
  /** 装了几个文件、失败几个。 */
  installed: z.number().optional(),
  failed: z.array(ModpackInstallItem).optional(),
  /** 用户取消（已下载的文件保留，不会自动删除）。 */
  cancelled: z.boolean().optional(),
  error: z.string().nullable().optional(),
});
export type LauncherInstallModpackResponse = z.infer<typeof LauncherInstallModpackResponse>;

/**
 * 取消正在进行的整合包安装。
 *
 * 用 `modId + versionId` 定位而不是渲染层自造一个随机 id：这两个字段本来就在
 * 安装请求里，界面手里也有；多一层 id 只会多一处可能对不上的地方。
 */
export const LauncherCancelModpackRequest = z.object({
  modId: z.string(),
  versionId: z.string().min(1),
});
export type LauncherCancelModpackRequest = z.infer<typeof LauncherCancelModpackRequest>;

export const LauncherCancelModpackResponse = z.object({
  /** 请求是否被受理（false = 没有正在进行的安装 / 参数不合法）。 */
  ok: z.boolean(),
  /** true = 已经发出取消信号（安装结果会随后由 installModpack 返回）。 */
  cancelled: z.boolean().optional(),
  error: z.string().nullable().optional(),
});
export type LauncherCancelModpackResponse = z.infer<typeof LauncherCancelModpackResponse>;

/** 整合包安装进度（主进程 → 渲染层）。 */
export const LauncherModpackProgress = z.object({
  instanceId: z.string(),
  /** 当前阶段：`resolve` 解析清单 / `loader` 装加载器 / `mods` 下 mod / `done`。 */
  stage: z.string(),
  done: z.number(),
  total: z.number(),
  /** 正在处理的文件名（让用户知道卡在哪）。 */
  current: z.string().optional(),
});
export type LauncherModpackProgress = z.infer<typeof LauncherModpackProgress>;

// 导出类型

export type LauncherSearchModsReq = z.infer<typeof LauncherSearchModsRequest>;
export type LauncherSearchModsRes = z.infer<typeof LauncherSearchModsResponse>;
export type LauncherDownloadModReq = z.infer<typeof LauncherDownloadModRequest>;
export type LauncherDownloadModRes = z.infer<typeof LauncherDownloadModResponse>;
export type LauncherGetModDetailReq = z.infer<typeof LauncherGetModDetailRequest>;
export type LauncherGetModDetailRes = z.infer<typeof LauncherGetModDetailResponse>;
export type LauncherDownloadUrlReq = z.infer<typeof LauncherDownloadUrlRequest>;
export type LauncherDownloadUrlRes = z.infer<typeof LauncherDownloadUrlResponse>;
export type LauncherInstallModpackReq = z.infer<typeof LauncherInstallModpackRequest>;
export type LauncherInstallModpackRes = z.infer<typeof LauncherInstallModpackResponse>;
export type LauncherCancelModpackReq = z.infer<typeof LauncherCancelModpackRequest>;
export type LauncherCancelModpackRes = z.infer<typeof LauncherCancelModpackResponse>;

// Log Stream (L7) types
export type LauncherLogStreamReq = z.infer<typeof LauncherLogStreamRequest>;
export type LauncherLogStreamChunkT = z.infer<typeof LauncherLogStreamChunk>;
export type LauncherReadLatestLogReq = z.infer<typeof LauncherReadLatestLogRequest>;
export type LauncherReadLatestLogRes = z.infer<typeof LauncherReadLatestLogResponse>;
export type LauncherListCrashReportsReq = z.infer<typeof LauncherListCrashReportsRequest>;
export type LauncherListCrashReportsRes = z.infer<typeof LauncherListCrashReportsResponse>;
export type LauncherReadCrashReportReq = z.infer<typeof LauncherReadCrashReportRequest>;
export type LauncherReadCrashReportRes = z.infer<typeof LauncherReadCrashReportResponse>;

// Instance Directory (L8) types
export type InstanceFileInfo = z.infer<typeof InstanceFileInfo>;
export type LauncherListInstanceFilesReq = z.infer<typeof LauncherListInstanceFilesRequest>;
export type LauncherListInstanceFilesRes = z.infer<typeof LauncherListInstanceFilesResponse>;

// ===== 实例注册表（L1）=====
/**
 * L1「实例注册表」的 IPC 契约 —— **只有通道名 + schema，不含 handler**。
 *
 * 实现见 `main/instance-registry.ts`，handler 见 `main/ipc/launcher.ts`。
 * 下面的字段名与可选性**逐字对齐**那份实现：任一侧改字段必须同步改这里，
 * 否则 `launcher-instance-schema.test.ts` 的双向兼容断言会红。
 *
 * 这层存在的理由与 §5.8 账户一样：实例是**用户数据**（里面有存档），
 * 渲染层能发出的写操作必须在契约里显式摆出来，而不是靠 handler 私下约定。
 */

export const LAUNCHER_LIST_INSTANCES = 'launcher:listInstances';
export const LAUNCHER_CREATE_INSTANCE = 'launcher:createInstance';
export const LAUNCHER_UPDATE_INSTANCE = 'launcher:updateInstance';
export const LAUNCHER_DELETE_INSTANCE = 'launcher:deleteInstance';
export const LAUNCHER_OPEN_INSTANCE_FOLDER = 'launcher:openInstanceFolder';

// ===== 服务端实例（独立于客户端实例，对应 mc-creator/servers/）=====
export const LAUNCHER_LIST_SERVER_INSTANCES = 'launcher:listServerInstances';
export const LAUNCHER_DELETE_SERVER_INSTANCE = 'launcher:deleteServerInstance';

/** 服务端实例摘要（与 InstanceSummary 类似但字段不同）。 */
export const ServerInstanceSummary = z.object({
  /** 实例 id（即 serverId）。 */
  id: z.string(),
  /** 显示名；默认等于 id，可改。 */
  name: z.string(),
  /** MC 版本（对应下载的 server.jar 版本）。 */
  versionId: z.string(),
  /** 服务端 jar 形态（由 detectServerJarKind 实测得出）。 */
  jarKind: z.enum(['bundler', 'standalone', 'unknown']).nullable().optional(),
  /** 是否已接受 EULA。 */
  eulaAccepted: z.boolean(),
  /** 最后启动时间（毫秒时间戳）。 */
  lastLaunchedAt: z.number().nullable().optional(),
  /** 创建时间（毫秒时间戳）。 */
  createdAt: z.number(),
});
export type ServerInstanceSummary = z.infer<typeof ServerInstanceSummary>;

export const LauncherListServerInstancesResponse = z.object({
  instances: z.array(ServerInstanceSummary),
  error: z.string().nullable().optional(),
});
export type LauncherListServerInstancesResponse = z.infer<
  typeof LauncherListServerInstancesResponse
>;

export const LauncherDeleteServerInstanceRequest = z.object({
  id: z.string(),
  /** 同时删除实例目录下的文件（存档/插件/配置）。缺省 false 只删注册表。 */
  deleteFiles: z.boolean().default(false),
});
export const LauncherDeleteServerInstanceResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

/** 已安装的加载器。`vanilla` = 原版，未装任何加载器。 */
export const InstanceLoader = z.enum(['vanilla', 'fabric', 'neoforge']);

/**
 * 实例来源。`source` 决定启动前置条件（下载 / 导入 / 离线目录 / 工程 jar 完全不同），
 * 所以它是**受校验的枚举**而不是自由字符串。
 */
export const InstanceSource = z.enum(['downloaded', 'imported', 'offline-dir', 'project-jar']);

/**
 * 实例记录。与 `main/instance-registry.ts` 的 `InstanceRecord` 接口逐字段对应。
 *
 * 必填：`id` / `name` / `versionId` / `loader` / `source` / `createdAt`。
 * 其余全部可选 —— 实现侧按「条件展开」写入（`exactOptionalPropertyTypes` 下
 * 不写 `undefined`），schema 的 `.optional()` 与之同义。
 */
export const InstanceRecord = z.object({
  /** 主键。与 `versionId` 一对一。 */
  id: z.string(),
  /** 显示名。默认等于 `versionId`，可改。 */
  name: z.string(),
  /** MC 版本号，如 `1.21.11`。 */
  versionId: z.string(),
  loader: InstanceLoader,
  source: InstanceSource,
  /** 来源的细分版本（如整合包版本 `26.2-1.2.1`）。 */
  sourceVersion: z.string().optional(),
  /** 游戏目录。缺省 `game/<versionId>/`。 */
  gameDir: z.string().optional(),
  /** 实例级内存，如 `2G` / `4G`，优先于全局。 */
  memory: z.string().optional(),
  /** 实例级 Java 可执行文件；缺省用全局 `JAVA_HOME`。 */
  javaPath: z.string().optional(),
  /** 图标键（assets/mc-ui 里的图标名）。 */
  iconKey: z.string().optional(),
  /** 分组名，用于「自定义组」筛选。 */
  group: z.string().optional(),
  /** 玩家用户名，缺省 Steve。 */
  username: z.string().optional(),
  /** 创建时间（epoch ms）。 */
  createdAt: z.number(),
  /** 最近一次启动时间（epoch ms）。**缺省即 UI 上的「从未玩过」。** */
  lastLaunchedAt: z.number().optional(),
});

/**
 * 列表接口的对外形状：在记录之外附加派生的就绪状态。
 *
 * `clientReady` 由主进程一次算好（jar 存在与否），
 * 渲染层不逐个探盘 —— 否则实例多了会 N 次 IPC 往返。
 */
export const InstanceSummary = InstanceRecord.extend({
  clientReady: z.boolean(),
});

/**
 * 调用方可写的字段集合（create 的其余字段 / update 的 patch 共用同一份）。
 *
 * 刻意**不含** `id` / `versionId` / `createdAt`：这三个由注册表单方面决定
 * （`id = versionId`、`createdAt = 已有 ?? now`），开放它们等于
 * 「允许传，传了会被无声丢掉」——那是最难查的一类 bug。
 */
export const InstanceWritable = z.object({
  name: z.string().optional(),
  loader: InstanceLoader.optional(),
  source: InstanceSource.optional(),
  sourceVersion: z.string().optional(),
  gameDir: z.string().optional(),
  memory: z.string().optional(),
  javaPath: z.string().optional(),
  iconKey: z.string().optional(),
  group: z.string().optional(),
  /**
   * ⚠️ `InstanceRegistry.create()` 当前**不落盘**这个字段
   * （它的 setIf 白名单里没有 `username`），首次创建后请走 `update` 设置。
   * 契约照实开放，以免实现补上时还要改渲染层。
   */
  username: z.string().optional(),
  lastLaunchedAt: z.number().optional(),
});

/** 无参请求：`InstanceRegistry.list()` 没有任何入参。 */
export const LauncherListInstancesRequest = z.object({});

export const LauncherListInstancesResponse = z.object({
  instances: z.array(InstanceSummary),
  error: z.string().nullable().optional(),
});

export const LauncherCreateInstanceRequest = z.object({
  versionId: z.string().min(1),
  ...InstanceWritable.shape,
});

export const LauncherCreateInstanceResponse = z.object({
  ok: z.boolean(),
  /** 同 id 视为更新（幂等），所以这里既有可能是新建也有可能是覆盖。 */
  instance: InstanceRecord.nullable(),
  error: z.string().nullable().optional(),
});

export const LauncherUpdateInstanceRequest = z.object({
  id: z.string().min(1),
  /** 局部更新：只覆盖出现的键；`id`/`versionId` 在实现里被无条件保原值。 */
  patch: InstanceWritable,
});

export const LauncherUpdateInstanceResponse = z.object({
  ok: z.boolean(),
  /** 实例不存在时为 null（主键拼错要能看出来，不能当成成功）。 */
  instance: InstanceRecord.nullable(),
  error: z.string().nullable().optional(),
});

export const LauncherDeleteInstanceRequest = z.object({
  id: z.string().min(1),
  /**
   * 是否连同实例目录（存档 / world）一起删。**默认 false**。
   *
   * `InstanceRegistry.remove()` 只删记录、不动磁盘 —— 存档是用户数据，
   * 误删代价太高。破坏性删除必须由 UI 显式二次确认后才传 true。
   */
  deleteFiles: z.boolean().optional(),
});

export const LauncherDeleteInstanceResponse = z.object({
  ok: z.boolean(),
  /** 是否真的删了磁盘文件（`deleteFiles: true` 时为 true）。删除记录本身总会成功。 */
  filesDeleted: z.boolean(),
  error: z.string().nullable().optional(),
});

/**
 * 在系统文件管理器里打开实例目录。
 *
 * 只读操作，但路径来自实例记录（`gameDir` 可能是用户选过的任意目录），
 * 所以仍然走主进程、按 id 取记录，不接受渲染层直接传路径。
 */
export const LauncherOpenInstanceFolderRequest = z.object({
  id: z.string().min(1),
});

export const LauncherOpenInstanceFolderResponse = z.object({
  ok: z.boolean(),
  /** 实际打开（不存在时先创建）的目录；失败时为 null。 */
  path: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

// Instance Registry (L1) types
export type InstanceLoader = z.infer<typeof InstanceLoader>;
export type InstanceSource = z.infer<typeof InstanceSource>;
export type InstanceRecord = z.infer<typeof InstanceRecord>;
export type InstanceSummary = z.infer<typeof InstanceSummary>;
export type InstanceWritable = z.infer<typeof InstanceWritable>;
export type LauncherListInstancesReq = z.infer<typeof LauncherListInstancesRequest>;
export type LauncherListInstancesRes = z.infer<typeof LauncherListInstancesResponse>;
export type LauncherCreateInstanceReq = z.infer<typeof LauncherCreateInstanceRequest>;
export type LauncherCreateInstanceRes = z.infer<typeof LauncherCreateInstanceResponse>;
export type LauncherUpdateInstanceReq = z.infer<typeof LauncherUpdateInstanceRequest>;
export type LauncherUpdateInstanceRes = z.infer<typeof LauncherUpdateInstanceResponse>;
export type LauncherDeleteInstanceReq = z.infer<typeof LauncherDeleteInstanceRequest>;
export type LauncherDeleteInstanceRes = z.infer<typeof LauncherDeleteInstanceResponse>;
export type LauncherOpenInstanceFolderReq = z.infer<typeof LauncherOpenInstanceFolderRequest>;
export type LauncherOpenInstanceFolderRes = z.infer<typeof LauncherOpenInstanceFolderResponse>;
