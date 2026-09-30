/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain, dialog } from 'electron';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import {
  NODE_GRAPH_SAVE,
  NODE_GRAPH_LOAD,
  NODE_GRAPH_SHOW_SAVE_DIALOG,
  NODE_GRAPH_SHOW_OPEN_DIALOG,
  NodeGraphSaveRequest,
  NodeGraphLoadRequest,
  NodeGraphShowSaveDialogRequest,
} from '../../shared/ipc-channels.js';

export function registerNodeGraphHandlers(): void {
  // === 节点图持久化（保存/加载到磁盘 + 文件对话框）===
  // 渲染层通过 window.api.nodeGraph.* 调用，主进程只做 fs 读写与 dialog 弹框。
  // 最近列表由渲染层用 localStorage 维护，主进程不参与（便于无 Electron 环境测试）。

  /**
   * 将已序列化的节点图 JSON 字符串写入指定路径。
   * 不弹对话框（调用方需先调 showSaveDialog 取得路径）。
   * 写入失败时返回 { ok: false, error }，不抛错。
   */
  ipcMain.handle(
    NODE_GRAPH_SAVE,
    async (_e, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
      const req = NodeGraphSaveRequest.parse(raw);
      try {
        // 确保父目录存在（用户可能选了不存在的新路径）
        await mkdir(dirname(req.filePath), { recursive: true });
        await writeFile(req.filePath, req.json, 'utf-8');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `写入文件失败：${(err as Error).message}` };
      }
    },
  );

  /**
   * 读取指定路径的节点图 JSON 字符串。
   * 不弹对话框（调用方需先调 showOpenDialog 取得路径）。
   * 读取失败时返回 { ok: false, error }，不抛错。
   */
  ipcMain.handle(
    NODE_GRAPH_LOAD,
    async (
      _e,
      raw: unknown,
    ): Promise<{ ok: true; json: string } | { ok: false; error: string }> => {
      const req = NodeGraphLoadRequest.parse(raw);
      try {
        const json = await readFile(req.filePath, 'utf-8');
        return { ok: true, json };
      } catch (err) {
        return { ok: false, error: `读取文件失败：${(err as Error).message}` };
      }
    },
  );

  /**
   * 弹出保存对话框，让用户选择 .json 路径。
   * 默认文件名由调用方传入（一般是 `${modId}-node-graph.json`）。
   * 用户取消时返回 { ok: false }，不抛错。
   */
  ipcMain.handle(
    NODE_GRAPH_SHOW_SAVE_DIALOG,
    async (_e, raw: unknown): Promise<{ ok: true; filePath: string } | { ok: false }> => {
      const req = NodeGraphShowSaveDialogRequest.parse(raw);
      const result = await dialog.showSaveDialog({
        defaultPath: req.defaultName,
        filters: [{ name: 'Node Graph JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false };
      }
      return { ok: true, filePath: result.filePath };
    },
  );

  /**
   * 弹出打开对话框，让用户选择 .json 文件。
   * 用户取消时返回 { ok: false }，不抛错。
   */
  ipcMain.handle(
    NODE_GRAPH_SHOW_OPEN_DIALOG,
    async (): Promise<{ ok: true; filePath: string } | { ok: false }> => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Node Graph JSON', extensions: ['json'] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false };
      }
      return { ok: true, filePath: result.filePaths[0] };
    },
  );
}
