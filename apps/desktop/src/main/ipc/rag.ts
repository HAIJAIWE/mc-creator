import { ipcMain } from 'electron';
import { searchKnowledge } from '@mc-creator/core';
import { RAG_SEARCH, RagSearchRequest, type RagSearchRes } from '../../shared/ipc-channels.js';

/**
 * RAG 检索通道（主进程内存 LRU，renderer 经此查询，UI 渲染“引用来源”）。
 * 检索本身是同步纯内存计算，handler 保持 async 以符合 ipcMain.handle 签名。
 */
export function registerRagHandlers(): void {
  ipcMain.handle(RAG_SEARCH, async (_e, raw: unknown): Promise<RagSearchRes> => {
    const req = RagSearchRequest.parse(raw);
    const { hits, cached } = searchKnowledge(req.query, {
      topK: req.topK,
      generatorType: req.generatorType,
    });
    return { hits, cached };
  });
}
