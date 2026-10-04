/**
 * Project Profile 管理器（主进程）。
 *
 * 职责：
 * - 从 userData 下的 JSON 文件加载/保存项目 profile 配置
 * - 提供 profile-driven 路径模板（`{projectName}` 占位）
 * - 记录当前活动项目名（供 path-manager 解析 profile 路径）
 *
 * 注意：本模块仅运行在主进程，不得引用 renderer 的 store / ipc-client。
 */
import { app } from 'electron';
import { join } from 'node:path';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import {
  DEFAULT_PROJECT_CONFIG,
  type ProjectConfig,
  type ProjectProfile,
} from '../shared/ipc-intents.js';

const CONFIG_FILE = 'project-profiles.json';

function configPath(): string {
  return join(app.getPath('userData'), 'mc-creator', CONFIG_FILE);
}

function loadFromDisk(): ProjectConfig {
  try {
    const p = configPath();
    if (!existsSync(p)) return { ...DEFAULT_PROJECT_CONFIG };
    const raw = readFileSync(p, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ProjectConfig>;
    if (!parsed || typeof parsed !== 'object' || !parsed.profiles) {
      return { ...DEFAULT_PROJECT_CONFIG };
    }
    return {
      currentProfile: parsed.currentProfile ?? DEFAULT_PROJECT_CONFIG.currentProfile,
      profiles: { ...DEFAULT_PROJECT_CONFIG.profiles, ...parsed.profiles },
      lastUpdated: parsed.lastUpdated ?? Date.now(),
    };
  } catch {
    return { ...DEFAULT_PROJECT_CONFIG };
  }
}

class ProfileManager {
  private config: ProjectConfig | null = null;
  private activeProjectName: string | undefined;

  private ensureLoaded(): ProjectConfig {
    if (!this.config) this.config = loadFromDisk();
    return this.config;
  }

  /** 当前 profile id */
  get currentProfile(): string {
    return this.ensureLoaded().currentProfile;
  }

  /** 当前 profile 的完整配置 */
  get currentProfileConfig(): ProjectProfile {
    const cfg = this.ensureLoaded();
    return cfg.profiles[cfg.currentProfile] ?? DEFAULT_PROJECT_CONFIG.profiles.mc_creator;
  }

  /** 当前活动项目名（未设置时返回 undefined，由调用方回退） */
  getCurrentProjectName(): string | undefined {
    return this.activeProjectName;
  }

  /** 设置当前活动项目名（项目加载/切换时由 IPC 层调用） */
  setCurrentProjectName(name: string | undefined): void {
    this.activeProjectName = name;
  }

  /** 解析 `{projectName}` 占位模板 */
  resolvePath(template: string, projectName?: string): string {
    const name = projectName ?? this.activeProjectName ?? 'untitled';
    return template.replace('{projectName}', name);
  }

  /** 切换 profile 并持久化 */
  switchProfile(profileId: string): boolean {
    const cfg = this.ensureLoaded();
    if (!cfg.profiles[profileId]) return false;
    cfg.currentProfile = profileId;
    cfg.lastUpdated = Date.now();
    this.save();
    return true;
  }

  /** 持久化当前配置到磁盘 */
  save(): void {
    try {
      const cfg = this.ensureLoaded();
      const p = configPath();
      mkdirSync(join(app.getPath('userData'), 'mc-creator'), { recursive: true });
      writeFileSync(p, JSON.stringify(cfg, null, 2), 'utf-8');
    } catch {
      /* 磁盘不可写时静默跳过 */
    }
  }
}

export const profileManager = new ProfileManager();
export type { ProjectConfig, ProjectProfile };
