/**
 * 增量构建缓存的磁盘持久化（按项目隔离）。
 *
 * 背景：缓存快照原本只是 generate.ts 里的一个模块级变量，进程重启即丢失，
 * 也没有项目维度。这里把快照按项目 id 落到 `userData/build-cache/<key>.json`，
 * 让二次启动后的首次构建也能命中缓存。
 *
 * 刻意不 import electron（与 chat-system-message.ts 同一约定）：缓存根目录由调用方
 * 传入，模块本身可脱离 Electron 单元测试。
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { writeFileAtomic } from '@mc-creator/shell';
import type { BuildCacheSnapshot } from '@mc-creator/core';

/** 未保存项目共用的缓存桶名 */
const DEFAULT_BUCKET = 'default';

/**
 * projectId → 文件名。
 *
 * projectId 来自本应用的项目存储（uuid 形态），这里仍用 base64url 兜底编码：
 * 既避免路径分隔符/保留字符污染文件名，也保证不同 id 不会映射到同一文件。
 */
export function buildCacheFileName(projectId: string): string {
  const id = projectId.trim();
  if (!id) return `${DEFAULT_BUCKET}.json`;
  return `${Buffer.from(id, 'utf8').toString('base64url')}.json`;
}

/** 某个项目对应的缓存文件绝对路径 */
export function resolveBuildCacheFile(dir: string, projectId: string): string {
  return join(dir, buildCacheFileName(projectId));
}

/**
 * 读取项目的缓存快照。
 *
 * 文件不存在（首次构建）/ 内容损坏 / 结构不符 → 一律返回 `undefined`，
 * 调用方按「无缓存」走全量生成。
 */
export async function loadBuildCacheSnapshot(
  dir: string,
  projectId: string,
): Promise<BuildCacheSnapshot | undefined> {
  try {
    const raw = await readFile(resolveBuildCacheFile(dir, projectId), 'utf8');
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as BuildCacheSnapshot;
  } catch {
    return undefined;
  }
}

/**
 * 写入项目的缓存快照。
 *
 * 失败不抛错也不影响返回值：缓存只是加速手段，写不进磁盘不应让构建失败。
 */
export async function saveBuildCacheSnapshot(
  dir: string,
  projectId: string,
  snapshot: BuildCacheSnapshot,
): Promise<void> {
  try {
    // 原子写（同目录 tmp + rename）：父目录自动创建，崩溃不留半截缓存
    await writeFileAtomic(resolveBuildCacheFile(dir, projectId), JSON.stringify(snapshot));
  } catch {
    // 见上：静默降级
  }
}
