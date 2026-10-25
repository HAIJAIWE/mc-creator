/**
 * Electron 侧的「走系统代理」取数实现。
 *
 * 为什么用 Chromium 网络栈而不是 Node 的 fetch：
 * - Node 的 `fetch`（undici）**不认 Windows 的系统代理设置**，直连被墙的站点
 *   只会 connect timeout（实测 `maven.neoforged.net` 就是如此）；
 * - `electron.net.fetch` 走 Chromium 的网络栈，**默认继承系统代理/PAC 设置**，
 *   正是桌面应用该有的行为。
 *
 * 注意：它要求 app 已经 ready（否则抛错），所以只在需要时惰性调用。
 */
import { net } from 'electron';

/** Electron `net.fetch` 的类型与 DOM 的 `fetch` 不完全一致，这里收口成 `typeof fetch`。 */
export const electronNetFetch: typeof fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  return net.fetch(input as string, init as never) as unknown as Promise<Response>;
}) as typeof fetch;
