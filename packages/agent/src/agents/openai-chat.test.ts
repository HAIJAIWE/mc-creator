/**
 * openai-chat.ts（OpenAI 兼容传输 + dsh 本地转发探测）单元测试。
 * 全注入 fetchImpl，不断网：覆盖成功 / 429 / 400 / 超时 / 坏 JSON / 空 choices / models 列表。
 */
import { describe, expect, it } from 'vitest';
import { createOpenAiChatTransport, probeFreeModels, type FetchImpl } from './openai-chat.js';

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('createOpenAiChatTransport 成功路径', () => {
  it('解析 content + usage 透传，默认 model=default', async () => {
    let seenUrl = '';
    let seenBody: Record<string, unknown> = {};
    let seenAuth = '';
    const fetchImpl: FetchImpl = async (input, init) => {
      seenUrl = String(input);
      seenAuth = (init?.headers as Record<string, string>)['Authorization'] ?? '';
      seenBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return jsonResponse({
        choices: [{ message: { content: 'hello' } }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      });
    };
    const callModel = createOpenAiChatTransport({
      baseURL: 'http://127.0.0.1:18899/v1',
      fetchImpl,
    });
    const res = await callModel(
      { messages: [{ role: 'user', content: 'hi' }], budget: { maxTokens: 100 } },
      'k',
      0,
    );
    expect(res.ok).toBe(true);
    expect(res.text).toBe('hello');
    expect(res.usage).toEqual({ promptTokens: 1, completionTokens: 2, totalTokens: 3 });
    expect(seenUrl).toBe('http://127.0.0.1:18899/v1/chat/completions');
    expect(seenBody['model']).toBe('default');
    expect(seenBody['max_tokens']).toBe(100);
    expect(seenBody['messages']).toEqual([{ role: 'user', content: 'hi' }]);
    expect(seenAuth).toBe('Bearer k');
  });

  it('baseURL 无 /v1 后缀时自动补 /v1 前缀，不重复拼接', async () => {
    let seenUrl = '';
    const fetchImpl: FetchImpl = async (input) => {
      seenUrl = String(input);
      return jsonResponse({ choices: [{ message: { content: 'x' } }] });
    };
    const callModel = createOpenAiChatTransport({
      baseURL: 'http://127.0.0.1:18899',
      fetchImpl,
    });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(true);
    expect(seenUrl).toBe('http://127.0.0.1:18899/v1/chat/completions');
  });
});

describe('key 为空直接终态失败', () => {
  it('空 key 不发请求，返回 NO_KEY + retryable:false', async () => {
    let calls = 0;
    const fetchImpl: FetchImpl = async () => {
      calls += 1;
      return jsonResponse({ choices: [{ message: { content: 'x' } }] });
    };
    const callModel = createOpenAiChatTransport({
      baseURL: 'http://127.0.0.1:18899/v1',
      fetchImpl,
    });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, '   ', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('NO_KEY');
    expect(res.error?.retryable).toBe(false);
    expect(calls).toBe(0);
  });
});

describe('HTTP 状态映射', () => {
  it('429 → MODEL_ERROR + retryable:true', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response(JSON.stringify({ error: 'rate limited' }), { status: 429 });
    const callModel = createOpenAiChatTransport({ baseURL: 'http://x/v1', fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('MODEL_ERROR');
    expect(res.error?.retryable).toBe(true);
  });

  it('500 → MODEL_ERROR + retryable:true', async () => {
    const fetchImpl: FetchImpl = async () => new Response('boom', { status: 500 });
    const callModel = createOpenAiChatTransport({ baseURL: 'http://x/v1', fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('MODEL_ERROR');
    expect(res.error?.retryable).toBe(true);
  });

  it('400 → MODEL_ERROR + retryable:false', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    const callModel = createOpenAiChatTransport({ baseURL: 'http://x/v1', fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('MODEL_ERROR');
    expect(res.error?.retryable).toBe(false);
  });
});

describe('超时 / 坏 JSON / 空 choices', () => {
  it('悬挂 fetch + 短 timeoutMs → TIMEOUT + retryable:true（绝不抛）', async () => {
    const fetchImpl: FetchImpl = () => new Promise<Response>(() => {});
    const callModel = createOpenAiChatTransport({
      baseURL: 'http://x/v1',
      fetchImpl,
      timeoutMs: 20,
    });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('TIMEOUT');
    expect(res.error?.retryable).toBe(true);
  });

  it('断网抛错 → MODEL_ERROR + retryable:true', async () => {
    const fetchImpl: FetchImpl = async () => {
      throw new TypeError('fetch failed');
    };
    const callModel = createOpenAiChatTransport({ baseURL: 'http://x/v1', fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('MODEL_ERROR');
    expect(res.error?.retryable).toBe(true);
  });

  it('响应非 JSON → MODEL_ERROR + retryable:false', async () => {
    const fetchImpl: FetchImpl = async () =>
      new Response('not-json{{{', {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    const callModel = createOpenAiChatTransport({ baseURL: 'http://x/v1', fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('MODEL_ERROR');
    expect(res.error?.retryable).toBe(false);
  });

  it('空 choices → MODEL_ERROR + retryable:false', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({ choices: [] });
    const callModel = createOpenAiChatTransport({ baseURL: 'http://x/v1', fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('MODEL_ERROR');
    expect(res.error?.retryable).toBe(false);
  });

  it('content 非字符串 → MODEL_ERROR + retryable:false', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({ choices: [{ message: {} }] });
    const callModel = createOpenAiChatTransport({ baseURL: 'http://x/v1', fetchImpl });
    const res = await callModel({ messages: [{ role: 'user', content: 'hi' }] }, 'k', 0);
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('MODEL_ERROR');
    expect(res.error?.retryable).toBe(false);
  });
});

describe('probeFreeModels 探测可用模型', () => {
  it('正常列表取 data[].id', async () => {
    let seenUrl = '';
    const fetchImpl: FetchImpl = async (input) => {
      seenUrl = String(input);
      return jsonResponse({ data: [{ id: 'model-a' }, { id: 'model-b' }, { id: 123 }] });
    };
    const res = await probeFreeModels({ baseURL: 'http://127.0.0.1:18899/v1', fetchImpl });
    expect(res.ok).toBe(true);
    expect(res.models).toEqual(['model-a', 'model-b']);
    expect(seenUrl).toBe('http://127.0.0.1:18899/v1/models');
  });

  it('缺失 data → ok:false', async () => {
    const fetchImpl: FetchImpl = async () => jsonResponse({ foo: 1 });
    const res = await probeFreeModels({ baseURL: 'http://x/v1', fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.models).toEqual([]);
  });

  it('非 200 → ok:false', async () => {
    const fetchImpl: FetchImpl = async () => new Response('err', { status: 500 });
    const res = await probeFreeModels({ baseURL: 'http://x/v1', fetchImpl });
    expect(res.ok).toBe(false);
    expect(res.models).toEqual([]);
  });
});
