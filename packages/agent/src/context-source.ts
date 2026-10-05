/**
 * 状态注入接线（设计文档 §10.4）：把内核只读能力与 context_pack 拼装接起来。
 *
 * 分层约定（§2.2 / MEMORY.md 架构决策）：
 * - **内核只给事实**：kernel-java / kernel-server 的 get_context_pack 返回
 *   `{ target, parts }`（已装 mod、已装插件、上次部署哈希、配置摘要…），
 *   内核里**重新声明**了结构兼容的 ContextTarget/ContextParts，不 import agent，
 *   保证依赖方向恒为 agent → kernel。
 * - **agent 负责拼装与截断**：本模块取内核事实 → 调 buildContextPack 按 token
 *   预算截断 → 得到可直接注入模型的 ContextPack。
 *
 * 为什么要这一层而不是直接把内核 dispatch 结果丢给模型：
 * buildContextPack 的截断策略（头部永保留、尾部 bulky 段先截）是**模型侧**约束，
 * 内核不该知道 token 预算；反之内核的磁盘探测也不该被 agent 重写一遍。
 */

import { randomUUID } from 'node:crypto';
import type { TaskResult } from '@mc-creator/contract';
import type { KernelContract } from '@mc-creator/contract';
import { buildContextPack, DEFAULT_CONTEXT_BUDGET_CHARS } from './context-pack.js';
import type { ContextPack, ContextParts, ContextTarget } from './context-pack.js';

/** get_context_pack 的内核返回形状（与内核侧重新声明的结构兼容）。 */
interface RawContextState {
  target: ContextTarget;
  parts: ContextParts;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 宽松校验内核返回：只挑出**类型正确**的字段，类型不符的丢弃。
 * 内核是 R 类只读探测，绝不抛异常 —— 这里同样不能让上游因一个脏字段而崩掉。
 */
export function normalizeContextState(raw: unknown): RawContextState {
  const target: ContextTarget = {};
  const parts: ContextParts = {};
  if (!isRecord(raw)) return { target, parts };

  const rt = raw['target'];
  if (isRecord(rt)) {
    for (const key of ['instanceId', 'serverId', 'edition', 'mcVersion', 'runtime'] as const) {
      const value = rt[key];
      if (typeof value === 'string' && value !== '') target[key] = value;
    }
  }

  const rp = raw['parts'];
  if (isRecord(rp)) {
    for (const key of ['mods', 'plugins'] as const) {
      const value = rp[key];
      if (Array.isArray(value)) {
        const list = value.filter((v): v is string => typeof v === 'string' && v !== '');
        if (list.length > 0) parts[key] = list;
      }
    }
    for (const key of ['lastBuildHash', 'lastFailure', 'serverConfigSummary'] as const) {
      const value = rp[key];
      if (typeof value === 'string' && value !== '') parts[key] = value;
    }
    if (typeof rp['isFolia'] === 'boolean') parts.isFolia = rp['isFolia'];
  }

  return { target, parts };
}

/**
 * 调用内核的 get_context_pack 拿事实。
 * 返回 null 表示内核不支持或读取失败（调用方据此降级，不抛异常）。
 */
export async function fetchContextState(
  kernel: KernelContract,
  payload: { instanceId?: string; serverId?: string } = {},
): Promise<RawContextState | null> {
  try {
    const result: TaskResult = await kernel
      .dispatch({
        id: randomUUID(),
        kind: 'get_context_pack',
        payload,
      })
      .result();
    if (!result.ok) return null;
    return normalizeContextState(result.data);
  } catch {
    // 内核 R 类探测失败不应中断生成流程：降级为空状态注入。
    return null;
  }
}

/** get_context_pack 接线选项。 */
export interface BuildContextPackOptions {
  /** 目标标识（instanceId / serverId / edition 等），会覆盖内核返回值。 */
  target?: ContextTarget;
  /** 调用方附加上下文（最低优先级，尾部 bulky 段）。 */
  extra?: string;
  /** 目标 API 类型定义（§10.5 走提示缓存，超预算先截）。 */
  apiTypes?: string;
  /** 附加的历史失败原因（§10.3 回灌修复）。 */
  lastFailure?: string;
  /** token 预算（字符数），默认 8000。 */
  budgetChars?: number;
}

export interface ContextPackResult {
  pack: ContextPack;
  /** 内核是否真的读到了状态（false = 降级为空注入，模型会看到空的 installed 列表）。 */
  fromKernel: boolean;
}

/**
 * 主入口：内核事实 + 调用方补充 → 预算截断后的 ContextPack。
 *
 * 合并口径：调用方显式传的 target 字段**优先**于内核返回值
 * （调用方知道自己刚做了什么，内核只知道磁盘现状）；
 * 调用方没传的字段才用内核的。反过来调用方可以只补 lastFailure 这类内核读不到的信息。
 */
export async function buildContextPackFromKernel(
  kernel: KernelContract,
  options: BuildContextPackOptions = {},
): Promise<ContextPackResult> {
  const raw = await fetchContextState(kernel, {
    ...(options.target?.instanceId === undefined ? {} : { instanceId: options.target.instanceId }),
    ...(options.target?.serverId === undefined ? {} : { serverId: options.target.serverId }),
  });
  const state = raw ?? { target: {} as ContextTarget, parts: {} as ContextParts };

  const target: ContextTarget = { ...state.target, ...options.target };
  const parts: ContextParts = { ...state.parts };
  if (options.lastFailure !== undefined && options.lastFailure !== '') {
    parts.lastFailure = options.lastFailure;
  }
  if (options.apiTypes !== undefined && options.apiTypes !== '') parts.apiTypes = options.apiTypes;
  if (options.extra !== undefined && options.extra !== '') parts.extra = options.extra;

  const pack = buildContextPack(target, parts, options.budgetChars ?? DEFAULT_CONTEXT_BUDGET_CHARS);
  return { pack, fromKernel: raw !== null };
}
