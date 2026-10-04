/**
 * generate.ts 单元测试（设计文档 §10.3 生成闭环 + §10.4 上下文注入 + §10.5 成本控制；§11 生成阶梯）。
 * 全部纯函数，无 I/O、无 LLM 调用。
 */
import { describe, expect, it } from 'vitest';
import { VALIDATION_CRITERIA } from '@mc-creator/contract';
import { buildContextPack } from './context-pack.js';
import {
  GENERATE_TRUNC_MARK,
  buildGeneratePrompt,
  criterionFor,
  estimateRounds,
  planFixAttempt,
  type GenerationKind,
} from './generate.js';

const KINDS: GenerationKind[] = ['datapack', 'addon', 'server-plugin', 'server-mod', 'client-mod'];

function baseInput() {
  return {
    kind: 'datapack' as GenerationKind,
    userPrompt: '做一个会说话的村民',
    versionContext: 'mc_version: 1.21.4',
    apiTypes: 'interface Villager {}',
    contextPack: 'installed_mods: jei',
    budgetChars: 8000,
  };
}

describe('buildGeneratePrompt 组装顺序（§10.4 强制顺序）', () => {
  it('顺序：版本上下文 → API 类型 → contextPack → 用户需求', () => {
    const text = buildGeneratePrompt(baseInput());
    const iVersion = text.indexOf('mc_version: 1.21.4');
    const iApi = text.indexOf('interface Villager {}');
    const iPack = text.indexOf('installed_mods: jei');
    const iUser = text.indexOf('做一个会说话的村民');
    expect(iVersion).toBeGreaterThanOrEqual(0);
    expect(iApi).toBeGreaterThan(iVersion);
    expect(iPack).toBeGreaterThan(iApi);
    expect(iUser).toBeGreaterThan(iPack);
  });

  it('预算内不截断：四段原文都在且无截断标记', () => {
    const text = buildGeneratePrompt(baseInput());
    expect(text).toContain('mc_version: 1.21.4');
    expect(text).toContain('interface Villager {}');
    expect(text).toContain('installed_mods: jei');
    expect(text).toContain('做一个会说话的村民');
    expect(text).not.toContain(GENERATE_TRUNC_MARK);
  });
});

describe('buildGeneratePrompt 预算截断（§10.5：用户需求永不截断）', () => {
  it('超预算先截 apiTypes：用户/版本/包全文保留 + 有截断标记 + 长度受限', () => {
    const text = buildGeneratePrompt({
      ...baseInput(),
      versionContext: 'V'.repeat(50),
      apiTypes: 'A'.repeat(2000),
      contextPack: 'C'.repeat(50),
      userPrompt: 'USER-NEED-村民会说话',
      budgetChars: 600,
    });
    expect(text).toContain('USER-NEED-村民会说话');
    expect(text).toContain('V'.repeat(50));
    expect(text).toContain('C'.repeat(50));
    expect(text).toContain(GENERATE_TRUNC_MARK);
    expect(text).not.toContain('A'.repeat(2000));
    expect(text.length).toBeLessThanOrEqual(600);
  });

  it('apiTypes 截光仍超预算时继续截 contextPack（优先级 apiTypes 最低）', () => {
    const text = buildGeneratePrompt({
      ...baseInput(),
      versionContext: 'V'.repeat(20),
      apiTypes: 'A'.repeat(30),
      contextPack: 'C'.repeat(2000),
      userPrompt: 'USER-NEED',
      budgetChars: 400,
    });
    expect(text).toContain('USER-NEED');
    expect(text).toContain(GENERATE_TRUNC_MARK);
    expect(text).not.toContain('C'.repeat(2000));
    expect(text.length).toBeLessThanOrEqual(400);
  });

  it('极端小预算：用户需求仍全文保留（永不截断）且有标记', () => {
    const text = buildGeneratePrompt({
      ...baseInput(),
      versionContext: 'V'.repeat(500),
      apiTypes: 'A'.repeat(500),
      contextPack: 'C'.repeat(500),
      userPrompt: 'USER-NEED-必须完整',
      budgetChars: 50,
    });
    expect(text).toContain('USER-NEED-必须完整');
    expect(text).toContain(GENERATE_TRUNC_MARK);
  });

  it('空 prompt 抛中文错', () => {
    expect(() => buildGeneratePrompt({ ...baseInput(), userPrompt: '' })).toThrow(/不能为空/);
  });

  it('空白 prompt 同样抛错', () => {
    expect(() => buildGeneratePrompt({ ...baseInput(), userPrompt: '   \n  ' })).toThrow(/不能为空/);
  });
});

describe('estimateRounds 反馈延迟→迭代轮次（§11 阶梯，梯度见 §0.3）', () => {
  it('5 档数值：datapack/addon=8，server-plugin=5，server-mod=3，client-mod=2', () => {
    expect(estimateRounds('datapack')).toBe(8);
    expect(estimateRounds('addon')).toBe(8);
    expect(estimateRounds('server-plugin')).toBe(5);
    expect(estimateRounds('server-mod')).toBe(3);
    expect(estimateRounds('client-mod')).toBe(2);
  });

  it('未知 kind 抛中文错', () => {
    expect(() => estimateRounds('nope' as GenerationKind)).toThrow(/未知生成类别/);
  });
});

describe('criterionFor 成功判据（§10.3 机器可判定是闭环前提）', () => {
  it('5 键全有且与 VALIDATION_CRITERIA 一致', () => {
    for (const kind of KINDS) {
      expect(criterionFor(kind)).toBe(VALIDATION_CRITERIA[kind]);
    }
  });

  it('未知 kind 抛中文错', () => {
    expect(() => criterionFor('nope' as GenerationKind)).toThrow(/成功判据/);
  });
});

describe('planFixAttempt 修复决策（复用 pipeline.ts nextStep 语义）', () => {
  it('history 为空 → retry-fix（首轮）', () => {
    expect(planFixAttempt([], 3)).toMatchObject({ action: 'retry-fix' });
  });

  it('最后一步 ok → abort-to-human（已成功无需修复）', () => {
    const d = planFixAttempt([{ stage: 'validate', ok: true, kind: 'datapack' }], 3);
    expect(d.action).toBe('abort-to-human');
    expect(d.reason).toMatch(/已成功无需修复/);
  });

  it('失败次数 >= maxAttempts → abort-to-human（§10.5 轮次上限）', () => {
    const d = planFixAttempt(
      [
        { stage: 'generate', ok: false },
        { stage: 'validate', ok: false },
      ],
      2,
    );
    expect(d.action).toBe('abort-to-human');
    expect(d.reason).toMatch(/轮次上限/);
  });

  it('diagnose 失败 → abort-to-human（避免无效循环）', () => {
    const d = planFixAttempt([{ stage: 'diagnose', ok: false }], 3);
    expect(d.action).toBe('abort-to-human');
    expect(d.reason).toMatch(/诊断/);
  });

  it('其余失败 → retry-fix（错误回灌后重试）', () => {
    expect(planFixAttempt([{ stage: 'validate', ok: false }], 3).action).toBe('retry-fix');
    expect(
      planFixAttempt(
        [
          { stage: 'validate', ok: false },
          { stage: 'diagnose', ok: true },
          { stage: 'fix', ok: false },
        ],
        5,
      ).action,
    ).toBe('retry-fix');
  });
});

describe('与 context-pack.ts 联调：buildContextPack 输出可直接喂入', () => {
  it('contextPack 透传：targeting 头部行出现在 prompt 且顺序仍成立', () => {
    const pack = buildContextPack(
      { serverId: 'test', edition: 'server', mcVersion: '1.21.4' },
      { plugins: ['Essentials'], lastBuildHash: 'deadbeef', lastFailure: 'boom', isFolia: false },
      8000,
    );
    const text = buildGeneratePrompt({
      ...baseInput(),
      kind: 'server-plugin',
      versionContext: 'mc_version: 1.21.4',
      apiTypes: 'class JavaPlugin {}',
      contextPack: pack.text,
      budgetChars: 8000,
    });
    // targeting 头部保留行透传进 prompt
    expect(text).toContain('last_build_hash: deadbeef');
    expect(text).toContain('last_failure: boom');
    expect(text).toContain('folia: false');
    // §10.4 强制顺序仍成立：版本 < API < 包 < 用户
    const order = [
      text.indexOf('mc_version: 1.21.4'),
      text.indexOf('class JavaPlugin {}'),
      text.indexOf('last_build_hash: deadbeef'),
      text.indexOf('做一个会说话的村民'),
    ];
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
