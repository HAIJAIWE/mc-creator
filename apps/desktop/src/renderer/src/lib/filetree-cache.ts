import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/** 缓存条目 */
export interface FileTreeCacheEntry {
  projectId: string;
  rootPath: string;
  tree: TreeNode[];
  timestamp: number;
  version: number;
}

/** 树节点类型（与 FileManager.TreeNode 对齐） */
export interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  children?: TreeNode[];
}

/** 缓存数据库 schema */
interface FileTreeCacheDB extends DBSchema {
  filetree: {
    key: string; // `filetree:<projectId>:<rootPath>`
    value: FileTreeCacheEntry;
    indexes: { 'by-project': string; 'by-timestamp': number };
  };
}

const DB_NAME = 'mc-creator-filetree-cache';
const DB_VERSION = 1;
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 天
const CACHE_KEY_PREFIX = 'filetree:';

let dbPromise: Promise<IDBPDatabase<FileTreeCacheDB>> | null = null;

/** 获取数据库实例（单例） */
function getDB(): Promise<IDBPDatabase<FileTreeCacheDB>> {
  if (!dbPromise) {
    dbPromise = openDB<FileTreeCacheDB>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('filetree', { keyPath: 'key' });
        store.createIndex('by-project', 'projectId');
        store.createIndex('by-timestamp', 'timestamp');
      },
    });
  }
  return dbPromise;
}

/** 生成缓存 key */
export function getCacheKey(projectId: string, rootPath: string): string {
  const normalizedPath = rootPath === '' ? 'root' : rootPath.replace(/\//g, ':');
  return `${CACHE_KEY_PREFIX}${projectId}:${normalizedPath}`;
}

/** 读取缓存 */
export async function getFileTreeCache(
  projectId: string,
  rootPath: string,
): Promise<TreeNode[] | null> {
  const db = await getDB();
  const key = getCacheKey(projectId, rootPath);
  const entry = await db.get('filetree', key);

  if (!entry) return null;

  // 检查过期
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    await db.delete('filetree', key);
    return null;
  }

  return entry.tree;
}

/** 写入缓存 */
export async function setFileTreeCache(
  projectId: string,
  rootPath: string,
  tree: TreeNode[],
): Promise<void> {
  const db = await getDB();
  const key = getCacheKey(projectId, rootPath);
  const entry = {
    key,
    projectId,
    rootPath,
    tree,
    timestamp: Date.now(),
    version: 1,
  };
  await db.put('filetree', entry);
}

/** 失效指定项目的所有缓存 */
export async function invalidateProjectCache(projectId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction('filetree', 'readwrite');
  const index = tx.store.index('by-project');
  let cursor = await index.openCursor(projectId);
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** 失效指定路径的缓存（及其父路径） */
export async function invalidatePathCache(projectId: string, rootPath: string): Promise<void> {
  const db = await getDB();
  const key = getCacheKey(projectId, rootPath);
  await db.delete('filetree', key);

  // 同时失效父路径缓存（因为子树变了，父树也过期了）
  if (rootPath !== '') {
    const parts = rootPath.split('/');
    for (let i = parts.length - 1; i >= 0; i--) {
      const parentPath = parts.slice(0, i + 1).join('/');
      const parentKey = getCacheKey(projectId, parentPath);
      await db.delete('filetree', parentKey);
    }
    // 根目录
    await db.delete('filetree', getCacheKey(projectId, ''));
  }
}

/** 清理过期缓存 */
export async function cleanupExpiredCache(): Promise<void> {
  const db = await getDB();
  const cutoff = Date.now() - CACHE_TTL_MS;
  const tx = db.transaction('filetree', 'readwrite');
  const index = tx.store.index('by-timestamp');
  let cursor = await index.openCursor(IDBKeyRange.upperBound(cutoff));
  while (cursor) {
    await cursor.delete();
    cursor = await cursor.continue();
  }
  await tx.done;
}

/** 获取缓存统计信息（用于调试） */
export async function getCacheStats(): Promise<{ count: number; oldestEntry: number | null }> {
  const db = await getDB();
  const count = await db.count('filetree');
  const cursor = await db.transaction('filetree').store.index('by-timestamp').openCursor();
  const oldestEntry = cursor ? cursor.value.timestamp : null;
  return { count, oldestEntry };
}
