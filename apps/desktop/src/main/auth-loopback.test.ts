import { describe, it, expect } from 'vitest';
import { CALLBACK_PATH } from './ms-oauth.js';
import {
  LoopbackTimeoutError,
  createCallbackHandler,
  parseCallbackRequest,
  startLoopbackAuthServer,
  type AuthCallback,
  type CallbackResponseLike,
} from './auth-loopback.js';

/**
 * loopback 回调服务器测试。
 *
 * **全程不开 socket、不发任何 HTTP 请求**：请求处理逻辑抽成了
 * `parseCallbackRequest` / `createCallbackHandler` 两个纯函数，
 * 测试用假的 req/res 驱动。唯一碰 socket 的 `startLoopbackAuthServer`
 * 只测「起得来 / 端口是动态的 / 立刻能关掉」，不往它发请求。
 */

const HOST = '127.0.0.1';

function fakeRes() {
  const state = { status: 0, body: '', headers: {} as Record<string, string> };
  const res: CallbackResponseLike = {
    writeHead(status, headers) {
      state.status = status;
      state.headers = headers ?? {};
      return res;
    },
    end(body) {
      state.body = body ?? '';
    },
  };
  return { res, state };
}

describe('parseCallbackRequest', () => {
  it('解析出 code / state / error / error_description', () => {
    const cb = parseCallbackRequest(
      {
        method: 'GET',
        url: `${CALLBACK_PATH}?code=abc&state=xyz&error=access_denied&error_description=%E5%A6%82%E4%BD%95`,
      },
      CALLBACK_PATH,
      HOST,
    );
    expect(cb).not.toBe('not_found');
    const v = cb as AuthCallback;
    expect(v.code).toBe('abc');
    expect(v.state).toBe('xyz');
    expect(v.error).toBe('access_denied');
    expect(v.errorDescription).toBe('如何');
  });

  it('缺少 code/state 时给 null（不编造）', () => {
    const cb = parseCallbackRequest({ method: 'GET', url: CALLBACK_PATH }, CALLBACK_PATH, HOST);
    expect(cb).not.toBe('not_found');
    expect((cb as AuthCallback).code).toBeNull();
    expect((cb as AuthCallback).state).toBeNull();
    expect((cb as AuthCallback).error).toBeNull();
  });

  it('非 GET → method_not_allowed（不接受 POST 换 token）', () => {
    expect(parseCallbackRequest({ method: 'POST', url: CALLBACK_PATH }, CALLBACK_PATH, HOST)).toBe(
      'method_not_allowed',
    );
  });

  it('路径不符 → not_found（不解析查询串，不泄露授权码）', () => {
    expect(
      parseCallbackRequest({ method: 'GET', url: '/steal?code=abc' }, CALLBACK_PATH, HOST),
    ).toBe('not_found');
  });

  it('URL 不可解析 → not_found（不抛异常打挂服务器）', () => {
    expect(parseCallbackRequest({ method: 'GET', url: '///' }, CALLBACK_PATH, HOST)).toBe(
      'not_found',
    );
  });
});

describe('createCallbackHandler · 一次性（code_verifier / 授权码不可重放）', () => {
  function setup() {
    let consumed = false;
    const seen: AuthCallback[] = [];
    const handle = createCallbackHandler({
      path: CALLBACK_PATH,
      host: HOST,
      isConsumed: () => consumed,
      onCallback: (cb) => {
        consumed = true;
        seen.push(cb);
      },
    });
    return { handle, seen };
  }

  it('第一次：200 + 回调被交付', () => {
    const { handle, seen } = setup();
    const { res, state } = fakeRes();
    handle({ method: 'GET', url: `${CALLBACK_PATH}?code=c1&state=s1` }, res);
    expect(state.status).toBe(200);
    expect(state.body).toContain('登录完成');
    expect(seen).toHaveLength(1);
    expect(seen[0]!.code).toBe('c1');
  });

  it('⚠️ 第二次投递同一个回调：409，且**不再**交付（防重放）', () => {
    const { handle, seen } = setup();
    const first = fakeRes();
    handle({ method: 'GET', url: `${CALLBACK_PATH}?code=c1&state=s1` }, first.res);
    const replay = fakeRes();
    handle({ method: 'GET', url: `${CALLBACK_PATH}?code=c1&state=s1` }, replay.res);
    expect(replay.state.status).toBe(409);
    expect(seen).toHaveLength(1);
  });

  it('授权被拒（error）也算「已消费」，重放同样 409', () => {
    const { handle, seen } = setup();
    const denied = fakeRes();
    handle({ method: 'GET', url: `${CALLBACK_PATH}?error=access_denied&state=s1` }, denied.res);
    expect(denied.state.status).toBe(400);
    expect(denied.state.body).not.toContain('code');
    const replay = fakeRes();
    handle({ method: 'GET', url: `${CALLBACK_PATH}?code=c&state=s1` }, replay.res);
    expect(replay.state.status).toBe(409);
    expect(seen).toHaveLength(1);
  });

  it('非 GET → 405；错误路径 → 404；两者都**不**消费一次性额度', () => {
    const { handle, seen } = setup();
    const post = fakeRes();
    handle({ method: 'POST', url: CALLBACK_PATH }, post.res);
    expect(post.state.status).toBe(405);
    const wrong = fakeRes();
    handle({ method: 'GET', url: '/nope' }, wrong.res);
    expect(wrong.state.status).toBe(404);
    // 额度仍在：真正的回调仍能成功
    const good = fakeRes();
    handle({ method: 'GET', url: `${CALLBACK_PATH}?code=c&state=s` }, good.res);
    expect(good.state.status).toBe(200);
    expect(seen).toHaveLength(1);
  });

  it('响应体里不回显授权码（不把 code 写进 HTML）', () => {
    const { handle } = setup();
    const { res, state } = fakeRes();
    handle({ method: 'GET', url: `${CALLBACK_PATH}?code=SECRET-CODE-123456&state=s` }, res);
    expect(state.body).not.toContain('SECRET-CODE-123456');
  });
});

describe('startLoopbackAuthServer 生命周期（不开请求，只验证起得来/关得掉）', () => {
  it('redirect_uri 指向 loopback + 固定回调路径，端口由 OS 分配（非 0）', async () => {
    const server = await startLoopbackAuthServer();
    try {
      const url = new URL(server.redirectUri);
      expect(url.protocol).toBe('http:');
      expect(url.hostname).toBe('localhost');
      expect(url.pathname).toBe(CALLBACK_PATH);
      // 端口 0 表示「让 OS 选」，实际拿到的端口必然 > 0 → 永不与既有服务冲突
      expect(Number(url.port)).toBeGreaterThan(0);
    } finally {
      await server.close();
    }
  });

  it('close() 之后能立刻释放端口（连开两次不报 EADDRINUSE）', async () => {
    const a = await startLoopbackAuthServer();
    const first = a.redirectUri;
    await a.close();
    const b = await startLoopbackAuthServer();
    await b.close();
    // 两次都成功即证明没有残留监听
    expect(b.redirectUri).toContain(CALLBACK_PATH);
    expect(first).not.toBe(b.redirectUri);
  });

  it('等待中的 waitForCallback 在 close 时以失败结束（不留悬挂 promise）', async () => {
    const server = await startLoopbackAuthServer();
    const pending = server.waitForCallback(60_000);
    await server.close();
    await expect(pending).rejects.toThrow(/回调服务器关闭/);
  });

  it('超时 → LoopbackTimeoutError（fail-closed，不无限等）', async () => {
    const server = await startLoopbackAuthServer();
    try {
      await expect(server.waitForCallback(20)).rejects.toBeInstanceOf(LoopbackTimeoutError);
    } finally {
      await server.close();
    }
  });

  it('close() 幂等（重复关不抛）', async () => {
    const server = await startLoopbackAuthServer();
    await server.close();
    await expect(server.close()).resolves.toBeUndefined();
  });

  it('超时后仍可再次等待（服务器没被「用坏」）', async () => {
    const server = await startLoopbackAuthServer();
    try {
      await expect(server.waitForCallback(10)).rejects.toBeInstanceOf(LoopbackTimeoutError);
      await expect(server.waitForCallback(10)).rejects.toBeInstanceOf(LoopbackTimeoutError);
    } finally {
      await server.close();
    }
  });
});
