/**
 * 下载用的 fetch：**直连优先，连接层失败再走系统代理**。
 *
 * ## 为什么要两条路
 *
 * 实测（2026-10-22，本机）：同一台机器上
 * - `maven.fabricmc.net` / `api.modrinth.com` / `piston-data.mojang.com` 直连正常；
 * - `maven.neoforged.net` **直连 connect timeout**（`UND_ERR_CONNECT_TIMEOUT`），
 *   而 Windows 系统代理（`127.0.0.1:9999`）能通。
 *
 * 直连失败的表现是「装 NeoForge 永远失败」，报错还很难懂：
 * `fetch failed（已尝试 BMCLAPI 镜像 → 官方源）`。
 *
 * 所以这里不改成「一律走代理」——那会让本来能直连的源也依赖代理是否在跑；
 * 而是**先直连，只有网络层失败才换 Chromium 网络栈（它认系统代理）再试一次**。
 * 两条路都失败时，抛的是直连那条的原始错误（更贴近「这台机器连不上」）。
 *
 * ## 为什么要单独一个文件
 *
 * 这一层不依赖 Electron，可以直接单测；Electron 那半边在
 * `electron-proxy-fetch.ts` 里。
 */

/** 连接层失败的判定：这些错误换一条网络路径再试是有意义的。 */
function isConnectLevelError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const code = (e as { cause?: { code?: string } }).cause?.code;
  if (typeof code === 'string') {
    // undici 的连接层错误码
    return (
      code === 'UND_ERR_CONNECT_TIMEOUT' ||
      code === 'UND_ERR_SOCKET' ||
      code === 'UND_ERR_HEADERS_TIMEOUT' ||
      code === 'ECONNRESET' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'EAI_AGAIN' ||
      code === 'EPIPE'
    );
  }
  // 没有 cause.code 时按消息兜底（undici 的 "fetch failed" 就是这一类）
  return /fetch failed|network|socket|ECONN|ENOTFOUND|timed? ?out/i.test(e.message);
}

/** 取消类错误：必须原样抛出去，不能换路重试。 */
function isAbortLike(e: unknown): boolean {
  if (e instanceof Error && e.name === 'AbortError') return true;
  return (e as { name?: string } | null)?.name === 'AbortError';
}

export interface ResilientFetchDeps {
  /** 直连：Node 的全局 fetch。 */
  direct: typeof fetch;
  /** 走系统代理：Electron 的 `net.fetch`（Chromium 网络栈）。 */
  viaProxy: typeof fetch;
}

/**
 * 造一个「直连优先、失败再走代理」的 fetch。
 *
 * 语义刻意收窄：
 * - HTTP 状态码错误（404/403/5xx）**不**换路 —— 那是源的问题，换源才对；
 * - 只有网络层失败才换路；
 * - 取消（AbortSignal）立刻抛出，绝不重试。
 */
export function createResilientFetch(deps: ResilientFetchDeps): typeof fetch {
  const impl = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const signal = init?.signal ?? null;
    try {
      return await deps.direct(input, init);
    } catch (e) {
      if (isAbortLike(e)) throw e;
      if (signal?.aborted) throw e;
      if (!isConnectLevelError(e)) throw e;
      try {
        return await deps.viaProxy(input, init);
      } catch (e2) {
        if (isAbortLike(e2)) throw e2;
        // 报直连那条的原始错误：它更贴近「这台机器连不上这个站」
        const directMsg = e instanceof Error ? e.message : String(e);
        const proxyMsg = e2 instanceof Error ? e2.message : String(e2);
        throw new Error(`${directMsg}；走系统代理重试也失败：${proxyMsg}`);
      }
    }
  };
  return impl as typeof fetch;
}
