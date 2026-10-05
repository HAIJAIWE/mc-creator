/**
 * Mojang 版本清单运行时拉取（backlog T1a / §0.5#3）。
 *
 * 清单地址与形状对照仓内生成脚本 server-generator.ts:333：
 * - 地址 https://piston-meta.mojang.com/mc/game/version_manifest_v2.json
 * - 形状 { latest: { release, snapshot }, versions: [{ id, type, url, releaseTime }] }
 *
 * 设计约束：
 * - 本包零依赖：只用 node: 内置模块，不 import electron / shared。
 * - transport 用全局 fetch（可注入 fetchImpl），超时 / 重试策略对齐
 *   download.ts：AbortSignal.timeout 默认 10s，仅 5xx / 429 / 网络错误重试，
 *   退避 300ms / 600ms（300 * (attempt + 1)）。
 * - 缓存文件路径由调用方传入 cachePath（如 userData 下 version_manifest.json），
 *   TTL 默认 24h 可覆盖；网络成功后原子写（tmp + rename，download.ts 同款）。
 * - fallbackIds 由调用方传入（即 @mc-creator/shared 的 MC_VERSIONS，kernel 侧传），
 *   本模块只收 string[]。
 *
 * 降级链（绝不抛裸异常，全程用 source 标注，调用方据此提示用户）：
 *   新鲜缓存（source:'cache'）→ 网络（source:'network'，成功写缓存）
 *   → 过期/任意缓存（source:'cache'）→ fallback（source:'fallback'）
 * 网络 200 但形状校验失败（versions 非数组 / 有项缺 string id / 空表）视为损坏，走下一级。
 */

import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

/** Mojang 版本清单地址（与 server-generator.ts:333 同一地址）。 */
export const VERSION_MANIFEST_URL =
  'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_RETRIES = 2;

export type ManifestSource = 'network' | 'cache' | 'fallback';

export interface ManifestEntry {
  id: string;
  /** 原样保留：release / snapshot / old_beta 等，调用方自行过滤；缺失时为 'unknown'。 */
  type: string;
}

export interface VersionManifestResult {
  ids: string[];
  entries: ManifestEntry[];
  latestRelease: string | null;
  source: ManifestSource;
}

export interface FetchVersionManifestOptions {
  /** 缓存文件路径（如 userData 下 version_manifest.json）；不传则不用缓存。 */
  cachePath?: string;
  /** 缓存有效期毫秒数，默认 24h。 */
  ttlMs?: number;
  /** 调用方传入的兜底版本 id 列表（即 shared 的 MC_VERSIONS），本模块只收 string[]。 */
  fallbackIds: string[];
  /** 可注入 fetch（测试用），默认全局 fetch。 */
  fetchImpl?: typeof fetch;
  /** 单次尝试超时毫秒数，默认 10000（对齐 download.ts）。 */
  timeoutMs?: number;
  /** 失败后重试次数（不含首次），默认 2。仅 5xx / 429 / 网络错误重试。 */
  retries?: number;
}

/** 仅 5xx / 429 可重试（对齐 download.ts：4xx 直接走下一级，不重试）。 */
function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface ParsedManifest {
  entries: ManifestEntry[];
  latestRelease: string | null;
}

/** 最小形状校验：versions 为非空数组且每项有非空 string id，否则返回 null（视为损坏）。 */
function parseManifestText(text: string): ParsedManifest | null {
  let json: unknown;
  try {
    json = JSON.parse(text) as unknown;
  } catch {
    return null;
  }
  if (typeof json !== 'object' || json === null) return null;
  const versions = (json as { versions?: unknown }).versions;
  if (!Array.isArray(versions) || versions.length === 0) return null;
  const entries: ManifestEntry[] = [];
  for (const v of versions) {
    if (typeof v !== 'object' || v === null) return null;
    const rec = v as Record<string, unknown>;
    if (typeof rec['id'] !== 'string' || rec['id'].length === 0) return null;
    entries.push({
      id: rec['id'],
      type: typeof rec['type'] === 'string' ? rec['type'] : 'unknown',
    });
  }
  let latestRelease: string | null = null;
  const latest = (json as { latest?: unknown }).latest;
  if (typeof latest === 'object' && latest !== null) {
    const release = (latest as Record<string, unknown>)['release'];
    if (typeof release === 'string' && release.length > 0) latestRelease = release;
  }
  return { entries, latestRelease };
}

/** 网络拉取清单原文；全部尝试失败 / 不可重试 / 形状无关（只管取文本）时返回 null。 */
async function fetchNetworkText(
  fetchImpl: typeof fetch,
  timeoutMs: number,
  retries: number,
): Promise<string | null> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchImpl(VERSION_MANIFEST_URL, {
        redirect: 'follow',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (isRetryableStatus(res.status)) {
        if (attempt < retries) await sleep(300 * (attempt + 1));
        continue;
      }
      if (!res.ok) return null; // 4xx 等：不可重试，直接走下一级
      return await res.text();
    } catch {
      // 网络错误 / 超时：可重试
      if (attempt < retries) await sleep(300 * (attempt + 1));
    }
  }
  return null;
}

/** 原子写缓存（tmp + rename，download.ts 同款）；写失败吞掉（网络结果已可用），绝不抛。 */
async function writeCacheAtomic(cachePath: string, text: string): Promise<void> {
  const tmp = `${cachePath}.tmp`;
  try {
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, cachePath);
  } catch {
    await rm(tmp, { force: true }).catch(() => undefined);
  }
}

async function readCache(cachePath: string): Promise<ParsedManifest | null> {
  try {
    return parseManifestText(await readFile(cachePath, 'utf8'));
  } catch {
    return null;
  }
}

function fallbackResult(fallbackIds: unknown): VersionManifestResult {
  const ids = Array.isArray(fallbackIds)
    ? fallbackIds.filter((v): v is string => typeof v === 'string')
    : [];
  return {
    ids: [...ids],
    entries: ids.map((id) => ({ id, type: 'release' })),
    latestRelease: ids.length > 0 ? (ids[0] as string) : null,
    source: 'fallback',
  };
}

/**
 * 拉取 Mojang 版本清单。绝不抛裸异常：网络 / 缓存 / 解析任一环节失败都逐级降级，
 * 最差返回 { source: 'fallback', ids: fallbackIds }。
 */
export async function fetchVersionManifest(
  opts: FetchVersionManifestOptions,
): Promise<VersionManifestResult> {
  try {
    const cachePath = opts.cachePath;
    const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
    const fetchImpl = opts.fetchImpl ?? fetch;
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = opts.retries ?? DEFAULT_RETRIES;

    // 1. 新鲜缓存：有效期内直接读，不碰网络。
    if (cachePath) {
      try {
        const st = await stat(cachePath);
        if (Date.now() - st.mtimeMs <= ttlMs) {
          const hit = await readCache(cachePath);
          if (hit) {
            return {
              ids: hit.entries.map((e) => e.id),
              entries: hit.entries,
              latestRelease: hit.latestRelease,
              source: 'cache',
            };
          }
        }
      } catch {
        // 无缓存 / 损坏 / 过期 → 走网络
      }
    }

    // 2. 网络：成功且形状合法则写缓存并返回。
    const text = await fetchNetworkText(fetchImpl, timeoutMs, retries);
    if (text !== null) {
      const parsed = parseManifestText(text);
      if (parsed) {
        if (cachePath) await writeCacheAtomic(cachePath, text);
        return {
          ids: parsed.entries.map((e) => e.id),
          entries: parsed.entries,
          latestRelease: parsed.latestRelease,
          source: 'network',
        };
      }
      // 200 但形状非法 → 视为损坏，走下一级（过期缓存）
    }

    // 3. 网络失败：读缓存（不限 TTL，过期缓存也比没有强）。
    if (cachePath) {
      const stale = await readCache(cachePath);
      if (stale) {
        return {
          ids: stale.entries.map((e) => e.id),
          entries: stale.entries,
          latestRelease: stale.latestRelease,
          source: 'cache',
        };
      }
    }

    // 4. 缓存也没有 / 损坏 → fallback。
    return fallbackResult(opts.fallbackIds);
  } catch {
    return fallbackResult(opts.fallbackIds);
  }
}
