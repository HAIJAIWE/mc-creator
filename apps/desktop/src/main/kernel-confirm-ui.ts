/**
 * X1 主进程侧 UI 确认（为开放 kernel:execute 做准备，本任务不开白名单）。
 *
 * ## 设计约束（主代理拍板，写进文件头）
 *
 * UI 确认是**新增攻击面**：确认请求要发往可能存在 XSS 的渲染进程，
 * 一个被注入的渲染层可以伪造「用户点了同意」—— 这是原生 dialog 没有的风险。
 * 缓解三件套缺一不可：
 *  1. **超时拒绝**：`timeoutMs`（默认 60s）内无应答一律 `false`；
 *  2. **并发请求 id 关联**：`Map<id, deferred>`，应答对不上 id 直接丢弃
 *     （伪造 / 迟到 / 串台的应答都落在这里，靠超时兜底为 `false`）；
 *  3. **审计**：沿用 `kernel-runtime.ts` 的 `confirmLog`（包装层统一记录，
 *     本模块不另建账本）；**renderer 侧不得删改** —— 审计写在主进程内存里，
 *     渲染层够不着，UI 确认的每次结果照记。
 *
 * ## fallback 语义（"UI→原生"链）
 *
 * 无可用窗口时本函数**默认直接返回 `false`**，绝不擅自弹原生框：
 * 调用方想保留原生兜底，必须显式传 `fallback: createNativeConfirm()`，
 * 形成 "UI → 原生 dialog" 的降级链。默认 `false` 的理由：静默降级会让调用方
 * 误以为走的是 UI 确认、实际弹的是原生框 —— 降级必须是看得见的选择。
 * `send` 抛错（发送瞬间窗口被销毁）同样走这条 fallback 路径。
 *
 * ## 可测性纪律（不 import electron）
 *
 * 本模块**不 import electron**（与 `kernel-runtime.ts` 同一条纪律）：
 * 窗口经 `getWindow` 注入（`{ webContents: { send }, isDestroyed }` 最小面，
 * 生产传 BrowserWindow，测试传 fake），应答经 `handleResponse` 注入。
 * 生产接线（X2 任务，不在本任务内）在主进程这样挂：
 * `ipcMain.handle(KERNEL_CONFIRM_RESPONSE, (_e, res) => confirm.handleResponse(res))`，
 * 渲染层收到 `KERNEL_CONFIRM_REQUEST` 的 send 后用
 * `ipcRenderer.invoke(KERNEL_CONFIRM_RESPONSE, { id, approved })` 应答。
 */

import { randomUUID } from 'node:crypto';
import { KERNEL_CONFIRM_REQUEST } from '../shared/ipc/channels.js';
import {
  KernelConfirmRequest as KernelConfirmWireRequest,
  KernelConfirmResponse as KernelConfirmWireResponse,
} from '../shared/ipc/kernel.js';
import type { KernelConfirmFn } from './kernel-runtime.js';

/** `getWindow` 注入的最小窗口面（生产是 BrowserWindow，测试是 fake）。 */
export interface UiConfirmWindow {
  isDestroyed(): boolean;
  webContents: {
    send(channel: string, payload: unknown): void;
  };
}

export interface UiConfirmOptions {
  /** 取当前窗口；返回 null / 已销毁都视为"无窗口"。 */
  getWindow: () => UiConfirmWindow | null;
  /**
   * 无窗口 / send 抛错时的降级。默认 undefined = 直接 `false`；
   * 想走 "UI→原生"链就显式传 `createNativeConfirm()`。
   */
  fallback?: KernelConfirmFn;
  /** 无应答超时（默认 60000）。超时一律 `false`（fail-closed）。 */
  timeoutMs?: number;
  /** 请求时间戳来源（默认 `Date.now`，测试可注入定值）。 */
  now?: () => number;
}

/**
 * `createUiConfirm` 的返回值：本身就是 `KernelConfirmFn`
 *（可直接传 `setConfirm`），外加 X2 接线用的应答入口。
 */
export interface UiConfirmHandle extends KernelConfirmFn {
  /**
   * 渲染层应答入口（X2 接线：`ipcMain.handle(KERNEL_CONFIRM_RESPONSE, ...)` 里调它）。
   * 形状不对 / id 对不上 pending → 静默丢弃（fail-closed，靠超时兜底为 `false`）。
   */
  handleResponse(res: unknown): void;
  /** 未完成的确认请求数（测试与诊断用）。 */
  pendingCount(): number;
}

/**
 * 构造一个走渲染层 UI 的 §10.6 确认闸门。
 *
 * 有窗口 → `webContents.send(KERNEL_CONFIRM_REQUEST, { id, kind, summary, risk,
 * requestedAt })` → 等 `handleResponse` 收到同 id 应答（`approved` 即结果）；
 * 超时 / 窗口销毁 / `approved=false` / 应答对不上 id，一律 `false`。
 */
export function createUiConfirm(opts: UiConfirmOptions): UiConfirmHandle {
  const timeoutMs = opts.timeoutMs ?? 60000;
  const now = opts.now ?? Date.now;
  const fallback = opts.fallback;
  const pending = new Map<
    string,
    { resolve: (v: boolean) => void; timer: ReturnType<typeof setTimeout> }
  >();

  function handleResponse(res: unknown): void {
    const parsed = KernelConfirmWireResponse.safeParse(res);
    if (!parsed.success) return; // 形状不对 → 丢弃
    const entry = pending.get(parsed.data.id);
    if (entry === undefined) return; // 对不上 id → 丢弃（伪造/迟到/串台）
    pending.delete(parsed.data.id);
    clearTimeout(entry.timer);
    const win = opts.getWindow();
    if (win === null || win.isDestroyed()) {
      entry.resolve(false); // 应答回来时窗口已经没了 = 用户没机会拍板
      return;
    }
    entry.resolve(parsed.data.approved);
  }

  const confirmFn: KernelConfirmFn = async (req) => {
    const win = opts.getWindow();
    if (win === null || win.isDestroyed()) {
      if (fallback === undefined) return false;
      try {
        return await fallback(req);
      } catch {
        return false;
      }
    }
    const wireReq = {
      id: randomUUID(),
      kind: req.kind,
      summary: req.summary,
      risk: req.risk,
      requestedAt: now(),
    };
    // 线上形状必须一次过 schema（过不了说明调用方给的东西连展示都不配，直接拒）。
    if (!KernelConfirmWireRequest.safeParse(wireReq).success) return false;
    const gate = new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(wireReq.id);
        resolve(false);
      }, timeoutMs);
      pending.set(wireReq.id, { resolve, timer });
    });
    try {
      win.webContents.send(KERNEL_CONFIRM_REQUEST, wireReq);
    } catch {
      // 发送瞬间窗口没了：按"无窗口"处理（清掉刚挂的 pending，走 fallback/直接 false）。
      const entry = pending.get(wireReq.id);
      if (entry !== undefined) {
        pending.delete(wireReq.id);
        clearTimeout(entry.timer);
      }
      if (fallback === undefined) return false;
      try {
        return await fallback(req);
      } catch {
        return false;
      }
    }
    const approved = await gate;
    if (!approved) return false;
    // 等待期间窗口被销毁 = 用户没机会拍板，照样拒绝。
    const live = opts.getWindow();
    if (live === null || live.isDestroyed()) return false;
    return true;
  };

  const handle = confirmFn as UiConfirmHandle;
  handle.handleResponse = handleResponse;
  handle.pendingCount = () => pending.size;
  return handle;
}
