import { z } from 'zod';

/**
 * 流式通道的并发隔离字段（架构约束：streaming IPC channels must include requestId）。
 *
 * 问题：chatStream / explainCode / compareModels / fixSuggest / buildStream 的分片都发在
 * 各自固定的共享通道上，接收方用 `ipcRenderer.on(通道, cb)` 监听。一旦同时存在两个流，
 * 双方的监听器都会收到彼此的 chunk，输出会互相串。
 *
 * 解决：请求携带 requestId，主进程在每个 chunk 中原样回传，接收方只处理与自己
 * requestId 匹配的 chunk。默认空串表示不做校验，保持与旧调用方兼容。
 */
export const StreamRequestId = z.string().default('');
