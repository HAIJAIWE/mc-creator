/**
 * mcp-server.ts 单元测试（设计文档 §10.1 stdio 本地工具 / §10.6 确认门控）。
 * 覆盖：工具清单形状、R 透传三内核、W/X 拒绝、JSON-RPC 握手与行协议、
 * 内存流端到端（不碰真实 stdin/stdout）。
 */
import { Readable, Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { MCP_TOOL_DEFS } from './tools.js';
import {
  JsonRpcError,
  createMcpServer,
  formatError,
  formatResponse,
  handleRequest,
  parseLine,
  serveStdio,
} from './mcp-server.js';

function bodyOf(res: { structuredContent?: unknown }): {
  ok: boolean;
  error?: { category: string };
} {
  return res.structuredContent as { ok: boolean; error?: { category: string } };
}

describe('listTools（§10.2 33 个工具：25 + §7.4 快照/定时 8 个）', () => {
  it('数量 33 且与 MCP_TOOL_DEFS 同名全覆盖', () => {
    const server = createMcpServer({});
    const tools = server.listTools();
    expect(tools).toHaveLength(33);
    expect(tools).toHaveLength(MCP_TOOL_DEFS.length);
    const names = new Set(tools.map((t) => t.name));
    for (const def of MCP_TOOL_DEFS) expect(names).toContain(def.name);
  });

  it('inputSchema 形状合法：type object + properties 记录 + required 数组', () => {
    for (const t of createMcpServer({}).listTools()) {
      expect(t.inputSchema.type).toBe('object');
      expect(typeof t.inputSchema.properties).toBe('object');
      expect(Array.isArray(t.inputSchema.required)).toBe(true);
    }
  });

  it('最小实用的 properties 点名（宽松为主，required 为空）', () => {
    const byName = new Map(
      createMcpServer({})
        .listTools()
        .map((t) => [t.name, t] as const),
    );
    expect(Object.keys(byName.get('read_logs')?.inputSchema.properties ?? {})).toContain(
      'serverId',
    );
    const gen = byName.get('generate_content')?.inputSchema.properties ?? {};
    expect(Object.keys(gen)).toEqual(expect.arrayContaining(['prompt', 'kind']));
    const deploy = byName.get('deploy_plugin')?.inputSchema.properties ?? {};
    expect(Object.keys(deploy)).toEqual(expect.arrayContaining(['projectRef', 'serverId']));
    for (const t of byName.values()) expect(t.inputSchema.required).toEqual([]);
  });
});

describe('callTool 路由（R 透传 / W-X 拒绝 / 未知 -32601）', () => {
  it('未知工具 → JSON-RPC -32601', async () => {
    const server = createMcpServer({});
    await expect(server.callTool('drop_database', {})).rejects.toMatchObject({ code: -32601 });
    await expect(server.callTool('drop_database', {})).rejects.toBeInstanceOf(JsonRpcError);
  });

  it('get_capabilities 经 java 内核返回 data.capabilities', async () => {
    const res = await createMcpServer({}).callTool('get_capabilities', {});
    expect(res.isError).toBeUndefined();
    const data = res.structuredContent as { capabilities: unknown[] };
    expect(Array.isArray(data.capabilities)).toBe(true);
    expect(data.capabilities.length).toBeGreaterThan(0);
    expect(res.content).toHaveLength(1);
    expect(res.content[0]?.type).toBe('text');
  });

  it('get_capabilities edition=server 改道 server 内核', async () => {
    const res = await createMcpServer({}).callTool('get_capabilities', { edition: 'server' });
    const data = res.structuredContent as { capabilities: Array<{ kind: string }> };
    expect(data.capabilities.map((c) => c.kind)).toContain('server-plugin');
  });

  it('list_instances 空 dataDir 返回空数组（不报错）', async () => {
    const res = await createMcpServer({ java: {} }).callTool('list_instances', {});
    expect(res.isError).toBeUndefined();
    expect(res.structuredContent).toEqual({ instances: [] });
  });

  it('read_logs 缺 serverId 返回 validation（内核透传 ok:false）', async () => {
    const res = await createMcpServer({}).callTool('read_logs', {});
    expect(res.isError).toBe(true);
    const body = bodyOf(res);
    expect(body.ok).toBe(false);
    expect(body.error?.category).toBe('validation');
  });

  it('read_config 缺 serverId 返回 validation', async () => {
    const res = await createMcpServer({}).callTool('read_config', {});
    expect(res.isError).toBe(true);
    expect(bodyOf(res).error?.category).toBe('validation');
  });

  it('W 工具 install_mod 被拒且含确认说明（绝不执行）', async () => {
    const res = await createMcpServer({}).callTool('install_mod', { mod: 'jei', instanceId: 'i1' });
    expect(res.isError).toBe(true);
    const text = res.content[0]?.text ?? '';
    expect(text).toContain('须弹窗确认');
    expect(text).toContain('本通道不执行');
    const raw = JSON.parse(text) as { ok: boolean; permission: string; confirmRequired: boolean };
    expect(raw.ok).toBe(false);
    expect(raw.permission).toBe('W');
    expect(raw.confirmRequired).toBe(true);
  });

  it('X 工具 build_project 被拒', async () => {
    const res = await createMcpServer({}).callTool('build_project', { projectRef: 'p' });
    expect(res.isError).toBe(true);
    expect(res.content[0]?.text ?? '').toContain('本通道不执行');
    expect(bodyOf(res).ok).toBe(false);
  });

  it('X 工具 generate_content 被拒（生成执行须弹窗）', async () => {
    const res = await createMcpServer({}).callTool('generate_content', {
      prompt: 'hi',
      kind: 'datapack',
    });
    expect(res.isError).toBe(true);
    expect(bodyOf(res).ok).toBe(false);
  });

  it('R 但无内核 kind（如 list_versions）→ ok:false 说明，不臆测执行', async () => {
    const res = await createMcpServer({}).callTool('list_versions', { edition: 'java' });
    expect(res.isError).toBe(true);
    expect(bodyOf(res).ok).toBe(false);
  });

  it('非法 arguments（非对象）→ -32602', async () => {
    await expect(createMcpServer({}).callTool('get_capabilities', 'nope')).rejects.toMatchObject({
      code: -32602,
    });
  });
});

describe('JSON-RPC 握手与方法（initialize / tools/list / tools/call）', () => {
  it('initialize 握手形状：protocolVersion + serverInfo', async () => {
    const res = await handleRequest(createMcpServer({}), {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {},
    });
    expect(res?.id).toBe(1);
    const result = res?.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe('2024-11-05');
    expect(result.serverInfo.name).toBe('mc-creator-agent');
  });

  it('notifications/initialized 无返回', async () => {
    const res = await handleRequest(createMcpServer({}), {
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    });
    expect(res).toBeNull();
  });

  it('tools/list 信封返回 33 个工具', async () => {
    const res = await handleRequest(createMcpServer({}), {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list',
    });
    const result = res?.result as { tools: unknown[] };
    expect(result.tools).toHaveLength(33);
  });

  it('tools/call 信封：get_capabilities 成功', async () => {
    const res = await handleRequest(createMcpServer({}), {
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'get_capabilities', arguments: {} },
    });
    expect(res?.error).toBeUndefined();
    const result = res?.result as { content: Array<{ text: string }> };
    expect(JSON.parse(result.content[0]?.text ?? '{}')).toHaveProperty('capabilities');
  });

  it('tools/call 未知工具 → -32601 信封', async () => {
    const res = await handleRequest(createMcpServer({}), {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: { name: 'nope', arguments: {} },
    });
    expect(res?.error?.code).toBe(-32601);
  });

  it('未知方法 → -32601', async () => {
    const res = await handleRequest(createMcpServer({}), { jsonrpc: '2.0', id: 5, method: 'ping' });
    expect(res?.error?.code).toBe(-32601);
  });
});

describe('行协议纯函数 parseLine / formatResponse', () => {
  it('空行跳过', () => {
    expect(parseLine('')).toEqual({ kind: 'empty' });
    expect(parseLine('   \n')).toEqual({ kind: 'empty' });
  });

  it('Content-Length 头单列 kind（不支持头模式）', () => {
    const parsed = parseLine('Content-Length: 123');
    expect(parsed.kind).toBe('content-length');
  });

  it('非法 JSON → -32700', () => {
    const parsed = parseLine('not json');
    expect(parsed).toMatchObject({ kind: 'error', code: -32700, id: null });
  });

  it('批量数组 → -32600', () => {
    expect(parseLine('[]')).toMatchObject({ kind: 'error', code: -32600 });
  });

  it('缺 method → -32600（可带回 id）', () => {
    expect(parseLine('{"jsonrpc":"2.0","id":7}')).toMatchObject({
      kind: 'error',
      code: -32600,
      id: 7,
    });
  });

  it('正常请求解析出 id/method/params', () => {
    const parsed = parseLine('{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}');
    expect(parsed).toMatchObject({ kind: 'request' });
    if (parsed.kind === 'request') {
      expect(parsed.request.method).toBe('tools/list');
      expect(parsed.request.id).toBe(1);
    }
  });

  it('formatResponse/formatError 编解码 round-trip', () => {
    expect(JSON.parse(formatResponse(1, { tools: [] }))).toEqual({
      jsonrpc: '2.0',
      id: 1,
      result: { tools: [] },
    });
    expect(JSON.parse(formatError(2, -32601, 'Method not found'))).toEqual({
      jsonrpc: '2.0',
      id: 2,
      error: { code: -32601, message: 'Method not found' },
    });
  });
});

describe('serveStdio 内存流端到端（不碰真实 stdin）', () => {
  it('initialize + tools/list 有响应行，notification 无返回，非法行回 -32700', async () => {
    const server = createMcpServer({});
    const input = Readable.from(
      [
        JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
        JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
        JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
        'not json',
      ].map((l) => `${l}\n`),
    );
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    await serveStdio(server, input, output);
    const responses = chunks
      .join('')
      .trim()
      .split('\n')
      .map(
        (l) => JSON.parse(l) as { id: number | null; result?: unknown; error?: { code: number } },
      );
    expect(responses).toHaveLength(3);
    expect(responses[0]?.id).toBe(1);
    expect(responses[1]?.id).toBe(2);
    expect(responses[2]?.error?.code).toBe(-32700);
  });

  it('Content-Length 头行回 -32600', async () => {
    const server = createMcpServer({});
    const input = Readable.from(['Content-Length: 10\n']);
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _encoding, cb) {
        chunks.push(chunk.toString());
        cb();
      },
    });
    await serveStdio(server, input, output);
    const parsed = JSON.parse(chunks.join('').trim()) as { error: { code: number } };
    expect(parsed.error.code).toBe(-32600);
  });
});
