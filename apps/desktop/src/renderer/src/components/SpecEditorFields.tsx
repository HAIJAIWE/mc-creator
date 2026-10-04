import type { ReactNode } from 'react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { listAssets, type McAssetScope } from '../assets/mc-ui/mc-ui';
import type { ModSpec } from '@mc-creator/shared';

// ===== 共享常量（物品/方块编辑器共用，MC 标准取值） =====

export const ASSET_SCOPES: McAssetScope[] = ['mob', 'game', 'pixel'];

export const TOOL_TYPES = ['none', 'pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears'] as const;
export type ToolType = (typeof TOOL_TYPES)[number];

export const TOOL_LABELS: Record<ToolType, string> = {
  none: '无（手/任意）',
  pickaxe: '镐',
  axe: '斧',
  shovel: '锹',
  hoe: '锄',
  sword: '剑',
  shears: '剪',
};

export const RARITIES = ['common', 'uncommon', 'rare', 'epic'] as const;
export type Rarity = (typeof RARITIES)[number];

export const RARITY_LABELS: Record<Rarity, string> = {
  common: '普通',
  uncommon: '优秀',
  rare: '稀有',
  epic: '史诗',
};

export const CREATIVE_TABS = [
  'building_blocks',
  'colored_blocks',
  'natural_blocks',
  'functional_blocks',
  'redstone_blocks',
  'tools',
  'combat',
  'food_and_drinks',
  'ingredients',
  'spawn_eggs',
  'op',
  'inventory',
] as const;
export type CreativeTab = (typeof CREATIVE_TABS)[number];

export const CREATIVE_TAB_LABELS: Record<CreativeTab, string> = {
  building_blocks: '建筑方块',
  colored_blocks: '彩色方块',
  natural_blocks: '自然方块',
  functional_blocks: '功能方块',
  redstone_blocks: '红石方块',
  tools: '工具',
  combat: '战斗',
  food_and_drinks: '饮食',
  ingredients: '材料',
  spawn_eggs: '刷怪蛋',
  op: '管理员',
  inventory: '杂项',
};

export const SOUND_TYPES = [
  'wood',
  'stone',
  'metal',
  'grass',
  'sand',
  'glass',
  'cloth',
  'ladder',
  'anvil',
  'slime',
] as const;
export type SoundType = (typeof SOUND_TYPES)[number];

export const SOUND_LABELS: Record<SoundType, string> = {
  wood: '木头',
  stone: '石头',
  metal: '金属',
  grass: '草',
  sand: '沙子',
  glass: '玻璃',
  cloth: '布料',
  ladder: '梯子',
  anvil: '铁砧',
  slime: '史莱姆',
};

export const MAP_COLORS = [
  'stone',
  'grass',
  'sand',
  'wood',
  'water',
  'lava',
  'leaves',
  'metal',
  'snow',
  'clay',
  'dirt',
  'nether',
  'quartz',
  'gold',
  'wool',
] as const;

export const ARMOR_SLOTS = ['head', 'chest', 'legs', 'feet'] as const;
export type ArmorSlot = (typeof ARMOR_SLOTS)[number];

export const ARMOR_SLOT_LABELS: Record<ArmorSlot, string> = {
  head: '头盔',
  chest: '胸甲',
  legs: '护腿',
  feet: '靴子',
};

export const TIER_LABELS = ['木（0）', '石（1）', '铁（2）', '钻石（3）', '下界合金（4）'];

/** 方块材质（BlockSpec.material 全集） */
export const BLOCK_MATERIALS = [
  'wood',
  'stone',
  'metal',
  'rock',
  'cloth',
  'plant',
  'sand',
  'glass',
  'ice',
  'water',
  'lava',
] as const;
export type BlockMaterial = (typeof BLOCK_MATERIALS)[number];

// ===== id 合法化与校验（行内报错，不阻断其他编辑） =====

const ID_RE = /^[a-z0-9_]+$/;

export function isValidId(id: string): boolean {
  return ID_RE.test(id);
}

/** 非法 id 自动转合法：小写 + 非 [a-z0-9] → 下划线，去首尾下划线；全非法时回退 fallback */
export function toValidId(raw: string, fallback = 'item'): string {
  const v = raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return v || fallback;
}

export function validateId(
  raw: string,
  taken: Set<string>,
  selfId: string,
): { error: string | null; sanitized: string } {
  const sanitized = toValidId(raw);
  if (!raw.trim()) return { error: 'ID 为必填项', sanitized };
  if (!isValidId(raw.trim())) {
    return { error: `含非法字符，保存时自动转为「${sanitized}」`, sanitized };
  }
  if (raw.trim() !== selfId && taken.has(raw.trim())) {
    return { error: `ID「${raw.trim()}」已存在`, sanitized };
  }
  return { error: null, sanitized };
}

export function validateRequired(value: string, label: string): string | null {
  return value.trim() ? null : `${label}为必填项`;
}

export function validateInt(
  text: string,
  label: string,
  min: number,
  max?: number,
): { error: string | null; value: number | null } {
  if (!text.trim()) return { error: `${label}为必填项`, value: null };
  const v = Number(text);
  if (!Number.isInteger(v)) return { error: `${label}必须为整数`, value: null };
  if (v < min || (max !== undefined && v > max)) {
    return { error: max === undefined ? `${label}不能小于 ${min}` : `${label}范围 ${min}–${max}`, value: null };
  }
  return { error: null, value: v };
}

export function validateNum(
  text: string,
  label: string,
  min: number,
  max?: number,
): { error: string | null; value: number | null } {
  if (!text.trim()) return { error: `${label}为必填项`, value: null };
  const v = Number(text);
  if (!Number.isFinite(v)) return { error: `${label}必须为数字`, value: null };
  if (v < min || (max !== undefined && v > max)) {
    return {
      error: max === undefined ? `${label}不能小于 ${min}` : `${label}范围 ${min}–${max}`,
      value: null,
    };
  }
  return { error: null, value: v };
}

// ===== 素材绑定（texturePath 约定为 "<scope>:<name>"） =====

export function parseTexturePath(
  texturePath: string | undefined,
): { scope: McAssetScope; name: string } | null {
  if (!texturePath) return null;
  const sep = texturePath.indexOf(':');
  if (sep <= 0) return null;
  const scope = texturePath.slice(0, sep) as McAssetScope;
  const name = texturePath.slice(sep + 1);
  if (!ASSET_SCOPES.includes(scope) || !name) return null;
  return { scope, name };
}

export function formatTexturePath(scope: McAssetScope, name: string): string {
  return `${scope}:${name}`;
}

// ===== 配方引用查询（配方联动展示用） =====

export interface RecipeRefs {
  /** output 指向该 id 的配方 id 列表 */
  asOutput: string[];
  /** inputs/base/addition/ingredientItem 指向该 id 的配方 id 列表 */
  asInput: string[];
}

export function findRecipeRefs(
  recipes: ModSpec['recipes'] | undefined,
  id: string,
): RecipeRefs {
  const asOutput: string[] = [];
  const asInput: string[] = [];
  for (const r of recipes ?? []) {
    if (r.output === id) asOutput.push(r.recipeId);
    if (
      r.inputs.some((inp) => inp.item === id) ||
      r.base === id ||
      r.addition === id ||
      r.ingredientItem === id
    ) {
      asInput.push(r.recipeId);
    }
  }
  return { asOutput, asInput };
}

// ===== 通用字段组件（仅复用 mc-* 样式类） =====

export function Field({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string | null | undefined;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div>
      <label className="mb-0.5 block text-[10px] text-mc-dim">{label}</label>
      {children}
      {error ? (
        <div className="mt-0.5 text-[10px] text-red-400">{error}</div>
      ) : hint ? (
        <div className="mt-0.5 text-[9px] text-mc-mute">{hint}</div>
      ) : null}
    </div>
  );
}

/** 独立错误行（用在复选框/分组标题旁） */
export function InlineError({ message }: { message: string | null }) {
  if (!message) return null;
  return <div className="mt-0.5 text-[10px] text-red-400">{message}</div>;
}

/** 分组标题 */
export function GroupTitle({ children }: { children: ReactNode }) {
  return <div className="mb-1 text-[10px] font-medium text-mc-dim">{children}</div>;
}

/** 开关行 */
export function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <label className="flex items-center gap-1 text-[10px] text-mc-dim">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-3 w-3 accent-mc-accent"
      />
      {label}
    </label>
  );
}

/**
 * 素材绑定器：scope 下拉 + name 下拉 + McIcon 实时预览。
 * 非受控的名称回退到该 scope 首个素材，保证预览始终可见。
 */
export function AssetBinder({
  scope,
  name,
  onScopeChange,
  onNameChange,
}: {
  scope: McAssetScope;
  name: string;
  onScopeChange: (s: McAssetScope) => void;
  onNameChange: (n: string) => void;
}) {
  const names = listAssets(scope);
  const effective = names.includes(name) ? name : (names[0] ?? '');
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-mc border border-mc-border bg-mc-surface-2">
        {effective ? (
          <McIcon scope={scope} name={effective} size={24} />
        ) : (
          <span className="text-[9px] text-mc-mute">无</span>
        )}
      </div>
      <div className="flex flex-1 gap-1">
        <select
          className="mc-select w-24"
          value={scope}
          onChange={(e) => {
            const s = e.target.value as McAssetScope;
            onScopeChange(s);
            const first = listAssets(s)[0];
            if (first) onNameChange(first);
          }}
          title="素材库"
        >
          {ASSET_SCOPES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <select
          className="mc-select min-w-0 flex-1"
          value={effective}
          onChange={(e) => onNameChange(e.target.value)}
          title="素材名"
        >
          {names.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

/** 配方联动提示：展示引用当前 id 的配方 */
export function RecipeRefNote({ refs }: { refs: RecipeRefs }) {
  if (refs.asOutput.length === 0 && refs.asInput.length === 0) return null;
  return (
    <div className="mc-card p-2 text-[10px] text-mc-dim">
      <span className="text-mc-accent">配方联动：</span>
      {refs.asOutput.length > 0 && <span>产出于 {refs.asOutput.join('、')}</span>}
      {refs.asOutput.length > 0 && refs.asInput.length > 0 && <span>；</span>}
      {refs.asInput.length > 0 && <span>作为材料用于 {refs.asInput.join('、')}</span>}
      <span>。改 ID 时引用自动同步改名。</span>
    </div>
  );
}
