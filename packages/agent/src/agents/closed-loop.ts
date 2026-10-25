/**
 * 生成闭环驱动器（设计文档 §10.3 / §17）。
 *
 * 编排：prompt → gateway.infer → validate（注入）→ diagnose（注入/默认）
 * → fix（planFixAttempt 定轮次 + buildGeneratePrompt 错误回灌）→ validate …，
 * 流转一律经 pipeline.ts nextStep，attempts 为失败计数（与 pipeline/planFixAttempt 一致）。
 *
 * 约束：
 * - 本包禁依赖 generator-*；验证/诊断/落盘全部经调用方注入，不直接调内核；
 * - transcript 收录每次模型原文，不截断不改写；
 * - 网关 infer 返回 ok:false 视为当轮 generate/fix 失败（detail 取 error.reason），按 nextStep 继续；
 * - 入参缺 prompt/gateway/validate 直接抛中文 Error（fail-fast）；
 *   运行中异常一律收敛为 abort（detail 带异常信息），不抛裸异常。
 */

import { nextStep, type NextDecision, type StageResult } from '../core/pipeline.js';
import { buildGeneratePrompt, planFixAttempt, type GeneratePromptInput } from './generate.js';
import type { InferRequest, InferResponse } from './infer.js';

/** 推理网关最小形状（与 infer.ts InferGateway 兼容，测试可用 fake 注入）。 */
export interface ClosedLoopGateway {
  infer: (req: InferRequest) => Promise<InferResponse>;
}

/** validate 注入返回（ok + 可选 detail/kind，kind 用于 nextStep 回填 criterion）。 */
export interface ClosedLoopValidateResult {
  ok: boolean;
  detail?: string;
  kind?: string;
}

/** diagnose 注入返回。 */
export interface ClosedLoopDiagnoseResult {
  ok: boolean;
  detail?: string;
}

export interface ClosedLoopOptions {
  prompt: GeneratePromptInput;
  gateway: ClosedLoopGateway;
  validate: (
    generatedText: string,
    history: StageResult[],
  ) => Promise<ClosedLoopValidateResult> | ClosedLoopValidateResult;
  diagnose?: (
    validateDetail?: string,
  ) => Promise<ClosedLoopDiagnoseResult> | ClosedLoopDiagnoseResult;
  maxAttempts?: number;
  onStep?: (event: ClosedLoopStepEvent) => void;
}

export interface ClosedLoopTranscriptEntry {
  stage: 'generate' | 'fix';
  text: string;
}

export interface ClosedLoopStepEvent {
  stage: StageResult['stage'];
  ok: boolean;
  detail?: string;
  attempts: number;
  next: NextDecision;
}

export interface ClosedLoopResult {
  outcome: 'succeed' | 'abort';
  history: StageResult[];
  transcript: ClosedLoopTranscriptEntry[];
  attempts: number;
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function failureCount(history: StageResult[]): number {
  return history.filter((h) => !h.ok).length;
}

function failureDetails(history: StageResult[]): string {
  return history
    .filter((h) => !h.ok && h.detail !== undefined && h.detail !== '')
    .map((h) => `[${h.stage}] ${h.detail as string}`)
    .join('\n');
}

/**
 * 运行生成闭环，直至 succeed/abort。
 * fail-fast：缺 prompt/gateway.infer/validate 直接抛中文 Error；
 * 其余运行中异常收敛为 abort。
 */
export async function runClosedLoop(opts: ClosedLoopOptions): Promise<ClosedLoopResult> {
  if (opts === null || opts === undefined || (opts as { prompt?: unknown }).prompt === undefined) {
    throw new Error('缺少 prompt：runClosedLoop 需要 GeneratePromptInput（调用方 bug）');
  }
  const gateway = (opts as { gateway?: unknown }).gateway as ClosedLoopGateway | undefined;
  if (gateway === undefined || gateway === null || typeof gateway.infer !== 'function') {
    throw new Error('缺少 gateway.infer：runClosedLoop 需要可调用的推理网关（调用方 bug）');
  }
  if (typeof (opts as { validate?: unknown }).validate !== 'function') {
    throw new Error('缺少 validate：runClosedLoop 需要调用方注入的验证函数（调用方 bug）');
  }

  const rawMax = opts.maxAttempts;
  const maxAttempts =
    rawMax === undefined
      ? 3
      : Number.isFinite(rawMax)
        ? Math.max(0, Math.floor(rawMax as number))
        : 3;

  const history: StageResult[] = [];
  const transcript: ClosedLoopTranscriptEntry[] = [];
  const basePrompt = opts.prompt;
  const baseContextPack = basePrompt.contextPack ?? '';

  const emit = (event: ClosedLoopStepEvent): void => {
    try {
      opts.onStep?.(event);
    } catch {
      /* 观察者异常不影响闭环 */
    }
  };

  const abortResult = (): ClosedLoopResult => ({
    outcome: 'abort',
    history,
    transcript,
    attempts: failureCount(history),
  });

  try {
    let action: 'generate' | 'validate' | 'diagnose' | 'fix' = 'generate';
    let promptInput: GeneratePromptInput = { ...basePrompt };
    let latestText = '';

    for (;;) {
      if (action === 'generate' || action === 'fix') {
        if (action === 'fix') {
          // planFixAttempt 的“最后一步 ok → abort”语义针对终端成功态；
          // 此处 fix 前 history 必然以 diagnose ok 结尾（中间态，非终端成功），
          // 直接全量传入会被误判为“已成功无需修复”。因此轮次判定排除尾部
          // diagnose-ok（失败计数不变），仍复用 planFixAttempt 的轮次上限语义。
          const last = history[history.length - 1];
          const historyForPlan =
            last !== undefined && last.stage === 'diagnose' && last.ok
              ? history.slice(0, -1)
              : history;
          let plan: ReturnType<typeof planFixAttempt>;
          try {
            plan = planFixAttempt(historyForPlan, maxAttempts);
          } catch (e) {
            history.push({ stage: 'fix', ok: false, detail: `修复决策异常：${errorText(e)}` });
            return abortResult();
          }
          if (plan.action === 'abort-to-human') {
            return abortResult();
          }
          try {
            const details = failureDetails(history);
            const errorBlock = details === '' ? '（无明细）' : details;
            const contextPack =
              baseContextPack === ''
                ? `## 错误回灌（§10.3 fix）\n${errorBlock}`
                : `${baseContextPack}\n## 错误回灌（§10.3 fix）\n${errorBlock}`;
            // userPrompt 原样保留，其余沿用 base，只追加 contextPack 尾。
            promptInput = { ...basePrompt, userPrompt: basePrompt.userPrompt, contextPack };
          } catch (e) {
            history.push({
              stage: 'fix',
              ok: false,
              detail: `回灌 prompt 组装异常：${errorText(e)}`,
            });
            return abortResult();
          }
        }

        let promptText: string;
        try {
          promptText = buildGeneratePrompt(promptInput);
        } catch (e) {
          history.push({
            stage: action,
            ok: false,
            detail: `prompt 组装异常：${errorText(e)}`,
          });
          return abortResult();
        }

        let inferRes: InferResponse;
        try {
          inferRes = await gateway.infer({
            messages: [{ role: 'user', content: promptText }],
          } as InferRequest);
        } catch (e) {
          history.push({ stage: action, ok: false, detail: `网关异常：${errorText(e)}` });
          return abortResult();
        }

        if (inferRes === null || inferRes === undefined || !inferRes.ok) {
          const detail =
            (inferRes as InferResponse | undefined)?.error?.reason ?? '模型调用失败，转人工确认';
          const result: StageResult = { stage: action, ok: false, detail };
          history.push(result);
          const attempts = failureCount(history);
          const next = nextStep(result, attempts, maxAttempts);
          emit({ stage: action, ok: false, detail, attempts, next });
          if (next.action === 'abort') return abortResult();
          action = 'diagnose';
          continue;
        }

        const text = (inferRes.text ?? '') as string;
        transcript.push({ stage: action, text });
        latestText = text;
        const result: StageResult = { stage: action, ok: true };
        history.push(result);
        const attempts = failureCount(history);
        const next = nextStep(result, attempts, maxAttempts);
        emit({ stage: action, ok: true, attempts, next });
        action = 'validate';
        continue;
      }

      if (action === 'validate') {
        let v: ClosedLoopValidateResult;
        try {
          v = await opts.validate(latestText, [...history]);
        } catch (e) {
          history.push({ stage: 'validate', ok: false, detail: `验证异常：${errorText(e)}` });
          return abortResult();
        }
        const result: StageResult = { stage: 'validate', ok: v.ok };
        if (v.detail !== undefined) result.detail = v.detail;
        if (v.kind !== undefined) result.kind = v.kind;
        history.push(result);
        const attempts = failureCount(history);
        const next = nextStep(result, attempts, maxAttempts);
        emit({
          stage: 'validate',
          ok: v.ok,
          ...(v.detail !== undefined ? { detail: v.detail } : {}),
          attempts,
          next,
        });
        if (next.action === 'succeed') {
          return { outcome: 'succeed', history, transcript, attempts };
        }
        if (next.action === 'abort') return abortResult();
        action = 'diagnose';
        continue;
      }

      // action === 'diagnose'
      const lastFail = [...history].reverse().find((h) => !h.ok);
      const inputDetail = lastFail?.detail;
      let d: ClosedLoopDiagnoseResult;
      if (opts.diagnose === undefined) {
        d = { ok: false, detail: '无诊断器' };
      } else {
        try {
          d = await opts.diagnose(inputDetail);
        } catch (e) {
          history.push({ stage: 'diagnose', ok: false, detail: `诊断异常：${errorText(e)}` });
          return abortResult();
        }
      }
      const result: StageResult = { stage: 'diagnose', ok: d.ok };
      if (d.detail !== undefined) result.detail = d.detail;
      history.push(result);
      const attempts = failureCount(history);
      const next = nextStep(result, attempts, maxAttempts);
      emit({
        stage: 'diagnose',
        ok: d.ok,
        ...(d.detail !== undefined ? { detail: d.detail } : {}),
        attempts,
        next,
      });
      if (next.action === 'abort') return abortResult();
      action = 'fix';
    }
  } catch (e) {
    if (history.length === 0) {
      history.push({ stage: 'generate', ok: false, detail: `闭环异常：${errorText(e)}` });
    }
    return abortResult();
  }
}
