# Agent 集成增强 — 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户确认「agent 集成增强」

## 现状审计

Agent 系统已存在且功能完整:

- `agent-runtime.ts` — AgentRuntime:消息循环、工具调用、审批(promise 回调)、中止、超时、`tool:` 代码块解析、全局单例
- `agent-tools.ts` — 10 个工具:read_file / list_files / search_code / write_file / edit_file / delete_file / run_command / apply_content_template / generate_datapack / get_project_context
- `AgentSessionPanel.tsx` — 会话 UI(工具调用卡片、审批按钮、中止/清空)

**缺口:**

| # | 缺口 | 证据 | 风险 |
|---|------|------|------|
| 1 | agent-runtime 零测试 | 无 agent-runtime.test.ts | 核心循环回归无保护(审批/中止/超时/解析全是 Promise 状态机) |
| 2 | agent-tools 零测试 | 无 agent-tools.test.ts | 10 个工具行为(写文件/编辑/搜索/命令)无验证 |
| 3 | 缺 Mod 生成工具 | 工具只有 apply_content_template(generate_datapack 只产 datapack 文件) | 用户主要生成 Mod,agent 无法直接产 ModSpec 文件 |
| 4 | run_command 使用临时 PTY | 每次执行 spawn 新 PTY | 慢且无法在现有终端会话中执行 |

## 方案

### Task 1: agent-runtime 单元测试(TDD)

`apps/desktop/src/renderer/src/lib/agent-runtime.test.ts`

mock 掉 `ipcClient.chatStream`,注入脚本化响应序列,覆盖:

- 纯文本回复 → 追加 assistant 消息,循环结束
- 文本含 ` ```tool:name {...} ``` ` → 解析为 tool_calls,执行工具,结果回填,继续循环
- requiresApproval 工具 → pendingApproval 置位,approveToolCall 后执行 / rejectToolCall 后跳过
- abort() → AbortError 不进入 error 状态
- 超时(120s)→ 用已收内容 resolve
- 未知工具 → tool 消息「未知工具」
- maxIterations(10 轮)→ 提示消息
- sendUserMessage 异常 → error 状态
- clearHistory 清空

工具执行依赖 useModStore / ipcClient / findTool —— 用真实 agent-tools + mock store,或注入 stub findTool。设计:AgentRuntime 内部用 findTool 查找工具,测试里直接操纵 store(文件读写走 store,真实行为),run_command 需要 mock ipcClient.terminalSpawn。

### Task 2: agent-tools 单元测试

`apps/desktop/src/renderer/src/lib/agent-tools.test.ts`

- read_file:存在/不存在/超长截断
- list_files:全部/目录过滤(assets 不误匹配 assets2)
- search_code:正则搜索、非法正则回退、每文件 5 行上限、跳过 .png
- write_file:创建/更新
- edit_file:精确替换/模糊替换/多次出现报错/未找到报错
- delete_file:存在/不存在
- get_project_context:含 spec 摘要/文件树/dirty 标记
- run_command:mock terminalSpawn 成功/超时/终端不可用
- apply_content_template / generate_datapack:mock @mc-creator 动态导入 + store,断言文件写入 + lang 合并

### Task 3: 新增 generate_mod 工具

`generate_mod`:类似 generate_datapack,但消费 **ModSpec**(modId/items/blocks/recipes/entities/machines/…),运行 `ModGenerator`(fabric/neoforge),产出 Mod 源文件 + 资源文件到 store。参数:spec_json + loader。

- agent-tools.ts 加工具定义
- 系统提示 SYSTEM_PROMPT 增加 Mod 生成说明
- 测试:mock ModGenerator 或真实生成(fabric, 断言 ModItems.java 等文件写入)

### Task 4: 验证与提交

- `pnpm -r typecheck` / `pnpm --filter @mc-creator/desktop test` / lint 全绿
- 按 Task 分组 commit

## 验收标准

- agent-runtime 覆盖核心状态机(≥12 用例)
- agent-tools 覆盖全部 10 个工具(≥15 用例)
- generate_mod 工具可生成 Mod 文件(测试断言)
- typecheck/test/lint 全绿
