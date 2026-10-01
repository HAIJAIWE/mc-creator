/** Datapack JSON 内容生成的共享纯函数（无实例状态）。 */

/** 安全解析 JSON 字符串，解析失败时返回 fallback（不抛异常） */
export function safeJsonParse(json: string, fallback: unknown): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return fallback;
  }
}

/**
 * 解析 surface_rule 输出（1.21+ 生效，替代废弃的 surface_builder）：
 * - surfaceRule 为对象时直接使用（完整 surface_rule JSON，优先级最高）
 * - 否则按 surfaceBuilder 字符串映射常见类型（minecraft:grass / minecraft:stone）
 * - 字符串为 JSON 对象文本时按原样解析
 * - 无法解析时返回 null（不输出 surface_rule 字段）
 */
export function resolveSurfaceRule(
  surfaceRule: Record<string, unknown> | undefined,
  surfaceBuilder: string,
): Record<string, unknown> | null {
  if (surfaceRule && Object.keys(surfaceRule).length > 0) return surfaceRule;
  const trimmed = (surfaceBuilder ?? '').trim();
  if (trimmed === 'minecraft:grass') return { type: 'minecraft:grass' };
  if (trimmed === 'minecraft:stone') return { type: 'minecraft:stone' };
  if (trimmed.startsWith('{')) {
    const parsed = safeJsonParse(trimmed, null);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * MC 1.20.5+ 配方成分（Ingredient）格式：`{ item: "minecraft:x" }` 或 `{ tag: "minecraft:x" }`。
 * 输入字符串以 `#` 开头表示标签引用，否则为物品 ID（G-3 修复：旧格式 `{ id: ... }` 无法加载）。
 */
export function toIngredient(ref: string): Record<string, string> {
  const trimmed = (ref ?? '').trim();
  return trimmed.startsWith('#') ? { tag: trimmed.slice(1) } : { item: trimmed };
}

/**
 * P2 dogfood：路径段消毒，防止路径穿越（如 ../）和特殊字符注入。
 *
 * Minecraft datapack 路径段仅允许小写字母、数字、下划线、点、斜杠、连字符。
 * - 替换非法字符为下划线
 * - 移除路径穿越（.. 和以 / 开头的段）
 * - 空字符串回退为 'unknown'
 *
 * @param segment 原始路径段（如 namespace、recipe id、advancement id）
 * @returns 消毒后的安全路径段
 */
export function sanitizePathSegment(segment: string): string {
  if (!segment) return 'unknown';
  // 移除路径穿越：先按 / 拆分，过滤掉 .. 和空段
  const parts = segment.split('/').filter((p) => p && p !== '..' && p !== '.');
  if (parts.length === 0) return 'unknown';
  // 每个段仅保留合法字符（小写字母、数字、下划线、点、连字符）
  const sanitized = parts
    .map((p) => p.toLowerCase().replace(/[^a-z0-9_.-]/g, '_'))
    .filter(Boolean)
    .join('/');
  return sanitized || 'unknown';
}
