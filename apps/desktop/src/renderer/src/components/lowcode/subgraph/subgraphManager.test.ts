import { describe, it, expect, beforeEach } from 'vitest';
import { subgraphManager } from './subgraphManager.js';
import type { SubgraphDefinition } from '@mc-creator/shared';

function makeSg(id: string, name = id): SubgraphDefinition {
  return { id, name, nodes: [], edges: [], portMappings: [] };
}

describe('subgraphManager（单例）', () => {
  beforeEach(() => {
    subgraphManager.clear();
  });

  it('register + get', () => {
    subgraphManager.register(makeSg('sg_1', '合成'));
    const sg = subgraphManager.get('sg_1');
    expect(sg?.name).toBe('合成');
  });

  it('has', () => {
    expect(subgraphManager.has('sg_1')).toBe(false);
    subgraphManager.register(makeSg('sg_1'));
    expect(subgraphManager.has('sg_1')).toBe(true);
  });

  it('list', () => {
    subgraphManager.register(makeSg('sg_1'));
    subgraphManager.register(makeSg('sg_2'));
    expect(subgraphManager.list()).toHaveLength(2);
  });

  it('remove', () => {
    subgraphManager.register(makeSg('sg_1'));
    subgraphManager.remove('sg_1');
    expect(subgraphManager.has('sg_1')).toBe(false);
  });

  it('detectCycle：无环返回 false', () => {
    subgraphManager.register(makeSg('sg_1'));
    expect(subgraphManager.detectCycle('sg_1', 'sg_2')).toBe(false);
  });

  it('detectCycle：sg_2 含 sg_1 子图节点，把 sg_1 放入 sg_2 会成环', () => {
    subgraphManager.register(makeSg('sg_1'));
    // sg_2 内部有一个 subgraph 节点引用 sg_1
    const sg2: SubgraphDefinition = {
      id: 'sg_2',
      name: 'parent',
      nodes: [],
      edges: [],
      portMappings: [],
    };
    // 用 register + 手动塞节点的方式构造引用链
    subgraphManager.register({
      ...sg2,
      nodes: [
        {
          id: 'n_in_sg2',
          type: 'subgraph',
          position: { x: 0, y: 0 },
          data: {
            nodeId: 'n_in_sg2',
            label: 'child',
            note: '',
            disabled: false,
            kind: 'subgraph',
            subgraphId: 'sg_1',
            subgraphName: '',
            customTypeId: null,
            customFields: {},
            collapsed: false,
            codeLocked: false,
          },
          ports: [],
          selected: false,
        } as never,
      ],
    });
    // 把 sg_1 放入 sg_2 → sg_1 → sg_2 → sg_1 成环
    expect(subgraphManager.detectCycle('sg_2', 'sg_1')).toBe(true);
  });

  it('serializeAll + deserializeAll 往返', () => {
    subgraphManager.register(makeSg('sg_1', 'A'));
    const json = subgraphManager.serializeAll();
    subgraphManager.clear();
    const result = subgraphManager.deserializeAll(json);
    expect(result.ok).toBe(true);
    expect(subgraphManager.get('sg_1')?.name).toBe('A');
  });

  it('deserializeAll 非法 JSON 返回 error', () => {
    const result = subgraphManager.deserializeAll('not json');
    expect(result.ok).toBe(false);
  });
});
