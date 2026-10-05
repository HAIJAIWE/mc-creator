import { z } from 'zod';

/** 游戏启动器（下载客户端 + 离线启动） */
export const LAUNCHER_LIST_VERSIONS = 'launcher:listVersions';
export const LAUNCHER_DOWNLOAD = 'launcher:download';
export const LAUNCHER_LAUNCH = 'launcher:launch';
export const LAUNCHER_INSTALL_LOADER = 'launcher:installLoader';
export const LAUNCHER_LIST_MODS = 'launcher:listMods';
export const LAUNCHER_INSTALL_MOD = 'launcher:installMod';
export const LAUNCHER_REMOVE_MOD = 'launcher:removeMod';
export const LAUNCHER_INSTALL_SKIN = 'launcher:installSkin';

export const LauncherInstallLoaderRequest = z.object({
  version: z.string(),
  loader: z.enum(['fabric', 'neoforge']),
});
export const LauncherInstallLoaderResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const LauncherListModsResponse = z.object({
  mods: z.array(z.string()),
  error: z.string().nullable().optional(),
});

export const LauncherInstallModRequest = z.object({
  version: z.string(),
  name: z.string(),
  url: z.string(),
});
export const LauncherInstallModResponse = z.object({
  ok: z.boolean(),
  path: z.string().nullable(),
  error: z.string().nullable().optional(),
});

export const LauncherRemoveModRequest = z.object({ version: z.string(), name: z.string() });

export const LauncherInstallSkinRequest = z.object({
  version: z.string(),
  skinApiUrl: z.string().default('https://littleskin.cn/api/yggdrasil'),
});
export const LauncherInstallSkinResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

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

export const LauncherDownloadRequest = z.object({ version: z.string() });
export const LauncherDownloadResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

export const LauncherLaunchRequest = z.object({
  version: z.string(),
  username: z.string().default('Steve'),
  memory: z.string().default('2G'),
  gameDir: z.string().default(''),
});
export const LauncherLaunchResponse = z.object({
  pid: z.number(),
  error: z.string().nullable().optional(),
});

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
