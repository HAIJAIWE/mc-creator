// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { buildExport, toMdTable, toMdOverview, type ExportHandler } from './exportData.js';

interface FakeSpec {
  id: string;
  name: string;
  items: { id: string; name: string }[];
}

const HANDLER: ExportHandler<FakeSpec> = {
  prefix: (s) => s.id,
  scopes: {
    all: {
      data: (s) => s,
      toMd: (s) =>
        toMdOverview(
          `# ${s.name || s.id}`,
          [`- **ID**: ${s.id}`],
          [{ heading: '物品列表', lines: [`- ${s.items.map((i) => i.id).join(', ')}`] }],
        ),
    },
    items: {
      data: (s) => s.items,
      toCsv: (s) => ['ID,Name', ...s.items.map((i) => `"${i.id}","${i.name}"`)].join('\n'),
      toMd: (s) =>
        toMdTable(
          `# ${s.name || s.id} - 物品列表`,
          `共 ${s.items.length} 个物品`,
          ['ID', '名称'],
          [...s.items.map((i) => [`\`${i.id}\``, i.name])],
        ),
    },
  },
};

const SPEC: FakeSpec = {
  id: 'demo',
  name: 'Demo Mod',
  items: [
    { id: 'ruby', name: '红宝石' },
    { id: 'sapphire', name: '蓝宝石' },
  ],
};

describe('shared/exportData', () => {
  describe('buildExport', () => {
    it('json 输出缩进 2 的序列化', () => {
      const out = buildExport(SPEC, HANDLER, 'json', 'items');
      expect(out).toEqual({
        content: JSON.stringify(SPEC.items, null, 2),
        filename: 'demo-items.json',
      });
    });

    it('csv 使用 scope.toCsv', () => {
      const out = buildExport(SPEC, HANDLER, 'csv', 'items');
      expect(out).toEqual({
        content: ['ID,Name', '"ruby","红宝石"', '"sapphire","蓝宝石"'].join('\n'),
        filename: 'demo-items.csv',
      });
    });

    it("csv 对无 toCsv 的 scope（'all'）fallback 到 JSON", () => {
      const out = buildExport(SPEC, HANDLER, 'csv', 'all');
      expect(out).toEqual({
        content: JSON.stringify(SPEC, null, 2),
        filename: 'demo-all.csv',
      });
    });

    it('markdown 使用 scope.toMd', () => {
      const out = buildExport(SPEC, HANDLER, 'markdown', 'items');
      expect(out).toEqual({
        content: toMdTable(
          '# Demo Mod - 物品列表',
          '共 2 个物品',
          ['ID', '名称'],
          [
            ['`ruby`', '红宝石'],
            ['`sapphire`', '蓝宝石'],
          ],
        ),
        filename: 'demo-items.md',
      });
    });

    it('未注册的 scope 返回 null', () => {
      expect(buildExport(SPEC, HANDLER, 'json', 'unknown')).toBeNull();
    });
  });

  describe('toMdTable', () => {
    it('生成标题/计数/表头/分隔线/行', () => {
      const md = toMdTable('# 标题', '共 1 个', ['A', 'B'], [['v1', 'v2']]);
      expect(md).toBe('# 标题\n\n共 1 个\n\n| A | B |\n|---|---|\n| v1 | v2 |');
    });
  });

  describe('toMdOverview', () => {
    it('小节间空行分隔，末尾无多余空行', () => {
      const md = toMdOverview(
        '# 标题',
        ['- **ID**: x'],
        [
          { heading: '一', lines: ['- a'] },
          { heading: '二', lines: ['- b'] },
        ],
      );
      expect(md).toBe('# 标题\n\n- **ID**: x\n\n## 一\n\n- a\n\n## 二\n\n- b');
    });
  });
});
