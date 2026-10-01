/**
 * 增量构建缓存（对标 MCreator BuildCache）。
 *
 * 核心思路：把 ModSpec 按类别拆分（items / blocks / recipes / events / ...），
 * 每个类别独立计算内容哈希。下次构建时：
 * - 类别哈希相同 → 复用缓存的 FileNode，跳过该类别的代码生成
 * - 类别哈希不同 → 重新生成，更新缓存
 *
 * 与 MCreator 的差异：
 * - MCreator 每个 mod element 是独立 .java 文件，可单元素增量
 * - 本项目是聚合式（ModItems.java 含所有 items），故采用"类别级增量"
 *   改一个 item 只重新生成 ModItems.java，不影响 ModBlocks/ModEvents 等
 *
 * 缓存键 = `${modId}::${loader}::${category}`，全局唯一。
 */

import type { FileNode } from '@mc-creator/shared';

// === 哈希函数 ===

/**
 * FNV-1a 32 位哈希（无依赖、稳定、够快）。
 * 用于计算 mod 元素的内容指纹。
 */
function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * 计算任意值的稳定哈希。
 *
 * 通过 JSON.stringify(value, replacer) 保证键顺序稳定（replacer 对对象的 key 排序），
 * 再叠加 FNV-1a 生成 8 位十六进制指纹。
 *
 * 注意：undefined / function / symbol 会被 JSON 丢弃，不应作为哈希输入。
 */
export function hashContent(value: unknown): string {
  const json = stableStringify(value);
  return fnv1a(json);
}

/**
 * 稳定 JSON 序列化：对象 key 按字典序排序，保证 {a:1,b:2} 与 {b:2,a:1} 产出相同字符串。
 * 数组顺序保持不变（数组顺序是有意义的信息）。
 *
 * undefined 处理：等同于 null（JSON 语义中 undefined 表示"不存在"，与 null 产出相同哈希）。
 * 这样即使 spec 未经完整 zod parse（某些可选字段缺失为 undefined），哈希仍稳定。
 */
function stableStringify(value: unknown, seen = new WeakSet()): string {
  if (value === undefined) return JSON.stringify(null);
  if (value === null || typeof value !== 'object') {
    // P2 dogfood：NaN/Infinity 处理（JSON.stringify(NaN) = "null"，与 null 碰撞）
    if (typeof value === 'number' && !Number.isFinite(value)) {
      return JSON.stringify(null);
    }
    return JSON.stringify(value);
  }
  // P2 dogfood：Date 对象确定性序列化
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  // P2 dogfood：RegExp 对象确定性序列化
  if (value instanceof RegExp) return JSON.stringify(`/${value.source}/${value.flags}`);
  // P2 dogfood：循环引用检测（防止栈溢出）
  if (seen.has(value)) throw new Error('stableStringify: circular reference detected');
  seen.add(value);

  if (Array.isArray(value)) {
    const result = '[' + value.map((v) => stableStringify(v, seen)).join(',') + ']';
    seen.delete(value);
    return result;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map((k) => {
    const v = (value as Record<string, unknown>)[k];
    // 跳过 undefined（JSON 语义：对象中 undefined 字段被忽略）
    if (v === undefined) return null;
    return JSON.stringify(k) + ':' + stableStringify(v, seen);
  });
  seen.delete(value);
  return '{' + pairs.filter((p) => p !== null).join(',') + '}';
}

/**
 * 计算一个"类别"的聚合哈希。
 *
 * 类别 = 一组相关 mod 元素（如所有 items、所有 blocks）。
 * 聚合哈希 = 对每个元素哈希后，再对哈希列表整体哈希。
 *
 * 这样：
 * - 元素顺序变化 → 哈希变化（数组顺序有意义）
 * - 单个元素内容变化 → 哈希变化
 * - 元素未变 → 哈希稳定
 */
export function hashCategory(elements: unknown[]): string {
  if (elements.length === 0) return 'empty';
  const hashes = elements.map((e) => hashContent(e));
  return fnv1a(hashes.join('|'));
}

// === 缓存条目 ===

/** 单个类别对应的缓存条目 */
export interface CacheEntry {
  /** 该类别上次构建时的聚合哈希 */
  hash: string;
  /** 该类别上次构建产出的文件（FileNode 数组，一个类别可能产出多文件如 itemModels） */
  files: FileNode[];
}

/** 缓存键 = `${modId}::${loader}::${category}` */
type CacheKey = string;

/** 构建统计：增量构建的命中情况 */
export interface BuildStats {
  /** 总类别数 */
  total: number;
  /** 命中缓存（哈希相同，复用）的类别数 */
  cached: number;
  /** 重新生成的类别数 */
  regenerated: number;
  /** 产物文件总数 */
  filesTotal: number;
  /** 产物中与上次内容相同的文件数（文件级增量，用于磁盘写入优化） */
  filesUnchanged: number;
}

/** 增量构建结果 */
export interface IncrementalResult<F = FileNode> {
  files: F[];
  stats: BuildStats;
  /** 本次构建后的缓存快照（可持久化，下次构建传入） */
  cacheSnapshot: BuildCacheSnapshot;
}

/** 可序列化的缓存快照（用于持久化到磁盘） */
export type BuildCacheSnapshot = Record<CacheKey, CacheEntry>;

// === BuildCache 类 ===

/**
 * 构建缓存实例。
 *
 * 生命周期：
 * 1. 首次构建：load({}) → translateWithCache → snapshot 持久化
 * 2. 后续构建：load(prevSnapshot) → translateWithCache → snapshot 更新持久化
 *
 * 线程安全：非线程安全，单实例单线程使用。
 */
export class BuildCache {
  private entries = new Map<CacheKey, CacheEntry>();

  /** 从持久化快照加载缓存 */
  load(snapshot: BuildCacheSnapshot | undefined): void {
    this.entries.clear();
    if (!snapshot) return;
    for (const [key, entry] of Object.entries(snapshot)) {
      this.entries.set(key, {
        hash: entry.hash,
        files: entry.files.map((f) => ({ path: f.path, content: f.content })),
      });
    }
  }

  /** 导出当前缓存为可序列化快照 */
  snapshot(): BuildCacheSnapshot {
    const result: BuildCacheSnapshot = {};
    for (const [key, entry] of this.entries) {
      result[key] = {
        hash: entry.hash,
        files: entry.files.map((f) => ({ path: f.path, content: f.content })),
      };
    }
    return result;
  }

  /** 构造缓存键。P1 dogfood 修复：校验空参数 + 防分隔符碰撞 */
  static buildKey(modId: string, loader: string, category: string): CacheKey {
    if (!modId || !loader || !category) {
      throw new Error(
        `BuildCache.buildKey: all parts must be non-empty (modId=${JSON.stringify(modId)}, loader=${JSON.stringify(loader)}, category=${JSON.stringify(category)})`,
      );
    }
    // 使用 \0 分隔——Java/JS 标识符中不会出现 null 字符，避免 :: 分隔符碰撞
    return `${modId}\0${loader}\0${category}`;
  }

  /**
   * 查询缓存：若哈希相同则返回缓存的文件，否则返回 undefined。
   *
   * P1 dogfood 修复：返回防御性深拷贝，避免调用方变异腐蚀缓存内部状态。
   *
   * @param key 缓存键（modId\0loader\0category）
   * @param currentHash 当前类别的内容哈希
   * @returns 命中时返回 FileNode[]，未命中或无缓存返回 undefined
   */
  getCached(key: CacheKey, currentHash: string): FileNode[] | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.hash !== currentHash) return undefined;
    // 防御性深拷贝：避免调用方变异腐蚀缓存内部状态
    return entry.files.map((f) => ({ path: f.path, content: f.content }));
  }

  /** 更新缓存条目 */
  setCache(key: CacheKey, hash: string, files: FileNode[]): void {
    this.entries.set(key, {
      hash,
      files: files.map((f) => ({ path: f.path, content: f.content })),
    });
  }

  /** 清空所有缓存 */
  clear(): void {
    this.entries.clear();
  }

  /** 当前缓存条目数（用于测试与调试） */
  get size(): number {
    return this.entries.size;
  }

  /** 判断某缓存键是否存在（不论哈希是否匹配） */
  has(key: CacheKey): boolean {
    return this.entries.has(key);
  }
}
