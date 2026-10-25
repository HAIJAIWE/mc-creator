/**
 * OpenAI 兼容传输 + dsh 本地转发落点（Ebony-Vinyl / dsh-our-free-model 本机转发口做测试）。
 *
 * 集成方式 = HTTP（与 Ollama / LM Studio 本地预设同一模式）：
 * - 不 vendoring 对方任何代码（对方是 dsh 插件、cordis loader，跑不在 Electron 里；HTTP 对接无需拷贝）；
 * - 对方仓库 MIT 协议、零依赖；核心是本机 OpenAI 兼容转发口：
 *   GET /v1/models、POST /v1/chat/completions（流式/非流式）、POST /v1/responses；
 * - 本模块只用非流式 POST /v1/chat/completions 做传输 + GET /v1/models 做探测。
 *
 * 合规提醒（调用方负责开关）：
 * - 对方 README 原话：上游唯一来源是 opencode.ai Zen 网关，提示词会出境。
 * - 本模块只做传输，不做合规判定；是否启用、向用户披露出境，均由调用方决定。
 *
 * 端口说明：
 * - 对方默认端口 18899，但被占用会顺延，端口不可写死；
 * - 实测以 probeFreeModels 为准（先探测 models 列表，再决定 baseURL 是否可用）。
 */

import type { CallModelResponse, InferRequest } from './infer.js';
import { DEFAULT_INFER_TIMEOUT_MS } from './infer.js';

/**
 * 本地转发默认基址（含 /v1 前缀）。
 * 端口会顺延：18899 被占用时对方会自动换端口，此常量只是起点，实测以 probe 为准。
 */
export const DEFAULT_FORWARD_BASE_URL = 'http://127.0.0.1:18899/v1';

export type FetchImpl = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface OpenAiChatTransportOptions {
  baseURL: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export interface ProbeFreeModelsOptions {
  baseURL: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export interface ProbeFreeModelsResult {
  ok: boolean;
  models: string[];
  message: string;
}

/** baseURL 尾斜杠归一 + 避免 /v1 重复拼接。 */
function resolveUrl(baseURL: string, subPath: '/v1/chat/completions' | '/v1/models'): string {
  const base = baseURL.replace(/\/+$/, '');
  if (base.endsWith('/v1') && subPath.startsWith('/v1/')) {
    return base + subPath.slice('/v1'.length);
  }
  return base + subPath;
}

function isAbortLike(e: unknown): boolean {
  if (e instanceof DOMException) return e.name === 'AbortError' || e.name === 'TimeoutError';
  if (e instanceof Error) return e.name === 'AbortError' || e.name === 'TimeoutError';
  return false;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** 带超时的 fetch：AbortController + Promise.race 双保险（fetchImpl 无视 signal 也能收敛）。 */
async function fetchWithTimeout(
  fetchFn: FetchImpl,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    try {
      controller.abort();
    } catch {
      /* 忽略 abort 自身异常 */
    }
  }, timeoutMs);
  const timeoutError = new Error(`请求超时（${timeoutMs}ms）`);
  timeoutError.name = 'TimeoutError';
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutTimer = setTimeout(() => reject(timeoutError), timeoutMs);
  });
  try {
    const res = await Promise.race([
      fetchFn(url, { ...init, signal: controller.signal }),
      timeoutPromise,
    ]);
    return res;
  } finally {
    clearTimeout(timer);
    if (timeoutTimer !== undefined) clearTimeout(timeoutTimer);
  }
}

function readModel(req: InferRequest): string {
  const maybe = (req as { model?: unknown }).model;
  return typeof maybe === 'string' && maybe.length > 0 ? maybe : 'default';
}

/**
 * 创建 OpenAI 兼容 chat 传输，可直接注入 GatewayDeps.callModel。
 * 约定：绝不抛裸异常，catch 全收敛为 CallModelResponse。
 */
export function createOpenAiChatTransport(opts: OpenAiChatTransportOptions) {
  const baseURL = opts.baseURL;
  const defaultTimeoutMs = opts.timeoutMs;
  const injectedFetch = opts.fetchImpl;

  return async (req: InferRequest, key: string, attempt: number): Promise<CallModelResponse> => {
    void attempt;
    try {
      if (key.trim() === '') {
        return {
          ok: false,
          error: {
            code: 'NO_KEY',
            reason: '传输层无 Key，拒绝发送（网关层已有 NO_KEY）',
            retryable: false,
          },
        };
      }
      const trimmedBase = baseURL.trim();
      if (trimmedBase === '') {
        return {
          ok: false,
          error: { code: 'MODEL_ERROR', reason: 'baseURL 为空，无法发送', retryable: false },
        };
      }
      const fetchFn: FetchImpl | undefined = injectedFetch ?? globalThis.fetch?.bind(globalThis);
      if (fetchFn === undefined) {
        return {
          ok: false,
          error: { code: 'MODEL_ERROR', reason: '当前环境无可用 fetch', retryable: false },
        };
      }
      const timeoutMs = req.budget?.timeoutMs ?? defaultTimeoutMs ?? DEFAULT_INFER_TIMEOUT_MS;
      const url = resolveUrl(trimmedBase, '/v1/chat/completions');
      const body: Record<string, unknown> = {
        model: readModel(req),
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (req.budget?.maxTokens !== undefined) {
        body['max_tokens'] = req.budget.maxTokens;
      }

      let res: Response;
      try {
        res = await fetchWithTimeout(
          fetchFn,
          url,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${key}`,
            },
            body: JSON.stringify(body),
          },
          timeoutMs,
        );
      } catch (e) {
        if (isAbortLike(e)) {
          return {
            ok: false,
            error: {
              code: 'TIMEOUT',
              reason: `传输超时（${timeoutMs}ms），可重试`,
              retryable: true,
            },
          };
        }
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `网络异常，可重试：${errorMessage(e)}`,
            retryable: true,
          },
        };
      }

      if (res.status === 429 || res.status >= 500) {
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `网关返回 ${res.status}，可重试`,
            retryable: true,
          },
        };
      }
      if (!res.ok) {
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `网关返回 ${res.status}，终态失败`,
            retryable: false,
          },
        };
      }

      let data: unknown;
      try {
        data = await res.json();
      } catch {
        return {
          ok: false,
          error: { code: 'MODEL_ERROR', reason: '响应非 JSON，终态失败', retryable: false },
        };
      }
      const content = (data as { choices?: Array<{ message?: { content?: unknown } }> })
        ?.choices?.[0]?.message?.content;
      if (typeof content !== 'string') {
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: '响应缺失 choices[0].message.content，终态失败',
            retryable: false,
          },
        };
      }
      const rawUsage = (data as { usage?: unknown })?.usage as
        | { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown }
        | undefined;
      if (
        rawUsage !== undefined &&
        rawUsage !== null &&
        typeof rawUsage === 'object' &&
        (typeof rawUsage.prompt_tokens === 'number' ||
          typeof rawUsage.completion_tokens === 'number' ||
          typeof rawUsage.total_tokens === 'number')
      ) {
        return {
          ok: true,
          text: content,
          usage: {
            ...(typeof rawUsage.prompt_tokens === 'number'
              ? { promptTokens: rawUsage.prompt_tokens }
              : {}),
            ...(typeof rawUsage.completion_tokens === 'number'
              ? { completionTokens: rawUsage.completion_tokens }
              : {}),
            ...(typeof rawUsage.total_tokens === 'number'
              ? { totalTokens: rawUsage.total_tokens }
              : {}),
          },
        };
      }
      return { ok: true, text: content };
    } catch (e) {
      return {
        ok: false,
        error: {
          code: 'MODEL_ERROR',
          reason: `传输异常，终态失败：${errorMessage(e)}`,
          retryable: false,
        },
      };
    }
  };
}

/**
 * 探测本机转发口可用模型：GET {baseURL}/v1/models 取 data[].id。
 * 对齐对方“选择器只广播可用模型”思想，供“测试连接 / 探测可用模型”用。
 * 绝不抛裸异常：失败一律 { ok:false, models:[], message }。
 */
export async function probeFreeModels(
  opts: ProbeFreeModelsOptions,
): Promise<ProbeFreeModelsResult> {
  try {
    const trimmedBase = opts.baseURL.trim();
    if (trimmedBase === '') {
      return { ok: false, models: [], message: 'baseURL 为空，无法探测' };
    }
    const fetchFn: FetchImpl | undefined = opts.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (fetchFn === undefined) {
      return { ok: false, models: [], message: '当前环境无可用 fetch' };
    }
    const timeoutMs = opts.timeoutMs ?? DEFAULT_INFER_TIMEOUT_MS;
    const url = resolveUrl(trimmedBase, '/v1/models');

    let res: Response;
    try {
      res = await fetchWithTimeout(fetchFn, url, { method: 'GET' }, timeoutMs);
    } catch (e) {
      if (isAbortLike(e)) {
        return { ok: false, models: [], message: `探测超时（${timeoutMs}ms）` };
      }
      return { ok: false, models: [], message: `探测网络异常：${errorMessage(e)}` };
    }

    if (!res.ok) {
      return { ok: false, models: [], message: `探测失败：网关返回 ${res.status}` };
    }
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { ok: false, models: [], message: '探测失败：响应非 JSON' };
    }
    const list = (data as { data?: unknown })?.data;
    if (!Array.isArray(list)) {
      return { ok: false, models: [], message: '探测失败：响应缺失 data 列表' };
    }
    const models = list
      .map((item) => (item as { id?: unknown })?.id)
      .filter((id): id is string => typeof id === 'string' && id.length > 0);
    return { ok: true, models, message: `探测成功，共 ${models.length} 个模型` };
  } catch (e) {
    return { ok: false, models: [], message: `探测异常：${errorMessage(e)}` };
  }
}
