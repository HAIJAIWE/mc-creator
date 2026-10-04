/**
 * mcp-http.ts 测试（设计文档 §10.1 Streamable HTTP 生产传输 / §10.6 通道权限铁律）。
 *
 * 测试策略：
 * - 主体用「传输无关核心」handleHttpRequest（纯逻辑，无 I/O），等价于 fake HTTP listener，
 *   端口 / 时钟 / session-id 生成器全部注入，不开真实端口、不 sleep；
 * - 少量 serveHttp 集成测试（port:0 随机端口 + 真实 fetch），验证 node:http 接线与 close()。
 *
 * 最重要的一条：W/X 工具在 HTTP 通道同样被拒（§10.6 回归防线），
 * 以及 R 工具（get_capabilities）能正常透传。
 */
import { describe, expect, it } from 'vitest';
import { createMcpServer } from './mcp-server.js';
import {
  ALLOWED_METHODS,
  DEFAULT_MCP_PATH,
  ERR_ENDPOINT_NOT_FOUND,
  ERR_FORBIDDEN_ORIGIN,
  ERR_METHOD_NOT_ALLOWED,
  ERR_PAYLOAD_TOO_LARGE,
  ERR_SESSION_NOT_FOUND,
  ERR_UNAUTHORIZED,
  SSE_OPEN_FRAME,
  SessionStore,
  createDefaultOriginValidator,
  defaultValidateOrigin,
  headerValue,
  handleHttpRequest,
  parseHttpPayload,
  resetSessions,
  serveHttp,
  sseHeartbeatFrame,
} from './mcp-http.js';
import type { HttpRequestLike, ServeHttpOptions } from './mcp-http.js';

/** 可断言的 session-id 生成器（不注入就拿不到具体值）。 */
function idFactory(prefix = 'sess'): () => string {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

/** 固定时钟，可手动推进（测会话过期，不 sleep）。 */
function fakeClock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

function req(partial: Partial<HttpRequestLike> & { method: string; body?: string }): HttpRequestLike {
  return {
    method: partial.method,
    url: partial.url ?? DEFAULT_MCP_PATH,
    headers: partial.headers ?? {},
    body: partial.body ?? '',
  };
}

function parseRpc(body: string): { jsonrpc: '2.0'; id: string | number | null; result?: any; error?: { code: number; message: string } } {
  return JSON.parse(body) as never;
}

function rpcLine(payload: unknown): string {
  return JSON.stringify(payload);
}

describe('headerValue 大小写不敏感', () => {
  it('命中任意大小写键', () => {
    expect(headerValue({ 'Mcp-Session-Id': 'a' }, 'mcp-session-id')).toBe('a');
    expect(headerValue({ 'mcp-session-id': 'b' }, 'MCP-SESSION-ID')).toBe('b');
  });

  it('数组头取首个，缺省 undefined', () => {
    expect(headerValue({ 'x-a': ['1', '2'] }, 'x-a')).toBe('1');
    expect(headerValue({}, 'origin')).toBeUndefined();
  });
});

describe('parseHttpPayload（batch 支持 —— 规范要求，stdio 层不支持）', () => {
  it('空 body → empty', () => {
    expect(parseHttpPayload('   ')).toEqual({ kind: 'empty' });
  });

  it('非法 JSON → -32700', () => {
    expect(parseHttpPayload('{oops')).toMatchObject({ kind: 'error', code: -32700, id: null });
  });

  it('空数组 → -32600', () => {
    expect(parseHttpPayload('[]')).toMatchObject({ kind: 'error', code: -32600 });
  });

  it('单请求解析出 method/id/params', () => {
    const p = parseHttpPayload(rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { a: 1 } }));
    expect(p.kind).toBe('single');
    if (p.kind === 'single') {
      expect(p.entry).toMatchObject({ ok: true });
      if (p.entry.ok) {
        expect(p.entry.request.method).toBe('tools/list');
        expect(p.entry.request.id).toBe(1);
      }
    }
  });

  it('批量数组逐条解析（数组本身不是 -32600）', () => {
    const p = parseHttpPayload(rpcLine([{ jsonrpc: '2.0', id: 1, method: 'tools/list' }, { jsonrpc: '2.0', method: 'ping' }]));
    expect(p.kind).toBe('batch');
    if (p.kind === 'batch') expect(p.entries).toHaveLength(2);
  });

  it('缺 method / 非法 jsonrpc 版本 → -32600（可带回 id）', () => {
    const p1 = parseHttpPayload(rpcLine({ jsonrpc: '2.0', id: 7 }));
    expect(p1).toMatchObject({ kind: 'single' });
    if (p1.kind === 'single') expect(p1.entry).toMatchObject({ ok: false, code: -32600, id: 7 });
    const p2 = parseHttpPayload(rpcLine({ jsonrpc: '1.0', id: 1, method: 'tools/list' }));
    if (p2.kind === 'single' && !p2.entry.ok) expect(p2.entry.message).toContain('jsonrpc');
  });

  it('非法 id 类型 → -32600', () => {
    const p = parseHttpPayload(rpcLine({ jsonrpc: '2.0', id: { a: 1 }, method: 'tools/list' }));
    if (p.kind === 'single' && !p.entry.ok) expect(p.entry.code).toBe(-32600);
  });

  it('标量 body（非对象非数组）→ -32600', () => {
    expect(parseHttpPayload('42')).toMatchObject({ kind: 'single' });
    const p = parseHttpPayload('42');
    if (p.kind === 'single') expect(p.entry).toMatchObject({ ok: false, code: -32600 });
  });
});

describe('POST 单请求（§10.1 JSON-RPC 语义优先于 HTTP 状态码）', () => {
  it('tools/list → 200 + application/json + 25 个工具', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
    );
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('application/json');
    const tools = (parseRpc(res.body).result as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(25);
  });

  it('notification（无 id）→ 202 空 body', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', method: 'notifications/initialized' }) }),
    );
    expect(res.status).toBe(202);
    expect(res.body).toBe('');
  });

  it('未知方法 → HTTP 200 + JSON-RPC -32601（不是 HTTP 4xx）', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 9, method: 'ping' }) }),
    );
    expect(res.status).toBe(200);
    expect(parseRpc(res.body).error?.code).toBe(-32601);
  });

  it('非法 JSON body → 400 + -32700', async () => {
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'POST', body: '{not json' }));
    expect(res.status).toBe(400);
    expect(parseRpc(res.body).error?.code).toBe(-32700);
  });

  it('空 body → 400 + -32700', async () => {
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'POST', body: '' }));
    expect(res.status).toBe(400);
    expect(parseRpc(res.body).error?.code).toBe(-32700);
  });

  it('缺 method → 400 + -32600', async () => {
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 3 }) }));
    expect(res.status).toBe(400);
    expect(parseRpc(res.body).error?.code).toBe(-32600);
  });

  it('query string 不影响端点匹配', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', url: '/mcp?session=1', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
    );
    expect(res.status).toBe(200);
  });

  it('自定义 path 生效', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', url: '/rpc', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
      { path: '/rpc' },
    );
    expect(res.status).toBe(200);
  });
});

describe('batch 请求（数组）', () => {
  it('有 response 的数组 → 200 + 数组信封', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({
        method: 'POST',
        body: rpcLine([
          { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
          { jsonrpc: '2.0', id: 2, method: 'tools/list' },
        ]),
      }),
    );
    expect(res.status).toBe(200);
    const parsed = JSON.parse(res.body) as Array<{ id: number }>;
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed.map((p) => p.id)).toEqual([1, 2]);
  });

  it('notification 元素被丢弃（响应数组不含它）', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({
        method: 'POST',
        body: rpcLine([
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', id: 5, method: 'tools/list' },
        ]),
      }),
    );
    const parsed = JSON.parse(res.body) as Array<{ id: number }>;
    expect(parsed).toHaveLength(1);
    expect(parsed[0]?.id).toBe(5);
  });

  it('全 notification 数组 → 202 空 body', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({
        method: 'POST',
        body: rpcLine([
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', method: 'notifications/cancelled' },
        ]),
      }),
    );
    expect(res.status).toBe(202);
    expect(res.body).toBe('');
  });

  it('数组内非法元素 → 该元素回 -32600，其余照常处理', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({
        method: 'POST',
        body: rpcLine([{ jsonrpc: '2.0', id: 1 }, { jsonrpc: '2.0', id: 2, method: 'tools/list' }]),
      }),
    );
    const parsed = JSON.parse(res.body) as Array<{ id: number; error?: { code: number } }>;
    expect(parsed).toHaveLength(2);
    expect(parsed.find((p) => p.id === 1)?.error?.code).toBe(-32600);
    expect(parsed.find((p) => p.id === 2)?.error).toBeUndefined();
  });
});

describe('会话管理（§10.1 生产需要 Mcp-Session-Id）', () => {
  it('initialize 成功下发 Mcp-Session-Id（注入生成器可断言）', async () => {
    const sessions = new SessionStore({ now: () => 1, newSessionId: idFactory() });
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) }),
      { sessions },
    );
    expect(res.status).toBe(200);
    expect(res.headers['Mcp-Session-Id']).toBe('sess-1');
    expect(sessions.size()).toBe(1);
  });

  it('不带 session 头的普通请求也放行（会话非强制）', async () => {
    const sessions = new SessionStore({ newSessionId: idFactory() });
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }),
      { sessions },
    );
    expect(res.status).toBe(200);
  });

  it('带正确 session 头的后续请求放行且回显头', async () => {
    const sessions = new SessionStore({ now: () => 1, newSessionId: idFactory() });
    const server = createMcpServer({});
    const init = await handleHttpRequest(
      server,
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'initialize' }) }),
      { sessions },
    );
    const sid = init.headers['Mcp-Session-Id'] as string;
    const next = await handleHttpRequest(
      server,
      req({ method: 'POST', headers: { 'mcp-session-id': sid }, body: rpcLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }),
      { sessions },
    );
    expect(next.status).toBe(200);
    expect(next.headers['Mcp-Session-Id']).toBe(sid);
  });

  it('未知 session → 404 + ERR_SESSION_NOT_FOUND', async () => {
    const sessions = new SessionStore({ newSessionId: idFactory() });
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', headers: { 'mcp-session-id': 'nope' }, body: rpcLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }),
      { sessions },
    );
    expect(res.status).toBe(404);
    expect(parseRpc(res.body).error?.code).toBe(ERR_SESSION_NOT_FOUND);
  });

  it('过期 session（注入时钟推进）→ 404，且会话被惰性清理', async () => {
    const clock = fakeClock();
    const sessions = new SessionStore({ now: clock.now, ttlMs: 1000, newSessionId: idFactory() });
    const server = createMcpServer({});
    const init = await handleHttpRequest(server, req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'initialize' }) }), {
      sessions,
    });
    const sid = init.headers['Mcp-Session-Id'] as string;
    clock.advance(500);
    expect(
      (
        await handleHttpRequest(
          server,
          req({ method: 'POST', headers: { 'mcp-session-id': sid }, body: rpcLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }),
          { sessions },
        )
      ).status,
    ).toBe(200);
    clock.advance(501);
    const expired = await handleHttpRequest(
      server,
      req({ method: 'POST', headers: { 'mcp-session-id': sid }, body: rpcLine({ jsonrpc: '2.0', id: 3, method: 'tools/list' }) }),
      { sessions },
    );
    expect(expired.status).toBe(404);
    expect(sessions.size()).toBe(0);
  });

  it('ttlMs<=0 → 永不过期', async () => {
    const clock = fakeClock();
    const sessions = new SessionStore({ now: clock.now, ttlMs: 0, newSessionId: idFactory() });
    const server = createMcpServer({});
    const init = await handleHttpRequest(server, req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'initialize' }) }), {
      sessions,
    });
    const sid = init.headers['Mcp-Session-Id'] as string;
    clock.advance(10_000_000);
    const res = await handleHttpRequest(
      server,
      req({ method: 'POST', headers: { 'mcp-session-id': sid }, body: rpcLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }),
      { sessions },
    );
    expect(res.status).toBe(200);
  });

  it('DELETE /mcp → 204 且会话失效（后续请求 404）', async () => {
    const sessions = new SessionStore({ now: () => 1, newSessionId: idFactory() });
    const server = createMcpServer({});
    const init = await handleHttpRequest(server, req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'initialize' }) }), {
      sessions,
    });
    const sid = init.headers['Mcp-Session-Id'] as string;
    const del = await handleHttpRequest(server, req({ method: 'DELETE', headers: { 'mcp-session-id': sid } }), { sessions });
    expect(del.status).toBe(204);
    expect(del.body).toBe('');
    expect(sessions.has(sid)).toBe(false);
    const after = await handleHttpRequest(
      server,
      req({ method: 'POST', headers: { 'mcp-session-id': sid }, body: rpcLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }),
      { sessions },
    );
    expect(after.status).toBe(404);
  });

  it('DELETE 不带 session 头也 204（幂等终止）', async () => {
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'DELETE' }), { sessions: new SessionStore() });
    expect(res.status).toBe(204);
  });

  it('batch 内含 initialize → 响应头带新建会话 id', async () => {
    const sessions = new SessionStore({ now: () => 1, newSessionId: idFactory() });
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine([{ jsonrpc: '2.0', id: 1, method: 'initialize' }]) }),
      { sessions },
    );
    expect(res.headers['Mcp-Session-Id']).toBe('sess-1');
  });

  it('SessionStore 直接 API：create/has/delete/size/clear', () => {
    const store = new SessionStore({ now: () => 5, newSessionId: idFactory('u') });
    const rec = store.create();
    expect(rec).toEqual({ id: 'u-1', createdAt: 5 });
    expect(store.has('u-1')).toBe(true);
    expect(store.get('u-1')).toEqual(rec);
    expect(store.size()).toBe(1);
    expect(store.delete('u-1')).toBe(true);
    expect(store.delete('u-1')).toBe(false);
    store.create();
    store.clear();
    expect(store.size()).toBe(0);
  });

  it('resetSessions 清模块级默认存储（无 ctx 也能测）', async () => {
    await handleHttpRequest(createMcpServer({}), req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'initialize' }) }));
    resetSessions();
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', headers: { 'mcp-session-id': 'whatever' }, body: rpcLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) }),
    );
    expect(res.status).toBe(404);
  });
});

describe('HTTP 方法与端点路由', () => {
  it('PUT → 405 + Allow: GET, POST, DELETE', async () => {
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'PUT', body: '{}' }));
    expect(res.status).toBe(405);
    expect(res.headers['Allow']).toBe(ALLOWED_METHODS);
    expect(parseRpc(res.body).error?.code).toBe(ERR_METHOD_NOT_ALLOWED);
  });

  it('PATCH → 405', async () => {
    expect((await handleHttpRequest(createMcpServer({}), req({ method: 'PATCH' }))).status).toBe(405);
  });

  it('未知 path → 404 + ERR_ENDPOINT_NOT_FOUND', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', url: '/other', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
    );
    expect(res.status).toBe(404);
    expect(parseRpc(res.body).error?.code).toBe(ERR_ENDPOINT_NOT_FOUND);
  });

  it('方法小写也识别（大小写不敏感）', async () => {
    expect((await handleHttpRequest(createMcpServer({}), req({ method: 'delete' }))).status).toBe(204);
  });

  it('GET → 200 text/event-stream + 握手注释帧（行为固定）', async () => {
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'GET' }));
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
    expect(res.body).toBe(SSE_OPEN_FRAME);
    expect(res.headers['X-Accel-Buffering']).toBe('no');
  });

  it('GET 带有效 session 头回显', async () => {
    const sessions = new SessionStore({ now: () => 1, newSessionId: idFactory() });
    const server = createMcpServer({});
    const init = await handleHttpRequest(server, req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'initialize' }) }), {
      sessions,
    });
    const sid = init.headers['Mcp-Session-Id'] as string;
    const res = await handleHttpRequest(server, req({ method: 'GET', headers: { 'Mcp-Session-Id': sid } }), { sessions });
    expect(res.status).toBe(200);
    expect(res.headers['Mcp-Session-Id']).toBe(sid);
  });

  it('GET 带未知 session → 404（先校验会话再开流）', async () => {
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'GET', headers: { 'mcp-session-id': 'zz' } }), {
      sessions: new SessionStore(),
    });
    expect(res.status).toBe(404);
  });

  it('心跳帧是 SSE 注释行（带时间戳，便于断言）', () => {
    expect(sseHeartbeatFrame(42)).toBe(': heartbeat 42\n\n');
  });
});

describe('Origin 校验（MCP 规范强制的 DNS rebinding 防护）', () => {
  it('缺省 origin → 放行', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
    );
    expect(res.status).toBe(200);
  });

  it('http://localhost:<port> → 放行', async () => {
    expect(defaultValidateOrigin('http://localhost:5173')).toBe(true);
    expect(defaultValidateOrigin('http://localhost')).toBe(true);
    expect(defaultValidateOrigin('http://127.0.0.1:3000')).toBe(true);
  });

  it('恶意 origin → 403 + ERR_FORBIDDEN_ORIGIN', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', headers: { origin: 'https://evil.example' }, body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
    );
    expect(res.status).toBe(403);
    expect(parseRpc(res.body).error?.code).toBe(ERR_FORBIDDEN_ORIGIN);
  });

  it('https://localhost 也拒（默认只放行 http 环回）', async () => {
    expect(defaultValidateOrigin('https://localhost:3000')).toBe(false);
  });

  it('跨端口可配：createDefaultOriginValidator([3000]) 只放行该端口', () => {
    const v = createDefaultOriginValidator([3000]);
    expect(v('http://localhost:3000')).toBe(true);
    expect(v('http://localhost:4000')).toBe(false);
    expect(v('http://127.0.0.1:3000')).toBe(true);
    expect(v(undefined)).toBe(true);
  });

  it('非 URL 串 → 拒', () => {
    expect(createDefaultOriginValidator()('not-a-url')).toBe(false);
    expect(createDefaultOriginValidator()('null')).toBe(true);
    expect(createDefaultOriginValidator()('')).toBe(true);
  });

  it('自定义钩子覆盖默认策略', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', headers: { origin: 'https://evil.example' }, body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
      { validateOrigin: () => true },
    );
    expect(res.status).toBe(200);
  });

  it('Origin 校验早于会话/方法判定（不合法 origin 连 405 都不给）', async () => {
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'PUT', headers: { origin: 'https://evil.example' } }));
    expect(res.status).toBe(403);
  });
});

describe('authorize 钩子（§10.1 生产接 OAuth/token，本轮只留钩子）', () => {
  it('返回 false → 401 + WWW-Authenticate', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
      { authorize: () => false },
    );
    expect(res.status).toBe(401);
    expect(res.headers['WWW-Authenticate']).toContain('Bearer');
    expect(parseRpc(res.body).error?.code).toBe(ERR_UNAUTHORIZED);
  });

  it('返回 true → 放行', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
      { authorize: () => true },
    );
    expect(res.status).toBe(200);
  });

  it('支持 async 钩子（生产 OAuth 校验是异步的）', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', headers: { authorization: 'Bearer t' }, body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
      {
        authorize: async (r) => headerValue(r.headers, 'authorization') === 'Bearer t',
      },
    );
    expect(res.status).toBe(200);
  });

  it('钩子能看到完整请求（url/method/body）', async () => {
    let seen: HttpRequestLike | undefined;
    await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', url: '/mcp?x=1', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) }),
      {
        authorize: (r) => {
          seen = r;
          return true;
        },
      },
    );
    expect(seen?.method).toBe('POST');
    expect(seen?.url).toBe('/mcp?x=1');
    expect(seen?.body).toContain('tools/list');
  });

  it('未注入钩子 → 恒放行（默认无认证）', async () => {
    expect((await handleHttpRequest(createMcpServer({}), req({ method: 'GET' }))).status).toBe(200);
  });
});

describe('body 上限', () => {
  it('超上限 → 413 + ERR_PAYLOAD_TOO_LARGE', async () => {
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(2000) } });
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'POST', body: big }), { maxBodyBytes: 100 });
    expect(res.status).toBe(413);
    expect(parseRpc(res.body).error?.code).toBe(ERR_PAYLOAD_TOO_LARGE);
  });

  it('恰好等于上限不拒', async () => {
    const body = rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'POST', body }), { maxBodyBytes: Buffer.byteLength(body) });
    expect(res.status).toBe(200);
  });

  it('GET/DELETE 不受 body 限额影响', async () => {
    expect((await handleHttpRequest(createMcpServer({}), req({ method: 'GET', body: 'x'.repeat(500) }), { maxBodyBytes: 10 })).status).toBe(200);
    expect((await handleHttpRequest(createMcpServer({}), req({ method: 'DELETE', body: 'x' }), { maxBodyBytes: 10 })).status).toBe(204);
  });
});

describe('§10.6 通道权限铁律在 HTTP 通道同样生效（回归防线）', () => {
  async function callToolOverHttp(name: string, args: unknown, sessions = new SessionStore()): Promise<any> {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) }),
      { sessions },
    );
    expect(res.status).toBe(200);
    return parseRpc(res.body).result;
  }

  it('W 类 install_mod → isError + error.category=permission + confirmRequired=true', async () => {
    const result = await callToolOverHttp('install_mod', { mod: 'jei', instanceId: 'i1' });
    expect(result.isError).toBe(true);
    const body = JSON.parse(result.content[0].text) as {
      ok: boolean;
      permission: string;
      confirmRequired: boolean;
      error: { category: string };
    };
    expect(body.ok).toBe(false);
    expect(body.permission).toBe('W');
    expect(body.confirmRequired).toBe(true);
    expect(body.error.category).toBe('permission');
    expect(result.structuredContent.error.category).toBe('permission');
  });

  it('X 类 launch_instance → 拒绝执行（HTTP 通道同样不弹窗不执行）', async () => {
    const result = await callToolOverHttp('launch_instance', { instanceId: 'i1' });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('本通道不执行');
  });

  it('X 类 build_project / restart_server / stop_server 均拒绝', async () => {
    for (const name of ['build_project', 'restart_server', 'stop_server']) {
      const result = await callToolOverHttp(name, { projectRef: 'p', serverId: 's' });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).permission).toBe('X');
    }
  });

  it('W/X 一律拒绝：25 个工具里 W+X 全部 permission 错误', async () => {
    const server = createMcpServer({});
    const tools = server.listTools();
    const wOrX = ['install_modpack', 'install_mod', 'install_addon', 'import_package', 'apply_skin', 'uninstall_content'];
    for (const name of wOrX) {
      expect(tools.map((t) => t.name)).toContain(name);
      const result = await callToolOverHttp(name, { file: 'f', mod: 'm', addon: 'a', skin: 's', contentId: 'c', instanceId: 'i' });
      expect(result.isError).toBe(true);
      expect(JSON.parse(result.content[0].text).error.category).toBe('permission');
    }
  });

  it('R 类 get_capabilities 在 HTTP 通道正常透传（structuredContent 有 capabilities）', async () => {
    const result = await callToolOverHttp('get_capabilities', {});
    expect(result.isError).toBeUndefined();
    expect(Array.isArray(result.structuredContent.capabilities)).toBe(true);
    expect(result.structuredContent.capabilities.length).toBeGreaterThan(0);
    expect(JSON.parse(result.content[0].text)).toHaveProperty('capabilities');
  });

  it('R 类 get_capabilities edition=server 改道 server 内核', async () => {
    const result = await callToolOverHttp('get_capabilities', { edition: 'server' });
    expect(result.structuredContent.capabilities.map((c: { kind: string }) => c.kind)).toContain('server-plugin');
  });

  it('未知工具 → JSON-RPC -32601（HTTP 200）', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'drop_database' } }) }),
    );
    expect(res.status).toBe(200);
    expect(parseRpc(res.body).error?.code).toBe(-32601);
  });

  it('tools/call 缺 name → -32602', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }) }),
    );
    expect(parseRpc(res.body).error?.code).toBe(-32602);
  });

  it('tools/call arguments 非对象 → -32602', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_capabilities', arguments: 'nope' } }) }),
    );
    expect(parseRpc(res.body).error?.code).toBe(-32602);
  });

  it('tools/call notification → 202（无返回）', async () => {
    const res = await handleHttpRequest(
      createMcpServer({}),
      req({ method: 'POST', body: rpcLine({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'get_capabilities' } }) }),
    );
    expect(res.status).toBe(202);
  });
});

describe('serveHttp 注入宿主端口分支（不开真实端口）', () => {
  it('注入 listener → 不监听，返回 url 与注入的 port，close() 调宿主 close', async () => {
    let closed = false;
    let seen: HttpRequestLike | undefined;
    const running = await serveHttp({
      server: createMcpServer({}),
      port: 9999,
      path: '/mcp',
      newSessionId: idFactory(),
      listener: {
        handle: async (r: HttpRequestLike) => {
          seen = r;
          return { status: 200, headers: {}, body: '' };
        },
        close: () => {
          closed = true;
        },
      },
    } satisfies ServeHttpOptions);
    expect(running.port).toBe(9999);
    expect(running.url).toBe('http://127.0.0.1:9999/mcp');
    const res = await handleHttpRequest(createMcpServer({}), req({ method: 'GET' }));
    expect(res.status).toBe(200);
    await running.close();
    expect(closed).toBe(true);
    expect(seen).toBeUndefined();
  });
});

describe('serveHttp 真机集成（port:0 随机端口 + 真实 fetch）', () => {
  it('端到端：initialize → session 头 → tools/call R 工具 → DELETE → close()', async () => {
    const running = await serveHttp({
      server: createMcpServer({}),
      port: 0,
      newSessionId: idFactory('live'),
    });
    try {
      expect(running.port).toBeGreaterThan(0);
      expect(running.url.endsWith('/mcp')).toBe(true);

      const init = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
      });
      expect(init.status).toBe(200);
      const sid = init.headers.get('mcp-session-id');
      expect(sid).toBe('live-1');
      expect(((await init.json()) as any).result.protocolVersion).toBe('2024-11-05');

      const list = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-session-id': sid ?? '' },
        body: rpcLine({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      });
      expect(((await list.json()) as any).result.tools).toHaveLength(25);

      const call = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-session-id': sid ?? '' },
        body: rpcLine({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_capabilities', arguments: {} } }),
      });
      const callBody = (await call.json()) as any;
      expect(Array.isArray(callBody.result.structuredContent.capabilities)).toBe(true);

      const del = await fetch(running.url, { method: 'DELETE', headers: { 'mcp-session-id': sid ?? '' } });
      expect(del.status).toBe(204);

      const after = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'mcp-session-id': sid ?? '' },
        body: rpcLine({ jsonrpc: '2.0', id: 4, method: 'tools/list' }),
      });
      expect(after.status).toBe(404);
    } finally {
      await running.close();
    }
  });

  it('真机：notification 202 / 非法 JSON 400 / PUT 405 / 未知 path 404 / 恶意 origin 403', async () => {
    const running = await serveHttp({ server: createMcpServer({}), port: 0 });
    try {
      const notif = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: rpcLine({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      });
      expect(notif.status).toBe(202);
      expect(await notif.text()).toBe('');

      const bad = await fetch(running.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{oops' });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as any).error.code).toBe(-32700);

      const put = await fetch(running.url, { method: 'PUT', body: '{}' });
      expect(put.status).toBe(405);
      expect(put.headers.get('allow')).toBe(ALLOWED_METHODS);

      const nf = await fetch(`http://127.0.0.1:${running.port}/nope`, { method: 'POST', body: '{}' });
      expect(nf.status).toBe(404);

      const evil = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
        body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(evil.status).toBe(403);
    } finally {
      await running.close();
    }
  });

  it('真机：authorize false → 401 + WWW-Authenticate', async () => {
    const running = await serveHttp({ server: createMcpServer({}), port: 0, authorize: () => false });
    try {
      const res = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(res.status).toBe(401);
      expect(res.headers.get('www-authenticate')).toContain('Bearer');
    } finally {
      await running.close();
    }
  });

  it('真机：body 超上限 → 413（不炸内存，close 后干净退出）', async () => {
    const running = await serveHttp({ server: createMcpServer({}), port: 0, maxBodyBytes: 64 });
    try {
      const res: Response | Error = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { pad: 'x'.repeat(500) } }),
      }).then(
        (r) => r,
        (e: unknown) => (e instanceof Error ? e : new Error(String(e))),
      );
      // 服务端可能提前 destroy 请求流 → 客户端 fetch 侧报错；两种都算「拦住了」。
      if (res instanceof Error) {
        expect(res.message.length).toBeGreaterThan(0);
      } else {
        expect(res.status).toBe(413);
        expect(((await res.json()) as any).error.code).toBe(ERR_PAYLOAD_TOO_LARGE);
      }
    } finally {
      await running.close();
    }
  });

  it('真机：W 工具经 HTTP 被拒（permission），close() 后端口释放', async () => {
    const running = await serveHttp({ server: createMcpServer({}), port: 0 });
    const port = running.port;
    try {
      const res = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'install_mod', arguments: { mod: 'jei' } } }),
      });
      const body = (await res.json()) as any;
      expect(body.result.isError).toBe(true);
      expect(JSON.parse(body.result.content[0].text).error.category).toBe('permission');
    } finally {
      await running.close();
    }
    await expect(fetch(`http://127.0.0.1:${port}/mcp`, { method: 'DELETE' })).rejects.toBeTruthy();
  });

  it('真机：GET SSE 建流返回 text/event-stream 且握手帧可读到（读到头即 abort，不等心跳）', async () => {
    const running = await serveHttp({ server: createMcpServer({}), port: 0, heartbeatMs: 0 });
    const ac = new AbortController();
    try {
      const res = await fetch(running.url, { method: 'GET', headers: { accept: 'text/event-stream' }, signal: ac.signal });
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('text/event-stream');
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const first = await reader.read();
      expect(new TextDecoder().decode(first.value)).toContain('mc-creator mcp stream open');
      ac.abort();
    } finally {
      await running.close();
    }
  });

  it('真机：自定义 path 与 host 生效（连 127.0.0.1 环回）', async () => {
    const running = await serveHttp({ server: createMcpServer({}), port: 0, host: '127.0.0.1', path: '/rpc' });
    try {
      expect(running.url).toBe(`http://127.0.0.1:${running.port}/rpc`);
      const ok = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      });
      expect(ok.status).toBe(200);
      const miss = await fetch(`http://127.0.0.1:${running.port}/mcp`, { method: 'POST', body: rpcLine({ jsonrpc: '2.0', id: 1, method: 'tools/list' }) });
      expect(miss.status).toBe(404);
    } finally {
      await running.close();
    }
  });
});

