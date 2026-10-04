/**
 * MCP Streamable HTTP 协议补全测试（§10.1）：
 * A) Accept 头校验 · B) 主动推送 notifications/* · C) 会话持久化。
 *
 * 与 mcp-http.test.ts 的分工：那边测「既有行为不许漂移」，这边只测本轮新增的三块。
 * 全部用传输无关核心 handleHttpRequest（纯逻辑，不开端口）+ 可注入时钟/时钟/存储，
 * 不 sleep；只有 C 的 JSON 文件后端要真碰磁盘（用临时目录 + afterEach 清理）。
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMcpServer } from './mcp-server.js';
import {
  ERR_NOT_ACCEPTABLE,
  NotificationHub,
  SessionStore,
  acceptsMediaType,
  createJsonFilePersistence,
  defaultAcceptChecker,
  handleHttpRequest,
  parseAccept,
  postAcceptOk,
  resetSessions,
  serveHttp,
  sseAcceptOk,
  sseNotificationFrame,
} from './mcp-http.js';
import type { HttpRequestLike, NotificationTarget, SessionRecord } from './mcp-http.js';

// ---------------------------------------------------------------------------
// A) Accept 头校验
// ---------------------------------------------------------------------------

describe('parseAccept（RFC 9110 media-range 解析）', () => {
  it('单值 → 一条，q 默认 1', () => {
    expect(parseAccept('application/json')).toEqual([{ type: 'application/json', q: 1 }]);
  });

  it('逗号分隔多值 + q 值', () => {
    expect(parseAccept('application/json;q=0.9, text/event-stream')).toEqual([
      { type: 'application/json', q: 0.9 },
      { type: 'text/event-stream', q: 1 },
    ]);
  });

  it('大小写不敏感（media type 是大小写无关的）', () => {
    expect(parseAccept('APPLICATION/JSON')).toEqual([{ type: 'application/json', q: 1 }]);
  });

  it('参数与 type 之间允许空格；多个参数只取 q', () => {
    expect(parseAccept('application/json ; charset=utf-8 ; q=0.5')).toEqual([
      { type: 'application/json', q: 0.5 },
    ]);
  });

  it('非法 q 值按 1.0 处理（宁可宽松也不因畸形头拒绝合法请求）', () => {
    expect(parseAccept('application/json;q=abc')).toEqual([{ type: 'application/json', q: 1 }]);
  });

  it('q>1 归一到 1，q<0 归一到 0（显式拒绝）', () => {
    expect(parseAccept('application/json;q=5')).toEqual([{ type: 'application/json', q: 1 }]);
    expect(parseAccept('application/json;q=-1')).toEqual([{ type: 'application/json', q: 0 }]);
  });

  it('缺头 / 空串 / 只有逗号 → 空数组', () => {
    expect(parseAccept(undefined)).toEqual([]);
    expect(parseAccept('')).toEqual([]);
    expect(parseAccept(' , , ')).toEqual([]);
  });

  it('畸形项被跳过，不影响其余合法项', () => {
    expect(parseAccept('garbage, application/json, /json, text/event-stream')).toEqual([
      { type: 'application/json', q: 1 },
      { type: 'text/event-stream', q: 1 },
    ]);
  });
});

describe('acceptsMediaType（前缀匹配是真实世界的坑）', () => {
  it('精确匹配 type/subtype 命中', () => {
    expect(acceptsMediaType(parseAccept('application/json'), 'application/json')).toBe(true);
  });

  it('**json-seq 不算已声明 application/json**（includes 前缀匹配的经典 bug）', () => {
    // 'application/json-seq'.includes('application/json') === true，
    // 但 json-seq 是完全不同的媒体类型，接了它我们的响应格式对不上。
    expect(acceptsMediaType(parseAccept('application/json-seq'), 'application/json')).toBe(false);
  });

  it('type 通配命中该 type 下所有 subtype，但不跨 type', () => {
    expect(acceptsMediaType(parseAccept('application/*'), 'application/json')).toBe(true);
    expect(acceptsMediaType(parseAccept('application/*'), 'text/event-stream')).toBe(false);
  });

  it('全通配命中一切', () => {
    expect(acceptsMediaType(parseAccept('*/*'), 'application/json')).toBe(true);
    expect(acceptsMediaType(parseAccept('*/*'), 'text/event-stream')).toBe(true);
  });

  it('未声明任何可收范围 → 不可接受（空列表）', () => {
    expect(acceptsMediaType([], 'application/json')).toBe(false);
    expect(acceptsMediaType(parseAccept('image/png'), 'application/json')).toBe(false);
  });

  it('精确项 q=0 优先于通配项 q=1（q=0 是显式拒绝，不能被通配救回）', () => {
    expect(acceptsMediaType(parseAccept('application/json;q=0, */*;q=1'), 'application/json')).toBe(
      false,
    );
  });

  it('精确项 q=0.2 优先于通配项 q=0.9（取优先级最高那条的 q，不是取最大 q）', () => {
    expect(
      acceptsMediaType(parseAccept('application/json;q=0.2, */*;q=0.9'), 'application/json'),
    ).toBe(true);
    expect(
      acceptsMediaType(parseAccept('application/json;q=0, */*;q=0.9'), 'application/json'),
    ).toBe(false);
  });
});

describe('postAcceptOk / sseAcceptOk / defaultAcceptChecker', () => {
  it('POST：双类型齐备 → 可接受', () => {
    expect(postAcceptOk('application/json, text/event-stream')).toBe(true);
  });

  it('POST：缺 text/event-stream → 不可接受', () => {
    expect(postAcceptOk('application/json')).toBe(false);
  });

  it('POST：缺 application/json → 不可接受', () => {
    expect(postAcceptOk('text/event-stream')).toBe(false);
  });

  it('POST：全通配可接受（规范未要求精确类型，只要求声明能力）', () => {
    expect(postAcceptOk('*/*')).toBe(true);
  });

  it('POST：完全无 Accept 头按 RFC 9110 等价全通配 → 可接受', () => {
    expect(postAcceptOk(undefined)).toBe(true);
    expect(postAcceptOk('')).toBe(true);
  });

  it('POST：带 q 值时只要两类型 q>0 即可', () => {
    expect(postAcceptOk('application/json;q=0.1, text/event-stream;q=0.1')).toBe(true);
    expect(postAcceptOk('application/json;q=0, text/event-stream')).toBe(false);
  });

  it('GET(SSE)：只需 text/event-stream，不要求 json', () => {
    expect(sseAcceptOk('text/event-stream')).toBe(true);
    expect(sseAcceptOk('application/json')).toBe(false);
    expect(sseAcceptOk('text/event-stream, application/json')).toBe(true);
  });

  /**
   * 默认判据只对 POST 严格（§10.1：规范对 GET 是 MAY 不是 MUST）。
   * GET/DELETE 放行 —— SSE 的 Content-Type 由服务端定，客户端没声明
   * text/event-stream 不代表不能收。真要严格用 acceptChecker 自定义。
   */
  it('defaultAcceptChecker：POST 严格（双类型），GET/DELETE 放行', () => {
    expect(defaultAcceptChecker('application/json, text/event-stream', 'POST')).toBe(true);
    expect(defaultAcceptChecker('application/json', 'POST')).toBe(false);
    expect(defaultAcceptChecker('application/json', 'GET')).toBe(true);
    expect(defaultAcceptChecker('application/json', 'GET')).toBe(true);
    expect(defaultAcceptChecker('image/png', 'DELETE')).toBe(true);
    // method 大小写不敏感
    expect(defaultAcceptChecker('application/json', 'post')).toBe(false);
    expect(defaultAcceptChecker('application/json', 'Post')).toBe(false);
  });
});

describe('handleHttpRequest 的 Accept 校验（默认宽松，可开启）', () => {
  const req = (headers: Record<string, string>): HttpRequestLike => ({
    method: 'POST',
    url: '/mcp',
    headers,
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
  });

  it('默认宽松：只有 application/json 也放行（规范用 MAY，且已有 Origin/授权兜底）', async () => {
    const res = await handleHttpRequest(createMcpServer(), req({ accept: 'application/json' }));
    expect(res.status).toBe(200);
  });

  it('requireAccept=true 且缺 text/event-stream → 406 + ERR_NOT_ACCEPTABLE', async () => {
    const res = await handleHttpRequest(createMcpServer(), req({ accept: 'application/json' }), {
      requireAccept: true,
    });
    expect(res.status).toBe(406);
    const body = JSON.parse(res.body) as { error: { code: number; message: string } };
    expect(body.error.code).toBe(ERR_NOT_ACCEPTABLE);
    expect(body.error.message).toMatch(/text\/event-stream/);
  });

  it('requireAccept=true 且双类型齐备 → 正常 200', async () => {
    const res = await handleHttpRequest(
      createMcpServer(),
      req({ accept: 'application/json, text/event-stream' }),
      { requireAccept: true },
    );
    expect(res.status).toBe(200);
  });

  it('requireAccept=true 且 Accept 头完全缺失 → 放行（等价全通配）', async () => {
    const res = await handleHttpRequest(createMcpServer(), req({}), { requireAccept: true });
    expect(res.status).toBe(200);
  });

  it('Accept 校验早于 body 解析：不接受时不因畸形 body 报 JSON 错', async () => {
    const res = await handleHttpRequest(
      createMcpServer(),
      { method: 'POST', url: '/mcp', headers: { accept: 'application/json' }, body: '{ broken' },
      { requireAccept: true },
    );
    expect(res.status).toBe(406);
    expect(res.body).toMatch(/Not Acceptable/);
  });

  it('GET 在 requireAccept=true 下只要求 event-stream', async () => {
    const res = await handleHttpRequest(
      createMcpServer(),
      { method: 'GET', url: '/mcp', headers: { accept: 'text/event-stream' }, body: '' },
      { requireAccept: true },
    );
    expect(res.status).toBe(200);
    expect(res.headers['Content-Type']).toBe('text/event-stream');
  });

  /**
   * GET 的 Accept **不被**强制 —— 这是有意的取舍，不是漏做。
   *
   * 规范对 GET 的要求是「客户端可以声明 text/event-stream」，
   * 而不是「必须声明」。若强制，会把「Accept 里没写 event-stream」
   * 的客户端（不少手写 curl / 老 SDK）直接挡在 SSE 之外，
   * 而 SSE 的 Content-Type 是**我们**定的，客户端没声明不代表不能收。
   * 真要严格，用 acceptChecker 自己实现（见下一条测试）。
   */
  it('GET 缺 event-stream 仍放行（SSE 的 Content-Type 由服务端定，规范对 GET 是 MAY）', async () => {
    const res = await handleHttpRequest(
      createMcpServer(),
      { method: 'GET', url: '/mcp', headers: { accept: 'application/json' }, body: '' },
      { requireAccept: true },
    );
    expect(res.status).toBe(200);
  });

  it('想要严格校验 SSE 的 Accept，可自定义 acceptChecker', async () => {
    const strict = (accept: string | undefined, method: string): boolean =>
      method === 'GET' ? sseAcceptOk(accept) : defaultAcceptChecker(accept, method);
    const res = await handleHttpRequest(
      createMcpServer(),
      { method: 'GET', url: '/mcp', headers: { accept: 'application/json' }, body: '' },
      { requireAccept: true, acceptChecker: strict },
    );
    expect(res.status).toBe(406);
  });

  it('acceptChecker 可自定义判据', async () => {
    const res = await handleHttpRequest(createMcpServer(), req({ accept: 'image/png' }), {
      requireAccept: true,
      acceptChecker: () => true,
    });
    expect(res.status).toBe(200);
  });

  it('Accept 校验不放松 §10.6：W/X 工具在严格模式下仍被拒', async () => {
    const res = await handleHttpRequest(
      createMcpServer(),
      {
        method: 'POST',
        url: '/mcp',
        headers: { accept: 'application/json, text/event-stream' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'deploy_plugin', arguments: { serverId: 's', artifactPath: 'a.jar' } },
        }),
      },
      { requireAccept: true },
    );
    expect(res.status).toBe(200);
    expect(res.body).toMatch(/须弹窗确认/);
  });
});

// ---------------------------------------------------------------------------
// B) 主动推送 notifications/*
// ---------------------------------------------------------------------------

/** 可断言的推送目标（记录收到的帧，可模拟背压/关闭/抛错）。 */
function target(opts: { backpressure?: boolean; closed?: boolean; throws?: boolean } = {}) {
  const frames: string[] = [];
  const t: NotificationTarget = {
    write: (frame) => {
      if (opts.throws === true) throw new Error('socket destroyed');
      frames.push(frame);
      return opts.backpressure !== true;
    },
    writable: () => opts.closed !== true,
  };
  return { target: t, frames };
}

describe('sseNotificationFrame（SSE 数据帧格式）', () => {
  it('形状：event 行 + data 行 + 空行结尾', () => {
    const frame = sseNotificationFrame('notifications/progress', { progress: 0.5 });
    expect(frame.endsWith('\n\n')).toBe(true);
    expect(frame.startsWith('event: message\ndata: ')).toBe(true);
  });

  it('载荷是 JSON-RPC notification：有 jsonrpc + method，无 id', () => {
    const frame = sseNotificationFrame('notifications/progress', { progress: 0.5 });
    const json = frame.slice(frame.indexOf('data: ') + 6, -2);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed['jsonrpc']).toBe('2.0');
    expect(parsed['method']).toBe('notifications/progress');
    expect(parsed).not.toHaveProperty('id');
    expect(parsed['params']).toEqual({ progress: 0.5 });
  });

  it('与心跳注释帧是两条不同的路（心跳不进事件流）', () => {
    const beat = sseNotificationFrame('x', {});
    expect(beat).not.toMatch(/^:/m);
    expect(beat).toMatch(/^event:/m);
  });

  it('data 只有一行（JSON.stringify 不产裸换行，无需多行 data 前缀）', () => {
    const frame = sseNotificationFrame('notifications/message', { text: 'a\nb' });
    const dataLines =
      frame
        .split('\n\n')[0]
        ?.split('\n')
        .filter((l) => l.startsWith('data: ')) ?? [];
    expect(dataLines).toHaveLength(1);
    expect(JSON.parse(dataLines[0]?.slice(6) ?? '{}')).toMatchObject({ params: { text: 'a\nb' } });
  });
});

describe('NotificationHub（主动推送）', () => {
  it('notifySession 推给指定会话', () => {
    const hub = new NotificationHub();
    const a = target();
    hub.attach('s1', a.target);
    expect(hub.notifySession('s1', 'notifications/progress', { p: 1 })).toBe(true);
    expect(a.frames).toHaveLength(1);
    expect(a.frames[0]).toMatch(/notifications\/progress/);
  });

  it('notifySession 目标不存在 → false，不抛', () => {
    const hub = new NotificationHub();
    expect(hub.notifySession('nope', 'notifications/progress', {})).toBe(false);
  });

  it('notifyAll 推给全部已挂载流，返回投递成功数', () => {
    const hub = new NotificationHub();
    const a = target();
    const b = target();
    hub.attach('s1', a.target);
    hub.attach('s2', b.target);
    expect(hub.notifyAll('notifications/progress', { p: 2 })).toBe(2);
    expect(a.frames).toHaveLength(1);
    expect(b.frames).toHaveLength(1);
  });

  it('流已关闭 → 不投递、返回 false，且被 notifyAll 顺手清掉（不泄漏 Map）', () => {
    const hub = new NotificationHub();
    const dead = target({ closed: true });
    hub.attach('dead', dead.target);
    expect(hub.notifySession('dead', 'notifications/progress', {})).toBe(false);
    expect(hub.notifyAll('notifications/progress', {})).toBe(0);
    expect(hub.size()).toBe(0);
  });

  it('背压（write 返回 false）→ 丢弃并计数，不排队', () => {
    const hub = new NotificationHub();
    const slow = target({ backpressure: true });
    hub.attach('slow', slow.target);
    expect(hub.notifySession('slow', 'notifications/progress', { p: 1 })).toBe(false);
    expect(hub.droppedCount()).toBe(1);
    expect(slow.frames).toHaveLength(1); // 帧写了，但返回 false 视为未投递成功
  });

  it('write 抛异常（对端刚断）→ 吞掉并计数，不炸调用方', () => {
    const hub = new NotificationHub();
    hub.attach('boom', target({ throws: true }).target);
    expect(() => hub.notifySession('boom', 'notifications/progress', {})).not.toThrow();
    expect(hub.notifySession('boom', 'notifications/progress', {})).toBe(false);
    expect(hub.droppedCount()).toBe(2);
  });

  it('attach 同 id 覆盖旧流（客户端重连场景）', () => {
    const hub = new NotificationHub();
    const old = target();
    const fresh = target();
    hub.attach('s1', old.target);
    hub.attach('s1', fresh.target);
    expect(hub.size()).toBe(1);
    hub.notifySession('s1', 'notifications/progress', {});
    expect(old.frames).toHaveLength(0);
    expect(fresh.frames).toHaveLength(1);
  });

  it('detach / clear 清空挂载', () => {
    const hub = new NotificationHub();
    hub.attach('s1', target().target);
    hub.attach('s2', target().target);
    hub.detach('s1');
    expect(hub.size()).toBe(1);
    hub.clear();
    expect(hub.size()).toBe(0);
  });
});

describe('serveHttp 把 SSE 流接入推送中心', () => {
  it('带会话 id 的 GET 流可被 notifications.notifySession 投递', async () => {
    const server = createMcpServer();
    let idSeq = 0;
    const running = await serveHttp({
      server,
      port: 0,
      heartbeatMs: 0,
      newSessionId: () => {
        idSeq += 1;
        return `live-s${idSeq}`;
      },
    });
    try {
      // 先 initialize 拿会话
      const init = await fetch(running.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
      });
      const sid = init.headers.get('mcp-session-id');
      expect(sid).toBe('live-s1');

      // 建立 SSE 流并读完握手帧，确认流已挂载
      const controller = new AbortController();
      const stream = await fetch(running.url, {
        headers: { accept: 'text/event-stream', 'mcp-session-id': sid as string },
        signal: controller.signal,
      });
      expect(stream.headers.get('content-type')).toBe('text/event-stream');
      const reader = stream.body?.getReader();
      const first = await reader?.read();
      const handshake = new TextDecoder().decode(first?.value ?? new Uint8Array());
      expect(handshake).toContain('mc-creator mcp stream open');

      // 推送一条 notification：客户端应收到数据帧
      expect(
        running.notifications.notifySession(sid as string, 'notifications/progress', { p: 0.25 }),
      ).toBe(true);
      const second = await reader?.read();
      const frame = new TextDecoder().decode(second?.value ?? new Uint8Array());
      expect(frame).toMatch(/^event: message\ndata: /);
      const json = frame.slice(frame.indexOf('data: ') + 6, -2);
      expect(JSON.parse(json)).toMatchObject({
        method: 'notifications/progress',
        params: { p: 0.25 },
      });

      controller.abort();
      await reader?.cancel().catch(() => undefined);
    } finally {
      await running.close();
    }
  });

  it('close() 后推送不产生未捕获异常（Hub 已清空）', async () => {
    const running = await serveHttp({ server: createMcpServer(), port: 0, heartbeatMs: 0 });
    await running.close();
    expect(running.notifications.size()).toBe(0);
    expect(running.notifications.notifySession('any', 'notifications/progress', {})).toBe(false);
    expect(() => running.notifications.notifyAll('notifications/progress', {})).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// C) 会话持久化
// ---------------------------------------------------------------------------

describe('SessionStore 持久化（内存后端，跨实例）', () => {
  /** 可注入的内存后端：模拟「落盘」，并能注入写失败。 */
  function memBackend(initial: SessionRecord[] = [], opts: { failSave?: boolean } = {}) {
    let disk = [...initial];
    const saves: SessionRecord[][] = [];
    return {
      saves,
      peek: () => disk,
      backend: {
        load: () => [...disk],
        save: (records: SessionRecord[]) => {
          if (opts.failSave === true) throw new Error('disk full');
          disk = [...records];
          saves.push([...records]);
        },
      },
    };
  }

  it('给了 persistence → 建会话后落盘', () => {
    const m = memBackend();
    const store = new SessionStore({ newSessionId: () => 'sid-1', persistence: m.backend });
    store.create();
    expect(m.peek()).toEqual([{ id: 'sid-1', createdAt: expect.any(Number) }]);
  });

  it('重启后新建的 SessionStore 读回存档，会话仍可用', () => {
    const m = memBackend();
    const first = new SessionStore({ newSessionId: () => 'sid-1', persistence: m.backend });
    first.create();
    const second = new SessionStore({ newSessionId: () => 'sid-2', persistence: m.backend });
    expect(second.has('sid-1')).toBe(true);
  });

  it('delete / 过期清理 也会落盘', () => {
    const m = memBackend();
    const store = new SessionStore({ newSessionId: () => 'sid-1', persistence: m.backend });
    store.create();
    store.delete('sid-1');
    expect(m.peek()).toEqual([]);
  });

  it('启动加载时丢弃已过期条目（不把垃圾带进内存）', () => {
    // now=100_000、ttl=5_000 → 存活窗口 [95_000, 100_000]
    const stale: SessionRecord[] = [{ id: 'old', createdAt: 1_000 }]; // 99s 前建的，早过期
    const fresh: SessionRecord[] = [{ id: 'new', createdAt: 99_000 }]; // 1s 前建的，仍有效
    const store = new SessionStore({
      now: () => 100_000,
      ttlMs: 5_000,
      persistence: memBackend([...stale, ...fresh]).backend,
    });
    expect(store.has('old')).toBe(false);
    expect(store.has('new')).toBe(true);
  });

  it('ttlMs<=0（永不过期）→ 启动时连旧条目一起载入', () => {
    const store = new SessionStore({
      now: () => 10_000_000,
      ttlMs: 0,
      persistence: memBackend([{ id: 'ancient', createdAt: 0 }]).backend,
    });
    expect(store.has('ancient')).toBe(true);
  });

  it('启动加载时丢弃畸形条目（id 非串 / createdAt 非数）', () => {
    const junk = [
      { id: '', createdAt: 1 },
      { id: 'ok', createdAt: 1 },
      { id: 'nan', createdAt: Number.NaN },
    ] as unknown as SessionRecord[];
    const store = new SessionStore({
      now: () => 1,
      ttlMs: 0,
      persistence: memBackend(junk).backend,
    });
    expect(store.has('ok')).toBe(true);
    expect(store.has('')).toBe(false);
    expect(store.has('nan')).toBe(false);
  });

  it('落盘抛异常不影响会话可用（只丢跨重启能力，不打断请求）', () => {
    const store = new SessionStore({
      newSessionId: () => 'sid-1',
      persistence: memBackend([], { failSave: true }).backend,
    });
    const record = store.create();
    expect(record.id).toBe('sid-1');
    expect(store.has('sid-1')).toBe(true);
  });

  it('未给 persistence → 不落盘（默认内存态，请求路径无 IO）', () => {
    const store = new SessionStore({ newSessionId: () => 'sid-1' });
    store.create();
    const fresh = new SessionStore({ newSessionId: () => 'x' });
    expect(fresh.has('sid-1')).toBe(false);
  });

  it('SessionStore.load 返回 Promise 时异步落盘也不炸（save 可返回 Promise）', async () => {
    const saved: SessionRecord[][] = [];
    const store = new SessionStore({
      newSessionId: () => 'sid-async',
      persistence: {
        load: () => [],
        save: async (records) => {
          await Promise.resolve();
          saved.push([...records]);
        },
      },
    });
    store.create();
    await Promise.resolve();
    await Promise.resolve();
    expect(saved[0]?.[0]?.id).toBe('sid-async');
  });
});

describe('createJsonFilePersistence（真落盘，临时目录）', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const mkStorePath = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'mcp-sessions-'));
    dirs.push(d);
    return join(d, 'sessions.json');
  };

  it('存档不存在 → load 返回空集', () => {
    expect(createJsonFilePersistence(mkStorePath()).load()).toEqual([]);
  });

  it('save 后 load 能读回（含嵌套目录自动创建）', () => {
    const p = join(mkStorePath(), 'nested', 'sessions.json');
    const backend = createJsonFilePersistence(p);
    backend.save([{ id: 'sid-1', createdAt: 42 }]);
    expect(backend.load()).toEqual([{ id: 'sid-1', createdAt: 42 }]);
  });

  it('存档损坏（非法 JSON）→ load 返回空集，不抛（服务必须能起来）', () => {
    const p = mkStorePath();
    writeFileSync(p, '{ broken json', 'utf8');
    expect(createJsonFilePersistence(p).load()).toEqual([]);
  });

  it('存档不是数组 → 空集', () => {
    const p = mkStorePath();
    writeFileSync(p, '{"id":"x"}', 'utf8');
    expect(createJsonFilePersistence(p).load()).toEqual([]);
  });

  it('存档条目畸形 → 逐条过滤', () => {
    const p = mkStorePath();
    writeFileSync(p, JSON.stringify([{ id: 'ok', createdAt: 1 }, { id: 5 }, null]), 'utf8');
    expect(createJsonFilePersistence(p).load()).toEqual([{ id: 'ok', createdAt: 1 }]);
  });

  it('原子写：不留 .tmp 残留', () => {
    const p = mkStorePath();
    createJsonFilePersistence(p).save([{ id: 'sid-1', createdAt: 1 }]);
    // 若不是「临时文件 + rename」，同目录会多出 .tmp
    expect(() => readFileSync(`${p}.tmp`, 'utf8')).toThrow();
    expect(JSON.parse(readFileSync(p, 'utf8'))).toEqual([{ id: 'sid-1', createdAt: 1 }]);
  });

  it('路径不可写（目录不存在且无法创建）→ save 静默失败不抛', () => {
    const p = createJsonFilePersistence(join(mkStorePath(), 'ok.json'));
    // 正常路径下先写一次再用不可写路径验证
    p.save([{ id: 'x', createdAt: 1 }]);
    const bogus = createJsonFilePersistence('\0invalid\0path.json');
    expect(() => bogus.save([{ id: 'y', createdAt: 1 }])).not.toThrow();
  });

  it('serveHttp 传 sessionStorePath → 重启后会话仍可用（端到端）', async () => {
    const p = mkStorePath();
    const first = await serveHttp({
      server: createMcpServer(),
      port: 0,
      heartbeatMs: 0,
      sessionStorePath: p,
      newSessionId: () => 'persisted-sid',
    });
    await fetch(first.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    await first.close();

    const second = await serveHttp({
      server: createMcpServer(),
      port: 0,
      heartbeatMs: 0,
      sessionStorePath: p,
      newSessionId: () => 'other',
    });
    try {
      // 用旧会话 id 发请求：不再 404（说明存档被读回）
      const res = await fetch(second.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json',
          'mcp-session-id': 'persisted-sid',
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { tools: unknown[] } };
      expect(body.result.tools.length).toBeGreaterThan(0);
    } finally {
      await second.close();
    }
  });
});

describe('模块级 resetSessions 仍清空默认存储（既有测试依赖）', () => {
  it('resetSessions 不抛', () => {
    expect(() => resetSessions()).not.toThrow();
  });

  it('无 persistence 时 serveHttp 也能正常起停（默认路径不回归）', async () => {
    const running = await serveHttp({ server: createMcpServer(), port: 0, heartbeatMs: 0 });
    const res = await fetch(running.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    });
    expect(res.status).toBe(200);
    await running.close();
  });
});

// 防「测试没真正跑到」的静默失败：确认 spy 类误用会暴露。
describe('自检', () => {
  it('vi.fn 可用（确认本文件确实在 vitest 环境里跑）', () => {
    const spy = vi.fn();
    spy('x');
    expect(spy).toHaveBeenCalledWith('x');
  });
});
