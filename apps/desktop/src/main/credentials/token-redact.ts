/**
 * §13.2 凭据：日志与遥测中**过滤一切 token**。
 *
 * ## 为什么单独一个模块
 *
 * 账号链路（微软 OAuth → XBL → XSTS → Minecraft）会产生 6 类秘密：
 * `code_verifier` / OAuth `access_token` / OAuth `refresh_token` /
 * XBL `Token` / XSTS `Token` / Minecraft `access_token`。
 * 它们在实现里必然被若干层拿到（HTTP 错误体、异常对象、调试日志），
 * 只要有一处 `console.warn(err)` 把原始响应体打出去就泄露了。
 *
 * 与其逐处小心（不可审计、必然漏），不如做一个**统一的出口过滤**：
 * 本模块提供 `scrubSecrets()`（纯函数，按模式过滤）与 `SecretScrubber`
 * （有状态的过滤器，会记住本进程见过的所有秘密值并做字面量替换）。
 * 账号链路的**所有**错误信息与日志都必须经过它。
 *
 * 两层过滤缺一不可：
 * - **字面量替换**（`SecretScrubber.track`）：能抓住我们自己发出去的、
 *   形状任意的 token（Microsoft 的 access token 不是 JWT，长度也不固定）。
 * - **模式替换**（`scrubSecrets`）：能抓住我们**没登记过**的 token
 *   （例如上游返回体里夹带的 `refresh_token=...`），防止「登记漏了」直接变成泄露。
 *
 * 刻意**不**做的事：不做 base64/JWT 解码后再判断。解码本身就要把原文读进内存，
 * 而且解码失败时无法保证不落到异常信息里；宁可过度过滤。
 */

/** 过滤后写入日志/错误信息的占位符。 */
export const REDACTED = '[REDACTED]';

/**
 * 短于此长度的值不做字面量替换。
 *
 * 理由：`state` / `code` 这类值可能只有个位数字符，全局替换会把正常文本
 * （比如错误信息里恰好出现同样的两个字符）打成马赛克，反而让日志失去价值。
 * 真正的 token 最短也有几十字符。
 */
const MIN_TRACKABLE_LENGTH = 12;

/**
 * 模式过滤器。每一项都保留**前缀**（分组 1，只可能是空串）只吃掉**值**（分组 2）。
 *
 * 保留前缀是有意的：日志里 `refresh_token=[REDACTED]` 仍然告诉读者
 * 「这里本来有个 refresh token」，而 `[REDACTED]` 一个字都读不出来。
 *
 * ⚠️ 约定：**分组 1 = 前缀，分组 2 = 秘密值**。写反了会出现
 * 「把秘密留在日志里、把前缀打码」这种最坏情况 ——
 * `token-redact.test.ts` 的 JWT / XBL3.0 两个用例专门守这条。
 */
const VALUE_PATTERNS: RegExp[] = [
  // JSON / query / 表单里的标准键名： "access_token":"xxx" / access_token=xxx / code_verifier=xxx
  // 分隔符**允许是空白**：微软的 error_description 常写成
  // 「refresh token <值> has expired」这种空格分隔的形状（没有 =/:），
  // 只认 `[:=]` 会让它整段漏出去。
  /((?:"|')?(?:access[\s_-]?token|refresh[\s_-]?token|id[\s_-]?token|code[\s_-]?verifier|device[\s_-]?code|client[\s_-]?secret|code)(?:"|')?\s*[:=]?\s*(?:"|')?)([^"'&\s,}\]]+)/gi,
  // identityToken=XBL3.0 x=<uhs>;<XSTS token> —— XSTS token 就在这一段里
  /((?:"|')?identity[\s_-]?token(?:"|')?\s*[:=]?\s*(?:"|')?)([^"'&\s,}\]]+)/gi,
  // Authorization 头：Bearer xxx / d=xxx / XBL3.0 x=...;xxx
  /(authorization\s*[:=]\s*(?:"|')?(?:bearer|d|xbl3\.0)\s+)([A-Za-z0-9\-._~+/=;]{12,})/gi,
  // 裸 Bearer / 裸 XBL3.0（出现在请求体而不是头里时）
  /(\bbearer\s+)([A-Za-z0-9\-._~+/=]{16,})/gi,
  /(xbl3\.0\s+x=)([A-Za-z0-9\-._~+/=;]{8,})/gi,
  // JWT：eyJhbGciOi... 三段式（没有前缀，所以分组 1 是空）
  /()(ey[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]*)/g,
  // Mojang Yggdrasil 风格的老 token（M3t.* / 长 base64 串）——
  // 只在没有任何分隔符的裸串位置匹配，避免误伤正常 URL 路径。
  /(?<![A-Za-z0-9_/.-])((?:M3t\.)?[A-Za-z0-9_-]{40,})(?![A-Za-z0-9_/.-])/g,
];

/** 把单个值替换成占位符（值过短则原样返回）。 */
function redactValue(value: string): string {
  return value.length >= MIN_TRACKABLE_LENGTH ? REDACTED : value;
}

/**
 * 纯函数式过滤：不依赖任何已登记的秘密，仅按模式把「看起来像 token」的值打掉。
 *
 * 用在**所有**对外输出的最后一道：即使调用方忘了登记 token，也能兜住。
 */
export function scrubSecrets(text: string, extraSecrets: readonly string[] = []): string {
  if (text === '') return text;
  let out = text;
  // 先做已登记秘密的字面量替换（长的优先，避免短串先被替换后长串匹配不上）。
  const literals = [...extraSecrets]
    .filter((s) => s.length >= MIN_TRACKABLE_LENGTH)
    .sort((a, b) => b.length - a.length);
  for (const secret of literals) {
    if (secret === '') continue;
    out = out.split(secret).join(REDACTED);
  }
  // 再做模式替换。注意 lastIndex：VALUE_PATTERNS 是模块级常量，
  // 用 String.replace 传字符串时不会读写 lastIndex（只有 /g + exec 才用），
  // 因此这里复用同一批正则对象是安全的。
  for (const re of VALUE_PATTERNS) {
    out = out.replace(
      re,
      (_all, prefix: string, value: string) => `${prefix}${redactValue(value)}`,
    );
  }
  return out;
}

/**
 * 有状态的过滤器：登记本进程见过的所有秘密，之后任何字符串都能被清洗。
 *
 * 典型用法：
 * ```ts
 * const scrubber = new SecretScrubber();
 * const tokens = await client.exchangeCode(...);
 * scrubber.trackAll(tokens.accessToken, tokens.refreshToken);
 * throw new Error(scrubber.scrub(`换取失败: ${JSON.stringify(body)}`));
 * ```
 */
export class SecretScrubber {
  private readonly secrets = new Set<string>();

  /** 登记一个（或多个）秘密值。空串与过短的值忽略。 */
  track(...values: (string | null | undefined)[]): void {
    for (const v of values) {
      if (typeof v === 'string' && v.length >= MIN_TRACKABLE_LENGTH) this.secrets.add(v);
    }
  }

  /** 已登记的秘密数量（测试用来断言「确实登记上了」）。 */
  get size(): number {
    return this.secrets.size;
  }

  /** 清洗任意字符串：字面量替换 + 模式替换。 */
  scrub(text: string): string {
    return scrubSecrets(text, [...this.secrets]);
  }

  /** 清洗任意值并保证返回字符串（用于清洗未知形状的异常对象）。 */
  scrubError(e: unknown): string {
    if (e instanceof Error) return this.scrub(`${e.name}: ${e.message}`);
    if (typeof e === 'string') return this.scrub(e);
    try {
      return this.scrub(JSON.stringify(e));
    } catch {
      // 循环引用 / BigInt 之类无法序列化的值：退化成类型名，绝不把原文吐出来。
      return this.scrub(`[无法序列化的错误: ${typeof e}]`);
    }
  }
}
