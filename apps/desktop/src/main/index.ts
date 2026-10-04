import { app, BrowserWindow, Menu, shell } from 'electron';
import { join } from 'path';
import { registerIpcHandlers, createDefaultOrchestrator } from './ipc.js';
import { getProcessSupervisor } from './ipc/process-supervisor.js';

// 受限环境（无 GPU / 沙箱代理）下禁用 GPU，避免 Chromium GPU 进程崩溃。
// 代价：WebGL 不可用，skinview3d 等 3D 预览会加载失败（实测 SwiftShader
// 软件渲染在本环境更糟——直接白屏，故不用）。正常桌面运行不设此变量，
// 保持硬件 GPU + WebGL。
if (process.env.MC_CREATOR_NO_GPU) {
  app.commandLine.appendSwitch('no-sandbox');
  app.commandLine.appendSwitch('disable-gpu');
  app.commandLine.appendSwitch('disable-gpu-sandbox');
  app.commandLine.appendSwitch('disable-dev-shm-usage');
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    // 隐藏默认英文菜单栏；按 Alt 可唤出中文菜单。应用内已有 TopToolbar 负责日常操作。
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // P0 安全：阻止渲染进程导航到外部页面（仅允许应用内 hash/anchor 跳转）
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL() && !url.startsWith('http://localhost')) {
      e.preventDefault();
      void shell.openExternal(url);
    }
  });

  // P0 安全：拒绝新窗口弹窗，外链交由系统浏览器打开
  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

// P0 安全：所有 webContents 的外链点击统一交给系统浏览器，防止在应用内加载任意远程内容
app.on('web-contents-created', (_e, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
});

/** 中文应用菜单（按 Alt 唤出），替换 Electron 默认英文菜单 */
function createChineseMenu(): Menu {
  return Menu.buildFromTemplate([
    {
      label: 'MC 创作器',
      submenu: [
        { label: '关于 MC 创作器', role: 'about' },
        { type: 'separator' },
        { label: '退出', role: 'quit' },
      ],
    },
    {
      label: '文件',
      submenu: [{ label: '关闭窗口', role: 'close' }],
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', role: 'undo' },
        { label: '重做', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', role: 'cut' },
        { label: '复制', role: 'copy' },
        { label: '粘贴', role: 'paste' },
        { label: '全选', role: 'selectAll' },
      ],
    },
    {
      label: '视图',
      submenu: [
        { label: '重新加载', role: 'reload' },
        { label: '强制重新加载', role: 'forceReload' },
        { label: '开发者工具', role: 'toggleDevTools' },
        { type: 'separator' },
        { label: '全屏', role: 'togglefullscreen' },
      ],
    },
    {
      label: '窗口',
      submenu: [
        { label: '最小化', role: 'minimize' },
        { label: '关闭', role: 'close' },
      ],
    },
    {
      label: '帮助',
      submenu: [{ label: '开发者工具', role: 'toggleDevTools' }],
    },
  ]);
}

app.whenReady().then(() => {
  registerIpcHandlers(createDefaultOrchestrator);
  Menu.setApplicationMenu(createChineseMenu());
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

/**
 * 退出前把所有被托管的进程优雅停掉（§7.4「批量停止」，§7.1 进程保活属外壳职责）。
 * 内核不下发 stop —— stop_server 只返回 controlCommand:'stop'，真正收尾在这里。
 *
 * 用一次 preventDefault + 标志位来等异步停机：直接依赖 before-quit 的异步回调
 * 不会阻塞退出，Minecraft 服务端会变孤儿进程。停机本身有上限
 * （shutdownGracefulMs + 强杀后兜底各 2s），不会无限挂住退出。
 */
let supervisorShutdownDone = false;
app.on('before-quit', (event) => {
  if (supervisorShutdownDone) return;
  event.preventDefault();
  supervisorShutdownDone = true;
  void getProcessSupervisor()
    .shutdownAll()
    .catch(() => undefined)
    .finally(() => app.quit());
});
