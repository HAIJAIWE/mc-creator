import { describe, it, expect, vi } from 'vitest';
import { REDACTED, SecretScrubber, scrubSecrets } from './token-redact.js';

/**
 * §13.2「日志与遥测中过滤一切 token」的防线测试。
 *
 * 断言方式刻意保守：断言**输出里搜不到 token 片段**（而不是断言输出等于某个
 * 具体字符串）——这样将来加日志文案时不会因为格式微调而假失败。
 */

describe('scrubSecrets（模式过滤）', () => {
  it('过滤 JSON 形态的 access_token / refresh_token', () => {
    const out = scrubSecrets(
      '{"access_token":"M.R3_BAY.abcdefghijklmnopqrstuvwxyz0123456789","refresh_token":"MCR3_tok_ABCDEFGHIJKLMNOPQRSTUV"}',
    );
    expect(out).not.toContain('M.R3_BAY.abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out).not.toContain('MCR3_tok_ABCDEFGHIJKLMNOPQRSTUV');
    // 前缀保留 → 日志仍能看出「这里本来有个什么字段」
    expect(out).toContain('access_token');
    expect(out).toContain(REDACTED);
  });

  it('过滤 query string 形态的 token', () => {
    const out = scrubSecrets(
      'GET /callback?code=abc&access_token=SECRETVALUE0123456789ABCDEF&state=xyz',
    );
    expect(out).not.toContain('SECRETVALUE0123456789ABCDEF');
    expect(out).toContain('access_token');
  });

  it('过滤 Authorization 头（含 Bearer 与 XBL3.0 两种）', () => {
    const bearer = scrubSecrets('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig');
    expect(bearer).not.toContain('eyJhbGciOiJIUzI1NiJ9');

    const xbl = scrubSecrets('Authorization: XBL3.0 x=uhs-value-here;XSTS-TOKEN-VALUE-0123456789');
    expect(xbl).not.toContain('XSTS-TOKEN-VALUE-0123456789');
  });

  it('过滤裸 JWT', () => {
    const jwt = 'eyJhbGciOiJSUzI1NiIsImtpZCI6IngifQ.eyJzdWIiOiIxMjM0NSJ9.c2lnbmF0dXJl';
    expect(scrubSecrets(`收到 ${jwt} 完毕`)).not.toContain(jwt);
  });

  it('短值不误伤（避免把正常文本打成马赛克）', () => {
    // 3 字符的 code 不是 token：保留可读性比「一律打码」更重要。
    const out = scrubSecrets('code=abc&state=12345');
    expect(out).toContain('abc');
  });

  it('普通文本原样通过', () => {
    expect(scrubSecrets('版本 26.2 下载完成')).toBe('版本 26.2 下载完成');
  });

  it('已登记的秘密按字面量替换（覆盖非标准形状的 token）', () => {
    const out = scrubSecrets('token=Ab9!@#xyz 12345', ['Ab9!@#xyz 12345']);
    expect(out).not.toContain('Ab9!@#xyz');
  });
});

describe('SecretScrubber', () => {
  it('登记后能洗掉任意位置出现的秘密', () => {
    const s = new SecretScrubber();
    const secret = 'REALLY-LONG-OPAQUE-TOKEN-VALUE-0123456789';
    s.track(secret);
    expect(s.size).toBe(1);
    const text = `前缀 ${secret} 中间 ${secret} 后缀`;
    expect(s.scrub(text)).not.toContain(secret);
    expect(s.scrub(text)).toBe(`前缀 ${REDACTED} 中间 ${REDACTED} 后缀`);
  });

  it('track 忽略空值/null/过短值', () => {
    const s = new SecretScrubber();
    s.track('', null, undefined, 'ab');
    expect(s.size).toBe(0);
  });

  it('scrubError 清洗 Error 的 message', () => {
    const s = new SecretScrubber();
    const secret = 'ANOTHER-VERY-LONG-SECRET-1234567890';
    s.track(secret);
    const err = new Error(`请求失败，token=${secret}`);
    expect(s.scrubError(err)).not.toContain(secret);
  });

  it('scrubError 处理非 Error 值（含无法 JSON 序列化的）', () => {
    const s = new SecretScrubber();
    const circular: Record<string, unknown> = {};
    circular['self'] = circular;
    expect(s.scrubError('字符串错误')).toBe('字符串错误');
    expect(s.scrubError({ a: 1 })).toBe('{"a":1}');
    expect(s.scrubError(circular)).toContain('无法序列化');
  });

  it('scrubError 不会把 token 从 Error 里漏出去（§13.2 核心断言）', () => {
    const s = new SecretScrubber();
    const tokens = [
      'MS-ACCESS-TOKEN-aaaaaaaaaaaaaaaaaaaa',
      'MS-REFRESH-TOKEN-bbbbbbbbbbbbbbbbbbbb',
      'XBL-TOKEN-cccccccccccccccccccccccc',
      'XSTS-TOKEN-dddddddddddddddddddddddd',
      'MC-ACCESS-TOKEN-eeeeeeeeeeeeeeeeeeee',
    ];
    s.track(...tokens);
    const err = new Error(
      `链路失败 ${JSON.stringify({ xbl: tokens[2], xsts: tokens[3], mc: tokens[4] })}`,
    );
    const scrubbed = s.scrubError(err);
    for (const t of tokens) expect(scrubbed).not.toContain(t);
  });
});

describe('console 输出不含 token（真实调用点防护）', () => {
  it('scrubber 洗过的文本写到 console 后仍搜不到 token', () => {
    const s = new SecretScrubber();
    const token = 'CONSOLE-LEAK-CANARY-0123456789ABCDEF';
    s.track(token);
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    console.warn('[§5.8 账户] 登录失败', s.scrubError(new Error(`refresh_token=${token}`)));
    const output = spy.mock.calls.flat().join(' ');
    spy.mockRestore();
    expect(output).not.toContain(token);
    expect(output).toContain(REDACTED);
  });
});
