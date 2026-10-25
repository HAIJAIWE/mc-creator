/**
 * 智能体生产宿主入口（阶段 7 补齐；设计文档 §10.1）。
 *
 * 背景：
 * - `mcp-server.ts` 的 `createMcpServer(opts)` 只是方法分发核心（stdio 本地工具），
 *   只有测试调用，无生产宿主；
 * - `mcp-http.ts` 的 `serveHttp(...)` 是 Streamable HTTP 生产传输，文件头明确写
 *   “本轮不写该入口脚本，避免 import 时意外监听端口”，且 `index.ts` 根本没导出它；
 * - §10.1 要求：智能体跑在独立进程，长任务不随窗口关闭终止；传输
 *   Streamable HTTP 走生产 / stdio 走本地工具。
 *
 * 本模块补上这个缺口：导出 `startStdio(opts)` 与 `startHttp(opts)` 两个显式函数。
 *
 * 自启动纪律（与两传输层一致）：**import 无副作用，绝不自启动**。
 * 本模块无任何顶层副作用（不监听端口、不读写流、不设定时器），只导出符号。
 * 生产常驻进程由外壳显式拉起，例如：
 * `node --input-type=module -e "import('@mc-creator/agent').then(m => m.main(['--http']))"`。
 * 因此本模块也不设 `invokedAsMain` 自启分支 —— 自启即副作用。
 */

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createMcpServer, serveStdio } from './mcp-server.js';
import type { McpServerOptions } from './mcp-server.js';
import { serveHttp } from './mcp-http.js';
import type { RunningHttpServer, ServeHttpOptions } from './mcp-http.js';

/** dataDir 缺失时的回退子目录名（os.tmpdir() 下）。 */
export const HOST_FALLBACK_DIR_NAME = 'mc-creator-agent';

/**
 * 解析数据目录：显式给的直接用，没给的回退到 os.tmpdir() 下子目录。
 * 两种情况都确保目录存在（mkdirSync recursive，无则建，有则空操作）。
 */
export function resolveHostDataDir(opts: { dataDir?: string } = {}): string {
  const dir = opts.dataDir ?? join(tmpdir(), HOST_FALLBACK_DIR_NAME);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** McpServerOptions + 可选顶层 dataDir（缺失时回退，见 resolveHostDataDir）。 */
export interface HostOptions extends McpServerOptions {
  dataDir?: string;
}

/** startStdio 入参：宿主装配 + 可注入的 stdio 流（默认接进程标准输入输出）。 */
export interface StartStdioOptions extends HostOptions {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

/**
 * startHttp 入参：宿主装配 + serveHttp 全透传（port/host/path/listener/
 * validateOrigin/authorize/now/newSessionId/sessionTtlMs/maxBodyBytes/
 * heartbeatMs/requireAccept/acceptChecker/sessionStorePath/sweepMs）。
 * 其中 `server`（McpServer 句柄）由本模块内部装配，不由调用方传入。
 */
export type StartHttpOptions = HostOptions & Omit<ServeHttpOptions, 'server'>;

/** 顶层 dataDir 回填到三内核各自的 KernelContext（显式给的内核级 dataDir 优先）。 */
function serverOptionsOf(opts: HostOptions, dataDir: string): McpServerOptions {
  return {
    java: { ...(opts.java ?? {}), dataDir: opts.java?.dataDir ?? dataDir },
    server: { ...(opts.server ?? {}), dataDir: opts.server?.dataDir ?? dataDir },
    bedrock: { ...(opts.bedrock ?? {}), dataDir: opts.bedrock?.dataDir ?? dataDir },
  };
}

/**
 * 启动 stdio 本地工具通道：createMcpServer 装配 → serveStdio 接流。
 * streams 可注入内存流做测试；默认接进程标准输入输出。
 */
export function startStdio(opts: StartStdioOptions = {}): Promise<void> {
  const { input, output, ...rest } = opts;
  const dataDir = resolveHostDataDir(rest);
  const server = createMcpServer(serverOptionsOf(rest, dataDir));
  return serveStdio(server, input ?? process.stdin, output ?? process.stdout);
}

/**
 * 启动 Streamable HTTP 生产传输：createMcpServer 装配 → serveHttp 监听。
 * 测试用注入 `listener`（HttpHostPort fake）即不开真实端口，只走编排分支。
 * 会话存档默认落在 `<dataDir>/mcp-sessions.json`（跨重启持久化，§10.1 生产需要）；
 * 显式传 sessionStorePath 则优先显式值。
 */
export function startHttp(opts: StartHttpOptions = {}): Promise<RunningHttpServer> {
  const { dataDir, java, server: serverCtx, bedrock, sessionStorePath, ...rest } = opts;
  const hostOpts: HostOptions = {};
  if (java !== undefined) hostOpts.java = java;
  if (serverCtx !== undefined) hostOpts.server = serverCtx;
  if (bedrock !== undefined) hostOpts.bedrock = bedrock;
  if (dataDir !== undefined) hostOpts.dataDir = dataDir;
  const resolved = resolveHostDataDir(hostOpts);
  const server = createMcpServer(serverOptionsOf(hostOpts, resolved));
  return serveHttp({
    ...rest,
    server,
    sessionStorePath: sessionStorePath ?? join(resolved, 'mcp-sessions.json'),
  });
}

/**
 * 生产拉起入口（显式调用，不自启）：
 * - 默认（无 `--http`）：stdio 通道，`await main([])` 即 `await startStdio({})`；
 * - `--http [--port N] [--host H] [--path P] [--data-dir D]`：Streamable HTTP。
 * 由 `node --input-type=module -e` 显式调用，不要加新 cli 文件。
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  if (!argv.includes('--http')) {
    const di = argv.indexOf('--data-dir');
    const rawDir = di >= 0 ? argv[di + 1] : undefined;
    if (rawDir === undefined) {
      await startStdio({});
    } else {
      await startStdio({ dataDir: rawDir });
    }
    return;
  }
  const portAt = argv.indexOf('--port');
  const portRaw = portAt >= 0 ? argv[portAt + 1] : undefined;
  const parsed = portRaw === undefined ? 3001 : Number(portRaw);
  const hostAt = argv.indexOf('--host');
  const hostRaw = hostAt >= 0 ? argv[hostAt + 1] : undefined;
  const pathAt = argv.indexOf('--path');
  const pathRaw = pathAt >= 0 ? argv[pathAt + 1] : undefined;
  const dirAt = argv.indexOf('--data-dir');
  const dirRaw = dirAt >= 0 ? argv[dirAt + 1] : undefined;
  const httpOpts: StartHttpOptions = { port: Number.isFinite(parsed) ? parsed : 3001 };
  if (hostRaw !== undefined) httpOpts.host = hostRaw;
  if (pathRaw !== undefined) httpOpts.path = pathRaw;
  if (dirRaw !== undefined) httpOpts.dataDir = dirRaw;
  const running = await startHttp(httpOpts);
  process.stderr.write(`[host] Streamable HTTP listening on ${running.url}\n`);
}
