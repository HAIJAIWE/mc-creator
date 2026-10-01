import { findDuplicates } from '../../shared/index.js';
import type { ConflictGroup } from '../../shared/index.js';
import type { CraftTweakerSpec } from '@mc-creator/shared';

/** CraftTweaker 预览面板的冲突检测分组（ID 重复） */
export const CT_CONFLICT_GROUPS: ConflictGroup<CraftTweakerSpec>[] = [
  {
    key: 'duplicateRecipeIds',
    label: '配方 ID 重复',
    detect: (ct) => findDuplicates(ct.recipes, (r) => r.id),
  },
  {
    key: 'duplicateTagIds',
    label: '标签 ID 重复',
    detect: (ct) => findDuplicates(ct.tags, (t) => t.id),
  },
  {
    key: 'duplicateEventIds',
    label: '事件 ID 重复',
    detect: (ct) => findDuplicates(ct.events, (e) => e.id),
  },
  {
    key: 'duplicateTooltipIds',
    label: '工具提示 ID 重复',
    detect: (ct) => findDuplicates(ct.tooltips, (t) => t.itemId),
  },
];
