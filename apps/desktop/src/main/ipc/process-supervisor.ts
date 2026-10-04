/**
 * 进程托管的 IPC 处理器（外壳层，§7.1 / §7.4 / §10.2 / §10.6）。
 *
 * 只注册**只读**通道：列被托管进程、读状态快照、读日志尾部、转发控制台流式日志。
 * 刻意不注册「直接启动 / 停止」通道：启动服务端是 X 类任务，必须先经内核
 * 确认闸门弹窗（§10.6）。给渲染层一个裸 spawn 通道就等于把闸门作废。
 *
 * 同理**不**注册「触发崩溃自动重启 / 触发控制台注入」通道（§7.1 新增的两项能力）：
 * 二者都是有副作用的执行类操作。渲染层只能通过 PROCESS_STATUS 读它们的状态
 * （快照里的 autoRestart* / lastCommandOutcome），点火权留在主进程侧的 confirm 闸门
 * 与用户实际点过的那个「启动」按钮上。这是刻意的少功能，不是遗漏。
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
  PROCESS_STATE_EVENT,
  ProcessStatusRequest,
  ProcessLogsRequest,
  type ProcessListRes,
  type ProcessStatusRes,
  type ProcessLogsRes,
  type ProcessLogEventT,
  type ProcessStateEventT,
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

  /**
   * 状态变更事件转发（含自动重启事件）。
   *
   * 为什么必须推而不只靠轮询：自动重启有 1s 起步的退避，轮询会让 UI 最多滞后
   * 一个周期才反映「正在重启 / 已放弃重启」—— 而崩溃瞬间的告警恰恰是最该让人
   * 看见的时刻，滞后一秒就把这个语义丢了。
   *
   * `invalid-transition` 一并转出去但不当作告警：它是内核流转 bug 的信号
   * （UI 该记日志/上报），不是用户需要处理的事，所以不混进告警类事件。
   */
  svc.on('state', (status) => {
    forward({ serverId: status.serverId, status, event: 'state' });
  });
  for (const event of [
    'auto-restart-scheduled',
    'auto-restart-rejected',
    'auto-restart-exhausted',
  ] as const) {
    svc.on(event, (status: { serverId: string }) => {
      // 这三个事件带的是状态标识而非完整快照，这里补齐快照再转发，
      // 让渲染层不必为了拿 autoRestart* 字段再查一次。
      const snapshot = svc.status(status.serverId);
      if (snapshot === null) return;
      forward({ serverId: status.serverId, status: snapshot, event });
    });
  }
  svc.on('invalid-transition', (e: { serverId: string }) => {
    const snapshot = svc.status(e.serverId);
    if (snapshot === null) return;
    forward({ serverId: e.serverId, status: snapshot, event: 'invalid-transition' });
  });

  function forward(payload: ProcessStateEventT): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(PROCESS_STATE_EVENT, payload);
    }
  }

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
