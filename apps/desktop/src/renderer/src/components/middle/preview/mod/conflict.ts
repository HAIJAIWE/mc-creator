import { findDuplicates } from '../../shared/index.js';
import type { ConflictGroup } from '../../shared/index.js';
import type { ModSpec } from '@mc-creator/shared';

/** Mod 预览面板的冲突检测分组（ID 重复） */
export const MOD_CONFLICT_GROUPS: ConflictGroup<ModSpec>[] = [
  {
    key: 'duplicateItemIds',
    label: '物品 ID 重复',
    detect: (m) => findDuplicates(m.items, (i) => i.id),
  },
  {
    key: 'duplicateBlockIds',
    label: '方块 ID 重复',
    detect: (m) => findDuplicates(m.blocks, (b) => b.id),
  },
  {
    key: 'duplicateDeps',
    label: '依赖重复',
    detect: (m) => findDuplicates(m.dependencies, (d) => d.modId),
  },
];
