import { describe, it, expect } from 'vitest';
import {
  DEPENDENCY_SEMANTIC_DOCS,
  DEPENDENCY_SEMANTIC_LABEL,
  DEPENDENCY_SEMANTICS,
  DEPENDENCY_SEVERITY,
  isCoexistenceSemantic,
  isSoftSemantic,
  normalizeDependencySemantic,
  resolveVersionConstraint,
  type SemanticDependencyRef,
} from './dependency-semantics.js';

describe('五种依赖语义（设计文档 §5.3 缺一不可）', () => {
  it('恰好五种且无遗漏', () => {
    expect([...DEPENDENCY_SEMANTICS]).toEqual([
      'depends',
      'recommends',
      'suggests',
      'breaks',
      'conflicts',
    ]);
    expect(DEPENDENCY_SEMANTICS).toHaveLength(5);
  });

  it('每种语义都有独立的中文标签', () => {
    const labels = DEPENDENCY_SEMANTICS.map((s) => DEPENDENCY_SEMANTIC_LABEL[s]);
    expect(new Set(labels).size).toBe(5);
    for (const s of DEPENDENCY_SEMANTICS) {
      expect(DEPENDENCY_SEMANTIC_LABEL[s]).toBeTruthy();
    }
  });

  it('处置级别表：depends/conflicts=error，breaks=warning，recommends=warning，suggests=info', () => {
    expect(DEPENDENCY_SEVERITY.depends).toBe('error');
    expect(DEPENDENCY_SEVERITY.conflicts).toBe('error');
    expect(DEPENDENCY_SEVERITY.breaks).toBe('warning');
    expect(DEPENDENCY_SEVERITY.recommends).toBe('warning');
    expect(DEPENDENCY_SEVERITY.suggests).toBe('info');
  });

  it('决策表文档五项齐全，且级别与 DEPENDENCY_SEVERITY 一致（单一事实来源）', () => {
    expect(DEPENDENCY_SEMANTIC_DOCS).toHaveLength(5);
    for (const row of DEPENDENCY_SEMANTIC_DOCS) {
      expect(row.severity).toBe(DEPENDENCY_SEVERITY[row.semantic]);
      expect(row.missing).toBeTruthy();
      expect(row.versionMismatch).toBeTruthy();
      expect(row.coexistence).toBeTruthy();
    }
    expect(DEPENDENCY_SEMANTIC_DOCS.map((r) => r.semantic).sort()).toEqual(
      [...DEPENDENCY_SEMANTICS].sort(),
    );
  });

  it('breaks 明确取 warning 而非 error / info', () => {
    expect(DEPENDENCY_SEVERITY.breaks).toBe('warning');
    expect(DEPENDENCY_SEVERITY.breaks).not.toBe('error');
    expect(DEPENDENCY_SEVERITY.breaks).not.toBe('info');
  });

  it('suggests 比 recommends 更弱（info < warning）', () => {
    const rank = { info: 0, warning: 1, error: 2 } as const;
    expect(rank[DEPENDENCY_SEVERITY.suggests]).toBeLessThan(rank[DEPENDENCY_SEVERITY.recommends]);
    expect(rank[DEPENDENCY_SEVERITY.recommends]).toBeLessThan(rank[DEPENDENCY_SEVERITY.depends]);
  });
});

describe('normalizeDependencySemantic · 原始值归一', () => {
  it('Modrinth / Forge / Fabric 的同义写法归到同一语义', () => {
    expect(normalizeDependencySemantic('required')).toBe('depends');
    expect(normalizeDependencySemantic('depends')).toBe('depends');
    expect(normalizeDependencySemantic('mandatory')).toBe('depends');
    expect(normalizeDependencySemantic('incompatible')).toBe('conflicts');
    expect(normalizeDependencySemantic('conflicts')).toBe('conflicts');
    expect(normalizeDependencySemantic('exclude')).toBe('conflicts');
    expect(normalizeDependencySemantic('recommends')).toBe('recommends');
    expect(normalizeDependencySemantic('suggests')).toBe('suggests');
    expect(normalizeDependencySemantic('breaks')).toBe('breaks');
  });

  it('大小写与空白不敏感', () => {
    expect(normalizeDependencySemantic('  Required ')).toBe('depends');
    expect(normalizeDependencySemantic('BREAKS')).toBe('breaks');
  });

  it('embedded 归 null（不参与冲突判定）', () => {
    expect(normalizeDependencySemantic('embedded')).toBeNull();
    expect(normalizeDependencySemantic('include')).toBeNull();
  });

  it('未知值与非法输入归 null 而不抛', () => {
    expect(normalizeDependencySemantic('whatever')).toBeNull();
    expect(normalizeDependencySemantic('')).toBeNull();
    expect(normalizeDependencySemantic(undefined)).toBeNull();
    // @ts-expect-error 故意传非字符串
    expect(() => normalizeDependencySemantic(42)).not.toThrow();
    // @ts-expect-error 故意传非字符串
    expect(normalizeDependencySemantic({})).toBeNull();
  });

  it('optional 默认归 recommends（保守取向）', () => {
    expect(normalizeDependencySemantic('optional')).toBe('recommends');
  });

  it('optional 可配置为 suggests 或 ignores', () => {
    expect(normalizeDependencySemantic('optional', { optionalAs: 'suggests' })).toBe('suggests');
    expect(normalizeDependencySemantic('optional', { optionalAs: 'depends' })).toBe('depends');
    expect(normalizeDependencySemantic('optional', { optionalAs: 'ignores' })).toBeNull();
  });
});

describe('isSoftSemantic / isCoexistenceSemantic', () => {
  it('软性语义只有 recommends 与 suggests', () => {
    expect(isSoftSemantic('recommends')).toBe(true);
    expect(isSoftSemantic('suggests')).toBe(true);
    expect(isSoftSemantic('depends')).toBe(false);
    expect(isSoftSemantic('breaks')).toBe(false);
    expect(isSoftSemantic('conflicts')).toBe(false);
  });
  it('共存语义只有 breaks 与 conflicts', () => {
    expect(isCoexistenceSemantic('breaks')).toBe(true);
    expect(isCoexistenceSemantic('conflicts')).toBe(true);
    expect(isCoexistenceSemantic('depends')).toBe(false);
    expect(isCoexistenceSemantic('recommends')).toBe(false);
    expect(isCoexistenceSemantic('suggests')).toBe(false);
  });
});

describe('resolveVersionConstraint', () => {
  const dep = (over: Partial<SemanticDependencyRef> = {}): SemanticDependencyRef => ({
    projectId: 'x',
    dependencyType: 'required',
    ...over,
  });

  it('优先取 dep.versionRange 原文', () => {
    expect(resolveVersionConstraint(dep({ versionRange: '[1.0,2.0)' }), '[9,)')).toBe('[1.0,2.0)');
  });
  it('versionRange 缺失时取注入表', () => {
    expect(resolveVersionConstraint(dep(), '[9,)')).toBe('[9,)');
  });
  it('都没有则 undefined（= 不做版本核对）', () => {
    expect(resolveVersionConstraint(dep())).toBeUndefined();
    expect(resolveVersionConstraint(dep(), '   ')).toBeUndefined();
  });
  it('versionId 绝不被当作版本约束', () => {
    expect(resolveVersionConstraint(dep({ versionId: '4712345' }))).toBeUndefined();
    expect(resolveVersionConstraint(dep({ versionId: 'AANobbMI' }), '')).toBeUndefined();
  });
});
