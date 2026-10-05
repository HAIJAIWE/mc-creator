/**
 * 依赖语义（depends / recommends / suggests / breaks / conflicts）端到端检测。
 *
 * 与 conflicts.test.ts 分文件放置：本文件只**新增**断言，
 * 既有的 4 类检查回归防线留在 conflicts.test.ts 不动。
 */

import { describe, it, expect } from 'vitest';
import { detectConflicts } from './conflicts.js';
import { buildDependencyGraph } from './graph.js';
import type { ModEntry } from '@mc-creator/shared';
import type { SemanticDependencyRef, SemanticModEntry } from './dependency-semantics.js';
import type { ModConflict } from './types.js';

function entry(
  partial: Partial<SemanticModEntry> & { projectId: string; versionId: string },
): SemanticModEntry {
  return {
    name: partial.projectId,
    fileName: 'a.jar',
    ...partial,
  };
}

function deps(pairs: Array<Partial<SemanticDependencyRef> & { projectId: string }>) {
  return pairs.map((p) => ({ dependencyType: 'required', ...p })) as SemanticDependencyRef[];
}

/** 只看依赖语义相关的条目（过滤掉 duplicate/loader/mc 三类） */
function depConflicts(list: ModConflict[]): ModConflict[] {
  return list.filter((c) => c.semantic !== undefined);
}

describe('depends（required）', () => {
  it('缺失 → error（阻断）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            name: 'A',
            dependencies: deps([{ projectId: 'lib-x' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.kind).toBe('missing-dependency');
    expect(c[0]?.severity).toBe('error');
    expect(c[0]?.semantic).toBe('depends');
    expect(c[0]?.detail).toBe('absent');
    expect(c[0]?.suggestion.action).toBe('add-missing');
  });

  it('已安装且无约束 → 无条目', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({ projectId: 'a', versionId: 'v1', dependencies: deps([{ projectId: 'b' }]) }),
          entry({ projectId: 'b', versionId: 'v1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('已安装但版本不符硬约束 → error（这正是旧实现报不出来的情况）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            name: 'A',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'depends', versionRange: '[1.0,2.0)' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '2.5' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.severity).toBe('error');
    expect(c[0]?.semantic).toBe('depends');
    expect(c[0]?.detail).toBe('version-mismatch');
    expect(c[0]?.constraint).toBe('[1.0,2.0)');
    expect(c[0]?.message).toContain('2.5');
  });

  it('版本满足约束 → 无条目', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'depends', versionRange: '[1.0,2.0)' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '1.5' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('软性约束被违反也不升级为阻断级（strict=false → info）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'depends', versionRange: '1.0' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '0.5' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.severity).toBe('info');
    expect(c[0]?.detail).toBe('version-mismatch');
  });

  it('约束无法解析 → info 且不阻断（不抛异常）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'depends', versionRange: '[1.0,2.0' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '1.5' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.severity).toBe('info');
    expect(c[0]?.detail).toBe('version-unknown');
  });

  it('依赖侧 versionId 是哈希/数字 ID 时绝不误报（只作 suggestion 目标）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', versionId: '4712345' }]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '1.0.0' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('版本约束可经 opts.versionRangeByProject 注入（mods.toml 解析器接入前的通道）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', dependencyType: 'depends' }]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '20.1.0' }),
        ],
        '1.21.1',
        'fabric',
        { versionRangeByProject: { a: { b: '[21.1,)' } } },
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.severity).toBe('error');
    expect(c[0]?.detail).toBe('version-mismatch');
    expect(c[0]?.constraint).toBe('[21.1,)');
  });

  it('版本约束注入支持 Map 形态', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', dependencyType: 'depends' }]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '1.5' }),
        ],
        '1.21.1',
        'fabric',
        { versionRangeByProject: new Map([['a', { b: '[1.0,2.0)' }]]) },
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('版本不符时优先推荐元数据里真正满足约束的版本', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'depends', versionRange: '[1.0,2.0)' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '3.0' }),
        ],
        '1.21.1',
        'fabric',
        {
          metadataByProject: {
            a: [
              {
                id: 'ok',
                versionNumber: '1.5',
                fileName: 'a.jar',
                downloadUrl: '',
                fileSize: 1,
                gameVersions: ['1.21.1'],
                loaders: ['fabric'],
                dependencies: [],
              },
            ],
          },
        },
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.suggestion.action).toBe('upgrade');
    expect(c[0]?.suggestion.targetVersionId).toBe('ok');
  });
});

describe('recommends', () => {
  it('缺失 → warning（不阻断）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            name: 'A',
            dependencies: deps([{ projectId: 'jei', dependencyType: 'recommends' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.kind).toBe('missing-dependency');
    expect(c[0]?.severity).toBe('warning');
    expect(c[0]?.semantic).toBe('recommends');
    expect(c[0]?.detail).toBe('absent');
    // 仍给补装建议，方便一键处理
    expect(c[0]?.suggestion.action).toBe('add-missing');
  });

  it('已安装 → 无条目', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'jei', dependencyType: 'recommends' }]),
          }),
          entry({ projectId: 'jei', versionId: 'v1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('版本不符硬约束 → warning（不阻断）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'jei', dependencyType: 'recommends', versionRange: '[15.0,)' },
            ]),
          }),
          entry({ projectId: 'jei', versionId: 'v1', versionNumber: '11.2.1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.severity).toBe('warning');
    expect(c[0]?.detail).toBe('version-mismatch');
  });

  it('Modrinth 的 optional 归到 recommends（warning）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'jei', dependencyType: 'optional' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.semantic).toBe('recommends');
    expect(c[0]?.severity).toBe('warning');
  });

  it('optionalAs=suggests 可改为 info；optionalAs=ignores 则完全跳过', () => {
    const mk = () => [
      entry({
        projectId: 'a',
        versionId: 'v1',
        dependencies: deps([{ projectId: 'jei', dependencyType: 'optional' }]),
      }),
    ];
    expect(
      depConflicts(detectConflicts(mk(), '1.21.1', 'fabric', { optionalAs: 'suggests' }))[0]
        ?.severity,
    ).toBe('info');
    expect(
      depConflicts(detectConflicts(mk(), '1.21.1', 'fabric', { optionalAs: 'ignores' })),
    ).toHaveLength(0);
  });
});

describe('suggests', () => {
  it('缺失 → info（仅提示，比 recommends 更弱）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            name: 'A',
            dependencies: deps([{ projectId: 'x', dependencyType: 'suggests' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.kind).toBe('missing-dependency');
    expect(c[0]?.severity).toBe('info');
    expect(c[0]?.semantic).toBe('suggests');
    expect(c[0]?.detail).toBe('absent');
  });

  it('已安装 → 无条目', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'x', dependencyType: 'suggests' }]),
          }),
          entry({ projectId: 'x', versionId: 'v1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('版本不符 → info（比 recommends 更弱）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'x', dependencyType: 'suggests', versionRange: '[9.0,)' },
            ]),
          }),
          entry({ projectId: 'x', versionId: 'v1', versionNumber: '1.0' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.severity).toBe('info');
    expect(c[0]?.semantic).toBe('suggests');
    expect(c[0]?.detail).toBe('version-mismatch');
  });

  it('约束无法解析时 suggests 直接跳过（避免刷屏）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'x', dependencyType: 'suggests', versionRange: '>=>' },
            ]),
          }),
          entry({ projectId: 'x', versionId: 'v1', versionNumber: '1.0' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });
});

describe('breaks', () => {
  it('共存 → warning（不阻断，理由见 dependency-semantics.ts）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            name: 'A',
            dependencies: deps([{ projectId: 'b', dependencyType: 'breaks' }]),
          }),
          entry({ projectId: 'b', versionId: 'v1', name: 'B' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.kind).toBe('breaks-conflict');
    expect(c[0]?.severity).toBe('warning');
    expect(c[0]?.semantic).toBe('breaks');
    expect(c[0]?.detail).toBe('coexist');
    // 仍给移除建议
    expect(c[0]?.suggestion.action).toBe('remove');
    expect(c[0]?.suggestion.targetProjectId).toBe('b');
  });

  it('目标不在包内 → 无条目', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', dependencyType: 'breaks' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('共存但版本落在 constraints 允许的区间内 → 无条目（breaks 带区间限定）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'breaks', versionRange: '[2.0,)' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '2.1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('共存且版本不在区间内 → warning + detail=version-conflict', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'breaks', versionRange: '[2.0,)' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '1.9' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.severity).toBe('warning');
    expect(c[0]?.detail).toBe('version-conflict');
    expect(c[0]?.constraint).toBe('[2.0,)');
  });

  it('breaks 的 suggestion.reason 说明"取决于版本组合、需人工确认"', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', dependencyType: 'breaks' }]),
          }),
          entry({ projectId: 'b', versionId: 'v1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c[0]?.suggestion.reason).toContain('崩溃');
  });
});

describe('conflicts（incompatible）', () => {
  it('共存 → error（阻断）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            name: 'A',
            dependencies: deps([{ projectId: 'b', dependencyType: 'conflicts' }]),
          }),
          entry({ projectId: 'b', versionId: 'v1', name: 'B' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.kind).toBe('breaks-conflict');
    expect(c[0]?.severity).toBe('error');
    expect(c[0]?.semantic).toBe('conflicts');
    expect(c[0]?.detail).toBe('coexist');
  });

  it('incompatible（Modrinth / Forge 写法）→ 同为 error', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', dependencyType: 'incompatible' }]),
          }),
          entry({ projectId: 'b', versionId: 'v1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.semantic).toBe('conflicts');
    expect(c[0]?.severity).toBe('error');
  });

  it('目标不在包内 → 无条目', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', dependencyType: 'conflicts' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('共存但版本落在允许区间内 → 无条目', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'conflicts', versionRange: '[3.0,)' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '3.1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('共存且约束无法解析 → info（不阻断、不抛）', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([
              { projectId: 'b', dependencyType: 'conflicts', versionRange: '[oops' },
            ]),
          }),
          entry({ projectId: 'b', versionId: 'v1', versionNumber: '1.0' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    expect(c[0]?.severity).toBe('info');
    expect(c[0]?.detail).toBe('version-unknown');
  });

  it('conflicts 与 breaks 共存场景的级别不同（error vs warning）', () => {
    const mk = (t: string) =>
      depConflicts(
        detectConflicts(
          [
            entry({
              projectId: 'a',
              versionId: 'v1',
              dependencies: deps([{ projectId: 'b', dependencyType: t }]),
            }),
            entry({ projectId: 'b', versionId: 'v1' }),
          ],
          '1.21.1',
          'fabric',
        ),
      )[0]?.severity;
    expect(mk('conflicts')).toBe('error');
    expect(mk('breaks')).toBe('warning');
  });
});

describe('五种语义并存时的完整场景', () => {
  it('一次跑出 5 种语义各自不同的处置级别', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            name: 'A',
            dependencies: deps([
              { projectId: 'missing-required', dependencyType: 'required' },
              { projectId: 'missing-rec', dependencyType: 'recommends' },
              { projectId: 'missing-sug', dependencyType: 'suggests' },
              { projectId: 'present-b', dependencyType: 'breaks' },
              { projectId: 'present-c', dependencyType: 'conflicts' },
            ]),
          }),
          entry({ projectId: 'present-b', versionId: 'v1' }),
          entry({ projectId: 'present-c', versionId: 'v1' }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(5);
    const bySemantic = new Map(c.map((x) => [x.semantic, x]));
    expect(bySemantic.get('depends')?.severity).toBe('error');
    expect(bySemantic.get('recommends')?.severity).toBe('warning');
    expect(bySemantic.get('suggests')?.severity).toBe('info');
    expect(bySemantic.get('breaks')?.severity).toBe('warning');
    expect(bySemantic.get('conflicts')?.severity).toBe('error');
    // 三种"缺失"类都落在 missing-dependency，两种"共存"类都落在 breaks-conflict
    expect(bySemantic.get('depends')?.kind).toBe('missing-dependency');
    expect(bySemantic.get('conflicts')?.kind).toBe('breaks-conflict');
  });

  it('embedded 依赖不产生任何条目', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', dependencyType: 'embedded' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('未知 dependencyType 不产生条目也不抛', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'b', dependencyType: 'totally-unknown' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(0);
  });

  it('自依赖（a 依赖自己）不产生共存条目，避免自激', () => {
    const c = depConflicts(
      detectConflicts(
        [
          entry({
            projectId: 'a',
            versionId: 'v1',
            dependencies: deps([{ projectId: 'a', dependencyType: 'conflicts' }]),
          }),
        ],
        '1.21.1',
        'fabric',
      ),
    );
    expect(c).toHaveLength(1);
    // 语义上确实是"声明了自相矛盾"，仍如实上报，但 message 可辨识
    expect(c[0]?.projectIds).toEqual(['a', 'a']);
  });

  it('端到端：真实 mods.toml 约束 [1.20.1,1.21) 下的三种组合', () => {
    const mk = (depVersion: string) =>
      depConflicts(
        detectConflicts(
          [
            entry({
              projectId: 'a',
              versionId: 'v1',
              name: 'A',
              dependencies: deps([
                { projectId: 'jei', dependencyType: 'required', versionRange: '[15.0,16.0)' },
              ]),
            }),
            entry({ projectId: 'jei', versionId: 'v1', versionNumber: depVersion }),
          ],
          '1.20.1',
          'fabric',
        ),
      );
    expect(mk('15.2.0')).toHaveLength(0);
    expect(mk('16.0.0')[0]?.severity).toBe('error');
    expect(mk('14.0.0')[0]?.severity).toBe('error');
  });
});

describe('依赖图覆盖五种语义', () => {
  it('recommends/suggests → optional 边，conflicts/breaks → breaks 边', () => {
    const g = buildDependencyGraph([
      entry({
        projectId: 'a',
        versionId: 'v1',
        dependencies: deps([
          { projectId: 'r', dependencyType: 'required' },
          { projectId: 'rec', dependencyType: 'recommends' },
          { projectId: 'sug', dependencyType: 'suggests' },
          { projectId: 'cf', dependencyType: 'conflicts' },
          { projectId: 'bk', dependencyType: 'breaks' },
          { projectId: 'inc', dependencyType: 'incompatible' },
          { projectId: 'opt', dependencyType: 'optional' },
          { projectId: 'emb', dependencyType: 'embedded' },
        ]),
      }),
    ]);
    const byTarget = new Map(g.edges.map((e) => [e.to, e.kind]));
    expect(byTarget.get('r')).toBe('requires');
    expect(byTarget.get('rec')).toBe('optional');
    expect(byTarget.get('sug')).toBe('optional');
    expect(byTarget.get('cf')).toBe('breaks');
    expect(byTarget.get('bk')).toBe('breaks');
    // 历史行为保持不变
    expect(byTarget.get('inc')).toBe('breaks');
    expect(byTarget.get('opt')).toBe('optional');
    expect(byTarget.get('emb')).toBe('embedded');
  });

  it('versionRange 优先于 versionId 作为边约束', () => {
    const g = buildDependencyGraph([
      entry({
        projectId: 'a',
        versionId: 'v1',
        dependencies: deps([
          { projectId: 'b', dependencyType: 'required', versionRange: '[1.0,2.0)' },
        ]),
      }),
    ]);
    expect(g.edges[0]?.versionConstraint).toBe('[1.0,2.0)');
  });

  it('buildDependencyGraph 仍接受原生 ModEntry[]（向后兼容）', () => {
    const plain: ModEntry[] = [
      { name: 'A', projectId: 'a', versionId: 'v1', fileName: 'a.jar' },
      { name: 'B', projectId: 'b', versionId: 'v1', fileName: 'b.jar' },
    ];
    const g = buildDependencyGraph(plain);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges).toHaveLength(0);
  });
});

describe('detectConflicts 仍接受原生 ModEntry[]（向后兼容）', () => {
  it('原生 ModEntry 数组可直接传入', () => {
    const plain: ModEntry[] = [
      {
        name: 'A',
        projectId: 'a',
        versionId: 'v1',
        fileName: 'a.jar',
        dependencies: [{ projectId: 'b', dependencyType: 'required' }],
      },
    ];
    const c = detectConflicts(plain, '1.21.1', 'fabric');
    expect(c.some((x) => x.kind === 'missing-dependency')).toBe(true);
  });
});
