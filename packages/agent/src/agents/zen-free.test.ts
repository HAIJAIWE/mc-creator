/**
 * zen-free.ts（Zen 免费通道直连传输）单元测试。
 * 全注入 fetchImpl，不断网：覆盖成功 / content 缺失 / 401 / 403 两种 / 429 / 400 /
 * 超时 / 会话复用 / 请求 id 格式 / quartet 填充 / tool_choice none / 探测 / 网关。
 */
import { describe, expect, it } from 'vitest';
import {
  CLIENT_UA,
  DEFAULT_ZEN_FREE_MODEL,
  FINGERPRINT_TOOLS,
  REQUEST_RE,
  SESSION_RE,
  ZEN_BASE,
  applyQuartetDecoys,
  createZenFreeGateway,
  createZenFreeTransport,
  endpointFor,
  gatewayHeaders,
  mintSessionId,
  probeZenModels,
  requestIdFor,
  sessionForConversation,
  wireFor,
} from './zen-free.js';
import type { FetchImpl } from './openai-chat.js';
import type { InferRequest } from './infer.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function okChatPayload(content = 'hello'): unknown {
  return {
    choices: [{ message: { content } }],
    usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
  };
}

describe('成功路径：默认模型 + decoy + 指纹头', () => {
  it('默认 space-bunny-free，空 tools 时填 quartet decoy + tool_choice none', async () => {
    let seenUrl = '';
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    const fetchImpl: FetchImpl = async (input, init) => {
      seenUrl = String(input);
      seenHeaders = init?.headers as Record<string, string>;
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(okChatPayload());
    };
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel(
      { messages: [{ role: 'user', content: 'hi' }] },
      'any-key-ignored',
      0,
    );
    expect(res.ok).toBe(true);
    expect(res.text).toBe('hello');
    expect(res.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    expect(seenUrl).toBe('https://opencode.ai/zen/v1/chat/completions');
    expect(seenBody['model']).toBe('space-bunny-free');
    expect(seenBody['model']).toBe(DEFAULT_ZEN_FREE_MODEL);
    const tools = seenBody['tools'] as Array<{ function: { name: string } }>;
    expect(tools.map((t) => t.function.name)).toEqual(['bash', 'glob', 'grep', 'read']);
    expect(seenBody['tool_choice']).toBe('none');
    expect(seenHeaders['Authorization']).toBe('Bearer public');
    expect(seenHeaders['User-Agent']).toBe(CLIENT_UA);
    expect(seenHeaders['x-opencode-client']).toBe('desktop');
    expect(seenHeaders['x-opencode-project']).toBe('global');
    expect(seenHeaders['x-opencode-session']).toMatch(SESSION_RE);
    expect(seenHeaders['x-opencode-request']).toMatch(REQUEST_RE);
  });

  it('调用方自带 tools 时原样透传，不强制 tool_choice', async () => {
    let seenBody: Record<string, unknown> = {};
    const fetchImpl: FetchImpl = async (_input, init) => {
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(okChatPayload('ok'));
    };
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel(
      {
        messages: [{ role: 'user', content: 'hi' }],
        tools: [{ name: 'mytool', description: 'd' }],
      },
      'ignored',
      0,
    );
    expect(res.ok).toBe(true);
    const tools = seenBody['tools'] as Array<{ function: { name: string } }>;
    expect(tools.map((t) => t.function.name)).toEqual(['mytool']);
    expect(seenBody['tool_choice']).toBeUndefined();
  });

  it('model 覆盖生效', async () => {
    let seenBody: Record<string, unknown> = {};
    const fetchImpl: FetchImpl = async (_input, init) => {
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse(okChatPayload());
    };
    const callModel = createZenFreeTransport({ model: 'custom-free', fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'ignored', 0);
    expect(res.ok).toBe(true);
    expect(seenBody['model']).toBe('custom-free');
  });
});

describe('content 缺失 → 终态失败注明形状', () => {
  it('空 choices', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({ choices: [] });
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.reason).toContain('choices[0].message.content');
  });

  it('content 非字符串', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({ choices: [{ message: {} }] });
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.reason).toContain('choices[0].message.content');
  });
});

describe('HTTP 状态映射', () => {
  it('401 → 终态失败“需真实 Key”', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'auth required' } }), { status: 401 });
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.reason).toContain('需真实 Key');
  });

  it('403 FreeTierError → 终态失败并透传原文', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response(
        JSON.stringify({ error: { code: 'FreeTierError', message: 'free tier exhausted' } }),
        {
          status: 403,
        },
      );
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.reason).toContain('FreeTierError');
    expect(res.error?.reason).toContain('free tier exhausted');
  });

  it('403 RegionError → 终态失败并透传原文', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response(
        JSON.stringify({ error: { code: 'RegionError', message: 'region not allowed' } }),
        {
          status: 403,
        },
      );
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.reason).toContain('RegionError');
    expect(res.error?.reason).toContain('region not allowed');
  });

  it('429 → retryable:true', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(true);
  });

  it('500 → retryable:true', async () => {
    const fetchImpl: FetchImpl = async () => new Response('boom', { status: 500 });
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(true);
  });

  it('400 → 终态失败并透传 message', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response(JSON.stringify({ error: { message: 'Model不可用' } }), { status: 400 });
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.reason).toContain('Model不可用');
  });
});

describe('超时 / 断网 → retryable:true（绝不抛）', () => {
  it('悬挂 fetch + 短 timeoutMs → TIMEOUT', async () => {
    const fetchImpl: FetchImpl = () => new Promise<Response>(() => {});
    const callModel = createZenFreeTransport({ fetchImpl, timeoutMs: 20 });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('TIMEOUT');
    expect(res.error?.retryable).toBe(true);
  });

  it('断网抛错 → MODEL_ERROR + retryable:true', async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    const callModel = createZenFreeTransport({ fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('MODEL_ERROR');
    expect(res.error?.retryable).toBe(true);
  });
});

describe('会话复用 + id 格式', () => {
  it('同一 transport 两次调用复用同 session，request 各异且均合格式', async () => {
    const sessions: string[] = [];
    const requests: string[] = [];
    const fetchImpl: FetchImpl = async (_input, init) => {
      const h = init?.headers as Record<string, string>;
      sessions.push(h['x-opencode-session']);
      requests.push(h['x-opencode-request']);
      return jsonResponse(okChatPayload());
    };
    const callModel = createZenFreeTransport({ sessionSeed: 'stable-seed', fetchImpl });
    const r1 = await callModel({ messages: [{ role: 'user', content: 'a' }] }, 'k', 0);
    const r2 = await callModel({ messages: [{ role: 'user', content: 'b' }] }, 'k', 1);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    expect(sessions).toHaveLength(2);
    expect(sessions[0]).toMatch(SESSION_RE);
    expect(sessions[1]).toBe(sessions[0]);
    expect(sessionForConversation('stable-seed')).toBe(sessions[0]);
    expect(requests).toHaveLength(2);
    expect(requests[0]).toMatch(REQUEST_RE);
    expect(requests[1]).toMatch(REQUEST_RE);
  });

  it('mintSessionId / sessionForConversation / requestIdFor 格式正则', () => {
    expect(mintSessionId()).toMatch(SESSION_RE);
    expect(sessionForConversation('seed-a')).toMatch(SESSION_RE);
    expect(sessionForConversation('seed-a')).toBe(sessionForConversation('seed-a'));
    expect(requestIdFor()).toMatch(REQUEST_RE);
    expect(requestIdFor('ses_anything')).toMatch(REQUEST_RE);
  });
});

describe('quartet 填充', () => {
  it('FINGERPRINT_TOOLS 为 bash/glob/grep/read', () => {
    expect(FINGERPRINT_TOOLS).toEqual(['bash', 'glob', 'grep', 'read']);
  });

  it('空 tools 时填 decoy + tool_choice none', () => {
    const body: Record<string, unknown> = {};
    const out = applyQuartetDecoys(body);
    expect(out).toBe(body);
    const tools = out['tools'] as Array<{ type: string; function: { name: string } }>;
    expect(tools).toHaveLength(4);
    expect(tools.map((t) => t.function.name)).toEqual(['bash', 'glob', 'grep', 'read']);
    expect(out['tool_choice']).toBe('none');
  });

  it('自带 tools 时原样保留', () => {
    const body: Record<string, unknown> = { tools: [{ type: 'function' }] };
    const out = applyQuartetDecoys(body);
    expect(out['tools'] as unknown[]).toHaveLength(1);
    expect(out['tool_choice']).toBeUndefined();
  });

  it('gatewayHeaders 含固定指纹', () => {
    const h = gatewayHeaders('ses_abcdef123456ABCDEFghij12', 'msg_abcdef123456ABCDEFghij12');
    expect(h['Authorization']).toBe('Bearer public');
    expect(h['User-Agent']).toBe(CLIENT_UA);
    expect(h['x-opencode-client']).toBe('desktop');
    expect(h['x-opencode-project']).toBe('global');
    expect(h['x-opencode-session']).toBe('ses_abcdef123456ABCDEFghij12');
    expect(h['x-opencode-request']).toBe('msg_abcdef123456ABCDEFghij12');
  });
});

describe('endpointFor / wireFor', () => {
  it('chat 返回 chat 口', () => {
    expect(wireFor('chat')).toBe('/zen/v1/chat/completions');
    expect(endpointFor('chat')).toBe(`${ZEN_BASE}/zen/v1/chat/completions`);
  });

  it('chat 以外抛中文错', () => {
    expect(() => endpointFor('responses')).toThrow(/仅实现 chat/);
    expect(() => endpointFor('messages')).toThrow(/仅实现 chat/);
    expect(() => wireFor('responses')).toThrow(/仅实现 chat/);
    expect(() => wireFor('messages')).toThrow(/仅实现 chat/);
  });

  it('transport 遇到 responses 线 hint 直接终态失败', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse(okChatPayload());
    const callModel = createZenFreeTransport({ fetchImpl });
    const req = {
      messages: [{ role: 'user', content: 'hi' }],
      wire: 'responses',
    } as unknown as InferRequest;
    const res = await callModel(req, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.retryable).toBe(false);
    expect(res.error?.reason).toContain('线协议未实现');
  });
});

describe('probeZenModels 探测模型列表', () => {
  it('正常列表取 data[].id', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const fetchImpl: FetchImpl = async (input, init) => {
      seenUrl = String(input);
      seenAuth = (init?.headers as Record<string, string>)['Authorization'] ?? '';
      return jsonResponse({
        data: [{ id: 'space-bunny-free' }, { id: 'other-free' }, { id: 123 }],
      });
    };
    const res = await probeZenModels({ fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(['space-bunny-free', 'other-free']);
    expect(seenUrl).toBe('https://opencode.ai/zen/v1/models');
    expect(seenAuth).toBe('Bearer public');
  });

  it('缺失 data → ok:false', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({ foo: 1 });
    const res = await probeZenModels({ fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.models).toEqual([]);
  });

  it('非 200 → ok:false', async () => {
    const fetchImpl: FetchImpl = async () => new Response('err', { status: 500 });
    const res = await probeZenModels({ fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.models).toEqual([]);
  });
});

describe('createZenFreeGateway convenience 网关', () => {
  it('resolveKey 恒返 public，infer 走通（非 NO_KEY）', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse(okChatPayload('gw-ok'));
    const gateway = createZenFreeGateway({ fetchImpl });
    const res = await gateway.infer({ messages: [{ role: 'user', content: 'hi' }] });
    expect(res.ok).toBe(true);
    expect(res.text).toBe('gw-ok');
  });
});
