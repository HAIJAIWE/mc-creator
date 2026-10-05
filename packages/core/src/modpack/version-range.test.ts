import { describe, it, expect } from 'vitest';
import { parseMavenVersion } from './version.js';
import {
  checkVersionRange,
  intersectIntervals,
  intersectRangeLists,
  intersectRanges,
  parseVersionRange,
  rangeSatisfiesVersion,
  satisfiesRange,
  unionRanges,
} from './version-range.js';

describe('Maven range 语法 · 每种形式各至少一条', () => {
  it('[1.0,2.0) 左闭右开', () => {
    expect(satisfiesRange('1.0', '[1.0,2.0)')).toBe(true);
    expect(satisfiesRange('1.9.9', '[1.0,2.0)')).toBe(true);
    expect(satisfiesRange('2.0', '[1.0,2.0)')).toBe(false);
    expect(satisfiesRange('0.9.9', '[1.0,2.0)')).toBe(false);
  });

  it('[1.0,2.0] 双闭', () => {
    expect(satisfiesRange('1.0', '[1.0,2.0]')).toBe(true);
    expect(satisfiesRange('2.0', '[1.0,2.0]')).toBe(true);
    expect(satisfiesRange('2.0.1', '[1.0,2.0]')).toBe(false);
  });

  it('[1.0] 精确（且 1.0 与 1.0.0 等价）', () => {
    expect(satisfiesRange('1.0', '[1.0]')).toBe(true);
    expect(satisfiesRange('1.0.0', '[1.0]')).toBe(true);
    expect(satisfiesRange('1.0.1', '[1.0]')).toBe(false);
    expect(satisfiesRange('0.9', '[1.0]')).toBe(false);
  });

  it('(,1.0] 无下界', () => {
    expect(satisfiesRange('0.1', '(,1.0]')).toBe(true);
    expect(satisfiesRange('1.0', '(,1.0]')).toBe(true);
    expect(satisfiesRange('1.0.1', '(,1.0]')).toBe(false);
    expect(satisfiesRange('0.1', '[,1.0]')).toBe(true);
  });

  it('[1.0,) 无上界', () => {
    expect(satisfiesRange('1.0', '[1.0,)')).toBe(true);
    expect(satisfiesRange('999.0', '[1.0,)')).toBe(true);
    expect(satisfiesRange('0.9', '[1.0,)')).toBe(false);
    expect(satisfiesRange('999.0', '[1.0,]')).toBe(true);
  });

  it('[,] / (,) 无界区间接受任意版本', () => {
    expect(satisfiesRange('0.0.1', '[,]')).toBe(true);
    expect(satisfiesRange('999.0.0', '(,)')).toBe(true);
  });

  it('[1.0,2.0),[3.0,4.0) 多区间并集（逗号 = OR）', () => {
    expect(satisfiesRange('1.5', '[1.0,2.0),[3.0,4.0)')).toBe(true);
    expect(satisfiesRange('3.5', '[1.0,2.0),[3.0,4.0)')).toBe(true);
    expect(satisfiesRange('4.0', '[1.0,2.0),[3.0,4.0)')).toBe(false);
    expect(satisfiesRange('2.5', '[1.0,2.0),[3.0,4.0)')).toBe(false);
  });

  it('intersectRanges([1.0,2.0), [1.5,)) 得交集 [1.5,2.0)', () => {
    const r = intersectRanges('[1.0,2.0)', '[1.5,)');
    expect(r).not.toBeNull();
    expect(r!.raw).toContain('∩');
    expect(r!.intervals).toHaveLength(1);
    // 用解析结果直接判定（raw 是 "a ∩ b" 的展示串，不是可再解析的 range 语法）
    expect(rangeSatisfiesVersion(r!, parseMavenVersion('1.7')!)).toBe(true);
    expect(rangeSatisfiesVersion(r!, parseMavenVersion('1.4')!)).toBe(false);
    expect(rangeSatisfiesVersion(r!, parseMavenVersion('2.0')!)).toBe(false);
  });

  it('交集为空（互斥区间）产出 0 区间，任何版本都不满足', () => {
    const r = intersectRanges('[1.0,2.0)', '[3.0,4.0)');
    expect(r).not.toBeNull();
    expect(r!.intervals).toHaveLength(0);
    expect(rangeSatisfiesVersion(r!, parseMavenVersion('1.5')!)).toBe(false);
  });

  it('空白分隔 = 交集（fabric.mod.json 的 semver AND 语义）', () => {
    expect(satisfiesRange('1.20.5', '>=1.20.1 <1.21')).toBe(true);
    expect(satisfiesRange('1.21.0', '>=1.20.1 <1.21')).toBe(false);
    expect(satisfiesRange('1.19.4', '>=1.20.1 <1.21')).toBe(false);
  });

  it('交集只在交集处满足：>=1.0 <3.0 且 >=2.0 => 仅 [2.0,3.0)', () => {
    expect(satisfiesRange('1.5', '>=1.0 <3.0 >=2.0')).toBe(false);
    expect(satisfiesRange('2.5', '>=1.0 <3.0 >=2.0')).toBe(true);
  });

  it('unionRanges 显式并集入口', () => {
    const r = unionRanges('[1.0,1.5]', '[2.0,2.5]');
    expect(r).not.toBeNull();
    expect(r!.intervals).toHaveLength(2);
    expect(rangeSatisfiesVersion(r!, parseMavenVersion('1.2')!)).toBe(true);
    expect(rangeSatisfiesVersion(r!, parseMavenVersion('2.2')!)).toBe(true);
    expect(rangeSatisfiesVersion(r!, parseMavenVersion('1.8')!)).toBe(false);
  });

  it('intersectIntervals / intersectRangeLists 底层入口', () => {
    const a = parseVersionRange('[1.0,2.0]');
    const b = parseVersionRange('[0.5,1.0]');
    expect(a && b).toBeTruthy();
    const ov = intersectIntervals(a!.intervals[0]!, b!.intervals[0]!);
    expect(ov).not.toBeNull();
    expect(ov!.lower?.raw).toBe('1.0');
    expect(ov!.lowerInclusive).toBe(true);
    const none = intersectRangeLists(a!.intervals, [
      { lowerInclusive: true, upperInclusive: true },
    ]);
    // [1.0,2.0] ∩ 无界 = [1.0,2.0]
    expect(none).toHaveLength(1);
  });
});

describe('软性 requirement（裸版本号 = 推荐，不做强约束）', () => {
  it('裸版本号 strict=false', () => {
    expect(parseVersionRange('1.0')?.strict).toBe(false);
    expect(parseVersionRange('1.0')?.intervals).toHaveLength(1);
  });
  it('裸版本号语义为 >= 该版本：更新版本也算满足', () => {
    expect(satisfiesRange('2.0', '1.0')).toBe(true);
    expect(satisfiesRange('1.0.1', '1.0')).toBe(true);
    expect(satisfiesRange('0.9', '1.0')).toBe(false);
  });
  it('软性违规被 checkVersionRange 标为 strict=false + 不阻断措辞', () => {
    const c = checkVersionRange('0.5', '1.0');
    expect(c.status).toBe('violated');
    expect(c.strict).toBe(false);
    expect(c.reason).toContain('软性约束');
  });
  it('带括号/比较符即 hard（strict=true）', () => {
    expect(parseVersionRange('[1.0,)')?.strict).toBe(true);
    expect(parseVersionRange('>=1.0')?.strict).toBe(true);
    expect(parseVersionRange('[1.0]')?.strict).toBe(true);
    expect(parseVersionRange('[1.0],')?.strict).toBeUndefined(); // 尾逗号 → 畸形
  });
});

describe('开放上界扩展 1.0+ 与 [1.0,2.0+)', () => {
  it('1.0+ → >=1.0 且无上界，显式声明故为 hard', () => {
    expect(satisfiesRange('1.0', '1.0+')).toBe(true);
    expect(satisfiesRange('999', '1.0+')).toBe(true);
    expect(satisfiesRange('0.9', '1.0+')).toBe(false);
    expect(parseVersionRange('1.0+')?.strict).toBe(true);
  });
  it('[1.0,2.0+) 上界开放', () => {
    expect(satisfiesRange('1.5', '[1.0,2.0+)')).toBe(true);
    expect(satisfiesRange('99', '[1.0,2.0+)')).toBe(true);
    expect(satisfiesRange('0.5', '[1.0,2.0+)')).toBe(false);
  });
  it('下界出现 + 视为畸形（Maven 无此语义）', () => {
    expect(parseVersionRange('[1.0+,2.0)')).toBeNull();
  });
});

describe('比较符 / 通配 / 波浪 / 插入符（fabric.mod.json 实际用法）', () => {
  it('>= / > / <= / <', () => {
    expect(satisfiesRange('0.16.9', '>=0.16.0')).toBe(true);
    expect(satisfiesRange('0.15.9', '>=0.16.0')).toBe(false);
    expect(satisfiesRange('0.16.0', '>0.16.0')).toBe(false);
    expect(satisfiesRange('1.21', '<=1.21')).toBe(true);
    expect(satisfiesRange('1.22', '<=1.21')).toBe(false);
    expect(satisfiesRange('1.21', '<1.21')).toBe(false);
    expect(satisfiesRange('1.20.6', '<1.21')).toBe(true);
  });
  it('= / == 精确', () => {
    expect(satisfiesRange('1.0', '=1.0')).toBe(true);
    expect(satisfiesRange('1.0.1', '==1.0')).toBe(false);
  });
  it('~ 版本区间：~1 / ~1.2 / ~1.2.3', () => {
    expect(satisfiesRange('1.5', '~1')).toBe(true);
    expect(satisfiesRange('2.0', '~1')).toBe(false);
    expect(satisfiesRange('1.2.9', '~1.2')).toBe(true);
    expect(satisfiesRange('1.3', '~1.2')).toBe(false);
    expect(satisfiesRange('1.2.9', '~1.2.3')).toBe(true);
    expect(satisfiesRange('1.3.0', '~1.2.3')).toBe(false);
  });
  it('^ 版本区间：^1 / ^0.2.3 / ^0.0.3', () => {
    expect(satisfiesRange('1.9.0', '^1.2.3')).toBe(true);
    expect(satisfiesRange('2.0.0', '^1.2.3')).toBe(false);
    expect(satisfiesRange('0.2.9', '^0.2.3')).toBe(true);
    expect(satisfiesRange('0.3.0', '^0.2.3')).toBe(false);
    expect(satisfiesRange('0.0.3', '^0.0.3')).toBe(true);
    expect(satisfiesRange('0.0.4', '^0.0.3')).toBe(false);
  });
  it('通配：* / x / 1.20.x / 1.X', () => {
    expect(satisfiesRange('99.0', '*')).toBe(true);
    expect(satisfiesRange('99.0', 'x')).toBe(true);
    expect(satisfiesRange('1.20.5', '1.20.x')).toBe(true);
    expect(satisfiesRange('1.21.0', '1.20.x')).toBe(false);
    expect(satisfiesRange('1.9.9', '1.X')).toBe(true);
    expect(satisfiesRange('2.0', '1.X')).toBe(false);
  });
});

describe('畸形 range：不抛异常且有明确行为', () => {
  const malformed: Array<[string, string]> = [
    ['[1.0,2.0', '缺右括号'],
    [']', '孤立右括号'],
    ['[', '孤立左括号'],
    ['(1.0)', 'Maven 明确拒绝的开区间单值'],
    ['[1.0,2.0,3.0]', '三段'],
    ['[1.0+]', '+ 只在上界'],
    ['(,1.0', '缺右括号的无下界'],
    ['>=', '比较符后无版本'],
    ['~', '波浪符后无版本'],
    ['^', '插入符后无版本'],
    ['', '空串'],
    ['   ', '纯空白'],
    ['[1,0]', '千分位逗号'],
  ];
  for (const [spec, why] of malformed) {
    it(`parseVersionRange(${JSON.stringify(spec)}) → null（${why}）`, () => {
      expect(() => parseVersionRange(spec)).not.toThrow();
      expect(parseVersionRange(spec)).toBeNull();
    });
    it(`satisfiesRange 对 ${JSON.stringify(spec)} 返回 false 且不抛`, () => {
      expect(() => satisfiesRange('1.0', spec)).not.toThrow();
      expect(satisfiesRange('1.0', spec)).toBe(false);
    });
    it(`checkVersionRange 对 ${JSON.stringify(spec)} 返回 unknown`, () => {
      const c = checkVersionRange('1.0', spec);
      expect(c.status).toBe('unknown');
      expect(c.strict).toBe(false);
      expect(c.reason).toContain('无法解析');
    });
  }
  it('非字符串 spec 不抛', () => {
    // @ts-expect-error 故意传非字符串
    expect(parseVersionRange(undefined)).toBeNull();
    // @ts-expect-error 故意传非字符串
    expect(() => checkVersionRange('1.0', 42)).not.toThrow();
    // @ts-expect-error 故意传非字符串
    expect(satisfiesRange('1.0', {})).toBe(false);
  });
  it('版本畸形（spec 合法）→ unknown 而非 violated', () => {
    const c = checkVersionRange('AANobbMI', '[1.0,2.0)');
    expect(c.status).toBe('unknown');
    expect(c.reason).toContain('无法解析');
    // satisfiesRange 保守返回 false（不谎称满足）
    expect(satisfiesRange('AANobbMI', '[1.0,2.0)')).toBe(false);
  });
  it('交集/并集入口对畸形输入返回 null', () => {
    expect(intersectRanges('[1.0,2.0', '[1.0,2.0]')).toBeNull();
    expect(unionRanges('[1.0,2.0]', '[oops')).toBeNull();
  });
});

describe('交叉验证：真实 mods.toml / fabric.mod.json 里的串', () => {
  it('[1.20.1,1.21) —— 生成端 forge-gradle.ts 写出的字面量', () => {
    expect(satisfiesRange('1.20.1', '[1.20.1,1.21)')).toBe(true);
    expect(satisfiesRange('1.20.6', '[1.20.1,1.21)')).toBe(true);
    expect(satisfiesRange('1.21', '[1.20.1,1.21)')).toBe(false);
    expect(satisfiesRange('1.20', '[1.20.1,1.21)')).toBe(false);
  });
  it('[20.1,) —— shared/loader.ts 的 neoforgeVersionRange', () => {
    expect(satisfiesRange('20.1.110', '[20.1,)')).toBe(true);
    expect(satisfiesRange('20.1', '[20.1,)')).toBe(true);
    expect(satisfiesRange('19.4', '[20.1,)')).toBe(false);
  });
  it('[21.1,) —— NeoForge 版本下界', () => {
    expect(satisfiesRange('21.1.1', '[21.1,)')).toBe(true);
    expect(satisfiesRange('21.11.42', '[21.1,)')).toBe(true);
    expect(satisfiesRange('20.6.139', '[21.1,)')).toBe(false);
  });
  it('[47,) / [4,) —— forgeLoaderVersionRange / neoforgeLoaderVersionRange', () => {
    expect(satisfiesRange('47.4.23', '[47,)')).toBe(true);
    expect(satisfiesRange('46.2', '[47,)')).toBe(false);
    expect(satisfiesRange('4.0', '[4,)')).toBe(true);
    expect(satisfiesRange('3.0', '[4,)')).toBe(false);
  });
  it('>=0.16.0 —— shared/loader.ts 的 fabricLoaderMinVersion', () => {
    expect(satisfiesRange('0.16.9', '>=0.16.0')).toBe(true);
    expect(satisfiesRange('0.19.3', '>=0.16.0')).toBe(true);
    expect(satisfiesRange('0.14.0', '>=0.16.0')).toBe(false);
  });
  it('1.20.1-rc1 是 1.20.1 的预发布，故不在 [1.20.1,1.21) 内（Maven 正确行为）', () => {
    expect(satisfiesRange('1.20.1-rc1', '[1.20.1,1.21)')).toBe(false);
    expect(satisfiesRange('1.20.1', '[1.20.1,1.21)')).toBe(true);
    expect(satisfiesRange('1.20.1-rc1', '[1.20,1.21)')).toBe(true);
  });
  it('26.2.0.41-beta 落在 [26.1,) 内', () => {
    expect(satisfiesRange('26.2.0.41-beta', '[26.1,)')).toBe(true);
    expect(satisfiesRange('20.1.110', '[26.1,)')).toBe(false);
  });
});

describe('checkVersionRange 三态与 reason', () => {
  it('satisfied', () => {
    const c = checkVersionRange('1.20.5', '[1.20.1,1.21)');
    expect(c.status).toBe('satisfied');
    expect(c.strict).toBe(true);
    expect(c.raw).toBe('[1.20.1,1.21)');
    expect(c.reason).toContain('满足');
  });
  it('violated（hard）', () => {
    const c = checkVersionRange('1.21', '[1.20.1,1.21)');
    expect(c.status).toBe('violated');
    expect(c.strict).toBe(true);
    expect(c.reason).toContain('不满足');
  });
});
