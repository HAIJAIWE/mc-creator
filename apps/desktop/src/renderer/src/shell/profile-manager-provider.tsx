import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useProjectStore } from '../store/project-store.js';
import {
  DEFAULT_PROJECT_CONFIG,
  type ProjectConfig,
  type ProjectProfile,
} from '../../../shared/ipc-intents.js';

/** Profile 上下文值（renderer 侧：只读视图，写操作走 IPC / project-store） */
export interface ProfileContextValue {
  /** 当前 profile id */
  currentProfile: string;
  /** 当前 profile 的路径模板配置 */
  currentProfileConfig: ProjectProfile;
  /** 当前项目 id */
  currentProjectId: string | null;
  /** 当前项目名（无项目时为 'untitled'） */
  currentProjectName: string;
  /** 解析 `{projectName}` 占位模板为实际相对路径 */
  resolvePath: (template: string, projectName?: string) => string;
  /** 全量配置（供设置面板展示） */
  config: ProjectConfig;
}

const ProfileContext = createContext<ProfileContextValue | null>(null);

/** Profile Provider：向子树提供 profile 只读视图 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const currentProjectId = useProjectStore((s) => s.currentProjectId);
  const projects = useProjectStore((s) => s.projects);

  const value = useMemo<ProfileContextValue>(() => {
    const config = DEFAULT_PROJECT_CONFIG;
    const currentProfile = config.currentProfile;
    const currentProfileConfig = config.profiles[currentProfile] ?? config.profiles.mc_creator;
    const currentProjectName =
      projects.find((p) => p.id === currentProjectId)?.name ?? 'untitled';
    const resolvePath = (template: string, projectName?: string) =>
      template.replace('{projectName}', projectName ?? currentProjectName);
    return {
      currentProfile,
      currentProfileConfig,
      currentProjectId,
      currentProjectName,
      resolvePath,
      config,
    };
  }, [currentProjectId, projects]);

  return <ProfileContext.Provider value={value}>{children}</ProfileContext.Provider>;
}

/** 读取 Profile 上下文（必须在 ProfileProvider 内使用） */
export function useProfileManager(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error('useProfileManager must be used within a ProfileProvider');
  return ctx;
}

export type { ProjectProfile, ProjectConfig };
