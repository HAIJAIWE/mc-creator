/**
 * 光影组合校验测试（§5.6）。
 *
 * 判据锚在 Iris 官方文档（Iris / OptiFine / Oculus 三个加载器、
 * `begin` 与 `shadowcomp` 是 Iris-only、GLSL 120/150/330 三档）。
 */
import { describe, expect, it } from 'vitest';
import {
  GLSL_VERSIONS,
  IRIS_ONLY_PROGRAMS,
  LEGACY_PROGRAMS,
  SHADER_LOADERS,
  SHADER_PROGRAMS,
  checkShaderSetup,
  detectShaderLoaders,
  glslVersionForMcVersion,
  hasBlockingShaderIssue,
  hasSodium,
  summarizeShaderSetup,
  type ShaderSetupIssue,
} from './shader-compat.js';

const mods = (...ids: string[]) => ids.map((id) => ({ id }));

function codes(issues: readonly ShaderSetupIssue[]): string[] {
  return issues.map((i) => i.code);
}

describe('加载器识别（Iris 官方前置条件：Iris / OptiFine / Oculus）', () => {
  it('三者都被识别，大小写不敏感', () => {
    expect([...SHADER_LOADERS]).toEqual(['iris', 'optifine', 'oculus']);
    expect(detectShaderLoaders(mods('Iris'))).toEqual(['iris']);
    expect(detectShaderLoaders(mods('OPTIFINE'))).toEqual(['optifine']);
    expect(detectShaderLoaders(mods('Oculus'))).toEqual(['oculus']);
  });

  it('非加载器 mod 不被误判', () => {
    expect(detectShaderLoaders(mods('sodium', 'lithium', 'iris_api'))).toEqual([]);
    // 'iris_api' 不是 'iris' —— 不能用 startsWith 之类的宽松匹配
    expect(detectShaderLoaders(mods('iris_api'))).toEqual([]);
  });

  it('多个加载器同时在场时全部返回', () => {
    expect(detectShaderLoaders(mods('iris', 'optifine'))).toEqual(['iris', 'optifine']);
  });

  it('Sodium 识别（§5.6 的 Iris + Sodium 组合）', () => {
    expect(hasSodium(mods('sodium'))).toBe(true);
    expect(hasSodium(mods('SODIUM'))).toBe(true);
    expect(hasSodium(mods('iris'))).toBe(false);
  });
});

describe('判据 1：有光影包必须有加载器（静默失效的最常见原因）', () => {
  it('装了光影包但无加载器 → error，且给出修复提示', () => {
    const issues = checkShaderSetup([{ name: 'SEUS PTGI' }], mods('sodium'));
    expect(codes(issues)).toEqual(['NO_LOADER']);
    const e = issues[0]!;
    expect(e.level).toBe('error');
    expect(e.message).toContain('不会生效');
    expect(e.message).toContain('没有任何报错');
    expect(e.message).toContain('修复');
    expect(e.subject).toBe('SEUS PTGI');
    expect(hasBlockingShaderIssue(issues)).toBe(true);
  });

  it('列表里多个光影包时一次报全名', () => {
    const e = checkShaderSetup([{ name: 'A' }, { name: 'B' }], mods())[0]!;
    expect(e.subject).toBe('A, B');
  });

  it('三个加载器任一在场即通过判据 1', () => {
    for (const loader of SHADER_LOADERS) {
      const issues = checkShaderSetup([{ name: 'P' }], mods(loader));
      expect(codes(issues), loader).not.toContain('NO_LOADER');
    }
  });

  it('无光影包时不管有没有加载器都不报 NO_LOADER', () => {
    expect(checkShaderSetup([], mods())).toEqual([]);
  });
});

describe('判据 2：Iris-only 程序需要 Iris 系加载器', () => {
  it('begin / shadowcomp 是 Iris-only（与官方 Programs 侧栏一致）', () => {
    expect([...IRIS_ONLY_PROGRAMS]).toEqual(['begin', 'shadowcomp']);
    expect([...LEGACY_PROGRAMS]).toEqual(['RENDERTARGETS', 'DRAWBUFFERS']);
    expect([...SHADER_PROGRAMS]).toContain('composite');
  });

  it('用 Iris-only 程序 + 只有 OptiFine → error 并提示改用 Iris', () => {
    const issues = checkShaderSetup(
      [{ name: 'CICADA', usesIrisOnlyPrograms: true }],
      mods('optifine'),
    );
    expect(codes(issues)).toContain('IRIS_ONLY_PROGRAM_WITHOUT_IRIS');
    const e = issues.find((i) => i.code === 'IRIS_ONLY_PROGRAM_WITHOUT_IRIS')!;
    expect(e.message).toContain('begin');
    expect(e.message).toContain('shadowcomp');
    expect(e.message).toContain('修复');
  });

  it('Iris 在场 → 不报', () => {
    const issues = checkShaderSetup(
      [{ name: 'CICADA', usesIrisOnlyPrograms: true }],
      mods('iris', 'sodium'),
    );
    expect(codes(issues)).not.toContain('IRIS_ONLY_PROGRAM_WITHOUT_IRIS');
  });

  it('Oculus 也算 Iris 系（Iris 的分支）→ 不报', () => {
    const issues = checkShaderSetup([{ name: 'P', usesIrisOnlyPrograms: true }], mods('oculus'));
    expect(codes(issues)).not.toContain('IRIS_ONLY_PROGRAM_WITHOUT_IRIS');
  });

  it('无加载器时不重复报 Iris-only（判据 1 已覆盖，且信息更可执行）', () => {
    const issues = checkShaderSetup([{ name: 'P', usesIrisOnlyPrograms: true }], mods());
    expect(codes(issues)).toEqual(['NO_LOADER']);
  });

  it('未声明 usesIrisOnlyPrograms → 不报（不给默认值也不猜）', () => {
    expect(checkShaderSetup([{ name: 'P' }], mods('optifine'))).toEqual([]);
  });
});

describe('判据 3：GLSL 版本与目标 MC 版本', () => {
  it('MC 版本 → GLSL：1.17 起 150，更早 120', () => {
    expect(glslVersionForMcVersion('1.16.5')).toBe(GLSL_VERSIONS.legacy);
    expect(glslVersionForMcVersion('1.17')).toBe(GLSL_VERSIONS.mc117);
    expect(glslVersionForMcVersion('1.21.1')).toBe(GLSL_VERSIONS.mc117);
    expect(glslVersionForMcVersion('26.1')).toBe(GLSL_VERSIONS.mc117);
    expect(glslVersionForMcVersion('1.20.1')).toBe(150);
  });

  it('无法解析的版本返回 undefined（不猜）', () => {
    expect(glslVersionForMcVersion('snapshot')).toBeUndefined();
    expect(glslVersionForMcVersion('')).toBeUndefined();
  });

  it('声明的比目标新 → error（GLSL_TOO_NEW）', () => {
    const issues = checkShaderSetup(
      [{ name: 'P', glslVersion: 330, targetMcVersion: '1.16.5' }],
      mods('iris'),
    );
    expect(codes(issues)).toContain('GLSL_TOO_NEW');
    expect(issues.find((i) => i.code === 'GLSL_TOO_NEW')?.level).toBe('error');
  });

  it('声明的比目标旧 → warning（GLSL_TOO_OLD，官方说加载器通常仍能跑）', () => {
    const issues = checkShaderSetup(
      [{ name: 'P', glslVersion: 120, targetMcVersion: '1.21.1' }],
      mods('iris'),
    );
    expect(codes(issues)).toContain('GLSL_TOO_OLD');
    expect(issues.find((i) => i.code === 'GLSL_TOO_OLD')?.level).toBe('warning');
    // 旧版本不是阻断级 —— 光影仍会加载
    expect(hasBlockingShaderIssue(issues)).toBe(false);
  });

  it('正好等于目标 → 不报', () => {
    const issues = checkShaderSetup(
      [{ name: 'P', glslVersion: 150, targetMcVersion: '1.21.1' }],
      mods('iris'),
    );
    expect(codes(issues)).toEqual([]);
  });

  it('未声明 glslVersion → 不报（不给默认值也不猜）', () => {
    expect(checkShaderSetup([{ name: 'P', targetMcVersion: '1.21.1' }], mods('iris'))).toEqual([]);
  });
});

describe('§5.6 点名的 Iris + Sodium 组合', () => {
  it('Iris + Sodium + 有光影包 → info 确认', () => {
    const issues = checkShaderSetup([{ name: 'SEUS' }], mods('iris', 'sodium'));
    expect(codes(issues)).toEqual(['IRIS_SODIUM_COMBINATION']);
    expect(issues[0]?.level).toBe('info');
    // 确认性提示，不是阻断
    expect(hasBlockingShaderIssue(issues)).toBe(false);
  });

  it('有 Sodium 无 Iris → 不给这条 info', () => {
    expect(codes(checkShaderSetup([{ name: 'P' }], mods('sodium')))).toEqual(['NO_LOADER']);
  });

  it('Iris + Sodium 但没放光影包 → 不给（无对象可确认）', () => {
    expect(checkShaderSetup([], mods('iris', 'sodium'))).toEqual([]);
  });
});

describe('摘要与聚合', () => {
  it('多条一次给全，带 code 前缀并用；分隔', () => {
    const s = summarizeShaderSetup(
      checkShaderSetup(
        [{ name: 'P', usesIrisOnlyPrograms: true, glslVersion: 330, targetMcVersion: '1.16.5' }],
        mods('optifine'),
      ),
    );
    expect(s).toContain('[IRIS_ONLY_PROGRAM_WITHOUT_IRIS]');
    expect(s).toContain('[GLSL_TOO_NEW]');
    expect(s).toContain('；');
  });

  it('单条时摘要仍是完整可读文案（不是裸 code）', () => {
    const s = summarizeShaderSetup(checkShaderSetup([{ name: 'P' }], mods()));
    expect(s).toContain('[NO_LOADER]');
    expect(s.length).toBeGreaterThan(20);
  });

  it('无问题时的摘要不是空串', () => {
    expect(summarizeShaderSetup([])).toBe('光影组合无问题');
  });
});
