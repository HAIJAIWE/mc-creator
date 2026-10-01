import { describe, it, expect } from 'vitest';
import {
  LOCAL_ID_PATTERN,
  RESOURCE_ID_PATTERN,
  LOCAL_ID_ERROR,
  RESOURCE_ID_ERROR,
  validateIdField,
} from './idRules.js';

/**
 * ID 规则回归防护。
 *
 * 这两类 ID 语义相反，历史上因为共用一套「resourceId」口径，
 * 导致在抽屉里编辑定义型 ID 时会写入 `mod:x`，进而使节点图存不下 / 生成失败。
 * 本文件把两类规则分别锁死。
 */
describe('idRules：两类 ID 的取值规则', () => {
  describe('localId（定义型：本 mod 自身内容标识）', () => {
    it('接受裸 id', () => {
      for (const ok of ['ruby', 'ruby_sword', 'a_b_c2', 'x']) {
        expect(validateIdField('localId', ok), ok).toBeUndefined();
      }
      expect(LOCAL_ID_PATTERN.test('a_b_c')).toBe(true);
    });

    it('拒绝带命名空间的值（这正是历史上导致节点图存不下的原因）', () => {
      expect(validateIdField('localId', 'mymod:ruby')).toBe(LOCAL_ID_ERROR);
    });

    it('拒绝大写 / 连字符 / 空格 / 点号', () => {
      for (const bad of ['Ruby', 'ruby-sword', 'ruby sword', 'ruby.ore']) {
        expect(validateIdField('localId', bad), bad).toBe(LOCAL_ID_ERROR);
      }
    });

    it('空值交给必填校验处理，不报格式错误', () => {
      expect(validateIdField('localId', '')).toBeUndefined();
    });
  });

  describe('resourceId（引用型：指向其他 mod / 原版）', () => {
    it('接受 namespace:path', () => {
      for (const ok of ['minecraft:iron_ingot', 'create:cogwheel', 'mymod:a/b']) {
        expect(validateIdField('resourceId', ok), ok).toBeUndefined();
      }
      expect(RESOURCE_ID_PATTERN.test('mymod:a/b')).toBe(true);
    });

    it('拒绝缺少命名空间的值', () => {
      expect(validateIdField('resourceId', 'iron_ingot')).toBe(RESOURCE_ID_ERROR);
    });

    it('拒绝空命名空间 / 空路径 / 大写', () => {
      for (const bad of [':iron_ingot', 'minecraft:', 'Minecraft:iron']) {
        expect(validateIdField('resourceId', bad), bad).toBe(RESOURCE_ID_ERROR);
      }
    });

    it('空值交给必填校验处理', () => {
      expect(validateIdField('resourceId', '')).toBeUndefined();
    });
  });

  it('非 ID 类型一律不校验（避免误伤普通文本字段）', () => {
    const nonIdTypes = [
      'text',
      'number',
      'dropdown',
      'noderef',
      'color',
      'nbt',
      'segmented',
      'code',
      'list',
    ] as const;
    for (const t of nonIdTypes) {
      expect(validateIdField(t, 'ANY:THING goes'), t).toBeUndefined();
    }
  });

  it('两类规则互斥（防止口径被合并回同一种）', () => {
    // 定义型不接受命名空间
    expect(validateIdField('localId', 'mymod:x')).toBe(LOCAL_ID_ERROR);
    // 引用型不接受裸名
    expect(validateIdField('resourceId', 'x')).toBe(RESOURCE_ID_ERROR);
    // 错误文案不同，便于用户区分该填哪种
    expect(LOCAL_ID_ERROR).not.toBe(RESOURCE_ID_ERROR);
  });
});
