/**
 * 共享校验工具：统一的项目 ID / 路径片段校验口径
 *
 * 设计理由：
 * - project-store.ts 已有 `ID_RE = /^[a-zA-Z0-9_-]+$/` + `assertValidId()`，
 *   file-manager.ts 的 7 个 get*Dir 通道也需要完全一致的校验。
 * - 抽成共享模块可避免「两处口径不一致」导致的安全漏洞（如一方放宽、另一方收紧）。
 * - 同时也便于为 maxDepth 等非字符串字段提供统一的类型守卫。
 *
 * 校验规则：
 * - projectId：非空字符串，仅允许 ASCII 字母、数字、下划线、连字符。
 *   拒绝：空串、路径遍历片段（../、..\）、非字符串（null/number/array/object/NaN）。
 * - maxDepth：有限整数（Number.isFinite + Number.isInteger），>= -1。
 *   NaN/Infinity/小数/负数（<-1）一律拒绝或纠正。
 */

// 与 project-store.ts 保持完全一致的正则
export const ID_RE = /^[a-zA-Z0-9_-]+$/;

/**
 * 校验 projectId 合法性（路径穿越防护）
 * @throws {Error} 当 id 不合法时抛出，消息包含 JSON.stringify(id) 便于审计
 */
export function assertValidProjectId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || id.length === 0 || !ID_RE.test(id)) {
    throw new Error(`Invalid project id: ${JSON.stringify(id)}`);
  }
}

/**
 * 非抛出版：返回结构化校验结果，供 IPC 入口直接返回错误对象
 */
export function validateProjectId(
  id: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof id !== 'string') {
    return { ok: false, error: `projectId must be a string, got ${typeof id}` };
  }
  if (id.length === 0) {
    return { ok: false, error: 'projectId must not be empty' };
  }
  if (!ID_RE.test(id)) {
    return {
      ok: false,
      error: `projectId contains invalid characters (only a-z A-Z 0-9 _ - allowed): ${JSON.stringify(id)}`,
    };
  }
  return { ok: true, value: id };
}

/**
 * 校验 maxDepth：必须是有限整数且 >= -1
 * - NaN、Infinity、小数、<-1 的负数 → 失败
 * - undefined/未传入 → 视为 -1（无界）
 */
export function validateMaxDepth(
  maxDepth: unknown,
): { ok: true; value: number } | { ok: false; error: string } {
  if (maxDepth === undefined || maxDepth === null) {
    return { ok: true, value: -1 };
  }
  if (typeof maxDepth !== 'number' || !Number.isFinite(maxDepth) || !Number.isInteger(maxDepth)) {
    return { ok: false, error: 'maxDepth must be a finite integer' };
  }
  if (maxDepth < -1) {
    return { ok: false, error: 'maxDepth must be >= -1' };
  }
  return { ok: true, value: maxDepth };
}

/**
 * 校验相对路径片段：非空字符串，不包含路径遍历序列
 * 这里不做完整的路径规范化，只做基础字符级拦截；
 * 真正的安全边界在 FileManager.checkSafePath / isSafePath（解析后绝对路径校验）。
 */
export function validateRelativePath(
  relPath: unknown,
): { ok: true; value: string } | { ok: false; error: string } {
  if (typeof relPath !== 'string') {
    return { ok: false, error: 'path must be a string' };
  }
  if (relPath.length === 0) {
    return { ok: false, error: 'path must not be empty' };
  }
  // 简单的路径遍历特征检测（不依赖规范化，避免平台差异）
  if (relPath.includes('..')) {
    return { ok: false, error: 'path must not contain ".." path traversal sequences' };
  }
  // 禁止绝对路径特征
  if (relPath.startsWith('/') || /^[a-zA-Z]:[/\\]/.test(relPath)) {
    return { ok: false, error: 'path must be relative, not absolute' };
  }
  return { ok: true, value: relPath };
}
