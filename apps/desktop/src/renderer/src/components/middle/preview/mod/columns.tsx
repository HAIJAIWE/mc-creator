import { CheckSquare, Square, Trash2 } from 'lucide-react';
import type { Column } from '../../shared/index.js';
import type {
  ItemSpec,
  BlockSpec,
  ModDependencySpec,
  ModLootTableSpec,
  ModAdvancementSpec,
} from '@mc-creator/shared';
import {
  RARITY_LABEL,
  RARITY_COLOR,
  ITEM_CATEGORY_LABEL,
  BLOCK_TYPE_LABEL,
  LOOT_TYPE_LABEL,
  ADVANCEMENT_FRAME_LABEL,
} from './constants.js';

/** 批量选择需要的最小接口（useBatchSelection 返回值结构兼容） */
interface SelectableSet {
  toggle: (id: string) => void;
  isSelected: (id: string) => boolean;
}

/** 物品列表列定义 */
export function createItemColumns(
  selection: SelectableSet,
  onRemove: (ids: string[]) => void,
): Column<ItemSpec>[] {
  return [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            selection.toggle(r.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {selection.isSelected(r.id) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    { key: 'id', header: 'ID', width: '14%', sortValue: (r) => r.id },
    { key: 'name', header: '名称', width: '16%', sortValue: (r) => r.name },
    {
      key: 'rarity',
      header: '稀有度',
      width: '10%',
      sortValue: (r) => r.rarity,
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${RARITY_COLOR[r.rarity] ?? RARITY_COLOR.common}`}
        >
          {RARITY_LABEL[r.rarity] ?? r.rarity}
        </span>
      ),
    },
    {
      key: 'itemCategory',
      header: '类别',
      width: '10%',
      sortValue: (r) => r.itemCategory,
      render: (r) => ITEM_CATEGORY_LABEL[r.itemCategory] ?? r.itemCategory,
    },
    {
      key: 'maxStackSize',
      header: '堆叠',
      width: '8%',
      sortValue: (r) => r.maxStackSize,
    },
    {
      key: 'maxDamage',
      header: '耐久',
      width: '8%',
      sortValue: (r) => r.maxDamage,
      render: (r) => (r.maxDamage > 0 ? String(r.maxDamage) : '—'),
    },
    {
      key: 'fuelTick',
      header: '燃料',
      width: '8%',
      sortValue: (r) => r.fuelTick,
      render: (r) => (r.fuelTick > 0 ? `${r.fuelTick}t` : '—'),
    },
    {
      key: 'food',
      header: '食物',
      width: '12%',
      render: (r) => (r.food ? `饥饿 ${r.food.hunger}/饱和 ${r.food.saturation}` : '—'),
    },
    {
      key: 'actions',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove([r.id]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
    },
  ];
}

/** 方块列表列定义 */
export function createBlockColumns(
  selection: SelectableSet,
  onRemove: (ids: string[]) => void,
): Column<BlockSpec>[] {
  return [
    {
      key: 'select',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            selection.toggle(r.id);
          }}
          className="text-mc-mute hover:text-mc-accent"
        >
          {selection.isSelected(r.id) ? (
            <CheckSquare className="h-3 w-3" />
          ) : (
            <Square className="h-3 w-3" />
          )}
        </button>
      ),
    },
    { key: 'id', header: 'ID', width: '14%', sortValue: (r) => r.id },
    { key: 'name', header: '名称', width: '14%', sortValue: (r) => r.name },
    {
      key: 'material',
      header: '材质',
      width: '10%',
      sortValue: (r) => r.material,
    },
    {
      key: 'blockType',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.blockType,
      render: (r) => BLOCK_TYPE_LABEL[r.blockType] ?? r.blockType,
    },
    { key: 'hardness', header: '硬度', width: '8%', sortValue: (r) => r.hardness },
    {
      key: 'lightLevel',
      header: '发光',
      width: '8%',
      sortValue: (r) => r.lightLevel,
      render: (r) => (r.lightLevel > 0 ? String(r.lightLevel) : '—'),
    },
    {
      key: 'resistance',
      header: '抗性',
      width: '8%',
      sortValue: (r) => r.resistance,
    },
    {
      key: 'transparent',
      header: '透明',
      width: '8%',
      render: (r) => (r.transparent ? '是' : '否'),
    },
    {
      key: 'dropSelf',
      header: '掉落',
      width: '10%',
      render: (r) => (r.dropSelf ? '自身' : r.dropItem || '无'),
    },
    {
      key: 'actions',
      header: '',
      width: '4%',
      render: (r) => (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove([r.id]);
          }}
          className="text-mc-mute hover:text-red-400"
          title="移除"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      ),
    },
  ];
}

/** 依赖列表列定义 */
export function createDependencyColumns(): Column<ModDependencySpec>[] {
  return [
    { key: 'modId', header: 'Mod ID', width: '40%', sortValue: (r) => r.modId },
    { key: 'version', header: '版本', width: '30%', sortValue: (r) => r.version },
    {
      key: 'mandatory',
      header: '必需',
      width: '30%',
      render: (r) => (
        <span
          className={`rounded-mc px-1.5 py-0.5 text-[10px] ${
            r.mandatory ? 'bg-red-500/20 text-red-400' : 'bg-blue-500/20 text-blue-400'
          }`}
        >
          {r.mandatory ? '必需' : '可选'}
        </span>
      ),
    },
  ];
}

/** 战利品表列定义 */
export function createLootColumns(): Column<ModLootTableSpec>[] {
  return [
    { key: 'id', header: 'ID', width: '30%', sortValue: (r) => r.id },
    {
      key: 'type',
      header: '类型',
      width: '12%',
      sortValue: (r) => r.type,
      render: (r) => LOOT_TYPE_LABEL[r.type] ?? r.type,
    },
    {
      key: 'pools',
      header: '池数',
      width: '10%',
      sortValue: (r) => r.pools.length,
      render: (r) => String(r.pools.length),
    },
    {
      key: 'entries',
      header: '总条目',
      width: '12%',
      sortValue: (r) => r.pools.reduce((sum, p) => sum + p.entries.length, 0),
      render: (r) => String(r.pools.reduce((sum, p) => sum + p.entries.length, 0)),
    },
    {
      key: 'preview',
      header: '前 2 个物品',
      width: '36%',
      render: (r) => {
        const items = r.pools.flatMap((p) => p.entries.map((e) => e.item)).slice(0, 2);
        return items.length > 0 ? items.join(', ') : '—';
      },
    },
  ];
}

/** 进度列表列定义 */
export function createAdvancementColumns(): Column<ModAdvancementSpec>[] {
  return [
    { key: 'id', header: 'ID', width: '25%', sortValue: (r) => r.id },
    {
      key: 'title',
      header: '标题',
      width: '20%',
      render: (r) => r.display?.title ?? '—',
    },
    {
      key: 'frame',
      header: '框架',
      width: '10%',
      render: (r) =>
        r.display?.frame ? (ADVANCEMENT_FRAME_LABEL[r.display.frame] ?? r.display.frame) : '—',
    },
    {
      key: 'parent',
      header: '父进度',
      width: '20%',
      render: (r) => r.parent ?? '—',
    },
    {
      key: 'criteria',
      header: '条件数',
      width: '10%',
      sortValue: (r) => r.criteria.length,
      render: (r) => String(r.criteria.length),
    },
    {
      key: 'icon',
      header: '图标',
      width: '15%',
      render: (r) => r.display?.icon ?? '—',
    },
  ];
}
