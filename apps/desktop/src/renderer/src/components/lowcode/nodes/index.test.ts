import { describe, it, expect } from 'vitest';
import { nodeTypes, NODE_METADATA, NODE_CATEGORIES } from './index.js';

describe('nodes/index（阶段 C 注册）', () => {
  it('nodeTypes 含 variable/subgraph/loop', () => {
    expect(nodeTypes.variable).toBeDefined();
    expect(nodeTypes.subgraph).toBeDefined();
    expect(nodeTypes.loop).toBeDefined();
  });

  it('NODE_METADATA 含 variable/subgraph/loop，category=advanced', () => {
    const kinds = NODE_METADATA.map((m) => m.kind);
    expect(kinds).toContain('variable');
    expect(kinds).toContain('subgraph');
    expect(kinds).toContain('loop');
    expect(NODE_METADATA.find((m) => m.kind === 'variable')?.category).toBe('advanced');
  });
});
