import type { BaseTab } from '../../shared/index.js';
import type { CraftTweakerSpec } from '@mc-creator/shared';
import { Download, FileText, Boxes, Tag, Flag, Languages, BookOpen } from 'lucide-react';

/** CraftTweaker 预览面板的分类 tab */
export type CraftTweakerTab =
  'recipes' | 'tags' | 'events' | 'tooltips' | 'lang' | 'metadata' | 'export';

export type RecipeTypeFilter =
  'all' | 'shaped' | 'shapeless' | 'smelting' | 'stonecutting' | 'custom';
export type TagTypeFilter = 'all' | 'item' | 'block' | 'entity_type' | 'fluid';

export const TABS: BaseTab<CraftTweakerTab>[] = [
  { key: 'recipes', label: '配方', icon: Boxes },
  { key: 'tags', label: '标签', icon: Tag },
  { key: 'events', label: '事件', icon: Flag },
  { key: 'tooltips', label: '工具提示', icon: BookOpen },
  { key: 'lang', label: '语言', icon: Languages },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

export const HIDE_COUNT_TABS = new Set<CraftTweakerTab>(['metadata', 'export']);

export const RECIPE_TYPE_LABEL: Record<string, string> = {
  shaped: '有序合成',
  shapeless: '无序合成',
  smelting: '熔炼',
  stonecutting: '切石',
  custom: '自定义',
};

export const RECIPE_TYPE_COLOR: Record<string, string> = {
  shaped: 'bg-blue-500/20 text-blue-400',
  shapeless: 'bg-green-500/20 text-green-400',
  smelting: 'bg-orange-500/20 text-orange-400',
  stonecutting: 'bg-yellow-500/20 text-yellow-400',
  custom: 'bg-purple-500/20 text-purple-400',
};

export const TAG_TYPE_LABEL: Record<string, string> = {
  item: '物品',
  block: '方块',
  entity_type: '实体',
  fluid: '流体',
};

export const TAG_TYPE_COLOR: Record<string, string> = {
  item: 'bg-blue-500/20 text-blue-400',
  block: 'bg-green-500/20 text-green-400',
  entity_type: 'bg-orange-500/20 text-orange-400',
  fluid: 'bg-cyan-500/20 text-cyan-400',
};

/** 语言条目展开后的一行 */
export interface LangRow {
  lang: string;
  key: string;
  value: string;
}

/** 计算 tab 计数 */
export function countByTab(
  ct: CraftTweakerSpec,
  tab: CraftTweakerTab,
  langEntries: number,
): number {
  if (tab === 'recipes') return ct.recipes.length;
  if (tab === 'tags') return ct.tags.length;
  if (tab === 'events') return ct.events.length;
  if (tab === 'tooltips') return ct.tooltips.length;
  if (tab === 'lang') return langEntries;
  return 0;
}

/** 统计指定类型的标签数量 */
export function countTagType(ct: CraftTweakerSpec, type: string): number {
  return ct.tags.filter((t) => t.type === type).length;
}

/** 取 tab 的展示 label */
export function tabLabel(tab: CraftTweakerTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}
