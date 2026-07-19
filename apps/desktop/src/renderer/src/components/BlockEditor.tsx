import { useState, useCallback } from 'react';
import { Plus, X, Copy, ChevronDown, ChevronRight, Lightbulb, Shield, Hammer } from 'lucide-react';
import { listAssets, type McAssetScope } from '../assets/mc-ui/mc-ui';
import { McIcon } from '../assets/mc-ui/McIcon';
import { useModStore } from '../store/mod-store.js';
import type { ItemSpec } from '@mc-creator/shared';

const SCOPES: McAssetScope[] = ['mob', 'game', 'pixel'];
const STACKS = [1, 16, 64];
const RARITIES = ['common', 'uncommon', 'rare', 'epic'] as const;

/** MC 标准工具类型 */
const TOOL_TYPES = ['none', 'pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'shears'] as const;
type ToolType = (typeof TOOL_TYPES)[number];

const TOOL_LABELS: Record<ToolType, string> = {
  none: '无',
  pickaxe: '镐',
  axe: '斧',
  shovel: '锹',
  hoe: '锄',
  sword: '剑',
  shears: '剪',
};

/** MC 标准创造模式标签页 */
const CREATIVE_TABS = [
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
type CreativeTab = (typeof CREATIVE_TABS)[number];

const CREATIVE_TAB_LABELS: Record<CreativeTab, string> = {
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

/** 方块状态属性 */
interface BlockProperty {
  name: string;
  type: 'bool' | 'int' | 'enum';
  values: string[];
  defaultValue: string;
}

/** 由素材名生成合法的 ItemSpec.id（小写下划线，匹配 ^[a-z0-9_]+$） */
function toItemId(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'item'
  );
}

/** 预设方块属性模板 */
const BLOCK_PROPERTY_PRESETS: { name: string; props: BlockProperty[] }[] = [
  {
    name: '朝向方块（facing）',
    props: [
      {
        name: 'facing',
        type: 'enum',
        values: ['north', 'south', 'east', 'west'],
        defaultValue: 'north',
      },
    ],
  },
  {
    name: '朝向六面（facing6）',
    props: [
      {
        name: 'facing',
        type: 'enum',
        values: ['north', 'south', 'east', 'west', 'up', 'down'],
        defaultValue: 'north',
      },
    ],
  },
  {
    name: '开关（powered）',
    props: [{ name: 'powered', type: 'bool', values: ['true', 'false'], defaultValue: 'false' }],
  },
  {
    name: '半砖（half）',
    props: [
      { name: 'half', type: 'enum', values: ['top', 'bottom'], defaultValue: 'bottom' },
      { name: 'waterlogged', type: 'bool', values: ['true', 'false'], defaultValue: 'false' },
    ],
  },
  {
    name: '楼梯（stairs）',
    props: [
      {
        name: 'facing',
        type: 'enum',
        values: ['north', 'south', 'east', 'west'],
        defaultValue: 'north',
      },
      { name: 'half', type: 'enum', values: ['top', 'bottom'], defaultValue: 'bottom' },
      {
        name: 'shape',
        type: 'enum',
        values: ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'],
        defaultValue: 'straight',
      },
      { name: 'waterlogged', type: 'bool', values: ['true', 'false'], defaultValue: 'false' },
    ],
  },
  {
    name: '含水方块',
    props: [
      { name: 'waterlogged', type: 'bool', values: ['true', 'false'], defaultValue: 'false' },
    ],
  },
  {
    name: '层级方块（layers）',
    props: [
      {
        name: 'layers',
        type: 'int',
        values: ['1', '2', '3', '4', '5', '6', '7', '8'],
        defaultValue: '1',
      },
    ],
  },
  {
    name: '雪方块（snowy）',
    props: [{ name: 'snowy', type: 'bool', values: ['true', 'false'], defaultValue: 'false' }],
  },
];

/** 方块 / 物品属性编辑器：选素材 → 配属性 → 写入 mod-store.spec.items。 */
export function BlockEditor() {
  const [scope, setScope] = useState<McAssetScope>('game');
  const [selected, setSelected] = useState('stone-block');
  const [displayName, setDisplayName] = useState('');
  const [maxStack, setMaxStack] = useState(64);
  const [rarity, setRarity] = useState<(typeof RARITIES)[number]>('common');

  // 方块特有属性
  const [isBlock, setIsBlock] = useState(true);
  const [hardness, setHardness] = useState(1.5);
  const [resistance, setResistance] = useState(10);
  const [toolType, setToolType] = useState<ToolType>('pickaxe');
  const [toolTier, setToolTier] = useState(1); // 0=木 1=石 2=铁 3=钻 4=下界合金
  const [lightLevel, setLightLevel] = useState(0);
  const [isOpaque, setIsOpaque] = useState(true);
  const [isSolid, setIsSolid] = useState(true);
  const [creativeTab, setCreativeTab] = useState<CreativeTab>('building_blocks');
  const [hasInventory, setHasInventory] = useState(false);
  const [isFlammable, setIsFlammable] = useState(false);
  const [expDrop, setExpDrop] = useState(0);

  // 方块状态属性
  const [blockProps, setBlockProps] = useState<BlockProperty[]>([]);
  const [expandedProps, setExpandedProps] = useState(true);

  const addItem = useModStore((s) => s.addItem);
  const removeItem = useModStore((s) => s.removeItem);
  const items = useModStore((s) => s.spec?.items ?? []);

  const names = listAssets(scope);

  const buildItem = (): ItemSpec => ({
    id: toItemId(selected),
    name: displayName || selected,
    maxStackSize: maxStack,
    rarity,
    maxDamage: 0,
    fuelTick: 0,
    lore: '',
    attributes: [],
    defaultEnchantments: [],
    itemCategory: creativeTab,
  });

  const json = JSON.stringify(buildItem(), null, 2);

  // 添加预设属性
  const applyPreset = useCallback((preset: (typeof BLOCK_PROPERTY_PRESETS)[number]) => {
    setBlockProps((prev) => {
      const newProps = [...prev];
      for (const prop of preset.props) {
        if (!newProps.find((p) => p.name === prop.name)) {
          newProps.push({ ...prop });
        }
      }
      return newProps;
    });
  }, []);

  // 移除属性
  const removeProp = useCallback((name: string) => {
    setBlockProps((prev) => prev.filter((p) => p.name !== name));
  }, []);

  // 添加自定义属性
  const addCustomProp = useCallback(() => {
    setBlockProps((prev) => [
      ...prev,
      { name: 'custom', type: 'enum', values: ['a', 'b'], defaultValue: 'a' },
    ]);
  }, []);

  const TIER_LABELS = ['木', '石', '铁', '钻', '下界合金'];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-mc-surface">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="box" size={14} className="text-mc-accent" />
        <span className="text-xs font-medium text-mc-text">方块 / 物品编辑器</span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setIsBlock(true)}
            className={`rounded-mc px-2 py-0.5 text-[10px] ${isBlock ? 'bg-mc-accent text-white' : 'text-mc-dim hover:bg-mc-surface-2'}`}
          >
            方块
          </button>
          <button
            onClick={() => setIsBlock(false)}
            className={`rounded-mc px-2 py-0.5 text-[10px] ${!isBlock ? 'bg-mc-accent text-white' : 'text-mc-dim hover:bg-mc-surface-2'}`}
          >
            物品
          </button>
        </div>
      </div>

      <div className="space-y-3 p-3">
        {/* 素材选择 */}
        <div>
          <div className="mb-1 text-[10px] font-medium text-mc-dim">素材选择</div>
          <div className="mb-1 flex gap-1">
            {SCOPES.map((s) => (
              <button
                key={s}
                onClick={() => {
                  setScope(s);
                  setSelected(listAssets(s)[0] ?? '');
                }}
                className={`rounded-mc px-2 py-0.5 text-[10px] ${scope === s ? 'bg-mc-surface-2 text-mc-text' : 'text-mc-dim hover:bg-mc-surface-2'}`}
              >
                {s}
              </button>
            ))}
          </div>
          <div className="grid max-h-32 grid-cols-8 gap-1 overflow-y-auto rounded-mc border border-mc-border bg-mc-surface-2 p-1">
            {names.map((n) => (
              <button
                key={n}
                onClick={() => setSelected(n)}
                className={`flex items-center justify-center rounded p-1 transition-colors ${
                  selected === n ? 'bg-mc-accent/30' : 'hover:bg-mc-surface-3'
                }`}
                title={n}
              >
                <McIcon scope={scope} name={n} size={18} />
              </button>
            ))}
          </div>
        </div>

        {/* 基础属性 */}
        <div>
          <div className="mb-1 text-[10px] font-medium text-mc-dim">基础属性</div>
          <div className="space-y-2">
            <div>
              <label className="mb-0.5 block text-[10px] text-mc-dim">显示名称</label>
              <input
                className="mc-input w-full"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={selected}
              />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <label className="mb-0.5 block text-[10px] text-mc-dim">最大堆叠</label>
                <select
                  className="mc-select w-full"
                  value={maxStack}
                  onChange={(e) => setMaxStack(Number(e.target.value))}
                >
                  {STACKS.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex-1">
                <label className="mb-0.5 block text-[10px] text-mc-dim">稀有度</label>
                <select
                  className="mc-select w-full"
                  value={rarity}
                  onChange={(e) => setRarity(e.target.value as (typeof RARITIES)[number])}
                >
                  {RARITIES.map((v) => (
                    <option key={v} value={v}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-mc-dim">创造模式标签页</label>
              <select
                className="mc-select w-full"
                value={creativeTab}
                onChange={(e) => setCreativeTab(e.target.value as CreativeTab)}
              >
                {CREATIVE_TABS.map((t) => (
                  <option key={t} value={t}>
                    {CREATIVE_TAB_LABELS[t]}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* ===== 方块特有属性 ===== */}
        {isBlock && (
          <>
            {/* 硬度 & 抗爆 */}
            <div>
              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-mc-dim">
                <Shield className="h-3 w-3" /> 硬度 & 抗爆
              </div>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="mb-0.5 block text-[10px] text-mc-mute">硬度</label>
                    <input
                      type="number"
                      className="mc-input w-full"
                      value={hardness}
                      onChange={(e) => setHardness(parseFloat(e.target.value) || 0)}
                      step={0.5}
                      min={0}
                    />
                    <div className="mt-0.5 text-[9px] text-mc-mute">
                      {hardness === 0
                        ? '瞬间破坏'
                        : hardness === -1
                          ? '不可破坏'
                          : `≈${(hardness * 1.5).toFixed(1)}秒（铁镐）`}
                    </div>
                  </div>
                  <div className="flex-1">
                    <label className="mb-0.5 block text-[10px] text-mc-mute">抗爆</label>
                    <input
                      type="number"
                      className="mc-input w-full"
                      value={resistance}
                      onChange={(e) => setResistance(parseFloat(e.target.value) || 0)}
                      step={1}
                      min={0}
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <label className="mb-0.5 block text-[10px] text-mc-mute">开采工具</label>
                    <select
                      className="mc-select w-full"
                      value={toolType}
                      onChange={(e) => setToolType(e.target.value as ToolType)}
                    >
                      {TOOL_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {TOOL_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="mb-0.5 block text-[10px] text-mc-mute">工具等级</label>
                    <select
                      className="mc-select w-full"
                      value={toolTier}
                      onChange={(e) => setToolTier(Number(e.target.value))}
                    >
                      {TIER_LABELS.map((label, i) => (
                        <option key={i} value={i}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>
            </div>

            {/* 光照 & 材质 */}
            <div>
              <div className="mb-1 flex items-center gap-1 text-[10px] font-medium text-mc-dim">
                <Lightbulb className="h-3 w-3" /> 光照 & 材质
              </div>
              <div className="space-y-2">
                <div>
                  <label className="mb-0.5 block text-[10px] text-mc-mute">光照等级（0-15）</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min={0}
                      max={15}
                      value={lightLevel}
                      onChange={(e) => setLightLevel(Number(e.target.value))}
                      className="flex-1 accent-mc-accent"
                    />
                    <span className="w-6 text-right text-[10px] text-mc-text">{lightLevel}</span>
                  </div>
                </div>
                <div className="flex gap-3">
                  <label className="flex items-center gap-1 text-[10px] text-mc-dim">
                    <input
                      type="checkbox"
                      checked={isOpaque}
                      onChange={(e) => setIsOpaque(e.target.checked)}
                      className="h-3 w-3 accent-mc-accent"
                    />
                    不透明
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-mc-dim">
                    <input
                      type="checkbox"
                      checked={isSolid}
                      onChange={(e) => setIsSolid(e.target.checked)}
                      className="h-3 w-3 accent-mc-accent"
                    />
                    实心
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-mc-dim">
                    <input
                      type="checkbox"
                      checked={isFlammable}
                      onChange={(e) => setIsFlammable(e.target.checked)}
                      className="h-3 w-3 accent-mc-accent"
                    />
                    可燃
                  </label>
                  <label className="flex items-center gap-1 text-[10px] text-mc-dim">
                    <input
                      type="checkbox"
                      checked={hasInventory}
                      onChange={(e) => setHasInventory(e.target.checked)}
                      className="h-3 w-3 accent-mc-accent"
                    />
                    容器
                  </label>
                </div>
                {hasInventory && (
                  <div>
                    <label className="mb-0.5 block text-[10px] text-mc-mute">掉落经验</label>
                    <input
                      type="number"
                      className="mc-input w-20"
                      value={expDrop}
                      onChange={(e) => setExpDrop(parseInt(e.target.value) || 0)}
                      min={0}
                    />
                  </div>
                )}
              </div>
            </div>

            {/* 方块状态属性 */}
            <div>
              <button
                onClick={() => setExpandedProps(!expandedProps)}
                className="mb-1 flex w-full items-center gap-1 text-[10px] font-medium text-mc-dim hover:text-mc-text"
              >
                {expandedProps ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                <Hammer className="h-3 w-3" />
                方块状态属性（{blockProps.length}）
              </button>

              {expandedProps && (
                <div className="space-y-2">
                  {/* 预设模板 */}
                  <div>
                    <div className="mb-1 text-[9px] text-mc-mute">属性模板</div>
                    <div className="flex flex-wrap gap-1">
                      {BLOCK_PROPERTY_PRESETS.map((preset) => (
                        <button
                          key={preset.name}
                          onClick={() => applyPreset(preset)}
                          className="rounded-mc border border-mc-border bg-mc-surface-2 px-1.5 py-0.5 text-[9px] text-mc-dim transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
                        >
                          + {preset.name}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* 已添加属性列表 */}
                  {blockProps.length > 0 && (
                    <div className="space-y-1">
                      {blockProps.map((prop) => (
                        <div
                          key={prop.name}
                          className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[10px]"
                        >
                          <span className="font-mono text-mc-accent">{prop.name}</span>
                          <span className="text-mc-mute">:</span>
                          <span className="text-mc-dim">
                            {prop.type === 'bool'
                              ? 'bool'
                              : prop.type === 'int'
                                ? `int[${prop.values[0]}..${prop.values[prop.values.length - 1]}]`
                                : `enum{${prop.values.join(',')}}`}
                          </span>
                          <span className="text-mc-mute">= {prop.defaultValue}</span>
                          <button
                            onClick={() => removeProp(prop.name)}
                            className="ml-auto text-mc-mute hover:text-red-400"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 自定义属性 */}
                  <button
                    onClick={addCustomProp}
                    className="flex items-center gap-1 rounded-mc border border-dashed border-mc-border px-2 py-0.5 text-[9px] text-mc-dim hover:border-mc-accent hover:text-mc-text"
                  >
                    <Plus className="h-3 w-3" />
                    添加自定义属性
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {/* 写入 mod-store */}
        <div className="flex items-center gap-2">
          <button className="mc-btn" onClick={() => addItem(buildItem())}>
            <Plus size={14} /> 添加到 Mod
          </button>
          <span className="text-[10px] text-mc-dim">已加入 {items.length} 个物品</span>
        </div>

        {/* 已加入列表 */}
        {items.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] text-mc-dim">已加入物品</div>
            <ul className="mc-card max-h-32 space-y-1 overflow-auto p-2">
              {items.map((it) => (
                <li key={it.id} className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate text-mc-text">
                    {it.name} <span className="text-mc-mute">({it.id})</span>
                  </span>
                  <button
                    className="mc-btn-ghost !px-1.5 !py-0.5"
                    onClick={() => removeItem(it.id)}
                    title="移除"
                  >
                    <X size={12} />
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* 预览 */}
        <div>
          <div className="mb-1 text-[10px] text-mc-dim">生成 JSON</div>
          <pre className="mc-card max-h-40 overflow-auto p-2 text-[10px] text-mc-text">{json}</pre>
          {isBlock && blockProps.length > 0 && (
            <pre className="mc-card mt-1 max-h-40 overflow-auto p-2 text-[10px] text-mc-text">
              {JSON.stringify({ blockStates: blockProps }, null, 2)}
            </pre>
          )}
          <button
            className="mc-btn-ghost mt-1"
            onClick={() => {
              const full =
                isBlock && blockProps.length > 0
                  ? json + '\n\n// blockStates\n' + JSON.stringify(blockProps, null, 2)
                  : json;
              navigator.clipboard?.writeText(full);
            }}
          >
            <Copy size={14} /> 复制
          </button>
        </div>
      </div>
    </div>
  );
}
