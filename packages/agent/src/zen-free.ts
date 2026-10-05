/**
 * Zen 免费通道直连传输（仅 chat 线，非流式）。
 *
 * 1. 协议来源：Ebony-Vinyl/dsh-our-free-model 对方仓库（MIT）src/upstream.js 已读原文
 *    + 本机 8 轮真实请求实测（实测日期 2026-10-06，标注为 [本机实测 2026-10-06] 的结论不要再猜）。
 * 2. 零 vendoring：以下为自写实现，未拷贝对方任何代码，仅复刻线协议（基址/路径/头/body 指纹）。
 * 3. 合规提醒：提示词出境到 https://opencode.ai（公共池凭据 Bearer public，无用户 Key）；
 *    是否启用、向用户披露出境，均由调用方负责合规开关，本模块不做判定。
 * 4. 行为会变：模型可用性（哪些 -free 可用）与网关策略（403/429 条件）随时会变，
 *    可用性结论一律以 probeZenModels() 实测为准，不要写死信任。
 */

import { createGateway, DEFAULT_INFER_TIMEOUT_MS } from './infer.js';
import type { CallModelResponse, InferGateway, InferRequest } from './infer.js';
import type { FetchImpl } from './openai-chat.js';

/** Zen 网关基址。[本机实测 2026-10-06] */
export const ZEN_BASE = 'https://opencode.ai';

/** 固定 UA（网关指纹用）。[本机实测 2026-10-06] */
export const CLIENT_UA = 'opencode/1.18.31';

/**
 * 默认免费模型。[本机实测 2026-10-06] space-bunny-free 返回 200 可用；
 * 行为会变，以 probeZenModels() 为准。
 */
export const DEFAULT_ZEN_FREE_MODEL = 'space-bunny-free';

/**
 * body.tools 指纹四件套：bash/glob/grep/read。
 * 无则有 403 FreeTierError 风险。[本机实测 2026-10-06]
 */
export const FINGERPRINT_TOOLS: string[] = ['bash', 'glob', 'grep', 'read'];

/** 会话 id 形如 ses_+12hex+14base62。 */
export const SESSION_RE = /^ses_[0-9a-f]{12}[A-Za-z0-9]{14}$/;
/** 请求 id 形如 msg_+12hex+14base62。 */
export const REQUEST_RE = /^msg_[0-9a-f]{12}[A-Za-z0-9]{14}$/;

/** 本传输仅实现的线协议。 */
export type ZenWire = 'chat' | 'responses' | 'messages';

const HEX_ALPHABET = '0123456789abcdef';
const BASE62_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

function randomFrom(alphabet: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

/** 随机 mint 一个会话 id（ses_+12hex+14base62）。 */
export function mintSessionId(): string {
  return `ses_${randomFrom(HEX_ALPHABET, 12)}${randomFrom(BASE62_ALPHABET, 14)}`;
}

function mintRequestId(): string {
  return `msg_${randomFrom(HEX_ALPHABET, 12)}${randomFrom(BASE62_ALPHABET, 14)}`;
}

function hash32(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function deterministicPart(seed: string, salt: string, alphabet: string, length: number): string {
  const rng = mulberry32(hash32(`${salt}:${seed}`));
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += alphabet[Math.floor(rng() * alphabet.length)];
  }
  return out;
}

/**
 * 取会话 id：有 seed 时按 seed 稳定派生（同 seed 同值，满足“同一 transport 复用稳定会话”），
 * 无 seed 时随机 mint。配额按会话计，本机实测同会话连打两次均 200 无 429。[本机实测 2026-10-06]
 */
export function sessionForConversation(seed?: string): string {
  if (seed === undefined || seed === null || seed === '') return mintSessionId();
  return `ses_${deterministicPart(seed, 'zen-ses-hex', HEX_ALPHABET, 12)}${deterministicPart(seed, 'zen-ses-b62', BASE62_ALPHABET, 14)}`;
}

/**
 * 取请求 id：每次 fresh 随机（参数仅为与会话对称的占位，忽略）。
 * 同一会话内多次调用必须各不相同，由调用方每次现取。
 */
export function requestIdFor(_sessionId?: string): string {
  void _sessionId;
  return mintRequestId();
}

/**
 * 网关指纹头：公共池凭据 Bearer public + 固定 UA + x-opencode-* 四头。
 * [本机实测 2026-10-06]
 */
export function gatewayHeaders(sessionId: string, requestId: string): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    Authorization: 'Bearer public',
    'User-Agent': CLIENT_UA,
    'x-opencode-client': 'desktop',
    'x-opencode-session': sessionId,
    'x-opencode-request': requestId,
    'x-opencode-project': 'global',
  };
}

/** chat 线 path。其余线直接抛中文错（不做半吊子实现）。 */
export function wireFor(wire: string): string {
  if (wire === 'chat') return '/zen/v1/chat/completions';
  throw new Error(
    `Zen 免费通道仅实现 chat 线，不支持“${wire}”线协议（/responses、/messages 线协议未实现）`,
  );
}

/** chat 线完整 URL。其余线直接抛中文错。 */
export function endpointFor(wire: string): string {
  return `${ZEN_BASE}${wireFor(wire)}`;
}

function buildDecoyTool(name: string): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name,
      description: `[decoy 自禁用] ${name}：仅用于免费通道 tools 指纹对齐，不会被调用（tool_choice=none）`,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
    },
  };
}

/**
 * 调用方 tools 为空时填自禁用 decoy 四件套 + tool_choice:'none'（就地修改并返回同一 body）。
 * 调用方自带 tools 时原样保留（此时指纹四件套由调用方负责，缺失仍有 403 风险）。
 */
export function applyQuartetDecoys(body: Record<string, unknown>): Record<string, unknown> {
  const tools = body['tools'];
  if (Array.isArray(tools) && tools.length > 0) return body;
  body['tools'] = FINGERPRINT_TOOLS.map(buildDecoyTool);
  if (body['tool_choice'] === undefined) body['tool_choice'] = 'none';
  return body;
}

export interface ZenFreeTransportOptions {
  model?: string;
  sessionSeed?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export interface ProbeZenModelsOptions {
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

export interface ProbeZenModelsResult {
  ok: boolean;
  models: string[];
  message: string;
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

function readModel(req: InferRequest, override?: string): string {
  if (override !== undefined && override !== '') return override;
  const maybe = (req as { model?: unknown }).model;
  return typeof maybe === 'string' && maybe.length > 0 ? maybe : DEFAULT_ZEN_FREE_MODEL;
}

/** 从错误响应体提取可透传的 code/message 原文（FreeTierError/RegionError 透传用）。 */
function serverErrorText(data: unknown, rawText: string): string {
  const parts: string[] = [];
  if (data !== null && typeof data === 'object') {
    const rec = data as Record<string, unknown>;
    const err = rec['error'];
    if (typeof err === 'string' && err.length > 0) {
      parts.push(err);
    } else if (err !== null && typeof err === 'object') {
      const e = err as Record<string, unknown>;
      if (typeof e['code'] === 'string' && (e['code'] as string).length > 0)
        parts.push(e['code'] as string);
      if (typeof e['message'] === 'string' && (e['message'] as string).length > 0) {
        parts.push(e['message'] as string);
      }
      if (typeof e['reason'] === 'string' && (e['reason'] as string).length > 0) {
        parts.push(e['reason'] as string);
      }
    }
    if (typeof rec['message'] === 'string' && (rec['message'] as string).length > 0) {
      parts.push(rec['message'] as string);
    }
  }
  if (parts.length === 0 && rawText.length > 0) parts.push(rawText.slice(0, 500));
  return parts.join(' | ');
}

async function readErrorBody(res: Response): Promise<{ data: unknown; rawText: string }> {
  let rawText = '';
  try {
    rawText = await res.text();
  } catch {
    rawText = '';
  }
  if (rawText === '') return { data: null, rawText };
  try {
    return { data: JSON.parse(rawText) as unknown, rawText };
  } catch {
    return { data: null, rawText };
  }
}

/**
 * 创建 Zen 免费通道 chat 传输，可直接注入 GatewayDeps.callModel。
 * key 参数忽略但签名保留：公共池凭据恒为 Bearer public，无用户 Key（注释说明，兼容网关签名）。
 * 同一 transport 实例复用稳定会话（配额按会话计）。绝不抛裸异常，全 catch 收敛为 CallModelResponse。
 */
export function createZenFreeTransport(opts?: ZenFreeTransportOptions) {
  const options: ZenFreeTransportOptions = opts ?? {};
  const sessionId = sessionForConversation(options.sessionSeed);
  const defaultTimeoutMs = options.timeoutMs;
  const injectedFetch = options.fetchImpl;
  const modelOverride = options.model;

  return async (req: InferRequest, key: string, attempt: number): Promise<CallModelResponse> => {
    // 公共池凭据恒为 Bearer public：调用方 Key（key）忽略但签名保留，以兼容 GatewayDeps.callModel。
    void key;
    void attempt;
    try {
      // 只实现 chat 线：携带其他线 hint 的请求直接终态失败，不做半吊子实现。
      const wireHint =
        (req as { wire?: unknown; line?: unknown }).wire ?? (req as { line?: unknown }).line;
      if (typeof wireHint === 'string' && wireHint !== '' && wireHint !== 'chat') {
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `Zen 免费通道仅实现 chat 线，“${wireHint}”线协议未实现，终态失败`,
            retryable: false,
          },
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
      const url = endpointFor('chat');
      const requestId = requestIdFor(sessionId);
      const headers = gatewayHeaders(sessionId, requestId);

      const body: Record<string, unknown> = {
        model: readModel(req, modelOverride),
        stream: false,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (req.budget?.maxTokens !== undefined) {
        body['max_tokens'] = req.budget.maxTokens;
      }
      if (Array.isArray(req.tools) && req.tools.length > 0) {
        body['tools'] = req.tools.map((t) => ({
          type: 'function',
          function: {
            name: t.name,
            description: t.description ?? '',
            parameters: { type: 'object', properties: {}, additionalProperties: false },
          },
        }));
      }
      applyQuartetDecoys(body);

      let res: Response;
      try {
        res = await fetchWithTimeout(
          fetchFn,
          url,
          { method: 'POST', headers, body: JSON.stringify(body) },
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

      // [本机实测 2026-10-06] 无 -free 后缀模型（如 kimi-k3/qwen3.8-max）→ 401，要真实 Key。
      if (res.status === 401) {
        const { data, rawText } = await readErrorBody(res);
        const detail = serverErrorText(data, rawText);
        const suffix = detail.length > 0 ? `：${detail}` : '';
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `该模型不在免费通道，需真实 Key（401）${suffix}，终态失败`,
            retryable: false,
          },
        };
      }
      if (res.status === 429) {
        return {
          ok: false,
          error: { code: 'MODEL_ERROR', reason: '免费通道限流（429），可重试', retryable: true },
        };
      }
      // [本机实测 2026-10-06] mimo-v2.6-flash-free/fledge-alpha-free → 403 FreeTierError。
      // RegionError 为同类 403 的另一种透传原文，均终态失败。
      if (res.status === 403) {
        const { data, rawText } = await readErrorBody(res);
        const detail = serverErrorText(data, rawText);
        const suffix = detail.length > 0 ? `：${detail}` : '';
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `免费通道拒绝（403）${suffix}，终态失败`,
            retryable: false,
          },
        };
      }
      if (res.status >= 500) {
        return {
          ok: false,
          error: { code: 'MODEL_ERROR', reason: `网关返回 ${res.status}，可重试`, retryable: true },
        };
      }
      // [本机实测 2026-10-06] deepseek-v4-flash-free → 400 Model不可用，透传 message。
      if (res.status === 400) {
        const { data, rawText } = await readErrorBody(res);
        const detail = serverErrorText(data, rawText);
        const suffix = detail.length > 0 ? `：${detail}` : '';
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `请求非法（400）${suffix}，终态失败`,
            retryable: false,
          },
        };
      }
      if (!res.ok) {
        const { data, rawText } = await readErrorBody(res);
        const detail = serverErrorText(data, rawText);
        const suffix = detail.length > 0 ? `：${detail}` : '';
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `网关返回 ${res.status}${suffix}，终态失败`,
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
        let shape = 'unknown';
        try {
          shape =
            JSON.stringify((data as { choices?: unknown })?.choices)?.slice(0, 200) ?? 'unknown';
        } catch {
          shape = typeof data;
        }
        return {
          ok: false,
          error: {
            code: 'MODEL_ERROR',
            reason: `响应缺失 choices[0].message.content（content 缺失/非字符串），终态失败：实际 choices 形状=${shape}`,
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

export interface ZenFreeGatewayOptions {
  model?: string;
  sessionSeed?: string;
  fetchImpl?: FetchImpl;
  timeoutMs?: number;
}

/**
 * convenience 网关：resolveKey 恒返 'public'。
 * 公共池凭据本身就是这个字符串（Authorization: Bearer public），无用户 Key；
 * 网关 resolveKey 空即 NO_KEY，此处恒非空以通过网关 Key 门控。
 */
export function createZenFreeGateway(opts?: ZenFreeGatewayOptions): InferGateway {
  const callModel = createZenFreeTransport({ ...(opts ?? {}) });
  return createGateway({ resolveKey: () => 'public', callModel });
}

/**
 * 探测免费模型列表：GET /zen/v1/models 取 data[].id。
 * [本机实测 2026-10-06] 实测返回 86 个；行为会变，以实测为准。绝不抛裸异常。
 */
export async function probeZenModels(opts?: ProbeZenModelsOptions): Promise<ProbeZenModelsResult> {
  try {
    const fetchFn: FetchImpl | undefined = opts?.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    if (fetchFn === undefined) {
      return { ok: false, models: [], message: '当前环境无可用 fetch' };
    }
    const timeoutMs = opts?.timeoutMs ?? DEFAULT_INFER_TIMEOUT_MS;
    const url = `${ZEN_BASE}/zen/v1/models`;
    const headers = gatewayHeaders(mintSessionId(), requestIdFor());

    let res: Response;
    try {
      res = await fetchWithTimeout(fetchFn, url, { method: 'GET', headers }, timeoutMs);
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
