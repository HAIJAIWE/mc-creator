import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { McInventory, type McInventoryItem } from './McInventory';
import { McIcon } from '../assets/mc-ui/McIcon';
import { listAssets, type McAssetScope } from '../assets/mc-ui/mc-ui';
import { useModStore } from '../store/mod-store.js';
import type { ItemSpec } from '@mc-creator/shared';
import {
  TOOL_TYPES,
  RARITIES,
  RARITY_LABELS,
  CREATIVE_TABS,
  CREATIVE_TAB_LABELS,
  ARMOR_SLOTS,
  ARMOR_SLOT_LABELS,
  type ToolType,
  type Rarity,
  type CreativeTab,
  type ArmorSlot,
  toValidId,
  isValidId,
  validateId,
  validateRequired,
  validateInt,
  validateNum,
  parseTexturePath,
  formatTexturePath,
  findRecipeRefs,
  Field,
  GroupTitle,
  Toggle,
  AssetBinder,
  RecipeRefNote,
} from './SpecEditorFields';

type Tab = 'inventory' | 'recipe' | 'items';
type GridId = 'main' | 'hotbar' | 'recipe' | 'result';

const SCOPES: { scope: McAssetScope; title: string }[] = [
  { scope: 'mob', title: '生物素材' },
  { scope: 'game', title: '游戏素材' },
  { scope: 'pixel', title: '通用像素' },
];

const MAIN_ROWS = 3;
const COLUMNS = 9;
const MAIN_LEN = MAIN_ROWS * COLUMNS; // 27
const HOTBAR_LEN = COLUMNS; // 9
const RECIPE_LEN = 9;

/** 复刻 McInventory 的槽位内联样式（保持与显示组件一致的视觉） */
function slotStyle(scale: number, selected: boolean): CSSProperties {
  const slotSize = 16 * scale;
  return {
    position: 'relative',
    boxSizing: 'border-box',
    width: slotSize,
    height: slotSize,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'rgb(var(--mc-surface-2))',
    boxShadow: 'inset 1px 1px 0 rgb(0 0 0 / 0.5), inset -1px -1px 0 rgb(255 255 255 / 0.08)',
    imageRendering: 'pixelated',
    cursor: 'pointer',
    outline: selected ? '2px solid rgb(var(--mc-accent))' : 'none',
    outlineOffset: selected ? -2 : 0,
  };
}

function Slot({
  item,
  selected,
  scale,
  onClick,
}: {
  item: McInventoryItem | null;
  selected: boolean;
  scale: number;
  onClick: () => void;
}) {
  const slotSize = 16 * scale;
  return (
    <div style={slotStyle(scale, selected)} onClick={onClick}>
      {item && (
        <>
          <McIcon scope={item.scope ?? 'mob'} name={item.name} size={slotSize} />
          {item.amount != null && item.amount > 1 && (
            <span
              style={{
                position: 'absolute',
                right: 0,
                bottom: 0,
                fontSize: 8 * scale,
                fontFamily: 'var(--mc-font-mono)',
                fontWeight: 700,
                color: '#fff',
                textShadow: '1px 1px 0 #3f3f3f',
                lineHeight: 1,
                pointerEvents: 'none',
              }}
            >
              {item.amount}
            </span>
          )}
        </>
      )}
    </div>
  );
}

function SlotGrid({
  items,
  columns,
  rows,
  selectedIndex,
  scale,
  onSlotClick,
}: {
  items: (McInventoryItem | null)[];
  columns: number;
  rows: number;
  selectedIndex: number | null;
  scale: number;
  onSlotClick: (index: number) => void;
}) {
  const slot = 16 * scale;
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, ${slot}px)`,
        gridTemplateRows: `repeat(${rows}, ${slot}px)`,
        gap: 2 * scale,
      }}
    >
      {items.map((it, i) => (
        <Slot
          key={i}
          item={it}
          selected={selectedIndex === i}
          scale={scale}
          onClick={() => onSlotClick(i)}
        />
      ))}
    </div>
  );
}

const EMPTY_MAIN = (): (McInventoryItem | null)[] => Array(MAIN_LEN).fill(null);
const EMPTY_HOTBAR = (): (McInventoryItem | null)[] => Array(HOTBAR_LEN).fill(null);
const EMPTY_RECIPE = (): (McInventoryItem | null)[] => Array(RECIPE_LEN).fill(null);

/** 把 item 解析为 "<scope>:<name>" 资产键 */
function assetKey(item: McInventoryItem): string {
  return `${item.scope ?? 'mob'}:${item.name}`;
}

// ===== 物品属性面板（可视化表单 ↔ spec.items 双向同步） =====

/** 表单草稿：数字字段保持字符串形态，非法输入只行内报错、不阻断其他字段提交 */
interface ItemDraft {
  idText: string;
  name: string;
  scope: McAssetScope;
  assetName: string;
  maxStack: string;
  maxDamage: string;
  rarity: Rarity;
  creativeTab: CreativeTab;
  isFood: boolean;
  hunger: string;
  saturation: string;
  hasTool: boolean;
  toolType: ToolType;
  miningLevel: string;
  toolSpeed: string;
  isArmor: boolean;
  armorSlot: ArmorSlot;
  defense: string;
  toughness: string;
  enchantability: string;
  fireResistant: boolean;
}

function toItemDraft(item: ItemSpec): ItemDraft {
  const tex = parseTexturePath(item.texturePath);
  return {
    idText: item.id,
    name: item.name,
    scope: tex?.scope ?? 'mob',
    assetName: tex?.name ?? '',
    maxStack: String(item.maxStackSize),
    maxDamage: String(item.maxDamage),
    rarity: item.rarity,
    creativeTab: item.creativeTab,
    isFood: !!item.food,
    hunger: String(item.food?.hunger ?? 4),
    saturation: String(item.food?.saturation ?? 0.6),
    hasTool: !!item.tool,
    toolType: item.tool?.type ?? 'none',
    miningLevel: String(item.tool?.miningLevel ?? 0),
    toolSpeed: String(item.tool?.speed ?? 1),
    isArmor: !!item.armor,
    armorSlot: item.armor?.slot ?? 'chest',
    defense: String(item.armor?.defense ?? 0),
    toughness: String(item.armor?.toughness ?? 0),
    enchantability: String(item.enchantability ?? 0),
    fireResistant: item.fireResistant ?? false,
  };
}

function ItemSpecPanel() {
  const items = useModStore((s) => s.spec?.items ?? []);
  const recipes = useModStore((s) => s.spec?.recipes);
  const addItem = useModStore((s) => s.addItem);
  const updateItem = useModStore((s) => s.updateItem);
  const removeItem = useModStore((s) => s.removeItem);
  const renameItemId = useModStore((s) => s.renameItemId);

  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selected = items.find((i) => i.id === selectedItemId) ?? null;
  const [draft, setDraft] = useState<ItemDraft | null>(null);
  /** 最近一次写入 store 的选中物品快照：effect 靠它区分"外部变更"与"自身写入" */
  const lastPushedRef = useRef('');

  const taken = useMemo(() => new Set(items.map((i) => i.id)), [items]);

  // 选择失效（被删除 / 初始）时回退到首个物品
  useEffect(() => {
    if ((!selectedItemId || !taken.has(selectedItemId)) && items.length > 0) {
      const first = items[0].id;
      if (first !== selectedItemId) setSelectedItemId(first);
    } else if (items.length === 0 && selectedItemId !== null) {
      setSelectedItemId(null);
    }
  }, [items, selectedItemId, taken]);

  // 双向同步：store 侧被外部改动时用新值回填表单；自身写入的不回填（靠 lastPushedRef 识别）
  useEffect(() => {
    const snap = selected ? JSON.stringify(selected) : '';
    if (snap !== lastPushedRef.current) {
      lastPushedRef.current = snap;
      setDraft(selected ? toItemDraft(selected) : null);
    }
  }, [selected]);

  const markPushed = (id: string) => {
    const cur = useModStore.getState().spec?.items.find((i) => i.id === id);
    lastPushedRef.current = cur ? JSON.stringify(cur) : '';
  };

  /** 更新草稿 + 可选地提交部分 store 补丁（补丁为 undefined 时只改草稿，多用于非法输入） */
  const applyDraft = (d: Partial<ItemDraft>, storePatch?: Partial<ItemSpec>) => {
    setDraft((prev) => (prev ? { ...prev, ...d } : prev));
    if (storePatch && selected) {
      updateItem(selected.id, storePatch);
      markPushed(selected.id);
    }
  };

  const createItem = () => {
    const current = useModStore.getState().spec?.items ?? [];
    const takenSet = new Set(current.map((i) => i.id));
    const base = toValidId('new_item');
    let id = base;
    let n = 2;
    while (takenSet.has(id)) id = `${base}_${n++}`;
    const item: ItemSpec = {
      id,
      name: id,
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
      attributes: [],
      defaultEnchantments: [],
      itemCategory: 'misc',
      creativeTab: 'inventory',
    };
    addItem(item);
    lastPushedRef.current = JSON.stringify(item);
    setSelectedItemId(id);
    setDraft(toItemDraft(item));
  };

  // ---- 校验（渲染期纯计算，只展示、不阻断） ----
  const idCheck = draft && selected ? validateId(draft.idText, taken, selected.id) : null;
  const nameError = draft ? validateRequired(draft.name, '显示名称') : null;
  const maxStackCheck = draft ? validateInt(draft.maxStack, '最大堆叠', 1, 64) : null;
  const maxDamageCheck = draft ? validateInt(draft.maxDamage, '耐久上限', 0) : null;
  const hungerCheck = draft ? validateInt(draft.hunger, '饥饿值', 0, 20) : null;
  const saturationCheck = draft ? validateNum(draft.saturation, '饱和度', 0) : null;
  const miningLevelCheck = draft ? validateInt(draft.miningLevel, '挖掘等级', 0, 10) : null;
  const toolSpeedCheck = draft ? validateNum(draft.toolSpeed, '挖掘速度', 0) : null;
  const defenseCheck = draft ? validateInt(draft.defense, '防御点数', 0) : null;
  const toughnessCheck = draft ? validateNum(draft.toughness, '盔甲韧性', 0) : null;
  const enchantCheck = draft ? validateInt(draft.enchantability, '附魔能力', 0) : null;

  const commitId = () => {
    if (!draft || !selected) return;
    const raw = draft.idText.trim();
    if (!raw) {
      setDraft({ ...draft, idText: selected.id });
      return;
    }
    const target = isValidId(raw) ? raw : toValidId(raw);
    if (target === selected.id) {
      setDraft({ ...draft, idText: target });
      return;
    }
    if (taken.has(target)) return; // 重名：错误已行内显示，不提交
    renameItemId(selected.id, target); // 配方 result/ingredient 引用由 store 同步改名
    setSelectedItemId(target);
  };

  const refs = selected ? findRecipeRefs(recipes, selected.id) : null;

  return (
    <div className="space-y-3">
      {/* 物品列表 */}
      <div>
        <GroupTitle>物品列表（{items.length}）</GroupTitle>
        <div className="mb-2 flex gap-2">
          <button className="mc-btn-primary" onClick={createItem}>
            新建物品
          </button>
          {selected && (
            <button
              className="mc-btn-ghost"
              onClick={() => removeItem(selected.id)}
              title="删除当前物品"
            >
              删除当前
            </button>
          )}
        </div>
        {items.length > 0 ? (
          <ul className="mc-card max-h-32 space-y-1 overflow-auto p-2">
            {items.map((it) => (
              <li key={it.id}>
                <button
                  onClick={() => setSelectedItemId(it.id)}
                  className={`flex w-full items-center justify-between gap-2 rounded-mc px-2 py-1 text-xs transition-colors ${
                    it.id === selectedItemId
                      ? 'bg-mc-accent/30 text-mc-text'
                      : 'text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text'
                  }`}
                >
                  <span className="truncate">
                    {it.name} <span className="text-mc-mute">({it.id})</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <div className="text-xs text-mc-mute">暂无物品，点击「新建物品」开始。</div>
        )}
      </div>

      {selected && draft && (
        <>
          {refs && <RecipeRefNote refs={refs} />}

          {/* 基础属性 */}
          <div>
            <GroupTitle>基础属性</GroupTitle>
            <div className="space-y-2">
              <Field
                label="ID（小写字母/数字/下划线，失焦保存；非法自动转合法）"
                error={idCheck?.error}
              >
                <input
                  className="mc-input w-full font-mono"
                  value={draft.idText}
                  onChange={(e) => setDraft({ ...draft, idText: e.target.value })}
                  onBlur={commitId}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                  placeholder="如 ruby_sword"
                />
              </Field>
              <Field label="显示名称" error={nameError}>
                <input
                  className="mc-input w-full"
                  value={draft.name}
                  onChange={(e) => {
                    const name = e.target.value;
                    applyDraft({ name }, name.trim() ? { name } : undefined);
                  }}
                  placeholder="如 红宝石剑"
                />
              </Field>
              <Field label="素材绑定">
                <AssetBinder
                  scope={draft.scope}
                  name={draft.assetName}
                  onScopeChange={(s) => {
                    const names = listAssets(s);
                    const effective = names.includes(draft.assetName)
                      ? draft.assetName
                      : (names[0] ?? '');
                    applyDraft(
                      { scope: s, assetName: effective },
                      effective ? { texturePath: formatTexturePath(s, effective) } : undefined,
                    );
                  }}
                  onNameChange={(n) =>
                    applyDraft({ assetName: n }, { texturePath: formatTexturePath(draft.scope, n) })
                  }
                />
              </Field>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Field label="最大堆叠（1–64）" error={maxStackCheck?.error}>
                    <input
                      type="number"
                      className="mc-input w-full"
                      value={draft.maxStack}
                      min={1}
                      max={64}
                      onChange={(e) => {
                        const v = validateInt(e.target.value, '最大堆叠', 1, 64);
                        applyDraft(
                          { maxStack: e.target.value },
                          v.value === null ? undefined : { maxStackSize: v.value },
                        );
                      }}
                    />
                  </Field>
                </div>
                <div className="flex-1">
                  <Field label="稀有度" hint="影响悬浮提示颜色">
                    <select
                      className="mc-select w-full"
                      value={draft.rarity}
                      onChange={(e) => {
                        const rarity = e.target.value as Rarity;
                        applyDraft({ rarity }, { rarity });
                      }}
                    >
                      {RARITIES.map((v) => (
                        <option key={v} value={v}>
                          {RARITY_LABELS[v]}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <Field
                    label="耐久上限 maxDamage（0=不可损坏）"
                    error={maxDamageCheck?.error}
                    hint="即 durability：受击/使用时消耗"
                  >
                    <input
                      type="number"
                      className="mc-input w-full"
                      value={draft.maxDamage}
                      min={0}
                      onChange={(e) => {
                        const v = validateInt(e.target.value, '耐久上限', 0);
                        applyDraft(
                          { maxDamage: e.target.value },
                          v.value === null ? undefined : { maxDamage: v.value },
                        );
                      }}
                    />
                  </Field>
                </div>
                <div className="flex-1">
                  <Field
                    label="附魔能力 enchantability"
                    error={enchantCheck?.error}
                    hint="0=不可附魔，值越高好附魔越好"
                  >
                    <input
                      type="number"
                      className="mc-input w-full"
                      value={draft.enchantability}
                      min={0}
                      onChange={(e) => {
                        const v = validateInt(e.target.value, '附魔能力', 0);
                        applyDraft(
                          { enchantability: e.target.value },
                          v.value === null ? undefined : { enchantability: v.value },
                        );
                      }}
                    />
                  </Field>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Field label="创造模式标签页">
                  <select
                    className="mc-select w-full"
                    value={draft.creativeTab}
                    onChange={(e) => {
                      const creativeTab = e.target.value as CreativeTab;
                      applyDraft({ creativeTab }, { creativeTab });
                    }}
                  >
                    {CREATIVE_TABS.map((t) => (
                      <option key={t} value={t}>
                        {CREATIVE_TAB_LABELS[t]}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="pt-4">
                  <Toggle
                    checked={draft.fireResistant}
                    onChange={(v) => applyDraft({ fireResistant: v }, { fireResistant: v })}
                    label="防火（岩浆/火中不烧毁）"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* 食物 */}
          <div>
            <div className="mb-1 flex items-center gap-2">
              <GroupTitle>食物属性</GroupTitle>
              <div className="ml-auto">
                <Toggle
                  checked={draft.isFood}
                  onChange={(isFood) => {
                    if (!selected) return;
                    if (isFood) {
                      const hunger = hungerCheck?.value ?? 4;
                      const saturation = saturationCheck?.value ?? 0.6;
                      const cur = selected.food;
                      applyDraft(
                        { isFood, hunger: String(hunger), saturation: String(saturation) },
                        {
                          food: {
                            hunger,
                            saturation,
                            effects: cur?.effects ?? [],
                            canAlwaysEat: cur?.canAlwaysEat ?? false,
                          },
                        },
                      );
                    } else {
                      applyDraft({ isFood }, { food: undefined });
                    }
                  }}
                  label="是食物"
                />
              </div>
            </div>
            {draft.isFood && (
              <div className="flex gap-2">
                <div className="flex-1">
                  <Field label="饥饿值 hunger（0–20）" error={hungerCheck?.error}>
                    <input
                      type="number"
                      className="mc-input w-full"
                      value={draft.hunger}
                      min={0}
                      max={20}
                      onChange={(e) => {
                        const next = { ...draft, hunger: e.target.value };
                        setDraft(next);
                        if (!selected) return;
                        const h = validateInt(next.hunger, '饥饿值', 0, 20);
                        const s = validateNum(next.saturation, '饱和度', 0);
                        if (h.value === null || s.value === null) return;
                        updateItem(selected.id, {
                          food: {
                            hunger: h.value,
                            saturation: s.value,
                            effects: selected.food?.effects ?? [],
                            canAlwaysEat: selected.food?.canAlwaysEat ?? false,
                          },
                        });
                        markPushed(selected.id);
                      }}
                    />
                  </Field>
                </div>
                <div className="flex-1">
                  <Field label="饱和度 saturation（≥0）" error={saturationCheck?.error}>
                    <input
                      type="number"
                      className="mc-input w-full"
                      value={draft.saturation}
                      min={0}
                      step={0.1}
                      onChange={(e) => {
                        const next = { ...draft, saturation: e.target.value };
                        setDraft(next);
                        if (!selected) return;
                        const h = validateInt(next.hunger, '饥饿值', 0, 20);
                        const s = validateNum(next.saturation, '饱和度', 0);
                        if (h.value === null || s.value === null) return;
                        updateItem(selected.id, {
                          food: {
                            hunger: h.value,
                            saturation: s.value,
                            effects: selected.food?.effects ?? [],
                            canAlwaysEat: selected.food?.canAlwaysEat ?? false,
                          },
                        });
                        markPushed(selected.id);
                      }}
                    />
                  </Field>
                </div>
              </div>
            )}
          </div>

          {/* 工具 */}
          <div>
            <div className="mb-1 flex items-center gap-2">
              <GroupTitle>工具属性</GroupTitle>
              <div className="ml-auto">
                <Toggle
                  checked={draft.hasTool}
                  onChange={(hasTool) => {
                    if (hasTool) {
                      const miningLevel = miningLevelCheck?.value ?? 0;
                      const speed = toolSpeedCheck?.value ?? 1;
                      applyDraft(
                        {
                          hasTool,
                          miningLevel: String(miningLevel),
                          toolSpeed: String(speed),
                        },
                        { tool: { type: draft.toolType, miningLevel, speed } },
                      );
                    } else {
                      applyDraft({ hasTool }, { tool: undefined });
                    }
                  }}
                  label="是工具"
                />
              </div>
            </div>
            {draft.hasTool && (
              <div className="space-y-2">
                <Field label="工具类型">
                  <select
                    className="mc-select w-full"
                    value={draft.toolType}
                    onChange={(e) => {
                      const toolType = e.target.value as ToolType;
                      const next = { ...draft, toolType };
                      setDraft(next);
                      if (!selected) return;
                      const ml = validateInt(next.miningLevel, '挖掘等级', 0, 10);
                      const sp = validateNum(next.toolSpeed, '挖掘速度', 0);
                      if (ml.value === null || sp.value === null) return;
                      updateItem(selected.id, {
                        tool: { type: toolType, miningLevel: ml.value, speed: sp.value },
                      });
                      markPushed(selected.id);
                    }}
                  >
                    {TOOL_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Field
                      label="挖掘等级（0–10）"
                      error={miningLevelCheck?.error}
                      hint="0木 1石 2铁 3钻 4下界合金"
                    >
                      <input
                        type="number"
                        className="mc-input w-full"
                        value={draft.miningLevel}
                        min={0}
                        max={10}
                        onChange={(e) => {
                          const next = { ...draft, miningLevel: e.target.value };
                          setDraft(next);
                          if (!selected) return;
                          const ml = validateInt(next.miningLevel, '挖掘等级', 0, 10);
                          const sp = validateNum(next.toolSpeed, '挖掘速度', 0);
                          if (ml.value === null || sp.value === null) return;
                          updateItem(selected.id, {
                            tool: { type: next.toolType, miningLevel: ml.value, speed: sp.value },
                          });
                          markPushed(selected.id);
                        }}
                      />
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field label="挖掘速度（≥0）" error={toolSpeedCheck?.error}>
                      <input
                        type="number"
                        className="mc-input w-full"
                        value={draft.toolSpeed}
                        min={0}
                        step={0.5}
                        onChange={(e) => {
                          const next = { ...draft, toolSpeed: e.target.value };
                          setDraft(next);
                          if (!selected) return;
                          const ml = validateInt(next.miningLevel, '挖掘等级', 0, 10);
                          const sp = validateNum(next.toolSpeed, '挖掘速度', 0);
                          if (ml.value === null || sp.value === null) return;
                          updateItem(selected.id, {
                            tool: { type: next.toolType, miningLevel: ml.value, speed: sp.value },
                          });
                          markPushed(selected.id);
                        }}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 防具 */}
          <div>
            <div className="mb-1 flex items-center gap-2">
              <GroupTitle>防具属性</GroupTitle>
              <div className="ml-auto">
                <Toggle
                  checked={draft.isArmor}
                  onChange={(isArmor) => {
                    if (isArmor) {
                      const defense = defenseCheck?.value ?? 0;
                      const toughness = toughnessCheck?.value ?? 0;
                      applyDraft(
                        { isArmor, defense: String(defense), toughness: String(toughness) },
                        { armor: { slot: draft.armorSlot, defense, toughness } },
                      );
                    } else {
                      applyDraft({ isArmor }, { armor: undefined });
                    }
                  }}
                  label="是防具"
                />
              </div>
            </div>
            {draft.isArmor && (
              <div className="space-y-2">
                <Field label="防具槽位">
                  <select
                    className="mc-select w-full"
                    value={draft.armorSlot}
                    onChange={(e) => {
                      const armorSlot = e.target.value as ArmorSlot;
                      const next = { ...draft, armorSlot };
                      setDraft(next);
                      if (!selected) return;
                      const df = validateInt(next.defense, '防御点数', 0);
                      const tn = validateNum(next.toughness, '盔甲韧性', 0);
                      if (df.value === null || tn.value === null) return;
                      updateItem(selected.id, {
                        armor: { slot: armorSlot, defense: df.value, toughness: tn.value },
                      });
                      markPushed(selected.id);
                    }}
                  >
                    {ARMOR_SLOTS.map((s) => (
                      <option key={s} value={s}>
                        {ARMOR_SLOT_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Field label="防御点数 defense（≥0）" error={defenseCheck?.error}>
                      <input
                        type="number"
                        className="mc-input w-full"
                        value={draft.defense}
                        min={0}
                        onChange={(e) => {
                          const next = { ...draft, defense: e.target.value };
                          setDraft(next);
                          if (!selected) return;
                          const df = validateInt(next.defense, '防御点数', 0);
                          const tn = validateNum(next.toughness, '盔甲韧性', 0);
                          if (df.value === null || tn.value === null) return;
                          updateItem(selected.id, {
                            armor: { slot: next.armorSlot, defense: df.value, toughness: tn.value },
                          });
                          markPushed(selected.id);
                        }}
                      />
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field label="盔甲韧性 toughness（≥0）" error={toughnessCheck?.error}>
                      <input
                        type="number"
                        className="mc-input w-full"
                        value={draft.toughness}
                        min={0}
                        step={0.5}
                        onChange={(e) => {
                          const next = { ...draft, toughness: e.target.value };
                          setDraft(next);
                          if (!selected) return;
                          const df = validateInt(next.defense, '防御点数', 0);
                          const tn = validateNum(next.toughness, '盔甲韧性', 0);
                          if (df.value === null || tn.value === null) return;
                          updateItem(selected.id, {
                            armor: { slot: next.armorSlot, defense: df.value, toughness: tn.value },
                          });
                          markPushed(selected.id);
                        }}
                      />
                    </Field>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* 生成 JSON 预览 */}
          <div>
            <GroupTitle>物品 JSON（spec.items 实时值）</GroupTitle>
            <pre className="mc-card max-h-40 overflow-auto p-2 text-[10px] text-mc-text">
              {JSON.stringify(selected, null, 2)}
            </pre>
          </div>
        </>
      )}
    </div>
  );
}

export function ItemRecipeEditor() {
  const [tab, setTab] = useState<Tab>('inventory');

  // 当前笔刷（调色板选中项）
  const [brush, setBrush] = useState<McInventoryItem | null>(null);

  // 物品栏状态
  const [mainItems, setMainItems] = useState<(McInventoryItem | null)[]>(EMPTY_MAIN);
  const [hotbarItems, setHotbarItems] = useState<(McInventoryItem | null)[]>(EMPTY_HOTBAR);
  const [selected, setSelected] = useState<{ grid: GridId; index: number } | null>(null);

  // 配方状态
  const [recipeGrid, setRecipeGrid] = useState<(McInventoryItem | null)[]>(EMPTY_RECIPE);
  const [recipeResult, setRecipeResult] = useState<McInventoryItem | null>(null);
  const [recipeJson, setRecipeJson] = useState('');

  // 调色板素材（按 scope 分组，memo 避免每次渲染重新扫描）
  const palettes = useMemo(() => SCOPES.map((s) => ({ ...s, names: listAssets(s.scope) })), []);

  // 在指定网格的 index 上：空格+笔刷→放置；已填→选中编辑
  const handleSlot = (
    grid: GridId,
    index: number,
    current: McInventoryItem | null,
    setter: React.Dispatch<React.SetStateAction<(McInventoryItem | null)[]>>,
  ) => {
    if (current) {
      setSelected({ grid, index });
      return;
    }
    if (brush) {
      setter((prev) => prev.map((it, i) => (i === index ? { ...brush, amount: 1 } : it)));
      setSelected(null);
    }
  };

  const updateAmount = (value: number) => {
    if (!selected) return;
    const v = Math.max(1, Math.min(64, Math.floor(value || 1)));
    if (selected.grid === 'main') {
      setMainItems((prev) =>
        prev.map((it, i) => (i === selected.index && it ? { ...it, amount: v } : it)),
      );
    } else if (selected.grid === 'hotbar') {
      setHotbarItems((prev) =>
        prev.map((it, i) => (i === selected.index && it ? { ...it, amount: v } : it)),
      );
    } else if (selected.grid === 'recipe') {
      setRecipeGrid((prev) =>
        prev.map((it, i) => (i === selected.index && it ? { ...it, amount: v } : it)),
      );
    } else if (selected.grid === 'result') {
      setRecipeResult((prev) => (prev ? { ...prev, amount: v } : prev));
    }
  };

  const clearSelected = () => {
    if (!selected) return;
    if (selected.grid === 'main') {
      setMainItems((prev) => prev.map((_, i) => (i === selected.index ? null : _)));
    } else if (selected.grid === 'hotbar') {
      setHotbarItems((prev) => prev.map((_, i) => (i === selected.index ? null : _)));
    } else if (selected.grid === 'recipe') {
      setRecipeGrid((prev) => prev.map((_, i) => (i === selected.index ? null : _)));
    } else if (selected.grid === 'result') {
      setRecipeResult(null);
    }
    setSelected(null);
  };

  const clearAllInventory = () => {
    setMainItems(EMPTY_MAIN());
    setHotbarItems(EMPTY_HOTBAR());
    setSelected(null);
  };

  // 当前选中的 item（用于编辑面板回显）
  const selectedItem: McInventoryItem | null = selected
    ? selected.grid === 'main'
      ? mainItems[selected.index]
      : selected.grid === 'hotbar'
        ? hotbarItems[selected.index]
        : selected.grid === 'recipe'
          ? recipeGrid[selected.index]
          : recipeResult
    : null;

  const generateRecipe = () => {
    const letters = 'ABCDEFGHI';
    const itemToLetter = new Map<string, string>();
    const key: Record<string, { item: string }> = {};
    const pattern: string[] = [];
    for (let r = 0; r < 3; r++) {
      let row = '';
      for (let c = 0; c < 3; c++) {
        const item = recipeGrid[r * 3 + c];
        if (!item) {
          row += ' ';
          continue;
        }
        const id = assetKey(item);
        let letter = itemToLetter.get(id);
        if (!letter) {
          letter = letters[itemToLetter.size];
          itemToLetter.set(id, letter);
          key[letter] = { item: id };
        }
        row += letter;
      }
      pattern.push(row);
    }
    const result = recipeResult
      ? { item: assetKey(recipeResult), count: recipeResult.amount ?? 1 }
      : { item: '', count: 1 };
    const recipe = {
      type: 'minecraft:crafting_shaped',
      pattern,
      key,
      result,
    };
    setRecipeJson(JSON.stringify(recipe, null, 2));
  };

  const copyJson = async () => {
    if (!recipeJson) return;
    try {
      await navigator.clipboard.writeText(recipeJson);
    } catch {
      /* 剪贴板不可用时静默忽略 */
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部 tab 切换 */}
      <div className="flex gap-2 border-b border-mc-border p-3">
        <button
          className={tab === 'inventory' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          onClick={() => setTab('inventory')}
        >
          物品栏
        </button>
        <button
          className={tab === 'recipe' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          onClick={() => setTab('recipe')}
        >
          配方
        </button>
        <button
          className={tab === 'items' ? 'mc-btn-primary' : 'mc-btn-ghost'}
          onClick={() => setTab('items')}
        >
          物品属性
        </button>
      </div>

      {/* 内容区（可滚动） */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {tab === 'inventory' && (
          <>
            {/* 当前笔刷 */}
            <div className="mc-card flex items-center gap-2 p-2">
              <span className="text-xs text-mc-dim">当前笔刷</span>
              {brush ? (
                <span className="flex items-center gap-1">
                  <McIcon scope={brush.scope ?? 'mob'} name={brush.name} size={18} />
                  <span className="text-xs text-mc-text">
                    {brush.scope ?? 'mob'}:{brush.name}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-mc-mute">未选择素材（点击下方素材库）</span>
              )}
            </div>

            {/* 素材调色板 */}
            <div>
              <div className="mc-section-title">素材库</div>
              <div className="max-h-56 space-y-2 overflow-auto pr-1">
                {palettes.map((group) => (
                  <div key={group.scope}>
                    <div className="mb-1 text-xs text-mc-dim">
                      {group.title}（{group.names.length}）
                    </div>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(8, 1fr)',
                        gap: 2,
                      }}
                    >
                      {group.names.map((name) => {
                        const isBrush = brush?.scope === group.scope && brush?.name === name;
                        return (
                          <button
                            key={name}
                            title={`${group.scope}:${name}`}
                            onClick={() => setBrush({ scope: group.scope, name })}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: 2,
                              background: 'rgb(var(--mc-surface-2))',
                              border:
                                '1px solid ' +
                                (isBrush ? 'rgb(var(--mc-accent))' : 'rgb(var(--mc-border))'),
                              borderRadius: 'var(--mc-radius-lg)',
                              cursor: 'pointer',
                              outline: isBrush ? '2px solid rgb(var(--mc-accent))' : 'none',
                              outlineOffset: isBrush ? -2 : 0,
                            }}
                          >
                            <McIcon scope={group.scope} name={name} size={18} />
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* 物品栏编辑 */}
            <div>
              <div className="mc-section-title">物品栏编辑</div>
              <SlotGrid
                items={mainItems}
                columns={COLUMNS}
                rows={MAIN_ROWS}
                selectedIndex={selected?.grid === 'main' ? selected.index : null}
                scale={1}
                onSlotClick={(i) => handleSlot('main', i, mainItems[i], setMainItems)}
              />
              <div style={{ height: 6 }} />
              <SlotGrid
                items={hotbarItems}
                columns={COLUMNS}
                rows={1}
                selectedIndex={selected?.grid === 'hotbar' ? selected.index : null}
                scale={1}
                onSlotClick={(i) => handleSlot('hotbar', i, hotbarItems[i], setHotbarItems)}
              />

              {selected && (selected.grid === 'main' || selected.grid === 'hotbar') && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-mc-dim">数量</span>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={selectedItem?.amount ?? 1}
                    onChange={(e) => updateAmount(Number(e.target.value))}
                    className="mc-input w-20"
                  />
                  <button className="mc-btn-ghost" onClick={clearSelected}>
                    清除
                  </button>
                </div>
              )}

              <div className="mt-2">
                <button className="mc-btn-ghost" onClick={clearAllInventory}>
                  全部清空
                </button>
              </div>
            </div>

            {/* 实时预览：把 McInventory 显示组件接进来做实时预览 */}
            <div>
              <div className="mc-section-title">实时预览</div>
              <div className="overflow-auto">
                <McInventory main={mainItems} hotbar={hotbarItems} scale={2} />
              </div>
            </div>
          </>
        )}

        {tab === 'recipe' && (
          <>
            {/* 当前笔刷（沿用同一支笔刷） */}
            <div className="mc-card flex items-center gap-2 p-2">
              <span className="text-xs text-mc-dim">当前笔刷</span>
              {brush ? (
                <span className="flex items-center gap-1">
                  <McIcon scope={brush.scope ?? 'mob'} name={brush.name} size={18} />
                  <span className="text-xs text-mc-text">
                    {brush.scope ?? 'mob'}:{brush.name}
                  </span>
                </span>
              ) : (
                <span className="text-xs text-mc-mute">未选择素材（切到「物品栏」挑选）</span>
              )}
            </div>

            {/* 3×3 合成网格 + 结果格 */}
            <div>
              <div className="mc-section-title">合成网格（3×3）</div>
              <div className="flex items-start gap-3">
                <SlotGrid
                  items={recipeGrid}
                  columns={3}
                  rows={3}
                  selectedIndex={selected?.grid === 'recipe' ? selected.index : null}
                  scale={1}
                  onSlotClick={(i) => handleSlot('recipe', i, recipeGrid[i], setRecipeGrid)}
                />
                <div className="flex flex-col items-center gap-1">
                  <span className="text-xs text-mc-dim">结果</span>
                  <Slot
                    item={recipeResult}
                    selected={selected?.grid === 'result'}
                    scale={1}
                    onClick={() => {
                      if (recipeResult) {
                        setSelected({ grid: 'result', index: 0 });
                      } else if (brush) {
                        setRecipeResult({ ...brush, amount: 1 });
                        setSelected(null);
                      }
                    }}
                  />
                </div>
              </div>

              {selected && (selected.grid === 'recipe' || selected.grid === 'result') && (
                <div className="mt-2 flex items-center gap-2">
                  <span className="text-xs text-mc-dim">数量</span>
                  <input
                    type="number"
                    min={1}
                    max={64}
                    value={selectedItem?.amount ?? 1}
                    onChange={(e) => updateAmount(Number(e.target.value))}
                    className="mc-input w-20"
                  />
                  <button className="mc-btn-ghost" onClick={clearSelected}>
                    清除
                  </button>
                </div>
              )}
            </div>

            {/* 生成配方 JSON */}
            <div>
              <div className="mc-section-title">配方 JSON</div>
              <div className="flex gap-2">
                <button
                  className="mc-btn-primary"
                  onClick={generateRecipe}
                  disabled={!recipeResult}
                >
                  生成配方 JSON
                </button>
                <button className="mc-btn-ghost" onClick={copyJson} disabled={!recipeJson}>
                  复制
                </button>
              </div>
              {!recipeResult && <div className="mt-1 text-xs text-mc-mute">请先放置结果物品</div>}
              {recipeJson && (
                <pre className="mc-card mt-2 overflow-auto p-2 text-xs text-mc-text">
                  {recipeJson}
                </pre>
              )}
            </div>
          </>
        )}

        {tab === 'items' && <ItemSpecPanel />}
      </div>
    </div>
  );
}
