import { describe, it, expect } from 'vitest';
import {
  QUALIFIER_ORDER,
  compareParsedVersions,
  compareVersions,
  compareVersionsSafe,
  isComparableVersion,
  isNewerVersion,
  parseMavenVersion,
} from './version.js';

describe('parseMavenVersion', () => {
  it('可比较版本解析出 items', () => {
    const p = parseMavenVersion('1.20.1');
    expect(p).not.toBeNull();
    expect(p?.raw).toBe('1.20.1');
  });
  it('剥离前导 v 并转小写', () => {
    expect(parseMavenVersion('v1.2.3')?.raw).toBe('1.2.3');
    expect(parseMavenVersion('V1.2.3')?.raw).toBe('1.2.3');
    expect(parseMavenVersion('1.0-ALPHA')?.raw).toBe('1.0-alpha');
  });
  it('非 v 开头的字母前缀不剥离（Modrinth base62 版本 ID 保持原样）', () => {
    // 'vfoo' 不是 v+数字，不剥离；且不含数字 → 判为不可比较
    expect(parseMavenVersion('vfoo')).toBeNull();
    expect(isComparableVersion('AANobbMI')).toBe(false);
    expect(isComparableVersion('Latest')).toBe(false);
    expect(isComparableVersion('Beta')).toBe(false);
  });
  it('畸形输入返回 null 而不抛异常', () => {
    for (const bad of [
      '',
      '   ',
      '.',
      '...',
      '--',
      '!!!',
      'a b',
      '@@@',
      '\u0000',
      '1.0 2.0',
      '[1.0]',
      '1,0',
    ]) {
      expect(parseMavenVersion(bad), `应判为畸形：${JSON.stringify(bad)}`).toBeNull();
    }
  });
  it('非字符串输入也不抛异常', () => {
    // @ts-expect-error 故意传非字符串验证不抛错
    expect(parseMavenVersion(undefined)).toBeNull();
    // @ts-expect-error 故意传非字符串验证不抛错
    expect(parseMavenVersion(123)).toBeNull();
    // @ts-expect-error 故意传非字符串验证不抛错
    expect(parseMavenVersion(null)).toBeNull();
  });
  it('尾部多余的 . 与 - 被裁剪（与 Maven 一致）', () => {
    expect(compareVersions('1.0.', '1.0')).toBe(0);
    expect(compareVersions('1.0-', '1.0')).toBe(0);
  });
});

describe('compareVersions · 数字段逐段比较', () => {
  it('1.10 > 1.9（localeCompare 会判反，本条即缺陷 2 的回归防线）', () => {
    expect('1.10'.localeCompare('1.9')).toBeLessThan(0); // 反例：字符串序是错的
    expect(compareVersions('1.10', '1.9')).toBe(1);
    expect(compareVersions('1.9', '1.10')).toBe(-1);
  });
  it('多段数字：1.21.11 > 1.21.5 > 1.20.6', () => {
    expect(compareVersions('1.21.11', '1.21.5')).toBe(1);
    expect(compareVersions('1.21.5', '1.20.6')).toBe(1);
    expect(compareVersions('1.20.6', '1.21.5')).toBe(-1);
  });
  it('前导零按数值忽略：1.01 == 1.1', () => {
    expect(compareVersions('1.01', '1.1')).toBe(0);
    expect(compareVersions('1.0.01', '1.0.1')).toBe(0);
    // Maven 语义：每段是独立的整数，前导零会改变段值本身
    // （"0010" → 10 而非 10.0，故 1.0010 > 1.01）。这是 Maven/Gradle 的既有行为，
    // 必须照搬才能与 Forge 判定一致。
    expect(compareVersions('1.0010', '1.01')).toBe(1);
  });
  it('超长数字段不溢出（不依赖 BigInt）', () => {
    // 同位长比较：23 位全 9 > 23 位 1 开头
    expect(compareVersions('1.99999999999999999999999', '1.10000000000000000000000')).toBe(1);
    // 位长不同也能正确比较（24 位 > 23 位）
    expect(compareVersions('1.100000000000000000000000', '1.99999999999999999999999')).toBe(1);
  });
  it('前导 v 归一后可比较', () => {
    expect(compareVersions('v1.2.3', '1.2.3')).toBe(0);
    expect(compareVersions('v1.10.0', 'v1.9.0')).toBe(1);
  });
});

describe('compareVersions · 缺失段判定', () => {
  it('1.0 与 1.0.0 判定为相等（尾部 0 被裁剪，与 Maven 一致）', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.0', '1.0')).toBe(0);
    expect(compareVersions('1.0.0.0', '1.0')).toBe(0);
  });
  it('缺失段视为 0 而非"更小"：1.0.1 > 1.0', () => {
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
  });
  it('该判定让 Forge 的 [21.1,) 同时接受 21.1 与 21.1.0', () => {
    const pa = parseMavenVersion('21.1');
    const pb = parseMavenVersion('21.1.0');
    expect(pa && pb && compareParsedVersions(pa, pb)).toBe(0);
  });
});

describe('compareVersions · 预发布 / 后缀', () => {
  it('1.0-alpha < 1.0', () => {
    expect(compareVersions('1.0-alpha', '1.0')).toBe(-1);
    expect(compareVersions('1.0', '1.0-alpha')).toBe(1);
  });
  it('1.0-rc1 < 1.0', () => {
    expect(compareVersions('1.0-rc1', '1.0')).toBe(-1);
  });
  it('1.0-alpha1 < 1.0-alpha2', () => {
    expect(compareVersions('1.0-alpha1', '1.0-alpha2')).toBe(-1);
    expect(compareVersions('1.0-alpha2', '1.0-alpha1')).toBe(1);
    expect(compareVersions('1.0-alpha1', '1.0-alpha1')).toBe(0);
  });
  it('1.0-alpha < 1.0-rc1', () => {
    expect(compareVersions('1.0-alpha', '1.0-rc1')).toBe(-1);
  });
  it('1.0-rc1 < 1.0-rc2', () => {
    expect(compareVersions('1.0-rc1', '1.0-rc2')).toBe(-1);
  });
  it('大写 qualifier 与 hyphen 两种写法等价', () => {
    expect(compareVersions('1.0-RC1', '1.0-rc1')).toBe(0);
    expect(compareVersions('1.0-Beta-2', '1.0-beta-2')).toBe(0);
  });
  it('Maven 历史别名 ga/final/release/cr 归一到 release/rc', () => {
    // ⚠️ 这里有意偏离 Maven：官方 ComparableVersion 会判 `1.0-ga` **新于** `1.0`
    // （可比较键 "5-" vs "5" 的字典序副作用）。我们把空 qualifier 当 null 裁掉。
    expect(compareVersions('1.0-ga', '1.0')).toBe(0);
    expect(compareVersions('1.0-final', '1.0')).toBe(0);
    expect(compareVersions('1.0-release', '1.0')).toBe(0);
    expect(compareVersions('1.0', '1.0-ga')).toBe(0);
    expect(compareVersions('1.0-cr1', '1.0-rc1')).toBe(0);
  });
});

describe('compareVersions · qualifier 规范序（Maven 传统序）', () => {
  it('QUALIFIER_ORDER 顺序即文档承诺的序', () => {
    expect([...QUALIFIER_ORDER]).toEqual([
      'alpha',
      'beta',
      'milestone',
      'rc',
      'snapshot',
      '',
      'sp',
    ]);
  });
  it('alpha < beta < milestone < rc < snapshot < release < sp 逐对成立', () => {
    const ordered = [
      '1.0-alpha',
      '1.0-beta',
      '1.0-milestone',
      '1.0-rc',
      '1.0-snapshot',
      '1.0',
      '1.0-sp',
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      const a = ordered[i] as string;
      const b = ordered[i + 1] as string;
      expect(compareVersions(a, b), `${a} 应小于 ${b}`).toBe(-1);
    }
  });
  it('未知 qualifier 排在所有已知 qualifier 之后（Maven 行为）', () => {
    expect(compareVersions('1.0-sp', '1.0-foo')).toBe(-1);
    expect(compareVersions('1.0-foo', '1.0-alpha')).toBe(1);
  });
  it('sp1 > sp（服务包号参与比较）', () => {
    expect(compareVersions('1.0-sp1', '1.0-sp')).toBe(1);
  });
  it('release 之后才是 sp（与直觉相反但必须照搬 Maven）', () => {
    expect(compareVersions('1.0-sp', '1.0')).toBe(1);
    expect(compareVersions('1.0', '1.0-snapshot')).toBe(1);
  });
});

describe('compareVersions · 真实生态版本串（交叉验证）', () => {
  it('Fabric API 的 +MC tag 参与排序（semver 会忽略它）', () => {
    expect(compareVersions('0.92.11+1.21', '0.92.11+1.20.1')).toBe(1);
    expect(compareVersions('0.92.11+1.20.1', '0.92.11+1.19.4')).toBe(1);
    expect(compareVersions('0.92.11', '0.92.11+1.20.1')).toBe(-1);
    expect(compareVersions('0.92.11+1.20.1', '0.92.11+1.20.1')).toBe(0);
  });
  it('Quilt API 的多 tag 版本', () => {
    expect(compareVersions('7.7.0+0.92.2-1.20.1', '7.7.0+0.92.1-1.19.4')).toBe(1);
    expect(compareVersions('7.7.0', '7.7.0+0.92.2-1.20.1')).toBe(-1);
  });
  it('Gradle SNAPSHOT 在正式版之前', () => {
    expect(compareVersions('1.7-SNAPSHOT', '1.7')).toBe(-1);
    expect(compareVersions('1.10-SNAPSHOT', '1.7')).toBe(1);
  });
  it('NeoForge 年度 beta 版本', () => {
    expect(compareVersions('26.2.0.41-beta', '26.2.0.41')).toBe(-1);
    expect(compareVersions('26.1.2.94', '26.2.0.41-beta')).toBe(-1);
    expect(compareVersions('21.11.42', '20.6.139')).toBe(1);
  });
  it('Fabric API 的 alpha.3 形如 11.0.0-alpha.3+0.102.0-1.21', () => {
    expect(compareVersions('11.0.0-alpha.3+0.102.0-1.21', '10.0.0')).toBe(1);
    expect(compareVersions('11.0.0-alpha.3+0.102.0-1.21', '11.0.0')).toBe(-1);
  });
});

describe('compareVersions · 无法比较时不抛异常', () => {
  it('任一侧畸形即返回 null（不抛）', () => {
    expect(compareVersions('garbage', '1.0')).toBeNull();
    expect(compareVersions('1.0', 'garbage')).toBeNull();
    expect(compareVersions('AANobbMI', '1.0')).toBeNull();
    expect(compareVersions('Latest', '1.0')).toBeNull();
    expect(compareVersions('', '1.0')).toBeNull();
  });
  it('畸形输入不抛未捕获异常', () => {
    for (const bad of ['...', '--', '!!!', '\u0000', '', ' ', '1.0 2.0']) {
      expect(() => compareVersions(bad, '1.0')).not.toThrow();
      expect(() => compareVersions('1.0', bad)).not.toThrow();
    }
  });
});

describe('compareVersionsSafe / isNewerVersion', () => {
  it('可比较时给出真实版本序', () => {
    expect(compareVersionsSafe('1.10', '1.9')).toBe(1);
    expect(compareVersionsSafe('1.9', '1.10')).toBe(-1);
  });
  it('不可比较时退化为 localeCompare 且不抛', () => {
    const r = compareVersionsSafe('AANobbMI', 'zzzzz');
    expect(typeof r).toBe('number');
  });
  it('排序稳定性：1.9 1.10 1.2 的正确序', () => {
    const sorted = ['1.9', '1.10', '1.2'].sort(compareVersionsSafe);
    expect(sorted).toEqual(['1.2', '1.9', '1.10']);
  });
  it('isNewerVersion 不可比较时返回 false', () => {
    expect(isNewerVersion('1.1', '1.0')).toBe(true);
    expect(isNewerVersion('1.0', '1.1')).toBe(false);
    expect(isNewerVersion('garbage', '1.0')).toBe(false);
  });
});
