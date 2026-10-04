import { app } from 'electron';
import { resolve } from 'path';
import { profileManager } from './profile-manager.js';

// ---------------------------------------------------------------------------
// 应用数据根目录
// ---------------------------------------------------------------------------
export const APP_DATA_DIR = 'mc-creator';

// ---------------------------------------------------------------------------
// 全局目录 (始终位于 %APPDATA%/mc-creator/)
// 这些目录不依赖于具体项目，用于存放全局资源
// ---------------------------------------------------------------------------

/** 项目持久化元数据目录 */
export const PROJECTS_DIR = (): string => resolve(app.getPath('userData'), APP_DATA_DIR, 'projects');

/** 全局 mc-launcher 目录 */
export const MC_LAUNCHER_DIR = (): string => resolve(app.getPath('userData'), APP_DATA_DIR, 'mc-launcher');

/** 全局 mod 缓存仓库 */
export const GLOBAL_MODS_DIR = (): string => resolve(app.getPath('userData'), APP_DATA_DIR, 'mods');

/** 全局 modpack 目录 */
export const GLOBAL_MODPACKS_DIR = (): string => resolve(app.getPath('userData'), APP_DATA_DIR, 'modpacks');

/** 全局 resource-packs 目录 */
export const GLOBAL_RESOURCE_PACKS_DIR = (): string =>
  resolve(app.getPath('userData'), APP_DATA_DIR, 'resource-packs');

/** 全局 servers 目录 */
export const GLOBAL_SERVERS_DIR = (): string => resolve(app.getPath('userData'), APP_DATA_DIR, 'servers');

/** 全局 skins 目录 */
export const GLOBAL_SKINS_DIR = (): string => resolve(app.getPath('userData'), APP_DATA_DIR, 'skins');

/** 全局 temp 目录 */
export const GLOBAL_TEMP_DIR = (): string => resolve(app.getPath('userData'), APP_DATA_DIR, 'temp');

// ---------------------------------------------------------------------------
// 项目级作用域路径 (Profile-Driven)
// 
// 路径模板由 project profile (project-profiles.json / ProfileManager) 定义,
// 使用 {projectName} 占位符。实际路径在 runtime 时根据当前活动项目
// 进行填充。这种设计支持多 profile (mc_creator, modpack, 等) 并行.
// ---------------------------------------------------------------------------

/** 将模板字符串与 projectName 结合，生成实际路径 */
function resolveProfilePath(template: string, projectName: string): string {
  return template.replace('{projectName}', projectName);
}

/** 获取当前活动 projectName */
function getCurrentProjectName(): string | undefined {
  return profileManager.getCurrentProjectName();
}

// ---------------------------------------------------------------------------
// 项目级作用域路径 (Profile-Driven)
// 
// 这些路径相对于用户数据目录，由当前 profile 的模板决定.
// 当项目未加载时，回退到基于 projectId 的后向兼容路径.
// ---------------------------------------------------------------------------

/** 项目工作区根目录 */
export function projectWorkspace(projectId?: string): string {
  const projectName = projectId || getCurrentProjectName();
  if (!projectName) {
    // 无项目时的后向兼容: 返回全局 workspace
    return resolve(app.getPath('userData'), APP_DATA_DIR, 'workspaces', 'untitled');
  }
  return resolveProfilePath(profileManager.currentProfileConfig.workspace, projectName);
}

// 项目输出目录
export function projectOutput(projectId?: string): string {
  const projectName = projectId || getCurrentProjectName();
  if (!projectName) {
    return resolve(app.getPath('userData'), APP_DATA_DIR, 'output', 'untitled');
  }
  return resolveProfilePath(profileManager.currentProfileConfig.output, projectName);
}

// 项目构建缓存目录
export function projectBuildCache(projectId?: string): string {
  const projectName = projectId || getCurrentProjectName();
  if (!projectName) {
    return resolve(app.getPath('userData'), APP_DATA_DIR, '.cache', 'untitled');
  }
  return resolveProfilePath(profileManager.currentProfileConfig.buildCache, projectName);
}

// 项目临时目录
export function projectTemp(projectId?: string): string {
  const projectName = projectId || getCurrentProjectName();
  if (!projectName) {
    return resolve(app.getPath('userData'), APP_DATA_DIR, 'temp', 'untitled');
  }
  return resolveProfilePath(profileManager.currentProfileConfig.temp, projectName);
}

// 项目资源包目录 (项目级资源包，优先于全局)
export function projectResourcePacks(projectId?: string): string {
  const projectName = projectId || getCurrentProjectName();
  if (!projectName) {
    return resolve(app.getPath('userData'), APP_DATA_DIR, 'resource-packs', 'untitled');
  }
  return resolveProfilePath(profileManager.currentProfileConfig.resourcePacks, projectName);
}

// 项目 Mod 目录 (项目级 Mod，优先于全局)
export function projectMods(projectId?: string): string {
  const projectName = projectId || getCurrentProjectName();
  if (!projectName) {
    return resolve(app.getPath('userData'), APP_DATA_DIR, 'mods', 'untitled');
  }
  return resolveProfilePath(profileManager.currentProfileConfig.mods, projectName);
}

// 项目导出目录
export function projectExports(projectId?: string): string {
  const projectName = projectId || getCurrentProjectName();
  if (!projectName) {
    return resolve(app.getPath('userData'), APP_DATA_DIR, 'exports', 'untitled');
  }
  return resolveProfilePath(profileManager.currentProfileConfig.exports || 'exports/{projectName}', projectName);
}

// ---------------------------------------------------------------------------
// 后向兼容: 当项目未加载时的旧项目 ID -based 路径
// ---------------------------------------------------------------------------

/** 根据 projectId 计算旧式 PROJECT_SCOPED 路径 (兼容旧代码) */
export function legacyProjectPath(projectId: string, subDir: 'workspace' | 'output' | 'buildCache' | 'temp' | 'resourcePacks' | 'mods' | 'exports'): string {
  const base = resolve(app.getPath('userData'), APP_DATA_DIR, 'workspaces', projectId);
  switch (subDir) {
    case 'workspace': return base;
    case 'output': return resolve(base, 'output');
    case 'buildCache': return resolve(base, '.build-cache');
    case 'temp': return resolve(base, 'temp');
    case 'resourcePacks': return resolve(base, 'resource-packs');
    case 'mods': return resolve(base, 'mods');
    case 'exports': return resolve(base, 'exports');
    default: return base;
  }
}

// ---------------------------------------------------------------------------
// 目录确保存在
// ---------------------------------------------------------------------------

/** 确保目录存在 (原子创建) */
export async function ensureDir(path: string): Promise<void> {
  const fs = await import('node:fs/promises');
  await fs.mkdir(path, { recursive: true });
}

/** 确保项目目录存在 */
export async function ensureProjectDirs(projectId: string): Promise<{
  workspace: string;
  output: string;
  buildCache: string;
  temp: string;
  resourcePacks: string;
  mods: string;
}> {
  const projectName = profileManager.getCurrentProjectName() || projectId;
  const workspace = resolveProfilePath(profileManager.currentProfileConfig.workspace, projectName);
  const output = resolveProfilePath(profileManager.currentProfileConfig.output, projectName);
  const buildCache = resolveProfilePath(profileManager.currentProfileConfig.buildCache, projectName);
  const temp = resolveProfilePath(profileManager.currentProfileConfig.temp, projectName);
  const resourcePacks = resolveProfilePath(profileManager.currentProfileConfig.resourcePacks, projectName);
  const mods = resolveProfilePath(profileManager.currentProfileConfig.mods, projectName);

  await ensureDir(workspace);
  await ensureDir(output);
  await ensureDir(buildCache);
  await ensureDir(temp);
  await ensureDir(resourcePacks);
  await ensureDir(mods);

  return { workspace, output, buildCache, temp, resourcePacks, mods };
}

// ---------------------------------------------------------------------------
// 路径安全检查
// ---------------------------------------------------------------------------

/** 检查路径是否在项目工作区内 */
export function isPathInWorkspace(path: string, projectId?: string): boolean {
  const projectName = projectId || getCurrentProjectName();
  if (!projectName) return false;

  const workspace = resolveProfilePath(profileManager.currentProfileConfig.workspace, projectName);
  const normalized = resolve(workspace, path);
  const resolvedBase = resolve(workspace);
  return normalized.startsWith(resolvedBase + '/') || normalized === resolvedBase;
}

// ---------------------------------------------------------------------------
// 导出统一对象 (保持向后兼容)
// ---------------------------------------------------------------------------

/** 保留原有的 PROJECT_SCOPED 别名，但现在它们使用 profile system */
export const PROJECT_SCOPED = {
  workspace: (projectId: string) => projectWorkspace(projectId),
  output: (projectId: string) => projectOutput(projectId),
  buildCache: (projectId: string) => projectBuildCache(projectId),
  temp: (projectId: string) => projectTemp(projectId),
  resourcePacks: (projectId: string) => projectResourcePacks(projectId),
  mods: (projectId: string) => projectMods(projectId),
  exports: (projectId: string) => projectExports(projectId),
};

// ---------------------------------------------------------------------------
// 向后兼容：旧版 PATH_MANAGER 对象（file-manager.ts 等仍在用）
// ---------------------------------------------------------------------------

/** 统一的目录路径管理（旧版兼容入口，底层仍走全局目录） */
export const PATH_MANAGER = {
  /** 项目持久化目录 */
  projects: () => PROJECTS_DIR(),
  /** 游戏启动器目录 */
  mcLauncher: () => MC_LAUNCHER_DIR(),
  /** 统一 Mod 缓存仓库 */
  mods: () => GLOBAL_MODS_DIR(),
  /** 整合包导出/导入目录 */
  modpacks: () => GLOBAL_MODPACKS_DIR(),
  /** 资源包/材质包目录 */
  resourcePacks: () => GLOBAL_RESOURCE_PACKS_DIR(),
  /** 服务器配置目录 */
  servers: () => GLOBAL_SERVERS_DIR(),
  /** 皮肤文件目录 */
  skins: () => GLOBAL_SKINS_DIR(),
  /** 临时构建产物目录 */
  temp: () => GLOBAL_TEMP_DIR(),
  /** 工作空间/当前项目目录 */
  workspace: (projectId?: string) =>
    projectId
      ? resolve(app.getPath('userData'), APP_DATA_DIR, 'workspaces', projectId)
      : resolve(app.getPath('userData'), APP_DATA_DIR, 'workspace'),
};

/**
 * 安全路径检查（防止路径穿越）
 * 仅允许在 APP_DATA_DIR 及其子目录下操作
 */
export function isSafePath(target: string, base: string = PROJECTS_DIR()): boolean {
  const normalized = resolve(base, target);
  const resolvedBase = resolve(base);
  return normalized.startsWith(resolvedBase + '/') || normalized === resolvedBase;
}