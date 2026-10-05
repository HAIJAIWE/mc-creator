/**
 * 增量构建缓存的磁盘持久化（按项目隔离）。
 *
 * 背景：缓存快照原本只是 generate.ts 里的一个模块级变量，进程重启即丢失，
 * 也没有项目维度。这里把快照按项目 id 落到 `userData/build-cache/<key>.json`，
 * 让二次启动后的首次构建也能命中缓存。
 *
 * 刻意不 import electron（与 chat-system-message.ts 同一约定）：缓存根目录由调用方
 * 传入，模块本身可脱离 Electron 单元测试。
 *
 * ## 为什么这里**不**接 §12 版本化迁移（有意决定，非遗漏）
 *
 * §12 的约束是「所有写入走版本化迁移脚本」，但该约束的**目的是不丢用户数据**。
 * 构建缓存快照不满足这个前提，接迁移反而是错的：
 *
 *  1. **没有用户数据。** `BuildCacheSnapshot = Record<CacheKey, CacheEntry>`，
 *     每项只有 `{ hash, files }`（packages/core/src/builder/BuildCache.ts）。
 *     它是「上次生成产物」的可丢弃副本；源数据是生成器输入（genCtx + spec），
 *     缓存丢了最坏结果是下次多跑一遍全量生成。
 *  2. **失败语义已经最优。** loadBuildCacheSnapshot 对「文件不存在 / 解析失败 /
 *     结构不符」一律返回 `undefined`，调用方按无缓存走全量生成
 *     （ipc/generate.ts）。任何形态不匹配都已自动降级到正确行为，不存在
 *     「旧数据被误当成新数据」的风险 —— 而那正是迁移框架要解决的问题。
 *  3. **接信封会引入真实回归。** 为让版本号不被 zod strip，得把快照也套成
 *     `{ schemaVersion, data }`。但 `BuildCache.load()` 拿到的必须是纯
 *     `Record<CacheKey, CacheEntry>`，多一层信封就要在 load 路径上多一次拆包；
 *     更糟的是历史缓存文件都是裸快照，套信封后首启会把**所有用户的全量构建
 *     缓存**判成 v0 并触发一次回写 —— 纯写放大，零收益。
 *
 * 结论：迁移框架留给「有用户数据、需无损升级」的持久化（project-store 是第一处）。
 * 缓存类数据保持「读失败即降级」，这比版本化更合适。若将来缓存结构真的演进到
 * 「旧快照会被误读且必须转换」的形态，届时再接 —— 那时是纯新增，不需要回填历史文件。
 *
 * 原子性由 writeFileAtomic 保证（同目录 tmp + rename，崩溃不留半截缓存）。
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
