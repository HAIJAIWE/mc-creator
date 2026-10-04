/**
 * 进程托管的 IPC 处理器（外壳层，§7.1 / §7.4 / §10.2 / §10.6）。
 *
 * 只注册**只读**通道：列被托管进程、读状态快照、读日志尾部、转发控制台流式日志。
 * 刻意不注册「直接启动 / 停止」通道：启动服务端是 X 类任务，必须先经内核
 * 确认闸门弹窗（§10.6）。给渲染层一个裸 spawn 通道就等于把闸门作废。
 *
 * 单例的 confirm 闸门**故意不给**：createProcessSupervisor 在没有 confirm 时
 * 永远拒绝 spawn（PERMISSION_DENIED）。这样即使将来有人误接线 launch，
 * 也会显式报错而不是悄悄起进程。真正的启动路径应由调用方在弹窗确认后
 * 用注入了自己 confirm 的实例执行。
 */
import { ipcMain, BrowserWindow } from 'electron';
import {
  createProcessSupervisor,
  type LogEvent,
  type ProcessSupervisor,
} from '../process-supervisor.js';
import {
  PROCESS_LIST,
  PROCESS_STATUS,
  PROCESS_LOGS,
  PROCESS_LOG_EVENT,
  ProcessStatusRequest,
  ProcessLogsRequest,
  type ProcessListRes,
  type ProcessStatusRes,
  type ProcessLogsRes,
  type ProcessLogEventT,
} from '../../shared/ipc-channels.js';

let instance: ProcessSupervisor | null = null;

/** 进程托管服务单例（延迟创建，便于测试注入）。 */
export function getProcessSupervisor(): ProcessSupervisor {
  if (instance === null) instance = createProcessSupervisor();
  return instance;
}

/** 仅供测试：替换单例。 */
export function setProcessSupervisor(svc: ProcessSupervisor | null): void {
  instance = svc;
}

export function registerProcessSupervisorHandlers(): void {
  const svc = getProcessSupervisor();

  // 控制台流式日志（§7.4）：主进程是转发方，渲染进程只展示。
  // 监听器挂在单例上，整个应用生命周期只挂一次。
  svc.on('log', (e: LogEvent) => {
    const payload: ProcessLogEventT = {
      serverId: e.serverId,
      stream: e.stream,
      line: e.line,
      at: e.at,
    };
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(PROCESS_LOG_EVENT, payload);
    }
  });

  // 列出所有被托管进程（只读）
  ipcMain.handle(PROCESS_LIST, (): ProcessListRes => ({ processes: svc.list() }));

  // 读单个进程状态快照（只读）
  ipcMain.handle(PROCESS_STATUS, (_e, raw: unknown): ProcessStatusRes => {
    const req = ProcessStatusRequest.parse(raw);
    return { status: svc.status(req.serverId) };
  });

  // 读日志尾部（只读；环形缓冲有界，不会把内存里几百 MB 丢给渲染进程）
  ipcMain.handle(PROCESS_LOGS, (_e, raw: unknown): ProcessLogsRes => {
    const req = ProcessLogsRequest.parse(raw);
    return { lines: svc.logs(req.serverId, req.limit) };
  });
}
