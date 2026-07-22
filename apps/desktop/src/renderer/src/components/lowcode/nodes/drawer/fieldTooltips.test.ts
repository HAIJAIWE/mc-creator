import { describe, it, expect } from 'vitest';
import { FIELD_TOOLTIPS, getTooltip } from './fieldTooltips.js';

describe('fieldTooltips', () => {
  it('item.itemId 有解释且包含 modid:path', () => {
    expect(getTooltip('item', 'itemId')).toContain('modid:path');
  });

  it('item.maxDamage 有解释', () => {
    expect(getTooltip('item', 'maxDamage')).toBeTruthy();
  });

  it('block.hardness 有解释', () => {
    expect(getTooltip('block', 'hardness')).toBeTruthy();
  });

  it('recipe.recipeType 有解释', () => {
    expect(getTooltip('recipe', 'recipeType')).toBeTruthy();
  });

  it('未知字段返回 undefined', () => {
    expect(getTooltip('item', 'nonexistent')).toBeUndefined();
  });

  it('common fallback：label 字段在所有 kind 下都有解释', () => {
    expect(getTooltip('item', 'label')).toContain('显示名');
    expect(getTooltip('block', 'label')).toContain('显示名');
    expect(getTooltip('recipe', 'label')).toContain('显示名');
  });

  it('kind 专属 tooltip 优先于 common fallback', () => {
    // item.note 有专属解释
    const itemNote = getTooltip('item', 'note');
    expect(itemNote).toBeTruthy();
    // common.note 也存在
    expect(FIELD_TOOLTIPS['common.note']).toBeTruthy();
  });

  it('覆盖所有 item 字段 schema 的 key', () => {
    const itemKeys = [
      'itemId',
      'displayName',
      'category',
      'rarity',
      'maxStackSize',
      'maxDamage',
      'glow',
      'note',
    ];
    for (const k of itemKeys) {
      expect(getTooltip('item', k), `item.${k} should have tooltip`).toBeTruthy();
    }
  });

  it('覆盖所有 machine 字段 schema 的 key', () => {
    const machineKeys = [
      'machineId',
      'displayName',
      'energyCapacity',
      'maxEnergyTransfer',
      'inputSlots',
      'outputSlots',
      'defaultProcessTime',
      'defaultEnergyPerTick',
      'guiWidth',
      'guiHeight',
    ];
    for (const k of machineKeys) {
      expect(getTooltip('machine', k), `machine.${k} should have tooltip`).toBeTruthy();
    }
  });
});
