/**
 * 生成闭环状态机（设计文档 §10.3 / §11）。
 *
 * 循环：generate → validate → diagnose → fix → validate …（§10.3：
 * 生成 → 装载 → 验证 → 日志诊断 → 错误回灌修复）。
 * 成功判据引用 contract VALIDATION_CRITERIA（机器可判定，否则不知停还是改）。
 *
 * 纯函数 nextStep(result, attempts, maxAttempts)，不含 LLM 调用
 * （模型接入走 §10.0 推理网关，由调用方编排；此处只做流转决策）。
 */

import { VALIDATION_CRITERIA } from '@mc-creator/contract';

export type PipelineStage = 'generate' | 'validate' | 'diagnose' | 'fix';

export type NextAction = 'validate' | 'diagnose' | 'fix' | 'succeed' | 'abort';

export interface StageResult {
  stage: PipelineStage;
  ok: boolean;
  /**
   * 产物类别键（VALIDATION_CRITERIA 的 key：
   * datapack / addon / server-plugin / server-mod / client-mod）。
   * validate 成功时用于给出机器可判定依据。
   */
  kind?: string;
  detail?: string;
}

export interface NextDecision {
  action: NextAction;
  reason: string;
  /** validate 成功时回填命中的成功判据（§10.3 表）。 */
  criterion?: string;
}

/**
 * 单步流转决策（纯函数）。
 * - 成功：generate→validate；validate→succeed（附 criterion）；
 *   diagnose→fix；fix→validate（重新验证）。
 * - 失败且 attempts >= maxAttempts → abort（超轮转人工，§10.5 轮次上限）。
 * - 失败：generate/validate/fix → diagnose（读日志定位）；
 *   diagnose 自身失败 → abort（连原因都定位不到，避免无效循环烧 token）。
 */
export function nextStep(result: StageResult, attempts: number, maxAttempts: number): NextDecision {
  if (result.ok) {
    switch (result.stage) {
      case 'generate':
        return { action: 'validate', reason: '生成完成，进入验证（§10.3）' };
      case 'validate': {
        const decision: NextDecision = { action: 'succeed', reason: '验证通过，闭环结束' };
        if (result.kind !== undefined) {
          const criterion = VALIDATION_CRITERIA[result.kind];
          if (criterion !== undefined) decision.criterion = criterion;
        }
        return decision;
      }
      case 'diagnose':
        return { action: 'fix', reason: '诊断完成，进入错误回灌修复' };
      case 'fix':
        return { action: 'validate', reason: '修复完成，重新验证' };
    }
  }

  if (attempts >= maxAttempts) {
    return { action: 'abort', reason: `达到最大轮次（${maxAttempts}），转人工确认（§10.5）` };
  }
  if (result.stage === 'diagnose') {
    return { action: 'abort', reason: '无法定位失败原因，转人工（避免无效循环）' };
  }
  return { action: 'diagnose', reason: `${result.stage} 失败，进入日志诊断（§10.3）` };
}
