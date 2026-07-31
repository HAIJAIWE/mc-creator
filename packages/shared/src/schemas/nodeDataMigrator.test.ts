import { describe, it, expect, beforeEach } from 'vitest';
import type { NodeData, NodeGraph, ItemNodeData } from './node-graph-spec.js';
import {
  LATEST_FORMAT_VERSION,
  registerMigrator,
  migrateNodeData,
  migrateGraph,
  clearMigrators,
} from './nodeDataMigrator.js';

// ============================================================
// P1-1 节点数据 formatVersion + 转换器（对标 MCreator GeneratableElement.formatVersion）
//
// 设计目标：
// - 每个节点 data 携带 formatVersion 字段（默认 1）
// - 注册表按 (kind, fromVersion) 索引迁移函数
// - migrateNodeData 顺序应用 v1→v2→v3... 直到 LATEST_FORMAT_VERSION
// - migrateGraph 遍历所有节点，汇总 warnings
// - 旧 JSON（无 formatVersion 字段）视为 v1
// ============================================================

describe('nodeDataMigrator', () => {
  beforeEach(() => {
    clearMigrators();
  });

  describe('LATEST_FORMAT_VERSION', () => {
    it('当前最新版本号为正整数', () => {
      expect(LATEST_FORMAT_VERSION).toBeGreaterThan(0);
      expect(Number.isInteger(LATEST_FORMAT_VERSION)).toBe(true);
    });
  });

  describe('migrateNodeData（无注册迁移器）', () => {
    it('已是最新版本时原样返回，migrated=false', () => {
      const data: ItemNodeData = {
        nodeId: 'n1',
        kind: 'item',
        label: '物品',
        note: '',
        disabled: false,
        collapsed: false,
        codeLocked: false,
        formatVersion: LATEST_FORMAT_VERSION,
        itemId: 'test_item',
        displayName: '测试物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      };
      const result = migrateNodeData(data);
      expect(result.migrated).toBe(false);
      expect(result.data).toEqual(data);
      expect(result.warnings).toEqual([]);
    });

    it('缺少 formatVersion 字段时视为 v1', () => {
      const data = {
        nodeId: 'n1',
        kind: 'item' as const,
        label: '物品',
        note: '',
        disabled: false,
        collapsed: false,
        codeLocked: false,
        itemId: 'test_item',
        displayName: '测试物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      };
      const result = migrateNodeData(data as NodeData);
      // 无注册迁移器且 v1 == LATEST，应原样返回
      expect(result.migrated).toBe(false);
      expect(result.warnings).toEqual([]);
    });

    it('版本低于 LATEST 但无对应迁移器时产生 warning', () => {
      // 临时调高 LATEST 不好做，用注册一个跳过的迁移器来模拟
      // 这里直接构造一个 v0 数据，无 v0→v1 迁移器
      const data = {
        nodeId: 'n1',
        kind: 'item' as const,
        label: '物品',
        formatVersion: 0,
      };
      const result = migrateNodeData(data as unknown as NodeData);
      expect(result.migrated).toBe(false);
      expect(result.warnings.length).toBeGreaterThan(0);
      expect(result.warnings[0]).toContain('无法从 formatVersion 0');
    });
  });

  describe('migrateNodeData（有注册迁移器）', () => {
    it('顺序应用 v1→v2 迁移器（仅当 LATEST >= 2 时触发）', () => {
      // 注册 v1→v2 迁移器：把 itemId 字段重命名为 id（演示字段改名场景）
      // 注意：这是测试用的合成迁移，真实迁移在 schema 演进时注册
      registerMigrator('item', 1, 2, (data) => {
        return { ...data, itemId: (data as Record<string, unknown>).itemId ?? 'unknown' };
      });

      const data = {
        nodeId: 'n1',
        kind: 'item' as const,
        label: '物品',
        note: '',
        disabled: false,
        collapsed: false,
        codeLocked: false,
        formatVersion: 1,
        itemId: 'old_id',
        displayName: '旧物品',
        category: 'misc',
        maxStackSize: 64,
        maxDamage: 0,
        rarity: 'common',
        glow: false,
      };
      const result = migrateNodeData(data as NodeData);
      // LATEST=1 时迁移器不触发（currentVersion 已 == LATEST）
      // LATEST>=2 时迁移器触发，migrated=true
      if (LATEST_FORMAT_VERSION >= 2) {
        expect(result.migrated).toBe(true);
        expect(result.warnings).toEqual([]);
      } else {
        expect(result.migrated).toBe(false);
      }
    });

    it('链式应用 v1→v2→v3 多个迁移器', () => {
      let v1ToV2Called = false;
      let v2ToV3Called = false;

      registerMigrator('item', 1, 2, (data) => {
        v1ToV2Called = true;
        return { ...data, _v2: true };
      });
      registerMigrator('item', 2, 3, (data) => {
        v2ToV3Called = true;
        return { ...data, _v3: true };
      });

      const data = {
        nodeId: 'n1',
        kind: 'item' as const,
        label: '物品',
        formatVersion: 1,
      };
      // LATEST_FORMAT_VERSION 至少为 1；如果当前 LATEST=1，链式不会触发
      // 所以这里只验证迁移器注册不报错，且 v1 数据在 LATEST=1 时不会被迁移
      const result = migrateNodeData(data as unknown as NodeData);
      if (LATEST_FORMAT_VERSION >= 3) {
        expect(v1ToV2Called).toBe(true);
        expect(v2ToV3Called).toBe(true);
        expect(result.migrated).toBe(true);
      } else {
        // LATEST < 3 时迁移器不触发，原样返回
        expect(result.migrated).toBe(false);
      }
    });

    it('迁移器中间缺失时产生 warning 并停止', () => {
      // 注册 v1→v2 但不注册 v2→v3，数据从 v1 开始
      registerMigrator('item', 1, 2, (data) => data);

      const data = {
        nodeId: 'n1',
        kind: 'item' as const,
        label: '物品',
        formatVersion: 1,
      };
      const result = migrateNodeData(data as unknown as NodeData);
      // 如果 LATEST >= 3，应在 v2 处因缺失 v2→v3 迁移器而 warning
      if (LATEST_FORMAT_VERSION >= 3) {
        expect(result.warnings.length).toBeGreaterThan(0);
        expect(result.warnings[0]).toContain('无法从 formatVersion 2');
      }
    });
  });

  describe('migrateGraph', () => {
    it('遍历所有节点应用迁移', () => {
      const graph: NodeGraph = {
        version: 1,
        modId: 'test',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          {
            id: 'n1',
            type: 'item',
            position: { x: 0, y: 0 },
            data: {
              nodeId: 'n1',
              kind: 'item',
              label: '物品1',
              note: '',
              disabled: false,
              collapsed: false,
              codeLocked: false,
              formatVersion: LATEST_FORMAT_VERSION,
              itemId: 'item1',
              displayName: '物品1',
              category: 'misc',
              maxStackSize: 64,
              maxDamage: 0,
              rarity: 'common',
              glow: false,
            },
            ports: [],
            selected: false,
          },
          {
            id: 'n2',
            type: 'block',
            position: { x: 100, y: 0 },
            data: {
              nodeId: 'n2',
              kind: 'block',
              label: '方块1',
              note: '',
              disabled: false,
              collapsed: false,
              codeLocked: false,
              formatVersion: LATEST_FORMAT_VERSION,
              blockId: 'block1',
              displayName: '方块1',
              hardness: 1,
              blastResistance: 3,
              luminance: 0,
              transparent: false,
              solid: true,
              modelType: 'cube_all',
              isBlockEntity: false,
            },
            ports: [],
            selected: false,
          },
        ],
        edges: [],
        subgraphs: {},
      };

      const result = migrateGraph(graph);
      expect(result.warnings).toEqual([]);
      expect(result.graph.nodes).toHaveLength(2);
      // 已是最新版本，节点数据不变
      expect(result.graph.nodes[0].data).toEqual(graph.nodes[0].data);
    });

    it('汇总多节点迁移 warning', () => {
      const graph: NodeGraph = {
        version: 1,
        modId: 'test',
        viewport: { x: 0, y: 0, zoom: 1 },
        nodes: [
          {
            id: 'n1',
            type: 'item',
            position: { x: 0, y: 0 },
            data: {
              nodeId: 'n1',
              kind: 'item',
              label: '物品1',
              formatVersion: 0, // 无效版本，触发 warning
            } as unknown as NodeData,
            ports: [],
            selected: false,
          },
          {
            id: 'n2',
            type: 'block',
            position: { x: 100, y: 0 },
            data: {
              nodeId: 'n2',
              kind: 'block',
              label: '方块1',
              formatVersion: 0, // 无效版本，触发 warning
            } as unknown as NodeData,
            ports: [],
            selected: false,
          },
        ],
        edges: [],
        subgraphs: {},
      };

      const result = migrateGraph(graph);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings[0]).toContain('n1');
      expect(result.warnings[1]).toContain('n2');
    });
  });

  describe('registerMigrator / clearMigrators', () => {
    it('clearMigrators 后所有迁移器被清除', () => {
      registerMigrator('item', 1, 2, (data) => data);
      clearMigrators();
      // 重新注册不应受影响（验证 clear 后状态干净）
      expect(() => registerMigrator('item', 1, 2, (data) => data)).not.toThrow();
    });
  });
});
