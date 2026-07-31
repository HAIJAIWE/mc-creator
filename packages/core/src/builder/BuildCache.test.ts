import { describe, it, expect, beforeEach } from 'vitest';
import {
  BuildCache,
  hashContent,
  hashCategory,
  diffFiles,
  filesToMap,
  type BuildCacheSnapshot,
} from './BuildCache.js';
import type { FileNode } from '@mc-creator/shared';

// === 哈希函数测试 ===

describe('hashContent', () => {
  it('相同输入产出相同哈希', () => {
    expect(hashContent({ a: 1, b: 2 })).toBe(hashContent({ a: 1, b: 2 }));
  });

  it('对象 key 顺序不影响哈希（稳定序列化）', () => {
    expect(hashContent({ a: 1, b: 2 })).toBe(hashContent({ b: 2, a: 1 }));
  });

  it('内容不同则哈希不同', () => {
    expect(hashContent({ a: 1 })).not.toBe(hashContent({ a: 2 }));
    expect(hashContent({ a: 1 })).not.toBe(hashContent({ a: 1, b: 2 }));
  });

  it('基本类型哈希稳定', () => {
    expect(hashContent('hello')).toBe(hashContent('hello'));
    expect(hashContent(42)).toBe(hashContent(42));
    expect(hashContent(true)).toBe(hashContent(true));
    expect(hashContent(null)).toBe(hashContent(null));
  });

  it('数组顺序影响哈希（顺序是有意义信息）', () => {
    expect(hashContent([1, 2, 3])).not.toBe(hashContent([3, 2, 1]));
  });

  it('嵌套对象稳定哈希', () => {
    const a = { x: { y: { z: 1 } }, list: [1, 2] };
    const b = { list: [1, 2], x: { y: { z: 1 } } };
    expect(hashContent(a)).toBe(hashContent(b));
  });

  it('undefined 字段不影响哈希（JSON 语义）', () => {
    expect(hashContent({ a: 1, b: undefined })).toBe(hashContent({ a: 1 }));
  });

  it('顶层 undefined 等同于 null（健壮性：spec 缺字段时不崩溃）', () => {
    expect(hashContent(undefined)).toBe(hashContent(null));
    // 数组中含 undefined 也不崩溃，且与 null 产出相同哈希
    expect(hashContent([undefined])).toBe(hashContent([null]));
  });

  it('哈希为 8 位十六进制字符串', () => {
    expect(hashContent('test')).toMatch(/^[0-9a-f]{8}$/);
  });
});

describe('hashCategory', () => {
  it('空数组返回固定标识', () => {
    expect(hashCategory([])).toBe('empty');
  });

  it('相同元素列表产出相同哈希', () => {
    const items = [{ id: 'a' }, { id: 'b' }];
    expect(hashCategory(items)).toBe(hashCategory(items));
    expect(hashCategory([{ id: 'a' }, { id: 'b' }])).toBe(hashCategory(items));
  });

  it('单个元素内容变化 → 类别哈希变化', () => {
    const v1 = [{ id: 'a', name: 'A' }];
    const v2 = [{ id: 'a', name: 'B' }];
    expect(hashCategory(v1)).not.toBe(hashCategory(v2));
  });

  it('元素顺序变化 → 类别哈希变化', () => {
    const v1 = [{ id: 'a' }, { id: 'b' }];
    const v2 = [{ id: 'b' }, { id: 'a' }];
    expect(hashCategory(v1)).not.toBe(hashCategory(v2));
  });

  it('元素数量变化 → 类别哈希变化', () => {
    const v1 = [{ id: 'a' }];
    const v2 = [{ id: 'a' }, { id: 'b' }];
    expect(hashCategory(v1)).not.toBe(hashCategory(v2));
  });
});

// === BuildCache 类测试 ===

describe('BuildCache', () => {
  let cache: BuildCache;

  beforeEach(() => {
    cache = new BuildCache();
  });

  describe('buildKey', () => {
    it('构造全局唯一的缓存键', () => {
      // P1 dogfood：分隔符从 :: 改为 \0 防碰撞
      expect(BuildCache.buildKey('mod_a', 'fabric', 'items')).toBe('mod_a\0fabric\0items');
      expect(BuildCache.buildKey('mod_a', 'fabric', 'items')).not.toBe(
        BuildCache.buildKey('mod_a', 'neoforge', 'items'),
      );
      expect(BuildCache.buildKey('mod_a', 'fabric', 'items')).not.toBe(
        BuildCache.buildKey('mod_b', 'fabric', 'items'),
      );
      expect(BuildCache.buildKey('mod_a', 'fabric', 'items')).not.toBe(
        BuildCache.buildKey('mod_a', 'fabric', 'blocks'),
      );
    });
    it('拒绝空字符串参数', () => {
      expect(() => BuildCache.buildKey('', 'fabric', 'items')).toThrow();
      expect(() => BuildCache.buildKey('mod', '', 'items')).toThrow();
      expect(() => BuildCache.buildKey('mod', 'fabric', '')).toThrow();
    });
    it('分隔符碰撞安全：含 :: 的 modId 不产生歧义', () => {
      const k1 = BuildCache.buildKey('a', 'b', 'c');
      const k2 = BuildCache.buildKey('a::b', 'c', 'd');
      expect(k1).not.toBe(k2);
    });
  });

  describe('getCached / setCache', () => {
    it('首次查询返回 undefined（无缓存）', () => {
      const key = BuildCache.buildKey('m', 'fabric', 'items');
      expect(cache.getCached(key, 'hash1')).toBeUndefined();
    });

    it('哈希相同 → 命中缓存返回文件', () => {
      const key = BuildCache.buildKey('m', 'fabric', 'items');
      const files: FileNode[] = [{ path: 'ModItems.java', content: '...' }];
      cache.setCache(key, 'hash1', files);

      const hit = cache.getCached(key, 'hash1');
      expect(hit).toEqual(files);
    });

    it('哈希不同 → 未命中（需要重新生成）', () => {
      const key = BuildCache.buildKey('m', 'fabric', 'items');
      cache.setCache(key, 'hash1', [{ path: 'ModItems.java', content: 'old' }]);

      expect(cache.getCached(key, 'hash2')).toBeUndefined();
    });

    it('更新哈希后用新哈希命中', () => {
      const key = BuildCache.buildKey('m', 'fabric', 'items');
      cache.setCache(key, 'hash1', [{ path: 'a.java', content: 'old' }]);
      cache.setCache(key, 'hash2', [{ path: 'a.java', content: 'new' }]);

      expect(cache.getCached(key, 'hash1')).toBeUndefined();
      expect(cache.getCached(key, 'hash2')).toEqual([{ path: 'a.java', content: 'new' }]);
    });

    it('缓存的文件是深拷贝，外部修改不影响缓存', () => {
      const key = BuildCache.buildKey('m', 'fabric', 'items');
      const files: FileNode[] = [{ path: 'a.java', content: 'original' }];
      cache.setCache(key, 'h', files);

      // 外部修改原数组
      files[0].content = 'mutated';
      files.push({ path: 'b.java', content: 'extra' });

      const hit = cache.getCached(key, 'h');
      expect(hit).toEqual([{ path: 'a.java', content: 'original' }]);
    });
  });

  describe('snapshot / load', () => {
    it('空缓存快照为空对象', () => {
      expect(cache.snapshot()).toEqual({});
    });

    it('快照可序列化为 JSON 且能还原', () => {
      const key = BuildCache.buildKey('m', 'fabric', 'items');
      cache.setCache(key, 'h1', [{ path: 'a.java', content: 'x' }]);

      const json = JSON.stringify(cache.snapshot());
      const restored: BuildCacheSnapshot = JSON.parse(json);

      const cache2 = new BuildCache();
      cache2.load(restored);

      expect(cache2.getCached(key, 'h1')).toEqual([{ path: 'a.java', content: 'x' }]);
    });

    it('load 清空旧缓存再加载', () => {
      cache.setCache(BuildCache.buildKey('m', 'fabric', 'items'), 'h1', [
        { path: 'a.java', content: 'old' },
      ]);

      const newSnap: BuildCacheSnapshot = {
        [BuildCache.buildKey('m', 'fabric', 'blocks')]: {
          hash: 'h2',
          files: [{ path: 'b.java', content: 'new' }],
        },
      };
      cache.load(newSnap);

      // 旧的 items 缓存被清空
      expect(cache.has(BuildCache.buildKey('m', 'fabric', 'items'))).toBe(false);
      expect(cache.has(BuildCache.buildKey('m', 'fabric', 'blocks'))).toBe(true);
    });

    it('load undefined 等价于清空', () => {
      cache.setCache(BuildCache.buildKey('m', 'fabric', 'items'), 'h', [
        { path: 'a.java', content: 'x' },
      ]);
      cache.load(undefined);
      expect(cache.size).toBe(0);
    });
  });

  describe('clear / size / has', () => {
    it('size 返回条目数', () => {
      expect(cache.size).toBe(0);
      cache.setCache(BuildCache.buildKey('m', 'fabric', 'items'), 'h', [
        { path: 'a', content: '' },
      ]);
      expect(cache.size).toBe(1);
      cache.setCache(BuildCache.buildKey('m', 'fabric', 'blocks'), 'h', [
        { path: 'b', content: '' },
      ]);
      expect(cache.size).toBe(2);
    });

    it('clear 清空所有条目', () => {
      cache.setCache(BuildCache.buildKey('m', 'fabric', 'items'), 'h', [
        { path: 'a', content: '' },
      ]);
      cache.clear();
      expect(cache.size).toBe(0);
    });

    it('has 判断键是否存在（不论哈希是否匹配）', () => {
      const key = BuildCache.buildKey('m', 'fabric', 'items');
      expect(cache.has(key)).toBe(false);
      cache.setCache(key, 'h', [{ path: 'a', content: '' }]);
      expect(cache.has(key)).toBe(true);
    });
  });
});

// === 文件级增量工具测试 ===

describe('diffFiles / filesToMap', () => {
  it('filesToMap 把 FileNode[] 转为 path→content 映射', () => {
    const map = filesToMap([
      { path: 'a.java', content: 'AAA' },
      { path: 'b.java', content: 'BBB' },
    ]);
    expect(map.get('a.java')).toBe('AAA');
    expect(map.get('b.java')).toBe('BBB');
    expect(map.size).toBe(2);
  });

  it('diffFiles 只返回内容变化的文件', () => {
    const current: FileNode[] = [
      { path: 'a.java', content: 'AAA' }, // 未变
      { path: 'b.java', content: 'BBB-new' }, // 变化
      { path: 'c.java', content: 'CCC' }, // 新增
    ];
    const previous = filesToMap([
      { path: 'a.java', content: 'AAA' },
      { path: 'b.java', content: 'BBB-old' },
    ]);

    const diff = diffFiles(current, previous);
    expect(diff.written.map((f) => f.path)).toEqual(['b.java', 'c.java']);
    expect(diff.deleted).toEqual([]);
  });

  it('所有文件都未变时返回空 written', () => {
    const current: FileNode[] = [{ path: 'a.java', content: 'AAA' }];
    const previous = filesToMap(current);
    const diff = diffFiles(current, previous);
    expect(diff.written).toEqual([]);
    expect(diff.deleted).toEqual([]);
  });

  it('previous 为空映射时返回所有文件为 written', () => {
    const current: FileNode[] = [{ path: 'a.java', content: 'AAA' }];
    const diff = diffFiles(current, new Map());
    expect(diff.written).toEqual(current);
    expect(diff.deleted).toEqual([]);
  });

  it('检测已删除的文件', () => {
    const current: FileNode[] = [{ path: 'a.java', content: 'AAA' }];
    const previous = filesToMap([
      { path: 'a.java', content: 'AAA' },
      { path: 'b.java', content: 'BBB' }, // b.java 在 current 中已不存在
    ]);
    const diff = diffFiles(current, previous);
    expect(diff.written).toEqual([]);
    expect(diff.deleted).toEqual(['b.java']);
  });
});
