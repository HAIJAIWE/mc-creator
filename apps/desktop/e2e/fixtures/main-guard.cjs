'use strict';
/**
 * E2E 主进程守卫 —— 在**真实主进程入口之前**执行。
 *
 * ## 为什么需要它（而不是在测试里 mock）
 *
 * Playwright 的 `electron.launch()` 只能指定入口 JS，拿不到「应用自己代码跑起来
 * 之前」的钩子。而本仓库主进程一 import 就会：
 *   - 读 `app.getPath('userData')` 下的 profile / model-config / projects；
 *   - 注册一堆 IPC 处理器；
 *   - 未来还会接更新器（§15 明文要求「更新器必须 mock」）。
 *
 * 这些副作用一旦漏网，E2E 就会污染开发者真实的 `%APPDATA%/mc-creator`，或者
 * 在 CI 里真的去连更新源。所以这里用一层**入口包装**：先把三道闸门装好
 * （假实例目录 / 出站网络拦截 / 更新器封杀），再 `require` 真正的
 * `out/main/index.js`。装闸门的代码运行在任何应用代码之前。
 *
 * ## 三道闸门
 *
 * 1. **假实例目录**：把 `userData` / `sessionData` / `temp` / `logs` / `crashDumps`
 *    全部重定向到 `MC_E2E_INSTANCE_DIR`（每个用例一个临时目录）。
 *    主进程所有磁盘读写都走 `app.getPath('userData')`（见 path-manager.ts），
 *    所以这一刀就够：E2E 永远不碰真实用户目录。
 * 2. **出站网络拦截**：patch `fetch` / `net.request` / `http(s).request|get`。
 *    命中的请求**记账后立刻中止**，所以它不会离开本机 —— 这是「mock CDN /
 *    mock 外部 API（Modrinth / CurseForge / Mojang 版本清单）」的落点。
 *    记账结果放在 `globalThis.__MC_E2E_NET__`，测试用 `app.evaluate()` 读出来断言为空。
 * 3. **更新器封杀**：仓库当前**没有**任何自动更新实现（既没有 `electron-updater`
 *    依赖，也没有 `autoUpdater` 调用）。这里做两件事：
 *    - 记录 `electron-updater` 是否可被解析（不可解析 = 没有真实更新源可碰）；
 *    - 把 Electron 内置 `autoUpdater` 的三个危险方法换成会抛错的桩。
 *    这样一旦将来有人接上更新器，E2E 会在**接上之前**就红，而不是在 CI 上
 *    默默去拉真实更新包。
 *
 * 注意本文件是 CommonJS：它要作为 Electron 主进程入口被 `electron.launch()` 直接
 * 执行（`out/main/index.js` 也是 CJS，`require` 链才对得上）。
 */

const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const electron = require('electron');

const { app, net } = electron;

/* ------------------------------------------------------------------ *
 * 记账（本文件与测试之间唯一的通信面）
 * ------------------------------------------------------------------ */

const ledger = {
  /** 被拦截的出站请求，形如 `fetch https://api.modrinth.com/...` */
  attempts: [],
  /** 被调用过的 autoUpdater 方法名（E2E 里应当恒为空） */
  updaterCalls: [],
  /** electron-updater 是否可被解析（false = 仓库没有真实更新源） */
  electronUpdaterResolvable: false,
  instanceDir: process.env.MC_E2E_INSTANCE_DIR || '',
  /** 重定向**之前**的真实 userData 路径 */
  realUserData: '',
  /** 重定向那一刻真实 userData 的目录清单（测试拿来和收尾时对比） */
  realUserDataAtStart: [],
  /** 读当前真实 userData 的目录清单 */
  readRealUserDataNow: () => listRecursive(ledger.realUserData),
};

/**
 * 递归列目录（相对路径，已排序），用于「真实 userData 有没有被写脏」的对比。
 *
 * 设上限是为了防止开发者本机 userData 里塞了几万个文件时把 CI 拖死 ——
 * 命中上限就返回一个带标记的截断清单，两次快照会一致，比对依然有效。
 */
const LIST_LIMIT = 5000;
function listRecursive(root) {
  const out = [];
  if (!root || !fs.existsSync(root)) return out;
  const walk = (dir, prefix) => {
    if (out.length >= LIST_LIMIT) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return; // 权限不足等：跳过，不让快照本身成为失败原因
    }
    for (const entry of entries) {
      if (out.length >= LIST_LIMIT) return;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) walk(path.join(dir, entry.name), rel);
      else out.push(rel);
    }
  };
  walk(root, '');
  return out.sort();
}

function record(via, url) {
  const line = `${via} ${url}`;
  ledger.attempts.push(line);
  // 同时打到 stderr：万一测试没跑到断言那一步，日志里也能看到
  console.error(`[e2e][net] 出站请求已被拦截: ${line}`);
}

/** 出站协议白名单：只有本地 scheme 允许，其余（http/https/ws/ftp）一律拦。 */
const EXTERNAL_SCHEME = /^(https?|wss?|ftp):/i;

function isExternal(url) {
  return EXTERNAL_SCHEME.test(String(url));
}

/* ------------------------------------------------------------------ *
 * 闸门 1：假实例目录
 * ------------------------------------------------------------------ */

function redirectInstanceDir() {
  const dir = process.env.MC_E2E_INSTANCE_DIR;
  if (!dir) {
    throw new Error('[e2e] 缺少 MC_E2E_INSTANCE_DIR —— 假实例目录未指定，拒绝启动');
  }
  fs.mkdirSync(dir, { recursive: true });

  // app.setPath 要求绝对路径且目录已存在，所以先建再建
  const mapping = [
    ['userData', 'userData'],
    ['sessionData', 'sessionData'],
    ['temp', 'tmp'],
    ['logs', 'logs'],
    ['crashDumps', 'crashDumps'],
  ];
  for (const [name, sub] of mapping) {
    const target = path.join(dir, sub);
    fs.mkdirSync(target, { recursive: true });
    app.setPath(name, target);
  }
}

/* ------------------------------------------------------------------ *
 * 闸门 2：出站网络拦截
 * ------------------------------------------------------------------ */

/**
 * 从 `http.request(...)` 的一等参数里尽力还原 URL。
 * 形态有三种：字符串、`URL`、options 对象（`protocol`+`host`+`path` 或 `href`）。
 */
function urlFromRequestArgs(args) {
  const first = args[0];
  if (typeof first === 'string') return first;
  if (first instanceof URL) return first.href;
  if (first && typeof first === 'object') {
    if (typeof first.href === 'string') return first.href;
    const proto = first.protocol || 'http:';
    return `${proto}//${first.host || first.hostname || '?'}${first.path || '/'}`;
  }
  return String(first);
}

function installNetTripwire() {
  // --- fetch（含 undici / Vercel AI SDK 这类走 global fetch 的调用） ---
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function guardedFetch(input, init) {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof URL
          ? input.href
          : (input && input.url) || String(input);
    if (isExternal(url)) {
      record('fetch', url);
      return Promise.reject(new Error(`[e2e] 出站 fetch 已被拦截: ${url}`));
    }
    return originalFetch.call(this, input, init);
  };

  // --- Electron net.request（主进程访问外部 API 的正统方式） ---
  const originalNetRequest = net.request.bind(net);
  net.request = function guardedNetRequest(options) {
    const url = urlFromRequestArgs([options]);
    if (isExternal(url)) {
      record('net.request', url);
      const client = originalNetRequest(options);
      // 立刻中止：请求根本不会离开本机
      try {
        client.abort();
      } catch {
        /* 某些形态下 abort 前必须先 on('error')，忽略即可 */
      }
      return client;
    }
    return originalNetRequest(options);
  };

  // --- node:http / node:https（第三方库直连） ---
  for (const [mod, label] of [
    [http, 'http'],
    [https, 'https'],
  ]) {
    const originalRequest = mod.request;
    mod.request = function guardedRequest(...args) {
      const url = urlFromRequestArgs(args);
      if (isExternal(url)) {
        record(`${label}.request`, url);
        const req = originalRequest.apply(this, args);
        // destroy(err) 会触发 'error'；不挂空监听器的话会变成未捕获异常把主进程带崩
        req.on('error', () => {});
        req.destroy(new Error(`[e2e] 出站请求已被拦截: ${url}`));
        return req;
      }
      return originalRequest.apply(this, args);
    };

    const originalGet = mod.get;
    mod.get = function guardedGet(...args) {
      const url = urlFromRequestArgs(args);
      if (isExternal(url)) {
        record(`${label}.get`, url);
        const req = originalRequest.apply(this, args);
        req.on('error', () => {});
        req.destroy(new Error(`[e2e] 出站请求已被拦截: ${url}`));
        return req;
      }
      return originalGet.apply(this, args);
    };
  }
}

/* ------------------------------------------------------------------ *
 * 闸门 3：更新器封杀
 * ------------------------------------------------------------------ */

/**
 * 把 Electron 内置 autoUpdater 的危险方法换成抛错桩。
 *
 * 注意 `electron.autoUpdater` 是**惰性单例**：ready 之前取可能是 undefined，
 * 所以既要在启动时试一次（覆盖 ready 之前的调用），也要在 ready 时再试一次
 * （覆盖 ready 之后的调用）。
 */
function sealAutoUpdater() {
  const updater = electron.autoUpdater;
  if (!updater) return;
  for (const method of ['checkForUpdates', 'downloadUpdate', 'quitAndInstall']) {
    try {
      updater[method] = function sealedUpdaterCall() {
        ledger.updaterCalls.push(method);
        throw new Error(
          `[e2e] autoUpdater.${method}() 在 E2E 中被封杀 —— 日常 CI 不得触碰真实更新源（设计文档 §15）`,
        );
      };
    } catch {
      /* 属性只读时跳过；记账断言仍然有效 */
    }
  }
}

/** 记录 electron-updater 是否可解析（§15：更新器必须 mock）。 */
function probeElectronUpdater() {
  try {
    // 从应用目录与 cwd 两处找：pnpm workspace 下 electron-updater 若被装，
    // 应该出现在 apps/desktop/node_modules 里
    require.resolve('electron-updater', {
      paths: [app.getAppPath(), process.cwd(), __dirname],
    });
    ledger.electronUpdaterResolvable = true;
  } catch {
    ledger.electronUpdaterResolvable = false;
  }
}

/* ------------------------------------------------------------------ *
 * 装配 + 加载真实入口
 * ------------------------------------------------------------------ */

// 先给真实 userData 拍一张快照（此刻应用代码一行都还没跑），
// 测试收尾时再拍一张对比 —— 这就是「E2E 没写真实用户目录」的可执行证据
ledger.realUserData = app.getPath('userData');
ledger.realUserDataAtStart = listRecursive(ledger.realUserData);

redirectInstanceDir();
probeElectronUpdater();
sealAutoUpdater();
installNetTripwire();
app.once('ready', sealAutoUpdater);

// 暴露给 app.evaluate()：测试从这里读记账
globalThis.__MC_E2E__ = ledger;

const MAIN_ENTRY = path.join(__dirname, '..', '..', 'out', 'main', 'index.js');
if (!fs.existsSync(MAIN_ENTRY)) {
  throw new Error(
    `[e2e] 找不到主进程产物 ${MAIN_ENTRY}\n` +
      '[e2e] 请先执行: pnpm --filter @mc-creator/desktop build',
  );
}
// 必须用 require：out/main/index.js 是 CJS，且它内部的 __dirname 决定
// preload / renderer 的相对路径解析，必须保持为 out/main
require(MAIN_ENTRY);
