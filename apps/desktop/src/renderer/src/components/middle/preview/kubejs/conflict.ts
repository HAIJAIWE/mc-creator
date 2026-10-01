import { findDuplicates } from '../../shared/index.js';
import type { ConflictGroup } from '../../shared/index.js';
import type { KubejsSpec } from '@mc-creator/shared';

/** KubeJS 预览面板的冲突检测分组（ID 重复） */
export const KJ_CONFLICT_GROUPS: ConflictGroup<KubejsSpec>[] = [
  {
    key: 'duplicateRecipeIds',
    label: '配方 ID 重复',
    detect: (kj) => findDuplicates(kj.recipes, (r) => r.id),
  },
  {
    key: 'duplicateTagIds',
    label: '标签 ID 重复',
    detect: (kj) => findDuplicates(kj.tags, (t) => t.id),
  },
  {
    key: 'duplicateEventIds',
    label: '事件 ID 重复',
    detect: (kj) => findDuplicates(kj.events, (e) => e.id),
  },
  {
    key: 'duplicateTooltipIds',
    label: '工具提示 ID 重复',
    detect: (kj) => findDuplicates(kj.tooltips, (t) => t.itemId),
  },
  {
    key: 'duplicateRegistryIds',
    label: '注册表 ID 重复',
    detect: (kj) => findDuplicates(kj.registry, (r) => r.id),
  },
];
