/**
 * Electron E2E 共享 fixture。
 *
 * 每条用例拿到的东西：
 * - `mcApp.app`   —— Playwright 的 ElectronApplication（可 `app.evaluate()` 进主进程）
 * - `mcApp.page`  —— 首个窗口
 * - `mcApp.instanceDir` —— 本用例专属的假实例目录（主进程 userData 被重定向到这里）
 * - `mcApp.tripwire` —— 出站网络 / 更新器记账（断言「没碰真实源」用）
 *
 * ## 网络拦截为什么分两层
 *
 * 1. **主进程侧**：`fixtures/main-guard.cjs` 在应用代码之前 patch `fetch` /
 *    `net.request` / `http(s)`，命中即记账 + 中止。见该文件注释。
 * 2. **渲染进程侧**：`page.addInitScript()` patch 渲染层的 `fetch` / `XMLHttpRequest` /
 *    `WebSocket`。这层**必须配合一次 reload**：`electron.launch()` 返回后页面已经
 *    开始加载了，那时再 addInitScript 就拦不住「首屏加载期间」的请求。reload 之后
 *    守卫确定在应用脚本之前生效，覆盖才是完整的。
 *    另有 `page.route()` 做纵深防御（Chromium 侧拦截），它对 file:// 文档本身
 *    可能不生效，所以不能只靠它。
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  _electron as electron,
  test as base,
  expect,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const DESKTOP_ROOT = join(__dirname, '..', '..');

/** 主进程守卫：Electron 的入口就是它，而不是 out/main/index.js。 */
const MAIN_GUARD = join(__dirname, 'main-guard.cjs');

/** 主进程记账（与 main-guard.cjs 里的 ledger 一一对应）。 */
export interface MainLedger {
  /** 被拦截的出站请求，形如 `fetch https://api.modrinth.com/...` */
  attempts: string[];
  /** 被调用过的 autoUpdater 方法名（E2E 里应当恒为空） */
  updaterCalls: string[];
  /** electron-updater 是否可被解析（false = 仓库没有真实更新源） */
  electronUpdaterResolvable: boolean;
  instanceDir: string;
  /** 重定向之前的真实 userData 路径 */
  realUserData: string;
  /** 应用启动那一刻真实 userData 的文件清单 */
  realUserDataAtStart: string[];
}

export interface McApp {
  app: ElectronApplication;
  page: Page;
  /** 本用例的假实例目录；用例结束后整棵目录树被删除 */
  instanceDir: string;
  /** 读主进程记账（附带当前真实 userData 的文件清单快照） */
  readLedger: () => Promise<MainLedger & { realUserDataNow: string[] }>;
  /** 读渲染进程记账 */
  readRendererAttempts: () => Promise<string[]>;
}

interface Fixtures {
  mcApp: McApp;
}

/** 收集进程 env，丢掉 undefined（Electron 的 env 类型不接受 undefined）。 */
function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === 'string') env[key] = value;
  }
  return env;
}

/**
 * 渲染进程出站闸门（会被序列化后注入到每个新文档的最前面）。
 *
 * 与主进程侧同构：命中记账 + 拒绝。刻意**只拦外网**，本地 scheme 一律放行 ——
 * 免得把 file:// 资源加载也误伤。
 */
function installRendererTripwire(): void {
  const store = window as unknown as { __MC_E2E_NET__?: string[] };
  const attempts: string[] = [];
  store.__MC_E2E_NET__ = attempts;

  const isExternal = (url: string): boolean => /^(https?|wss?|ftp):/i.test(url);

  const nativeFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (isExternal(url)) {
      attempts.push(`fetch ${url}`);
      return Promise.reject(new Error(`[e2e] 出站 fetch 已被拦截: ${url}`));
    }
    return nativeFetch(input, init);
  }) as typeof window.fetch;

  const nativeOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function guardedOpen(
    this: XMLHttpRequest,
    method: string,
    url: string | URL,
    ...rest: unknown[]
  ): void {
    const href = typeof url === 'string' ? url : url.href;
    if (isExternal(href)) {
      attempts.push(`xhr ${href}`);
      throw new Error(`[e2e] 出站 XHR 已被拦截: ${href}`);
    }
    // 原生 open 的完整签名（async / user / password）随 lib.dom 的版本浮动，
    // 这里原样透传，不去猜第三个参数 onwards 的形状
    (nativeOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
  };

  const NativeWebSocket = window.WebSocket;
  window.WebSocket = class GuardedWebSocket extends NativeWebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      const href = typeof url === 'string' ? url : url.href;
      if (isExternal(href)) {
        attempts.push(`websocket ${href}`);
        throw new Error(`[e2e] 出站 WebSocket 已被拦截: ${href}`);
      }
      super(url, protocols);
    }
  };
}

export const test = base.extend<Fixtures>({
  // Playwright 强制要求 fixture 第一个参数写成对象解构（见 eslint.config.mjs 里
  // 对 e2e 目录关掉 no-empty-pattern 的说明），这个 fixture 不用任何上游 fixture
  mcApp: async ({}, use) => {
    // ① 假实例目录：每个用例一棵独立目录树，结束即删
    const instanceDir = await mkdtemp(join(tmpdir(), 'mc-creator-e2e-'));

    const app = await electron.launch({
      // cwd 指向 desktop 包，Playwright 从这里解析 electron 可执行文件
      cwd: DESKTOP_ROOT,
      args: [MAIN_GUARD],
      env: {
        ...baseEnv(),
        MC_E2E_INSTANCE_DIR: instanceDir,
        // 主进程自己认这个开关：无 GPU / 沙箱受限环境下禁用 GPU，
        // 否则 Chromium GPU 进程会崩（见 src/main/index.ts 顶部注释）
        MC_CREATOR_NO_GPU: '1',
        // 禁掉 crash reporter 上报，避免 E2E 产生外部网络动作
        ELECTRON_ENABLE_STACK_DUMPING: '0',
      },
    });

    // 提前挂上：主进程一旦报 console error / 崩溃，失败信息里能看到
    app.process().stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      if (/App threw an error during load|ERR_MODULE_NOT_FOUND|FATAL/.test(text)) {
        console.error(`[e2e][main] ${text}`);
      }
    });

    const page = await app.firstWindow();

    // ② 渲染进程闸门 + 纵深防御路由
    await page.addInitScript(installRendererTripwire);
    await page.route('**/*', async (route) => {
      const url = route.request().url();
      if (/^(https?|wss?|ftp):/i.test(url)) {
        await route.abort('blockedbyclient');
        return;
      }
      // file:// 文档 / blob: / data: 等一律放行
      await route.continue();
    });

    // ③ reload 一次，让注入脚本在应用脚本之前生效（覆盖首屏加载期）
    await page.reload({ waitUntil: 'domcontentloaded' });

    const mcApp: McApp = {
      app,
      page,
      instanceDir,
      readLedger: () =>
        app.evaluate(() => {
          const ledger = (globalThis as unknown as { __MC_E2E__: MainLedger }).__MC_E2E__;
          // readRealUserDataNow 是主进程里的函数，跨进程边界要转成字符串数组
          const readNow = (ledger as unknown as { readRealUserDataNow: () => string[] })
            .readRealUserDataNow;
          return { ...ledger, realUserDataNow: readNow() };
        }),
      readRendererAttempts: () =>
        page.evaluate(
          () => (window as unknown as { __MC_E2E_NET__?: string[] }).__MC_E2E_NET__ ?? [],
        ),
    };

    try {
      await use(mcApp);
    } finally {
      await app.close().catch(() => undefined);
      await rm(instanceDir, { recursive: true, force: true }).catch(() => undefined);
    }
  },
});

export { expect };
