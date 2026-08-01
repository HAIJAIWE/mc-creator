# 文档同步与缺口修复计划 — 2026-08-01

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将 README 与实际代码状态对齐（10 种生成器 / 15 种节点 / AgentPanel UI / 实际测试数），并修复审计发现的 UI 缺口（AgentPanel placeholder 错误兜底）。

**背景（代码审计结论）：** README 停留在 7 种生成器、14 种节点、AiChat/ChatPanel 组件时代，而代码已演进到 10 种生成器、15 种节点、AgentPanel（agent/chat 双模式）。所有核心功能（schema/generator/prompt/模板库/UI 类型列表）实际已齐备，**只差文档同步 + 一个 UI 文案缺口**。

---

## 审计确认的缺口清单

| # | 缺口 | 证据 | 修复位置 |
| - | ---- | ---- | -------- |
| 1 | README 功能表只有 7 种生成器 | `registry.ts:31-40` 注册 10 种 | README |
| 2 | README 低代码节点数 14 → 实际 15（新增 procedure） | `nodes/index.ts` nodeTypes | README |
| 3 | README 组件列表 TopBar/ChatPanel/AiChat → 实际 AgentPanel | `components/AgentPanel.tsx` | README |
| 4 | README 项目结构缺 4 个生成器目录 + templates/ | `packages/core/src/generators/{launcher,kubejs,crafttweaker,behavior-pack}`、`packages/shared/src/templates/` | README |
| 5 | README 测试数 1146+ → 实际 1699（1236+381+82） | 本地 `pnpm -r test` | README |
| 6 | README 使用指南 7 类型 → 10 类型（补 Launcher/KubeJS/CraftTweaker/行为包） | schemas 4 个新 spec | README |
| 7 | README 路线图缺 P35+（4 个新生成器、AgentPanel、ProcedureNode、BuildCache 等） | git log | README |
| 8 | README「7 种 27 个模板」→ 实际 10 类 36 个 | `templates/index.ts` TEMPLATES_BY_TYPE | README |
| 9 | AgentPanel placeholder：kubejs/crafttweaker/behavior_pack 错误显示「启动器配置」 | `AgentPanel.tsx:243-256` | AgentPanel.tsx |
| 10 | README 顶部 USER/REPO 占位 | README:1-6 | README（发布时替换，本期顺带清理注释措辞） |

## 技术栈 / 约束

- 纯文档 + 单文件 UI 文案修改，不涉及 schema/生成器逻辑变更
- 测试断言 README 中引用的数字需与 `pnpm -r test` 实际输出一致
- 遵循 commitlint conventional commits；文档提交用 `docs:`，UI 修复用 `fix(desktop):`

---

## Task 1: README 全面同步

**Files:**

- Modify: `README.md`

**范围（对照缺口清单逐项）：**

- [x] **Step 1: 功能特性表** — 从 7 行扩到 10 行，补：

  - **Launcher 启动器配置**：官方/PCL2/HMCL 三型 → `launcher.json` + `profiles.json` + 启动脚本（bat/sh/ps1）+ `versions.json` + `config/theme.json`
  - **KubeJS 脚本**：配方/标签/事件/工具提示/语言/注册表 → `kubejs/server_scripts/*.js` + `startup_scripts` + `client_scripts`
  - **CraftTweaker 脚本**：ZenScript 配方/标签/事件/工具提示/语言 → `scripts/*.zs`（无注册表）
  - **Behavior Pack 行为包**：实体/配方/战利品表 → `manifest.json` + `entities/` + `recipes/` + `loot_tables/`

- [x] **Step 2: 低代码节点表** — 14 → 15 种，代码节点分类补 `procedure`（过程封装/PureCode 模式）

- [x] **Step 3: 核心能力列表** — 补：AgentPanel（agent/chat 双模式 + Spec 历史/模板/对比）、Spec 编辑器 Monaco、Project 导入导出（如 README 已有则核对措辞）、codeLock/PureCode、BuildCache、a11y 审计

- [x] **Step 4: 项目结构树** — 补 `packages/core/src/generators/{launcher,kubejs,crafttweaker,behavior-pack}/`、`packages/shared/src/templates/`（10 类模板）、renderer 组件改为 AgentPanel/TemplatePicker/Splitter/Toast 等实际组件

- [x] **Step 5: 使用指南** — 「选择生成器类型」列表 7 → 10；流程描述组件名同步为 AgentPanel

- [x] **Step 6: 测试覆盖表** — 更新为实测数字（desktop 99 文件 1236、core 30 文件 381、shared 9 文件 82，合计 1699），低代码模块数字核对后更新

- [x] **Step 7: 路线图** — 补已完成项：

  - P35：Launcher 启动器生成器
  - P36：KubeJS 脚本生成器
  - P37：CraftTweaker 脚本生成器
  - P38：Behavior Pack 行为包生成器
  - P39：AgentPanel agent/chat 双模式 + Spec 历史
  - P40：ProcedureNode + PureCode 模式 + codeLock
  - P41：BuildCache + recipe-adapter + 增量生成测试
  - P42：文档同步（本期）

- [x] **Step 8: 版本/徽章占位** — 保留 USER/REPO 占位但加注释说明发布前替换；版本号不动（发布时再 bump）

**验证：** 无代码变更；`pnpm format:check` 通过（README 在 prettier 范围）。

---

## Task 2: AgentPanel placeholder 修正

**Files:**

- Modify: `apps/desktop/src/renderer/src/components/AgentPanel.tsx`

**现状（`AgentPanel.tsx:243-256`）：** 三元链只覆盖 mod/datapack/modpack/server/resource_pack/skin 六种，其余（launcher/kubejs/crafttweaker/behavior_pack）全部落入默认「描述你想要的启动器配置…」。

- [x] **Step 1:** 将三元链重构为 Record 映射表（组件级常量），补齐 10 种类型文案：

  - `launcher`: 描述你想要的启动器配置…
  - `kubejs`: 描述你想要的 KubeJS 脚本…
  - `crafttweaker`: 描述你想要的 CraftTweaker 脚本…
  - `behavior_pack`: 描述你想要的行为包…
  - 其余沿用现有文案；未知类型兜底「描述你想要的内容…」

- [x] **Step 2:** 检查 `AgentPanel.test.tsx` 现有 placeholder 断言，新增 3 个用例覆盖 kubejs/crafttweaker/behavior_pack（或补充现有测试描述）

**验证：**

- `pnpm --filter @mc-creator/desktop test` — 全部通过（含新增用例）
- `pnpm typecheck` — 0 错误
- `pnpm lint` — 0 错误

---

## Task 3: 最终验证与提交

- [x] **Step 1:** `pnpm -r typecheck` — 0 错误
- [x] **Step 2:** `pnpm -r test` — 1699+ 全部通过
- [x] **Step 3:** `pnpm lint && pnpm format:check` — 0 错误
- [x] **Step 4:** 提交 2 个 commit：

  ```powershell
  git add README.md
  git commit -m "docs: sync README with 10 generators, 15 nodes, and current test counts"
  git add apps/desktop/src/renderer/src/components/AgentPanel.tsx apps/desktop/src/renderer/src/components/AgentPanel.test.tsx
  git commit -m "fix(desktop): correct AgentPanel placeholder for kubejs/crafttweaker/behavior_pack types"
  ```

---

## 验证标准

- [x] README 功能表 = 10 行，与 `registry.ts` 注册完全一致
- [x] README 节点数 = 15，与 `nodeTypes` 一致
- [x] README 测试数 = 本地实测值
- [x] README 路线图含 P35-P42
- [x] AgentPanel 10 种类型均有专属 placeholder，无错误兜底
- [x] 新增/更新测试用例通过，typecheck/lint/format 全绿
