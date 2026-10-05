import { describe, it, expect } from 'vitest';
import { detectConflicts } from './conflicts.js';
import { buildDependencyGraph } from './graph.js';
import type { ModEntry } from '@mc-creator/shared';

function entry(partial: Partial<ModEntry> & { projectId: string; versionId: string }): ModEntry {
  return {
    name: partial.projectId,
    fileName: 'a.jar',
    ...partial,
  };
}

describe('detectConflicts', () => {
  it('同一 mod 多版本报 duplicate-version', () => {
    const conflicts = detectConflicts(
      [entry({ projectId: 'a', versionId: 'v1' }), entry({ projectId: 'a', versionId: 'v2' })],
      '1.21.1',
      'fabric',
    );
    expect(conflicts.some((c) => c.kind === 'duplicate-version')).toBe(true);
    expect(conflicts[0]?.suggestion.targetVersionId).toBeTruthy();
  });
  it('loader 不匹配报 loader-mismatch 并给出可用版本建议', () => {
    const conflicts = detectConflicts(
      [entry({ projectId: 'a', versionId: 'v1', name: 'A', loaders: ['neoforge'] })],
      '1.21.1',
      'fabric',
      {
        metadataByProject: {
          a: [
            {
              id: 'v2',
              versionNumber: '2.0',
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
    );
    const c = conflicts.find((x) => x.kind === 'loader-mismatch');
    expect(c).toBeDefined();
    expect(c?.suggestion.targetVersionId).toBe('v2');
    expect(c?.suggestedVersionNumber).toBe('2.0');
  });
  it('mc 越界报 mc-out-of-range', () => {
    const conflicts = detectConflicts(
      [
        entry({
          projectId: 'a',
          versionId: 'v1',
          name: 'A',
          gameVersions: ['1.20.1'],
          loaders: ['fabric'],
        }),
      ],
      '1.21.1',
      'fabric',
    );
    expect(conflicts.some((c) => c.kind === 'mc-out-of-range')).toBe(true);
  });
  it('缺失 required 依赖报 missing-dependency', () => {
    const conflicts = detectConflicts(
      [
        entry({
          projectId: 'a',
          versionId: 'v1',
          name: 'A',
          dependencies: [{ projectId: 'lib-x', dependencyType: 'required' }],
        }),
      ],
      '1.21.1',
      'fabric',
    );
    const c = conflicts.find((x) => x.kind === 'missing-dependency');
    expect(c).toBeDefined();
    expect(c?.suggestion.action).toBe('add-missing');
  });
  it('incompatible 共存报 breaks-conflict', () => {
    const conflicts = detectConflicts(
      [
        entry({
          projectId: 'a',
          versionId: 'v1',
          name: 'A',
          dependencies: [{ projectId: 'b', dependencyType: 'incompatible' }],
        }),
        entry({ projectId: 'b', versionId: 'v1', name: 'B' }),
      ],
      '1.21.1',
      'fabric',
    );
    expect(conflicts.some((c) => c.kind === 'breaks-conflict')).toBe(true);
  });
  it('健康包零冲突', () => {
    const conflicts = detectConflicts(
      [
        entry({
          projectId: 'a',
          versionId: 'v1',
          name: 'A',
          gameVersions: ['1.21.1'],
          loaders: ['fabric'],
        }),
      ],
      '1.21.1',
      'fabric',
    );
    expect(conflicts).toHaveLength(0);
  });
});

describe('buildDependencyGraph', () => {
  it('requires/optional/breaks 边齐全', () => {
    const g = buildDependencyGraph([
      entry({
        projectId: 'a',
        versionId: 'v1',
        name: 'A',
        dependencies: [
          { projectId: 'b', dependencyType: 'required' },
          { projectId: 'c', dependencyType: 'optional' },
          { projectId: 'd', dependencyType: 'incompatible' },
        ],
      }),
      entry({ projectId: 'b', versionId: 'v1', name: 'B' }),
    ]);
    expect(g.nodes).toHaveLength(2);
    expect(g.edges.map((e) => e.kind).sort()).toEqual(['breaks', 'optional', 'requires']);
  });
});
