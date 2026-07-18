# UI 面板重构设计

> 日期：2026-07-17
> 状态：已确认，待实施

## 背景与问题

当前 MC Creator 的 UI 面板存在以下问题：

1. **AgentPanel 是"上帝组件"（753 行，6 大职责）**：项目菜单 + 全局设置 + 描述输入/生成 + Spec 编辑 + 构建 + AI 聊天全堆在一个组件里。
2. **AgentPanel 与 BuildPanel 大量重复**：`build()`/`buildStream()` 函数几乎逐行相同，`extractJarPath()`/`renderLog()` 完全相同，构建日志和结果显示两边都有。
3. **4 个废弃组件**：`ChatPanel.tsx`(267行)、`AiChat.tsx`、`TopBar.tsx`(236行)、`McUiShowcase.tsx` 无人 import。
4. **API Key 无法配置（严重功能缺失）**：`SettingsPanel.tsx`（含模型配置 + CurseForge 配置）只被废弃的 TopBar 引用 → 间接废弃。`LayoutConfig`（settings activity）只有布局/主题。用户当前无法通过 UI 配置 AI API Key。
5. **左栏 8 个 activity 分类不清**：工具类(explorer/search/git/packages) + 学习器(learn) + 编辑器(items/blocks) + 设置(settings) 混在一起。LayoutLearner 与 MC mod 创作无关。

## 方案：顶部栏 + 三栏布局

```
┌──────────────────────────────────────────────────┐
│ TopToolbar (h-12)                                 │  ← 项目菜单 | 类型/Loader/版本 | API状态
├──┬──────────┬─────────────────┬──────────────────┤
│A │ 左栏      │ 中栏             │ 右栏              │
│c │ (可切换)  │ TabBar           │ AgentPanel       │
│t │          │ CodePreview      │ ┌描述输入────────┐│
│i │ explorer │ BuildPanel       │ │ 生成Spec/代码  ││
│v │ search   │ (构建+部署)       │ ├Spec编辑──────┤│
│i │ git      │                  │ │ Monaco编辑器  ││
│t │ packages │                  │ ├AI聊天────────┤│
│y │ items    │                  │ │ 消息+输入框   ││
│  │ blocks   │                  │ └──────────────┘│
│  │ settings │                  │                  │
└──┴──────────┴─────────────────┴──────────────────┘
```

## 组件变更清单

### 删除（5 个废弃组件）

| 文件                | 行数 | 原因                                          |
| ------------------- | ---- | --------------------------------------------- |
| `ChatPanel.tsx`     | 267  | 与 AgentPanel 描述/Spec 功能重复，无人 import |
| `AiChat.tsx`        | ~50  | 无人 import                                   |
| `TopBar.tsx`        | 236  | 无人 import                                   |
| `McUiShowcase.tsx`  | ~100 | demo 组件，无人 import                        |
| `LayoutLearner.tsx` | ~200 | 与 MC mod 创作无关，用户决定移除              |

### 新增（2 个组件）

#### `TopToolbar.tsx`（~120 行）

顶部工具栏，从 AgentPanel 抽出：

- 项目菜单（新建/导入/保存/切换项目）
- 全局设置（类型/Loader/版本 下拉框）
- API Key 状态指示（已配置/未配置，点击跳转 settings）

**Store 访问**：useProjectStore(项目) + useModStore(类型/Loader/版本) + useModelConfigStore(API状态)

#### `SettingsPanel.tsx`（重写，~250 行）

settings activity 面板，分 3 个 tab：

- tab1 **模型配置**：API Key / 模型 / baseURL + 预设(OpenAI/DeepSeek/通义/智谱/Ollama/LM Studio)
- tab2 **CurseForge**：API Key 配置
- tab3 **外观**：布局预设 + 面板尺寸滑块 + 主题颜色（从 LayoutConfig 迁移）

**数据来源**：useModelConfigStore + ipcClient(CurseForge) + props(布局宽度) + localStorage(主题)

### 修改（4 个组件）

#### `AgentPanel.tsx`（753 → ~300 行）

删除：

- 项目菜单（→ TopToolbar）
- 全局设置 类型/Loader/版本（→ TopToolbar）
- 构建区块：build/buildStream 函数、streamLog/streamBuilding 状态、构建日志显示、修复记录显示（→ 已在 BuildPanel）
- `extractJarPath`/`renderLog` 辅助函数（→ build-utils.ts）

保留：

- 描述输入 + 生成Spec/生成代码按钮
- 模板选择 / Modrinth搜索 / CurseForge搜索入口
- Spec 编辑（Monaco）
- AI 助手聊天

#### `BuildPanel.tsx`（~280 行，基本不变）

- 保留全部构建 + 部署逻辑
- `extractJarPath`/`renderLog` 改为从 `lib/build-utils.ts` import（消除重复）

#### `ActivityBar.tsx`（~80 行）

- 移除 `learn` activity（LayoutLearner 已删）
- 活动数 8 → 7：explorer/search/git/packages/items/blocks + settings(底部)

#### `App.tsx`

- 新增 `<TopToolbar />` 在三栏布局上方
- `renderActivityPanel` 的 `case 'settings'` 改为渲染新 SettingsPanel
- 移除 LayoutLearner/LayoutConfig 的 import 和 case

### 新增工具模块

#### `lib/build-utils.ts`

提取 BuildPanel 和 AgentPanel 重复的纯函数：

```typescript
export function extractJarPath(log: string): string | null;
export function renderLog(log: string): ReactNode;
```

## 数据流

```
TopToolbar ──→ useProjectStore (项目 CRUD)
           ──→ useModStore (类型/Loader/版本)
           ──→ useModelConfigStore (API状态指示)

AgentPanel ──→ useModStore (描述/spec/files/loading)
           ──→ useModelConfigStore (apiKey)
           ──→ useProjectStore (保存项目)
           ──→ ipcClient (生成Spec/生成文件/聊天流)

BuildPanel ──→ useModStore (files/buildLog/buildSuccess/fixLog)
           ──→ ipcClient (构建/部署/启动)

SettingsPanel ──→ useModelConfigStore (模型配置)
              ──→ ipcClient (CurseForge配置读写)
              ──→ props (布局宽度)
              ──→ localStorage (主题)
```

## App.tsx 布局结构

```tsx
<div className="flex h-screen flex-col bg-mc-bg text-mc-text font-sans">
  <div className="h-[3px] w-full bg-mc-accent" /> {/* 品牌识别线 */}
  <TopToolbar /> {/* 新增 */}
  <div className="flex flex-1 overflow-hidden">
    <ActivityBar active={activeActivity} onChange={setActiveActivity} onHome={backToDashboard} />
    <aside style={{ width: leftWidth }}>
      {renderActivityPanel()} {/* settings case 渲染新 SettingsPanel */}
    </aside>
    <Splitter onResize={handleLeftResize} />
    <main className="flex flex-1 flex-col">
      <TabBar />
      <CodePreview />
      <BuildPanel />
    </main>
    <Splitter onResize={handleRightResize} />
    <aside style={{ width: rightWidth }}>
      <AgentPanel /> {/* 瘦身后的 AgentPanel */}
    </aside>
  </div>
</div>
```

## 实施顺序

1. **提取共享逻辑**：新建 `lib/build-utils.ts`，BuildPanel 引用
2. **新建 TopToolbar**：从 AgentPanel 抽出项目菜单 + 全局设置
3. **新建 SettingsPanel**：合并模型配置 + CurseForge + 外观(从 LayoutConfig 迁移)
4. **瘦身 AgentPanel**：删除项目菜单/全局设置/构建区块
5. **修改 ActivityBar**：移除 learn activity
6. **修改 App.tsx**：集成 TopToolbar + 新 SettingsPanel，移除 LayoutLearner/LayoutConfig
7. **删除 5 个废弃组件**
8. **验证**：typecheck + 测试 + noUnusedLocals 扫描

## 验证标准

- typecheck 0 错误（node + web）
- 现有 260 测试全通过
- noUnusedLocals/noUnusedParameters 0 错误
- AgentPanel 行数 ≤ 350
- TopToolbar 行数 ≤ 150
- SettingsPanel 行数 ≤ 300
- 删除 5 个废弃文件后无 import 断裂
