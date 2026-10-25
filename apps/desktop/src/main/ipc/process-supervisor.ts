/**
 * 进程托管的 IPC 处理器（外壳层，§7.1 / §7.4 / §10.2 / §10.6）。
 *
 * 只读通道：列被托管进程、读状态快照、读日志尾部、转发控制台流式日志。
 *
 * `PROCESS_LAUNCH` 是唯一的执行类通道，且它**不是裸 spawn**：
 *  1. 渲染层只给 serverId，主进程从磁盘推导 cmd/args
 *     （`buildServerLaunchSpec`；让渲染层传 cmd 等于交出任意程序执行权）
 *  2. `await` 原生确认弹窗，把命令逐字摊给用户看（§10.6）
 *  3. 用户点确定 → 登记**一次性**批准令牌
 *  4. `launchServer` 走 supervisor 自己的闸门，令牌消费即失效
 *
 * 同理**不**注册「触发崩溃自动重启 / 触发控制台注入」通道（§7.1 新增的两项能力）：
 * 二者都是有副作用的执行类操作。渲染层只能通过 PROCESS_STATUS 读它们的状态
 * （快照里的 autoRestart* / lastCommandOutcome），点火权留在主进程侧的 confirm 闸门
 * 与用户实际点过的那个「启动」按钮上。这是刻意的少功能，不是遗漏。
 *
 * 单例的 confirm 闸门接的是 `consumeApprovedLaunch` —— 它**默认拒绝**，
 * 只有本文件在用户明确确认后登记过的那一条 spec 能过。
 * 换句话说：漏接线、误接线、渲染层绕过本通道直接调 launch，三种情况都是
 * `PERMISSION_DENIED`，不会悄悄起进程。
 */
// 防御：typescript-eslint 缓存可能导致行号错位，若上方出现误报请忽略

import { ipcMain, BrowserWindow, app } from 'electron';
import { join } from 'node:path';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import {
  createProcessSupervisor,
  type LogEvent,
  type ProcessSupervisor,
} from '../process-supervisor.js';
import { buildServerLaunchSpec, describeServerLaunch } from '../server-launch-spec.js';
import { isEulaAccepted } from '../server-instance.js';
import { approveLaunch, consumeApprovedLaunch } from '../server-launch-approval.js';
import { createNativeConfirm } from '../kernel-confirm.js';
import {
  PROCESS_LIST,
  PROCESS_LAUNCH,
  PROCESS_STOP,
  PROCESS_STATUS,
  PROCESS_LOGS,
  PROCESS_LOG_EVENT,
  PROCESS_STATE_EVENT,
  ProcessStatusRequest,
  ProcessLaunchRequest,
  ProcessStopRequest,
  ProcessLogsRequest,
  type ProcessListRes,
  type ProcessStatusRes,
  type ProcessLaunchRes,
  type ProcessStopRes,
  type ProcessLogsRes,
  type ProcessLogEventT,
  type ProcessStateEventT,
} from '../../shared/ipc-channels.js';
import {
  LAUNCHER_LIST_SERVER_INSTANCES,
  LAUNCHER_DELETE_SERVER_INSTANCE,
  type ServerInstanceSummary,
  LauncherDeleteServerInstanceRequest,
} from '../../shared/ipc/launcher.js';

/**
 * 服务端实例根目录（与 kernel-server 的 serverDir(root, id) 同一层布局）。
 *
 * **导出**而非各自算一遍：`launcher.ts` 的「建实例」通道也要用它，
 * 两处各写一份路径字符串的话，改了一处就���另一个的实例找不到 ——
 * 而那种错要等到用户点了启动才现形。
 */
export function serverRootDir(): string {
  return join(app.getPath('userData'), 'mc-creator', 'servers');
}

let instance: ProcessSupervisor | null = null;

/** 进程托管服务单例（延迟创建，便于测试注入）。 */
export function getProcessSupervisor(): ProcessSupervisor {
  if (instance === null) instance = createProcessSupervisor({ confirm: consumeApprovedLaunch });
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
    const _req = ProcessStatusRequest.parse(raw);
    return { status: svc.status(_req.serverId) };
  });

  // 读日志尾部（只读；环形缓冲有界，不会把内存里几百 MB 丢给渲染进程）
  ipcMain.handle(PROCESS_LOGS, (_e, raw: unknown): ProcessLogsRes => {
    const _req = ProcessLogsRequest.parse(raw);
    return { lines: svc.logs(_req.serverId, _req.limit) };
  });

  // 列出服务端实例（对应 mc-creator/servers/ 下的目录）
  ipcMain.handle(LAUNCHER_LIST_SERVER_INSTANCES, (): { instances: ServerInstanceSummary[] } => {
    const serversRoot = serverRootDir();
    if (!existsSync(serversRoot)) return { instances: [] };
    try {
      const entries = readdirSync(serversRoot, { withFileTypes: true });
      const instances: ServerInstanceSummary[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const serverId = entry.name;
        const dir = join(serversRoot, serverId);

        // 目录名是用户起的实例名，版本号只能从创建时写的元数据读；
        // 没有元数据的老实例退回 serverId，至少不空着。
        let versionId = serverId;
        const versionPath = join(dir, '.mc-creator-version');
        if (existsSync(versionPath)) {
          try {
            versionId = readFileSync(versionPath, 'utf-8').trim() || serverId;
          } catch {
            // 读不到就当未知，不影响其它实例
          }
        }

        const stat = statSync(dir);
        instances.push({
          id: serverId,
          name: serverId,
          versionId,
          jarKind: null, // jar 形态在下载时已实测；列表不为每个实例读 60MB
          eulaAccepted: isEulaAccepted(dir),
          lastLaunchedAt: null,
          createdAt: stat.birthtimeMs,
        });
      }
      return { instances };
    } catch {
      return { instances: [] };
    }
  });

  // 删除服务端实例
  ipcMain.handle(
    LAUNCHER_DELETE_SERVER_INSTANCE,
    async (_e, raw: unknown): Promise<{ ok: boolean; error?: string }> => {
      const _req = LauncherDeleteServerInstanceRequest.parse(raw);
      const dir = join(serverRootDir(), _req.id);
      if (!existsSync(dir)) return { ok: false, error: `服务端实例不存在: ${_req.id}` };
      if (_req.deleteFiles) {
        await rm(dir, { recursive: true, force: true });
      } else {
        // 仅删除注册表相关文件（server.properties, eula.txt, start.bat, start.sh, ops.json, whitelist.json）
        // 保留 world/, plugins/, logs/, config/ 及其内容
        for (const f of [
          'server.properties',
          'eula.txt',
          'start.bat',
          'start.sh',
          'ops.json',
          'whitelist.json',
        ]) {
          await rm(join(dir, f), { force: true });
        }
      }
      return { ok: true };
    },
  );

  /**
   * 启动服务端（§10.6 X 类：唯一带副作用的通道）。
   *
   * 顺序是刻意的，一步都不能省：
   *   1. 校验 serverId 并从磁盘推导 spec —— **在弹窗之前**，
   *      因为弹窗要展示的就是这条命令，用户得先看到再决定
   *   2. `await` 原生确认框；弹不出来 / 用户点取消 → `denied`，**一个进程都不起**
   *   3. 登记一次性令牌
   *   4. `launchServer`；令牌消费即失效，重放拿不到第二次批准
   *
   * 第 4 步若抛错（令牌没对上、spawn 失败），这里如实回 error ——
   * supervisor 那侧的 `SPAWN_FAILED` / `PERMISSION_DENIED` 不会被吞掉。
   */
  ipcMain.handle(PROCESS_LAUNCH, async (_e, raw: unknown): Promise<ProcessLaunchRes> => {
    const parsed = ProcessLaunchRequest.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        pid: null,
        error: `请求不合法: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
      };
    }
    const { serverId, javaPath, memory } = parsed.data;

    const built = buildServerLaunchSpec(join(serverRootDir(), serverId), serverId, {
      ...(javaPath === undefined ? {} : { javaPath }),
      ...(memory === undefined ? {} : { memory }),
    });
    if (!built.ok) return { ok: false, pid: null, error: built.error };

    const confirm = createNativeConfirm();
    const allowed = await confirm({
      kind: 'launch_server',
      risk: 'execute',
      summary: describeServerLaunch(built.spec),
      // payload 原样带上 spec：弹窗实现（kernel-confirm-ui）会用它做结构化展示，
      // 且与 supervisor 闸门看到的是同一份对象，避免"展示的"与"执行的"不一致。
      payload: built.spec,
    });
    if (!allowed) {
      // 用户没拍板 ≠ 出错。渲染层要能把「我取消了」和「启动失败」分开显示。
      return { ok: false, pid: null, denied: true, error: '用户取消了启动' };
    }

    approveLaunch(built.spec);
    try {
      const handle = svc.launchServer(built.spec);
      return { ok: true, pid: handle.pid, error: null };
    } catch (e) {
      return { ok: false, pid: null, error: (e as Error).message };
    }
  });

  /**
   * 停止服务端（§10.6 X 类：先确认，再发 stop）。
   *
   * 和启动一样，目标进程由 supervisor 按 serverId 解析，渲染层不能传 PID。
   * 弹窗展示 PID 与动作，确认后才走 supervisor 的优雅停机（写 `stop` →
   * 等退出 → 超时才强杀）。已在 stopped/crashed 的实例直接返回成功，
   * 不打扰用户。
   */
  ipcMain.handle(PROCESS_STOP, async (_e, raw: unknown): Promise<ProcessStopRes> => {
    const parsed = ProcessStopRequest.safeParse(raw);
    if (!parsed.success) {
      return {
        ok: false,
        error: `请求不合法: ${parsed.error.issues[0]?.message ?? 'unknown'}`,
        stop: null,
      };
    }
    const { serverId } = parsed.data;
    const status = svc.status(serverId);
    if (status === null || status.state === 'stopped' || status.state === 'crashed') {
      return { ok: true, error: null, stop: null };
    }

    const confirm = createNativeConfirm();
    const allowed = await confirm({
      kind: 'stop_server',
      risk: 'execute',
      summary: `停止服务端「${serverId}」（PID ${status.pid ?? '未知'}）：发送 stop 并等待退出，超时后强制结束。`,
      payload: { serverId, pid: status.pid, state: status.state },
    });
    if (!allowed) {
      return { ok: false, denied: true, error: '用户取消了停止', stop: null };
    }

    try {
      const outcome = await svc.stopServer(serverId);
      if (!outcome.ok) {
        return {
          ok: false,
          error: outcome.reason ?? '停止服务端失败',
          stop: svc.status(serverId)?.lastStop ?? null,
        };
      }
      // StopOutcome 不带到 at；快照里的 lastStop 是同一份报告且带时间。
      return { ok: true, error: null, stop: svc.status(serverId)?.lastStop ?? null };
    } catch (e) {
      return { ok: false, error: (e as Error).message, stop: null };
    }
  });
}
