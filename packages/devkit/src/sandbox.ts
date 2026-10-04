/**
 * 隔离沙箱（设计文档 §8.3 安全模型 / §13.4 代码执行）。
 *
 * ```
 * ⚠️ 约束（§8.3 原文）：JDK 17 起 SecurityManager 被标记为待移除，
 *    JDK 24 已永久禁用 → 无法在进程内沙箱化 Java 代码
 *    → 必须使用进程级或容器级隔离
 * ```
 * 因此本模块不提供任何“进程内限制”API（那是死路），只提供：
 * 1. assertWithinRoot：cwd jail / 解压落位的前置检查（防 zip-slip，§13.1）；
 * 2. buildSandboxOptions：沙箱约束的声明式 options 类型
 *    （cwd jail、无网络声明、CPU/内存/时间上限），由进程/容器实施者消费；
 * 3. 快照占位类型：调用方用 Filesystem 快照实现（本包不碰 fs 写）。
 */

import path from 'node:path';

export interface SandboxLimits {
  /** 墙钟超时毫秒数（编译/运行验证各自设置，默认见调用方）。 */
  timeoutMs: number;
  /** 内存上限 MB；实施者映射为容器 memory limit / ulimit -v。 */
  maxMemoryMb: number;
  /** CPU 上限（core 数，如 2 = 最多占满 2 核）；实施者自行映射。 */
  maxCpuCores: number;
}

export interface SandboxOptions {
  /** 沙箱根目录（绝对路径）；cwd 必须 jail 在此目录内。 */
  root: string;
  /** 工作目录（绝对路径），必须位于 root 内。 */
  cwd: string;
  /**
   * 网络策略：默认 false = 禁用出站（§8.3：运行验证禁用网络出站，或白名单）。
   * 编译阶段如需拉依赖，调用方显式传 { allowlist: ['repo.maven.apache.org', ...] }，
   * 且仅允许 Maven 中央仓库与其镜像（§8.1#3）。
   */
  allowNetwork: false | { allowlist: string[] };
  limits: SandboxLimits;
  /** 透传给子进程的最小环境变量（默认只给 PATH 等白名单，由实施者过滤）。 */
  envAllowlist: string[];
  /** 产物在沙箱外落位前必须经哈希记录（§0.5#5 / §8.3），实施者强制执行。 */
  requireArtifactHash: boolean;
}

export const DEFAULT_SANDBOX_LIMITS: SandboxLimits = {
  timeoutMs: 5 * 60 * 1000,
  maxMemoryMb: 2048,
  maxCpuCores: 2,
};

/**
 * 断言 target 位于 root 内（cwd jail / zip-slip 防护，§13.1）。
 * @returns 解析后的绝对路径（便于调用方直接使用）。
 * @throws 跨盘符、绝对路径逃逸、../ 逃逸时抛错。
 */
export function assertWithinRoot(root: string, target: string): string {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(resolvedRoot, target);

  // 跨盘符拒绝：Windows 下 path.relative('D:\\a', 'E:\\b') 返回绝对路径，
  // 属逃逸；posix 下对比首段亦可由 isAbsolute 覆盖。
  const rel = path.relative(resolvedRoot, resolvedTarget);
  if (
    rel === '' ||
    rel === '.' ||
    (!rel.startsWith('..') && !path.isAbsolute(rel))
  ) {
    return resolvedTarget;
  }
  throw new Error(
    `[sandbox] path escapes root: root=${resolvedRoot} target=${target}`,
  );
}

export function buildSandboxOptions(
  root: string,
  overrides: {
    cwd?: string;
    allowNetwork?: SandboxOptions['allowNetwork'];
    limits?: Partial<SandboxLimits>;
    envAllowlist?: string[];
    requireArtifactHash?: boolean;
  } = {},
): SandboxOptions {
  const resolvedRoot = path.resolve(root);
  const cwd =
    overrides.cwd === undefined
      ? resolvedRoot
      : assertWithinRoot(resolvedRoot, overrides.cwd);
  return {
    root: resolvedRoot,
    cwd,
    allowNetwork: overrides.allowNetwork ?? false,
    limits: { ...DEFAULT_SANDBOX_LIMITS, ...(overrides.limits ?? {}) },
    envAllowlist: overrides.envAllowlist ?? ['PATH', 'JAVA_HOME', 'GRADLE_USER_HOME'],
    requireArtifactHash: overrides.requireArtifactHash ?? true,
  };
}

/**
 * 快照占位类型（§8.1#5：编译产物在一次性沙箱中加载测试）。
 *
 * 注明：快照/恢复的具体实现是调用方的责任——用 Filesystem 快照
 * （复制目录 / 硬链接 / overlayfs / 容器镜像层），本包只定契约，
 * 不碰 fs 写（保持 devkit 可移植、无平台相关代码）。
 */
export interface SandboxSnapshot {
  id: string;
  /** 快照对应的沙箱 root（buildSandboxOptions().root）。 */
  root: string;
  createdAt: string;
  /** 调用方自定义的定位信息（镜像层 id / 目录路径均可）。 */
  handle: string;
}

export interface SandboxSnapshotStore {
  snapshot(root: string): Promise<SandboxSnapshot>;
  restore(snapshot: SandboxSnapshot): Promise<void>;
}
