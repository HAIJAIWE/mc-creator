import type { BaseTab } from '../../shared/index.js';
import type { KubejsSpec } from '@mc-creator/shared';
import { Download, FileText, Boxes, Tag, Flag, Languages, BookOpen, Database } from 'lucide-react';

/** KubeJS 预览面板的分类 tab */
export type KubejsTab =
  'recipes' | 'tags' | 'events' | 'tooltips' | 'registry' | 'lang' | 'metadata' | 'export';

export type RecipeTypeFilter =
  'all' | 'shaped' | 'shapeless' | 'smelting' | 'stonecutting' | 'custom';
export type TagTypeFilter = 'all' | 'item' | 'block' | 'entity_type' | 'fluid' | 'function';
export type RegistryTypeFilter = 'all' | 'item' | 'block' | 'sound' | 'fluid';

export const TABS: BaseTab<KubejsTab>[] = [
  { key: 'recipes', label: '配方', icon: Boxes },
  { key: 'tags', label: '标签', icon: Tag },
  { key: 'events', label: '事件', icon: Flag },
  { key: 'tooltips', label: '工具提示', icon: BookOpen },
  { key: 'registry', label: '注册表', icon: Database },
  { key: 'lang', label: '语言', icon: Languages },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

export const HIDE_COUNT_TABS = new Set<KubejsTab>(['metadata', 'export']);

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
  function: '函数',
};

export const TAG_TYPE_COLOR: Record<string, string> = {
  item: 'bg-blue-500/20 text-blue-400',
  block: 'bg-green-500/20 text-green-400',
  entity_type: 'bg-orange-500/20 text-orange-400',
  fluid: 'bg-cyan-500/20 text-cyan-400',
  function: 'bg-pink-500/20 text-pink-400',
};

export const REGISTRY_TYPE_LABEL: Record<string, string> = {
  item: '物品',
  block: '方块',
  sound: '音效',
  fluid: '流体',
};

export const REGISTRY_TYPE_COLOR: Record<string, string> = {
  item: 'bg-blue-500/20 text-blue-400',
  block: 'bg-green-500/20 text-green-400',
  sound: 'bg-purple-500/20 text-purple-400',
  fluid: 'bg-cyan-500/20 text-cyan-400',
};

/** 语言条目展开后的一行 */
export interface LangRow {
  lang: string;
  key: string;
  value: string;
}

/** 计算 tab 计数 */
export function countByTab(kj: KubejsSpec, tab: KubejsTab, langEntries: number): number {
  if (tab === 'recipes') return kj.recipes.length;
  if (tab === 'tags') return kj.tags.length;
  if (tab === 'events') return kj.events.length;
  if (tab === 'tooltips') return kj.tooltips.length;
  if (tab === 'registry') return kj.registry.length;
  if (tab === 'lang') return langEntries;
  return 0;
}

/** 统计指定类型的标签数量 */
export function countTagType(kj: KubejsSpec, type: string): number {
  return kj.tags.filter((t) => t.type === type).length;
}

/** 统计指定类型的注册表条目数量 */
export function countRegistryType(kj: KubejsSpec, type: string): number {
  return kj.registry.filter((r) => r.type === type).length;
}

/** 取 tab 的展示 label */
export function tabLabel(tab: KubejsTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}
