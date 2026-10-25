/**
 * §5.8 账户：Authorization Code + PKCE 的 **loopback 回调服务器**。
 *
 * ## 为什么单独一个模块
 *
 * PKCE 的「回调」这一步是**唯一**有本地 IO 的部分：需要起一个只监听
 * loopback 的 HTTP 服务器，等微软把浏览器重定向回来。其余部分都是纯网络请求
 * （可注入 fetch 测试）。把它隔离出来，主流程就能在测试里用替身，
 * 只有这一个模块需要真的 listen。
 *
 * ## 三个必须做对的细节（否则线上会踩）
 *
 * 1. **绑 127.0.0.1，不绑 0.0.0.0**。
 *    绑 0.0.0.0 会让 Windows 防火墙弹「是否允许此应用通过防火墙」——
 *    而本服务器**根本不需要**被外网访问。绑 127.0.0.1 不触发该弹窗
 *    （loopback 不受入站防火墙规则约束），也没有暴露面。
 *
 * 2. **监听端口用 0（让 OS 分配）**。
 *    固定端口会与其他应用抢（抢不到就登录失败）；端口 0 保证**永不冲突**。
 *    Azure 的 public client 登记 `http://localhost` 时按 RFC 8252 §7.3
 *    接受**任意端口**，所以动态端口不违反 redirect URI 匹配。
 *
 * 3. **绑 127.0.0.1 但对外声明 `http://localhost:<port>`**。
 *    Azure 登记的 redirect URI 是 `http://localhost`（不是 IP 形式），
 *    声明 IP 形式会导致 redirect_uri 不匹配。声明 `localhost` 而实际只绑
 *    IPv4 loopback 是 MSAL 在桌面端的做法：浏览器对 `localhost` 的
 *    IPv4/IPv6 回退（Happy Eyeballs）会落到 127.0.0.1 上。
 *
 * ## fail-closed
 *
 * 服务器只接受 `GET /callback`；其他路径/方法 → 404 / 405，不解析、不记录查询串
 * （查询串里就是授权码）。`waitForCallback` 超时 → 拒绝并关服务器，
 * 绝不「一直等着」。
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { CALLBACK_PATH } from './ms-oauth.js';

export interface AuthCallback {
  /** 授权码（成功时）。 */
  readonly code: string | null;
  /** 回传的 state（由调用方校验）。 */
  readonly state: string | null;
  /** 微软回传的 OAuth error（如 access_denied / invalid_scope）。 */
  readonly error: string | null;
  readonly errorDescription: string | null;
}

export interface LoopbackAuthServer {
  /** 拿去当 redirect_uri 的完整地址。 */
  readonly redirectUri: string;
  /** 等一次回调；超时抛错。只能成功 resolve 一次。 */
  waitForCallback(timeoutMs: number): Promise<AuthCallback>;
  /** 关掉监听（幂等）。 */
  close(): Promise<void>;
}

export class LoopbackTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`等待浏览器回调超时（${timeoutMs}ms）`);
    this.name = 'LoopbackTimeoutError';
  }
}

/** 单次回调的 HTML 响应。刻意极简：不加载任何外部资源。 */
function successPage(): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>登录完成</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem">
<h2>登录完成</h2><p>可以关闭此页面，返回 MC 创作器。</p></body></html>`;
}

function failurePage(reason: string): string {
  // reason 由本模块自己生成（不含授权码），不是外部输入。
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>登录失败</title></head>
<body style="font-family:system-ui,sans-serif;text-align:center;padding:3rem">
<h2>登录失败</h2><p>${reason}</p></body></html>`;
}

/**
 * 请求路由（**纯函数，不碰 socket**）。
 *
 * 单独抽出来的理由：把「只接受 GET /callback、只消费一次、不记录查询串」
 * 这三条不变量变成可以直接单测的函数 —— 测试用假的 req/res 调用它，
 * **不需要真的 listen、也不发任何 HTTP 请求**。
 */
export interface CallbackRequestLike {
  readonly method?: string | undefined;
  readonly url?: string | undefined;
}
export interface CallbackResponseLike {
  writeHead(status: number, headers?: Record<string, string>): CallbackResponseLike;
  end(body?: string): void;
}

export function parseCallbackRequest(
  req: CallbackRequestLike,
  path: string,
  host: string,
): AuthCallback | 'not_found' | 'method_not_allowed' {
  if (req.method !== 'GET') return 'method_not_allowed';
  let parsed: URL;
  try {
    parsed = new URL(req.url ?? '/', `http://${host}`);
  } catch {
    return 'not_found';
  }
  if (parsed.pathname !== path) return 'not_found';
  return {
    code: parsed.searchParams.get('code'),
    state: parsed.searchParams.get('state'),
    error: parsed.searchParams.get('error'),
    errorDescription: parsed.searchParams.get('error_description'),
  };
}

/**
 * 构造请求处理器：把「一次性」这条不变量收到一个可单测的地方。
 *
 * `isConsumed()` 由调用方持有，处理器负责在**第一次**成功解析回调时
 * 把它翻转。第二次同样合法的请求会拿到 **409** 且**不会**再次回调
 * `onCallback` —— 这就是「code_verifier / 授权码一次性」在 HTTP 层的落点。
 */
export function createCallbackHandler(params: {
  readonly path: string;
  readonly host: string;
  readonly isConsumed: () => boolean;
  readonly onCallback: (cb: AuthCallback) => void;
}): (req: CallbackRequestLike, res: CallbackResponseLike) => void {
  return (req, res) => {
    const outcome = parseCallbackRequest(req, params.path, params.host);
    if (outcome === 'method_not_allowed') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' }).end();
      return;
    }
    if (outcome === 'not_found') {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end();
      return;
    }
    if (params.isConsumed()) {
      res.writeHead(409, { 'Content-Type': 'text/plain; charset=utf-8' }).end();
      return;
    }
    const ok = outcome.error === null && outcome.code !== null && outcome.code !== '';
    res
      .writeHead(ok ? 200 : 400, { 'Content-Type': 'text/html; charset=utf-8' })
      .end(ok ? successPage() : failurePage('授权未完成，请回到应用重试。'));
    params.onCallback(outcome);
  };
}

/**
 * 起一个 loopback 回调服务器。
 *
 * 刻意做成**显式 start**（而不是模块加载即监听）：不调 `close()` 就会
 * 一直占着端口，测试里尤其明显。
 */
export async function startLoopbackAuthServer(
  opts: { readonly path?: string; readonly host?: string } = {},
): Promise<LoopbackAuthServer> {
  const path = opts.path ?? CALLBACK_PATH;
  // 见文件头细节 1：只绑 IPv4 loopback，避免 Windows 防火墙入站弹窗。
  const host = opts.host ?? '127.0.0.1';

  let settle: ((cb: AuthCallback) => void) | null = null;
  let settleErr: ((e: Error) => void) | null = null;
  let timer: NodeJS.Timeout | null = null;
  let consumed = false;

  const handle = createCallbackHandler({
    path,
    host,
    isConsumed: () => consumed,
    onCallback: (callback) => {
      consumed = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      if (settle !== null) settle(callback);
    },
  });

  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    handle(req, res);
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    // 端口 0：见文件头细节 2。
    server.listen(0, host, () => {
      server.removeListener('error', reject);
      resolve();
    });
  });

  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  // 对外声明 localhost（见文件头细节 3），实际只绑 127.0.0.1。
  const redirectUri = `http://localhost:${port}${path}`;

  return {
    redirectUri,
    waitForCallback(timeoutMs: number): Promise<AuthCallback> {
      return new Promise<AuthCallback>((resolve, reject) => {
        if (consumed && timer === null && settle === null) {
          // 已经成功回调过：不再等第二次。
          reject(new Error('回调已被消费，不能重复等待'));
          return;
        }
        settle = resolve;
        settleErr = reject;
        timer = setTimeout(() => {
          timer = null;
          const e = new LoopbackTimeoutError(timeoutMs);
          if (settleErr !== null) settleErr(e);
        }, timeoutMs);
        // 不因为「没人等这个 promise」就让进程挂住。
        timer.unref?.();
      });
    },
    close(): Promise<void> {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (settleErr !== null) {
        // 关服务器时若有等待者，让它以失败结束，而不是永远挂着。
        settleErr(new Error('登录流程已取消（回调服务器关闭）'));
        settle = null;
        settleErr = null;
      }
      return new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}
