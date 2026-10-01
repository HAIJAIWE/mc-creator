import type { ModNode, ModEdge, NodeGraph } from '@mc-creator/shared';
import type { CompileResult } from './compileNodeGraph.js';

const DB_NAME = 'mc-creator-cache';
const DB_VERSION = 1;
const STORE_NAME = 'compile-cache';

interface CacheEntry {
  key: string;
  graphHash: string;
  result: CompileResult;
  timestamp: number;
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
        db.createObjectStore(STORE_NAME, { keyPath: 'key' });
      }
    };
  });

  return dbPromise;
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
): Promise<void> {
  const key = getCacheKey(graphHash, modId);
  const entry: CacheEntry = {
    key,
    graphHash,
    result,
    timestamp: Date.now(),
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
