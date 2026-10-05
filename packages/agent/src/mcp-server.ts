/**
 * MCP stdio 传输层（设计文档 §10.1：传输分两类 —— Streamable HTTP 走生产，
 * stdio 走本地工具；**本文件只负责 stdio 这一半，生产传输见 ./mcp-http.ts**
 * —— Streamable HTTP：单端点 POST/GET/DELETE + Mcp-Session-Id 会话 + Origin 校验）。
 * 两个传输共用本文件的方法分发核心 handleRequest，MCP 语义逐字一致。
 *
 * 零第三方依赖：只用 node: 内置（crypto / readline / url）+ workspace 内核
 * （kernel-java / kernel-server / kernel-bedrock）与 contract / 本地 tools 模块，
 * 手写 JSON-RPC 2.0 + MCP 方法形状（initialize / tools/list / tools/call）。
 *
 * 通道政策（§10.6 / §10.2）：
 * - R（只读）且有内核支持 kind → 透传对应 kernel.dispatch({id, kind, payload})；
 * - W/X 一律拒绝执行（须弹窗确认，本通道不执行），绝不执行；
 * - R 但本通道无内核支持 kind → 返回 ok:false 说明，不臆测执行；
 * - 未知工具 → JSON-RPC -32601。
 *
 * 注意：按 §2.2 外壳永不 import 内核实现——本模块是 agent 层在进程内装配
 * 三内核的本地工具通道（主会话统一接线 src/index.ts，不在此处导出装配）。
 */

import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { BedrockKernel } from '@mc-creator/kernel-bedrock';
import type { KernelContext as BedrockKernelContext } from '@mc-creator/kernel-bedrock';
import { JavaKernel } from '@mc-creator/kernel-java';
import type { KernelContext as JavaKernelContext } from '@mc-creator/kernel-java';
import { ServerKernel } from '@mc-creator/kernel-server';
import type { KernelContext as ServerKernelContext } from '@mc-creator/kernel-server';
import type { KernelContract, TaskResult } from '@mc-creator/contract';
import { MCP_TOOL_DEFS, requireConfirm } from './tools.js';
import type { McpToolDef } from './tools.js';
import { buildContextPack } from './context-pack.js';
import type { ContextParts } from './context-pack.js';
import { normalizeContextState } from './context-source.js';

/** MCP 协议版本（initialize 握手返回）。 */
export const MCP_PROTOCOL_VERSION = '2024-11-05';
/** serverInfo 名称。 */
export const MCP_SERVER_NAME = 'mc-creator-agent';
/** serverInfo 版本（与包版本保持一致）。 */
export const MCP_SERVER_VERSION = '0.1.0';

// ---------------------------------------------------------------------------
// 装配
// ---------------------------------------------------------------------------

/** 三内核构造上下文（透传各内核 KernelContext{dataDir}）。 */
export interface McpServerOptions {
  java?: JavaKernelContext;
  server?: ServerKernelContext;
  bedrock?: BedrockKernelContext;
}

/** JSON Schema 属性子集（手写最小实用形状，宽松为主）。 */
export interface JsonSchemaProp {
  type: string;
  description?: string;
}

/** tools/list 返回的单工具条目。 */
export interface McpToolListing {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, JsonSchemaProp>;
    required: string[];
  };
}

/** tools/call 返回（MCP 文本约定 + structuredContent 透传）。 */
export interface CallToolResult {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: unknown;
  isError?: boolean;
}

export interface McpServer {
  listTools(): McpToolListing[];
  callTool(name: string, args?: unknown): Promise<CallToolResult>;
}

/**
 * R 类工具 → 内核路由表（§10.2 读现状类是闭环必需）。
 * 未列出的 R 工具（list_versions / search_content / list_servers /
 * get_context_pack / validate_content）本通道暂无内核 kind 支持，
 * callTool 返回 ok:false 说明，不臆测执行。
 */
export type KernelRoute = 'java' | 'server' | 'bedrock';

export const MCP_READ_ROUTES: Record<string, KernelRoute> = {
  get_capabilities: 'java', // edition 参数可改道 server/bedrock（见 pickKernel）
  list_instances: 'java',
  read_logs: 'server',
  read_config: 'server',
  get_target_state: 'bedrock',
  // §10.4 状态注入：java/server 内核已实现 get_context_pack；bedrock 尚未，
  // 故按 edition 改道（见 pickKernel）。
  get_context_pack: 'java',
  list_backups: 'server',
  list_tasks: 'server',
  run_due_tasks: 'server',
};

const STRING = { type: 'string' };

/** 每工具最小实用的 properties；required 一律 []（宽松为主，缺参由内核报 validation）。 */
const INPUT_SCHEMAS: Record<string, Record<string, JsonSchemaProp>> = {
  get_capabilities: { edition: { ...STRING, description: 'java / bedrock / server（缺省 java）' } },
  list_versions: { edition: { ...STRING, description: 'java / bedrock / server' } },
  get_target_state: {
    serverId: { ...STRING },
    instanceId: { ...STRING },
    edition: { ...STRING },
  },
  read_config: { serverId: { ...STRING } },
  read_logs: { serverId: { ...STRING } },
  search_content: {
    query: { ...STRING },
    kind: { ...STRING },
    cursor: { ...STRING },
    limit: { type: 'number' },
  },
  list_instances: {},
  list_servers: {},
  get_context_pack: {
    serverId: { ...STRING },
    instanceId: { ...STRING },
    edition: { ...STRING },
  },
  list_backups: { serverId: { ...STRING } },
  list_tasks: { serverId: { ...STRING, description: '可选，不过滤则列出全部' } },
  run_due_tasks: { now: { ...STRING, description: '可选注入时间（ISO 字符串，缺省为当前时间）' } },
  backup_server: { serverId: { ...STRING } },
  restore_backup: { serverId: { ...STRING }, backupId: { ...STRING } },
  prune_backups: { serverId: { ...STRING }, keepN: { type: 'number' } },
  schedule_task: {
    serverId: { ...STRING },
    action: { ...STRING, description: 'backup / restart / stop / broadcast' },
    message: { ...STRING },
    runAt: { ...STRING, description: 'ISO 时间字符串' },
    intervalMs: { type: 'number' },
  },
  cancel_task: { taskId: { ...STRING } },
  install_modpack: { file: { ...STRING }, instanceId: { ...STRING } },
  install_mod: { mod: { ...STRING }, instanceId: { ...STRING } },
  install_addon: { addon: { ...STRING }, target: { ...STRING } },
  import_package: { file: { ...STRING } },
  apply_skin: { skin: { ...STRING }, account: { ...STRING } },
  uninstall_content: { contentId: { ...STRING }, instanceId: { ...STRING } },
  launch_instance: { instanceId: { ...STRING } },
  create_instance: { name: { ...STRING }, mcVersion: { ...STRING } },
  delete_instance: { instanceId: { ...STRING } },
  build_project: { projectRef: { ...STRING } },
  deploy_plugin: { projectRef: { ...STRING }, serverId: { ...STRING } },
  restart_server: { serverId: { ...STRING } },
  stop_server: { serverId: { ...STRING } },
  rollback_build: { projectRef: { ...STRING } },
  generate_content: { prompt: { ...STRING }, kind: { ...STRING } },
  validate_content: { kind: { ...STRING }, path: { ...STRING } },
};

/** JSON-RPC 错误（未知工具 -32601 / 参数非法 -32602 / 内部错误 -32603）。 */
export class JsonRpcError extends Error {
  readonly code: number;
  readonly data?: unknown;
  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = 'JsonRpcError';
    this.code = code;
    if (data !== undefined) this.data = data;
  }
}

/** W/X 类拒绝执行（§10.6）：返回 ok:false + 确认说明，绝不执行。 */
function refuse(def: McpToolDef): CallToolResult {
  // stdio 通道按最严口径要求确认（confirmWrites: true）：W/X 一律不执行。
  const verdict = requireConfirm(def.name, { confirmWrites: true });
  const body = {
    ok: false,
    tool: def.name,
    permission: def.permission,
    confirmRequired: verdict,
    error: {
      category: 'permission',
      message: `工具 ${def.name}（${def.permission} 类）须弹窗确认，本通道不执行（§10.6）；已拒绝执行，未触及实例目录与进程。`,
      retryable: false,
    },
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    isError: true,
  };
}

/**
 * get_context_pack 的可选尾部段（§10.4）：内核只能读磁盘事实，读不到的是
 * 调用方手里才有的信息 —— 上次失败原因（§10.3 回灌）、目标 API 类型（§10.5 提示缓存）、
 * 额外上下文。三者都可选，缺省不传。
 */
function extraContextOf(payload: Record<string, unknown>): ContextParts {
  const parts: ContextParts = {};
  if (typeof payload['lastFailure'] === 'string' && payload['lastFailure'] !== '') {
    parts.lastFailure = payload['lastFailure'];
  }
  if (typeof payload['apiTypes'] === 'string' && payload['apiTypes'] !== '') {
    parts.apiTypes = payload['apiTypes'];
  }
  if (typeof payload['extra'] === 'string' && payload['extra'] !== '') {
    parts.extra = payload['extra'];
  }
  return parts;
}

/** R 类但本通道无内核 kind 支持：ok:false 说明，不臆测执行。 */
function unimplemented(def: McpToolDef): CallToolResult {
  const body = {
    ok: false,
    tool: def.name,
    error: {
      category: 'unknown',
      message: `工具 ${def.name}（R 类）在 stdio 本通道暂无内核支持 kind，不执行（后续增量接入，§10.2）。`,
      retryable: false,
    },
  };
  return {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
    isError: true,
  };
}

/**
 * 构造三内核实例，返回 MCP 服务端句柄（§10.1 stdio 本地工具）。
 * TaskSpec id 用 node:crypto randomUUID。
 */
export function createMcpServer(opts: McpServerOptions = {}): McpServer {
  const javaKernel = new JavaKernel(opts.java ?? {});
  const serverKernel = new ServerKernel(opts.server ?? {});
  const bedrockKernel = new BedrockKernel(opts.bedrock ?? {});

  function listTools(): McpToolListing[] {
    return MCP_TOOL_DEFS.map((def) => ({
      name: def.name,
      description: def.description,
      inputSchema: {
        type: 'object' as const,
        properties: INPUT_SCHEMAS[def.name] ?? {},
        required: [],
      },
    }));
  }

  /**
   * get_capabilities / get_context_pack 按 edition 参数改道，其余按 MCP_READ_ROUTES。
   * get_context_pack 额外兜一层：没显式给 edition 时用「有 serverId 走 server 内核」
   * 推断 —— 服务端是 context_pack 的主场景（§7），而 server 内核要求 serverId、
   * java 内核要求 instanceId，猜错就是一条无意义的 validation。
   */
  function pickKernel(name: string, payload: Record<string, unknown>): KernelContract {
    if (name === 'get_capabilities' || name === 'get_context_pack') {
      const edition = payload['edition'];
      if (edition === 'server') return serverKernel;
      if (edition === 'bedrock') return bedrockKernel;
      if (edition === 'java') return javaKernel;
      if (name === 'get_context_pack') {
        const hasServer = typeof payload['serverId'] === 'string' && payload['serverId'] !== '';
        const hasInstance =
          typeof payload['instanceId'] === 'string' && payload['instanceId'] !== '';
        if (hasServer && !hasInstance) return serverKernel;
      }
      return javaKernel;
    }
    const route = MCP_READ_ROUTES[name];
    if (route === 'server') return serverKernel;
    if (route === 'bedrock') return bedrockKernel;
    return javaKernel;
  }

  async function callTool(name: string, args?: unknown): Promise<CallToolResult> {
    const def = MCP_TOOL_DEFS.find((t) => t.name === name);
    if (def === undefined) throw new JsonRpcError(-32601, `Unknown tool: ${name}`);
    if (def.permission === 'W' || def.permission === 'X') return refuse(def);
    if (MCP_READ_ROUTES[name] === undefined) return unimplemented(def);
    if (args !== undefined && (typeof args !== 'object' || args === null || Array.isArray(args))) {
      throw new JsonRpcError(
        -32602,
        `Invalid params for tool ${name}: arguments must be an object`,
      );
    }
    const payload = (args ?? {}) as Record<string, unknown>;
    let result: TaskResult;
    try {
      result = await pickKernel(name, payload)
        .dispatch({ id: randomUUID(), kind: name, payload })
        .result();
    } catch (e) {
      throw new JsonRpcError(
        -32603,
        `Tool ${name} failed: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
    if (result.ok) {
      // get_context_pack（§10.4）：内核给事实，这里按 token 预算拼装成可直接
      // 注入模型的文本上下文包，同时把结构化事实一并透传（模型可自行取字段）。
      if (name === 'get_context_pack') {
        const state = normalizeContextState(result.data);
        const pack = buildContextPack(state.target, {
          ...state.parts,
          ...extraContextOf(payload),
        });
        const data = { contextPack: pack, ...state };
        return {
          content: [{ type: 'text', text: pack.text }],
          structuredContent: data,
        };
      }
      const data = result.data ?? null;
      return {
        content: [{ type: 'text', text: JSON.stringify(data) }],
        structuredContent: data,
      };
    }
    return {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: true,
    };
  }

  return { listTools, callTool };
}

// ---------------------------------------------------------------------------
// JSON-RPC 2.0 行协议（newline-delimited，纯函数可测）
// ---------------------------------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  /** 缺省 = notification（无返回）。 */
  id?: string | number | null;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export type ParsedLine =
  | { kind: 'empty' }
  | { kind: 'content-length'; header: string }
  | { kind: 'request'; request: JsonRpcRequest }
  | { kind: 'error'; code: number; message: string; id: string | number | null };

function isId(value: unknown): value is string | number | null {
  return value === null || typeof value === 'string' || typeof value === 'number';
}

/** 解析单行 JSON-RPC（纯函数）：空行跳过；Content-Length 头模式单列 kind。 */
export function parseLine(line: string): ParsedLine {
  const trimmed = line.trim();
  if (trimmed === '') return { kind: 'empty' };
  if (/^content-length\s*:/i.test(trimmed)) return { kind: 'content-length', header: trimmed };
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return {
      kind: 'error',
      code: -32700,
      message: 'Parse error: line is not valid JSON (expected newline-delimited JSON-RPC)',
      id: null,
    };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return {
      kind: 'error',
      code: -32600,
      message: 'Invalid Request: batch requests are not supported',
      id: null,
    };
  }
  const obj = parsed as Record<string, unknown>;
  if (typeof obj['method'] !== 'string') {
    const rawId = obj['id'];
    return {
      kind: 'error',
      code: -32600,
      message: 'Invalid Request: missing method',
      id: isId(rawId) ? rawId : null,
    };
  }
  const rawId = obj['id'];
  if (rawId !== undefined && !isId(rawId)) {
    return {
      kind: 'error',
      code: -32600,
      message: 'Invalid Request: id must be string | number | null',
      id: null,
    };
  }
  const request: JsonRpcRequest = { jsonrpc: '2.0', method: obj['method'] };
  if (rawId !== undefined) request.id = rawId;
  if (obj['params'] !== undefined) request.params = obj['params'];
  return { kind: 'request', request };
}

/** 成功响应行（不带换行，由调用方加 \n）。 */
export function formatResponse(id: string | number | null, result: unknown): string {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

/** 错误响应行（不带换行，由调用方加 \n）。 */
export function formatError(
  id: string | number | null,
  code: number,
  message: string,
  data?: unknown,
): string {
  const error: { code: number; message: string; data?: unknown } = { code, message };
  if (data !== undefined) error.data = data;
  return JSON.stringify({ jsonrpc: '2.0', id, error });
}

/**
 * 处理单条 MCP 方法（纯逻辑，可测，不触流）：
 * initialize / notifications/initialized（无返回）/ tools/list / tools/call。
 */
export async function handleRequest(
  server: McpServer,
  req: JsonRpcRequest,
): Promise<JsonRpcResponse | null> {
  const id = req.id ?? null;
  const isNotification = req.id === undefined;
  switch (req.method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
        },
      };
    case 'notifications/initialized':
      return null;
    case 'tools/list':
      if (isNotification) return null;
      return { jsonrpc: '2.0', id, result: { tools: server.listTools() } };
    case 'tools/call': {
      if (isNotification) return null;
      const params =
        typeof req.params === 'object' && req.params !== null
          ? (req.params as Record<string, unknown>)
          : {};
      const toolName = params['name'];
      if (typeof toolName !== 'string' || toolName.length === 0) {
        return {
          jsonrpc: '2.0',
          id,
          error: {
            code: -32602,
            message: 'Invalid params: tools/call requires { name: string, arguments?: object }',
          },
        };
      }
      const toolArgs = params['arguments'] ?? params['args'] ?? {};
      try {
        const result = await server.callTool(toolName, toolArgs);
        return { jsonrpc: '2.0', id, result };
      } catch (e) {
        if (e instanceof JsonRpcError) {
          const error: { code: number; message: string; data?: unknown } = {
            code: e.code,
            message: e.message,
          };
          if (e.data !== undefined) error.data = e.data;
          return { jsonrpc: '2.0', id, error };
        }
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32603, message: e instanceof Error ? e.message : String(e) },
        };
      }
    }
    default:
      if (isNotification) return null;
      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${req.method}` },
      };
  }
}

// ---------------------------------------------------------------------------
// stdio 服务
// ---------------------------------------------------------------------------

function log(message: string): void {
  // 日志只走 stderr，绝不污染 stdout（stdout 只写 JSON-RPC 响应行）。
  process.stderr.write(`[mcp-server] ${message}\n`);
}

/**
 * stdin 按行读 JSON-RPC，stdout 按行写响应，stderr 写日志。
 * Content-Length 头模式不支持（回 -32600）；流结束即返回。
 * streams 可注入内存流做测试；默认接进程标准输入输出。
 */
export async function serveStdio(
  server: McpServer,
  input: NodeJS.ReadableStream = process.stdin,
  output: NodeJS.WritableStream = process.stdout,
): Promise<void> {
  log('stdio 服务启动（newline-delimited JSON-RPC）');
  const rl = createInterface({ input, crlfDelay: Infinity });
  try {
    for await (const line of rl) {
      const parsed = parseLine(line);
      let response: string | null = null;
      switch (parsed.kind) {
        case 'empty':
          continue;
        case 'content-length':
          response = formatError(
            null,
            -32600,
            'Content-Length header mode is not supported, send newline-delimited JSON-RPC',
          );
          break;
        case 'error':
          response = formatError(parsed.id, parsed.code, parsed.message);
          break;
        case 'request': {
          const res = await handleRequest(server, parsed.request);
          response = res === null ? null : JSON.stringify(res);
          break;
        }
      }
      if (response !== null) output.write(`${response}\n`);
    }
  } finally {
    rl.close();
  }
}

// 直接执行时跑 stdio 服务（`bun src/mcp-server.ts`）；被 import（vitest/主会话）时不自启。
const invokedAsMain =
  typeof process.argv[1] === 'string' && pathToFileURL(process.argv[1]).href === import.meta.url;

if (invokedAsMain) {
  serveStdio(createMcpServer({})).catch((e: unknown) => {
    process.stderr.write(`[mcp-server] fatal: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exitCode = 1;
  });
}
