/** 把字符串规范化为合法的 itemId/blockId/entityId（小写下划线） */
export function sanitizeId(raw: string): string {
  const lower = raw.toLowerCase();
  const cleaned = lower.replace(/[^a-z0-9_]/g, '_');
  return cleaned || 'unknown';
}

/** 取路径最后一段作为文件名（不含扩展名） */
export function basenameNoExt(path: string): string {
  const slash = path.lastIndexOf('/');
  const file = slash >= 0 ? path.slice(slash + 1) : path;
  const dot = file.lastIndexOf('.');
  return dot > 0 ? file.slice(0, dot) : file;
}

/** 安全解析 JSON，失败时返回 null */
export function safeParseJson(content: string): unknown | null {
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

/** 剥离命名空间前缀：minecraft:iron_ingot → iron_ingot */
export function stripNamespace(itemId: string): string {
  const colon = itemId.indexOf(':');
  return colon >= 0 ? itemId.slice(colon + 1) : itemId;
}

/** 提取首个 public 方法名（用于 CodeNode.methodName），找不到时回退到 'process' */
export function extractFirstPublicMethodName(content: string): string {
  // 匹配 public [static] [final] <ReturnType> <methodName>(
  // 排除 class/interface 关键字
  const methodRegex =
    /public\s+(?:static\s+)?(?:final\s+)?(?!class\b|interface\b|enum\b|record\b)(?:[\w<>\],?\s[]+?)\s+(\w+)\s*\(/g;
  let m: RegExpExecArray | null;
  while ((m = methodRegex.exec(content)) !== null) {
    const name = m[1];
    // 过滤构造函数：方法名等于类名时跳过
    const classMatch = /\b(?:class|interface|enum|record)\s+(\w+)/.exec(content);
    if (classMatch && name === classMatch[1]) continue;
    // 过滤 Java 关键字
    if (['if', 'while', 'for', 'switch', 'return', 'new'].includes(name)) continue;
    return name;
  }
  return 'process';
}
