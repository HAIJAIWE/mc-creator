/**
 * §10.0 推理网关接口层（无真实 LLM 调用）。
 *
 * 只定接口 + 网关编排，不发真实网络：
 * - 统一 infer(messages, tools, budget) 入口，由调用方注入传输；
 * - 能力分级：routeTier 生成走强模型，校验/摘要走廉价模型；
 * - 失败转人工：超预算 / 超时 / 无 Key 一律返回 ok:false + 终态 error，
 *   绝不抛裸异常；调用方可据此降级模型或转人工；
 * - 重试：仅对传输抛异常或 retryable:true 的模型失败重试 1 次
 *   （初次 + 1 次重试，共最多 2 次 callModel 调用）；
 *   BUDGET_EXCEEDED / TIMEOUT / NO_KEY 终态错误不重试；
 * - BYOK：凭据由调用方经桌面侧 safeStorage（见 secret-storage.ts）读取后
 *   经 resolveKey 注入，本包只收字符串 Key、不碰 Electron、不落盘、
 *   不缓存 Key（每次 infer 现取现用）；
 * - 限流/流式/多模型路由的真实传输由调用方在 callModel 内实现，
 *   网关只透传 InferRequest（含 budget.modelTier 分级 hint）。
 *
 * 本包禁依赖 generator-*，此处零跨包导入（只用自有类型）。
 */

export type ModelTier = 'strong' | 'cheap';

export type TaskKind = 'generate' | 'validate' | 'summarize';

export interface InferMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
}

export interface InferTool {
  name: string;
  description?: string;
}

export interface InferBudget {
  maxTokens?: number;
  timeoutMs?: number;
  modelTier?: ModelTier;
}

export interface InferRequest {
  messages: InferMessage[];
  tools?: InferTool[];
  budget?: InferBudget;
}

export interface InferUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type InferErrorCode = 'BUDGET_EXCEEDED' | 'TIMEOUT' | 'NO_KEY' | 'MODEL_ERROR';

export interface InferError {
  code: InferErrorCode;
  reason: string;
  retryable: false;
}

export interface InferResponse {
  ok: boolean;
  text?: string;
  usage?: InferUsage;
  error?: InferError;
}

/**
 * callModel 单次尝试的返回形状：允许 retryable:true 表示瞬时失败、
 * 网关见此仅重试 1 次；最终经 infer 返回的一律收敛为 retryable:false。
 */
export interface CallModelResponse {
  ok: boolean;
  text?: string;
  usage?: InferUsage;
  error?: {
    code: InferErrorCode;
    reason: string;
    retryable: boolean;
  };
}

/** 默认单次调用超时（调用方未给 budget.timeoutMs 时生效）。 */
export const DEFAULT_INFER_TIMEOUT_MS = 30_000;

/**
 * 能力分级（§10.0）：生成走强模型，校验/摘要走廉价模型。
 */
export function routeTier(task: { kind: TaskKind }): ModelTier {
  return task.kind === 'generate' ? 'strong' : 'cheap';
}

export interface GatewayDeps {
  /**
   * 由调用方注入：经 safeStorage 读取用户自带 Key。
   * 返回空/空白/抛异常一律视为无 Key（转人工，不重试）。
   */
  resolveKey: () => string | null | undefined | Promise<string | null | undefined>;
  /**
   * 由调用方注入：真实传输（fetch/流式拼装等均在内部完成）。
   * 约定：瞬时故障抛异常，或返回 ok:false + retryable:true；
   * 终态失败返回 ok:false + retryable:false，网关直接透传（归一化）。
   */
  callModel: (
    req: InferRequest,
    key: string,
    attempt: number,
  ) => CallModelResponse | Promise<CallModelResponse>;
}

export interface InferGateway {
  infer: (req: InferRequest) => Promise<InferResponse>;
}

class InferTimeoutError extends Error {
  readonly inferTimeout = true;
  constructor(readonly timeoutMs: number) {
    super(`推理超时（${timeoutMs}ms），转人工确认`);
    this.name = 'InferTimeoutError';
  }
}

function isTimeoutError(e: unknown): e is InferTimeoutError {
  return e instanceof InferTimeoutError;
}

/** 粗估 prompt tokens：ceil(字符数/4)。只用于超预算预检。 */
function estimatePromptTokens(messages: InferMessage[]): number {
  let chars = 0;
  for (const m of messages) chars += m.content.length;
  return Math.ceil(chars / 4);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (timeoutMs === undefined) return promise;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new InferTimeoutError(timeoutMs)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== undefined) clearTimeout(timer);
  });
}

function noKeyError(): InferResponse {
  return {
    ok: false,
    error: {
      code: 'NO_KEY',
      reason: '未配置模型 Key，转人工确认（BYOK：请在桌面设置中录入）',
      retryable: false,
    },
  };
}

function budgetExceededError(estimated: number, maxTokens: number): InferResponse {
  return {
    ok: false,
    error: {
      code: 'BUDGET_EXCEEDED',
      reason: `预估 tokens（${estimated}）超预算（${maxTokens}），转人工确认`,
      retryable: false,
    },
  };
}

function timeoutError(timeoutMs: number): InferResponse {
  return {
    ok: false,
    error: { code: 'TIMEOUT', reason: `推理超时（${timeoutMs}ms），转人工确认`, retryable: false },
  };
}

function modelError(reason: string): InferResponse {
  return {
    ok: false,
    error: { code: 'MODEL_ERROR', reason, retryable: false },
  };
}

/**
 * 创建网关：只做路由透传 / 重试 1 次 / 超时 / 超预算转人工。
 * 全程不抛裸异常：任何意外一律收敛为 ok:false 终态错误。
 */
export function createGateway(deps: GatewayDeps): InferGateway {
  async function infer(req: InferRequest): Promise<InferResponse> {
    try {
      let key: string | null | undefined;
      try {
        key = await deps.resolveKey();
      } catch {
        return noKeyError();
      }
      if (key === null || key === undefined || key.trim() === '') return noKeyError();

      const maxTokens = req.budget?.maxTokens;
      const timeoutMs = req.budget?.timeoutMs ?? DEFAULT_INFER_TIMEOUT_MS;
      if (maxTokens !== undefined) {
        const estimated = estimatePromptTokens(req.messages);
        if (estimated > maxTokens) return budgetExceededError(estimated, maxTokens);
      }

      for (let attempt = 0; attempt < 2; attempt += 1) {
        let raw: CallModelResponse;
        try {
          const call = Promise.resolve().then(() => deps.callModel(req, key, attempt));
          raw = await withTimeout(call, timeoutMs);
        } catch (e) {
          if (isTimeoutError(e)) return timeoutError(e.timeoutMs);
          if (attempt === 0) continue;
          return modelError(e instanceof Error ? e.message : '模型调用失败，转人工确认');
        }

        if (raw.ok) {
          if (maxTokens !== undefined && raw.usage?.totalTokens !== undefined) {
            if (raw.usage.totalTokens > maxTokens) {
              return budgetExceededError(raw.usage.totalTokens, maxTokens);
            }
          }
          if (raw.text !== undefined && raw.usage !== undefined) {
            return { ok: true, text: raw.text, usage: raw.usage };
          }
          if (raw.text !== undefined) return { ok: true, text: raw.text };
          if (raw.usage !== undefined) return { ok: true, usage: raw.usage };
          return { ok: true };
        }
        const canRetry = raw.error?.retryable === true;
        if (canRetry && attempt === 0) continue;
        const code: InferErrorCode = raw.error?.code ?? 'MODEL_ERROR';
        const reason = raw.error?.reason ?? '模型调用失败，转人工确认';
        if (raw.usage === undefined) {
          return { ok: false, error: { code, reason, retryable: false } };
        }
        return { ok: false, usage: raw.usage, error: { code, reason, retryable: false } };
      }
      return modelError('模型调用失败（重试已耗尽），转人工确认');
    } catch (e) {
      return modelError(e instanceof Error ? e.message : '模型调用失败，转人工确认');
    }
  }

  return { infer };
}
