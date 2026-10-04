/**
 * 整合包依赖解析 / 冲突检测 / mrpack 打包的共享类型。
 *
 * 纯类型 + 无 Node 依赖，可同时被 core（主进程）和浏览器 bundle 引用。
 */

import type { ModEntry } from '@mc-creator/shared';

/** 统一版本元数据（Modrinth / CurseForge 归一化后） */
export interface VersionMetadata {
  /** 版本 ID（Modrinth version id / CurseForge file id 字符串化） */
  id: string;
  /** 人类可读版本号 */
  versionNumber: string;
  /** 主文件名 */
  fileName: string;
  /** 下载直链（可能为空） */
  downloadUrl: string;
  /** 文件字节数 */
  fileSize: number;
  sha512?: string;
  sha1?: string;
  /** 支持的 MC 版本 */
  gameVersions: string[];
  /** 支持的 loader（小写：fabric/forge/neoforge/quilt） */
  loaders: string[];
  /** 依赖声明 */
  dependencies: Array<{
    projectId: string;
    versionId?: string;
    dependencyType: 'required' | 'optional' | 'incompatible' | 'embedded';
  }>;
  /** 运行侧（Modrinth env；CurseForge 无此概念时为 undefined） */
  envClient?: 'required' | 'optional' | 'unsupported';
  envServer?: 'required' | 'optional' | 'unsupported';
}

/** 依赖图节点 */
export interface DependencyNode {
  projectId: string;
  name: string;
  versionId: string;
  versionNumber?: string;
  source: 'modrinth' | 'curseforge' | 'unknown';
}

/** 依赖图边 */
export interface DependencyEdge {
  from: string;
  to: string;
  kind: 'requires' | 'optional' | 'breaks' | 'conflicts' | 'embedded';
  /** 目标版本约束（Modrinth version_id 精确匹配时才有值） */
  versionConstraint?: string;
}

/** 依赖图 */
export interface DependencyGraph {
  nodes: DependencyNode[];
  edges: DependencyEdge[];
}

/** 冲突种类 */
export type ConflictKind =
  | 'duplicate-version'
  | 'loader-mismatch'
  | 'mc-out-of-range'
  | 'missing-dependency'
  | 'breaks-conflict';

/** 一键修复建议 */
export interface FixSuggestion {
  action: 'upgrade' | 'downgrade' | 'remove' | 'add-missing' | 'switch-loader-version';
  /** 目标版本 ID（upgrade/downgrade 时）或缺失依赖的 projectId（add-missing 时） */
  targetVersionId?: string;
  targetProjectId?: string;
  reason: string;
}

/** 版本冲突项 */
export interface ModConflict {
  kind: ConflictKind;
  /** 相关 mod 的 projectId 列表（首个为主要责任方） */
  projectIds: string[];
  message: string;
  suggestion: FixSuggestion;
  /** 建议的目标人类可读版本号（有则展示） */
  suggestedVersionNumber?: string;
}

/** 依赖解析输入 */
export interface ResolveInput {
  mods: Array<{ projectId: string; name?: string }>;
  mcVersion: string;
  loader: string;
}

/** 依赖解析结果 */
export interface ResolveResult {
  /** 锁定后的完整 ModEntry（含 versionId/fileName/hashes/gameVersions/loaders/dependencies） */
  resolved: ModEntry[];
  /** 依赖图 */
  graph: DependencyGraph;
  /** 解析期即发现的冲突（含缺失依赖等） */
  conflicts: ModConflict[];
  /** 未能解析的 mod（网络失败且无缓存时） */
  unresolved: Array<{ projectId: string; reason: string }>;
  warnings: string[];
}

/** mrpack 导出产物描述 */
export interface MrpackPlan {
  /** modrinth.index.json 内容（已 JSON 序列化就绪的对象） */
  indexJson: Record<string, unknown>;
  /** 需要写入 overrides/ 的文件 */
  overrideFiles: Array<{ path: string; content: string }>;
  /** 需要写入 server-overrides/ 的文件（mrpack 标准忽略，仅随包附带说明） */
  serverOverrideFiles: Array<{ path: string; content: string }>;
  warnings: string[];
}
