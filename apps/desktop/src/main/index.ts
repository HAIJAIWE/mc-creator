import { app, BrowserWindow, shell } from 'electron';
import { join } from 'path';
import { registerIpcHandlers, createDefaultOrchestrator } from './ipc.js';

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

app.whenReady().then(() => {
  registerIpcHandlers(createDefaultOrchestrator);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
