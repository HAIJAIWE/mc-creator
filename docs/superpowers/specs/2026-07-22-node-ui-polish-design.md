# 节点 UI 打磨设计：扣子风格 + MC 视觉

**日期**：2026-07-22
**状态**：待实现
**范围**：`apps/desktop/src/renderer/src/components/lowcode/` 全部节点相关组件

---

## 1. 目标与背景

### 1.1 目标

将当前简化版节点 UI（单色边框 + 单 Handle）重构为**加强版扣子风格 + 纯 MC 视觉**的节点系统，涵盖：

**UI 重构（核心）**：
1. **节点外观**：3D 凸起灰色头部条 + 降饱和 MC 配色 + 像素字体 + 石质纹理 + 凹陷端口
2. **端口系统**：全标签端口（材料/产物/能量/触发/真/假...），数据驱动动态生成
3. **连线**：直角折线（电路图风，MC 工业感），按 edge kind 区分颜色
4. **参数编辑**：右侧抽屉详细编辑，节点本体只显示摘要
5. **折叠展开**：折叠后只留头部（上限最高），端口保留保证连线不断
6. **MC 感知编辑器**：7 类全做（下拉/节点引用/数字步进/资源 ID/颜色/NBT/分段）

**下限提升（新手友好）**：
7. **模板库**：预设物品/方块/配方/机器模板，点击即创建，新手不用从零配置
8. **字段 tooltip**：每个字段旁 ? 图标，hover 显示 MC 领域解释（NBT 是什么、资源 ID 格式等）
9. **错误恢复提示**：校验失败显示修复建议（超限建议值、格式错给示例、引用失效列可选节点）
10. **新手引导**：首次打开显示分步引导浮层（拖节点→编辑→连线→保存）

**上限提升（高手能力）**：
11. **变量节点（variable）**：定义全局变量/常量，可被其他节点引用
12. **子图/宏节点（subgraph）**：封装常用子图为可复用节点，支持嵌套
13. **循环节点（loop）**：for/forEach/while 批量逻辑，循环体是子图
14. **自定义节点类型（custom）**：JSON schema 定义端口和字段，可绑定 Java 代码模板
15. **外部 mod API 引用**：ResourceIdEditor 可选其他 mod 命名空间，代码节点可 import 其他 mod 类

### 1.2 背景

当前节点组件（`EventNode.tsx` 等 11 个）各自为政，视觉不统一，参数编辑依赖 `window.prompt`，端口只有单个 Handle 无法表达 MC 复杂数据流（配方多材料、机器多输入输出、条件真假分支）。用户确认采用扣子流程图风格（非 MCreator Blockly 拼图风格），并要求一次性全面重构。

### 1.3 非目标

- 不改 React Flow 核心版本
- 不改 `useNodeGraphStore` 的图数据结构（只增量加 `collapsed` 字段）
- 不做 i18n（项目面向中文用户）
- 不做节点拖拽手势重写（保留现有 dnd）

---

## 2. 架构与组件结构

### 2.1 目录结构

```
components/lowcode/
├── nodes/
│   ├── base/
│   │   ├── McNodeShell.tsx        # 共享外壳：头部条+主体+折叠按钮+端口
│   │   ├── McNodeHeader.tsx       # 彩色头部条（图标+标题+类型徽章+折叠/设置按钮）
│   │   ├── McNodePort.tsx         # 带标签的端口（左侧输入/右侧输出）
│   │   └── McNodeSummary.tsx      # 主体摘要（折叠时隐藏，展开时显示关键字段摘要）
│   ├── ItemNode.tsx               # 精简为：用 McNodeShell + 自定义摘要渲染
│   ├── BlockNode.tsx
│   ├── ... (其余原有节点同理精简)
│   ├── VariableNode.tsx           # 【新增】变量/常量节点
│   ├── SubgraphNode.tsx           # 【新增】子图/宏节点（封装复用）
│   ├── LoopNode.tsx               # 【新增】循环节点（for/forEach/while）
│   ├── CustomNode.tsx             # 【新增】自定义节点类型（schema 驱动）
│   ├── portSchemas.ts             # 每种节点的端口 schema（数据驱动，含新增 4 类）
│   ├── fieldSchemas.ts            # 每种节点的字段 schema（含 tooltip 文本）
│   ├── fieldTooltips.ts           # 【新增】字段 MC 领域解释文本
│   └── index.ts                   # 注册表（保留+扩展）
├── drawer/
│   ├── NodeDetailDrawer.tsx       # 右侧抽屉容器（滑入动画+遮罩）
│   ├── NodeDetailForm.tsx         # 根据节点类型动态渲染表单
│   ├── FieldLabel.tsx             # 【新增】字段标签 + ? tooltip 图标
│   ├── ErrorRecovery.tsx          # 【新增】错误恢复提示组件（修复建议）
│   └── editors/                   # 7 类 MC 感知编辑器
│       ├── DropdownEditor.tsx         # 枚举下拉（材质/事件类型/动作类型）
│       ├── NodeRefEditor.tsx          # 节点引用选择器（从画布已有节点选）
│       ├── NumberStepperEditor.tsx    # 带上下限的数字步进
│       ├── ResourceIdEditor.tsx       # modid:path 资源 ID 输入（含外部 mod 命名空间）
│       ├── ColorEditor.tsx            # MC 颜色选择器
│       ├── NbtEditor.tsx              # NBT 树状编辑器
│       ├── SegmentedEditor.tsx        # 分段切换（物品行为模式：普通/Food/Tool/Armor）
│       └── types.ts                   # EditorProps / FieldSchema 统一类型
├── templates/
│   ├── TemplateLibrary.tsx        # 【新增】模板库面板（物品/方块/配方/机器预设）
│   ├── templateData.ts            # 【新增】预设模板数据
│   └── TemplateCard.tsx           # 【新增】单个模板卡片
├── onboarding/
│   ├── OnboardingTour.tsx         # 【新增】新手引导分步浮层
│   └── onboardingSteps.ts         # 【新增】引导步骤定义
├── subgraph/
│   ├── SubgraphEditor.tsx         # 【新增】子图编辑器（独立画布编辑子图内容）
│   └── subgraphManager.ts         # 【新增】子图注册/引用管理
├── customNodes/
│   ├── CustomNodeImporter.tsx     # 【新增】自定义节点类型导入器
│   ├── CustomNodeSchema.ts        # 【新增】自定义节点 schema 定义类型
│   └── customNodeRegistry.ts      # 【新增】自定义节点注册表
├── NodeGraphEditor.tsx            # 主画布（连线改直角折线，集成抽屉触发+引导+子图入口）
└── connectionRules.ts             # 端口标签+数据类型校验（扩展）
```

### 2.2 关键架构决策

1. **`McNodeShell` 统一外壳**：所有 11 种节点共用，保证视觉一致性。节点组件本身只负责「摘要内容」和「端口 schema 声明」，不再各自写 div/Handle。
2. **抽屉与节点解耦**：节点只显示摘要，点击节点的「⚙️ 设置」按钮或双击节点打开右侧抽屉，抽屉内做完整参数编辑。
3. **端口 schema 数据驱动**：每个节点类型声明 `getPorts(data): NodePort[]`，支持动态端口（如配方节点的 N 个材料端口随数据变化）。`NodePort` 复用 `packages/shared` 中已有定义（`direction: 'in'|'out'`、`type: PortType`）。
4. **编辑器注册表**：7 类编辑器按字段类型动态组合，新字段类型只需注册新编辑器。
5. **草稿模式**：抽屉打开时深拷贝节点 data 到草稿，编辑改草稿，保存时写回 store，避免误改。

### 2.3 端口数据模型

复用 `packages/shared/src/schemas/node-graph-spec.ts` 中已有的 `NodePort` 和 `PortType`（15 种），不新建 `PortDef`：

```ts
// 已有定义（node-graph-spec.ts:57-68），此处仅展示
interface NodePort {
  id: string;               // 'material_0', 'result', 'trigger', 'true', 'false'
  label: string;            // '材料 1', '产物', '触发', '真', '假'
  type: PortType;           // 'item_stack' | 'block_state' | 'entity' | ... | 'any'（15 种）
  direction: 'in' | 'out';  // 'in'=输入端口（左侧 Handle target），'out'=输出端口（右侧 Handle source）
  required: boolean;        // 是否必填
  multiple: boolean;        // 允许多条连线（如配方多材料）
  defaultValue?: string;    // 未连线时的默认值
}

// 每种节点类型注册 getPorts（在 nodes/portSchemas.ts 中实现）
const getPorts: (data: NodeData) => NodePort[] = (data) => {
  switch (data.kind) {
    case 'item':
      return [{ id: 'item', label: '物品', type: 'item_stack', direction: 'out', required: false, multiple: true }];
    case 'recipe':
      return [
        ...Array.from({ length: data.ingredients?.length ?? 0 }, (_, i) => ({
          id: `material_${i}`, label: `材料 ${i + 1}`, type: 'item_stack' as const,
          direction: 'in' as const, required: false, multiple: true,
        })),
        { id: 'result', label: '产物', type: 'item_stack', direction: 'out', required: true, multiple: false },
      ];
    case 'condition':
      return [
        { id: 'input', label: '输入', type: 'void', direction: 'in', required: false, multiple: false },
        { id: 'true', label: '真', type: 'void', direction: 'out', required: false, multiple: true },
        { id: 'false', label: '假', type: 'void', direction: 'out', required: false, multiple: true },
      ];
    case 'machine':
      return [
        { id: 'item_in', label: '物品输入', type: 'item_stack', direction: 'in', required: false, multiple: true },
        { id: 'energy_in', label: '能量输入', type: 'energy', direction: 'in', required: false, multiple: false },
        { id: 'item_out', label: '产物', type: 'item_stack', direction: 'out', required: false, multiple: true },
      ];
    case 'event':
      return [{ id: 'trigger', label: '触发', type: 'void', direction: 'out', required: false, multiple: true }];
    case 'action':
      return [
        { id: 'input', label: '输入', type: 'void', direction: 'in', required: false, multiple: false },
        { id: 'next', label: '下一步', type: 'void', direction: 'out', required: false, multiple: true },
      ];
    // block / entity / multiblock / code / comment 同理在 portSchemas.ts 中补全
  }
};
```

**命名约定**（对齐代码库已有类型）：`NodePort`（非 `PortDef`）、`direction: 'in'|'out'`（非 `kind: 'input'|'output'`）、`type: PortType`（非 `dataType`）。

---

## 3. 节点视觉设计（纯 MC 风格）

### 3.1 节点结构（以物品节点为例）

**展开状态**：
```
╔══════════════════════════════════╗
║▌⚔ 物品                    普通 ⚙ ▸║ ← 灰色凸起头部（#c6c6c6），左侧粉色色条
╠══════════════════════════════════╣
║ ID    iron_sword                 │ ← 石质纹理背景（#1a1a1a + 噪点）
║ 耐久  250       伤害  6.0        │
║ 行为  Tool                       │
╠══════════════════════════════════╣
║                          物品 ◼──│ ← 端口：灰色凹陷方块（像漏斗口）
╚══════════════════════════════════╝
```

**折叠状态**（只留头部 + 端口）：
```
╔══════════════════════════════════╗
║▌⚔ 物品                    普通 ⚙ ▾│
║                          物品 ◼──│ ← 端口移到头部底边
╚══════════════════════════════════╝
```

### 3.2 视觉规格

| 元素 | 规格 | MC 风格体现 |
|------|------|-------------|
| **头部条** | 高 28px，背景 `#c6c6c6`（MC 按钮灰），3D 凸起边框（上/左白、下/右黑），左侧 4px 类别色条 + 像素图标（类别色）+ 像素字体标题（类别色） | MC GUI 按钮的凸起感 |
| **类型徽章** | 右上角纯文字颜色（普通=白、稀有=黄、史诗=青），无背景框 | MC 物品 tooltip 的稀有度文字色 |
| **边框** | 2px 3D 凸起（`border-t-l-white` + `border-b-r-black`），圆角 2px | MC 方块边缘硬朗感 |
| **阴影** | 硬阴影 `4px 4px 0 rgba(0,0,0,0.5)`（无模糊） | 像素艺术硬阴影 |
| **背景** | `#1a1a1a`（mc-surface），叠加 CSS 噪点纹理（`background-image: radial-gradient(rgba(255,255,255,0.03) 1px, transparent 1px); background-size: 3px 3px` 模拟石头质感） | MC GUI 石质背景 |
| **端口** | 6×6px 方块，`box-shadow: inset 2px 2px 0 rgba(0,0,0,0.6)` 模拟凹陷，颜色按 `type`（PortType） | MC 漏斗/管道接口感 |
| **端口标签** | 10px，白色文字 | MC tooltip 字号 |
| **字体** | 头部用 MC 像素字体 Press Start 2P（Google Fonts CDN 加载，降级到 `ui-monospace, monospace`），主体用系统字体 11px | MC 标题像素感 |
| **尺寸** | 最小宽 180px，最大宽 280px，高度自适应 | 比当前 160px 略宽以容纳端口标签 |

### 3.3 配色（降饱和 MC 染色方块色）

| 节点 | 头部色条色 | Tailwind 自定义 | 十六进制 |
|------|-----------|-----------------|---------|
| 物品 item | 粉 | `mc-item` | `#d88a8a` |
| 方块 block | 橙 | `mc-block` | `#d8a87a` |
| 生物 entity | 青 | `mc-entity` | `#7ac6c6` |
| 配方 recipe | 黄 | `mc-recipe` | `#d8c87a` |
| 机器 machine | 翠绿 | `mc-machine` | `#7ac68a` |
| 多方块 multiblock | 紫 | `mc-multiblock` | `#a87ac6` |
| 事件 event | 紫 | `mc-event` | `#9a7ac6` |
| 条件 condition | 蓝 | `mc-condition` | `#7a8ac6` |
| 动作 action | 红 | `mc-action` | `#c67a7a` |
| 代码 code | 灰 | `mc-code` | `#9a9a9a` |
| 备注 comment | 黄 | `mc-comment` | `#d8c87a` |

在 `tailwind.config.ts` 的 `theme.extend.colors` 下注册这些自定义色。

### 3.4 端口布局规则

- **输入端口**：左侧垂直排列，每个端口 = `标签文字 + ◼ 方块`
- **输出端口**：右侧垂直排列，每个端口 = `◼ 方块 + 标签文字`
- **单端口节点**（如物品）：端口垂直居中
- **多端口节点**（如条件 true/false）：上下分布，间距 16px
- **动态端口**（如配方 N 个材料）：按数据长度动态生成，超出 3 个时主体区滚动
- **折叠状态**：端口移到头部底边，水平排列

### 3.5 端口颜色（按 PortType）

端口颜色按 `NodePort.type`（`PortType` 枚举，15 种）映射，在 `nodes/base/portColors.ts` 中定义：

| PortType | 颜色 | 含义 |
|----------|------|------|
| `item_stack` | 粉 `#d88a8a` | 物品引用 |
| `block_state` | 橙 `#d8a87a` | 方块引用 |
| `entity` | 青 `#7ac6c6` | 实体引用 |
| `fluid` | 蓝 `#7a9ac6` | 流体 |
| `energy` | 黄 `#d8c87a` | 能量（FE/RF） |
| `redstone` | 红 `#c67a7a` | 红石信号 |
| `player` | 绿 `#7ac68a` | 玩家 |
| `world` | 灰 `#9a9a9a` | 世界 |
| `boolean` | 紫 `#a87ac6` | 布尔 |
| `integer` | 蓝 `#7a8ac6` | 整数 |
| `number` | 蓝 `#7a8ac6` | 浮点 |
| `string` | 橙 `#d8a87a` | 字符串 |
| `nbt` | 紫 `#9a7ac6` | NBT 数据 |
| `void` | 紫 `#9a7ac6` | 控制流（无数据，事件/条件/动作） |
| `any` | 灰 `#9a9a9a` | 任意类型（兼容） |

---

## 4. 连线设计

### 4.1 直角折线

| 属性 | 规格 |
|------|------|
| **edge type** | React Flow 的 `type: 'step'`（直角折线，转角不圆角） |
| **颜色** | 按 edge kind：control=紫虚线 `#9a7ac6`、craft=黄实线 `#d8c87a`、structure=紫实线 `#a87ac6`、flow=绿实线 `#7ac68a`、data=灰实线 `#9a9a9a` |
| **粗细** | 默认 2px，hover 变 3px，选中变 4px + 发光（`filter: drop-shadow`） |
| **箭头** | `MarkerType.ArrowClosed`，颜色跟随线色 |
| **标签** | 中点显示，双击编辑（保留现有 `window.prompt` 交互） |
| **动画** | control 边静态虚线，其余 kind 未禁用时流动动画 |
| **MC 风格** | 折线转角用直角（不圆角），像红石电路走线 |

### 4.2 连线校验扩展

`connectionRules.ts` 扩展为按端口 `type`（`PortType`）校验：

- `item_stack` 只能连 `item_stack`，`block_state` 只能连 `block_state`，`entity` 只能连 `entity`
- `void` 只能连 `void`（event→condition→action 控制流）
- `energy` 只能连 `energy`（机器节点间）
- `any` 兼容所有（兜底），`integer`/`number` 互通
- `multiple: false` 的端口已有连线时，新连线替换旧连线
- 校验失败：连线变红 + tooltip 提示原因

---

## 5. 抽屉编辑器

### 5.1 抽屉容器（`NodeDetailDrawer`）

```
画布                                    ┌─────────────────────┐
┌──────────────────────────┐           │ ⚔ 物品节点      ✕  │ ← 标题栏（MC 灰色凸起）
│                          │           ├─────────────────────┤
│   [节点]   [节点]         │  遮罩 →   │ ID *    iron_sword  │ ← 表单区（可滚动）
│                          │           │ 行为    [普通│Food│Tool│Armor] │
│                          │           │ 耐久    [- 250 +]    │
│                          │           │ 材质    [iron    ▾]  │
│                          │           │ ...                 │
└──────────────────────────┘           ├─────────────────────┤
                                       │     [保存]          │ ← 底部（MC 按钮风格）
                                       └─────────────────────┘
```

| 属性 | 规格 |
|------|------|
| **宽度** | 400px，从右侧滑入 |
| **遮罩** | `rgba(0,0,0,0.4)`，点击触发关闭确认 |
| **动画** | `transform: translateX(100%) → 0`，250ms ease-out |
| **触发** | 双击节点 / 点击节点的 ⚙ 按钮 |
| **关闭** | ✕ 按钮 / ESC / 点遮罩 / 保存后自动关 |
| **保存** | 显式「保存」按钮（不自动保存，避免误改）；有校验错误时禁用 |
| **取消** | 丢弃草稿，关闭抽屉 |
| **未保存关闭** | `dirty=true` 时弹确认「有未保存改动，确认丢弃？」 |
| **MC 风格** | 标题栏 3D 凸起灰色，按钮 MC 风格（凸起灰，按下凹陷），输入框 MC GUI 凹陷输入框 |

### 5.2 字段 schema 驱动表单

```ts
interface FieldSchema {
  key: string;       // 对应 NodeData 中的真实字段名（如 'itemId'/'displayName'/'maxStackSize'）
  label: string;
  type: 'text' | 'number' | 'dropdown' | 'noderef' | 'resourceId' | 'color' | 'nbt' | 'segmented';
  required?: boolean;
  min?: number; max?: number; step?: number;
  options?: string[];                    // dropdown / segmented 用
  portType?: PortType;                   // noderef 用（限定可选节点类型，复用 PortType 枚举）
  condition?: { field: string; equals?: string; in?: string[] };  // 条件显示
}

// 每种节点类型注册字段 schema（key 对齐 node-graph-spec.ts 中各 XxxNodeData 的真实字段）
const FIELD_SCHEMAS: Record<NodeKind, FieldSchema[]> = {
  item: [
    { key: 'itemId', label: '物品 ID', type: 'text', required: true },
    { key: 'displayName', label: '显示名称', type: 'text', required: true },
    { key: 'category', label: '物品分类', type: 'dropdown', required: true,
      options: ['sword', 'pickaxe', 'axe', 'shovel', 'hoe',
        'helmet', 'chestplate', 'leggings', 'boots',
        'food', 'potion', 'bow', 'crossbow', 'shield',
        'fishing_rod', 'shears', 'flint_and_steel', 'material', 'misc'] },
    { key: 'maxStackSize', label: '最大堆叠', type: 'number', min: 1, max: 64, step: 1 },
    { key: 'maxDamage', label: '最大耐久', type: 'number', min: 0, max: 99999, step: 1,
      condition: { field: 'category', in: ['sword', 'pickaxe', 'axe', 'shovel', 'hoe',
        'helmet', 'chestplate', 'leggings', 'boots', 'bow', 'crossbow',
        'fishing_rod', 'shears', 'flint_and_steel'] } },
    { key: 'rarity', label: '稀有度', type: 'segmented',
      options: ['common', 'uncommon', 'rare', 'epic'] },
    { key: 'glow', label: '附魔光辉', type: 'segmented', options: ['false', 'true'] },
    { key: 'texturePath', label: '贴图路径', type: 'text',
      condition: { field: 'category', in: ['material', 'misc', 'food', 'potion'] } },
  ],
  // block / entity / recipe / machine / multiblock / event / condition / action / code / comment
  // 的字段 schema 在 fieldSchemas.ts 中按各节点 XxxNodeData 真实字段补全，此处 item 为完整示例模板
};
```

`NodeDetailForm` 根据 `FIELD_SCHEMAS[kind]` 渲染表单，遇到 `condition` 时检查草稿数据决定是否显示该字段。**字段 `key` 必须对齐 `node-graph-spec.ts` 中各 `XxxNodeData` 的真实字段名**（如 `itemId`/`displayName`/`maxStackSize`/`maxDamage`/`rarity`/`glow`/`texturePath`）。

### 5.3 字段条件显示示例（物品节点）

```
分类选 [misc]    → 显示：物品 ID、显示名称、最大堆叠、稀有度、附魔光辉、贴图路径
分类选 [sword]   → 显示：物品 ID、显示名称、最大堆叠、最大耐久、稀有度、附魔光辉
分类选 [helmet]  → 显示：物品 ID、显示名称、最大堆叠、最大耐久、稀有度、附魔光辉
分类选 [food]    → 显示：物品 ID、显示名称、最大堆叠、稀有度、附魔光辉、贴图路径
```

`SegmentedEditor`/`DropdownEditor` 切换时，表单根据 `condition` 字段自动重新渲染可见字段。

---

## 6. 七类 MC 感知编辑器

### 6.1 统一接口

```ts
interface EditorProps<T> {
  value: T;
  onChange: (v: T) => void;
  schema: FieldSchema;
  graph: NodeGraph;     // NodeRefEditor 用来列出可选节点
  error?: string;       // 字段级校验错误
}

const EDITOR_REGISTRY: Record<FieldSchema['type'], React.FC<EditorProps<any>>> = {
  text: TextEditor,
  number: NumberStepperEditor,
  dropdown: DropdownEditor,
  noderef: NodeRefEditor,
  resourceId: ResourceIdEditor,
  color: ColorEditor,
  nbt: NbtEditor,
  segmented: SegmentedEditor,
};
```

### 6.2 各编辑器细节

| 编辑器 | 用途 | MC 风格体现 | 校验 |
|--------|------|-------------|------|
| **DropdownEditor** | 枚举选择（材质/事件类型/动作类型） | MC 按钮风格下拉，选项 hover 高亮 | 必填校验 |
| **NodeRefEditor** | 从画布已有节点选（配方的材料、机器的产物） | 下拉显示节点列表 + 图标 + ID，选中后显示节点摘要小卡片 | 引用节点必须存在 |
| **NumberStepperEditor** | 数值（耐久/伤害/堆叠） | 凹陷输入框 + 左右 [-][+] MC 按钮，超限红色提示 | min/max 范围校验 |
| **ResourceIdEditor** | `modid:path` 资源 ID | 命名空间下拉（当前 mod + minecraft）+ path 输入，实时格式校验 | 正则 `^[a-z0-9_]+:[a-z0-9_/]+$` |
| **ColorEditor** | MC 颜色（皮革盔甲染色） | 预设 16 色 MC 染色色板（白/橙/品红/淡蓝/黄/黄绿/粉/灰/浅灰/青/紫/蓝/棕/绿/红/黑）+ 自定义 | 颜色值合法 |
| **NbtEditor** | NBT 数据树 | 树状结构，每节点选类型（byte/short/int/long/float/double/string/list/compound），可增删子节点 | 类型合法 |
| **SegmentedEditor** | 行为模式切换（普通/Food/Tool/Armor） | MC 标签页风格分段控件，切换后表单字段动态显示/隐藏 | 必选 |

### 6.3 MC 16 色染色色板

```ts
const MC_DYE_COLORS = [
  { name: '白色', value: '#FFFFFF' },
  { name: '橙色', value: '#D87F33' },
  { name: '品红色', value: '#B24CD8' },
  { name: '淡蓝色', value: '#6699D8' },
  { name: '黄色', value: '#E5E533' },
  { name: '黄绿色', value: '#7FCC19' },
  { name: '粉色', value: '#F27FA5' },
  { name: '灰色', value: '#4C4C4C' },
  { name: '浅灰色', value: '#999999' },
  { name: '青色', value: '#4C7F99' },
  { name: '紫色', value: '#7F3FB2' },
  { name: '蓝色', value: '#334CB2' },
  { name: '棕色', value: '#664C33' },
  { name: '绿色', value: '#667F33' },
  { name: '红色', value: '#993333' },
  { name: '黑色', value: '#191919' },
];
```

---

## 7. 折叠展开

### 7.1 行为

| 行为 | 规格 |
|------|------|
| **数据字段** | 节点 `data` 增加 `collapsed: boolean`（默认 false） |
| **折叠时** | 只渲染 `McNodeHeader`，隐藏 `McNodeSummary` 和主体区 |
| **端口保留** | 折叠时端口移到头部底边，水平排列（保证连线不断） |
| **触发** | 头部右侧 ▸/▾ 切换按钮 |
| **持久化** | `collapsed` 状态随节点图一起存盘（保存到 JSON） |
| **全局操作** | 工具栏新增「全部折叠」「全部展开」按钮（批量改所有节点 `collapsed`） |
| **调试兼容** | 折叠时调试高亮（青色边框）仍在头部生效，断点（紫色虚线）也在头部显示 |

### 7.2 折叠状态端口布局

```
╔══════════════════════════════════╗
║▌⚔ 物品                    普通 ⚙ ▾│
║                          物品 ◼──│ ← 端口移到头部底边
╚══════════════════════════════════╝
```

---

## 8. 模板库（下限提升）

### 8.1 目的

新手不用从零配置参数，点击模板即创建预配置好的节点。

### 8.2 模板分类与示例

| 分类 | 模板示例 | 创建的节点 |
|------|---------|-----------|
| **武器** | 铁剑、钻石剑、弓 | item 节点（behavior=tool，预设材质/耐久/伤害） |
| **工具** | 铁镐、钻石镐、水桶 | item 节点（behavior=tool） |
| **食物** | 苹果、烤牛肉、金苹果 | item 节点（behavior=food，预设饱食度/饱和度） |
| **方块** | 基础方块、发光方块、可交互方块 | block 节点（预设属性） |
| **配方** | 3×3 合成、熔炼、切石 | recipe 节点（预设材料/产物端口） |
| **机器** | 熔炉式机器、发电机 | machine 节点（预设 GUI/能源） |
| **事件链** | 右键方块→执行动作 | event + action 节点 + 连线 |

### 8.3 UI 位置

- `NodePalette` 上方新增「模板」标签页（与「节点」标签页并列）
- 模板卡片显示：图标 + 名称 + 简短描述
- 点击卡片：在画布中心创建预配置节点（单节点）或节点组（事件链）
- 模板创建后可正常编辑（不锁定）

### 8.4 模板数据结构

```ts
interface NodeTemplate {
  id: string;              // 'iron-sword'
  name: string;            // '铁剑'
  description: string;     // '基础武器，铁质工具'
  category: 'weapon' | 'tool' | 'food' | 'block' | 'recipe' | 'machine' | 'event-chain';
  icon: string;            // McIcon name
  // 创建内容：单节点或多节点+连线
  nodes: ModNode[];        // 预配置节点（含 data）
  edges?: ModEdge[];       // 事件链模板的连线
}
```

---

## 9. 字段 Tooltip + 错误恢复（下限提升）

### 9.1 字段 Tooltip

每个字段标签旁有 `?` 图标，hover 显示 MC 领域解释。

```ts
// fieldTooltips.ts
const FIELD_TOOLTIPS: Record<string, string> = {
  'item.id': '资源 ID，格式 modid:path。modid 是你的 mod 标识（如 mymod），path 是物品标识（如 iron_sword）。最终游戏内为 mymod:iron_sword',
  'item.material': '工具材质决定耐久、挖掘等级、攻击力。木头最弱，下界合金最强',
  'item.nbt': 'NBT 是 MC 的数据存储格式，用于存储附魔、自定义属性、Lore 等附加数据',
  'item.color': '皮革盔甲染色颜色。16 色 MC 染色色板或自定义',
  'recipe.ingredients': '合成材料，可引用画布上的物品节点。支持多个材料输入',
  'machine.energy': '机器能源接口，单位 FE（Forge Energy）或 RF（Redstone Flux）',
  // ... 其余字段
};
```

`FieldLabel` 组件渲染：`标签文字 + ? 图标`，hover 显示 tooltip 浮层（MC tooltip 风格：紫色边框 + 深色背景）。

### 9.2 错误恢复提示

校验失败时不只显示红框，还显示**修复建议**：

| 错误类型 | 提示示例 |
|---------|---------|
| 数值超限 | 「耐久度应在 0-99999 之间，当前 999999。建议改为 99999」+「一键修复」按钮 |
| 格式错误 | 「资源 ID 应为 modid:path 格式（全小写+下划线）。示例：mymod:iron_sword」 |
| 必填缺失 | 「ID 为必填项，请输入资源 ID」 |
| 引用失效 | 「引用的物品节点已删除。可选物品节点：[铁剑][钻石剑]」+ 点击切换引用 |
| 端口冲突 | 「该端口只接受单连线，当前已有连线。新连线将替换旧连线」 |

`ErrorRecovery` 组件挂在编辑器下方，红色背景 + 修复建议文字 + 可选的「一键修复」按钮。

---

## 10. 新手引导（下限提升）

### 10.1 引导触发

- 首次打开应用（localStorage 标记 `onboarding-completed`）
- 或工具栏「?」按钮手动触发

### 10.2 引导步骤

| 步骤 | 高亮目标 | 提示内容 |
|------|---------|---------|
| 1 | NodePalette | 「从这里拖入节点到画布。试试拖一个「物品」节点」 |
| 2 | 画布上的节点 | 「双击节点或点 ⚙ 打开右侧抽屉编辑参数」 |
| 3 | 抽屉 | 「在这里配置节点的详细参数。字段旁的 ? 有解释」 |
| 4 | 节点端口 | 「拖动端口之间的连线建立关系。如配方的材料连到物品节点」 |
| 5 | 工具栏保存按钮 | 「配置完成后点保存，然后可以生成 mod」 |

### 10.3 引导 UI

- 半透明遮罩 + 高亮目标元素（镂空效果）
- 提示气泡（MC tooltip 风格）
- 「下一步」「跳过」「完成」按钮
- 步骤进度指示器（3/5）

---

## 11. 变量节点（上限提升）

### 11.1 目的

定义全局变量/常量，可被其他节点引用，避免重复配置。

### 11.2 数据结构

```ts
interface VariableNodeData extends BaseNodeData {
  varName: string;        // 变量名（标识符）
  varType: 'int' | 'double' | 'string' | 'boolean' | 'item' | 'block';
  value: unknown;         // 值（类型按 varType）
  isConstant: boolean;    // true=常量（不可改），false=变量（运行时可改）
}
```

### 11.3 端口

```ts
// getPorts 的 variable 分支
case 'variable':
  return [
    { id: 'value', label: data.varName || '变量', type: data.varType as PortType,
      direction: 'out', required: false, multiple: true },
  ];
```

### 11.4 引用方式

其他节点的字段通过 `NodeRefEditor` 选择变量节点，运行时替换为变量值。例如：
- 配方节点的「产物数量」字段可引用 `int` 变量
- 动作节点的「伤害值」字段可引用 `double` 变量

### 11.5 编译处理

变量节点编译为 Java 静态字段或实例字段：
```java
// isConstant=true → static final
public static final int MAX_DAMAGE = 10;
// isConstant=false → 实例字段
public int currentDamage = 0;
```

---

## 12. 子图/宏节点（上限提升）

### 12.1 目的

封装常用子图为可复用节点，支持嵌套，避免重复绘制相同逻辑。

### 12.2 创建方式

- 选中画布上多个节点 → 右键菜单「封装为子图」
- 输入子图名称 → 创建 SubgraphNode
- 子图内部节点间的连线保留，外部连线映射到子图节点的端口

### 12.3 数据结构

`portMappings` 定义在 `SubgraphDefinition`（子图定义级别），不在 `SubgraphNodeData` 内。`SubgraphNodeData` 只存引用 ID：

```ts
interface SubgraphNodeData extends BaseNodeData {
  kind: 'subgraph';
  subgraphId: string;          // 引用的子图 ID（自定义节点为空）
  subgraphName: string;        // 显示名缓存
  customTypeId: string | null; // 自定义节点类型 ID（普通子图为 null）
  customFields: Record<string, unknown>; // 自定义节点的用户输入值（普通子图为空对象）
}

// 端口映射在子图定义级别（不在 SubgraphNodeData 内）
interface SubgraphPortMapping {
  internalPortId: string;      // 子图内部边界节点的端口
  externalPortId: string;      // 子图节点的对外端口
  label: string;
  direction: 'in' | 'out';     // 不用 kind: 'input'|'output'
  type: PortType;              // 不用 dataType: PortDataType
}

interface SubgraphDefinition {
  id: string;
  name: string;
  nodes: ModNode[];
  edges: ModEdge[];
  portMappings: SubgraphPortMapping[];  // 在这里，不在 SubgraphNodeData 内
}
```

### 12.4 子图编辑

- 双击 SubgraphNode → 打开 `SubgraphEditor`（独立画布）
- 子图画布有「输入边界节点」「输出边界节点」定义对外端口
- 子图保存后，所有引用该子图的 SubgraphNode 自动更新

### 12.5 嵌套

- 子图内可包含 SubgraphNode（多层嵌套）
- 防循环检测：子图引用链不允许成环

### 12.6 管理

`subgraph/subgraphManager.ts` 导出**单例** `subgraphManager`（不导出独立函数）：

```ts
class SubgraphManager {
  register(sg: SubgraphDefinition): void
  get(id: string): SubgraphDefinition | undefined   // 用 subgraphManager.get(id)，不导出 getSubgraph
  has(id: string): boolean
  list(): SubgraphDefinition[]
  remove(id: string): void
  clear(): void
  detectCycle(parentId: string, targetId: string): boolean
  serializeAll(): string
  deserializeAll(json: string): { ok: true } | { ok: false; error: string }
}
export const subgraphManager = new SubgraphManager();
```

子图序列化到节点图 JSON 的 `subgraphs` 字段。

---

## 13. 循环节点（上限提升）

### 13.1 目的

批量逻辑（对一组物品执行相同动作、迭代配方列表等）。

### 13.2 数据结构

```ts
interface LoopNodeData extends BaseNodeData {
  kind: 'loop';
  loopType: 'for' | 'forEach' | 'while';
  // for: init + condition + update
  // forEach: iterable（变量引用或列表）
  // while: condition
  init: string;            // for 的初始化表达式（for 必填，forEach/while 为空字符串）
  condition: string;       // 循环条件（for/while 必填，forEach 为空字符串）
  update: string;          // for 的更新表达式（for 必填，forEach/while 为空字符串）
  iterable: string;        // forEach 的可迭代对象（forEach 必填，for/while 为空字符串）
  loopVarName: string;     // 循环变量名（如 i / item，必填）
  loopVarType: 'integer' | 'item_stack' | 'block_state' | 'string';  // 对齐 PortType
  bodySubgraphId: string;  // 循环体子图 ID（空字符串表示无子图，直接连动作节点）
}
```

**字段可选性说明**：所有字段都声明为必填（非 `?`），但根据 `loopType` 不同字段值不同——`for` 用 `init`/`condition`/`update`，`forEach` 用 `iterable`，`while` 用 `condition`，不用的字段为空字符串 `''`。这避免 `undefined` 在 Zod 解析和 JSON 序列化时的歧义。

### 13.3 端口

```ts
// getPorts 的 loop 分支
case 'loop':
  return [
    { id: 'input', label: '输入', type: 'void', direction: 'in', required: false, multiple: false },
    { id: 'loop_var', label: data.loopVarName, type: data.loopVarType as PortType,
      direction: 'out', required: false, multiple: true },
    { id: 'body', label: '循环体', type: 'void', direction: 'out', required: false, multiple: false },
    { id: 'done', label: '完成', type: 'void', direction: 'out', required: false, multiple: true },
  ];
```

- `loop_var` 端口：当前循环变量值，供循环体内节点引用
- `body` 端口：连接循环体子图或动作节点的控制流入口
- `done` 端口：循环结束后继续的控制流

### 13.4 编译处理

```java
// forEach 示例
for (ItemStack item : itemList) {
  // 循环体编译为这里的代码
}
```

### 13.5 调试

- 断点支持：循环节点可设断点，每次迭代暂停
- 变量监视：调试时显示当前循环变量值

---

## 14. 自定义节点类型 + 外部 mod API（上限提升）

### 14.1 自定义节点类型

高手定义自己的节点类型，JSON schema 驱动。

#### 14.1.1 Schema 定义

```ts
// CustomNodeSchema.ts
interface CustomNodeSchema {
  typeId: string;          // 'mymod:custom_crafter'
  label: string;           // '自定义合成台'
  description: string;
  icon: string;
  color: string;           // 头部色
  ports: NodePort[];        // 端口定义（复用 NodePort，非 PortDef）
  fields: FieldSchema[];   // 字段定义（复用 7 类编辑器）
  codeTemplate: string;    // Java 代码模板（Mustache 语法，字段值注入）
}
```

#### 14.1.2 注册与使用

- `customNodeRegistry.ts` 维护已注册的自定义类型
- `CustomNode.tsx` 渲染：读 schema → 用 McNodeShell + schema 驱动端口和字段
- 导入/导出：JSON 文件，可分享给其他用户

#### 14.1.3 代码模板示例

```java
// codeTemplate
public class {{className}} extends BlockEntity {
  private int {{field:energy}} = 0;
  
  public void {{field:method}}({{field:inputType}} input) {
    // {{field:customLogic}}
  }
}
```

字段值通过 Mustache 语法 `{{field:key}}` 注入。

### 14.2 外部 mod API 引用

#### 14.2.1 ResourceIdEditor 增强

命名空间下拉除了「当前 mod」和「minecraft」，还列出：
- 已安装的外部 mod（从 mod 加载列表读取）
- 选中外部 mod 后，path 输入框支持自动补全该 mod 的已注册物品/方块

#### 14.2.2 代码节点 import 增强

CodeNode 的代码编辑器支持：
- 自动补全外部 mod 的类名（如 `import com.example.mymod.api.MyApi;`）
- 预置常用 mod 的 import 快捷插入（Forge/Fabric API、JEI、Create 等）

#### 14.2.3 编译依赖

- 编译时自动添加外部 mod 的 API jar 到 classpath
- 缺失依赖时编译错误提示「需要 mod XXX 的 API，请在 mod 配置中添加依赖」

---

## 15. 状态管理

### 15.1 新增 `useDrawerStore`（Zustand）

```ts
interface DrawerState {
  open: boolean;
  nodeId: string | null;
  draft: NodeData | null;             // 草稿：打开时复制，编辑改草稿，保存时写回
  dirty: boolean;                     // 草稿与原数据有差异
  errors: Record<string, string>;     // 字段级校验错误
  // actions
  openDrawer: (nodeId: string, graph: NodeGraph) => void;
  closeDrawer: () => void;
  updateField: (key: string, value: unknown) => void;  // 改草稿，触发校验
  saveDraft: () => void;              // 写回 node-graph-store + commit
  cancelDraft: () => void;            // 丢弃草稿
}
```

**草稿模式关键**：
- 打开抽屉时**深拷贝**节点 data 到 `draft`，所有编辑器改 `draft`
- 保存时：校验通过 → 写回 `useNodeGraphStore.updateNode(nodeId, draft)` + `commit()` 撤销点 → 关闭抽屉
- 取消时：丢弃草稿，关闭抽屉
- 关闭时若 `dirty=true`：弹确认「有未保存改动，确认丢弃？」

### 15.2 修改现有 store

- `useNodeGraphStore`：
  - 节点 `data` 增加 `collapsed: boolean` 字段
  - 新增 actions：`toggleCollapse(nodeId)` / `collapseAll()` / `expandAll()`（已有 `updateNode(nodeId, patch)` 不改名）
- `useDebuggerStore`：折叠状态下调试高亮逻辑适配（边框画在头部容器上）

### 15.3 数据流

```
用户双击节点
  → useDrawerStore.openDrawer(nodeId, graph)
  → 深拷贝 node.data 到 draft
  → 抽屉渲染 NodeDetailForm(draft)
  → 用户编辑字段
  → updateField(key, value) 改 draft + 触发校验
  → 用户点保存
  → 校验全部通过？
    → 是：useNodeGraphStore.updateNode(nodeId, draft) + commit() + closeDrawer()
    → 否：禁用保存按钮 + 显示错误列表
```

---

## 16. 错误处理

| 场景 | 处理 |
|------|------|
| **编辑器实时校验** | NumberStepper 超限 → 输入框红框 + 错误文字；ResourceId 格式错 → 红框 + 提示「应为 modid:path」；NbtEditor 类型错 → 行内红字 |
| **错误恢复提示** | 校验失败时 `ErrorRecovery` 组件显示修复建议（数值超限给建议值、格式错给示例、引用失效列可选节点）+ 可选「一键修复」按钮（详见 §9.2） |
| **保存前统一校验** | 遍历所有 `required` 字段，缺失则加入 `errors`；有错误时禁用「保存」按钮 + 错误列表 |
| **未保存关闭** | `dirty=true` 时点 ✕/ESC/遮罩，弹确认对话框 |
| **节点引用失效** | NodeRefEditor 检测被引用节点已删除，显示「⚠ 节点已删除」红色提示 + 列出可选节点 |
| **端口连线冲突** | connectionRules 校验 `type`（PortType）匹配 + multiple 限制，不允许时连线变红 + tooltip 提示原因 |
| **子图循环引用** | `subgraphManager` 检测子图引用链成环，创建时阻止 + 提示「子图不能引用自身（直接或间接）」 |
| **自定义节点 schema 错误** | 导入的自定义节点 JSON schema 校验失败，列出具体字段错误 + 拒绝注册 |
| **外部 mod 依赖缺失** | 编译时检测引用的外部 mod API jar 缺失，提示「需要 mod XXX 的 API，请在 mod 配置中添加依赖」 |
| **调试与折叠共存** | 折叠状态下调试高亮/断点标记仍在头部容器显示，不丢失 |

---

## 17. 测试策略

| 层级 | 测试内容 | 工具 |
|------|---------|------|
| **编辑器单元测试** | 7 类编辑器各自的渲染、onChange、校验逻辑 | Vitest + Testing Library |
| **portSchemas 单测** | 每种节点的端口生成（含动态端口：配方 N 材料，含新增 variable/subgraph/loop/custom） | Vitest |
| **fieldSchemas 单测** | 字段条件显示逻辑（segmented 切换后字段显隐） | Vitest |
| **fieldTooltips 单测** | tooltip 文本覆盖所有字段 key，无遗漏 | Vitest |
| **NodeDetailForm 单测** | schema 驱动表单渲染 + condition 条件显示 + FieldLabel tooltip 渲染 | Vitest + Testing Library |
| **ErrorRecovery 单测** | 各类错误的修复建议渲染 + 一键修复回调 | Vitest + Testing Library |
| **useDrawerStore 单测** | openDrawer/updateField/saveDraft/cancelDraft 状态流转 + dirty 检测 + errors 校验 | Vitest + renderHook |
| **useNodeGraphStore 单测** | toggleCollapse/collapseAll/expandAll（已有 updateNode 不改名） | Vitest + renderHook |
| **McNodeShell 单测** | 折叠/展开渲染、端口渲染、调试高亮叠加 | Vitest + Testing Library |
| **connectionRules 单测** | `type`（PortType）匹配校验、multiple 限制 | Vitest |
| **模板系统单测** | 扩展后的 nodeGraphTemplates 模板点击创建节点、事件链模板创建多节点+连线 | Vitest + Testing Library |
| **OnboardingTour 单测** | 引导步骤推进、跳过、完成标记 localStorage | Vitest + Testing Library |
| **VariableNode 单测** | 变量端口生成、引用替换、编译为 Java 字段 | Vitest |
| **SubgraphNode 单测** | 子图封装、端口映射、嵌套、循环引用检测 | Vitest |
| **subgraphManager 单测** | register/get/list、序列化/反序列化、循环引用检测 | Vitest |
| **LoopNode 单测** | for/forEach/while 端口、循环体子图引用、编译为 Java 循环 | Vitest |
| **CustomNode 单测** | schema 驱动渲染、字段注入、代码模板 Mustache 渲染 | Vitest + Testing Library |
| **customNodeRegistry 单测** | 注册/导入/导出、schema 校验、重复 typeId 检测 | Vitest |
| **ResourceIdEditor 单测** | 外部 mod 命名空间下拉、path 自动补全 | Vitest + Testing Library |
| **集成测试** | 抽屉打开 → 编辑 → 保存 → node-graph-store 数据更新 → 画布刷新 | Vitest + Testing Library |
| **集成测试** | 折叠节点 → 连线仍可连 → 调试高亮在头部生效 | Vitest |
| **集成测试** | 模板创建 → 编辑 → 编译生成 mod | Vitest |
| **集成测试** | 子图封装 → 引用 → 修改子图 → 引用节点自动更新 | Vitest |
| **集成测试** | 新手引导全流程 → 完成标记写入 | Vitest + Testing Library |
| **快照测试** | 15 种节点（原 11 + 新 4）在「展开/折叠/选中/错误/警告/断点/调试中」7 种状态下的渲染 | Vitest snapshot |
| **E2E（可选）** | 拖入节点 → 双击打开抽屉 → 编辑 → 保存 → 看到画布更新 | Playwright |

---

## 18. 实现顺序

一次性重构，但内部按依赖顺序推进，避免循环依赖。分三个阶段：

### 阶段 A：UI 核心（基础可用）

1. **基础层**：`McNodeShell` + `McNodeHeader` + `McNodePort` + `McNodeSummary` + `portSchemas` + Tailwind 配色注册
2. **连线层**：`NodeGraphEditor` 改直角折线 + 端口标签校验扩展
3. **编辑器层**：7 类 MC 编辑器 + `NodeDetailForm` schema 驱动 + `fieldSchemas`
4. **抽屉层**：`NodeDetailDrawer` + `useDrawerStore`
5. **折叠层**：节点 `collapsed` 字段 + `useNodeGraphStore` 新 actions + 全部折叠/展开按钮
6. **11 种节点迁移**：每个节点改用 `McNodeShell` + 声明端口 schema + 摘要渲染
7. **阶段 A 测试补全**

### 阶段 B：下限提升（新手友好）

8. **字段 tooltip 层**：`fieldTooltips.ts` + `FieldLabel` 组件 + MC tooltip 浮层
9. **错误恢复层**：`ErrorRecovery` 组件 + 各编辑器接入修复建议
10. **模板库层**：`templateData.ts` + `TemplateCard` + `TemplateLibrary` 面板 + NodePalette 标签页
11. **新手引导层**：`onboardingSteps.ts` + `OnboardingTour` 组件 + localStorage 完成标记
12. **阶段 B 测试补全**

### 阶段 C：上限提升（高手能力）

13. **变量节点层**：`VariableNode` + 端口 schema + `NodeRefEditor` 变量引用支持 + 编译处理
14. **子图层**：`subgraphManager` + `SubgraphNode` + `SubgraphEditor` + 端口映射 + 循环引用检测
15. **循环节点层**：`LoopNode` + for/forEach/while + 循环体子图引用 + 编译处理
16. **自定义节点层**：`CustomNodeSchema` + `customNodeRegistry` + `CustomNode` + `CustomNodeImporter` + 代码模板 Mustache
17. **外部 mod API 层**：`ResourceIdEditor` 增强 + CodeNode import 增强 + 编译依赖处理
18. **阶段 C 测试补全**

### 全局收尾

19. **快照测试**：15 种节点 × 7 种状态
20. **集成测试**：端到端流程
21. **向后兼容验证**：旧 JSON 加载 + 调试器 + a11y 适配

---

## 19. 兼容性

- **现有节点图 JSON**：旧 JSON 没有 `collapsed` 字段，加载时默认 `false`（`safeDeserializeGraph` 兼容）
- **现有连线**：edge kind 保持不变，只是渲染样式改直角折线
- **现有调试器**：调试高亮逻辑适配折叠状态，不断点
- **现有 a11y**：`LiveRegion` 朗读选中节点时包含折叠状态（「物品节点，已折叠」）
- **现有持久化**：`nodeGraphSerializer` 序列化时包含 `collapsed` 字段
- **新增节点类型**：variable/subgraph/loop/custom 是新 NodeKind，旧 JSON 不含这些类型的节点，向前兼容
- **子图序列化**：`subgraphs` 字段加入 NodeGraph，旧 JSON 没有该字段时默认空对象
- **自定义节点 schema**：自定义节点 typeId 不存在时（用户未导入），SubgraphNode/CustomNode 显示「⚠ 自定义类型未注册」提示，不崩溃
- **外部 mod API**：外部 mod 未安装时，ResourceIdEditor 的命名空间下拉不显示该 mod；编译时提示依赖缺失

---

## 20. 风险与缓解

| 风险 | 缓解 |
|------|------|
| 15 种节点迁移工作量大（原 11 + 新 4） | `McNodeShell` 抽象到位后，每种节点只需写摘要渲染 + 端口 schema，约 30-50 行/个 |
| 7 类编辑器复杂度（NbtEditor 尤其） | NbtEditor 可先做基础版（string/int/compound），复杂类型后续迭代 |
| 抽屉草稿与 store 同步出错 | 严格单向数据流：store → draft（打开时拷贝）→ 编辑 → draft → store（保存时写回），draft 不直接反向同步 store |
| 折叠状态端口布局错位 | 折叠时端口移到头部底边，用绝对定位保证位置稳定 |
| 像素字体加载 | 优先用系统等宽字体降级，Press Start 2P 作为渐进增强 |
| 子图循环引用导致死循环 | `subgraphManager` 创建时做 DFS 检测引用链成环，阻止创建 |
| 自定义节点代码模板注入安全 | Mustache 只做字段值替换，不做代码执行；字段值做转义防止 Java 注入 |
| 外部 mod API 依赖管理复杂 | 编译时才检测依赖，编辑时不阻塞；缺失依赖只报编译错误，不阻断 UI |
| 新手引导遮挡操作 | 引导浮层有「跳过」按钮，且只首次显示；手动触发需点「?」按钮 |
| 模板库维护成本 | 模板用 JSON 数据驱动，新增模板只需加数据条目，不改组件 |
| 阶段 C 功能（子图/循环/自定义）编译复杂度高 | 编译器扩展分步：先支持变量编译，再子图内联展开，最后循环展开；每步独立可测 |
| 一次性重构范围过大 | 分三阶段（A/B/C）推进，每阶段独立可用且可测，阶段间不阻塞 |

---

## 21. 验收标准

### 阶段 A：UI 核心

- [ ] 15 种节点（原 11 + 新 variable/subgraph/loop/custom）全部使用 `McNodeShell`，视觉统一为 MC 风格（3D 凸起头部 + 降饱和配色 + 像素字体 + 石质纹理 + 凹陷端口）
- [ ] 所有节点按 `portSchemas` 渲染全标签端口（含动态端口：配方 N 材料）
- [ ] 连线改为直角折线，颜色按 edge kind 区分，hover/选中高亮
- [ ] 右侧抽屉可双击/点⚙打开，7 类 MC 编辑器全部可用
- [ ] 字段条件显示正确（segmented 切换后字段显隐）
- [ ] 抽屉草稿模式工作：编辑不立即生效，保存才写回，取消丢弃，未保存关闭弹确认
- [ ] 折叠展开工作：折叠只留头部 + 端口，端口移到头部底边
- [ ] 全部折叠/全部展开按钮可用
- [ ] 折叠状态下调试高亮/断点标记在头部生效

### 阶段 B：下限提升

- [ ] 字段 tooltip：每个字段旁 ? 图标，hover 显示 MC 领域解释（覆盖所有字段 key）
- [ ] 错误恢复提示：校验失败显示修复建议，数值超限有「一键修复」按钮
- [ ] 模板库：NodePalette 上方「模板」标签页，点击创建预配置节点（含事件链多节点+连线）
- [ ] 新手引导：首次打开分步引导，可跳过，完成后 localStorage 标记不再自动显示

### 阶段 C：上限提升

- [ ] 变量节点：可定义 int/double/string/boolean/item/block 变量，其他节点可引用，编译为 Java 字段
- [ ] 子图节点：选中多节点可封装为子图，双击进入子图编辑，支持嵌套，循环引用检测生效
- [ ] 循环节点：for/forEach/while 三种模式，循环体可连子图或动作，编译为 Java 循环，调试支持迭代断点
- [ ] 自定义节点：JSON schema 定义端口和字段，代码模板 Mustache 注入，可导入导出
- [ ] 外部 mod API：ResourceIdEditor 可选外部 mod 命名空间，CodeNode 支持 import 外部 mod 类，编译时检测依赖

### 全局

- [ ] 现有节点图 JSON 向后兼容（无 `collapsed`/`subgraphs` 字段时默认值，不崩溃）
- [ ] 测试通过：编辑器单测、portSchemas 单测、useDrawerStore 单测、McNodeShell 单测、TemplateLibrary 单测、OnboardingTour 单测、VariableNode/SubgraphNode/LoopNode/CustomNode 单测、subgraphManager/customNodeRegistry 单测、集成测试、15 节点 × 7 状态快照测试
