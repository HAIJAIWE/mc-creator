/**
 * 一次性启动批准令牌（§10.6 闸门与 supervisor 同步 confirm 之间的桥）。
 *
 * ## 为什么需要它
 *
 * `ProcessSupervisor` 的确认闸门是**同步**的（`ConfirmFn → boolean`），
 * 文件里的注释写明了设计意图：
 *
 * > launch 是同步接口，异步确认（Electron dialog.showMessageBox 返回 Promise）
 * > 必须由 IPC 层先 await 再调 launch
 *
 * 但问题是：用户点「确定」时**进程还没被构造**，弹窗里要展示的正是那条命令。
 * 于是顺序必须是：
 *
 *   1. 主进程从磁盘**推导**出 spec（渲染层不能传 cmd —— 它会以用户权限 spawn）
 *   2. `await` 原生确认弹窗，把 spec 逐字展示给用户
 *   3. 用户点确定 → 为**这一条 spec** 登记一枚一次性令牌
 *   4. 调 `launchServer(spec)`；supervisor 的 confirm 在此刻查表放行
 *
 * ## 三条安全性质
 *
 * 1. **一次性**：令牌被消费即删除，重放同一个请求拿不到第二次批准。
 * 2. **逐字节绑定**：指纹由 `serverId + cmd + 全部 args + cwd` 拼成，
 *    命令差一个字符就是另一枚指纹 —— 与 `createAgentSelfStartConfirm`
 *    的「逐字节比对」同一套纪律。
 * 3. **默认拒绝**：查不到指纹一律 false。没有人登记过 = 没人批准过。
 *
 * ## 为什么不是每次新建一个 supervisor
 *
 * 智能体自启走的就是那个路子，代价是它的进程**不进渲染层的 `PROCESS_LIST`**
 * （单例才是列表读的对象）。而定时任务的 `restartServer(serverId)`
 * 必须在单例里找得到 entry，否则又是 `SERVER_NOT_FOUND`。
 * 令牌方案让进程留在单例里，代价只是多一张指纹表。
 */

import type { ServerLaunchSpec } from './server-launch-spec.js';

/**
 * 启动指纹。刻意包含**每一个**参与 spawn 的字段：
 * 少一个字段，就等于给"批准 A、执行 B"留了一条缝。
 */
export function launchFingerprint(spec: ServerLaunchSpec): string {
  return JSON.stringify([spec.serverId, spec.cmd, spec.args, spec.cwd]);
}

/** 待消费的批准指纹集合。进程内生命周期，不落盘 —— 重启即失效（fail-closed）。 */
const approved = new Set<string>();

/**
 * 为一条 spec 登记一次性批准。
 *
 * 必须在**用户明确点了确定之后**才调用；在此之前调用等于把闸门作废。
 */
export function approveLaunch(spec: ServerLaunchSpec): void {
  approved.add(launchFingerprint(spec));
}

/**
 * 闸门函数：命中则消费并放行，否则拒绝。
 *
 * 直接作为 `createProcessSupervisor({ confirm })` 的入参。
 */
export function consumeApprovedLaunch(req: unknown): boolean {
  if (typeof req !== 'object' || req === null) return false;
  const payload = (req as { payload?: unknown }).payload;
  if (typeof payload !== 'object' || payload === null) return false;
  const { cmd, args, cwd, serverId } = payload as {
    cmd?: unknown;
    args?: unknown;
    cwd?: unknown;
    serverId?: unknown;
  };
  if (typeof cmd !== 'string' || !Array.isArray(args) || typeof cwd !== 'string') return false;
  if (typeof serverId !== 'string' || args.some((a) => typeof a !== 'string')) return false;

  const fp = launchFingerprint({ serverId, cmd, args, cwd });
  if (!approved.has(fp)) return false;
  // 一次性：消费即删除
  approved.delete(fp);
  return true;
}

/** 仅供测试：清空所有未消费的令牌 */
export function __resetApprovals(): void {
  approved.clear();
}

/** 仅供测试/诊断：当前有多少枚未消费的令牌 */
export function __pendingApprovalCount(): number {
  return approved.size;
}
