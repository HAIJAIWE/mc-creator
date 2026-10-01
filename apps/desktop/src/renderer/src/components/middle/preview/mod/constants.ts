import type { BaseTab } from '../../shared/index.js';
import type { ModSpec } from '@mc-creator/shared';
import {
  Download,
  FileText,
  Boxes,
  Package,
  Trophy,
  Tag,
  FunctionSquare,
  Layers,
} from 'lucide-react';

/** Mod 预览面板的分类 tab */
export type ModTab =
  | 'items'
  | 'blocks'
  | 'dependencies'
  | 'loot'
  | 'advancements'
  | 'tags'
  | 'functions'
  | 'metadata'
  | 'export';

export type ItemRarityFilter = 'all' | 'common' | 'uncommon' | 'rare' | 'epic';
export type ItemCategoryFilter =
  | 'all'
  | 'sword'
  | 'pickaxe'
  | 'axe'
  | 'shovel'
  | 'hoe'
  | 'helmet'
  | 'chestplate'
  | 'leggings'
  | 'boots'
  | 'food'
  | 'potion'
  | 'bow'
  | 'crossbow'
  | 'trident'
  | 'misc';
export type BlockMaterialFilter =
  | 'all'
  | 'wood'
  | 'stone'
  | 'metal'
  | 'rock'
  | 'cloth'
  | 'plant'
  | 'sand'
  | 'glass'
  | 'ice'
  | 'water'
  | 'lava';

export const TABS: BaseTab<ModTab>[] = [
  { key: 'items', label: '物品', icon: Boxes },
  { key: 'blocks', label: '方块', icon: Layers },
  { key: 'dependencies', label: '依赖', icon: Package },
  { key: 'loot', label: '战利品', icon: FileText },
  { key: 'advancements', label: '进度', icon: Trophy },
  { key: 'tags', label: '标签', icon: Tag },
  { key: 'functions', label: '函数', icon: FunctionSquare },
  { key: 'metadata', label: '元数据', icon: FileText },
  { key: 'export', label: '导出', icon: Download },
];

export const HIDE_COUNT_TABS = new Set<ModTab>(['metadata', 'export']);

export const RARITY_LABEL: Record<string, string> = {
  common: '普通',
  uncommon: '少见',
  rare: '稀有',
  epic: '史诗',
};

export const RARITY_COLOR: Record<string, string> = {
  common: 'bg-mc-surface-3 text-mc-dim',
  uncommon: 'bg-yellow-500/20 text-yellow-400',
  rare: 'bg-blue-500/20 text-blue-400',
  epic: 'bg-purple-500/20 text-purple-400',
};

export const ITEM_CATEGORY_LABEL: Record<string, string> = {
  sword: '剑',
  pickaxe: '镐',
  axe: '斧',
  shovel: '铲',
  hoe: '锄',
  helmet: '头盔',
  chestplate: '胸甲',
  leggings: '护腿',
  boots: '靴子',
  food: '食物',
  potion: '药水',
  bow: '弓',
  crossbow: '弩',
  trident: '三叉戟',
  misc: '杂项',
};

export const BLOCK_TYPE_LABEL: Record<string, string> = {
  full_block: '完整方块',
  slab: '半砖',
  stairs: '楼梯',
  fence: '栅栏',
  fence_gate: '栅栏门',
  wall: '墙',
  door: '门',
  trapdoor: '活板门',
  button: '按钮',
  pressure_plate: '压力板',
  lever: '拉杆',
  sign: '告示牌',
  bed: '床',
  chest: '箱子',
  piston: '活塞',
  torch: '火把',
  custom: '自定义',
};

export const LOOT_TYPE_LABEL: Record<string, string> = {
  block: '方块掉落',
  entity: '实体掉落',
  chest: '宝箱',
  generic: '通用',
  empty: '空',
};

export const ADVANCEMENT_FRAME_LABEL: Record<string, string> = {
  task: '任务',
  challenge: '挑战',
  goal: '目标',
};

/** 计算 tab 计数 */
export function countByTab(mod: ModSpec, tab: ModTab): number {
  if (tab === 'items') return mod.items.length;
  if (tab === 'blocks') return mod.blocks.length;
  if (tab === 'dependencies') return mod.dependencies.length;
  if (tab === 'loot') return mod.lootTables.length;
  if (tab === 'advancements') return mod.advancements.length;
  if (tab === 'tags') return mod.tags.length;
  if (tab === 'functions') return mod.functions.length;
  return 0;
}

/** 取 tab 的展示 label */
export function tabLabel(tab: ModTab): string {
  return TABS.find((t) => t.key === tab)?.label ?? '';
}
