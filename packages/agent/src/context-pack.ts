/**
 * 上下文注入 context_pack（设计文档 §10.4，闭环强依赖）。
 *
 * 每轮生成前注入 get_context_pack(target) 的运行时状态：
 * 当前实例已有 mod / 服务端插件与配置 / 上次构建产物与哈希 /
 * 历史失败原因 / 目标平台（是否 Folia），并按 token 预算截断。
 *
 * 纯函数：(target, parts, budgetChars) → ContextPack，可测、无 I/O。
 * 截断策略（targeting 优先，见 §10.4）：
 * 1. 头部（目标身份/mcVersion/Folia/已装 mod 与插件/上次构建哈希/失败原因）
 *    永远保留——截断只动尾部 bulky 段（配置摘要/API 类型/extra）；
 * 2. 尾部按段顺序填充剩余预算，装不下的段截断并打 [truncated] 标记；
 * 3. 极端情况（头部自身超预算）才从头部末尾截断，恒保证
 *    text.length <= budgetChars。
 */

export interface ContextTarget {
  instanceId?: string;
  serverId?: string;
  /** java / bedrock / server（§3 Edition；devkit 为构建执行方，不作生成目标）。 */
  edition?: string;
  /** 运行时拉取的版本号（§0.5#3，禁止模型记忆）。 */
  mcVersion?: string;
  /** Paper/Folia 等服务端 runtime（§7.2）。 */
  runtime?: string;
}

export interface ContextParts {
  /** 当前实例已装 mod（§10.4 状态注入）。 */
  mods?: string[];
  /** 服务端插件与配置摘要（§10.4）。 */
  plugins?: string[];
  /** 上次构建产物哈希（§0.5#5 对外可见）。 */
  lastBuildHash?: string;
  /** 历史失败原因（回灌修复用，§10.3）。 */
  lastFailure?: string;
  /** 目标平台是否 Folia（硬开关，§7.3）。 */
  isFolia?: boolean;
  /** bulky：服务端配置摘要（低优先级，可截断）。 */
  serverConfigSummary?: string;
  /** bulky：目标 API 类型定义（走提示缓存，§10.5；超预算先截）。 */
  apiTypes?: string;
  /** bulky：调用方附加上下文（最低优先级）。 */
  extra?: string;
}

export interface ContextPack {
  target: ContextTarget;
  text: string;
  truncated: boolean;
  budgetChars: number;
}

export const DEFAULT_CONTEXT_BUDGET_CHARS = 8000;

function headLines(target: ContextTarget, parts: ContextParts): string[] {
  const lines = ['# context_pack（§10.4 状态注入）'];
  if (target.edition !== undefined) lines.push(`edition: ${target.edition}`);
  if (target.mcVersion !== undefined) lines.push(`mc_version: ${target.mcVersion}`);
  if (target.instanceId !== undefined) lines.push(`instance: ${target.instanceId}`);
  if (target.serverId !== undefined) lines.push(`server: ${target.serverId}`);
  if (target.runtime !== undefined) lines.push(`runtime: ${target.runtime}`);
  if (parts.isFolia !== undefined) lines.push(`folia: ${parts.isFolia ? 'true' : 'false'}`);
  if (parts.mods !== undefined && parts.mods.length > 0) {
    lines.push(`installed_mods: ${parts.mods.join(', ')}`);
  }
  if (parts.plugins !== undefined && parts.plugins.length > 0) {
    lines.push(`installed_plugins: ${parts.plugins.join(', ')}`);
  }
  if (parts.lastBuildHash !== undefined) lines.push(`last_build_hash: ${parts.lastBuildHash}`);
  if (parts.lastFailure !== undefined) lines.push(`last_failure: ${parts.lastFailure}`);
  return lines;
}

export function buildContextPack(
  target: ContextTarget,
  parts: ContextParts = {},
  budgetChars: number = DEFAULT_CONTEXT_BUDGET_CHARS,
): ContextPack {
  const budget = Math.max(1, Math.floor(budgetChars));
  const head = headLines(target, parts).join('\n');
  const tailSections: string[] = [];
  if (parts.serverConfigSummary !== undefined && parts.serverConfigSummary !== '') {
    tailSections.push(`## server_config\n${parts.serverConfigSummary}`);
  }
  if (parts.apiTypes !== undefined && parts.apiTypes !== '') {
    tailSections.push(`## api_types\n${parts.apiTypes}`);
  }
  if (parts.extra !== undefined && parts.extra !== '') {
    tailSections.push(`## extra\n${parts.extra}`);
  }

  // 头部自身超预算：极端情况，从末尾截断头部
  if (head.length >= budget) {
    return { target, text: `${head.slice(0, budget - 14)}\n[truncated]`, truncated: true, budgetChars: budget };
  }

  let text = head;
  let truncated = false;
  for (const section of tailSections) {
    const candidate = `${text}\n${section}`;
    if (candidate.length <= budget) {
      text = candidate;
      continue;
    }
    truncated = true;
    const room = budget - text.length - '\n'.length - '\n[truncated]'.length;
    if (room > 0) {
      text = `${text}\n${section.slice(0, room)}\n[truncated]`;
    }
    break; // 预算耗尽：后续更低优先级段直接丢弃
  }
  return { target, text, truncated, budgetChars: budget };
}
