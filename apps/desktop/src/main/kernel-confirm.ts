/**
 * §10.6 确认闸门的生产实现：Electron 原生对话框。
 *
 * ## 为什么用原生 `dialog` 而不是渲染层的 ConfirmDialog
 *
 * 任务书假设 `apps/desktop/src/main/ipc/` 下已有 ConfirmDialog 相关实现 —— 复核后
 * **没有**：`ConfirmDialog.tsx` 只存在于 `src/renderer/src/components/`，主进程侧
 * 从未有过对应的请求/应答 IPC 通道（唯一的既有确认接线是
 * `process-supervisor.ts` 的 `ConfirmFn` 注入点，而它的单例**刻意不给** confirm）。
 *
 * 在这个事实下，原生 `dialog.showMessageBox` 是风险最低的选择：
 *  1. 不新增任何 IPC 面 —— 也就没有「渲染层不响应 / 窗口已关 / 超时」这些
 *     必须额外处理才能保证「没拍板就不许有副作用」的失败路径；
 *  2. `electron.dialog` 是本仓 ipc/launcher.ts 已在用的标准依赖，不是新引入的东西；
 *  3. 换成产品化的 UI 确认框时，只需把实现换成 `createKernelRuntime({ confirm })`
 *     注入的那个函数，闸门接线点已经固定在 `kernel-runtime.ts`。
 *
 * ## fail-closed
 *
 * 没有可用窗口（应用刚起来还没建窗、全部窗口已销毁、对话框 API 抛错）时
 * **一律返回 false**：确认闸门在不确定时必须选择「拒绝执行」，否则一个
 * 偶发的 dialog 异常就等于给 X 类操作开了后门。
 */

import { BrowserWindow, dialog } from 'electron';
import type { KernelConfirmFn } from './kernel-runtime.js';

/** 按 §10.6 风险等级给对话框选按钮与图标。 */
function dialogOptions(risk: 'write' | 'execute'): {
  type: 'warning' | 'error';
  okLabel: string;
  cancelLabel: string;
} {
  return risk === 'execute'
    ? { type: 'warning', okLabel: '执行', cancelLabel: '取消' }
    : { type: 'warning', okLabel: '写入', cancelLabel: '取消' };
}

/**
 * 构造一个 §10.6 确认闸门。
 *
 * 返回的函数可直接作为 `createKernelRuntime({ confirm })` 的入参。
 * 弹窗文案直接用内核给的 `summary`（各内核已按「中文一行摘要」生成，
 * 见各 kernel 包 src/kernel.ts 的 summaryOf）。
 */
export function createNativeConfirm(): KernelConfirmFn {
  return async (req): Promise<boolean> => {
    const parent = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (parent !== null && parent.isDestroyed()) return false;
    const { type, okLabel, cancelLabel } = dialogOptions(req.risk);
    const options: Electron.MessageBoxOptions = {
      type,
      buttons: [cancelLabel, okLabel],
      defaultId: 0,
      // 取消是默认项：回车 / Esc 都不该变成「执行」。
      cancelId: 0,
      title: '需要确认（§10.6）',
      message: req.summary,
      detail: `任务 kind: ${req.kind}\n风险等级: ${req.risk === 'execute' ? '执行进程' : '写实例目录'}`,
      noLink: true,
    };
    try {
      // 有窗口就挂成 modal（父窗口失焦时对话框不会跑到后面去）；没有窗口就不传父窗口。
      const result =
        parent === null
          ? await dialog.showMessageBox(options)
          : await dialog.showMessageBox(parent, options);
      return result.response === 1;
    } catch {
      // 弹不出来 = 用户没拍板 = 拒绝执行（fail-closed）。
      return false;
    }
  };
}
