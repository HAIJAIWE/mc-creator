/**
 * §4.1 单实例锁 + 深链协议（mc-creator://）。
 *
 * - 单实例锁必须在模块顶部、`app.whenReady()` 之前拿：第二个实例必须在
 *   `initKernels()` 之前退出，否则两套内核同时管理同一批服务端。
 * - Windows 打包 target 只有 zip（electron-builder.yml `win.target=zip`），没有
 *   installer——所以 yml 里配 `protocols` 也没用，**不要去碰 yml**；协议靠运行时
 *   `setAsDefaultProtocolClient('mc-creator')` 写 HKCU 注册。
 * - 协议 scheme 定为 `mc-creator`（如 `mc-creator://open?path=...`）。
 *   Windows 下协议 URL 进第二个实例的 `argv`（`second-instance` 事件带回），
 *   macOS 走 `open-url` 事件。
 * - 现无任何深链消费者：URL 收到后只聚焦窗口 + 落日志，**不编路由**（编了也没人
 *   消费，是死代码）。聚焦逻辑由调用方以 `onSecondInstance` 回调注入，本模块不
 *   import 具体窗口（`createWindow` 在 index.ts 内，不导出）。
 * - 本模块不 import `electron`：`app` 全注入（见 `SingleInstanceApp`），测试零
 *   Electron，全部用 fake 覆盖。
 * - E2E 不覆盖双实例（测试环境只拉起一个 инстанс）：双实例竞争靠本文件的单测钉死。
 */

export const DEEP_LINK_PROTOCOL = 'mc-creator';

export type SingleInstanceRole = 'primary' | 'quit';

/**
 * `ensureSingleInstance` 需要的最小 App 切面——Electron `app` 的结构子集。
 *
 * 全注入的五个方法：
 * - `requestSingleInstanceLock`：拿锁，成败即返回值（本模块唯一的判断依据）；
 * - `hasSingleInstanceLock`：纳入切面供诊断/测试断言，当前实现不依赖它；
 * - `on`：只用 `second-instance` / `open-url` 两个事件；
 * - `setAsDefaultProtocolClient`：运行时协议注册（写 HKCU，见文件头注释）；
 * - `quit`：由调用方（index.ts）在返回 `'quit'` 后调用，本模块不代调——
 *   判断与退出分开，fake 测试才能断言“拿不到锁时不注册回调”。
 */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean;
  hasSingleInstanceLock(): boolean;
  // listener 用 unknown[] 而不用 any[]（no-explicit-any）：实现与调用处已用
  // Array.isArray/typeof 做窄化，这里只收“可变参数函数”这个形状。
  on(event: string, listener: (...args: unknown[]) => void): unknown;
  setAsDefaultProtocolClient(protocol: string): boolean;
  quit(): void;
}

export interface EnsureSingleInstanceOptions {
  app: SingleInstanceApp;
  /** 第二个实例出现（或收到协议 URL）时的聚焦逻辑，由调用方注入。 */
  onSecondInstance: (deepLinkUrl?: string) => void;
  /** 深链协议 scheme，默认 `mc-creator`。 */
  protocol?: string;
}

/**
 * 从 `second-instance` 的 `argv` 里找出本协议 URL。
 *
 * Windows 下协议 URL 以命令行参数形式进第二个实例的 argv（如
 * `mc-creator://open?path=...`）；普通启动参数（`--foo`、文件路径）一律忽略，
 * 找不到返回 `undefined`（调用方只做聚焦）。
 */
export function findDeepLinkUrl(argv: readonly string[], protocol: string): string | undefined {
  const prefix = `${protocol}://`;
  return argv.find((arg) => typeof arg === 'string' && arg.startsWith(prefix));
}

/**
 * 拿单实例锁 + 注册深链回调。
 *
 * - 拿不到锁 → 返回 `'quit'`，且**不注册任何回调、不注册协议**（调用方 `app.quit()`）。
 * - 拿到锁 → 注册 `second-instance` / `open-url` 回调并
 *   `setAsDefaultProtocolClient`，返回 `'primary'`。
 */
export function ensureSingleInstance({
  app,
  onSecondInstance,
  protocol = DEEP_LINK_PROTOCOL,
}: EnsureSingleInstanceOptions): SingleInstanceRole {
  if (!app.requestSingleInstanceLock()) {
    return 'quit';
  }

  app.on('second-instance', (_event, argv) => {
    const url = Array.isArray(argv) ? findDeepLinkUrl(argv, protocol) : undefined;
    if (url === undefined) {
      console.log('[deep-link] second-instance：聚焦已有窗口');
    } else {
      // 暂无深链消费者：只聚焦 + 落日志，不做路由分发。
      console.log(`[deep-link] second-instance：${url}（暂无路由消费，仅聚焦已有窗口）`);
    }
    onSecondInstance(url);
  });

  app.on('open-url', (event, url) => {
    const openEvent = event as { preventDefault?: () => void } | undefined;
    openEvent?.preventDefault?.();
    // 暂无深链消费者：只聚焦 + 落日志，不做路由分发。
    console.log(`[deep-link] open-url：${String(url)}（暂无路由消费，仅聚焦已有窗口）`);
    onSecondInstance(typeof url === 'string' ? url : undefined);
  });

  app.setAsDefaultProtocolClient(protocol);
  return 'primary';
}
