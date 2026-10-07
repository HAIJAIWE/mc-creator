/**
 * 数据包目录布局校验测试（§5.7）。
 *
 * 核心是「层级陷阱」：多套一层会让游戏**静默不加载**该包
 * （`/datapack list` 里不出现），用户看不出原因。本模块把检查提前到生成期。
 *
 * 断言锚在 §5.7 明文要求：根目录直接含 `pack.mcmeta` 与 `data/`，
 * `data/` 下再套一层才是命名空间。
 */
import { describe, expect, it } from 'vitest';
import {
  DATA_DIR,
  PACK_MCMETA_PATH,
  hasBlockingLayoutIssue,
  summarizeLayoutIssues,
  unsafePaths,
  validateDatapackLayout,
} from './datapack-layout.js';

const files = (...paths: string[]) => paths.map((path) => ({ path }));

/** 合法布局：根目录直接含 pack.mcmeta 与 data/<ns>/。 */
const VALID = files(
  PACK_MCMETA_PATH,
  `${DATA_DIR}my_pack/recipes/r.json`,
  `${DATA_DIR}my_pack/function/f.mcfunction`,
);

function codes(issues: readonly { code: string }[]): string[] {
  return issues.map((i) => i.code);
}

describe('合法布局通过', () => {
  it('根目录直接含 pack.mcmeta 与 data/<ns>/ → 无问题', () => {
    expect(validateDatapackLayout(VALID)).toEqual([]);
    expect(hasBlockingLayoutIssue(validateDatapackLayout(VALID))).toBe(false);
  });

  it('摘要给出肯定结论', () => {
    expect(summarizeLayoutIssues(validateDatapackLayout(VALID))).toContain('符合 §5.7');
  });

  it('多个命名空间并列合法（§5.7 未限制命名空间个数）', () => {
    const ok = files(PACK_MCMETA_PATH, `${DATA_DIR}a/x.json`, `${DATA_DIR}b-c.d/y.json`);
    expect(validateDatapackLayout(ok)).toEqual([]);
  });
});

describe('§5.7 层级陷阱：多套一层', () => {
  it('pack.mcmeta 在子目录 → EXTRA_ROOT_LAYER 且给出可执行修复提示', () => {
    const bad = files('MyPack/pack.mcmeta', 'MyPack/data/my_pack/recipes/r.json');
    const issues = validateDatapackLayout(bad);
    expect(codes(issues)).toContain('EXTRA_ROOT_LAYER');
    const e = issues.find((i) => i.code === 'EXTRA_ROOT_LAYER');
    // 必须说清「套了几层」和「怎么修」，不能只说「缺文件」
    expect(e?.message).toContain('MyPack/');
    expect(e?.message).toContain('§5.7');
    expect(e?.message).toContain('修复');
    expect(e?.message).toContain('去掉前缀');
  });

  it('data/ 在子目录 → EXTRA_ROOT_LAYER', () => {
    const bad = files(PACK_MCMETA_PATH, 'MyPack/data/my_pack/recipes/r.json');
    expect(codes(validateDatapackLayout(bad))).toContain('EXTRA_ROOT_LAYER');
  });

  it('套了两层也被识别（不只判一层）', () => {
    const bad = files('a/b/pack.mcmeta', 'a/b/data/ns/x.json');
    const issues = validateDatapackLayout(bad);
    expect(codes(issues)).toContain('EXTRA_ROOT_LAYER');
    expect(issues.find((i) => i.code === 'EXTRA_ROOT_LAYER')?.message).toContain('a/b/');
  });

  it('多层嵌套是阻断级（游戏不会加载）', () => {
    const bad = files('a/b/pack.mcmeta', 'a/b/data/ns/x.json');
    expect(hasBlockingLayoutIssue(validateDatapackLayout(bad))).toBe(true);
  });
});

describe('缺失必需文件', () => {
  it('既无 pack.mcmeta 也无 data/ → 两条 error 都给', () => {
    const issues = validateDatapackLayout(files('readme.txt'));
    expect(codes(issues)).toContain('MISSING_PACK_MCMETA');
    expect(codes(issues)).toContain('MISSING_DATA_DIR');
    expect(issues.filter((i) => i.level === 'error')).toHaveLength(2);
  });

  it('空包（只有 pack.mcmeta）→ NO_CONTENT 警告，不是层级 error', () => {
    const issues = validateDatapackLayout(files(PACK_MCMETA_PATH));
    const e = issues.find((i) => i.code === 'NO_CONTENT');
    expect(e?.level).toBe('warning');
    expect(hasBlockingLayoutIssue(issues)).toBe(false);
  });

  it('有 pack.mcmeta 但另有内容却无 data/ → MISSING_DATA_DIR（error）', () => {
    const issues = validateDatapackLayout(files(PACK_MCMETA_PATH, 'readme.txt'));
    expect(codes(issues)).toContain('MISSING_DATA_DIR');
    expect(issues.find((i) => i.code === 'MISSING_DATA_DIR')?.level).toBe('error');
  });

  it('有 data/ 无 pack.mcmeta → 只报 MISSING_PACK_MCMETA', () => {
    const issues = validateDatapackLayout(files(`${DATA_DIR}ns/x.json`));
    expect(codes(issues)).toEqual(['MISSING_PACK_MCMETA']);
  });
});

describe('命名空间层数与合法性（§5.7：data/ 下再套一层）', () => {
  it('data/ 直接放文件：若首段是合法命名空间则无法判少一层（本模块的已知边界）', () => {
    // 诚实记录一条**检测不到**的情况：`data/recipes/r.json` 与
    // 「data/recipes/ 为空命名空间」在路径层面完全相同，前者少套一层，
    // 两者都合法。本模块不假装能区分。
    const ambiguous = files(PACK_MCMETA_PATH, `${DATA_DIR}recipes/r.json`);
    expect(validateDatapackLayout(ambiguous)).toEqual([]);
  });

  it('data/ 直接放文件且首段明显不是命名空间 → 仍能判出', () => {
    // 首段含非法字符时可判（如大写 / 空格 / 冒号）。
    for (const seg of ['Recipes', 'my recipes', 'my:recipes']) {
      const bad = files(PACK_MCMETA_PATH, `${DATA_DIR}${seg}/r.json`);
      expect(codes(validateDatapackLayout(bad)), seg).toContain('INVALID_NAMESPACE');
    }
  });

  it('data/ns/extra/file（多一层）→ 仍是合法命名空间（更深层是内容目录）', () => {
    const ok = files(PACK_MCMETA_PATH, `${DATA_DIR}ns/recipes/sub/r.json`);
    expect(validateDatapackLayout(ok)).toEqual([]);
  });

  it('大写命名空间非法（资源位置不可用）', () => {
    const bad = files(PACK_MCMETA_PATH, `${DATA_DIR}MyPack/x.json`);
    const e = validateDatapackLayout(bad).find((i) => i.code === 'INVALID_NAMESPACE');
    expect(e?.message).toContain('小写');
  });

  it('含空格 / 冒号的命名空间非法', () => {
    for (const ns of ['my pack', 'my:pack']) {
      const bad = files(PACK_MCMETA_PATH, `${DATA_DIR}${ns}/x.json`);
      expect(codes(validateDatapackLayout(bad)), ns).toContain('INVALID_NAMESPACE');
    }
  });

  it('下划线 / 点 / 连字符的合法命名空间被接受', () => {
    for (const ns of ['my_pack', 'my.pack', 'my-pack', 'p1']) {
      const ok = files(PACK_MCMETA_PATH, `${DATA_DIR}${ns}/x.json`);
      expect(validateDatapackLayout(ok), ns).toEqual([]);
    }
  });

  it('data/ 空目录（无命名空间）→ 警告而非错误', () => {
    const issues = validateDatapackLayout(files(PACK_MCMETA_PATH, DATA_DIR));
    const e = issues.find((i) => i.code === 'NO_CONTENT');
    expect(e?.level).toBe('warning');
    expect(e?.message).toContain('不会被游戏加载');
    expect(hasBlockingLayoutIssue(issues)).toBe(false);
  });
});

describe('zip 卫生（§13.1 同源）', () => {
  it('绝对路径 / `..` 被拒', () => {
    const issues = unsafePaths([{ path: '/etc/passwd' }, { path: 'data/../../escape.json' }]);
    expect(codes(issues)).toEqual(['UNSAFE_PATH', 'UNSAFE_PATH']);
    expect(issues[0]?.message).toContain('绝对路径');
    expect(issues[1]?.message).toContain('路径穿越');
  });

  it('盘符路径被拒', () => {
    expect(codes(unsafePaths([{ path: 'C:/evil.json' }]))).toEqual(['UNSAFE_PATH']);
  });

  it('反斜杠被归一化后仍能正常判定（Windows 产物）', () => {
    const win = files('pack.mcmeta', 'data\\my_pack\\recipes\\r.json');
    expect(validateDatapackLayout(win)).toEqual([]);
  });

  it('`./` 前缀被归一化，不误判为层级陷阱', () => {
    const ok = files('./pack.mcmeta', './data/ns/x.json');
    expect(validateDatapackLayout(ok)).toEqual([]);
  });

  it('unsafePaths 与布局校验合并返回（不丢问题）', () => {
    const issues = validateDatapackLayout([{ path: 'data/../x.json' }]);
    expect(codes(issues)).toContain('UNSAFE_PATH');
  });
});

describe('摘要可读性（给 agent warning 用）', () => {
  it('多条问题一次给全，带 code 前缀', () => {
    const s = summarizeLayoutIssues(validateDatapackLayout(files('readme.txt')));
    expect(s).toContain('[MISSING_PACK_MCMETA]');
    expect(s).toContain('[MISSING_DATA_DIR]');
    expect(s).toContain('；');
  });
});
