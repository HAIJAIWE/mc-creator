/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain, dialog, app } from 'electron';
import { mkdir, copyFile } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { spawn } from 'node:child_process';
import * as nodeFs from 'fs';
import { z } from 'zod';
import { LauncherService } from '../launcher-service.js';
import {
  LAUNCHER_LIST_VERSIONS,
  LAUNCHER_DOWNLOAD,
  LAUNCHER_LAUNCH,
  LAUNCHER_INSTALL_LOADER,
  LAUNCHER_LIST_MODS,
  LAUNCHER_INSTALL_MOD,
  LAUNCHER_REMOVE_MOD,
  LAUNCHER_INSTALL_SKIN,
  LauncherListVersionsResponse,
  LauncherDownloadRequest,
  LauncherDownloadResponse,
  LauncherLaunchRequest,
  LauncherLaunchResponse,
  LauncherInstallLoaderRequest,
  LauncherInstallLoaderResponse,
  LauncherListModsResponse,
  LauncherInstallModRequest,
  LauncherInstallModResponse,
  LauncherRemoveModRequest,
  LauncherInstallSkinRequest,
  LauncherInstallSkinResponse,
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

export function registerLauncherHandlers(): void {
  // ===== 游戏启动器（下载客户端 + 离线启动）=====

  const launcherDir = join(app.getPath('userData'), 'mc-launcher');
  const launcher = new LauncherService(launcherDir);

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
  ipcMain.handle(
    LAUNCHER_DOWNLOAD,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherDownloadResponse>> => {
      try {
        const req = LauncherDownloadRequest.parse(raw);
        const detail = await launcher.resolveVersion(req.version);
        await launcher.downloadClient(detail);
        await launcher.downloadAssets(detail);
        await launcher.downloadLibraries(detail);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // 启动游戏（离线模式）
  ipcMain.handle(
    LAUNCHER_LAUNCH,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherLaunchResponse>> => {
      try {
        const req = LauncherLaunchRequest.parse(raw);
        const detail = await launcher.resolveVersion(req.version);
        const result = await launcher.launchGame(detail, {
          username: req.username,
          memory: req.memory,
          gameDir: req.gameDir,
        });
        return { pid: result.pid };
      } catch (e) {
        return { pid: 0, error: (e as Error).message };
      }
    },
  );

  // 安装加载器（Fabric / NeoForge）
  ipcMain.handle(
    LAUNCHER_INSTALL_LOADER,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherInstallLoaderResponse>> => {
      try {
        const req = LauncherInstallLoaderRequest.parse(raw);
        await launcher.installLoader(req.version, req.loader);
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
        const req = z.object({ version: z.string() }).parse(raw);
        const mods = await launcher.listMods(req.version);
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
        const path = await launcher.installMod(req.version, req.name, req.url);
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
      await launcher.removeMod(req.version, req.name);
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
        await launcher.installSkinSupport(req.version, req.skinApiUrl);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

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
    spawn(launcherExe, [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, method: 'launcher', launcher, error: null };
  });
}
