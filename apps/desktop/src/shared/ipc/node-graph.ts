import { z } from 'zod';

// === 节点图持久化（保存/加载到磁盘 + 文件对话框）===
// 渲染层通过 window.api.nodeGraph 调用，主进程用 fs.promises 读写文件、dialog 弹出选择框。
export const NODE_GRAPH_SAVE = 'nodeGraph:save';
export const NODE_GRAPH_LOAD = 'nodeGraph:load';
export const NODE_GRAPH_SHOW_SAVE_DIALOG = 'nodeGraph:showSaveDialog';
export const NODE_GRAPH_SHOW_OPEN_DIALOG = 'nodeGraph:showOpenDialog';

/** nodeGraph:save 请求：把 JSON 字符串写入指定路径 */
export const NodeGraphSaveRequest = z.object({
  filePath: z.string().min(1),
  json: z.string(),
});
export const NodeGraphSaveResponse = z.object({
  ok: z.boolean(),
  error: z.string().nullable().optional(),
});

/** nodeGraph:load 请求：读取指定路径的 JSON 字符串 */
export const NodeGraphLoadRequest = z.object({
  filePath: z.string().min(1),
});
export const NodeGraphLoadResponse = z.object({
  ok: z.boolean(),
  json: z.string().nullable().optional(),
  error: z.string().nullable().optional(),
});

/** nodeGraph:showSaveDialog 请求：默认文件名（一般传 modId-node-graph.json） */
export const NodeGraphShowSaveDialogRequest = z.object({
  defaultName: z.string().default('node-graph.json'),
});
export const NodeGraphShowSaveDialogResponse = z.object({
  ok: z.boolean(),
  filePath: z.string().nullable().optional(),
});

/** nodeGraph:showOpenDialog 响应：用户选择文件后返回路径 */
export const NodeGraphShowOpenDialogResponse = z.object({
  ok: z.boolean(),
  filePath: z.string().nullable().optional(),
});

export type NodeGraphSaveReq = z.infer<typeof NodeGraphSaveRequest>;
export type NodeGraphSaveRes = z.infer<typeof NodeGraphSaveResponse>;
export type NodeGraphLoadReq = z.infer<typeof NodeGraphLoadRequest>;
export type NodeGraphLoadRes = z.infer<typeof NodeGraphLoadResponse>;
export type NodeGraphShowSaveDialogReq = z.infer<typeof NodeGraphShowSaveDialogRequest>;
export type NodeGraphShowSaveDialogRes = z.infer<typeof NodeGraphShowSaveDialogResponse>;
export type NodeGraphShowOpenDialogRes = z.infer<typeof NodeGraphShowOpenDialogResponse>;
