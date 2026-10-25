/**
 * 启动器面板的**视觉预览入口**（dev-only）。
 *
 * ## 为什么需要它
 *
 * jsdom 测不出布局类问题：tab 文字竖排挤压、卡片高度塌陷、溢出截断、
 * 网格错位 —— 这些只在真实排版引擎里才出现。而 Electron 窗口无法被
 * 自动化工具截图，导致「测试全绿但界面是坏的」这类问题能一路溜到用户面前。
 *
 * 这个页面在**普通浏览器**里渲染**真实的组件 + 真实的 Tailwind 样式**，
 * 只把 IPC 层换成内存假数据，从而能截图、能肉眼验收。
 * 它不进入生产构建（index.html 才是正式入口）。
 *
 * 用法：dev server 起来后打开 `/launcher-preview.html`
 */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './src/index.css';

import type { InstanceSummary } from '../shared/ipc/launcher.js';

/**
 * 假实例：覆盖设计文档里点名的每种展示分支 ——
 * 未下载灰显、有/无 lastLaunchedAt、超长名截断、非 vanilla 加载器。
 */
const NOW = Date.now();
const DAY = 86_400_000;

const FAKE_INSTANCES: InstanceSummary[] = [
  {
    id: '26.2',
    name: 'Fabulously Optimized 生存服',
    versionId: '26.2',
    loader: 'fabric',
    source: 'downloaded',
    createdAt: NOW - 30 * DAY,
    username: 'Steve',
    memory: '4G',
    group: '常用',
    clientReady: true,
    lastLaunchedAt: NOW - 3 * DAY,
  },
  {
    id: '26.3',
    name: '一个非常非常长的实例名字用来验证截断行为是否会撑破卡片布局',
    versionId: '26.3',
    loader: 'fabric',
    source: 'imported',
    createdAt: NOW - 60 * DAY,
    username: 'Alex',
    memory: '8G',
    clientReady: true,
  },
  {
    id: '1.21.11',
    name: '生存 · 存档 A',
    versionId: '1.21.11',
    loader: 'vanilla',
    source: 'downloaded',
    createdAt: NOW - 5 * DAY,
    clientReady: false,
  },
  {
    id: 'neoforge-1.20.1',
    name: 'NeoForge 联机',
    versionId: '1.20.1',
    loader: 'neoforge',
    source: 'downloaded',
    createdAt: NOW - 90 * DAY,
    clientReady: true,
    lastLaunchedAt: NOW - 45 * DAY,
  },
];

const FAKE_VERSIONS = [
  // 三种 type 都要有：DownloadTab 的分组（正式版/预览版/远古版）与「最新预览版」
  // 卡片全靠 type 区分，只给 release 的话分组是死的。
  { id: '26.3', type: 'release', releaseTime: '2026-10-01T00:00:00Z' },
  { id: '26.4-snapshot-3', type: 'snapshot', releaseTime: '2026-10-06T20:54:00Z' },
  { id: '26.2', type: 'release', releaseTime: '2026-06-16T00:00:00Z' },
  { id: '1.21.11', type: 'release', releaseTime: '2025-12-09T00:00:00Z' },
  { id: '1.8.9', type: 'old_beta', releaseTime: '2015-12-22T00:00:00Z' },
];

/** 与真实实例目录形状一致（目录优先、按名排序） */
const FAKE_FILES: Record<
  string,
  { name: string; path: string; isDirectory: boolean; size?: number }[]
> = {
  '': [
    { name: 'config', path: 'config', isDirectory: true },
    { name: 'crash-reports', path: 'crash-reports', isDirectory: true },
    { name: 'logs', path: 'logs', isDirectory: true },
    { name: 'saves', path: 'saves', isDirectory: true },
    { name: 'resourcepacks', path: 'resourcepacks', isDirectory: true },
    { name: 'options.txt', path: 'options.txt', isDirectory: false, size: 4096 },
    { name: 'servers.dat', path: 'servers.dat', isDirectory: false, size: 18_432 },
  ],
  saves: [
    { name: 'New World', path: 'saves/New World', isDirectory: true },
    { name: '建筑练习', path: 'saves/建筑练习', isDirectory: true },
  ],
  config: [
    { name: 'fabric-api.toml', path: 'config/fabric-api.toml', isDirectory: false, size: 1536 },
  ],
};

const FAKE_MODS = [
  { name: 'sodium-fabric-0.6.0.jar', enabled: true, size: 1_048_576 },
  { name: 'lithium-fabric-0.2.9.jar', enabled: true, size: 524_288 },
  { name: 'fabric-api-0.100.0.jar', enabled: false, size: 2_097_152 },
];

/**
 * 在挂载 React **之前**塞好 `window.mcApi`：
 * `ipcClient` 直接读 `window.mcApi.*`，缺了就抛 `Cannot read properties of undefined`。
 */
function installFakeApi(): void {
  const api: Record<string, unknown> = {
    launcherListInstances: async () => ({ instances: FAKE_INSTANCES, error: null }),
    launcherListVersions: async () => ({ versions: FAKE_VERSIONS, error: null }),
    onLauncherGameExit: () => () => undefined,
    launcherPickFiles: async () => ({ paths: [], error: null }),
    // 下载进度：预览页用定时器模拟几个阶段，好看清进度条真的会动
    onLauncherDownloadProgress: (handler: (p: unknown) => void) => {
      const timer = setInterval(() => {
        const done = Math.floor(Math.random() * 4);
        handler({ version: null, stage: 'libraries', done, total: 8, finished: false });
      }, 400);
      return () => clearInterval(timer);
    },
    launcherCreateInstance: async () => ({
      ok: true,
      instance: FAKE_INSTANCES[0],
      error: null,
    }),
    launcherUpdateInstance: async () => ({ ok: true, instance: FAKE_INSTANCES[0], error: null }),
    launcherDeleteInstance: async () => ({ ok: true, filesDeleted: false, error: null }),
    launcherDownload: async () => ({ ok: true, error: null }),
    /**
     * 假的服务端下载。`kind` 故意给 `bundler` —— 那是真实情况里最需要被
     * 看见的那一支（1.18 起服务端是引导器，下完还不能直接跑），
     * 预览页顺手就能检查那句提示有没有正确显示。
     */
    launcherDownloadServer: async (req: { version: string }) => ({
      ok: true,
      path: `C:/Users/you/AppData/mc-launcher/versions/${req.version}/${req.version}-server.jar`,
      kind: 'bundler',
      error: null,
    }),
    /**
     * 假的创建服务端实例。返回一个假路径。
     */
    launcherCreateServerInstance: async (req: {
      serverId: string;
      version: string;
      port?: number;
      motd?: string;
      maxPlayers?: number;
      onlineMode?: boolean;
      levelName?: string;
      acceptEula?: boolean;
    }) => ({
      ok: true,
      serverDir: `C:/Users/you/AppData/mc-creator/servers/${req.serverId}`,
      jarLinked: true,
      eulaAccepted: req.acceptEula === true,
      error: null,
    }),
    launcherLaunch: async () => ({ pid: 4242, error: null }),
    /**
     * 假的服务端启动。返回一个假 pid。
     */
    processLaunch: async (_req: { serverId: string; javaPath?: string; memory?: string }) => ({
      ok: true,
      pid: 9999,
      denied: false,
      error: null,
    }),
    /**
     * 假的服务端实例列表。
     */
    launcherListServerInstances: async () => ({
      instances: [
        {
          id: 'test-server-1',
          name: '我的服务端',
          versionId: '1.20.4',
          jarKind: 'standalone',
          eulaAccepted: true,
          lastLaunchedAt: Date.now() - 86400000,
          createdAt: Date.now() - 172800000,
        },
        {
          id: 'test-server-2',
          name: '开发服',
          versionId: '26.3',
          jarKind: 'bundler',
          eulaAccepted: false,
          lastLaunchedAt: null,
          createdAt: Date.now() - 86400000,
        },
      ],
    }),
    /**
     * 假的删除服务端实例。
     */
    launcherDeleteServerInstance: async (_req: { id: string; deleteFiles?: boolean }) => ({
      ok: true,
    }),
    launcherInstallLoader: async () => ({ ok: true, error: null }),
    launcherInstallSkin: async () => ({ ok: true, error: null }),
    /**
     * 整合包安装 —— 假实现，但要发进度，否则预览里点「安装」看不到任何反应，
     * 也就无法目视检查进度条长什么样。
     */
    launcherInstallModpack: async () => ({
      ok: true,
      instanceId: '26.3',
      gameDir: '<preview>/game/26.3',
      installed: 49,
      failed: [],
      error: null,
    }),
    launcherCancelModpack: async () => ({ ok: true, cancelled: true, error: null }),
    onLauncherModpackProgress: async () => () => {
      /* no-op：预览不发进度 */
    },
    launcherListMods: async () => ({ mods: FAKE_MODS, error: null }),
    launcherToggleMod: async () => ({ ok: true, error: null }),
    launcherRemoveMod: async () => ({ ok: true, error: null }),
    launcherInstallMod: async () => ({ ok: true, path: 'mods/x.jar', error: null }),
    launcherListInstanceFiles: async (req: { version: string; path?: string }) => ({
      files: FAKE_FILES[req.path ?? ''] ?? [],
      error: null,
    }),
    launcherListWorlds: async () => ({
      worlds: [
        {
          dirName: 'New World',
          levelName: '生存 · 建筑练习',
          lastPlayed: NOW - 2 * DAY,
          gameMode: '生存',
          mcVersion: '1.21.11',
          sizeBytes: 187_432_576,
          readable: true,
        },
        {
          dirName: 'creative',
          levelName: '创造模式 · 红石实验',
          lastPlayed: NOW - 20 * DAY,
          gameMode: '创造',
          mcVersion: '1.21.11',
          sizeBytes: 48_234_496,
          readable: true,
        },
        {
          dirName: 'broken',
          levelName: 'broken',
          lastPlayed: NOW - 40 * DAY,
          readable: false,
        },
      ],
      error: null,
    }),
    launcherLogStream: () => () => undefined,
    launcherReadLatestLog: async () => ({
      lines: [
        '[12:00:01] [main/INFO]: Environment: Environment[Client] Linux',
        '[12:00:02] [main/WARN]: Ambiguity between arguments detected',
        '[12:00:03] [main/ERROR]: Failed to load texture',
        '[12:00:04] [main/INFO]: Sound engine started',
      ],
      error: null,
    }),
    launcherListCrashReports: async () => ({ files: [], error: null }),
    launcherReadCrashReport: async () => ({ content: '', error: null }),
    locateMc: async () => ({ found: false, error: null }),
    chooseMcDir: async () => ({ path: null }),
    installMod: async () => ({ ok: false, error: null }),
    launchMc: async () => ({ ok: false, error: null }),
  };

  (window as unknown as { mcApi: unknown }).mcApi = api;
  // ipcClient 里 isWebPreview() 会跳过部分 mock，这里显式关掉，走上面的 fake api
  (window as unknown as { __MC_PREVIEW__?: boolean }).__MC_PREVIEW__ = false;
}

async function boot(): Promise<void> {
  installFakeApi();
  const { GameLauncherPanel } = await import('./src/components/launcher/GameLauncherPanel.js');

  const el = document.getElementById('root');
  if (!el) throw new Error('#root 不存在');

  /**
   * 宽度可经查询参数覆盖：`?w=560`。这点很关键 ——
   * 启动器面板在真实工作台里是三栏布局的**中栏**，宽度远小于全屏，
   * 用 1000px 硬编码会在窄视口下横向溢出，反而看不出真实断点问题。
   */
  const params = new URLSearchParams(location.search);
  const width = params.get('w');
  const host = document.createElement('div');
  host.id = 'preview-host';
  host.style.cssText = width
    ? `width:${width}px;height:720px;margin:0 auto;`
    : 'width:100%;height:100vh;';
  el.appendChild(host);
  createRoot(host).render(
    <StrictMode>
      <GameLauncherPanel />
    </StrictMode>,
  );
}

void boot();
