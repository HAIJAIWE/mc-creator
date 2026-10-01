// === JSON 解析辅助 ===

/**
 * 解析节点参数 JSON 字符串为 record。
 * 解析失败或非对象时返回空对象（不阻断编译，保证 spec 可用）。
 *
 * P2-4 dogfood 修复：传入 warnings + nodeId 时，解析失败或类型不符会 push warning，
 * 帮助用户定位哪个节点的参数 JSON 有问题。不传时保持原有静默行为（向后兼容）。
 */
export function parseArgsJson(
  json: string,
  warnings?: string[],
  nodeId?: string,
): Record<string, unknown> {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    // 解析成功但不是对象（如字符串/数字/数组）
    if (warnings && nodeId) {
      const actualType = Array.isArray(parsed) ? 'array' : typeof parsed;
      warnings.push(`节点 ${nodeId} 的参数 JSON 应为对象，实际为 ${actualType}，已忽略`);
    }
    return {};
  } catch (e) {
    // JSON 语法错误
    if (warnings && nodeId) {
      warnings.push(`节点 ${nodeId} 的参数 JSON 解析失败：${(e as Error).message}，已忽略`);
    }
    return {};
  }
}

/**
 * 解析端口签名 JSON 字符串为 Record<portId, PortType>。
 * 解析失败或非对象时返回空对象。
 *
 * P2-4 dogfood 修复：传入 warnings + nodeId 时，解析失败或类型不符会 push warning。
 */
export function parseSignatureJson(
  json: string,
  warnings?: string[],
  nodeId?: string,
): Record<string, string> {
  if (!json || !json.trim()) return {};
  try {
    const parsed = JSON.parse(json);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      // 端口签名的值应为字符串（PortType），非字符串值会被过滤
      const result: Record<string, string> = {};
      let hasNonStringValue = false;
      for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof value === 'string') {
          result[key] = value;
        } else {
          hasNonStringValue = true;
        }
      }
      if (hasNonStringValue && warnings && nodeId) {
        warnings.push(
          `节点 ${nodeId} 的端口签名 JSON 含非字符串值，已过滤（端口签名值应为 PortType 字符串）`,
        );
      }
      return result;
    }
    // 解析成功但不是对象
    if (warnings && nodeId) {
      const actualType = Array.isArray(parsed) ? 'array' : typeof parsed;
      warnings.push(`节点 ${nodeId} 的端口签名 JSON 应为对象，实际为 ${actualType}，已忽略`);
    }
    return {};
  } catch (e) {
    if (warnings && nodeId) {
      warnings.push(`节点 ${nodeId} 的端口签名 JSON 解析失败：${(e as Error).message}，已忽略`);
    }
    return {};
  }
}
