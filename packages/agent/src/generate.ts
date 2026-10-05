/**
 * 生成编排纯函数（设计文档 §10.3 生成闭环 + §10.4 上下文注入 + §10.5 成本控制；§11 生成阶梯）。
 *
 * 只做“组装 prompt / 轮次预算 / 修复决策 / 成功判据”四件事：
 * - 无 LLM 调用（模型接入走 §10.0 推理网关，由调用方编排）；
 * - 无 I/O、无跨包依赖（本包禁依赖 generator-plugin，只借鉴其
 *   validatePluginStructure 返回 {ok, errors[]} 的形状作 validate 阶段范本）；
 * - 协作：prompt 的 contextPack 段直接吃 context-pack.ts 的
 *   buildContextPack 输出文本；planFixAttempt 复用 pipeline.ts 的
 *   StageResult 类型与 nextStep 的流转语义（generate→validate→diagnose→fix）；
 *   成功判据取 contract VALIDATION_CRITERIA（机器可判定是闭环前提）。
 */

import { VALIDATION_CRITERIA } from '@mc-creator/contract';
import type { StageResult } from './pipeline.js';

/**
 * 生成产物类别（§10.3 判据表 5 键，与 VALIDATION_CRITERIA 的 key 一一对应）。
 *
 * 与 LEGACY_GENERATOR_TO_KIND（旧 13 种生成器名 → ContentKind）的对应：
 * - datapack ← datapack / kubejs / crafttweaker / enchantment（数据驱动）；
 * - addon ← behavior_pack / behavior_item / behavior_entity（Bedrock 行话叫 behavior-pack）；
 * - server-plugin ← 新增（Paper/Folia，旧生成器缺失，§11 阶梯 P1 甜点区）；
 * - server-mod ← 服务端形态 Mod（Forge/NeoForge/Fabric 服务端；旧表只有客户端 mod 生成器）；
 * - client-mod ← mod（客户端 Mod；§11 阶梯最后，成本最高）。
 */
export type GenerationKind = 'datapack' | 'addon' | 'server-plugin' | 'server-mod' | 'client-mod';

export interface GeneratePromptInput {
  kind: GenerationKind;
  /** 用户原始需求（永不截断，§10.4 优先级最高）。 */
  userPrompt: string;
  /** 版本号等运行时上下文（运行时拉取，禁止模型记忆，§0.5#3）。 */
  versionContext: string;
  /** 目标 API 类型定义（走提示缓存，超预算先截，§10.5）。 */
  apiTypes: string;
  /**
   * 上下文包文本（§10.4 状态注入）。
   * 与 context-pack.ts 联调：buildContextPack(target, parts, budget).text 可直接喂入。
   */
  contextPack: string;
  budgetChars: number;
}

/** 截断标记（截断处追加，与 context-pack.ts 的 [truncated] 呼应，此处用中文）。 */
export const GENERATE_TRUNC_MARK = '[已截断]';

/**
 * 组装生成 prompt（§10.4 强制顺序）：
 * 版本号等运行时上下文（versionContext）→ API 类型（apiTypes）→
 * contextPack → 用户需求（userPrompt）。
 *
 * 超 budgetChars 时按“用户需求 > 版本上下文 > contextPack > apiTypes”
 * 优先级截断：先截 apiTypes，再截 contextPack，最后截版本上下文；
 * 用户需求永不截断（极端情况下总长度可能因此超预算）；
 * 被截断的段在截断处追加 `[已截断]` 标记。
 */
export function buildGeneratePrompt(input: GeneratePromptInput): string {
  const userPrompt = input.userPrompt ?? '';
  if (userPrompt.trim() === '') {
    throw new Error('用户需求（userPrompt）不能为空：生成提示必须包含用户需求（§10.4）');
  }
  const rawBudget = Math.floor(input.budgetChars);
  const budget = Number.isFinite(rawBudget) ? Math.max(1, rawBudget) : Number.POSITIVE_INFINITY;

  const head = `# 生成提示（kind: ${input.kind}，§10.3 生成闭环）`;
  const titles = [
    '## 版本上下文（运行时版本，§10.4）',
    '## API 类型（§10.4，走提示缓存）',
    '## 上下文包 context_pack（§10.4 状态注入）',
    '## 用户需求（最高优先级，永不截断）',
  ];
  const bodies: string[] = [
    input.versionContext ?? '',
    input.apiTypes ?? '',
    input.contextPack ?? '',
    userPrompt,
  ];
  const render = (): string => [head, ...titles.map((t, i) => `${t}\n${bodies[i]}`)].join('\n');

  let text = render();
  // 截断优先级从低到高：apiTypes(1) → contextPack(2) → versionContext(0)；用户需求(3)永不截断。
  for (const idx of [1, 2, 0]) {
    if (text.length <= budget) break;
    const body = bodies[idx] as string;
    if (body.length === 0) continue;
    const overflow = text.length - budget;
    // 新体 = 切片 + '\n' + 标记；keep 解方程 text - L + keep + 1 + 标记长 <= budget。
    const keep = body.length - overflow - 1 - GENERATE_TRUNC_MARK.length;
    if (keep < 0) {
      // 本段再怎么截也装不下：只留标记，继续向更高优先级段要空间。
      bodies[idx] = GENERATE_TRUNC_MARK;
    } else {
      bodies[idx] = `${body.slice(0, keep)}\n${GENERATE_TRUNC_MARK}`;
    }
    text = render();
  }
  return text;
}

/**
 * 反馈延迟 → 迭代轮次（§11 生成阶梯；梯度见 §0.3 梯度表）：
 * 反馈越快（秒级热重载）轮次越多，反馈越慢（要进游戏看效果）轮次越少（§10.5 成本控制）。
 * - datapack / addon：秒级反馈（/reload、manifest 校验）→ 8 轮；
 * - server-plugin：十秒级（重启/热重载服务端）→ 5 轮；
 * - server-mod：分钟级（编译 + 启动服务端）→ 3 轮；
 * - client-mod：分钟级 + 需图形环境验证（成本最高）→ 2 轮。
 */
export function estimateRounds(kind: GenerationKind): number {
  switch (kind) {
    case 'datapack':
    case 'addon':
      return 8;
    case 'server-plugin':
      return 5;
    case 'server-mod':
      return 3;
    case 'client-mod':
      return 2;
    default:
      throw new Error(`未知生成类别（kind）“${kind as string}”：无法估算迭代轮次（§11）`);
  }
}

export type FixAttemptAction = 'retry-fix' | 'abort-to-human';

export interface FixAttemptPlan {
  action: FixAttemptAction;
  reason: string;
}

/**
 * 修复尝试决策（复用 pipeline.ts nextStep 语义，输入为整条 history）：
 * - history 为空 → retry-fix（首轮）；
 * - 最后一步 ok → abort-to-human（已成功无需修复，成功态不受轮次影响）；
 * - 失败次数（ok:false 条数）>= maxAttempts → abort-to-human（§10.5 轮次上限）；
 * - history 中存在 diagnose 失败 → abort-to-human（连原因都定位不到，
 *   与 nextStep 的 diagnose 失败 → abort 一致，避免无效循环烧 token）；
 * - 其余 → retry-fix（错误回灌后重试，对应 §10.3 fix→validate）。
 */
export function planFixAttempt(history: StageResult[], maxAttempts: number): FixAttemptPlan {
  if (history.length === 0) {
    return { action: 'retry-fix', reason: '首轮尝试，直接进入生成/修复（§10.3）' };
  }
  const last = history[history.length - 1] as StageResult;
  if (last.ok) {
    return {
      action: 'abort-to-human',
      reason: '已成功无需修复：最后一步已成功，闭环结束，转人工确认',
    };
  }
  const failures = history.filter((h) => !h.ok).length;
  if (failures >= maxAttempts) {
    return {
      action: 'abort-to-human',
      reason: `失败 ${failures} 次达到轮次上限（${maxAttempts}），转人工确认（§10.5 轮次上限）`,
    };
  }
  if (history.some((h) => h.stage === 'diagnose' && !h.ok)) {
    return {
      action: 'abort-to-human',
      reason: '诊断阶段失败，无法定位原因，转人工（避免无效循环，§10.3）',
    };
  }
  return {
    action: 'retry-fix',
    reason: `错误回灌后第 ${failures + 1} 次修复尝试（§10.3 fix→validate）`,
  };
}

/**
 * 取某类别的机器可判定成功判据（§10.3 表；机器可判定是闭环收敛的前提）。
 * 缺失抛中文 Error（调用方不得用“感觉成功了”代替判据）。
 */
export function criterionFor(kind: GenerationKind): string {
  const table: Record<string, string | undefined> = VALIDATION_CRITERIA;
  const criterion = table[kind];
  if (criterion === undefined) {
    throw new Error(
      `未知生成类别（kind）“${kind as string}”：缺少机器可判定的成功判据，闭环无法收敛（§10.3）`,
    );
  }
  return criterion;
}
