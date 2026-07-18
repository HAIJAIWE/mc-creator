import { describe, it, expect } from 'vitest';
import {
  TEMPLATES_BY_TYPE,
  MOD_TEMPLATES,
  DATAPACK_TEMPLATES,
  MODPACK_TEMPLATES,
  SERVER_TEMPLATES,
  LAUNCHER_TEMPLATES,
  SKIN_TEMPLATES,
  RESOURCE_PACK_TEMPLATES,
  KUBEJS_TEMPLATES,
  CRAFTTWEAKER_TEMPLATES,
} from './index.js';
import type { SpecTemplate, GeneratorType } from './types.js';

// 所有合法的生成器类型
const ALL_TYPES: GeneratorType[] = [
  'mod',
  'datapack',
  'modpack',
  'server',
  'launcher',
  'skin',
  'resource_pack',
  'kubejs',
  'crafttweaker',
];

describe('SpecTemplate 类型', () => {
  it('SpecTemplate 字段结构正确', () => {
    const t: SpecTemplate = {
      id: 'test-id',
      title: '测试',
      description: '描述',
    };
    expect(t.id).toBe('test-id');
    expect(t.title).toBe('测试');
    expect(t.description).toBe('描述');
    expect(t.icon).toBeUndefined();
  });
});

describe('TEMPLATES_BY_TYPE', () => {
  it('包含全部 9 种生成器类型', () => {
    for (const t of ALL_TYPES) {
      expect(TEMPLATES_BY_TYPE).toHaveProperty(t);
      expect(Array.isArray(TEMPLATES_BY_TYPE[t])).toBe(true);
    }
  });

  it('每种类型至少有 3 个模板', () => {
    for (const t of ALL_TYPES) {
      const arr = TEMPLATES_BY_TYPE[t];
      expect(arr.length, `${t} 类型应至少有 3 个模板，实际 ${arr.length}`).toBeGreaterThanOrEqual(
        3,
      );
    }
  });

  it('所有模板都有非空的 id / title / description', () => {
    for (const t of ALL_TYPES) {
      for (const tpl of TEMPLATES_BY_TYPE[t]) {
        expect(tpl.id.length).toBeGreaterThan(0);
        expect(tpl.title.length).toBeGreaterThan(0);
        expect(tpl.description.length).toBeGreaterThan(0);
      }
    }
  });

  it('所有模板的 id 全局唯一', () => {
    const ids = new Set<string>();
    const all = [
      ...MOD_TEMPLATES,
      ...DATAPACK_TEMPLATES,
      ...MODPACK_TEMPLATES,
      ...SERVER_TEMPLATES,
      ...LAUNCHER_TEMPLATES,
      ...SKIN_TEMPLATES,
      ...RESOURCE_PACK_TEMPLATES,
      ...KUBEJS_TEMPLATES,
      ...CRAFTTWEAKER_TEMPLATES,
    ];
    for (const tpl of all) {
      expect(ids.has(tpl.id), `重复的模板 id: ${tpl.id}`).toBe(false);
      ids.add(tpl.id);
    }
    expect(ids.size).toBe(all.length);
  });

  it('mod 类型包含「矿物+工具」模板，且描述具体可用', () => {
    const oreTools = MOD_TEMPLATES.find((t) => t.id === 'mod-ore-tools');
    expect(oreTools).toBeDefined();
    // 描述应当包含红宝石、工具、装备等关键词
    expect(oreTools!.description).toMatch(/红宝石/);
    expect(oreTools!.description).toMatch(/工具/);
    expect(oreTools!.description.length).toBeGreaterThan(50);
  });
});
