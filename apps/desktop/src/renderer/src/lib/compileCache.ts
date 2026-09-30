import type { ModNode, ModEdge, NodeGraph } from '@mc-creator/shared';
import type { CompileResult } from './compileNodeGraph.js';

const DB_NAME = 'mc-creator-cache';
const DB_VERSION = 1;
const STORE_NAME = 'compile-cache';
const META_STORE = 'meta';

export interface CacheEntry {
  key: string;
  graphHash: string;
  modId: string;
  result: CompileResult;
  timestamp: number;
  version: number;
}

export interface CacheMeta {
  key: string;
  value: string;
}

/** 计算图的哈希值（用于缓存键） */
export async function computeGraphHash(graph: NodeGraph): Promise<string> {
  // 使用稳定的序列化 + 简单哈希
  const relevant = {
    modId: graph.modId,
    nodes: graph.nodes
      .map((n: ModNode) => ({
        id: n.id,
        kind: n.data.kind,
        data: n.data,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    edges: graph.edges
      .filter((e: ModEdge) => !e.disabled)
      .map((e: ModEdge) => ({
        s: e.source,
        t: e.target,
        sh: e.sourceHandle,
        th: e.targetHandle,
        k: e.kind,
      }))
      .sort((a, b) => `${a.s}:${a.sh}`.localeCompare(`${b.s}:${b.sh}`)),
  };
  const str = JSON.stringify(relevant);
  // 简单的 FNV-1a 哈希
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = (hash * 0x01000193) >>> 0;
  }
  return ('00000000' + (hash >>> 0).toString(16)).slice(-8);
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** 检测是否在浏览器环境且支持 IndexedDB */
function isBrowserEnv(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

/** 简单的内存缓存（Node.js / 测试环境兜底） */
const memoryCache = new Map<string, CacheEntry>();

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    if (!isBrowserEnv()) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
        store.createIndex('modId', 'modId', { unique: false });
        store.createIndex('timestamp', 'timestamp', { unique: false });
      }

      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: 'key' });
      }
    };
  });

  return dbPromise;
}

/** 关闭 IndexedDB 连接（测试/调试用，正常流程由浏览器管理连接生命周期） */
export async function closeDB(): Promise<void> {
  if (dbPromise) {
    const db = await dbPromise;
    db.close();
    dbPromise = null;
  }
}

function getCacheKey(graphHash: string, modId: string): string {
  return `${modId}:${graphHash}`;
}

/** 统一的缓存读取（浏览器用 IndexedDB，Node.js 用内存） */
export async function getCachedCompileResult(
  graphHash: string,
  modId: string,
): Promise<{
  result: CompileResult;
  timestamp: number;
} | null> {
  const key = getCacheKey(graphHash, modId);

  if (isBrowserEnv()) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.get(key);

        request.onsuccess = () => {
          const entry = request.result;
          if (entry) {
            resolve({ result: entry.result, timestamp: entry.timestamp });
          } else {
            resolve(null);
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      // 降级到内存缓存
      const entry = memoryCache.get(key);
      return entry ? { result: entry.result, timestamp: entry.timestamp } : null;
    }
  } else {
    // Node.js 环境：直接读内存缓存
    const entry = memoryCache.get(key);
    return entry ? { result: entry.result, timestamp: entry.timestamp } : null;
  }
}

/** 统一的缓存写入（浏览器用 IndexedDB，Node.js 用内存） */
export async function setCachedCompileResult(
  graphHash: string,
  modId: string,
  result: CompileResult,
  version: number = 1,
): Promise<void> {
  const key = getCacheKey(graphHash, modId);
  const entry: CacheEntry = {
    key,
    graphHash,
    modId,
    result,
    timestamp: Date.now(),
    version,
  };

  if (isBrowserEnv()) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.put(entry);

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch {
      // 降级到内存缓存
      memoryCache.set(key, entry);
    }
  } else {
    // Node.js 环境：直接写内存缓存
    memoryCache.set(key, entry);
  }
}

/** 删除特定 mod 的缓存 */
export async function clearModCache(modId: string): Promise<void> {
  if (isBrowserEnv()) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('modId');
        const request = index.getAllKeys(modId);

        request.onsuccess = () => {
          const keys = request.result;
          const tx2 = db.transaction(STORE_NAME, 'readwrite');
          const store2 = tx2.objectStore(STORE_NAME);
          for (const key of keys) {
            store2.delete(key);
          }
          tx2.oncomplete = () => resolve();
          tx2.onerror = () => reject(tx2.error);
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      // 降级：清理内存缓存中匹配的项
      for (const [key, entry] of memoryCache.entries()) {
        if (entry.modId === modId) memoryCache.delete(key);
      }
    }
  } else {
    // Node.js：清理内存缓存
    for (const [key, entry] of memoryCache.entries()) {
      if (entry.modId === modId) memoryCache.delete(key);
    }
  }
}

/** 清理过期缓存（保留最近 N 条） */
export async function pruneCache(maxEntries: number = 50): Promise<void> {
  if (isBrowserEnv()) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const index = store.index('timestamp');
        const request = index.openCursor(null, 'prev');

        let count = 0;
        request.onsuccess = () => {
          // 经 request.result 直接取游标，无需 event.target 断言
          const cursor: IDBCursorWithValue | null = request.result;
          if (cursor) {
            count++;
            if (count > maxEntries) {
              cursor.delete();
            }
            cursor.continue();
          } else {
            resolve();
          }
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      // 降级：内存缓存按时间排序清理
      const entries = Array.from(memoryCache.entries()).sort(
        (a, b) => b[1].timestamp - a[1].timestamp,
      );
      for (let i = maxEntries; i < entries.length; i++) {
        memoryCache.delete(entries[i][0]);
      }
    }
  } else {
    // Node.js：内存缓存按时间排序清理
    const entries = Array.from(memoryCache.entries()).sort(
      (a, b) => b[1].timestamp - a[1].timestamp,
    );
    for (let i = maxEntries; i < entries.length; i++) {
      memoryCache.delete(entries[i][0]);
    }
  }
}

/** 获取缓存统计信息 */
export async function getCacheStats(): Promise<{ count: number; totalSize: number }> {
  if (isBrowserEnv()) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const store = tx.objectStore(STORE_NAME);
        const request = store.count();

        request.onsuccess = () => {
          resolve({ count: request.result, totalSize: 0 });
        };
        request.onerror = () => reject(request.error);
      });
    } catch {
      return { count: memoryCache.size, totalSize: 0 };
    }
  } else {
    return { count: memoryCache.size, totalSize: 0 };
  }
}

/** 预加载缓存到内存（应用启动时调用） */
export async function preloadCache(): Promise<void> {
  if (isBrowserEnv()) {
    try {
      await openDB();
      await pruneCache(50);
    } catch {
      // 静默失败
    }
  } else {
    // Node.js：预加载时清理过期
    await pruneCache(50);
  }
}

/** 清空所有缓存（调试用） */
export async function clearAllCache(): Promise<void> {
  if (isBrowserEnv()) {
    try {
      const db = await openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();

        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    } catch {
      memoryCache.clear();
    }
  } else {
    memoryCache.clear();
  }
}
