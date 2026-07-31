import { describe, it, expect, beforeEach } from 'vitest';
import { useSpecHistoryStore, type SpecVersion } from './spec-history-store.js';

describe('spec-history-store', () => {
  beforeEach(() => {
    // 重置到初始状态
    useSpecHistoryStore.setState({
      versions: [],
      currentIndex: -1,
      maxHistory: 20,
    });
  });

  it('初始状态为空', () => {
    const s = useSpecHistoryStore.getState();
    expect(s.versions).toEqual([]);
    expect(s.currentIndex).toBe(-1);
    expect(s.maxHistory).toBe(20);
  });

  it('pushVersion 添加版本并更新 currentIndex', () => {
    useSpecHistoryStore.getState().pushVersion({
      spec: { a: 1 },
      description: '第一个版本',
      generatorType: 'mod',
    });

    const s = useSpecHistoryStore.getState();
    expect(s.versions).toHaveLength(1);
    expect(s.currentIndex).toBe(0);

    const v = s.versions[0] as SpecVersion;
    expect(v.spec).toEqual({ a: 1 });
    expect(v.description).toBe('第一个版本');
    expect(v.generatorType).toBe('mod');
    expect(v.id).toBeTruthy();
    expect(v.timestamp).toBeGreaterThan(0);
    expect(v.label).toMatch(/^v1 · \d{2}:\d{2}:\d{2}$/);
  });

  it('pushVersion 生成唯一 id', () => {
    useSpecHistoryStore.getState().pushVersion({
      spec: {},
      description: 'a',
      generatorType: 'mod',
    });
    useSpecHistoryStore.getState().pushVersion({
      spec: {},
      description: 'b',
      generatorType: 'mod',
    });

    const ids = useSpecHistoryStore.getState().versions.map((v) => v.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('rollbackTo 返回对应 spec 并更新 currentIndex', () => {
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v1', description: '', generatorType: 'mod' });
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v2', description: '', generatorType: 'mod' });
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v3', description: '', generatorType: 'mod' });

    const state = useSpecHistoryStore.getState();
    const id = state.versions[0]!.id;
    const spec = state.rollbackTo(id);

    expect(spec).toBe('v1');
    expect(useSpecHistoryStore.getState().currentIndex).toBe(0);
  });

  it('rollbackTo 对不存在的 id 返回 null', () => {
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v1', description: '', generatorType: 'mod' });
    const spec = useSpecHistoryStore.getState().rollbackTo('nonexistent-id');
    expect(spec).toBeNull();
  });

  it('removeVersion 删除指定版本', () => {
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v1', description: '', generatorType: 'mod' });
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v2', description: '', generatorType: 'mod' });

    const id = useSpecHistoryStore.getState().versions[0]!.id;
    useSpecHistoryStore.getState().removeVersion(id);

    const s = useSpecHistoryStore.getState();
    expect(s.versions).toHaveLength(1);
    expect(s.versions[0]!.spec).toBe('v2');
  });

  it('removeVersion 对不存在 id 不报错', () => {
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v1', description: '', generatorType: 'mod' });
    expect(() => useSpecHistoryStore.getState().removeVersion('nonexistent')).not.toThrow();
    expect(useSpecHistoryStore.getState().versions).toHaveLength(1);
  });

  it('clearHistory 清空所有版本', () => {
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v1', description: '', generatorType: 'mod' });
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v2', description: '', generatorType: 'mod' });

    useSpecHistoryStore.getState().clearHistory();

    const s = useSpecHistoryStore.getState();
    expect(s.versions).toEqual([]);
    expect(s.currentIndex).toBe(-1);
  });

  it('pushVersion 超过 maxHistory 时丢弃最早版本', () => {
    useSpecHistoryStore.setState({ maxHistory: 3 });
    for (let i = 1; i <= 5; i++) {
      useSpecHistoryStore.getState().pushVersion({
        spec: `v${i}`,
        description: '',
        generatorType: 'mod',
      });
    }

    const s = useSpecHistoryStore.getState();
    expect(s.versions).toHaveLength(3);
    // 保留最后 3 个：v3, v4, v5
    expect(s.versions.map((v) => v.spec)).toEqual(['v3', 'v4', 'v5']);
    expect(s.currentIndex).toBe(2);
  });

  it('removeVersion 后 currentIndex 不越界', () => {
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v1', description: '', generatorType: 'mod' });
    useSpecHistoryStore
      .getState()
      .pushVersion({ spec: 'v2', description: '', generatorType: 'mod' });

    // currentIndex 当前为 1，删除后只剩 1 个版本（index 0）
    const id = useSpecHistoryStore.getState().versions[1]!.id;
    useSpecHistoryStore.getState().removeVersion(id);

    expect(useSpecHistoryStore.getState().currentIndex).toBe(0);
  });
});
