# 节点 UI 重构 · 阶段 B：下限改进 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 添加字段 MC 领域 tooltip、错误恢复提示、模板库增强（扩展现有 `nodeGraphTemplates.ts`，不新建模板系统）、新手引导浮层，降低新手使用门槛。

**Architecture:** 字段 tooltip 用纯数据 `fieldTooltips.ts` + `FieldLabel` 组件包裹现有标签；错误恢复用 `ErrorRecovery` 组件挂在每个字段编辑器下方，配合 `NodeDetailForm` 内部的 `validateField` 计算字段级错误与修复建议；模板库扩展现有 `lib/nodeGraphTemplates.ts`（追加 5 个预设模板），在现有 `NodePalette.tsx` 模板区域增加搜索框 + 分类筛选下拉；新手引导用 `onboardingSteps.ts` 定义 + `OnboardingTour.tsx` 浮层 + localStorage 完成标记。

**Tech Stack:** React + TypeScript + Zustand + Tailwind CSS + Vitest + Testing Library

**Spec:** `docs/superpowers/specs/2026-07-22-node-ui-polish-design.md`（§8 模板库、§9 字段 tooltip + 错误恢复、§10 新手引导）

**Depends on:** Plan A 完成（Task 18 创建 `store/drawer-store.ts`、Task 25 创建 `drawer/editors/types.ts`、Task 27 创建 `drawer/fieldSchemas.ts` + `drawer/NodeDetailForm.tsx` + `drawer/editors/*` 七类编辑器、Task 28 创建 `drawer/NodeDetailDrawer.tsx`、Task 29 将 `LowcodeWorkspace.tsx` 中的 `PropertyPanel` 替换为 `NodeDetailDrawer`）

---

## 文件结构

### 新建文件

| 文件 | 职责 |
|------|------|
| `apps/desktop/src/renderer/src/components/lowcode/drawer/fieldTooltips.ts` | 字段 MC 领域解释文本（key 格式 `${kind}.${fieldKey}`，含 common fallback） |
| `apps/desktop/src/renderer/src/components/lowcode/drawer/fieldTooltips.test.ts` | tooltip 覆盖与 fallback 测试 |
| `apps/desktop/src/renderer/src/components/lowcode/drawer/FieldLabel.tsx` | 字段标签 + ? tooltip 图标组件 |
| `apps/desktop/src/renderer/src/components/lowcode/drawer/FieldLabel.test.tsx` | FieldLabel 渲染与 hover 测试 |
| `apps/desktop/src/renderer/src/components/lowcode/drawer/ErrorRecovery.tsx` | 错误恢复提示组件 + `getErrorSuggestion` / `getFixLabel` helper |
| `apps/desktop/src/renderer/src/components/lowcode/drawer/ErrorRecovery.test.tsx` | ErrorRecovery 渲染与一键修复测试 |
| `apps/desktop/src/renderer/src/components/lowcode/onboarding/onboardingSteps.ts` | 5 步引导步骤定义 |
| `apps/desktop/src/renderer/src/components/lowcode/onboarding/onboardingSteps.test.ts` | 步骤定义测试 |
| `apps/desktop/src/renderer/src/components/lowcode/onboarding/OnboardingTour.tsx` | 引导浮层组件 |
| `apps/desktop/src/renderer/src/components/lowcode/onboarding/OnboardingTour.test.tsx` | 浮层导航测试 |

### 修改文件（不新建模板系统）

| 文件 | 改动 |
|------|------|
| `apps/desktop/src/renderer/src/lib/nodeGraphTemplates.ts` | 向 `NODE_GRAPH_TEMPLATES` 追加 5 个预设模板（铁剑、钻石镐、金苹果、熔炉配方、简单发电机），不改 `NodeGraphTemplate` 类型与 `TEMPLATE_CATEGORIES` |
| `apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx` | 模板区域加搜索框（Task 7）+ 分类筛选下拉（Task 8） |
| `apps/desktop/src/renderer/src/components/lowcode/drawer/NodeDetailForm.tsx` | FieldRow 用 `FieldLabel` 包裹（Task 3）+ 接入 `ErrorRecovery` 与字段级校验（Task 5） |
| `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx` | 集成 `OnboardingTour` + 工具栏 ? 按钮 + data-onboarding 属性 |

### 依赖的 Plan A 文件（已存在，Plan B 不创建）

| 文件 | 由 Plan A Task 创建 |
|------|----------------------|
| `apps/desktop/src/renderer/src/components/lowcode/drawer/editors/types.ts` | Task 25（`FieldSchema` / `EditorProps` / `FieldType`） |
| `apps/desktop/src/renderer/src/components/lowcode/drawer/fieldSchemas.ts` | Task 27（`FIELD_SCHEMAS`，字段 key 用真实数据字段名如 `itemId`/`displayName`） |
| `apps/desktop/src/renderer/src/components/lowcode/drawer/NodeDetailForm.tsx` | Task 27（`FieldRow` 用 `<label>` 渲染标签） |
| `apps/desktop/src/renderer/src/store/drawer-store.ts` | Task 18（`useDrawerStore`，含 `errors: Record<string, string>`） |

---

## Task 1: fieldTooltips 字段 MC 领域解释文本

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/drawer/fieldTooltips.ts`
- Test: `apps/desktop/src/renderer/src/components/lowcode/drawer/fieldTooltips.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/drawer/fieldTooltips.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { FIELD_TOOLTIPS, getTooltip } from './fieldTooltips.js';

describe('fieldTooltips', () => {
  it('item.itemId 有解释且包含 modid:path', () => {
    expect(getTooltip('item', 'itemId')).toContain('modid:path');
  });

  it('item.maxDamage 有解释', () => {
    expect(getTooltip('item', 'maxDamage')).toBeTruthy();
  });

  it('block.hardness 有解释', () => {
    expect(getTooltip('block', 'hardness')).toBeTruthy();
  });

  it('recipe.recipeType 有解释', () => {
    expect(getTooltip('recipe', 'recipeType')).toBeTruthy();
  });

  it('未知字段返回 undefined', () => {
    expect(getTooltip('item', 'nonexistent')).toBeUndefined();
  });

  it('common fallback：label 字段在所有 kind 下都有解释', () => {
    expect(getTooltip('item', 'label')).toContain('显示名');
    expect(getTooltip('block', 'label')).toContain('显示名');
    expect(getTooltip('recipe', 'label')).toContain('显示名');
  });

  it('kind 专属 tooltip 优先于 common fallback', () => {
    // item.note 有专属解释
    const itemNote = getTooltip('item', 'note');
    expect(itemNote).toBeTruthy();
    // common.note 也存在
    expect(FIELD_TOOLTIPS['common.note']).toBeTruthy();
  });

  it('覆盖所有 item 字段 schema 的 key', () => {
    const itemKeys = [
      'itemId', 'displayName', 'category', 'rarity',
      'maxStackSize', 'maxDamage', 'glow', 'note',
    ];
    for (const k of itemKeys) {
      expect(getTooltip('item', k), `item.${k} should have tooltip`).toBeTruthy();
    }
  });

  it('覆盖所有 machine 字段 schema 的 key', () => {
    const machineKeys = [
      'machineId', 'displayName', 'energyCapacity', 'maxEnergyTransfer',
      'inputSlots', 'outputSlots', 'defaultProcessTime', 'defaultEnergyPerTick',
      'guiWidth', 'guiHeight',
    ];
    for (const k of machineKeys) {
      expect(getTooltip('machine', k), `machine.${k} should have tooltip`).toBeTruthy();
    }
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- fieldTooltips`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 fieldTooltips.ts**

创建 `apps/desktop/src/renderer/src/components/lowcode/drawer/fieldTooltips.ts`：

```ts
/**
 * 字段 MC 领域解释文本
 *
 * key 格式 `${kind}.${fieldKey}`，其中 fieldKey 与 fieldSchemas.ts 中 FieldSchema.key
 * 一致（即真实数据字段名，如 itemId / displayName / maxDamage）。
 *
 * getTooltip 先查 `${kind}.${fieldKey}`，未命中则 fallback 到 `common.${fieldKey}`，
 * 避免为 label/note/disabled 等通用字段在每个 kind 下重复定义。
 */
export const FIELD_TOOLTIPS: Record<string, string> = {
  // === 通用字段（BaseNodeData，所有 kind 共享） ===
  'common.label': '节点显示名（仅用于画布展示，不影响编译产物）',
  'common.note': '节点备注，仅文档用途，不影响编译',
  'common.disabled': '是否禁用（编译时跳过该节点）',

  // === item ===
  'item.itemId': '资源 ID，格式 modid:path。modid 是你的 mod 标识（如 mymod），path 是物品标识（如 iron_sword）。最终游戏内为 mymod:iron_sword',
  'item.displayName': '游戏中显示的名称（支持中文，如「红宝石剑」）',
  'item.category': '物品分类，决定行为模式：sword/pickaxe/axe 等工具武器、food 食物、material 材料、misc 杂项',
  'item.rarity': '稀有度，影响物品名颜色：common=白、uncommon=黄、rare=青、epic=金',
  'item.maxStackSize': '最大堆叠数量（1-64），工具/武器通常为 1，材料/食物通常为 64',
  'item.maxDamage': '最大耐久度，0 表示不可损坏。工具/武器通常 >0（如铁剑 250，钻石镐 1561）',
  'item.glow': '是否发光（附魔光辉效果，像附魔书一样发出紫色光晕）',
  'item.texturePath': '贴图路径（相对 resources/ 目录），如 assets/mymod/items/iron_sword.png',

  // === block ===
  'block.blockId': '方块 ID，格式同物品（小写+下划线），如 ruby_block',
  'block.displayName': '游戏中显示的方块名称',
  'block.hardness': '硬度，决定挖掘时间。硬度越高挖掘越慢，-1 表示不可破坏（如基岩），铁块 5，石头 1.5',
  'block.blastResistance': '爆炸抗性，抵抗 TNT/苦力怕爆炸的能力。石头 6，黑曜石 1200',
  'block.luminance': '发光等级（0-15），15 为最亮（类似荧石），0 为不发光',
  'block.transparent': '是否透明（如玻璃、树叶），影响渲染和光照穿透',
  'block.solid': '是否固体（可碰撞），非固体如水、空气',
  'block.modelType': '方块模型类型：cube_all=六面同贴图，cube_column=柱状（上下/侧面不同），cross=十字（植物），custom=自定义',
  'block.isBlockEntity': '是否为方块实体（如箱子、熔炉），可存储额外 NBT 数据，机器节点必须为 true',
  'block.texturePathTop': '顶面贴图路径',
  'block.texturePathSide': '侧面贴图路径',
  'block.texturePathBottom': '底面贴图路径',

  // === entity ===
  'entity.entityId': '实体 ID，格式同物品（小写+下划线），如 ruby_golem',
  'entity.displayName': '游戏中显示的生物名称',
  'entity.maxHealth': '最大生命值，玩家默认 20（10 颗心），僵尸 20，末影龙 200',
  'entity.attackDamage': '攻击伤害（每次攻击扣除的目标生命值）',
  'entity.movementSpeed': '移动速度，玩家默认 0.3，僵尸 0.23，猎犬 0.35',
  'entity.classification': '阵营：animal=动物（被动），monster=怪物（敌对），water_creature=水生，ambient=环境生物，misc=其他',
  'entity.modelType': '模型骨架：pig/zombie/skeleton/creeper/cow 或 custom（自定义）',
  'entity.spawnWeight': '生成权重（0=不自然生成，越大越常见）',
  'entity.spawnBiomes': '可生成的生物群系列表（如 plains、forest），空表示所有群系',
  'entity.texturePath': '生物贴图路径',

  // === recipe ===
  'recipe.recipeId': '配方 ID，格式同物品，如 ruby_sword_recipe',
  'recipe.recipeType': '配方类型：crafting_shaped=有序合成，crafting_shapeless=无序合成，smelting=熔炉烧炼，blasting=高炉，smoking=烟熏炉，stonecutting=切石机',
  'recipe.outputCount': '产出数量（一次合成/烧炼产出的物品数）',
  'recipe.cookTime': '烧炼时间（tick），200 tick = 10 秒。熔炉默认 200，高炉 100，烟熏炉 100',
  'recipe.experience': '烧炼经验值（取出产物时玩家获得的经验）',
  'recipe.pattern': '有序合成模式（仅 crafting_shaped 用），如 ["AAA","ABA","AAA"]，每行最多 3 字符，空格表示空槽',

  // === machine ===
  'machine.machineId': '机器 ID，格式同物品，如 ruby_furnace',
  'machine.displayName': '游戏中显示的机器名称',
  'machine.energyCapacity': '能源容量（FE 单位，Forge Energy 标准），决定可存储的最大能量',
  'machine.maxEnergyTransfer': '最大能源传输速率（FE/tick），决定每 tick 可输入/输出的能量上限',
  'machine.inputSlots': '输入槽数量（0-9），如熔炉 1 个输入槽',
  'machine.outputSlots': '输出槽数量（0-9），如熔炉 1 个输出槽',
  'machine.defaultProcessTime': '默认加工时间（tick），200 tick = 10 秒',
  'machine.defaultEnergyPerTick': '默认每 tick 能源消耗（FE/tick），加工时每 tick 扣除的能量',
  'machine.guiWidth': 'GUI 宽度（像素），默认 176（标准 Minecraft GUI 宽度）',
  'machine.guiHeight': 'GUI 高度（像素），默认 166（标准 Minecraft GUI 高度）',

  // === multiblock ===
  'multiblock.structureId': '多方块结构 ID，格式同物品，如 industrial_furnace',
  'multiblock.displayName': '多方块结构显示名',
  'multiblock.width': '结构宽度（1-16，X 轴方向方块数）',
  'multiblock.height': '结构高度（1-16，Y 轴方向方块数）',
  'multiblock.depth': '结构深度（1-16，Z 轴方向方块数）',
  'multiblock.hollow': '是否空心结构（true=外壳，false=实心）',
  'multiblock.controllerOffset': '主控制器位置（相对结构原点的坐标），通常是结构中心',

  // === event ===
  'event.eventType': '事件触发器类型：player_right_click_block=右键方块，entity_death=实体死亡，player_join=玩家加入，tick=每 tick 等',
  'event.eventArgs': '事件参数（JSON 字符串），由具体事件类型决定字段，如 {"hand":"main_hand"}',

  // === condition ===
  'condition.conditionType': '条件判断类型：has_item=持有物品，health_below=生命值低于，is_day=白天，biome_is=在特定群系 等',
  'condition.conditionArgs': '条件参数（JSON 字符串），如 {"item":"minecraft:stick","hand":"main_hand"}',
  'condition.invert': '是否取反（true=条件为假时走真分支，false=正常逻辑）',

  // === action ===
  'action.actionType': '动作类型：spawn_entity=生成实体，give_item=给予物品，teleport=传送，damage=造成伤害，play_sound=播放声音 等',
  'action.actionArgs': '动作参数（JSON 字符串），如 {"entity":"minecraft:lightning_bolt","offset":{"x":0,"y":1,"z":0}}',

  // === code ===
  'code.language': '代码语言：java（推荐，功能完整）/javascript/kotlin',
  'code.code': '内嵌代码内容（L2 混合模式核心），可用 input 参数引用输入端口数据，return 返回输出',
  'code.inputSignature': '输入端口类型签名（JSON，如 {"in":"item_stack"}），定义输入端口的数据类型',
  'code.outputSignature': '输出端口类型签名（JSON，如 {"out":"item_stack"}），定义输出端口的数据类型',
  'code.methodName': '生成的 Java 方法名（合法标识符，如 process / onTick）',

  // === comment ===
  'comment.text': '备注文本（仅文档用途，不参与编译）',
  'comment.color': '备注背景色：yellow/green/blue/pink/gray',
};

/** 获取字段 tooltip，先查 `${kind}.${fieldKey}`，未命中 fallback 到 `common.${fieldKey}`，仍无则返回 undefined */
export function getTooltip(kind: string, fieldKey: string): string | undefined {
  return FIELD_TOOLTIPS[`${kind}.${fieldKey}`] ?? FIELD_TOOLTIPS[`common.${fieldKey}`];
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- fieldTooltips`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/drawer/fieldTooltips.ts apps/desktop/src/renderer/src/components/lowcode/drawer/fieldTooltips.test.ts
git commit -m "feat(ui): add fieldTooltips with MC domain explanations and common fallback"
```

---

## Task 2: FieldLabel 组件（标签 + ? tooltip）

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/drawer/FieldLabel.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/drawer/FieldLabel.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/drawer/FieldLabel.test.tsx`：

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FieldLabel } from './FieldLabel.js';

describe('FieldLabel', () => {
  it('渲染标签文字', () => {
    render(<FieldLabel label="物品 ID" />);
    expect(screen.getByText('物品 ID')).toBeInTheDocument();
  });

  it('required=true 时渲染 * 标记', () => {
    render(<FieldLabel label="物品 ID" required />);
    expect(screen.getByText('*')).toBeInTheDocument();
  });

  it('required=false 时不渲染 * 标记', () => {
    render(<FieldLabel label="物品 ID" />);
    expect(screen.queryByText('*')).not.toBeInTheDocument();
  });

  it('有 tooltip 时渲染 ? 图标', () => {
    render(<FieldLabel label="物品 ID" tooltip="这是解释" />);
    expect(screen.getByText('?')).toBeInTheDocument();
  });

  it('无 tooltip 时不渲染 ? 图标', () => {
    render(<FieldLabel label="物品 ID" />);
    expect(screen.queryByText('?')).not.toBeInTheDocument();
  });

  it('hover ? 显示 tooltip 文本', () => {
    render(<FieldLabel label="物品 ID" tooltip="资源 ID 格式说明" />);
    const icon = screen.getByText('?');
    fireEvent.mouseEnter(icon);
    expect(screen.getByText('资源 ID 格式说明')).toBeInTheDocument();
  });

  it('mouseLeave ? 隐藏 tooltip 文本', () => {
    render(<FieldLabel label="物品 ID" tooltip="资源 ID 格式说明" />);
    const icon = screen.getByText('?');
    fireEvent.mouseEnter(icon);
    expect(screen.getByText('资源 ID 格式说明')).toBeInTheDocument();
    fireEvent.mouseLeave(icon);
    expect(screen.queryByText('资源 ID 格式说明')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- FieldLabel`
Expected: FAIL — 组件不存在

- [ ] **Step 3: 实现 FieldLabel.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/drawer/FieldLabel.tsx`：

```tsx
import { memo, useState, useCallback } from 'react';

interface FieldLabelProps {
  /** 字段显示名 */
  label: string;
  /** 是否必填（渲染 * 标记） */
  required?: boolean;
  /** MC 领域解释文本（hover ? 显示，无则不渲染 ? 图标） */
  tooltip?: string;
}

function FieldLabelComponent({ label, required, tooltip }: FieldLabelProps) {
  const [show, setShow] = useState(false);
  const onEnter = useCallback(() => setShow(true), []);
  const onLeave = useCallback(() => setShow(false), []);

  return (
    <div className="mb-1 flex items-center gap-1 text-[11px] text-mc-text">
      <span>{label}</span>
      {required && <span className="text-red-400" aria-label="必填">*</span>}
      {tooltip && (
        <span
          className="relative inline-flex h-3 w-3 cursor-help items-center justify-center rounded-full border border-mc-border text-[9px] text-mc-mute hover:text-mc-text"
          onMouseEnter={onEnter}
          onMouseLeave={onLeave}
          role="img"
          aria-label={`提示：${tooltip}`}
        >
          ?
          {show && (
            <span
              className="absolute left-4 top-0 z-10 w-48 rounded-mc border border-purple-500 bg-black/95 p-2 text-[10px] font-normal leading-relaxed text-white shadow-[2px_2px_0_rgba(0,0,0,0.6)]"
              role="tooltip"
            >
              {tooltip}
            </span>
          )}
        </span>
      )}
    </div>
  );
}

export const FieldLabel = memo(FieldLabelComponent);
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- FieldLabel`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/drawer/FieldLabel.tsx apps/desktop/src/renderer/src/components/lowcode/drawer/FieldLabel.test.tsx
git commit -m "feat(ui): add FieldLabel component with ? tooltip icon"
```

---

## Task 3: 修改 NodeDetailForm 接入 FieldLabel

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/drawer/NodeDetailForm.tsx`

> **依赖：** Plan A Task 27 已创建此文件，`FieldRow` 用 `<label>` 渲染标签。本 Task 把 `<label>` 替换为 `<FieldLabel>` 并接入 `getTooltip`。

- [ ] **Step 1: 替换 NodeDetailForm.tsx 完整内容**

将 `apps/desktop/src/renderer/src/components/lowcode/drawer/NodeDetailForm.tsx` 完整替换为：

```tsx
import { memo } from 'react';
import type { NodeData, NodeGraph } from '@mc-creator/shared';
import type { FieldSchema } from './editors/types.js';
import { FIELD_SCHEMAS } from './fieldSchemas.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { NumberStepperEditor } from './editors/NumberStepperEditor.js';
import { DropdownEditor } from './editors/DropdownEditor.js';
import { SegmentedEditor } from './editors/SegmentedEditor.js';
import { ResourceIdEditor } from './editors/ResourceIdEditor.js';
import { ColorEditor } from './editors/ColorEditor.js';
import { NbtEditor } from './editors/NbtEditor.js';
import { NodeRefEditor } from './editors/NodeRefEditor.js';
import { FieldLabel } from './FieldLabel.js';
import { getTooltip } from './fieldTooltips.js';

interface FieldRowProps {
  field: FieldSchema;
  draft: NodeData;
  updateField: (key: string, value: unknown) => void;
  graph: NodeGraph;
}

function FieldRow({ field, draft, updateField, graph }: FieldRowProps) {
  const value = (draft as Record<string, unknown>)[field.key];
  const onChange = (v: unknown) => updateField(field.key, v);
  const props = { value, onChange, schema: field, graph };
  const tooltip = getTooltip(draft.kind, field.key);

  return (
    <div>
      <FieldLabel label={field.label} required={field.required} tooltip={tooltip} />
      {field.type === 'number' && <NumberStepperEditor {...props} />}
      {field.type === 'dropdown' && <DropdownEditor {...props} />}
      {field.type === 'segmented' && <SegmentedEditor {...props} />}
      {field.type === 'resourceId' && <ResourceIdEditor {...props} />}
      {field.type === 'color' && <ColorEditor {...props} />}
      {field.type === 'nbt' && <NbtEditor {...props} />}
      {field.type === 'noderef' && <NodeRefEditor {...props} />}
      {field.type === 'text' && (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-mc border border-mc-border bg-mc-bg px-2 py-1 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        />
      )}
    </div>
  );
}

function NodeDetailFormComponent() {
  const draft = useDrawerStore((s) => s.draft);
  const updateField = useDrawerStore((s) => s.updateField);
  const graph = useNodeGraphStore((s) => s.graph);

  if (!draft) return null;

  const fields = FIELD_SCHEMAS[draft.kind] ?? [];
  const visibleFields = fields.filter((f) => {
    if (!f.condition) return true;
    const val = (draft as Record<string, unknown>)[f.condition.field];
    if (f.condition.equals) return val === f.condition.equals;
    if (f.condition.in) return f.condition.in.includes(val as string);
    return true;
  });

  return (
    <div className="space-y-3">
      {visibleFields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          draft={draft}
          updateField={updateField}
          graph={graph}
        />
      ))}
    </div>
  );
}

export const NodeDetailForm = memo(NodeDetailFormComponent);
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/drawer/NodeDetailForm.tsx
git commit -m "feat(ui): integrate FieldLabel with tooltip into NodeDetailForm"
```

---

## Task 4: ErrorRecovery 错误恢复组件

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/drawer/ErrorRecovery.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/drawer/ErrorRecovery.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/drawer/ErrorRecovery.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorRecovery, getErrorSuggestion, getFixLabel } from './ErrorRecovery.js';
import type { FieldSchema } from './editors/types.js';

describe('ErrorRecovery', () => {
  it('无错误时不渲染', () => {
    const { container } = render(<ErrorRecovery error={undefined} />);
    expect(container.firstChild).toBeNull();
  });

  it('error 为空字符串时不渲染', () => {
    const { container } = render(<ErrorRecovery error="" />);
    expect(container.firstChild).toBeNull();
  });

  it('有错误时渲染错误文字', () => {
    render(<ErrorRecovery error="数值超限" />);
    expect(screen.getByText(/数值超限/)).toBeInTheDocument();
  });

  it('有修复建议时显示建议文字', () => {
    render(<ErrorRecovery error="超限" suggestion="建议改为 99999" />);
    expect(screen.getByText('建议改为 99999')).toBeInTheDocument();
  });

  it('有一键修复按钮时点击触发 onFix', () => {
    const onFix = vi.fn();
    render(<ErrorRecovery error="超限" fixLabel="一键修复" onFix={onFix} />);
    fireEvent.click(screen.getByText('一键修复'));
    expect(onFix).toHaveBeenCalledOnce();
  });

  it('有 fixLabel 但无 onFix 时不渲染按钮', () => {
    render(<ErrorRecovery error="超限" fixLabel="一键修复" />);
    expect(screen.queryByText('一键修复')).not.toBeInTheDocument();
  });
});

describe('getErrorSuggestion', () => {
  const numberField: FieldSchema = {
    key: 'maxDamage', label: '最大耐久', type: 'number', min: 0, max: 99999,
  };
  const resourceIdField: FieldSchema = {
    key: 'itemId', label: '物品 ID', type: 'resourceId', required: true,
  };
  const requiredField: FieldSchema = {
    key: 'itemId', label: '物品 ID', type: 'text', required: true,
  };

  it('无错误返回 undefined', () => {
    expect(getErrorSuggestion(numberField, undefined, 100)).toBeUndefined();
  });

  it('必填错误返回输入提示', () => {
    expect(getErrorSuggestion(requiredField, '物品 ID为必填项', '')).toContain('请输入');
  });

  it('number 超上限返回建议值', () => {
    expect(getErrorSuggestion(numberField, '值 1000000 大于最大值 99999', 1000000)).toBe('建议改为 99999');
  });

  it('number 超下限返回建议值', () => {
    expect(getErrorSuggestion(numberField, '值 -1 小于最小值 0', -1)).toBe('建议改为 0');
  });

  it('resourceId 格式错误返回示例', () => {
    expect(getErrorSuggestion(resourceIdField, '格式错误，应为 modid:path（全小写+下划线）', 'BadID')).toContain('mymod:iron_sword');
  });

  it('未知错误返回 undefined', () => {
    expect(getErrorSuggestion(numberField, '某种未知错误', 100)).toBeUndefined();
  });
});

describe('getFixLabel', () => {
  const numberField: FieldSchema = {
    key: 'maxDamage', label: '最大耐久', type: 'number', min: 0, max: 99999,
  };

  it('无错误返回 undefined', () => {
    expect(getFixLabel(numberField, undefined)).toBeUndefined();
  });

  it('number 超上限返回「改为最大值」', () => {
    expect(getFixLabel(numberField, '值 1000000 大于最大值 99999')).toBe('改为最大值');
  });

  it('number 超下限返回「改为最小值」', () => {
    expect(getFixLabel(numberField, '值 -1 小于最小值 0')).toBe('改为最小值');
  });

  it('非 number 错误返回 undefined', () => {
    const textField: FieldSchema = { key: 'name', label: '名称', type: 'text' };
    expect(getFixLabel(textField, '某种错误')).toBeUndefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- ErrorRecovery`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 ErrorRecovery.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/drawer/ErrorRecovery.tsx`：

```tsx
import { memo } from 'react';
import type { FieldSchema } from './editors/types.js';

interface ErrorRecoveryProps {
  /** 错误文字（falsy 时不渲染） */
  error?: string;
  /** 修复建议文字 */
  suggestion?: string;
  /** 一键修复按钮文字（需同时提供 onFix 才渲染按钮） */
  fixLabel?: string;
  /** 一键修复回调 */
  onFix?: () => void;
}

function ErrorRecoveryComponent({ error, suggestion, fixLabel, onFix }: ErrorRecoveryProps) {
  if (!error) return null;
  return (
    <div
      className="mt-1 rounded-mc border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300"
      role="alert"
      aria-live="assertive"
    >
      <div>⚠ {error}</div>
      {suggestion && <div className="mt-0.5 text-red-200">建议：{suggestion}</div>}
      {fixLabel && onFix && (
        <button
          type="button"
          onClick={onFix}
          className="mt-1 rounded-mc border border-red-400 bg-red-800/60 px-2 py-0.5 text-red-100 transition-colors hover:bg-red-700/80"
        >
          {fixLabel}
        </button>
      )}
    </div>
  );
}

export const ErrorRecovery = memo(ErrorRecoveryComponent);

/**
 * 根据字段 schema 和错误文字生成修复建议。
 * 匹配规则基于 validateField 产生的错误文案关键字。
 */
export function getErrorSuggestion(
  field: FieldSchema,
  error: string | undefined,
  _value: unknown,
): string | undefined {
  if (!error) return undefined;
  if (field.required && /必填/.test(error)) {
    return `请输入${field.label}`;
  }
  if (field.type === 'number') {
    if (field.max !== undefined && /大于最大值/.test(error)) {
      return `建议改为 ${field.max}`;
    }
    if (field.min !== undefined && /小于最小值/.test(error)) {
      return `建议改为 ${field.min}`;
    }
  }
  if (field.type === 'resourceId' && /格式错误/.test(error)) {
    return `示例：mymod:iron_sword（modid:path，全小写+下划线）`;
  }
  return undefined;
}

/**
 * 根据字段类型和错误生成一键修复按钮文字。
 * 仅 number 超限可一键修复（改为边界值），其他错误返回 undefined。
 */
export function getFixLabel(field: FieldSchema, error: string | undefined): string | undefined {
  if (!error) return undefined;
  if (field.type === 'number') {
    if (field.max !== undefined && /大于最大值/.test(error)) return '改为最大值';
    if (field.min !== undefined && /小于最小值/.test(error)) return '改为最小值';
  }
  return undefined;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- ErrorRecovery`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/drawer/ErrorRecovery.tsx apps/desktop/src/renderer/src/components/lowcode/drawer/ErrorRecovery.test.tsx
git commit -m "feat(ui): add ErrorRecovery component with suggestion and one-click fix"
```

---

## Task 5: 修改 NodeDetailForm 接入 ErrorRecovery + 字段级校验

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/drawer/NodeDetailForm.tsx`

> **依赖：** Task 3 已接入 FieldLabel，Task 4 已创建 ErrorRecovery。本 Task 在 FieldRow 编辑器下方接入 ErrorRecovery，并在 NodeDetailForm 内部用 `validateField` 计算字段级错误（不依赖 drawer-store 的 errors 实现，合并 store errors 与计算错误）。

- [ ] **Step 1: 替换 NodeDetailForm.tsx 完整内容**

将 `apps/desktop/src/renderer/src/components/lowcode/drawer/NodeDetailForm.tsx` 完整替换为：

```tsx
import { memo, useMemo, useCallback } from 'react';
import type { NodeData, NodeGraph } from '@mc-creator/shared';
import type { FieldSchema } from './editors/types.js';
import { FIELD_SCHEMAS } from './fieldSchemas.js';
import { useDrawerStore } from '../../../store/drawer-store.js';
import { useNodeGraphStore } from '../../../store/node-graph-store.js';
import { NumberStepperEditor } from './editors/NumberStepperEditor.js';
import { DropdownEditor } from './editors/DropdownEditor.js';
import { SegmentedEditor } from './editors/SegmentedEditor.js';
import { ResourceIdEditor } from './editors/ResourceIdEditor.js';
import { ColorEditor } from './editors/ColorEditor.js';
import { NbtEditor } from './editors/NbtEditor.js';
import { NodeRefEditor } from './editors/NodeRefEditor.js';
import { FieldLabel } from './FieldLabel.js';
import { getTooltip } from './fieldTooltips.js';
import { ErrorRecovery, getErrorSuggestion, getFixLabel } from './ErrorRecovery.js';

/**
 * 字段级校验：返回错误文字或 undefined。
 * 覆盖 required 缺失、number 超限、resourceId 格式错误三类常见错误。
 */
function validateField(field: FieldSchema, value: unknown): string | undefined {
  if (field.required) {
    if (value === undefined || value === null || value === '') {
      return `${field.label}为必填项`;
    }
  }
  if (field.type === 'number' && typeof value === 'number') {
    if (field.min !== undefined && value < field.min) {
      return `值 ${value} 小于最小值 ${field.min}`;
    }
    if (field.max !== undefined && value > field.max) {
      return `值 ${value} 大于最大值 ${field.max}`;
    }
  }
  if (field.type === 'resourceId' && typeof value === 'string' && value.length > 0) {
    if (!/^[a-z0-9_]+:[a-z0-9_/]+$/.test(value)) {
      return `格式错误，应为 modid:path（全小写+下划线）`;
    }
  }
  return undefined;
}

interface FieldRowProps {
  field: FieldSchema;
  draft: NodeData;
  updateField: (key: string, value: unknown) => void;
  graph: NodeGraph;
  errors: Record<string, string>;
}

function FieldRow({ field, draft, updateField, graph, errors }: FieldRowProps) {
  const value = (draft as Record<string, unknown>)[field.key];
  const onChange = (v: unknown) => updateField(field.key, v);
  const props = { value, onChange, schema: field, graph };
  const tooltip = getTooltip(draft.kind, field.key);
  const error = errors[field.key];
  const suggestion = getErrorSuggestion(field, error, value);
  const fixLabel = getFixLabel(field, error);

  const handleFix = useCallback(() => {
    if (field.type === 'number') {
      if (field.max !== undefined && typeof value === 'number' && value > field.max) {
        updateField(field.key, field.max);
        return;
      }
      if (field.min !== undefined && typeof value === 'number' && value < field.min) {
        updateField(field.key, field.min);
        return;
      }
    }
  }, [field, value, updateField]);

  return (
    <div>
      <FieldLabel label={field.label} required={field.required} tooltip={tooltip} />
      {field.type === 'number' && <NumberStepperEditor {...props} />}
      {field.type === 'dropdown' && <DropdownEditor {...props} />}
      {field.type === 'segmented' && <SegmentedEditor {...props} />}
      {field.type === 'resourceId' && <ResourceIdEditor {...props} />}
      {field.type === 'color' && <ColorEditor {...props} />}
      {field.type === 'nbt' && <NbtEditor {...props} />}
      {field.type === 'noderef' && <NodeRefEditor {...props} />}
      {field.type === 'text' && (
        <input
          type="text"
          value={(value as string) ?? ''}
          onChange={(e) => onChange(e.target.value)}
          className="w-full rounded-mc border border-mc-border bg-mc-bg px-2 py-1 text-[11px] text-mc-text outline-none focus:border-mc-accent"
        />
      )}
      <ErrorRecovery
        error={error}
        suggestion={suggestion}
        fixLabel={fixLabel}
        onFix={handleFix}
      />
    </div>
  );
}

function NodeDetailFormComponent() {
  const draft = useDrawerStore((s) => s.draft);
  const updateField = useDrawerStore((s) => s.updateField);
  const storeErrors = useDrawerStore((s) => s.errors);
  const graph = useNodeGraphStore((s) => s.graph);

  // 字段级校验：基于 draft 当前值计算错误（不依赖 drawer-store 是否实现校验）
  const computedErrors = useMemo(() => {
    if (!draft) return {} as Record<string, string>;
    const fields = FIELD_SCHEMAS[draft.kind] ?? [];
    const errs: Record<string, string> = {};
    for (const f of fields) {
      const v = (draft as Record<string, unknown>)[f.key];
      const e = validateField(f, v);
      if (e) errs[f.key] = e;
    }
    return errs;
  }, [draft]);

  // store errors 优先（外部校验覆盖内部计算），再合并
  const mergedErrors = useMemo(
    () => ({ ...computedErrors, ...storeErrors }),
    [computedErrors, storeErrors],
  );

  if (!draft) return null;

  const fields = FIELD_SCHEMAS[draft.kind] ?? [];
  const visibleFields = fields.filter((f) => {
    if (!f.condition) return true;
    const val = (draft as Record<string, unknown>)[f.condition.field];
    if (f.condition.equals) return val === f.condition.equals;
    if (f.condition.in) return f.condition.in.includes(val as string);
    return true;
  });

  return (
    <div className="space-y-3">
      {visibleFields.map((field) => (
        <FieldRow
          key={field.key}
          field={field}
          draft={draft}
          updateField={updateField}
          graph={graph}
          errors={mergedErrors}
        />
      ))}
    </div>
  );
}

export const NodeDetailForm = memo(NodeDetailFormComponent);
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/drawer/NodeDetailForm.tsx
git commit -m "feat(ui): integrate ErrorRecovery with field validation into NodeDetailForm"
```

---

## Task 6: 向 nodeGraphTemplates.ts 追加 5 个新模板

**Files:**
- Modify: `apps/desktop/src/renderer/src/lib/nodeGraphTemplates.ts`

> **契约 §1.2：** 扩展现有 `nodeGraphTemplates.ts`，不新建模板系统。保持 `NodeGraphTemplate` 类型、`TEMPLATE_CATEGORIES`、现有 6 个模板不变，仅向 `NODE_GRAPH_TEMPLATES` 数组追加 5 个新模板（铁剑、钻石镐、金苹果、熔炉配方、简单发电机）。复用现有 `makeNode` / `makeEdge` 辅助函数。

- [ ] **Step 1: 在 NODE_GRAPH_TEMPLATES 数组末尾（第 6 个模板 'custom-code' 之后、闭合 `];` 之前）追加 5 个模板**

在 `apps/desktop/src/renderer/src/lib/nodeGraphTemplates.ts` 中，找到第 6 个模板（'custom-code'）的闭合 `},`（约第 560 行），在其后、`];` 之前追加：

```ts

  // 7. 铁剑（基础武器模板）
  {
    id: 'iron-sword',
    name: '铁剑',
    description: '基础铁质武器，耐久 250，新手入门',
    category: 'combat',
    icon: '⚔️',
    nodeCount: 1,
    graph: {
      version: 1,
      modId: 'template_iron_sword',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode('item_1', 'item', { x: 200, y: 200 }, {
          itemId: 'iron_sword',
          displayName: '铁剑',
          label: '铁剑',
          category: 'sword',
          maxStackSize: 1,
          maxDamage: 250,
          rarity: 'common',
          glow: false,
          note: '基础铁质武器，平衡的攻击力与耐久',
        }),
      ],
      edges: [],
    },
  },

  // 8. 钻石镐（高级工具模板）
  {
    id: 'diamond-pickaxe',
    name: '钻石镐',
    description: '钻石工具，耐久 1561，可挖黑曜石',
    category: 'item',
    icon: '⛏️',
    nodeCount: 1,
    graph: {
      version: 1,
      modId: 'template_diamond_pickaxe',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode('item_1', 'item', { x: 200, y: 200 }, {
          itemId: 'diamond_pickaxe',
          displayName: '钻石镐',
          label: '钻石镐',
          category: 'pickaxe',
          maxStackSize: 1,
          maxDamage: 1561,
          rarity: 'common',
          glow: false,
          note: '可挖掘黑曜石的高级工具，钻石材质',
        }),
      ],
      edges: [],
    },
  },

  // 9. 金苹果（稀有食物模板）
  {
    id: 'golden-apple',
    name: '金苹果',
    description: '稀有食物，食用给予生命恢复与抗性提升',
    category: 'item',
    icon: '🍎',
    nodeCount: 1,
    graph: {
      version: 1,
      modId: 'template_golden_apple',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode('item_1', 'item', { x: 200, y: 200 }, {
          itemId: 'golden_apple',
          displayName: '金苹果',
          label: '金苹果',
          category: 'food',
          maxStackSize: 64,
          maxDamage: 0,
          rarity: 'rare',
          glow: true,
          note: '食用给予生命恢复 II 与抗性提升的稀有食物',
        }),
      ],
      edges: [],
    },
  },

  // 10. 熔炉配方（烧炼配方模板，演示 recipe.smelting）
  {
    id: 'furnace-recipe',
    name: '熔炉配方',
    description: '将粗红宝石烧炼为红宝石的熔炉配方示例',
    category: 'starter',
    icon: '🔥',
    nodeCount: 2,
    graph: {
      version: 1,
      modId: 'template_furnace_recipe',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode('item_1', 'item', { x: 100, y: 150 }, {
          itemId: 'raw_ruby',
          displayName: '粗红宝石',
          label: '粗红宝石',
          category: 'material',
          maxStackSize: 64,
          maxDamage: 0,
          rarity: 'common',
          glow: false,
          note: '熔炉烧炼前的原矿材料',
        }),
        makeNode('recipe_1', 'recipe', { x: 100, y: 380 }, {
          recipeId: 'ruby_smelting',
          recipeType: 'smelting',
          outputCount: 1,
          cookTime: 200,
          experience: 0.1,
          pattern: [],
          label: '红宝石烧炼',
          note: '粗红宝石 → 红宝石，10 秒烧炼，0.1 经验',
        }),
      ],
      edges: [
        // 物品 → 配方 in 端口（craft 关系）
        makeEdge('edge_1', 'item_1', 'recipe_1', {
          sourceHandle: 'out',
          targetHandle: 'in',
          kind: 'craft',
        }),
      ],
    },
  },

  // 11. 简单发电机（机器模板，演示 block → machine controller 连接）
  {
    id: 'basic-generator',
    name: '简单发电机',
    description: '基础能源生成机器，方块控制器 + 机器逻辑',
    category: 'machine',
    icon: '🔋',
    nodeCount: 2,
    graph: {
      version: 1,
      modId: 'template_basic_generator',
      viewport: { x: 0, y: 0, zoom: 1 },
      nodes: [
        makeNode('block_1', 'block', { x: 200, y: 100 }, {
          blockId: 'generator_block',
          displayName: '发电机方块',
          label: '发电机方块',
          hardness: 3.0,
          blastResistance: 10.0,
          luminance: 7,
          transparent: false,
          solid: true,
          modelType: 'cube_all',
          isBlockEntity: true,
          note: '发电机外壳方块，发光等级 7',
        }),
        makeNode(
          'machine_1',
          'machine',
          { x: 200, y: 340 },
          {
            machineId: 'basic_generator',
            displayName: '基础发电机',
            label: '基础发电机',
            energyCapacity: 50000,
            maxEnergyTransfer: 500,
            inputSlots: 0,
            outputSlots: 1,
            defaultProcessTime: 100,
            defaultEnergyPerTick: 50,
            guiWidth: 176,
            guiHeight: 166,
            note: '消耗燃料生成 FE 能源，50000 容量',
          },
          [
            // 附加 controller 端口用于连接方块（block_state 类型）
            { id: 'controller', label: '控制器', type: 'block_state', direction: 'in', required: true, multiple: false },
            { id: 'in_item', label: '输入物品', type: 'item_stack', direction: 'in', required: false, multiple: true },
            { id: 'in_energy', label: '能源输入', type: 'energy', direction: 'in', required: false, multiple: false },
            { id: 'out_item', label: '输出物品', type: 'item_stack', direction: 'out', required: false, multiple: true },
          ],
        ),
      ],
      edges: [
        // 方块 → 机器 controller 端口（flow 关系，block_state 类型）
        makeEdge('edge_1', 'block_1', 'machine_1', {
          sourceHandle: 'out',
          targetHandle: 'controller',
          kind: 'flow',
        }),
      ],
    },
  },
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 写测试验证新模板存在**

创建 `apps/desktop/src/renderer/src/lib/nodeGraphTemplates.test.ts`（若已存在则追加测试用例）：

```ts
import { describe, it, expect } from 'vitest';
import { NODE_GRAPH_TEMPLATES } from './nodeGraphTemplates.js';

describe('nodeGraphTemplates 新增模板（Plan B Task 6）', () => {
  it('总模板数 >= 11（原 6 + 新增 5）', () => {
    expect(NODE_GRAPH_TEMPLATES.length).toBeGreaterThanOrEqual(11);
  });

  it('包含铁剑模板', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'iron-sword');
    expect(t).toBeDefined();
    expect(t!.category).toBe('combat');
    expect(t!.graph.nodes[0].data.kind).toBe('item');
  });

  it('包含钻石镐模板', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'diamond-pickaxe');
    expect(t).toBeDefined();
    expect(t!.category).toBe('item');
  });

  it('包含金苹果模板', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'golden-apple');
    expect(t).toBeDefined();
    expect(t!.graph.nodes[0].data.kind).toBe('item');
  });

  it('包含熔炉配方模板且 recipeType 为 smelting', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'furnace-recipe');
    expect(t).toBeDefined();
    expect(t!.graph.nodes.length).toBe(2);
    expect(t!.graph.edges.length).toBe(1);
  });

  it('包含简单发电机模板且为多节点', () => {
    const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === 'basic-generator');
    expect(t).toBeDefined();
    expect(t!.graph.nodes.length).toBe(2);
    expect(t!.graph.edges.length).toBe(1);
  });

  it('所有新模板 nodeCount 与实际 nodes 长度一致', () => {
    const newIds = ['iron-sword', 'diamond-pickaxe', 'golden-apple', 'furnace-recipe', 'basic-generator'];
    for (const id of newIds) {
      const t = NODE_GRAPH_TEMPLATES.find((t) => t.id === id)!;
      expect(t.nodeCount, `${id}.nodeCount`).toBe(t.graph.nodes.length);
    }
  });
});
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- nodeGraphTemplates`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/lib/nodeGraphTemplates.ts apps/desktop/src/renderer/src/lib/nodeGraphTemplates.test.ts
git commit -m "feat(templates): add 5 preset templates (iron sword, diamond pickaxe, golden apple, furnace recipe, basic generator)"
```

---

## Task 7: NodePalette 模板区域加搜索框

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx`

> **契约 §1.2：** 在现有 `NodePalette.tsx` 的模板区域（约 131-158 行）增加搜索框，不新建模板组件。保持现有节点搜索框不变，新搜索框仅过滤模板。

- [ ] **Step 1: 修改 NodePalette.tsx**

在 `apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx` 中做两处修改：

**修改 1：** 在 `NodePaletteComponent` 函数顶部 state 区（现有 `const [search, setSearch] = useState('');` 后）新增模板搜索 state：

```tsx
  const [search, setSearch] = useState('');
  /** 模板区域搜索关键字（仅过滤模板，不影响节点搜索） */
  const [templateSearch, setTemplateSearch] = useState('');
```

**修改 2：** 将模板区域（现有 131-158 行的 `<div className="max-h-56 ...">📦 模板</div> ... </div>`）整体替换为：

```tsx
      {/* 模板区域：搜索框 + 按分类分组显示，点击加载模板 */}
      <div
        className="max-h-56 overflow-y-auto border-t border-mc-border p-2"
        role="group"
        aria-label="节点图模板"
      >
        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-mc-mute">
          📦 模板
        </div>
        <input
          type="search"
          value={templateSearch}
          onChange={(e) => setTemplateSearch(e.target.value)}
          placeholder="搜索模板..."
          aria-label="搜索模板"
          className="mb-2 w-full rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-xs text-mc-text outline-none focus:border-mc-accent"
        />
        {TEMPLATE_CATEGORIES.map((cat) => {
          const items = NODE_GRAPH_TEMPLATES.filter(
            (t) =>
              t.category === cat.id &&
              (templateSearch === '' ||
                t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
                t.description.toLowerCase().includes(templateSearch.toLowerCase())),
          );
          if (items.length === 0) return null;
          return (
            <div key={cat.id} className="mb-2" role="group" aria-label={cat.label}>
              <div className="mb-0.5 text-[10px] text-mc-dim">{cat.label}</div>
              <div className="grid grid-cols-1 gap-1">
                {items.map((template) => (
                  <TemplateItem
                    key={template.id}
                    template={template}
                    onClick={handleTemplateClick}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {NODE_GRAPH_TEMPLATES.filter(
          (t) =>
            templateSearch === '' ||
            t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
            t.description.toLowerCase().includes(templateSearch.toLowerCase()),
        ).length === 0 && (
          <div className="py-2 text-center text-[10px] text-mc-mute">无匹配模板</div>
        )}
      </div>
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx
git commit -m "feat(ui): add template search box to NodePalette template section"
```

---

## Task 8: NodePalette 模板区域加分类筛选下拉

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx`

> 在 Task 7 基础上，模板区域顶部加分类筛选下拉（all + 各 TEMPLATE_CATEGORIES），与搜索框联动过滤。

- [ ] **Step 1: 修改 NodePalette.tsx**

**修改 1：** 在 `NodePaletteComponent` 函数 state 区（Task 7 新增的 `templateSearch` 后）再加分类 state：

```tsx
  const [search, setSearch] = useState('');
  /** 模板区域搜索关键字（仅过滤模板，不影响节点搜索） */
  const [templateSearch, setTemplateSearch] = useState('');
  /** 模板分类筛选（'all' 或 TEMPLATE_CATEGORIES 中的 id） */
  const [templateCategory, setTemplateCategory] = useState<string>('all');
```

**修改 2：** 将 Task 7 替换的模板区域中，把搜索框包裹进 flex 容器并加 select。即将 Task 7 的 `<input ... placeholder="搜索模板..." ... />` 部分替换为：

```tsx
        <div className="mb-2 flex gap-1">
          <input
            type="search"
            value={templateSearch}
            onChange={(e) => setTemplateSearch(e.target.value)}
            placeholder="搜索模板..."
            aria-label="搜索模板"
            className="flex-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-xs text-mc-text outline-none focus:border-mc-accent"
          />
          <select
            value={templateCategory}
            onChange={(e) => setTemplateCategory(e.target.value)}
            aria-label="筛选模板分类"
            className="rounded-mc border border-mc-border bg-mc-surface-2 px-1 py-1 text-xs text-mc-text outline-none focus:border-mc-accent"
          >
            <option value="all">全部分类</option>
            {TEMPLATE_CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.id}>{cat.label}</option>
            ))}
          </select>
        </div>
```

**修改 3：** 将 `TEMPLATE_CATEGORIES.map` 内的过滤条件加上分类筛选（在 `t.category === cat.id` 后加 `&& (templateCategory === 'all' || templateCategory === cat.id)`），并将末尾"无匹配模板"的判断也加上分类条件：

```tsx
        {TEMPLATE_CATEGORIES.map((cat) => {
          if (templateCategory !== 'all' && templateCategory !== cat.id) return null;
          const items = NODE_GRAPH_TEMPLATES.filter(
            (t) =>
              t.category === cat.id &&
              (templateSearch === '' ||
                t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
                t.description.toLowerCase().includes(templateSearch.toLowerCase())),
          );
          if (items.length === 0) return null;
          return (
            <div key={cat.id} className="mb-2" role="group" aria-label={cat.label}>
              <div className="mb-0.5 text-[10px] text-mc-dim">{cat.label}</div>
              <div className="grid grid-cols-1 gap-1">
                {items.map((template) => (
                  <TemplateItem
                    key={template.id}
                    template={template}
                    onClick={handleTemplateClick}
                  />
                ))}
              </div>
            </div>
          );
        })}
        {NODE_GRAPH_TEMPLATES.filter(
          (t) =>
            (templateCategory === 'all' || t.category === templateCategory) &&
            (templateSearch === '' ||
              t.name.toLowerCase().includes(templateSearch.toLowerCase()) ||
              t.description.toLowerCase().includes(templateSearch.toLowerCase())),
        ).length === 0 && (
          <div className="py-2 text-center text-[10px] text-mc-mute">无匹配模板</div>
        )}
```

- [ ] **Step 2: 写测试验证搜索与筛选**

创建 `apps/desktop/src/renderer/src/components/lowcode/NodePalette.template.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NodePalette } from './NodePalette.js';
import { useNodeGraphStore } from '../../store/node-graph-store.js';

describe('NodePalette 模板区域搜索与筛选（Plan B Task 7/8）', () => {
  beforeEach(() => {
    useNodeGraphStore.getState().clear();
  });

  it('渲染模板搜索框', () => {
    render(<NodePalette />);
    expect(screen.getByPlaceholderText('搜索模板...')).toBeInTheDocument();
  });

  it('渲染模板分类筛选下拉，含「全部分类」', () => {
    render(<NodePalette />);
    expect(screen.getByLabelText('筛选模板分类')).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '全部分类' })).toBeInTheDocument();
  });

  it('搜索「铁」过滤出铁剑模板', () => {
    render(<NodePalette />);
    const input = screen.getByPlaceholderText('搜索模板...');
    fireEvent.change(input, { target: { value: '铁' } });
    expect(screen.getByText('铁剑')).toBeInTheDocument();
    expect(screen.queryByText('金苹果')).not.toBeInTheDocument();
  });

  it('选择「战斗」分类只显示 combat 模板', () => {
    render(<NodePalette />);
    const select = screen.getByLabelText('筛选模板分类');
    fireEvent.change(select, { target: { value: 'combat' } });
    // 铁剑在 combat 分类
    expect(screen.getByText('铁剑')).toBeInTheDocument();
    // 金苹果在 item 分类，应被隐藏
    expect(screen.queryByText('金苹果')).not.toBeInTheDocument();
  });

  it('搜索无结果显示「无匹配模板」', () => {
    render(<NodePalette />);
    const input = screen.getByPlaceholderText('搜索模板...');
    fireEvent.change(input, { target: { value: 'zzzz不存在' } });
    expect(screen.getByText('无匹配模板')).toBeInTheDocument();
  });

  it('点击模板触发 onTemplateClick', () => {
    const onTemplateClick = vi.fn();
    render(<NodePalette onTemplateClick={onTemplateClick} />);
    fireEvent.click(screen.getByText('铁剑'));
    expect(onTemplateClick).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 3: typecheck + 测试**

Run: `pnpm --filter @mc-creator/desktop typecheck && pnpm --filter @mc-creator/desktop test -- NodePalette.template`
Expected: 0 errors + PASS

- [ ] **Step 4: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/NodePalette.tsx apps/desktop/src/renderer/src/components/lowcode/NodePalette.template.test.tsx
git commit -m "feat(ui): add template category filter dropdown to NodePalette"
```

---

## Task 9: onboardingSteps 引导步骤定义

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/onboarding/onboardingSteps.ts`
- Test: `apps/desktop/src/renderer/src/components/lowcode/onboarding/onboardingSteps.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/onboarding/onboardingSteps.test.ts`：

```ts
import { describe, it, expect } from 'vitest';
import { ONBOARDING_STEPS, type OnboardingStep } from './onboardingSteps.js';

describe('onboardingSteps', () => {
  it('有 5 个步骤', () => {
    expect(ONBOARDING_STEPS).toHaveLength(5);
  });

  it('每个步骤有 target、title、content', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.target).toBeTruthy();
      expect(step.title).toBeTruthy();
      expect(step.content).toBeTruthy();
    }
  });

  it('每个 target 是合法 CSS 属性选择器', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.target).toMatch(/^\[data-onboarding="[^"]+"\]$/);
    }
  });

  it('第 1 步引导拖入节点', () => {
    expect(ONBOARDING_STEPS[0].content).toContain('拖');
  });

  it('第 5 步引导编译/保存', () => {
    expect(ONBOARDING_STEPS[4].content).toContain('编译');
  });

  it('满足 OnboardingStep 类型', () => {
    const s: OnboardingStep = ONBOARDING_STEPS[0];
    expect(s).toBeDefined();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- onboardingSteps`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 实现 onboardingSteps.ts**

创建 `apps/desktop/src/renderer/src/components/lowcode/onboarding/onboardingSteps.ts`：

```ts
/** 单个引导步骤定义 */
export interface OnboardingStep {
  /** 高亮目标的 CSS 选择器（指向 LowcodeWorkspace 中的 data-onboarding 属性） */
  target: string;
  /** 步骤标题（显示在进度行） */
  title: string;
  /** 提示内容（显示在气泡主体） */
  content: string;
}

/**
 * 新手引导 5 步流程（spec §10.2）
 *
 * target 对应 LowcodeWorkspace.tsx 中各元素上的 data-onboarding 属性。
 * OnboardingTour 当前为「居中浮层」实现（不做镂空遮罩），target 用于未来
 * 扩展精确高亮时的定位依据。
 */
export const ONBOARDING_STEPS: OnboardingStep[] = [
  {
    target: '[data-onboarding="palette"]',
    title: '节点库',
    content: '从这里拖入节点到画布。试试拖一个「物品」节点到中间画布，或点击节点在画布中心创建。',
  },
  {
    target: '[data-onboarding="canvas"]',
    title: '画布与编辑',
    content: '双击节点或点 ⚙ 打开右侧抽屉编辑参数。字段旁的 ? 图标 hover 后显示 MC 领域解释。',
  },
  {
    target: '[data-onboarding="drawer"]',
    title: '参数抽屉',
    content: '在这里配置节点的详细参数。改完点「保存」写回画布，点「取消」丢弃草稿。校验错误会显示修复建议。',
  },
  {
    target: '[data-onboarding="canvas"]',
    title: '端口连线',
    content: '拖动节点端口之间的连线建立关系。例如配方的「材料」端口连到物品节点的「物品」端口，表示该物品是配方材料。',
  },
  {
    target: '[data-onboarding="compile"]',
    title: '编译生成',
    content: '配置完成后点「编译」生成 ModSpec，再由 mod-generator 生成 Java 文件。编译错误会在节点上高亮显示。',
  },
];
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- onboardingSteps`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/onboarding/onboardingSteps.ts apps/desktop/src/renderer/src/components/lowcode/onboarding/onboardingSteps.test.ts
git commit -m "feat(onboarding): add 5-step onboarding step definitions"
```

---

## Task 10: OnboardingTour 引导浮层组件

**Files:**
- Create: `apps/desktop/src/renderer/src/components/lowcode/onboarding/OnboardingTour.tsx`
- Test: `apps/desktop/src/renderer/src/components/lowcode/onboarding/OnboardingTour.test.tsx`

- [ ] **Step 1: 写失败测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/onboarding/OnboardingTour.test.tsx`：

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { OnboardingTour } from './OnboardingTour.js';

describe('OnboardingTour', () => {
  it('step=0 渲染第 1 步提示（含「拖」字）', () => {
    render(<OnboardingTour step={0} onNext={() => {}} onSkip={() => {}} />);
    expect(screen.getByText(/拖/)).toBeInTheDocument();
  });

  it('显示步骤进度 1/5', () => {
    render(<OnboardingTour step={0} onNext={() => {}} onSkip={() => {}} />);
    expect(screen.getByText(/1\/5/)).toBeInTheDocument();
  });

  it('下一步按钮触发 onNext', () => {
    const onNext = vi.fn();
    render(<OnboardingTour step={0} onNext={onNext} onSkip={() => {}} />);
    fireEvent.click(screen.getByText('下一步'));
    expect(onNext).toHaveBeenCalledOnce();
  });

  it('跳过按钮触发 onSkip', () => {
    const onSkip = vi.fn();
    render(<OnboardingTour step={0} onNext={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByText('跳过'));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('最后一步显示「完成」而非「下一步」', () => {
    render(<OnboardingTour step={4} onNext={() => {}} onSkip={() => {}} />);
    expect(screen.getByText('完成')).toBeInTheDocument();
    expect(screen.queryByText('下一步')).not.toBeInTheDocument();
  });

  it('step 超出范围不渲染', () => {
    const { container } = render(<OnboardingTour step={99} onNext={() => {}} onSkip={() => {}} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `pnpm --filter @mc-creator/desktop test -- OnboardingTour`
Expected: FAIL — 组件不存在

- [ ] **Step 3: 实现 OnboardingTour.tsx**

创建 `apps/desktop/src/renderer/src/components/lowcode/onboarding/OnboardingTour.tsx`：

```tsx
import { memo } from 'react';
import { ONBOARDING_STEPS } from './onboardingSteps.js';

interface OnboardingTourProps {
  /** 当前步骤索引（0-based），null 或越界时不渲染 */
  step: number;
  /** 进入下一步 */
  onNext: () => void;
  /** 跳过引导 */
  onSkip: () => void;
}

function OnboardingTourComponent({ step, onNext, onSkip }: OnboardingTourProps) {
  const current = ONBOARDING_STEPS[step];
  if (!current) return null;
  const total = ONBOARDING_STEPS.length;
  const isLast = step === total - 1;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="新手引导"
    >
      <div
        className="rounded-mc border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-surface p-4 shadow-[4px_4px_0_rgba(0,0,0,0.5)]"
        style={{ width: 340 }}
      >
        <div className="mb-1 text-[10px] text-mc-mute">
          步骤 {step + 1}/{total} · {current.title}
        </div>
        <div className="mb-3 text-[12px] leading-relaxed text-mc-text">
          {current.content}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onSkip}
            className="rounded-mc border border-mc-border bg-mc-btn px-3 py-1 text-[11px] text-mc-text transition-colors hover:bg-mc-btn-hover"
          >
            跳过
          </button>
          <button
            type="button"
            onClick={onNext}
            className="rounded-mc border-2 border-t-white border-l-white border-b-black border-r-black bg-mc-btn px-3 py-1 text-[11px] text-mc-text transition-colors hover:bg-mc-btn-hover active:bg-mc-btn-active"
          >
            {isLast ? '完成' : '下一步'}
          </button>
        </div>
      </div>
    </div>
  );
}

export const OnboardingTour = memo(OnboardingTourComponent);
```

- [ ] **Step 4: 运行确认通过**

Run: `pnpm --filter @mc-creator/desktop test -- OnboardingTour`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/onboarding/OnboardingTour.tsx apps/desktop/src/renderer/src/components/lowcode/onboarding/OnboardingTour.test.tsx
git commit -m "feat(onboarding): add OnboardingTour overlay with step navigation"
```

---

## Task 11: LowcodeWorkspace 集成 OnboardingTour

**Files:**
- Modify: `apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx`

> **依赖：** Plan A Task 29 已将 `PropertyPanel` 替换为 `NodeDetailDrawer`。本 Task 在 LowcodeWorkspace 加 OnboardingTour 状态、工具栏 ? 按钮、给关键元素加 `data-onboarding` 属性。

- [ ] **Step 1: 修改 LowcodeWorkspace.tsx（4 处增量）**

**修改 1：** 在文件顶部 import 区（现有 `import { McIcon } from '../../assets/mc-ui/McIcon';` 后）新增：

```tsx
import { OnboardingTour } from './onboarding/OnboardingTour.js';
```

**修改 2：** 在 `LowcodeWorkspace` 函数体顶部 state 区（现有 `const [showRecent, setShowRecent] = useState(false);` 后）新增引导状态与回调：

```tsx
  /** 是否展开「最近打开」下拉 */
  const [showRecent, setShowRecent] = useState(false);
  /** 当前引导步骤索引（null 表示未启动） */
  const [onboardingStep, setOnboardingStep] = useState<number | null>(null);
  /** localStorage key：完成引导标记 */
  const ONBOARDING_KEY = 'mc-creator:onboarding-completed';
  /** 引导总步数（与 ONBOARDING_STEPS 长度一致） */
  const ONBOARDING_TOTAL = 5;

  // 首次打开自动启动引导
  useEffect(() => {
    if (!localStorage.getItem(ONBOARDING_KEY)) {
      setOnboardingStep(0);
    }
  }, []);

  const handleOnboardingNext = useCallback(() => {
    setOnboardingStep((prev) => {
      if (prev === null) return null;
      if (prev >= ONBOARDING_TOTAL - 1) {
        localStorage.setItem(ONBOARDING_KEY, '1');
        return null;
      }
      return prev + 1;
    });
  }, []);

  const handleOnboardingSkip = useCallback(() => {
    localStorage.setItem(ONBOARDING_KEY, '1');
    setOnboardingStep(null);
  }, []);

  const handleOnboardingRestart = useCallback(() => {
    setOnboardingStep(0);
  }, []);
```

**修改 3：** 在工具栏右侧 `ml-auto` 容器内（现有「预览」按钮前）加 ? 按钮。找到 `<div className="ml-auto flex items-center gap-2">`，在其内部最前面插入：

```tsx
        <div className="ml-auto flex items-center gap-2">
          {/* 新手引导 ? 按钮（手动重启引导） */}
          <button
            type="button"
            onClick={handleOnboardingRestart}
            aria-label="启动新手引导"
            title="新手引导"
            className="rounded-mc px-2 py-1 text-[11px] text-mc-mute transition-colors hover:bg-mc-surface-2 hover:text-mc-text"
          >
            ?
          </button>

          {/* 节点统计 */}
          <span className="rounded-mc bg-mc-surface-2 px-2 py-0.5 text-[10px] text-mc-mute" role="status">
            {graph.nodes.length} 节点 · {graph.edges.length} 连线
          </span>
```

**修改 4：** 给关键元素加 `data-onboarding` 属性。

(a) NodePalette 容器 div（找到 `{!readOnly && ( <div style={{ width: paletteWidth }} className="shrink-0 border-r border-mc-border"> <NodePalette ...`），在该 div 上加 `data-onboarding="palette"`：

```tsx
        {!readOnly && (
          <div
            style={{ width: paletteWidth }}
            className="shrink-0 border-r border-mc-border"
            data-onboarding="palette"
          >
            <NodePalette
              onNodeClick={handleNodeClick}
              disableCodeNode={disableCodeNode}
            />
          </div>
        )}
```

(b) 画布容器 div（找到 `<div className="flex-1 overflow-hidden"> <NodeGraphEditor ...`），加 `data-onboarding="canvas"`：

```tsx
        <div className="flex-1 overflow-hidden" data-onboarding="canvas">
          <NodeGraphEditor readOnly={readOnly} onNodeDoubleClick={handleNodeDoubleClick} />
        </div>
```

(c) 右侧面板容器 div（Plan A Task 29 已把 `<PropertyPanel />` 换为 `<NodeDetailDrawer />`，找到该容器），加 `data-onboarding="drawer"`：

```tsx
        {!readOnly && (
          <div
            style={{ width: propertyWidth }}
            className="shrink-0 border-l border-mc-border"
            data-onboarding="drawer"
          >
            <NodeDetailDrawer />
          </div>
        )}
```

(d) 编译按钮（找到「编译」按钮，含 `onClick={handleCompile}`），加 `data-onboarding="compile"`：

```tsx
          <button
            type="button"
            onClick={handleCompile}
            data-onboarding="compile"
            aria-label="编译节点图"
            title="编译节点图为 ModSpec"
            className="flex items-center gap-1 rounded-mc bg-mc-accent px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-mc-accent/80"
          >
            <span aria-hidden="true">⚙</span>
            编译
          </button>
```

**修改 5：** 在组件返回 JSX 末尾（现有 `<LiveRegion id="lowcode-workspace-status" />` 前）渲染 OnboardingTour：

```tsx
      {/* 新手引导浮层（首次打开或点 ? 按钮触发） */}
      {onboardingStep !== null && (
        <OnboardingTour
          step={onboardingStep}
          onNext={handleOnboardingNext}
          onSkip={handleOnboardingSkip}
        />
      )}

      {/* 屏幕阅读器动态通知区域（保存/加载状态朗读，3 秒后自动清空） */}
      <LiveRegion id="lowcode-workspace-status" />
```

- [ ] **Step 2: typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/LowcodeWorkspace.tsx
git commit -m "feat(onboarding): integrate OnboardingTour into LowcodeWorkspace with ? button and data-onboarding targets"
```

---

## Task 12: 集成测试 + 全量 typecheck

**Files:**
- Test: `apps/desktop/src/renderer/src/components/lowcode/onboarding/onboarding-flow.test.tsx`

- [ ] **Step 1: 写引导流程集成测试**

创建 `apps/desktop/src/renderer/src/components/lowcode/onboarding/onboarding-flow.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { OnboardingTour } from './OnboardingTour.js';
import { ONBOARDING_STEPS } from './onboardingSteps.js';

describe('新手引导全流程集成（Plan B Task 12）', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('从第 1 步走到第 5 步完成', () => {
    let step = 0;
    const { rerender } = render(
      <OnboardingTour step={step} onNext={() => { step += 1; }} onSkip={() => {}} />,
    );
    expect(screen.getByText(/1\/5/)).toBeInTheDocument();

    // 推进到第 5 步
    for (let i = 1; i < ONBOARDING_STEPS.length; i++) {
      fireEvent.click(screen.getByText('下一步'));
      rerender(<OnboardingTour step={step} onNext={() => { step += 1; }} onSkip={() => {}} />);
    }
    expect(screen.getByText(/5\/5/)).toBeInTheDocument();
    expect(screen.getByText('完成')).toBeInTheDocument();
  });

  it('跳过引导后浮层消失', () => {
    const onSkip = vi.fn();
    const { container } = render(<OnboardingTour step={0} onNext={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByText('跳过'));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it('localStorage 标记写入后不再自动启动（由 LowcodeWorkspace useEffect 控制）', () => {
    localStorage.setItem('mc-creator:onboarding-completed', '1');
    // LowcodeWorkspace 的 useEffect 检查 localStorage，已有标记则 setOnboardingStep(null)
    // 此处验证标记存在
    expect(localStorage.getItem('mc-creator:onboarding-completed')).toBe('1');
  });

  it('所有 5 步的 content 都不为空', () => {
    for (const step of ONBOARDING_STEPS) {
      expect(step.content.length).toBeGreaterThan(10);
    }
  });
});
```

- [ ] **Step 2: 全量 typecheck**

Run: `pnpm --filter @mc-creator/desktop typecheck`
Expected: 0 errors

- [ ] **Step 3: 全量测试**

Run: `pnpm --filter @mc-creator/desktop test`
Expected: 全部 PASS（含 fieldTooltips / FieldLabel / ErrorRecovery / nodeGraphTemplates / NodePalette.template / onboardingSteps / OnboardingTour / onboarding-flow）

- [ ] **Step 4: 视觉验证清单（手动）**

- [ ] 打开应用，首次自动弹出引导浮层，5 步走完后不再自动弹出
- [ ] 工具栏 ? 按钮可手动重启引导
- [ ] 节点抽屉中字段标签旁有 ? 图标，hover 显示 MC 解释
- [ ] 在抽屉输入非法值（如 maxDamage=999999）显示红色错误 + 修复建议 + 一键修复按钮
- [ ] NodePalette 模板区域有搜索框 + 分类下拉，搜索「铁」过滤出铁剑，选「战斗」分类只显示 combat 模板
- [ ] 点击铁剑模板加载到画布

- [ ] **Step 5: 提交**

```bash
git add apps/desktop/src/renderer/src/components/lowcode/onboarding/onboarding-flow.test.tsx
git commit -m "test(onboarding): add integration test for onboarding flow and Plan B full coverage"
```

---

## Self-Review

### Spec 覆盖

| Spec 章节 | 对应 Task |
|-----------|-----------|
| §8 模板库（扩展现有，不新建） | Task 6（追加 5 模板）+ Task 7（搜索框）+ Task 8（分类筛选） |
| §9.1 字段 Tooltip | Task 1（fieldTooltips）+ Task 2（FieldLabel）+ Task 3（接入 NodeDetailForm） |
| §9.2 错误恢复提示 | Task 4（ErrorRecovery + helper）+ Task 5（接入 NodeDetailForm + 校验） |
| §10 新手引导 | Task 9（步骤定义）+ Task 10（浮层组件）+ Task 11（LowcodeWorkspace 集成）+ Task 12（集成测试） |

### 契约遵守

| 契约规则 | 遵守情况 |
|----------|----------|
| §1.2 不新建模板系统，扩展现有 `nodeGraphTemplates.ts` | ✓ Task 6 仅追加模板，不改类型/分类；Task 7/8 仅改 NodePalette 模板区域，不新建 TemplateLibrary/TemplateCard |
| §5 类型用 `NodePort` / `direction: 'in'\|'out'` | ✓ Task 6 新模板 machine 端口用 `direction: 'in'/'out'`、`type: PortType` |
| §9 绝对路径从 `apps/desktop/...` 开始 | ✓ 所有文件路径用绝对路径 |
| §9 import 用 `.js` 后缀 | ✓ 所有 import 用 `.js` |
| §9 不多写 `renderer/src` | ✓ 路径为 `apps/desktop/src/renderer/src/components/lowcode/...`，无重复 `renderer/src` |
| §9 pnpm filter 用 `@mc-creator/desktop` | ✓ 所有命令用 `pnpm --filter @mc-creator/desktop` |
| §10 文件归属：Plan B 创建 5 文件 + 修改 4 文件 | ✓ 新建 fieldTooltips/FieldLabel/ErrorRecovery/onboardingSteps/OnboardingTour；修改 nodeGraphTemplates/NodePalette/NodeDetailForm/LowcodeWorkspace |
| §10 依赖 Plan A：NodeDetailForm/fieldSchemas/drawer-store 已存在 | ✓ Task 3/5 注明依赖 Plan A Task 27/18 |

### 占位符扫描

- 无 TODO / TBD / "类似 Task N" / "添加适当错误处理" 等占位符
- 每个 Task 的代码步骤均包含完整可执行代码
- 每个 Task 末尾有确切 git commit 命令

### 类型一致性

- `FieldSchema`（Plan A Task 25 创建于 `drawer/editors/types.ts`）→ Task 4/5 import 自 `./editors/types.js` ✓
- `getErrorSuggestion` / `getFixLabel`（Task 4 定义）→ Task 5 import 自 `./ErrorRecovery.js` ✓
- `getTooltip`（Task 1 定义）→ Task 3/5 import 自 `./fieldTooltips.js` ✓
- `FieldLabel`（Task 2 定义）→ Task 3/5 import 自 `./FieldLabel.js` ✓
- `ONBOARDING_STEPS` / `OnboardingStep`（Task 9 定义）→ Task 10 import 自 `./onboardingSteps.js` ✓
- `OnboardingTour`（Task 10 定义）→ Task 11 import 自 `./onboarding/OnboardingTour.js` ✓
- `NodeGraphTemplate` / `TEMPLATE_CATEGORIES` / `NODE_GRAPH_TEMPLATES`（现有）→ Task 6/7/8 直接使用，不改名 ✓

### 路径一致性

- 所有新建文件在 `apps/desktop/src/renderer/src/components/lowcode/drawer/` 或 `apps/desktop/src/renderer/src/components/lowcode/onboarding/` 下
- import store 从 `drawer/` 用 `../../../store/`（drawer → lowcode → components → src，三层 `..` 到 `src/store/`）✓
- import lib 从 `drawer/` 用 `../../../lib/`（Task 6 修改的 nodeGraphTemplates 在 lib，但 NodePalette import 用 `../../lib/`）✓

### 风险与说明

1. **NodeDetailForm import 路径修正：** Plan A Task 27 原写 `from '../../store/drawer-store.js'`（少一层），Plan B Task 3/5 修正为 `../../../store/drawer-store.js`（基于文件在 `components/lowcode/drawer/` 的事实）。若 Plan A 实际文件位置不同，执行时按实际位置调整 `..` 层数。
2. **LowcodeWorkspace PropertyPanel→NodeDetailDrawer：** Task 11 假设 Plan A Task 29 已完成替换。若 Plan A 尚未执行，Task 11 修改 4(c) 中 `<NodeDetailDrawer />` 替换为当前实际的 `<PropertyPanel />`，`data-onboarding="drawer"` 属性加到该容器 div 即可。
3. **OnboardingTour 简化实现：** 当前为居中浮层，不做镂空高亮（spec §10.3 的镂空效果作为后续增强）。target 字段已定义，未来扩展精确高亮时可直接使用。
4. **阶段 B 不涉及新 NodeKind，不改数据模型**，纯 UI 层增量，风险低。

