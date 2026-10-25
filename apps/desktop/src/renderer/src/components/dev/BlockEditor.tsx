import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, X, Copy, ChevronDown, ChevronRight } from 'lucide-react';
import { listAssets, type McAssetScope } from '../../assets/mc-ui/mc-ui';
import { McIcon } from '../../assets/mc-ui/McIcon';
import { useModStore } from '../../store/mod-store.js';
import type { BlockSpec } from '@mc-creator/shared';
import {
  TOOL_TYPES,
  TOOL_LABELS,
  CREATIVE_TABS,
  CREATIVE_TAB_LABELS,
  SOUND_TYPES,
  SOUND_LABELS,
  MAP_COLORS,
  BLOCK_MATERIALS,
  type ToolType,
  type CreativeTab,
  type SoundType,
  type BlockMaterial,
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
} from '../SpecEditorFields';

/** 方块行为类型（BlockSpec.blockType 全集） */
const BLOCK_TYPES = [
  'full_block',
  'slab',
  'stairs',
  'fence',
  'fence_gate',
  'wall',
  'door',
  'trapdoor',
  'button',
  'pressure_plate',
  'lever',
  'sign',
  'bed',
  'chest',
  'piston',
  'torch',
  'custom',
] as const;
type BlockType = (typeof BLOCK_TYPES)[number];

/** 方块状态属性（编辑态，min/max 仅 int 类型有效） */
interface BlockProperty {
  name: string;
  type: 'bool' | 'int' | 'enum';
  values: string[];
  defaultValue: string;
  minText?: string;
  maxText?: string;
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
        minText: '1',
        maxText: '8',
      },
    ],
  },
  {
    name: '雪方块（snowy）',
    props: [{ name: 'snowy', type: 'bool', values: ['true', 'false'], defaultValue: 'false' }],
  },
];

/** 表单草稿：数字字段保持字符串形态，非法输入只行内报错、不阻断其他字段提交 */
interface BlockDraft {
  idText: string;
  name: string;
  scope: McAssetScope;
  assetName: string;
  material: BlockMaterial;
  hardness: string;
  resistance: string;
  lightLevel: string;
  sound: SoundType;
  friction: string;
  mapColor: string;
  creativeTab: CreativeTab;
  toolType: ToolType;
  miningLevel: string;
  toolRequired: boolean;
  blockType: BlockType;
  dropSelf: boolean;
  dropItem: string;
  transparent: boolean;
  noCollision: boolean;
  props: BlockProperty[];
}

function toBlockProp(p: BlockSpec['stateProperties'][number]): BlockProperty {
  return {
    name: p.name,
    type: p.type,
    values: [...p.values],
    defaultValue: p.defaultValue,
    ...(p.min !== undefined ? { minText: String(p.min) } : {}),
    ...(p.max !== undefined ? { maxText: String(p.max) } : {}),
  };
}

function toBlockDraft(block: BlockSpec): BlockDraft {
  const tex = parseTexturePath(block.texturePath);
  return {
    idText: block.id,
    name: block.name,
    scope: tex?.scope ?? 'game',
    assetName: tex?.name ?? '',
    material: block.material,
    hardness: String(block.hardness),
    resistance: String(block.resistance),
    lightLevel: String(block.lightLevel),
    sound: block.soundType,
    friction: String(block.friction ?? 0.6),
    mapColor: block.mapColor ?? 'stone',
    creativeTab: block.creativeTab ?? 'building_blocks',
    toolType: block.toolType ?? 'none',
    miningLevel: String(block.miningLevel),
    toolRequired: block.toolRequired ?? false,
    blockType: block.blockType,
    dropSelf: block.dropSelf,
    dropItem: block.dropItem,
    transparent: block.transparent,
    noCollision: block.noCollision,
    props: (block.stateProperties ?? []).map(toBlockProp),
  };
}

/** 把编辑态属性转为可提交的 spec 形态（min/max 非法时省略） */
function toSpecProps(props: BlockProperty[]): BlockSpec['stateProperties'] {
  return props.map((p) => {
    const min = p.minText !== undefined && p.minText.trim() !== '' ? Number(p.minText) : null;
    const max = p.maxText !== undefined && p.maxText.trim() !== '' ? Number(p.maxText) : null;
    return {
      name: p.name,
      type: p.type,
      values: p.values,
      defaultValue: p.defaultValue,
      ...(p.type === 'int' && min !== null && Number.isInteger(min) ? { min } : {}),
      ...(p.type === 'int' && max !== null && Number.isInteger(max) ? { max } : {}),
    };
  });
}

/** 单个状态属性的行内校验 */
function propError(prop: BlockProperty, index: number, all: BlockProperty[]): string | null {
  if (!prop.name.trim()) return '属性名必填';
  if (!isValidId(prop.name.trim())) return '属性名仅允许小写字母/数字/下划线';
  if (all.findIndex((p) => p.name.trim() === prop.name.trim()) !== index) return '属性名重复';
  if (prop.type === 'enum') {
    if (prop.values.length === 0) return 'enum 至少需要一个可选值（逗号分隔）';
    if (prop.defaultValue && !prop.values.includes(prop.defaultValue)) return '默认值不在可选值中';
  }
  if (prop.type === 'bool' && prop.defaultValue !== 'true' && prop.defaultValue !== 'false') {
    return 'bool 默认值须为 true / false';
  }
  if (prop.type === 'int') {
    if (
      prop.minText !== undefined &&
      prop.minText.trim() !== '' &&
      !Number.isInteger(Number(prop.minText))
    ) {
      return 'min 必须为整数（留空则不限）';
    }
    if (
      prop.maxText !== undefined &&
      prop.maxText.trim() !== '' &&
      !Number.isInteger(Number(prop.maxText))
    ) {
      return 'max 必须为整数（留空则不限）';
    }
  }
  return null;
}

/** 方块属性编辑器：可视化表单 ↔ spec.blocks 双向同步。 */
export function BlockEditor() {
  const blocks = useModStore((s) => s.spec?.blocks ?? []);
  const recipes = useModStore((s) => s.spec?.recipes);
  const itemIds = useModStore((s) => s.spec?.items.map((i) => i.id) ?? []);
  const addBlock = useModStore((s) => s.addBlock);
  const updateBlock = useModStore((s) => s.updateBlock);
  const removeBlock = useModStore((s) => s.removeBlock);
  const renameBlockId = useModStore((s) => s.renameBlockId);

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const selected = blocks.find((b) => b.id === selectedBlockId) ?? null;
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  /** 最近一次写入 store 的选中方块快照：effect 靠它区分"外部变更"与"自身写入" */
  const lastPushedRef = useRef('');
  const [expandedProps, setExpandedProps] = useState(true);

  const taken = useMemo(() => new Set(blocks.map((b) => b.id)), [blocks]);

  // 选择失效（被删除 / 初始）时回退到首个方块
  useEffect(() => {
    if ((!selectedBlockId || !taken.has(selectedBlockId)) && blocks.length > 0) {
      const first = blocks[0].id;
      if (first !== selectedBlockId) setSelectedBlockId(first);
    } else if (blocks.length === 0 && selectedBlockId !== null) {
      setSelectedBlockId(null);
    }
  }, [blocks, selectedBlockId, taken]);

  // 双向同步：store 侧被外部改动时用新值回填表单；自身写入的不回填（靠 lastPushedRef 识别）
  useEffect(() => {
    const snap = selected ? JSON.stringify(selected) : '';
    if (snap !== lastPushedRef.current) {
      lastPushedRef.current = snap;
      setDraft(selected ? toBlockDraft(selected) : null);
    }
  }, [selected]);

  const markPushed = (id: string) => {
    const cur = useModStore.getState().spec?.blocks.find((b) => b.id === id);
    lastPushedRef.current = cur ? JSON.stringify(cur) : '';
  };

  /** 更新草稿 + 可选地提交部分 store 补丁（补丁为 undefined 时只改草稿，多用于非法输入） */
  const applyDraft = (d: Partial<BlockDraft>, storePatch?: Partial<BlockSpec>) => {
    setDraft((prev) => (prev ? { ...prev, ...d } : prev));
    if (storePatch && selected) {
      updateBlock(selected.id, storePatch);
      markPushed(selected.id);
    }
  };

  const createBlock = () => {
    const current = useModStore.getState().spec?.blocks ?? [];
    const takenSet = new Set(current.map((b) => b.id));
    const base = toValidId('new_block', 'new_block');
    let id = base;
    let n = 2;
    while (takenSet.has(id)) id = `${base}_${n++}`;
    const block: BlockSpec = {
      id,
      name: id,
      material: 'stone',
      hardness: 1.5,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
      stateProperties: [],
      collisionShapes: [],
      blockType: 'full_block',
      transparent: false,
      noCollision: false,
    };
    addBlock(block);
    lastPushedRef.current = JSON.stringify(block);
    setSelectedBlockId(id);
    setDraft(toBlockDraft(block));
  };

  // ---- 校验（渲染期纯计算，只展示、不阻断） ----
  const idCheck = draft && selected ? validateId(draft.idText, taken, selected.id) : null;
  const nameError = draft ? validateRequired(draft.name, '显示名称') : null;
  const hardnessCheck = draft ? validateNum(draft.hardness, '硬度', 0) : null;
  const resistanceCheck = draft ? validateNum(draft.resistance, '抗爆', 0) : null;
  const lightCheck = draft ? validateInt(draft.lightLevel, '光照等级', 0, 15) : null;
  const frictionCheck = draft ? validateNum(draft.friction, '摩擦', 0) : null;
  const miningLevelCheck = draft ? validateInt(draft.miningLevel, '挖掘等级', 0, 10) : null;
  const dropItemError =
    draft && !draft.dropSelf && !draft.dropItem.trim()
      ? '关闭自行掉落时掉落物品为空（将无掉落）'
      : null;

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
    renameBlockId(selected.id, target); // 配方 result/ingredient 引用由 store 同步改名
    setSelectedBlockId(target);
  };

  const pushProps = (next: BlockProperty[]) => {
    setDraft((prev) => (prev ? { ...prev, props: next } : prev));
    if (!selected) return;
    updateBlock(selected.id, { stateProperties: toSpecProps(next) });
    markPushed(selected.id);
  };

  const applyPreset = (preset: (typeof BLOCK_PROPERTY_PRESETS)[number]) => {
    if (!draft) return;
    const next = [...draft.props];
    for (const prop of preset.props) {
      if (!next.find((p) => p.name === prop.name)) next.push({ ...prop });
    }
    pushProps(next);
  };

  const addCustomProp = () => {
    if (!draft) return;
    const base = 'custom';
    let name = base;
    let n = 2;
    while (draft.props.some((p) => p.name === name)) name = `${base}_${n++}`;
    pushProps([...draft.props, { name, type: 'enum', values: ['a', 'b'], defaultValue: 'a' }]);
  };

  const refs = selected ? findRecipeRefs(recipes, selected.id) : null;
  const mapColorOptions = draft
    ? (MAP_COLORS as readonly string[]).includes(draft.mapColor)
      ? (MAP_COLORS as readonly string[])
      : [draft.mapColor, ...MAP_COLORS]
    : [];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-mc-surface">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="box" size={14} className="text-mc-accent" />
        <span className="text-xs font-medium text-mc-text">方块编辑器</span>
        <span className="text-[10px] text-mc-mute">可视化表单 ↔ spec.blocks</span>
      </div>

      <div className="space-y-3 p-3">
        {/* 方块列表 */}
        <div>
          <GroupTitle>方块列表（{blocks.length}）</GroupTitle>
          <div className="mb-2 flex gap-2">
            <button className="mc-btn-primary" onClick={createBlock}>
              <Plus size={14} /> 新建方块
            </button>
            {selected && (
              <button
                className="mc-btn-ghost"
                onClick={() => removeBlock(selected.id)}
                title="删除当前方块"
              >
                删除当前
              </button>
            )}
          </div>
          {blocks.length > 0 ? (
            <ul className="mc-card max-h-32 space-y-1 overflow-auto p-2">
              {blocks.map((b) => (
                <li key={b.id}>
                  <button
                    onClick={() => setSelectedBlockId(b.id)}
                    className={`flex w-full items-center justify-between gap-2 rounded-mc px-2 py-1 text-xs transition-colors ${
                      b.id === selectedBlockId
                        ? 'bg-mc-accent/30 text-mc-text'
                        : 'text-mc-dim hover:bg-mc-surface-3 hover:text-mc-text'
                    }`}
                  >
                    <span className="truncate">
                      {b.name} <span className="text-mc-mute">({b.id})</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="text-xs text-mc-mute">暂无方块，点击「新建方块」开始。</div>
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
                    placeholder="如 ruby_block"
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
                    placeholder="如 红宝石块"
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
                      applyDraft(
                        { assetName: n },
                        { texturePath: formatTexturePath(draft.scope, n) },
                      )
                    }
                  />
                </Field>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Field label="材质">
                      <select
                        className="mc-select w-full"
                        value={draft.material}
                        onChange={(e) => {
                          const material = e.target.value as BlockMaterial;
                          applyDraft({ material }, { material });
                        }}
                      >
                        {BLOCK_MATERIALS.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field label="行为类型">
                      <select
                        className="mc-select w-full"
                        value={draft.blockType}
                        onChange={(e) => {
                          const blockType = e.target.value as BlockType;
                          applyDraft({ blockType }, { blockType });
                        }}
                      >
                        {BLOCK_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {t}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </div>
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
              </div>
            </div>

            {/* 硬度 & 抗爆 & 挖掘 */}
            <div>
              <GroupTitle>硬度 & 抗爆 & 挖掘</GroupTitle>
              <div className="space-y-2">
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Field
                      label="硬度 hardness（≥0）"
                      error={hardnessCheck?.error}
                      hint="0=瞬间破坏，数值越大越难挖"
                    >
                      <input
                        type="number"
                        className="mc-input w-full"
                        value={draft.hardness}
                        min={0}
                        step={0.5}
                        onChange={(e) => {
                          const v = validateNum(e.target.value, '硬度', 0);
                          applyDraft(
                            { hardness: e.target.value },
                            v.value === null ? undefined : { hardness: v.value },
                          );
                        }}
                      />
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field label="抗爆 resistance（≥0）" error={resistanceCheck?.error}>
                      <input
                        type="number"
                        className="mc-input w-full"
                        value={draft.resistance}
                        min={0}
                        step={1}
                        onChange={(e) => {
                          const v = validateNum(e.target.value, '抗爆', 0);
                          applyDraft(
                            { resistance: e.target.value },
                            v.value === null ? undefined : { resistance: v.value },
                          );
                        }}
                      />
                    </Field>
                  </div>
                </div>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Field label="偏好工具">
                      <select
                        className="mc-select w-full"
                        value={draft.toolType}
                        onChange={(e) => {
                          const toolType = e.target.value as ToolType;
                          applyDraft({ toolType }, { toolType });
                        }}
                      >
                        {TOOL_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {TOOL_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field label="挖掘等级（0–10）" error={miningLevelCheck?.error}>
                      <input
                        type="number"
                        className="mc-input w-full"
                        value={draft.miningLevel}
                        min={0}
                        max={10}
                        onChange={(e) => {
                          const v = validateInt(e.target.value, '挖掘等级', 0, 10);
                          applyDraft(
                            { miningLevel: e.target.value },
                            v.value === null ? undefined : { miningLevel: v.value },
                          );
                        }}
                      />
                    </Field>
                  </div>
                </div>
                <Toggle
                  checked={draft.toolRequired}
                  onChange={(v) => applyDraft({ toolRequired: v }, { toolRequired: v })}
                  label="必须用正确工具挖掘才掉落（toolRequired）"
                />
              </div>
            </div>

            {/* 光照 & 物理 */}
            <div>
              <GroupTitle>光照 & 物理</GroupTitle>
              <div className="space-y-2">
                <Field label="光照等级 lightLevel（0–15）" error={lightCheck?.error}>
                  <div className="flex items-center gap-1">
                    <input
                      type="range"
                      min={0}
                      max={15}
                      value={Number(draft.lightLevel) || 0}
                      onChange={(e) => {
                        const v = validateInt(e.target.value, '光照等级', 0, 15);
                        applyDraft(
                          { lightLevel: e.target.value },
                          v.value === null ? undefined : { lightLevel: v.value },
                        );
                      }}
                      className="flex-1 accent-mc-accent"
                    />
                    <input
                      type="number"
                      className="mc-input w-16"
                      value={draft.lightLevel}
                      min={0}
                      max={15}
                      onChange={(e) => {
                        const v = validateInt(e.target.value, '光照等级', 0, 15);
                        applyDraft(
                          { lightLevel: e.target.value },
                          v.value === null ? undefined : { lightLevel: v.value },
                        );
                      }}
                    />
                  </div>
                </Field>
                <div className="flex gap-2">
                  <div className="flex-1">
                    <Field label="声音 sound" hint="挖掘/放置/脚步音效组">
                      <select
                        className="mc-select w-full"
                        value={draft.sound}
                        onChange={(e) => {
                          const soundType = e.target.value as SoundType;
                          applyDraft({ sound: soundType }, { soundType });
                        }}
                      >
                        {SOUND_TYPES.map((s) => (
                          <option key={s} value={s}>
                            {SOUND_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                  <div className="flex-1">
                    <Field
                      label="摩擦 friction（≥0）"
                      error={frictionCheck?.error}
                      hint="默认 0.6，冰约 0.98"
                    >
                      <input
                        type="number"
                        className="mc-input w-full"
                        value={draft.friction}
                        min={0}
                        step={0.01}
                        onChange={(e) => {
                          const v = validateNum(e.target.value, '摩擦', 0);
                          applyDraft(
                            { friction: e.target.value },
                            v.value === null ? undefined : { friction: v.value },
                          );
                        }}
                      />
                    </Field>
                  </div>
                </div>
                <Field label="地图颜色 mapColor">
                  <select
                    className="mc-select w-full"
                    value={draft.mapColor}
                    onChange={(e) =>
                      applyDraft({ mapColor: e.target.value }, { mapColor: e.target.value })
                    }
                  >
                    {mapColorOptions.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Field>
                <div className="flex gap-3">
                  <Toggle
                    checked={draft.transparent}
                    onChange={(v) => applyDraft({ transparent: v }, { transparent: v })}
                    label="透明（不遮挡光线）"
                  />
                  <Toggle
                    checked={draft.noCollision}
                    onChange={(v) => applyDraft({ noCollision: v }, { noCollision: v })}
                    label="无碰撞（可穿过）"
                  />
                </div>
              </div>
            </div>

            {/* 掉落 */}
            <div>
              <GroupTitle>掉落</GroupTitle>
              <div className="space-y-2">
                <Toggle
                  checked={draft.dropSelf}
                  onChange={(v) => applyDraft({ dropSelf: v }, { dropSelf: v })}
                  label="掉落自身"
                />
                {!draft.dropSelf && (
                  <Field
                    label="掉落物品 ID"
                    error={dropItemError}
                    hint="引用 spec.items 中的物品 id"
                  >
                    <input
                      className="mc-input w-full font-mono"
                      value={draft.dropItem}
                      list="block-drop-items"
                      onChange={(e) =>
                        applyDraft({ dropItem: e.target.value }, { dropItem: e.target.value })
                      }
                      placeholder="如 ruby"
                    />
                    <datalist id="block-drop-items">
                      {itemIds.map((id) => (
                        <option key={id} value={id} />
                      ))}
                    </datalist>
                  </Field>
                )}
              </div>
            </div>

            {/* 方块状态属性 */}
            <div>
              <button
                onClick={() => setExpandedProps(!expandedProps)}
                className="mb-1 flex w-full items-center gap-1 text-[10px] font-medium text-mc-dim hover:text-mc-text"
              >
                {expandedProps ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                方块状态属性 stateProperties（{draft.props.length}）
              </button>

              {expandedProps && (
                <div className="space-y-2">
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

                  {draft.props.length > 0 && (
                    <div className="space-y-1">
                      {draft.props.map((prop, idx) => {
                        const err = propError(prop, idx, draft.props);
                        const setProp = (patch: Partial<BlockProperty>) => {
                          const next = draft.props.map((p, i) =>
                            i === idx ? { ...p, ...patch } : p,
                          );
                          pushProps(next);
                        };
                        return (
                          <div
                            key={`${prop.name}-${idx}`}
                            className="space-y-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1"
                          >
                            <div className="flex items-center gap-1">
                              <input
                                className="mc-input min-w-0 flex-1 font-mono !text-[10px]"
                                value={prop.name}
                                onChange={(e) => setProp({ name: e.target.value })}
                                placeholder="属性名（如 facing）"
                                title="属性名"
                              />
                              <select
                                className="mc-select"
                                value={prop.type}
                                onChange={(e) =>
                                  setProp({ type: e.target.value as BlockProperty['type'] })
                                }
                                title="类型"
                              >
                                <option value="bool">bool</option>
                                <option value="int">int</option>
                                <option value="enum">enum</option>
                              </select>
                              <button
                                onClick={() => pushProps(draft.props.filter((_, i) => i !== idx))}
                                className="ml-auto text-mc-mute hover:text-red-400"
                                title="删除属性"
                              >
                                <X size={12} />
                              </button>
                            </div>
                            {prop.type === 'bool' ? (
                              <div className="flex items-center gap-1 text-[10px] text-mc-dim">
                                <span>默认值</span>
                                <select
                                  className="mc-select"
                                  value={prop.defaultValue}
                                  onChange={(e) => setProp({ defaultValue: e.target.value })}
                                >
                                  <option value="true">true</option>
                                  <option value="false">false</option>
                                </select>
                              </div>
                            ) : (
                              <div className="flex gap-1">
                                <input
                                  className="mc-input min-w-0 flex-1 font-mono !text-[10px]"
                                  value={prop.values.join(',')}
                                  onChange={(e) =>
                                    setProp({
                                      values: e.target.value
                                        .split(',')
                                        .map((v) => v.trim())
                                        .filter(Boolean),
                                    })
                                  }
                                  placeholder={
                                    prop.type === 'int'
                                      ? '可选值（逗号分隔，如 1,2,3）'
                                      : '可选值（逗号分隔）'
                                  }
                                  title="可选值（逗号分隔）"
                                />
                                <input
                                  className="mc-input w-20 font-mono !text-[10px]"
                                  value={prop.defaultValue}
                                  onChange={(e) => setProp({ defaultValue: e.target.value })}
                                  placeholder="默认值"
                                  title="默认值"
                                />
                              </div>
                            )}
                            {prop.type === 'int' && (
                              <div className="flex gap-1">
                                <input
                                  className="mc-input w-20 font-mono !text-[10px]"
                                  value={prop.minText ?? ''}
                                  onChange={(e) => setProp({ minText: e.target.value })}
                                  placeholder="min（可选）"
                                  title="最小值（可选）"
                                />
                                <input
                                  className="mc-input w-20 font-mono !text-[10px]"
                                  value={prop.maxText ?? ''}
                                  onChange={(e) => setProp({ maxText: e.target.value })}
                                  placeholder="max（可选）"
                                  title="最大值（可选）"
                                />
                              </div>
                            )}
                            {err && <div className="text-[10px] text-red-400">{err}</div>}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <button
                    onClick={addCustomProp}
                    className="flex items-center gap-1 rounded-mc border border-dashed border-mc-border px-2 py-0.5 text-[9px] text-mc-dim hover:border-mc-accent hover:text-mc-text"
                  >
                    <Plus size={12} />
                    添加自定义属性
                  </button>
                </div>
              )}
            </div>

            {/* 生成 JSON */}
            <div>
              <GroupTitle>方块 JSON（spec.blocks 实时值）</GroupTitle>
              <pre className="mc-card max-h-40 overflow-auto p-2 text-[10px] text-mc-text">
                {JSON.stringify(selected, null, 2)}
              </pre>
              <button
                className="mc-btn-ghost mt-1"
                onClick={() => {
                  navigator.clipboard?.writeText(JSON.stringify(selected, null, 2));
                }}
              >
                <Copy size={14} /> 复制
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
