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

// === Minecraft 启动器（A 切片：离线账号，无需微软 OAuth）===
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
