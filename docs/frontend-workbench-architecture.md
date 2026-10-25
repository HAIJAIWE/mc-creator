# 前端工作台架构重构设计（面板装配与导航）

> 状态：**阶段 0–9 全部完成** · 2026-10-10
> （构建入口恢复、归属表派生、`workbench-store`、DomainTabs、PanelHost 收敛、
> Monaco 体积优化、死代码清理、a11y 全绿）
> 上游文档：`docs/design-v3.1.md` §0.2（三域并列 + 智能体横向贯穿）、§2（总体架构）
> 前序重构：`docs/superpowers/specs/2026-07-17-panel-refactor-design.md`
> 本文档只覆盖**前端外壳的面板装配与导航层**；内核分层（§2.2 设计原则）不在本次范围。

---

## 1. 问题陈述

重构前的前端存在多处结构性缺陷，均可复现。

### 1.0 缺陷总览（按严重度）

| 级别    | 问题                                             | 影响                                   |
| ------- | ------------------------------------------------ | -------------------------------------- |
| ✅ 已修 | ~~构建/部署 UI 不可达~~（§1.5.1）                | 阶段 0A 完成                           |
| ✅ 已修 | ~~`packages` 弹回 bug~~（§1.4 / D2）             | 阶段 2 完成，改为跟随切域              |
| ✅ 已修 | ~~死代码 8 文件 / 60.8 KB~~（§1.5.2）            | 减 1613 行 / 54.1 KB                   |
| 🔴 P0   | 8 / 17 面板不可达（§1.3）                        | 7 个业务面板点不到                     |
| 🔴 P0   | `nbt` 面板是空壳：编辑不落盘（§1.6.1）           | 数据静默丢失                           |
| 🔴 P0   | 预览面板每次重渲染被整体重建（§1.6.2）           | 按 F1 就丢预览状态                     |
| 🟠 P1   | 两套并行装配机制，一套是死代码（§1.1）           | 新增面板需改两处                       |
| ✅ 已修 | ~~`explorer` 有三份实现~~（§1.6.3）              | 按 IDE 约定统一为 `FileTree`           |
| 🟠 P1   | `MiddlePanel` 静态拖入 4 个 Monaco 组件（D4 R1） | 首次进预览加载 142 文件                |
| 🟠 P1   | `MIDDLE_PANEL_IDS` 悬空（§1.4）                  | 3 个 id 声明但从未注册                 |
| 🟠 P1   | `MainPanelView` 零测试（§1.6.6）                 | 221 行 / 17 case 无回归网              |
| 🟡 P2   | 可达性无断言（§1.4）                             | 已由 `panel-reachability.test.ts` 补上 |
| 🟡 P2   | `chat-store` 是从未兑现的 bug 修复（§1.6.4）     | 聊天记录照样丢失                       |
| 🟡 P2   | `PromptDialog` 完整但没人挂载（§1.6.5）          | 13+ 处仍用原生弹窗                     |
| 🟢 P3   | 缺底部面板与状态栏（§1.8）                       | 状态栏已补（§1.9）；底部面板待定       |

### 1.1 两套并行的面板装配机制，其中一套是死代码

| 路径       | 组成                                                          | 使用情况   |
| ---------- | ------------------------------------------------------------- | ---------- |
| 注册表路径 | `register-all-panels.ts` + `panels.tsx` + `PanelHost`         | **零调用** |
| 直连路径   | `App.tsx` → `MainPanelView` → 16 个硬编码 `lazy()` + `switch` | 实际运行   |

`PanelHost` / `PanelHostList` 有完整实现与单测（含 hook 顺序陷阱的处理，见 `PanelHost.tsx:26-40`），
但整个 renderer 内**没有任何调用点**。

这是域面板失效的根因：域归属逻辑写在**没被执行的**那条路径上。

### 1.2 两个正交分类并存，导航层只消费其中一个

- `PanelKind`（`core` / `domain` / `middle`）——`ActivityBar` 按它过滤，因此只渲染 `core`
- `DomainId`（`launcher` / `server` / `dev`）——可达性由它决定，但每域只暴露一个 `defaultPanelId`

`domains.ts:37` 自身注释即写明「**归属与 PanelKind 正交**」，故 `PanelKind` 不应充当导航真源；
而导航层恰恰在用它。断层由此产生。

### 1.3 后果：8 / 16 个已注册面板在 UI 上不可达

`activeLeftPanel` 的全部写入点只有三处：初始值（`defaultPanelOfDomain`）、
`ActivityBar.onChange`（仅 `core` 组）、`TopToolbar`（仅 `settings`）。

| 域         | 可达                                                | 不可达                                         |
| ---------- | --------------------------------------------------- | ---------------------------------------------- |
| `launcher` | `game`                                              | `skin`                                         |
| `server`   | `kernel`                                            | `resources`、`nbt`                             |
| `dev`      | `items`                                             | `blocks`、`entity`、`audio`、`cicd`、`preview` |
| common     | `explorer`、`search`、`git`、`packages`、`settings` | —                                              |

即**方块编辑器、实体 AI 编辑器、音效、构建流水线、资源包预览、NBT 编辑器、皮肤预览**
共 7 个业务面板已注册、有 `MainPanelView` 分支、组件代码完整，但用户点不到。

`ActivityBar.tsx:22-24` 注释称这些面板「入口在中部面板」——该入口并不存在。

### 1.4 附带缺陷

- **`packages` 弹回 bug**：`packages` 同时属 `PanelKind.core`（进活动栏）与 `DomainId.launcher`。
  用户在 `dev` 域点击活动栏的 `packages` → `isCommonPanel('packages')` 为 `false`
  （`COMMON_PANEL_IDS` 不含它）→ `domainOfPanel` 得 `'launcher'` ≠ `'dev'`
  → `App.tsx:91-93` 纠偏将其弹回 `items`。该按钮在 `dev`/`server` 域内失效。
- **`MIDDLE_PANEL_IDS` 悬空**：`panels.tsx:98` 声明 `['preview','lowcode','purecode','code']`，
  其中 `lowcode`/`purecode`/`code` 从未注册，`MainPanelView` 亦无对应分支，
  一旦激活将渲染「未知面板」。反之已注册的 `resources`/`nbt`/`kernel` 不在该列表内。
- **测试盲区**：`domains.test.ts` 断言 17 个面板「不重不漏」，但只校验**归属表完整性**，
  不校验**可达性**，故 1.3 的 8 个不可达面板反而被该测试守住。
  已由阶段 0A 新增的 `shell/panel-reachability.test.ts` 补上（I3）。

### 1.5 构建/部署 UI 不可达（P0）+ 死代码清单

#### 1.5.1 构建能力断在最后一环

`2026-07-17-panel-refactor-design.md:87` 记载「`BuildPanel.tsx` 保留全部构建 + 部署逻辑」，
并把 `AgentPanel` 的构建区块迁往该面板（`spec:77-78`）。

现状核实结果——**三层里只有 UI 层断了**：

| 层       | 位置                                          | 状态                                                             |
| -------- | --------------------------------------------- | ---------------------------------------------------------------- |
| 后端     | `main/ipc/build.ts` · `registerBuildHandlers` | ✅ 已注册（`main/ipc/ipc.ts:31`）                                |
| IPC 通道 | `BUILD_STREAM` / `BUILD_STREAM_CHUNK`         | ✅ 有实现与测试（`build-stream.test.ts`）                        |
| 状态层   | `mod-store.ts:77-78,100,391-394`              | ✅ `buildLog` / `buildSuccess` / `buildStats` / `setBuildResult` |
| **UI**   | **`components/BuildPanel.tsx`（18.8 KB）**    | ❌ **零引用**（修复前）                                          |

即：构建能力已完整实现，但**没有任何界面能触发它**，用户改完 Spec 无法产出产物。
这是本次重构中**唯一的功能缺失级缺陷**（其余为「功能存在但入口缺失」）。

> 核实方式：全仓库检索 `BuildPanel` 的 import；`SettingsPanel.tsx:156-157` 的命中经确认为
> 注释文本而非 import。

##### 修复（阶段 0A，2026-10-09）

`BuildPanel` 已注册为 `build` 面板，归 `dev` 域，`order 95`（紧随 `cicd`）：

| 文件                                         | 改动                                                             |
| -------------------------------------------- | ---------------------------------------------------------------- |
| `shell/register-all-panels.ts`               | loader + `allPanelConfigs` 条目，图标 `pixel/anvil`              |
| `shell/domains.ts`                           | `dev.panelIds` 插入 `'build'`；`knownPanelIds` 随之派生（16→17） |
| `components/MainPanelView.tsx`               | `lazy()` + `case 'build'`（当时唯一在跑的装配路径）              |
| `i18n/zh.json`、`i18n/en-US.json`            | `activityBar.build`、`topToolbar.build`                          |
| `components/TopToolbar.tsx` + `App.tsx`      | 新增「构建」按钮，`canOpenBuild={domain === 'dev'}`              |
| `components/BuildPanel.integration.test.tsx` | 新增 7 例接线测试                                                |
| `components/TopToolbar.test.tsx`             | 新增 5 例，锁定构建按钮的显隐与回调                              |
| `shell/panel-reachability.test.ts`           | 新增 I3 可达性不变式测试（见下）                                 |

之所以**没有并入 `cicd`**：`CiCdPanel` 实际只生成远程流水线 YAML
（GitHub Actions / GitLab CI / Jenkinsfile），不调用本机 gradle。
两者语义不同，合并会让「本地出 jar」这个动作被埋进一个纯配置生成器里。
`domains.ts` 原有描述「构建与产出流水线」因此是不准确的，已在该处加注释澄清。

##### 「注册了」不等于「可达」——本阶段踩的坑

第一版修复只做了上表前四行（注册 + 渲染分支），据此判定 P0 已闭环。
**这个判断是错的**：复查 `activeLeftPanel` 的全部写入点后发现只有三处——
初始值、`ActivityBar.onChange`（只喂 `core` 组）、`TopToolbar`（只认 `settings`）——
域面板在阶段 4 的 `DomainTabs` 落地前**一个入口都没有**。
`build` 注册了照样点不到，与它此前的死法完全一致。

这正是 §1.1「注册 ≠ 可达」这个结构性缺陷的又一次复现，
也是为什么 I3 必须写成可执行测试而不是文档里的一句话。

补的入口是 `TopToolbar` 的「构建」按钮，理由：

- VS Code 标题栏有 build 按钮、IntelliJ 菜单栏有 Build，是 IDE 通用范式，
  与本项目「中栏向 IDE 形态靠拢」的方向一致，不是权宜之计；
- 按钮**仅在 `dev` 域展示**。`build` 只归属 `dev`，在别的域展示会被
  `App.tsx:91-93` 的纠偏 effect 弹回默认面板，变成假入口；
- 阶段 4 的 `DomainTabs` 落地后它与 tab 条并存不冲突，倾向于保留。

##### I3 不变式测试

`shell/panel-reachability.test.ts` 把可达性建模成可执行断言：
逐一还原 `activeLeftPanel` 的三个写入点，取并集作为可达集。

严格版断言用 **`it.fails`** 而非留一条红测试——红测试会阻塞提交，
久而久之必然被跳过或删除（当初 8 个不可达面板正是被 `domains.test.ts`
以同样的方式守成了「合法」）。`it.fails` 让现状可见且不阻塞，
且在阶段 4 真正修好后会**自己变红**，提醒摘掉 `.fails`。

另有一份「现状快照」用例显式列出当前不可达的 8 个 id，
阶段 4 改动可达集时它会立刻指出差异。

> 已知局限：`TOOLBAR_PANEL_IDS` 是模型里唯一无法从代码派生的部分——
> 工具栏跳转目标是 `App.tsx` 闭包里的字面量，没有注册表记录「哪个 UI 激活哪个面板」。
> 阶段 3 引入 `workbench-store` 后该映射变成数据，此常量即可删除。

#### 1.5.2 死代码清理（已完成：8 文件 / 1613 行 / 54.1 KB）

**已删除**

| 文件                                                          | 行数 | 说明                                       |
| ------------------------------------------------------------- | ---- | ------------------------------------------ |
| `lib/a11yAudit.ts` + `.test.ts`                               | 584  | a11y 审计工具（测试孤儿）                  |
| `components/TerminalPanel.tsx`                                | 286  | 终端（唯一真正完全死的）                   |
| `components/lowcode/nodes/VerticalCoreNode.tsx` + `.test.tsx` | 354  | 节点组件未注册进 node-registry（测试孤儿） |
| `store/chat-store.ts` + `.test.ts`                            | 161  | 见 §1.6.4，功能从没接上线                  |
| `components/CommandPalette.utils.ts`                          | 228  | 工具函数有测试，生产未接线                 |

> `CommandPalette.test.tsx` 连带删 1 个用例（`MC_COMMAND_TEMPLATES` 前缀断言）。

**前提被证伪的地方**：原判定「完全死（生产 + 测试均无引用）」的三条**全都带测试文件**
—— `a11yAudit.test.ts`(28 例)、`chat-store.test.ts`(7 例)、`VerticalCoreNode.test.tsx`(12 例)。
即 A 组与 B 组其实是同一类（测试孤儿），造成"假绿"。**A/B 两分法本身是错的**：
真正的判据是「生产代码有无引用」，测试引用只决定删除时要连带改什么。

**保留：`components/PromptDialog.tsx`** —— 它不是死代码，是**漏挂的待接线实现**，
详见 §1.6.5。删掉等于删掉一个正确实现去迁就一个错误的分类。

**删除 `VerticalCoreNode` 的连带后果**：`packages/shared` 的 `nodeRegistry`
（`custom-node-schema.ts:104-142`）失去唯一消费者，变成孤儿。
它是 `@mc-creator/shared` 的公开导出，需单独决策，暂未动。

### 1.6 核查新发现（2026-10-09，阶段 1 过程中）

阶段 1（注册表派生）期间做了一次中栏重复实现的只读核查，产出若干**先前未知**的缺陷。
其中两条是真 bug，不属于「入口缺失」而是「功能已坏」。

| 级别 | 问题                                                     | 影响                                                     |
| ---- | -------------------------------------------------------- | -------------------------------------------------------- |
| 🔴   | **`nbt` 面板是空壳**（§1.6.1）                           | 打开永远是空 compound，**编辑不落盘**                    |
| 🔴   | **预览面板每次重渲染被整体重建**（§1.6.2）               | 在预览 tab 按 F1 就丢展开行/选中/滚动位置                |
| ✅   | ~~`explorer` 有**三份**实现~~（§1.6.3）                  | 按 IDE 约定统一为 `FileTree`；变异测试确认有效           |
| 🟠   | `MiddlePanel` 静态拖入 4 个 Monaco 组件 → 171 文件模块图 | 首次进预览就加载 142 文件的低代码体系                    |
| 🟠   | `MainPanelView` 测试缺口                                 | 原零测试；现已补 explorer 3 例，余 16 个 case 仍无回归网 |
| 🟡   | `chat-store` 是**从未兑现的 bug 修复**（§1.6.4）         | store 写了测了 persist 了，没人用                        |
| 🟡   | `PromptDialog` 完整但没人挂载（§1.6.5）                  | 13+ 处仍在用原生 `window.prompt/confirm`                 |
| 🟡   | `nodeRegistry` 因删 `VerticalCoreNode` 变成孤儿          | `@mc-creator/shared` 的公开导出，无调用方                |

#### 1.6.1 `nbt` 面板是空壳（真 bug）

两处实现**不等价**，这是全部 17 个面板里唯一的实质分歧：

| 实现                      | 代码                                                            | 后果                                                      |
| ------------------------- | --------------------------------------------------------------- | --------------------------------------------------------- |
| `MiddlePanel.tsx:355-365` | `<NbtEditor initialValue={…读 mod-store…} onChange={…写回…} />` | 完整可用                                                  |
| `MainPanelView.tsx:207`   | `<NbtEditor />`（**不传任何 prop**）                            | `initialValue` 取默认值 `'{}'`、`onChange` 为 `undefined` |

即：**面板路径上的 NBT 编辑器永远显示空 compound，且所有编辑不落盘。**

这条恰好说明了为什么「先合并还是先修可达性」的排序要小心 ——
`nbt` 当前**不可达**（§1.3），所以这个 bug 暂时被掩盖；
一旦按 D1 把它接进 `PanelHost`，走的是注册表路径，**必须先补 props 接线**，
否则「修复可达性」会顺带把它从「不可达的坏面板」变成「可达的坏面板」。

> 根因：`PanelHost` 只做 `{...panelProps}` 透传，无法表达「从 mod-store 现场算 initialValue」。
> 修法二选一：把这段 IIFE 上提成带 props 的包装组件，或把接线逻辑搬进 `NbtEditor` 内部。

#### 1.6.2 预览面板每次重渲染被整体重建（真 bug）

`MiddlePanel.tsx:60` 在**渲染期**调用 `lazy(registration.component)`：

```
function RenderPreviewPanel({ generatorType }) {
  const registration = getPreviewPanel(generatorType);
  const LazyPreview = lazy(PreviewComponent);   // ← 每次渲染都是新对象
  return <Suspense ...><LazyPreview /></Suspense>;
}
```

React 靠 `elementType` 引用比较判断是否复用，新对象 ≠ 旧对象 →
**整棵预览子树卸载重建**，并重进一次 `Suspense` fallback。

触发条件极宽：`MiddlePanel` 任一 state 变化即重渲染 ——
`paletteOpen` / `shortcutHelpOpen` / `middleTab` / `generatorType` / `editorMode`。
最典型的用户可感知后果：**在预览 tab 按 F1 打开命令面板，预览的展开行 / 选中行 / 滚动位置全部丢失。**

顺带说明：`lazy()` 在这里**收益为零** —— `RenderPreviewPanel` 只在 `middleTab === 'preview'`
时被调用，tab 不激活时组件根本不渲染，registry loader 的 `import()` 也不会触发。

修法：`useMemo(() => lazy(registration.component), [registration])`，或去掉 `lazy()` 直接渲染。

#### 1.6.3 `explorer` 有三份实现 —— ✅ 已裁决并修复

| 位置                                     | 渲染什么                                      | 裁决后         |
| ---------------------------------------- | --------------------------------------------- | -------------- |
| `App.tsx` 左栏固定                       | `FileTree`                                    | 不变           |
| `MainPanelView.tsx` 的 `case 'explorer'` | 有选中文件 → `CodePreview`；否则 `EmptyPanel` | **`FileTree`** |
| 注册表 `explorer` loader                 | `FileTree`                                    | 不变           |

三处现在渲染同一棵树 —— 矛盾不是被「选一边」，而是**这个面板本来就不该有两种形态**。

**裁决依据：IDE 的 View / Editor 区分**（2026-10-09 查证 VS Code 与 IntelliJ 官方文档）

两者架构同构：

| 概念                | 位置               | VS Code                                             | IntelliJ                                  |
| ------------------- | ------------------ | --------------------------------------------------- | ----------------------------------------- |
| **View**（树/列表） | 侧栏 / tool window | Explorer、Search、Source Control、Outline、Timeline | Project、Structure、Find、Version Control |
| **Editor**（文档）  | 编辑器区 + tab 条  | Editor + tab bar                                    | Editor + editor tabs                      |
| **Panel**           | 编辑器下方         | Panel（output / debug / errors / terminal）         | 底部 tool windows                         |
| **Status Bar**      | 底部               | Status Bar                                          | status bar                                |

核心规则：**文件树永远不显示文件内容。**

- VS Code 官方表述：_"an explorer on the left, showing all of the files and folders you have
  access to, and **an editor on the right, showing the content of the files you have opened**"_，
  以及 _"When you open another file, the editor that is active will display the content of that file."_
- IntelliJ：从 Project 树选中代码项后按 <kbd>F4</kbd> 才会送到 editor
  （_「press F4 to open the corresponding file and locate this item in the editor」_）。

旧实现把内容放在树的位置，等于把 View 与 Editor 糊成一个概念。

**顺带确认两件「看起来像问题但其实不是」的事**：

1. `search` / `git` 作为中栏面板**合规** —— VS Code 支持把侧栏 view「最大化」到编辑器区
   （`View: Toggle Maximized View`），也支持把 view 拖进编辑器区当 tab。
   它们属于「被最大化的 view」，不必迁回左栏。
2. 文件内容的正确去处已经存在：`MiddlePanel` 的 `code` tab = `<TabBar />`（打开文件 tab 条）
   - `<CodePreview />`，正是 IDE 编辑器区的标准结构。
     所以 `explorer` 分支**不需要**渲染内容，也不该重复 import `CodePreview`。

**回归网**：新增 `components/MainPanelView.test.tsx`（3 例）断言
「explorer 恒渲染 `FileTree`、恒不渲染 `CodePreview`」，含「有选中文件时」这一原缺陷触发条件。
已做变异验证：把分支改回 `CodePreview` → **3 failed**，还原 → **3 passed**。

> 附带收益：`MainPanelView` 此前**零测试**（221 行 / 17 个 case），现在有了第一个测试文件。
> 阶段 4 删 switch 前仍需补齐其余 16 个 case 的回归网。

#### 1.6.4 `chat-store` 是一个从未兑现的 bug 修复

`chat-store.ts` 的注释写明它存在的目的是「让 chat 模式切到 agent 再切回时对话历史不丢失」。
而 `AgentPanel.tsx:104` 至今仍是组件内 `useState`：

```ts
const [agentMode, setAgentMode] = useState<'chat' | 'agent'>('agent');
const [messages, setMessages] = useState<Msg>([...]);
```

模式切换按钮确实存在（`AgentPanel.tsx:617`），但 **用户切到 agent 再切回，聊天记录照样丢失**。
store 写好了、测好了、persist 到 localStorage 了，然后没人用。

这不是「死代码」，是「**功能从没被接上线**」—— 与 `BuildPanel` 同类，但严重度低得多
（丢的是聊天记录，不是产出物）。

#### 1.6.5 `PromptDialog` 完整但没人挂载

它实现了 `window.prompt/confirm` 的替代品，功能完备（焦点陷阱、Esc/Enter、danger 模式、
axe 扫描全绿），**唯一缺陷就是没人挂载它**。而生产代码里还有 13+ 处仍在用原生弹窗：
`FileTree.tsx`(4)、`NodeGraphEditor.tsx`(2)、`LowcodeWorkspace.tsx`(2)、`NodePalette.tsx`、
`OutlinePanel.tsx`、`SpecHistoryPanel.tsx`(2)、`CodeNodeEditor.tsx`、`Dashboard.tsx`、
`DemoteButton.tsx`、`DemoteToLowcodeButton.tsx`、`NodeDetailDrawer.tsx`。

删掉它等于删掉一个待接线的正确实现，故保留（阶段 0A 已决定）。

#### 1.6.6 其他

- **`MainPanelView` 零测试**：221 行、17 个 case、3 种不同 fallback 文案、1 个域感知空态分支，
  全部无覆盖。原计划阶段 2 的验证手段只有 I2/I4 两条结构性断言，
  **没有一条能证明迁移前后渲染结果一致** —— 缺少回归网。
- **三套 loading UI**：`MainPanelView.PanelLoading`（"加载面板中…"，`h-full` 无 `bg`）、
  `PanelHost.PanelLoadingFallback`（"加载面板…"，`bg-mc-bg text-mc-dim`）、
  `MiddlePanel.PreviewPanelFallback`（"加载预览…"，`bg-mc-bg text-mc-mute`）。合并会视觉回归。
- **`MainPanelView` 有全局短路**：`if (!currentProjectId) return <EmptyPanel …>` 早于所有 case，
  对全部 17 个面板生效，`PanelHost` 侧没有等价物 —— 迁移时最容易漏的一层。
- **两处过时注释**：`packages/shared/src/schemas/custom-node-schema.ts:104,130`
  仍写 "for VerticalCoreNode"（组件已删）；`apps/desktop/vite.renderer-preview.config.ts:63`
  仍写 "与 TerminalPanel 的 useEffect 期望一致"（组件已删）。

### 1.7 归属表改派生（已实施）

`domains.ts` 原先手写两份列表：`DomainDefinition.panelIds` 与 `COMMON_PANEL_IDS`。
这意味着**新增面板要改两个地方**，而漏改不会立刻报错 —— 它只会让面板静默失联。
阶段 0A 恢复 `build` 构建入口时就被这个坑绊了一次：
注册表加了 `build`，忘了同步 `panelIds`，`domains.test.ts` 的「不重不漏」断言当场变红。

现在归属的真源是**注册表里的 `PanelRegistration.domain` 字段**：

| 原手写                      | 现派生                                               |
| --------------------------- | ---------------------------------------------------- |
| `DomainDefinition.panelIds` | `panelsOfDomain(d)` = 注册表里 `domain === d` 的面板 |
| `COMMON_PANEL_IDS`          | `commonPanelIds()` = `domain === null` 的面板        |
| `KNOWN_PANEL_IDS`           | `knownPanelIds()` = 全部已注册面板                   |

留在数据里不派生的只有 `defaultPanelId`：它是产品决策
（「用户说『我要跑起来』时最该看到什么」），推不出来。

**顺带发现的问题**：派生后若直接用全局 `order` 排序，server 域的默认面板 `kernel`
（`kind: middle` / `order: 140`）会落到**最后** —— 因为 `getAllPanels()` 按 `(kind, order)` 排，
而 `resources`（middle / 120）、`nbt`（middle / 130）都排在它前面。
用户切进 server 域第一眼看到资源包而不是链路自检屏。
为此新增 `PanelRegistration.domainOrder` 作为**域内顺序**，13 个域面板显式声明，
并加断言「每域默认面板必须领衔」。

代价：`domains.ts` 的读取依赖注册表已初始化。`App.tsx:198` 在模块级调用
`initPanelRegistries()`，早于任何渲染，所以运行时无顺序问题；单测需自行调用。
（注意 `describe` 体在收集阶段求值，早于 `beforeAll` —— 把派生读取放进用例体内。）

### 1.8 中栏的 IDE 分层现状（P3，结论已修正）

**原判断有误，已推翻。** 本文档初稿写的是「现有中栏为 `MainPanelView` 单面板占满，
无 IDE 常见的分层区域」。核查后发现**中栏 IDE 外壳早已存在**，只是锁在一个不可达面板后面。

`components/middle/MiddlePanel.tsx`（387 行）已实现：

| 能力                                   | 位置                                    | 原判断                                          |
| -------------------------------------- | --------------------------------------- | ----------------------------------------------- |
| Tool window tab 条（5 个 tab）         | `MiddlePanel.tsx:252-334`               | ❌ 说「缺失」                                   |
| 打开文件 tab 条                        | `TabBar`，`MiddlePanel.tsx:368`         | ❌ 说「缺失」                                   |
| 命令面板（F1 / Ctrl+P / Ctrl+Shift+P） | `MiddlePanel.tsx:377-381, 89-119`       | 未提及                                          |
| 全局 Ctrl+S 保存                       | `MiddlePanel.tsx:104-114`               | 未提及                                          |
| 预览按 generatorType 分发              | `RenderPreviewPanel` + preview-registry | 未提及                                          |
| L1/L2/L3 编辑模式切换                  | `editorMode` store + `ModeSwitcher`     | 未提及                                          |
| 全局面包屑                             | —                                       | ✅ 仅 `CodePreview` 内部有                      |
| 底部面板（Problems/Output/Terminal）   | —                                       | ✅ 缺失（`TerminalPanel` 已确认为死代码并删除） |
| 状态栏                                 | `components/StatusBar.tsx`              | ✅ 缺失 → **已补**（见 §1.9）                   |

而它在注册表里以 **`preview` 面板**挂载 —— `preview` 正是 §1.3 那 8 个不可达面板之一。

**这改变了重构的性质**：

- 原计划阶段 4 是「新增 `DomainTabs` 组件」。核查后不该新建 ——
  该做的是把 `MiddlePanel` 已有的 tab 条**泛化成按域取面板**，
  并把它从「锁在 preview 面板里」提到「中栏常驻」。
- 也纠正了一个错判：`TabBar.tsx` / `IconTabBar.tsx` 曾被我归类为「测试孤儿」，
  实际 `MiddlePanel.tsx:4` 就在生产使用它们。它们不是死代码。
- 真正的重复在别处：`preview` / `resources` / `nbt` 三个面板
  **同时**被 `MainPanelView` 的 `switch` 和 `MiddlePanel` 的 tab 实现
  （其中 `nbt` 两处不等价，见 §1.6.1）。合并的对象是这两套实现，不是「新建 tab 条」。

底部面板仍列为后续独立议题（Problems 数据源需在 `compileResult` 与 `buildLog` 之间选定）。
状态栏已在 §1.9 落地。

---

## 1.9 顶部重排：项目配置下沉 + 补齐状态栏

### 1.9.1 触发问题

`TopToolbar` 中间长期挂着三个 `<select>`：**内容类型 / 加载器 / MC 版本**。
它们不是导航控件，是**项目配置**，且被 40+ 个文件消费（构建、CI/CD 配置生成、
13 个预览面板、AI 生成、包搜索版本匹配）。问题有三层：

1. **违反 IDE 约定**。查证 VS Code 与 IntelliJ 官方文档：
   - VS Code 官方列出的六个区域是 Editor / Primary Side Bar / Secondary Side Bar /
     Status Bar / Activity Bar / Panel —— **没有「工具栏」**。标题栏只有
     菜单栏 + Command Center（显示项目名）+ 布局控制按钮。
   - IntelliJ 主工具栏是运行/调试/性能分析 + 工具窗口按钮，同样只有动作。
   - 两者的项目上下文（VS Code 的语言/缩进/行列，IntelliJ 的编码/行号/SDK）
     一律在**底部状态栏**。
2. **占位冲突**。顶部现在是 `DomainTabs` 的地盘，再挂三个表单控件就是噪声。
3. **是唯一编辑入口**。查证三处：`SettingsPanel` 此前**只读**这三个字段
   （其内部的 `mcVersion` 是「依赖预热」的局部 state，与项目版本无关）；
   `ProjectCreateDialog` 用局部 `useState`，只在新建时提交。
   → 直接删会让项目创建后**再也无法换 loader / 版本**。

### 1.9.2 处置（按 IDE 通行做法分两处安置）

| 内容                 | 去处                                                   | 形式                                        |
| -------------------- | ------------------------------------------------------ | ------------------------------------------- |
| 三个下拉框（可编辑） | `SettingsPanel` 新增「项目」分组，且**默认落在该 tab** | 三个 `<select>`，`<label htmlFor>` 真实关联 |
| 三个值（只读）       | 新增底部 `StatusBar`                                   | 只读文字，点击跳设置面板                    |

`TopToolbar` 保留：项目名菜单（≈ Command Center）、构建按钮（IntelliJ 的 run 动作）、
语言切换、API 状态指示、loading 指示器、26.2 实验版提示。
`mcVersion` / `loader` / `generatorType` 的**值**仍留在 `TopToolbar` 的 store 订阅里 ——
「另存为项目」要写进项目文件，26.2 提示条要读版本；只是不再可编辑。

**顺带记一个语义问题**（未修，留档）：`setGeneratorType` 是普通 setter，
中途切内容类型**不会清空已有文件** —— 把「模组」改成「服务器」，mod 文件还留着。
这在改动前就是这样，不是本次引入。

### 1.9.3 回归网

| 文件                             | 例数   | 锁住什么                                                                                                                                              |
| -------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SettingsPanel.project.test.tsx` | 8      | 「项目」是默认 tab；三个 select 齐全；可访问名称来自真实 `<label htmlFor>` 而非 aria-label；改值打到对应 setter；`needsLoader` 领域规则跟着迁移过来了 |
| `StatusBar.test.tsx`             | 6      | `role="status"` 有可访问名；展示四项上下文；**零表单控件**；点击跳 settings；非 mod 类型不显示 loader；无项目时不渲染 `undefined`                     |
| `workbench.integration.test.tsx` | 改写 1 | `TopToolbar` 内 `queryAllByRole('combobox')` 长度为 **0** —— 防止三个下拉框被无声塞回顶部                                                             |

> a11y 说明：可访问名称这次用的是 `<label htmlFor>` 而不是迁移前的 `aria-label`。
> 集成测试里 `label` / `select-name` 两条 axe 规则**保持启用**，所以删掉 label 会立刻变红。

### 1.9.4 顺带修的地雷：会污染下一轮运行的 e2e 测试

`collab-relay-e2e.test.ts` 硬编码端口 `18787`，且 `afterAll` 用
`child.kill()` + 固定 `sleep(200ms)` 收尾。中继进程没被完全回收时监听句柄会活过测试进程，
于是**下一次**运行必然 `EADDRINUSE` —— 报错的却是与当次改动无关的代码，排查成本极高
（本次重排工具栏时撞到过一次，差点误判为回归）。

修法两点：向内核要一个当前空闲端口（残留进程再也挡不住后续运行）；
`afterAll` 改为**等 `exit` 事件**并加 2s 后 `SIGKILL` 兜底。
已连跑三轮验证幂等，且结束后端口无残留。

---

## 1.10 文件树重复装配 + 空态引导

### 1.10.1 触发

用户看到左栏那个「项目目录为空 / 右键新建文件或文件夹」的空态，
问「这个留着干啥用」。查的过程里挖出两个独立问题。

### 1.10.2 问题一：屏幕上同时两个文件树（真 bug）

| 位置                                                   | 渲染什么   |
| ------------------------------------------------------ | ---------- |
| `App.tsx` 左栏（硬编码，不读 `activeLeftPanel`）       | `FileTree` |
| 注册表 `explorer` loader（`register-all-panels.ts:9`） | `FileTree` |

点活动栏 explorer 图标走 `selectPanel('explorer')` → 中栏 `PanelHost('explorer')`
也渲一份 → 屏上两个文件树。

**用测试实锤，不是读代码推断**：`waitFor` 到 lazy 落地后数 `filetree-empty`，
点 explorer 前 1 份、后 2 份。

> 教训：第一版没加 `waitFor`，在 Suspense 阶段就断言，数出 1 份，
> 我据此以为自己的判断错了。实际是我断言早了。这条写进了回归网的注释里。

**为什么 §1.6 的「explorer 三份语义」修复没抓到**：
那次把中栏那份从 `CodePreview` 统一成 `FileTree`，语义是统一了，
但没处理「左栏本来就常驻文件树」。**语义一致 ≠ 可以同时显示两份。**

### 1.10.3 处置：两道防线

| 层   | 做法                                                                                     | 挡什么                                            |
| ---- | ---------------------------------------------------------------------------------------- | ------------------------------------------------- |
| 入口 | `App.tsx` 的 `handleActivityChange`：`explorer` 图标改为**折叠/展开左栏**                | 正常点击路径                                      |
| 兜底 | `workbench-store.ts` 的 `SIDEBAR_ONLY_PANEL_IDS`，`resolveActivePanel` 永不返回 explorer | localStorage 残留、误调 `selectPanel('explorer')` |

文件树**不能删**：它是中栏唯一的目录浏览入口 ——
`MiddlePanel` 的 5 个 tab（预览/低代码/资源包/NBT/代码）里只有「已打开文件的 TabBar」，
没有目录层级。所以让它**只**住在左栏，中栏一律不渲。

`layout-store` 新增 `leftCollapsed`（persist `version: 2`；
老版本 localStorage 无此键，由 initial state 补 `false`，无需 migrate）。

### 1.10.4 连带修：ActivityBar 的高亮与 roving tabindex

explorer 不再是中栏面板后，「哪个图标高亮」需要重新定义：

- `highlightedId`：**至多一个**。优先级为「中栏正在显示的 core 面板 > 左栏展开态」。
  两者都保留会出现两个图标同时高亮，活动栏就失去唯一指示作用。
- `rovingId`（键盘漫游锚点）：`highlightedId ?? 'explorer'`。
  **必须与高亮解耦** —— WAI-ARIA roving tabindex 要求恒有且仅有一个 `tabIndex=0`；
  「左栏折叠 + 中栏停在域面板」时 `highlightedId` 为 null，
  拿它当锚点则整列一个可 tab 的按钮都没有，且方向键漫游因 `findIndex` 返回 -1 直接 return。
  这个 bug 是本次改动自己引入的（原先锚点是中栏面板，恒有值），
  被既有的方向键用例当场抓住 —— 又一次说明既有回归网的价值。

### 1.10.5 问题二：空态在教错的动作

原空态只有「右键新建文件或文件夹」，两个毛病：

1. **教错动作**。这是生成器 —— 目录为空意味着「还没生成」，
   该做的是用右侧智能体生成，或点中栏各编辑器自己的生成按钮。
   让人手动右键造文件，是把用户引向最费力的那条路。
2. **「右键」是隐藏手势**。VS Code 的 Explorer 空了不提示右键，
   而是在视图标题栏常驻**可见的**新建图标按钮。

改为：文案指出「用右侧智能体生成内容，或手动创建文件」，
并给出两个**可见按钮**（新建文件 / 新建文件夹），右键菜单保留。

### 1.10.6 回归网

| 文件                                       | 例数 | 锁住什么                                                                                                      |
| ------------------------------------------ | ---- | ------------------------------------------------------------------------------------------------------------- |
| `shell/file-tree-single-instance.test.tsx` | 7    | 点 explorer 是折叠/展开而非复制；反复切换恒 1 份；`resolveActivePanel` 三域回落；search/git/settings 不受影响 |
| `components/ActivityBar.test.tsx`          | 28   | prop 改名后全量重跑；方向键/Home/End 漫游（抓住 1.10.4 的 roving bug）                                        |
| `components/FileTree.test.tsx`             | 32   | 空态文案指向生成；两个可见按钮存在且真的走新建流程；「右键新建」字样已消失                                    |
| `shell/workbench-store.test.ts`            | 16   | explorer 归入左栏专属；`selectPanel('explorer')` 不改域但中栏回落                                             |
| `shell/DomainTabs.test.tsx`                | 21   | tab 条对残留 explorer 的回落                                                                                  |

---

## 1.11 文件树按面板派生显隐

### 1.11.1 触发

§1.10 修完重复装配后，用户在**启动器域**看到左栏仍挂着那棵空树，问
「这个怎么又要出现了？还是启动器那边……思考启动界面需要这个吗」。

### 1.11.2 核查：文件树不是通用导航

先查「谁真的在用文件树」。全仓 `selectFile(` 的**生产**调用点只有 3 处：

```
PurecodeWorkspace.tsx:637 / :724     ← 代码编辑区（dev 域 preview 面板的「代码」tab）
Breadcrumb.tsx:38
SearchPanel.tsx:152
```

即文件树真正的作用是**给代码编辑器挑文件**，不是浏览整个项目。

再看各面板实际读什么：

| 面板               | 域       | 实际读的                                              | 要树吗 |
| ------------------ | -------- | ----------------------------------------------------- | ------ |
| `game` 游戏启动器  | launcher | `files.find(f => f.path.endsWith('.jar'))` 取一个路径 | ❌     |
| `packages` 包管理  | launcher | `loader/mcVersion/spec` 做 Modrinth 版本匹配          | ❌     |
| `kernel` 内核自检  | server   | 完全不碰项目文件                                      | ❌     |
| `preview` 代码编辑 | dev      | `PurecodeWorkspace` 消费 `selectedFile`               | ✅     |
| `nbt`              | server   | `NbtPanelWithStore` 消费 `selectedFile`               | ✅     |
| `resources`        | server   | `selectedFile`×6                                      | ✅     |
| `skin` 皮肤        | launcher | 读 files 生成资源包，产物要可见                       | ✅     |
| `build` 构建       | dev      | 读 files 打包，产物要可见                             | ✅     |

判据是「**点文件树里的一个文件，对这个面板有没有意义**」，
而不是「这个面板有没有用到 `files`」——
`game` / `skin` / `build` 都读 `files`，但它们只需要结果，不需要浏览目录层级。

### 1.11.3 处置

`PanelRegistration` 新增 `needsFileTree?: boolean`，**默认 `false`**。
默认 false 是有意的：宁可漏显示（用户可手动展开）也不默认占位。
若默认 `true`，游戏启动器 / 包管理 / 内核自检都会白白占掉 200px。

`leftCollapsed` 从 `boolean` 改成 **`boolean | null`**：

| 值               | 含义                                                           |
| ---------------- | -------------------------------------------------------------- |
| `null`           | 跟随当前面板自动决定（`getPanel(id)?.needsFileTree === true`） |
| `true` / `false` | 用户手动锁定，**切面板也不再改**                               |

三态是必需的：只有 boolean 时「自动跟随」与「手动锁死」无法共存——
每次切面板都会把用户刚展开的树无声收掉，
「我明明打开了」和「它自己关了」用户分不清。

这与 §1.10.4 的 `rovingId` 兜底是同一类教训：
**自动派生的值必须留手动覆盖的口子，否则自动化会变成用户眼中的 bug。**

### 1.11.4 回归网

`shell/file-tree-visibility.test.tsx`（10 例）：

| 组         | 锁住什么                                                                                                             |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| 注册表标注 | 5 个 `needsFileTree: true` 与核查表逐条对齐；3 个不需要的确实没标；`explorer` 自身不标（它是左栏宿主，不是中栏面板） |
| 自动显隐   | 游戏启动器 / 包管理 → 收起；代码编辑 / NBT / 资源包 → 展开                                                           |
| 手动锁定   | 在不需要树的面板手动展开 → 出现；锁定后切面板**不再改变**；在需要树的面板手动收起后切面板仍保持收起                  |

---

## 2. 目标架构

### 2.1 布局（保持不变）

三栏布局与智能体右置是**既定产品决策，本次不动**：

```
┌──────────────────────────────────────────────────────┐
│ TopToolbar                                           │
├──────────────────────────────────────────────────────┤
│ DomainSwitcher（三域）                                │
├────┬───────────┬─────────────────────────┬────────────┤
│Act │  FileTree │  DomainTabs              │  Agent     │
│ivity│  (左栏)   │  ┌─────────────────────┐│  Panel     │
│Rail │           │  │  PanelHost(唯一内容) ││  (右侧常驻)│
│    │           │  └─────────────────────┘│            │
└────┴───────────┴─────────────────────────┴────────────┘
```

### 2.2 组件划分

```
shell/
  panels.ts        PanelRegistration 增加 domain 字段 —— 面板唯一真源
  domains.ts       仅保留域的 label/summary/order；panelIds 改为派生
  selectors.ts     panelsOfDomain / visiblePanels / defaultPanelId（纯派生，零重复）
  PanelHost.tsx    唯一渲染入口（沿用现成实现）
  WorkbenchLayout  纯布局：左栏 + 中栏 + 右栏 + Splitter，不含业务
workbench/
  workbench-store  domain + activePanelId + 每域记忆；状态机 + 不变式
  ActivityRail     固定 common 面板（语义由 ActivityBar 收窄而来）
  DomainTabs       域面板 tab 条（新增）
  DomainSwitcher   保留，收窄为「只切域」
```

### 2.3 导航形态的依据

对照三个主流 IDE 的既有做法：

| IDE                    | 图标栏                       | 业务面板         | 长尾            |
| ---------------------- | ---------------------------- | ---------------- | --------------- |
| VS Code                | View Container，**固定不变** | 侧栏 / View 菜单 | Command Palette |
| IntelliJ（2023 新 UI） | 已弃用                       | **顶部 tab**     | Find Action     |
| Eclipse                | 切换整个 Perspective         | —                | —               |

共同结论：

1. **图标栏 = 固定基础设施**，不随任何模式变化（肌肉记忆的前提）
2. **业务/内容面板 = 内容区顶部常驻 tab**。IntelliJ 由图标改为 tab 的官方理由即图标位不够用，
   说明 tab 是内容型面板的终点形态
3. **命令面板 = 加速器**，不可作为唯一入口

本项目采纳：`ActivityRail` 固定 common；域面板进 `DomainTabs`。

**tab 嵌套的处理**：仅 `preview` 面板内部存在视图切换 tab（代码 / 文件树 / 错误）。
按层级区分视觉语言消歧——外层 `DomainTabs` 用下划线 tab（内容类型语义），
内层视图切换用 segmented control（视图模式语义），避免形成 tablist 嵌套。

---

## 3. 不变式

以下四条以测试固化，是本次重构的验收标准：

| #   | 不变式                                                             | 现状         |
| --- | ------------------------------------------------------------------ | ------------ |
| I1  | 面板仅在 registry 声明一次，`domain` 是 `PanelRegistration` 的字段 | ✗ 旁挂表     |
| I2  | 代码中不允许出现列举面板 id 的 `switch`/`if`                       | ✗ 16 个 case |
| I3  | 每个 `enabled` 面板 ∈ `visiblePanels(其所属域)`                    | ✗ 8 个不可达 |
| I4  | registry 路径被真正使用，无并行装配机制                            | ✗ 一套死代码 |

I3 为**新增**不变式，专门覆盖 §1.4 的测试盲区。

---

## 4. 关键设计决策

### D1 · 面板装配收敛为单一路径

**选**：保留 registry + `PanelHost`，删除 `MainPanelView` 的 16 个硬编码 `lazy()` 与 `switch`。
**排除**：保留 `MainPanelView` switch 作为主路径。
**理由**：`MainPanelView` 与 `register-all-panels.ts` 各自维护一份 loader，
新增面板需改两处且编译期无法发现遗漏——这正是 1.1 的成因。
`PanelHost` 已处理 hook 顺序不变式（面板注册态可在渲染间变化），复用零成本。

### D2 · 切域重置面板 —— ✅ 已拍板（方案 b），2026-10-09

**问题**：切域时是否重置当前面板？该决策决定 `workbench-store` 的状态机形状。

- **方案 a 不重置** —— 域仅为分组视图，跨域工作流顺畅。
  依据：modder 真实动线为 `items` → `preview` → `cicd` → `game`，
  **跨 `dev` 与 `launcher` 两域**；域当闸门会打断该链路。
- **方案 b 重置到 `defaultPanelId`** —— 保住「切域先看域门面」
  （`kernel`/`game`/`items`）的设计意图。 ← **采纳**

**采纳 b 的理由**：初版设计推荐 a，理由是跨域动线。但那条动线现在**不再需要导航帮忙记忆**——
它由 tab 条与面板内跳转承担（`cicd` 面板里有「本地构建」链接、`build` 面板里有「启动游戏」），
而不必靠「记住上次停在哪个面板」。留着 a 反而要处理
「回到上次看的面板，但那个面板在当前语境已不合适」这类歧义，
状态机凭空多出一个维度（按域记忆 N 份面板选择）。

b 的代价是跨域来回切会丢面板位置。本项目可接受：三域职责正交（§0.2），
用户跨域时本就换了心智上下文。

**落地**（`shell/workbench-store.ts`，15 例测试锁定）：

| 动作                    | 行为                                                   |
| ----------------------- | ------------------------------------------------------ |
| `setDomain(d)`          | `{ domain: d, panelId: null }` —— 重置为该域默认面板   |
| `selectPanel(id)`       | `{ panelId: id, domain: domainOfPanel(id) ?? 当前域 }` |
| `resolveActivePanel(s)` | 唯一的失效值兜底点：未注册 / 不属于本域 → 该域默认面板 |

**顺带修掉 `packages` 弹回 bug**：旧逻辑在 `useEffect` 里做域纠偏，
点了归属别域的面板会被**静默弹回**（用户只看到「按钮失灵」）。
新逻辑把 `selectPanel('packages')` 解释为「切到 launcher 域并打开 packages」，
域切换器同步移动 —— 如实反馈换语境，而不是假装按钮坏了。

> 附带删除了 `store/domain-store.ts`：域的唯一所有者现在是 `workbench-store`，
> 避免两个 store 各自持久化 `domain` 造成双重真源。

### D3 · common 面板判定改为白名单语义 —— ✅ 已被派生方案取代

原方案：把「是否 common」改成白名单语义。

**实际落地时发现白名单本身就是重复的根源**，改为派生：
「跨域常驻」等价于「注册表里 `domain` 字段为 `null`」，
`COMMON_PANEL_IDS` 这个常量随之消失，也不再由 `isCommonPanel` / `domainOfPanel`
两条独立判定拼装。详见 §1.7「归属表改派生」。

### D4 · Monaco 本地化时序收归一处 —— 范围已收窄（2026-10-09 核查）

`preview` 的静态依赖含 `<Editor>`，其 loader 必须先完成 Monaco 本地化配置，
否则 `loader.init()` 走 CDN 分支被 CSP 拦掉（编辑器可开但高亮/补全/TS 诊断全无）。
当前该约束散落在 `MainPanelView.tsx:9-11` 与 `register-all-panels.ts:31-33` 两处注释中。

D1 收敛后 `withMonacoSetup` 只挂在 registry 的 loader 定义处一处，
**其余位置不得再出现裸 `lazy()` 导入含 `<Editor>` 的面板**。

**核查后的范围收窄**（对全部 39 个静态可达文件做了传递闭包扫描）：

| 结论                                    | 依据                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------- |
| **只有 `preview` 需要 gate**            | 13 个 preview-registry 组件、其余 13 个注册面板的静态闭包里**零** `@monaco-editor/react` 值导入 |
| `resources` / `nbt` **不要**加 gate     | 闭包 32 / 3 个文件，零 monaco 引用，加了是纯开销                                                |
| 真正静态持有 `<Editor>` 的只有 5 个文件 | `CodePreview` / `SplitCodeEditor` / `PurecodeWorkspace` / `CodeNodeEditor` / `AgentPanel`       |

**由此暴露的真问题（R1）**：`MiddlePanel.tsx:5,6,11,12` 把
`CodePreview` / `SplitCodeEditor` / `LowcodeWorkspace` / `PurecodeWorkspace`
**静态** import 了进来 —— 于是只要 `preview` 面板加载，
**171 个文件的模块图**（实测 BFS `reachable=171`）就被求值，
其中 `LowcodeWorkspace` 一家占 142 个文件。
用户即使只停在 `preview` tab 从不点「低代码」「代码」，这 4 个组件的代码也已进内存。

`preview` 面板的 loader gate 是**模块图求值之前**的闸门，组件级 `lazy()` 只延后**渲染**。
两者都要留才既安全又瘦身。

### D4 · Monaco 本地化时序收归一处

`preview` / `lowcode` / `purecode` 的静态依赖均含 `<Editor>`，其 loader 必须先完成
Monaco 本地化配置，否则 `loader.init()` 走 CDN 分支被 CSP 拦掉
（编辑器可开但高亮/补全/TS 诊断全无）。当前该约束散落在 `MainPanelView.tsx:9-11`
与 `register-all-panels.ts:31-33` 两处注释中，是已发生过的坑。

D1 收敛后 `withMonacoSetup` 只挂在 registry 的 loader 定义处一处，
**其余位置不得再出现裸 `lazy()` 导入含 `<Editor>` 的面板**。

---

## 5. 实施计划

分阶段推进，每阶段独立可验证、可回退。**不建议一轮做完**——
阶段 2 删 switch 后，registry 中任一 loader 配置错误都会导致对应面板运行时空白，
一轮到底将使故障难以定位到具体阶段。

### 5.0 阶段 0A：构建入口恢复（独立于导航重构，优先级最高）—— ✅ 已完成

`BuildPanel` 的接线**不依赖**本次导航架构改动，可先行修复：

1. 将 `BuildPanel` 注册为面板（归属 `cicd` 所在的 `dev` 域，或独立 `build` 面板）
2. 复核其消费的 `mod-store` 字段与 `BUILD_STREAM` 通道仍匹配当前签名
3. 补一条集成测试：从 UI 触发 `build` → 断言 `setBuildResult` 被调用
4. **（计划外）** 确认「注册」是否等于「可达」——若否，补真实 UI 入口并加 I3 断言

阶段 0A 完成后立即产生用户可感知价值，且与后续阶段解耦，可独立发布。

> **实施结果**（2026-10-09）：3 项全部完成，10 个依赖字段/通道签名逐一核对无误
> （`checkJava`/`abortBuild`/`prepareBuildDir`/`buildWithFix`/`buildStream`/
> `fixSuggest`/`locateMc`/`chooseMcDir`/`installMod`/`launchMc` 全部存在）。
> 集成测试扩到 7 例，比计划的「一条」多——因为「接线」不止成功路径：
> JDK 预检拦截、构建失败后的 AI 修复、流式 chunk 累积、取消后迟到回包不得改写结果，
> 这四条都是只有真跑一遍 UI 才会暴露的分支。
>
> **计划外的第 4 项工作**：原计划只说「注册面板」，但注册完复查时发现
> 域面板根本无入口可达，于是补了 `TopToolbar` 的「构建」按钮 + 5 例行为测试，
> 并顺带补上 I3 可达性不变式测试。详见 §1.5.1「『注册了』不等于『可达』」。

### 5.1 导航重构阶段

| 阶段 | 内容                                                                                                                                                                                            | 验证                            | 状态 |
| ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ---- |
| 0    | 编写 I3 可达性测试                                                                                                                                                                              | 暴露 8 个不可达面板             | ✅   |
| 1    | `PanelRegistration` 增加 `domain` / `domainOrder`；`domains.ts` 归属表改派生                                                                                                                    | I1、I3、域内顺序断言            | ✅   |
| 2    | 引入 `workbench-store`；删 `App.tsx` 纠偏 effect；删 `domain-store`                                                                                                                             | 15 例 + **`packages` 弹回修复** | ✅   |
| 3    | 裁决 `explorer` 语义（§1.6.3，按 IDE View/Editor 约定统一为 `FileTree`）                                                                                                                        | 3 例 + 变异测试确认有效         | ✅   |
| 4    | 修 `nbt` props 接线（§1.6.1）                                                                                                                                                                   | NBT 读写回路测试                | ✅   |
| 5    | 中栏顶部常驻 `DomainTabs`（域面板 tab 条，按 `panelsOfDomain(domain)` 派生）                                                                                                                    | I3 全绿（17/17 可达）+ 20 例    | ✅   |
| 6    | `MainPanelView` → `PanelHost`；删 17 个 `lazy()` 与 `switch`                                                                                                                                    | 7 例 + PanelHost 既有测试       | ✅   |
| 7    | `MiddlePanel` 4 个 Monaco 静态 import 改 lazy（§D4 R1）；修 `RenderPreviewPanel` remount（§1.6.2）                                                                                              | 19 例 + 模块图规模断言          | ✅   |
| 8    | 删除剩余死代码：`CORE/DOMAIN/MIDDLE_PANEL_IDS`、`register-shell-panels.ts`、`register-domain-panels.ts`、`chat-store`、`CommandPalette.utils`、`TerminalPanel`、`VerticalCoreNode`、`a11yAudit` | lint 无 unused / warnings 47→37 | ✅   |
| 9    | a11y 扫描 + Workbench 集成测试（**已完成**，含全部 a11y 违规修复）                                                                                                                              | axe-core 0 违规 + 全量门禁通过  | ✅   |

### 5.2 阶段 9：a11y 修复记录

集成测试过程中 axe-core 检出 3 类**真实**违规，均已在组件侧修复（非禁用规则绕过）：

| 违规                                | 根因                                                                                        | 修复                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `aria-valid-attr-value`（critical） | `DomainTabs` 的 tab 与 tabpanel 分离在两个组件（`DomainTabs.tsx` 与 `App.tsx`），无结构约束 | **合并**：`DomainTabs` 自己渲染 tabpanel，用 `commonPanelContent` prop 承载跨域常驻面板。拆开就会「改一边忘另一边」，a11y 坏了只在运行时发现 |
| `select-name`（critical）           | `TopToolbar` 三个 `<select>`（类型/Loader/MC 版本）无可访问名称                             | 加 `aria-label` + 补 zh/en-US i18n                                                                                                           |
| `aria-valid-attr-value`（critical） | `MiddlePanel` 只渲染激活的 tabpanel，其余 tab 的 `aria-controls` 指向空气                   | 5 个 tabpanel 容器全部渲染（未激活的 `hidden`）                                                                                              |

**修 a11y 时引入的回归（已修 + 加测试锁住）**：

无条件渲染 5 个 tabpanel 的内容，会让 `LowcodeWorkspace`（静态闭包 **142 个文件**：React Flow 节点体系 + Monaco）在用户停留于 `preview` tab 时就被 import ——
**阶段 7 的 Monaco 体积优化被完全抵消**。

修法：`visited: Set<MiddleTab>` 记录访问过的 tab，内容只在首次访问后挂载、之后保持挂载（IDE 的编辑器行为：切走不丢状态）。tabpanel 容器仍然全在，满足 a11y。

新增 2 例测试锁住这个平衡点：

- `未访问的 tab：容器存在但内容不挂载（守住 Monaco 懒加载）`
- `访问过的 tab 内容保持挂载（切走不丢状态）`

若日后有人为「简单」去掉 `visited` 保护，第一例会立刻变红。

**集成测试的禁用规则（保持最小集）**：

| 禁用                                             | 原因                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------ |
| `color-contrast`                                 | jsdom 不加载 CSS，无法计算真实对比度（与既有 `a11y.scan.test.tsx` 一致） |
| `region` / `landmark-*` / `page-has-heading-one` | 组件级测试没有完整页面结构，扫整个片段无意义                             |

`aria-valid-attr-value` / `select-name` / `label` **均已恢复启用** —— 组件侧修好后它们要能守住回归。

> **顺序调整说明**：原计划阶段 2 直接删 switch。但核查发现 `nbt` 面板当前是**空壳**
> （§1.6.1），走注册表路径若不补 props 接线，「修复可达性」会把它从
> 「不可达的坏面板」变成「可达的坏面板」。故把「修 `nbt` + 裁决 `explorer`」提到删 switch **之前**。
>
> 阶段 4 同样前置了「补 `MainPanelView` 测试」——它 221 行 / 17 个 case 零覆盖，
> 没有回归网就删 switch 等于闭眼重构。

**阶段 7 的例外**：`PromptDialog` 不删（§1.6.5 是漏挂不是死代码）；
`TabBar` / `IconTabBar` 不删（**更正**：此前误判为测试孤儿，
实为 `MiddlePanel.tsx:4` 在生产使用，且是阶段 5 的实现素材）；
`BuildPanel` 不删（阶段 0A 已转为在用面板）。

---

## 6. 风险

| 风险                             | 影响                 | 缓解                                                                                 |
| -------------------------------- | -------------------- | ------------------------------------------------------------------------------------ |
| registry loader 配错导致面板空白 | 中                   | 阶段 2 后每个面板补集成测试；`PanelHost` 未注册分支已有兜底 UI                       |
| tab 嵌套造成 a11y 层级混乱       | 中                   | 外层下划线 tab / 内层 segmented，语义与视觉双重区分；a11y 扫描纳入门禁               |
| `withMonacoSetup` 遗漏           | 高（编辑器静默降级） | D4 收归一处，并在阶段 2 加断言：含 `<Editor>` 的面板 loader 必须经 `withMonacoSetup` |
| 工作台回归面广                   | 中                   | 分阶段 + 每阶段全量门禁                                                              |
| 域重置行为与用户预期不符         | 低                   | D2 预留开关，切换成本极低                                                            |

---

## 7. 影响面

**删除**：`MainPanelView.tsx`（16 case）、`register-shell-panels.ts`、
`register-domain-panels.ts`、`panels.tsx` 三份 `*_PANEL_IDS`

**新增**：`workbench/workbench-store.ts`、`workbench/DomainTabs.tsx`、
`shell/selectors.ts`、`shell/WorkbenchLayout.tsx`

**改造**：`panels.ts`（加 `domain`）、`domains.ts`（panelIds 派生）、
`App.tsx`（Workbench 拆分）、`ActivityBar.tsx` → `ActivityRail`

**不变**：三栏布局、智能体右置、内核分层（§2.2）、面板组件本身

---

## 8. 待确认

1. **D2 · 切域是否重置面板** —— 阻塞 `workbench-store` 状态机定形（推荐：不重置）
2. **common 面板位置** —— 留在 `ActivityRail` 固定区（改动小），
   或并入 `TopToolbar`（`ActivityRail` 语义更纯粹，但需改 `TopToolbar`）
