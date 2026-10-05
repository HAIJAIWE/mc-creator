import { app, BrowserWindow, Menu, ipcMain, shell } from 'electron';
import { join } from 'path';
import { registerIpcHandlers, createDefaultOrchestrator } from './ipc.js';
import { getProcessSupervisor } from './ipc/process-supervisor.js';
import { runStartupRecovery, formatRecoveryReport } from './startup-recovery.js';
import { getKernelRuntime, initKernelRuntime, resolveKernelRoot } from './kernel-runtime.js';
import { createTaskPoller, type TaskPoller } from './server-task-poller.js';
import {
  createAgentHost,
  createAgentSelfStartConfirm,
  resolveAgentDataDir,
  type AgentHost,
} from './agent-host.js';
import { createProcessSupervisor } from './process-supervisor.js';
import { createNativeConfirm } from './kernel-confirm.js';
import { createUiConfirm } from './kernel-confirm-ui.js';
import { KERNEL_CONFIRM_RESPONSE, KernelConfirmResponse } from '../shared/ipc-channels.js';
import { ensureSingleInstance } from './single-instance.js';

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

/**
 * §4.1 单实例锁：必须在模块顶部、`app.whenReady()` 之前拿。
 * 第二个实例拿不到锁就 `app.quit()`，绝不进入下面的启动链——否则两套内核
 * （`initKernels`）同时管理同一批服务端。
 * 聚焦逻辑复用 `activate` 分支语义：有窗口则聚焦首个，无窗口则新建。
 */
const instanceRole = ensureSingleInstance({
  app,
  onSecondInstance: () => {
    const existing = BrowserWindow.getAllWindows()[0];
    if (existing) existing.focus();
    else createWindow();
  },
});
if (instanceRole === 'quit') {
  app.quit();
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

/**
 * §14 半成品检测：启动时扫描并清理未完成实例 + 残留中间文件。
 *
 * 放在 IPC 注册之前：让渲染进程第一次 list_projects / 触发任何内核调用时，
 * 磁盘已经是干净的，不需要每个读路径各自防御一遍。
 *
 * kernelRoot 传**内核宿主的 dataDir 本身**（`getKernelRuntime()!.dataDir`），不是
 * 另算一个路径：
 *   - `runStartupRecovery` 的 `scanInstanceRoot` 扫 `<kernelRoot>/instances/`；
 *   - kernel-java 的 `list_instances` / `create_instance` 读写的是
 *     `<dataDir>/instances/`。
 *   两者一旦各算各的，启动扫描就会去扫一个内核永远不碰的目录：崩在写
 *   instance.json 之前的半成品实例照样出现在 UI 列表里、照样启动不了
 *   （详见 packages/kernel-java/src/kernel.ts 的 list_instances 分支）。
 *   kernel-runtime.test.ts 有一条断言专门守这件事：`runtime.dataDir` 必须与
 *   传给 runStartupRecovery 的 kernelRoot 是**同一个字符串**。
 *
 * 取值理由（为什么是 userData/mc-creator/kernel）见 kernel-runtime.ts 文件头注释。
 * 初始化必须在本函数之前完成 —— 拿不到 dataDir 就没法给出正确的 kernelRoot。
 */
function runStartupRecoveryScan(): void {
  try {
    // 内核未初始化时传 undefined：此时只有 userData/projects 的 *.tmp 清理生效，
    // 与本函数改造前的行为完全一致（清理是尽力而为，绝不拦住启动）。
    const report = runStartupRecovery({
      userDataDir: app.getPath('userData'),
      kernelRoot: getKernelRuntime()?.dataDir,
      apply: true,
    });
    const line = formatRecoveryReport(report);
    if (line !== null) console.log(line);
    for (const err of report.errors) console.warn('[§14 半成品检测]', err);
  } catch (e) {
    // 清理是尽力而为的维护动作，绝不能拦住应用启动
    console.warn('[§14 半成品检测] 启动扫描异常：', e);
  }
}

/**
 * 初始化内核宿主（§4.2）。
 *
 * 放在 `app.whenReady()` 之后：dataDir 依赖 `app.getPath('userData')`，且内核
 * 构造本身不做任何 I/O（只是 new 三个持有路径的对象），所以**不引入启动阻塞**。
 * 三个内核共用同一个 dataDir —— 理由与代价见 kernel-runtime.ts 文件头注释。
 *
 * confirm 闸门接原生对话框（§10.6）。**永远显式传**，不省略：内核在缺 confirm 时
 * 一律拒绝 W/X，省略会把「闸门接好了」和「闸门根本没接」变成同一个现象。
 */
function initKernels(): void {
  const dataDir = resolveKernelRoot(app.getPath('userData'));
  initKernelRuntime({ dataDir, confirm: createNativeConfirm() });
  console.log(`[§10 内核] 已装配 java / server / bedrock，dataDir=${dataDir}`);
}

/**
 * §7.4 定时任务轮询器单例（R2c，外壳侧）。
 * 增值后台任务：启动/运行失败绝不拦住应用启动与退出（见 whenReady / before-quit）。
 */
let taskPoller: TaskPoller | null = null;

/**
 * §10.1 智能体独立进程自启（任务 W1：`agent-host.ts` 此前是死代码）。
 *
 * `createAgentHost` 写好且测透了，但生产入口从未调用它 —— 智能体进程**从来没起来过**。
 * 这里把它接到 whenReady 上，补上最后一段「起 → 退出必停」的生命周期。
 *
 * ## 三条硬约束（主代理拍板）
 *
 * 1. **try/catch 包裹，失败只 warn**：智能体是增值能力，它起不来绝不能拦住应用启动
 *    （与 taskPoller 同一范式、同一句式）。spawn 失败 / 端口被占 / node 不在 PATH
 *    全部落在 warn 里，应用照常进主界面。
 * 2. **before-quit 必须停它**：见文件末尾的收尾链。窗口关了主进程还在，但主进程
 *    自己退出时智能体必须跟着走，否则它会变成孤儿进程占着 3001 端口。
 * 3. **路径全部自动推导，零硬编码**：dataDir 用
 *    `resolveAgentDataDir(app.getPath('userData'))`，port/host/path 走 agent-host
 *    的缺省（与 `packages/agent` 的 `main(['--http'])` 一致）。写死路径在这里等于
 *    把「打包后在别人机器上起不来」变成必然事件。
 *
 * ## 为什么给智能体一个**专用** supervisor，而不是复用 `getProcessSupervisor()` 单例
 *
 * 实测（读源码确认，非推测）：单例由 `createProcessSupervisor()` 无参构造，
 * **没有 confirm**；而 `Supervisor.spawnManaged` 在 confirm 缺失时一律
 * `throw ProcessSupervisorError('PERMISSION_DENIED')`。所以拿单例去 start() 必然
 * 抛错 —— 那样只是把「智能体永不启动」换成了「智能体启动时报一条 warn」，假接线。
 *
 * 代价（明说）：智能体托管在另一个 supervisor 实例上，因此
 * 1. 它**不出现在**渲染层的 PROCESS_LIST（那读的是单例）；
 * 2. 单例的 `shutdownAll()` 收不到它 —— 所以退出收尾里必须显式 `agentHost.stop()`，
 *    这也正是「把 supervisor 私有引用留在 AgentHost 句柄里」的价值所在。
 *
 * ## confirm 为什么不是 `() => true`（主代理驳回过一次）
 *
 * 子代理初版给了恒真闸门，理由是「自启没有可确认的用户意图」。**驳回**：
 * 恒真 = 给这个实例开永久通行证，今后复用它 launch 任何命令都无条件放行，
 * 正是 §10.6 守的那条线。改用 `createAgentSelfStartConfirm`：只放行
 * `buildAgentCommand` 拼出的那一条命令（cmd + 全部 args 逐字节比对），
 * 端口/dataDir/脚本任一变化期望值随之重算，其余请求一律 false。
 * 单例的 fail-closed 语义仍一个字节未动。
 */
let agentHost: AgentHost | null = null;

/** 开机自启的固定放行闸门：窄口径，只放行本函数拼出的那一条命令（见 createAgentSelfStartConfirm）。 */
function startAgentHost(): void {
  try {
    // userDataDir 必传（agent-host 不 import electron），dataDir 显式走 resolveAgentDataDir
    // 而不是留缺省：让「智能体数据落在 <userData>/mc-creator/agent」在接线处一眼可见。
    const userDataDir = app.getPath('userData');
    const dataDir = resolveAgentDataDir(userDataDir);
    agentHost = createAgentHost(
      createProcessSupervisor({ confirm: createAgentSelfStartConfirm({ userDataDir, dataDir }) }),
      { userDataDir, dataDir },
    );
    agentHost.start();
    console.log(`[§10.1 智能体] 独立进程已拉起，dataDir=${dataDir}`);
  } catch (e) {
    // 自启失败只 warn：绝不拦应用启动（与 taskPoller 的失败处理同款取向）。
    console.warn('[§10.1 智能体] 独立进程启动失败（不影响主流程）:', e);
  }
}

app.whenReady().then(() => {
  // §4.1 第二道闸：quit 分支已调 app.quit()，这里直接返回，绝不初始化内核。
  if (instanceRole !== 'primary') return;
  initKernels();
  runStartupRecoveryScan();
  registerIpcHandlers(createDefaultOrchestrator);
  // X2a UI 确认接线（§10.6）：W/X 执行走渲染层确认框，降级链 "UI → 原生 dialog"。
  // getWindow 闭包在确认请求到达时才取值，故放在 createWindow 之前装配无妨；
  // setConfirm 需运行时已存在，故放在 initKernels 之后。
  const uiConfirm = createUiConfirm({
    getWindow: () => BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null,
    fallback: createNativeConfirm(),
  });
  ipcMain.handle(KERNEL_CONFIRM_RESPONSE, (_e, raw: unknown): void => {
    uiConfirm.handleResponse(KernelConfirmResponse.parse(raw));
  });
  getKernelRuntime()?.setConfirm(uiConfirm);
  // §7.4 定时轮询器（R2c）：registerIpcHandlers 之后启动（runtime 已就绪）。
  // try/catch 包裹：轮询器是增值功能，启动失败只 warn，绝不拦住应用启动。
  try {
    taskPoller = createTaskPoller({
      getRuntime: getKernelRuntime,
      supervisor: getProcessSupervisor(),
    });
    taskPoller.start();
  } catch (e) {
    console.warn('[定时任务] 轮询器启动失败（不影响主流程）：', e);
  }
  // §10.1 智能体独立进程自启（W1）：同样 try/catch，失败只 warn，不拦应用启动。
  // 放在 registerIpcHandlers / 轮询器之后 —— supervisor 单例与内核运行时都已就绪。
  startAgentHost();
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
 *
 * 内核宿主的 release 也挂在这条链上：先停机（内核产物派生的进程必须先收），
 * 再 dispose 内核宿主。这样即使将来给内核加上后台任务，也不会在进程还活着时
 * 被提前释放。
 */
let supervisorShutdownDone = false;
app.on('before-quit', (event) => {
  if (supervisorShutdownDone) return;
  event.preventDefault();
  supervisorShutdownDone = true;
  // R2c：先停轮询再走既有收尾，避免退出过程中又打出一轮 run_due_tasks。
  try {
    taskPoller?.stop();
  } catch {
    // 停轮询失败不拦退出。
  }
  taskPoller = null;
  // §10.1 智能体（W1）：先停独立进程再走既有收尾。未自启成功时 stop() 是安全空操作
  // （agent-host 的既定语义，调用方无需先查状态），所以这里无需判空分支之外的任何条件。
  // 它托管在专用 supervisor 上，单例的 shutdownAll() 收不到它 —— 这一句是唯一的停机点。
  // 接进同一条 Promise 链（而不是 fire-and-forget）：app.quit() 一旦跑完主进程就没了，
  // 没停掉的智能体会变成占着 3001 端口的孤儿进程。停机失败/超时仍不拦退出（下方 catch）。
  const agentHostStopped = agentHost === null ? Promise.resolve() : agentHost.stop();
  agentHost = null;
  void agentHostStopped
    .catch(() => undefined)
    .then(() => getProcessSupervisor().shutdownAll())
    .catch(() => undefined)
    .finally(() => {
      getKernelRuntime()?.dispose();
      app.quit();
    });
});
