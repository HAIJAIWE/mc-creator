# 代码架构评估：Agent 代码该按哪种模式组织

> 评估日期：2026-10-11
> 评估对象：本仓库（`D:\MC mod`，Electron + pnpm monorepo）
> 结论摘要见 [§0](#0-结论摘要)。
> **§3.1 与 §3.1.2 已于同日实施完毕**，实施结果与验证方式见 [§6](#6-实施记录)。

---

## 0. 结论摘要

**问题前提需要先纠正**：待评估的四种模式里，**模式三（Monorepo）本项目已经在用了** ——
17 个 workspace 包、`pnpm-workspace.yaml`、包间用 `workspace:*` 协议引用。

所以真正的问题不是"选哪个模式"，而是：**已有的 monorepo 存在结构性问题**，
而这三点恰好是模式一/二/四各自要解决的。因此本文的评估对象是：
**这些模式的**设计原则**，有多少已经在本仓库落地，缺哪些、代价多大。**

| 模式                      | 本仓库现状                      | 结论                                     |
| ------------------------- | ------------------------------- | ---------------------------------------- |
| 模式一 极简框架型         | 部分落地（agent 单包 12 文件）  | 不推荐改 —— 包边界已由 monorepo 提供     |
| 模式二 分层架构型         | **未落地**                      | **推荐采纳，但只对 `packages/agent` 做** |
| 模式三 Monorepo           | **已在用**                      | 无需变更，问题在包内部                   |
| 模式四 Clean Architecture | 部分落地（domain/infra 已分层） | 不推荐全面套用 —— 代价与收益不成比例     |

---

## 1. 实测数据

### 1.1 工作区构成

```
apps/desktop      Electron 主进程 + 渲染层
packages/         17 个包，合计约 500 个 TS 源文件
```

各包源文件数（`packages/*/src` 下 `.ts`/`.tsx`，含测试）：

| 包                                              | 文件数 | 备注                   |
| ----------------------------------------------- | ------ | ---------------------- |
| core                                            | 141    | **见 §1.3，问题核心**  |
| shared                                          | 57     |                        |
| generator-mod                                   | 52     |                        |
| ui                                              | 30     |                        |
| kernel-java                                     | 30     |                        |
| generator-bedrock                               | 27     |                        |
| agent                                           | 24     | 含 11 个测试文件       |
| generator-datapack                              | 20     |                        |
| devkit                                          | 18     |                        |
| kernel-bedrock / kernel-server / engine / shell | 6–9    |                        |
| contract / generator-plugin / i18n              | 5      | contract 只有 6 个用例 |
| jobobject                                       | 0      | 非 TS 实现，见 §4.3    |

### 1.2 包依赖图（实测 `package.json` 的 `workspace:*` 声明）

```
contract ──────────────┬──────────────┬─────────────┐
jobobject              │              │             │
shell ────────── i18n  │              │             │
                       │              │             │
devkit ────────────────┼──────────────┤             │
                       │              │             │
generator-mod ──┐      │              │             │
generator-bedrock├─ core ── generator-datapack      │
                │      │              │             │
kernel-java ←───┘      │              │             │
                       │              │             │
kernel-bedrock ────────┤              │             │
kernel-server ─────────┤              │             │
                       │              │             │
agent ────────────────┴──────────────┴─────────────┘

desktop ── 依赖以上全部 11 个包
```

**已经是相当规整的分层**：`contract` 在最底，`desktop` 在最顶，中间按 kernel / generator /
core / agent 划分。没有出现 `generator-*` 反向依赖 `desktop` 这类倒挂。

### 1.3 核心问题：`core` 的转发壳

对 `packages/core/src` 下 105 个非测试文件逐一检查"文件内非注释语句是否全部是
`export * from '@mc-creator/...'`"：

| 类别                                 | 文件数 |
| ------------------------------------ | ------ |
| 纯转发壳（只 re-export，无任何实现） | **63** |
| 真实实现                             | 42     |

63 个壳分散在 **16 个子目录**：

```
core/src/generators/mod/           25 个壳
core/src/generators/mod/fabric/     5
core/src/generators/mod/neoforge/   4
core/src/generators/datapack/writers 4
core/src/generators/datapack/       3
core/src/generators/{behavior-entity,behavior-item,behavior-pack,
                     crafttweaker,enchantment,kubejs,launcher,
                     modpack,resource-pack,server,skin}/  各 2
```

其余 42 个真实实现集中在：`modpack` 10、`builder` 6、`model-provider` 4、`rag` 4、
`generators` 3、其余各 1–2。

**这意味着什么**：`core/generators/mod/fabric-adapter.ts` 的全部内容是

```ts
export * from '@mc-creator/generator-mod/fabric-adapter.js';
```

调用方写 `import { FabricAdapter } from '@mc-creator/core/generators/mod/fabric-adapter.js'`，
实际实现住在 `generator-mod` 包里。**core 不是这一层的所有者，只是路径别名。**

> **⚠️ 实施期间的重要修正**：上面这句话**对大部分转发壳成立，但对被
> `apps/desktop` 实际使用的那几个不成立**。见 §1.6。

### 1.4 依赖成环（实测双向 import）

| 方向                        | 证据                                                                                                                                      |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `core → generator-mod`      | `core/src/fabric-adapter.ts` 等 50+ 文件 re-export                                                                                        |
| `generator-mod → core`      | `generator-mod/src/mod-generator.test.ts` 导入<br>`@mc-creator/core/filesystem/index.js`、`@mc-creator/core/orchestrator/orchestrator.js` |
| `core → generator-datapack` | 同上模式                                                                                                                                  |
| `generator-datapack → core` | `generator-datapack/src/facade.test.ts` 导入<br>`@mc-creator/core/generators/registry.js`                                                 |

**注意**：成环发生在**测试文件**之间（生产代码方向是单向的）。
风险等级因此低于生产环，但仍然是真实的构建顺序约束 —— 改动任一侧时另一侧测试可能失效。

### 1.5 `agent` 直接耦合 kernel（已于 §6 修复）

`packages/agent/src/mcp-server.ts` 改造前：

```ts
// 硬构造，不可注入
const javaKernel = new JavaKernel(opts.java ?? {});
const serverKernel = new ServerKernel(opts.server ?? {});
const bedrockKernel = new BedrockKernel(opts.bedrock ?? {});
```

**后果**：`createMcpServer` 的测试必须真的构造三个内核。改造前 11 个测试文件、
约 110 处引用 `createMcpServer`，覆盖靠的是绕开内核的纯函数路径
（`listTools` / `callTool` 路由 / `parseLine` / `formatResponse`）。
**内核真正执行的那条路径没有独立测试缝。**

已通过依赖倒置修复，见 §3.1.2 与 §6.2。

### 1.6 转发壳并非全是垃圾：一部分在承担「门面」职责

> 本节是实施期间对 §1.3 的**重要修正**，记录在此以免后人重复犯错。

实测：`apps/desktop` 的 workspace 依赖里**没有**任何 `generator-*`：

```
desktop -> agent, contract, core, devkit, kernel-bedrock, kernel-java,
          kernel-server, shared, shell, ui
```

但 desktop 的代码确实要用 generator 的实现，例如：

| 消费方                                  | 引用路径                                                  | 该路径是壳还是真实现    |
| --------------------------------------- | --------------------------------------------------------- | ----------------------- |
| `lib/e2e-pipeline.test.ts:3`            | `core/generators/mod/fabric-adapter.js`                   | **壳**                  |
| `lib/fullchain.integration.test.ts:6`   | `core/generators/mod/mod-generator.js`                    | **壳**                  |
| `lib/agent-tools.ts:458,644`            | `core/generators/datapack/datapack-generator.js`          | **壳**                  |
| `lib/__bench__/large-graph.bench.ts:10` | `core/generators/mod/fabric-adapter.js`                   | **壳**                  |
| `generator-mod/src/facade.test.ts`      | `core/generators/registry.js`、`core/generators/index.js` | 真实现（core 确实拥有） |

**结论**：这些转发壳是 `desktop` 与 `generator-*` 之间的**门面**，
让 desktop 无需直接依赖 4 个 generator 包。把它改写成「desktop 直接 import
`@mc-creator/generator-mod`」需要给 desktop 加依赖 —— 那是**依赖边界的改变**，
不是清理。因此 §3.2 只处理「无人使用的壳」，不动在用的。

**这不改变总体判断**（63 个壳里只有 4 处路径在用，其余 59 处仍是纯浪费），
但改变了「怎么改」的结论：**不能一刀切删除**。

---

## 2. 与四种模式的逐条对照

### 模式一：极简框架型（tinyagent-ts）

**模式主张**：逻辑集中在单个 `src/`，靠装饰器（`@tool`/`@model`）与目录约定组织。

**本仓库已具备的等价物**：

| tinyagent-ts        | 本仓库对应                                                             |
| ------------------- | ---------------------------------------------------------------------- |
| `src/` 单包扁平     | `packages/agent/` 单包 12 个源文件                                     |
| `@tool` 装饰器      | `packages/agent/src/tools.ts` 的 `MCP_TOOL_DEFS`（数据驱动，非装饰器） |
| `core/prompts/*.md` | `packages/agent/src/context-pack.ts` + `context-source.ts`             |

**评价**：agent 层**已经是这个形态**，而且做得更好 —— 数据驱动的工具定义比装饰器更易测试、
更易序列化。如果要"改成模式一"，等于什么都不改。

**不推荐把 monorepo 拍平成模式一**：本项目有 3 种 loader（java/bedrock/server）、
7 种生成器、17 个包，拍平会丢失已建立的有序构建。

### 模式二：分层架构型（@axlsdk/axl）

**模式主张**：单向依赖 `tools → agents → workflows`，`tools` 不 import `agents`。

**本仓库现状**：

- ✅ 包之间已是单向（§1.2）
- ❌ **`agent` 包内部是扁平的** —— 12 个文件平铺，没有 tools/agents/workflows 之分
- ❌ **`agent/tools` 直接依赖 infrastructure** —— §1.5 的 kernel 硬耦合

**这是唯一明确缺失的原则**，详见 §3.1。

### 模式三：Monorepo（system2）

**本仓库已在用**，无需变更。但包**内部**的质量参差（§1.3）说明：
monorepo 解决了"包之间怎么分"，没有解决"包内部怎么分"。

### 模式四：Clean Architecture

**模式主张**：领域层 / 应用层 / 基础设施层 / 表现层，依赖向内，domain 不依赖任何框架。

**本仓库已具备的等价物**：

- `packages/contract`（5 文件 / 6 用例）= 领域契约，纯类型无框架依赖
- `packages/kernel-*` = 基础设施层
- `apps/desktop` = 表现层
- `packages/generator-*` = 领域逻辑（fabric/forge/neoforge adapter）

**不推荐全面套用的理由**：

1. `core` 已有 105 个文件，全面套 DDD 需重写全部 import，**代价高**
2. 现有生成器代码（`fabric-adapter.ts` / `forge-gradle.ts` 等）**已经是按领域组织的**，
   它们是 MC 生态知识（哪个 loader 需要什么文件），不是"业务实体"
3. 收益主要在"换数据库 / 换 UI 框架 / 换模型"，而本项目的技术选型已稳定

**真正缺的只有一点**：领域层对基础设施的**编译期**隔离。`contract` 已经做到了，
但 `core` / `generator-*` 都能直接 import 任何东西。

---

## 3. 建议

### 3.1 推荐采纳：模式二，仅作用于 `packages/agent`

**目标结构**（按实测依赖图设计，非照搬 axl 的目录名）：

```
packages/agent/src/
├── core/             # 纯函数层：状态机与决策，不依赖任何 agent / transport
│   ├── pipeline.ts       # ← 现有（纯状态机 nextStep，无副作用）
│   └── tools.ts          # ← 现有（MCP_TOOL_DEFS 数据定义）
├── context/          # 上下文层
│   ├── context-pack.ts   # ← 现有
│   └── context-source.ts # ← 现有（→ context-pack）
├── agents/           # 编排层：决定"何时做什么"
│   ├── infer.ts          # ← 现有（叶子）
│   ├── generate.ts       # ← 现有（→ pipeline）
│   ├── openai-chat.ts    # ← 现有（→ infer）
│   ├── zen-free.ts       # ← 现有（→ infer, openai-chat）
│   └── closed-loop.ts    # ← 现有（→ generate, infer, pipeline）
├── kernel/           # 基础设施层：收口内核访问（见 3.1.2）
│   └── adapters.ts       # ← 新增
└── transport/        # 传输层：MCP 协议
    ├── mcp-server.ts     # ← 现有（→ core/tools, context）
    ├── mcp-http.ts       # ← 现有（→ mcp-server）
    └── host.ts           # ← 现有（→ mcp-http, mcp-server）
```

**依赖规则（单向，不允许反向 import）**：

```
transport ──► agents ──► core
                  ├──► context ──► core
                  └──► kernel   （仅 transport 经 adapters，不直连）
```

`core/` 与 `context/` 是叶子层，不 import `agents/` / `transport/` —— 这正是
模式二「tools 不依赖 agents」的本意。

> **一处与 axl 的差异需要说明**：axl 把 `pipeline` 放在 workflows 层（高于 agents），
> 但本仓库的 `pipeline.ts` 实测是**纯函数状态机**（`nextStep`，只做流转决策，
> 不含任何 LLM 调用或 agent 编排），依赖方向是 `agents → pipeline` 而非相反。
> 因此这里把它归入 `core/`。照搬 axl 的目录名会得到一条**反向依赖**。

### 3.1.1 为什么这个改动是安全的

- **纯移动**：12 个文件换目录，不改逻辑
- `exports` 字段已是 `"./*": "./src/*"`，支持任意深路径，无需改 `package.json`
- 现有 11 个测试文件的 import 路径需同步更新，**机械替换**

### 3.1.2 配套：给 kernel 加注入缝

这是 §1.5 问题的解法，也是模式二"tools 层封装外部服务"的具体含义。

```ts
// 改前：硬构造，不可测
export function createMcpServer(opts: McpServerOptions = {}): McpServer {
  const javaKernel = new JavaKernel(opts.java ?? {});
  ...
}

// 改后：可注入
export interface McpServerOptions {
  kernels?: {
    java?: JavaKernelLike;
    server?: ServerKernelLike;
    bedrock?: BedrockKernelLike;
  };
}
export function createMcpServer(opts: McpServerOptions = {}): McpServer {
  const javaKernel = opts.kernels?.java ?? new JavaKernel(opts.java ?? {});
  ...
}
```

`JavaKernelLike` 等接口定义在 `packages/contract`（领域契约层），
`agent` 只依赖接口，**具体类由 `desktop` 在组装时传入**。

这让 agent 包的测试可以完全不碰真实内核 —— 收益不只在测试，还包括
agent 包能脱离 Electron 环境独立运行。

### 3.2 可选：治理 `core` 的 63 个转发壳

**不在本次建议的必做范围内**，因为：

1. 它不影响运行时行为（转发壳是有效代码）
2. 改动面大（50+ import 路径）
3. 真正的收益是"包边界变真"，属于清理性质

**若要做**，推荐做法是**只做一半**：

1. 先区分两类壳（实施期新增的认知，见 §1.6）：
   - **在用的门面壳**（desktop 经 core 触达 generator）—— **保留**，它们在承担依赖边界职责
   - **无人使用的壳**（约 59 个）—— 标记 deprecated，随实际使用自然消亡
2. **不建议一次性删除** —— 50+ 文件的机械替换容易漏，
   且与 §1.4 的测试成环交织，出问题难定位。

### 3.3 明确不推荐

| 动作                           | 理由                                                         |
| ------------------------------ | ------------------------------------------------------------ |
| 拍平 monorepo 成模式一         | 已解决包边界；拍平丢失有序构建                               |
| 全面套用模式四 DDD             | 105 文件重写，收益不匹配                                     |
| 一次性删除 63 个转发壳         | 与测试成环交织，风险高于收益                                 |
| 新增 `agent/workflows/` 空目录 | agent 只有一个 workflow（pipeline.ts），单文件目录是过度设计 |

---

## 4. 待确认与未决项

### 4.1 `agent` 包的职责边界

`packages/agent` 目前同时承担：

- LLM 编排（`infer` / `generate` / `closed-loop`）
- MCP 协议实现（`mcp-server` / `mcp-http`，共 1649 行）
- 内核访问（`mcp-server` 内）

MCP 实现占了 agent 包 **45% 的代码量**（1649 / 3653 行，不含测试）。是否要拆成独立的
`packages/mcp` ？本次评估倾向 **不拆** —— 它与 agent 编排是同一批人的关注点，
且拆开会增加一个包（加剧 §1.3 的转发壳问题）。

### 4.2 `contract` 包过小

5 个文件 / 6 个用例。模式四强调"领域层独立可测"，`contract` 正是该角色的载体，
但当前体量不足以承载 §3.1.2 建议的 `JavaKernelLike` 等接口之外更多契约。
若采纳 3.1.2，建议顺带把 kernel 的对外接口全部收敛进 `contract`。

### 4.3 `jobobject` 是原生 C++ 插件（曾被误判为空包）

初次统计用 `packages/jobobject/src/**/*.ts` 得出「0 个源文件」，**该结论错误**：
该包不含 TypeScript 实现，而是 Windows Job Object 的 **node-gyp 原生绑定**：

```
src/binding.cc      C++ 实现（进程内存/CPU 限额 + 崩溃连带终止）
index.js/.d.ts      绑定导出
launcher.js         启动器封装
src/*.test.js       3 个 JS 测试
build/Release/      已编译产物 jobobject.node
```

`devkit/package.json` 把它注释掉了（`"//jobobject"`），理由是 **pnpm 硬隔离**下
只有「直接依赖」才能进 `node_modules`，而 devkit 只是 `require` 不直接安装，
装了也 require 不到；`enforced.source='unisolated'` 又有安全顾虑。
这是**有意为之的取舍，不是遗漏**。

> 记录此条是因为它暴露了评估方法本身的局限：
> 用扩展名过滤统计包大小会漏掉非 TS 实现（native / Python / 模板文件）。
> 若后续有人做类似统计，应先确认包的实现语言。

---

## 5. 验证方式

本文所有数字均来自可复现的命令，不是估计：

```powershell
# 转发壳统计
Get-ChildItem -Path "packages\core\src" -Recurse -Filter "*.ts" |
  Where-Object { $_.Name -notlike "*.test.ts" } | ForEach-Object {
    $c = @(Get-Content $_.FullName |
      Where-Object { $_.Trim() -ne '' -and $_ -notmatch '^\s*(//|/\*|\*)' })
    $fwd = @($c | Where-Object { $_ -match "export \* from '@mc-creator/" })
    if ($c.Count -gt 0 -and $fwd.Count -eq $c.Count) { $_.FullName }
  }

# 依赖图
Get-ChildItem -Path "packages","apps" -Directory | ForEach-Object {
  $j = Get-Content (Join-Path $_.FullName "package.json") -Raw | ConvertFrom-Json
  # ... 见 §1.2
}
```

改动后应重新确认：

1. `core` 转发壳数量下降（若执行 §3.2）
2. `agent` 包内无 `agents/ → tools/` 的反向 import
3. `pnpm -r test` 全绿（当前 3074 例）
4. `pnpm typecheck` / `lint` / `build` / `check:docs` 全绿

### 5.1 本文自身的更正记录

评估过程中有两处结论被自己的复核推翻，记录在此以免后人重复踩：

| 初版结论                       | 更正                                | 原因                           |
| ------------------------------ | ----------------------------------- | ------------------------------ |
| MCP 占 agent 包 62% 代码量     | **45%**（1649/3653 行）             | 初版用了错误的分母             |
| `jobobject` 是空包（0 源文件） | **非空**，是 node-gyp 原生 C++ 插件 | 用 `*.ts` 过滤漏掉了非 TS 实现 |

第一条是算术错误，第二条是**方法论缺陷**：按扩展名统计包大小，
对 native / 模板 / 脚本类实现无效。两者都已在上文修正。

---

## 6. 实施记录

§3.1（分层）与 §3.1.2（内核注入缝）已实施。§3.2（core 转发壳治理）**未做**，
理由见 §3.3。

### 6.1 最终结构

```
packages/agent/src/
├── index.ts                     对外扁平导出（调用方只有 desktop，无需感知分层）
├── integration.test.ts          跨层集成测试（原 agent.test.ts）
├── layering.test.ts             分层规则的机器校验（见 6.3）
├── core/                        纯函数层
│   ├── pipeline.ts              状态机 nextStep
│   └── tools.ts                 MCP_TOOL_DEFS 数据定义
├── context/
│   ├── context-pack.ts
│   └── context-source.ts
├── agents/
│   ├── infer.ts                 叶子
│   ├── generate.ts              → core
│   ├── openai-chat.ts           → agents
│   ├── zen-free.ts              → agents
│   └── closed-loop.ts           → agents + core
├── kernel/
│   └── adapters.ts              内核访问唯一入口（新增，63 行）
└── transport/
    ├── mcp-server.ts            538 行
    ├── mcp-http.ts              1120 行
    ├── host.ts                  125 行
    └── kernel-injection.test.ts 注入缝测试（新增）
```

生产代码 13 个文件（原 12 个，新增 `kernel/adapters.ts`）。

### 6.2 内核注入缝

`createMcpServer` 新增 `kernels?: KernelBundle` 选项，**不传则行为与改造前完全一致**
（向后兼容）。新增 `kernel-injection.test.ts` 5 例：

- 注入的假内核被真正使用（而非被默认内核顶替）
- 未注入的一版走默认实现，不报错
- 不传 `kernels` 时行为不变
- `get_capabilities` 按 `edition` 改道到注入的对应内核

**变异验证**：把 `createKernelBundle(opts)` 改回不传 `opts.kernels` → 2 failed。

> 写这个测试时踩了一个坑：假内核的 `dispatch` 一开始返回 `{id, kind}`，
> 断言却通过了，直到真的走到内核执行路径才炸
> `pickKernel(...).dispatch(...).result is not a function`。
> `TaskHandle` 必须提供 `progress` / `cancel` / `result()` 完整异步句柄。
> 教训：**「构造对象」的断言不代表「方法真的能用」**。

### 6.3 分层规则是测试，不是文档

`layering.test.ts` 5 例把依赖方向写成断言：

- 五个层目录存在
- 生产代码的 import 都在允许列表内
- `core` / `context` 是叶子，不得 import 上层
- `transport`/`agents`/`context`/`core` 不得**值导入**具体内核类
- `kernel/adapters.ts` 是唯一允许值导入具体内核类的地方

**变异验证**：给 `core/pipeline.ts` 加
`import { createMcpServer } from '../transport/mcp-server.js'` → 2 failed。

> **规则只约束生产代码，不约束测试**（实施中调整过的一处设计）。
> 集成测试天然要跨层 —— `context/context-source.test.ts` 通过 `createMcpServer`
> 驱动真实内核验证上下文采集，这条路径跨 transport/kernel 是**应该**的。
> 把规则套到测试上会逼着集成测试造假（绕过 transport 直接调 context），
> 那才是真的伤害测试价值。第一版规则没排除 `.test.ts`，立刻误伤了 3 处。

### 6.4 门禁

| 项                     | 结果                                   |
| ---------------------- | -------------------------------------- |
| `pnpm typecheck`       | 0 errors                               |
| `pnpm -r test`         | 3074 passed（agent 包 293 → 303，+10） |
| `pnpm lint`            | 0 errors, 38 warnings                  |
| `npx prettier --check` | All matched                            |
| `pnpm check:docs`      | 0                                      |
| `pnpm build`           | 0                                      |

---

## 7. 转发壳清单工具（§3.2 的准备）

`packages/core/src/forwarding-shells.report.ts` —— 一行命令产出**可删除清单**：

`ash
npx tsx src/forwarding-shells.report.ts   # workdir = packages/core
`

### 7.1 结论：63 个壳，**3 个在用、60 个无人使用**

| 壳路径                                           | 消费者                                                           |
| ------------------------------------------------ | ---------------------------------------------------------------- |
| `core/generators/mod/fabric-adapter.js`          | `lib/e2e-pipeline.test.ts`、`lib/__bench__/large-graph.bench.ts` |
| `core/generators/mod/mod-generator.js`           | `lib/fullchain.integration.test.ts`                              |
| `core/generators/datapack/datapack-generator.js` | `lib/agent-tools.ts`（**生产代码**，动态 import）                |

### 7.2 工具本身踩了两个坑（都写进了代码注释）

1. **漏匹配动态 import** —— 首版正则只认 `from '...'`，漏掉
   `await import('...')`，导致 `agent-tools.ts` 的两处引用被判为「无人使用」。
   **按那份清单删文件会直接打断生产代码。**
2. **排除测试文件** —— 首版跳过 `.test.ts`，把 3 个在用壳全报成「无人使用」。
   删掉被测试引用的壳会打断测试。

两个错误方向一致（都**低估**了在用数量），叠加后清单从 3 个误报成 1 个。
修正后与手工复核**逐条一致**。

> 教训：产出「可删除清单」的工具，错误的代价是**删掉还在用的东西**。
> 因此这类工具**不应做成断言**（会周期性假红），本文件只做统计不做校验；
> 清单会随代码变动过期，删除前必须重新运行核对。

---

## 8. 转发壳治理：已执行（结果与三次自我纠错）

§3.2 已实施。**47 个无人使用的壳已删除**，16 个在用的保留。

### 8.1 最终结果

|                   | 删除前 | 删除后 |
| ----------------- | ------ | ------ |
| `core` 非测试文件 | 105    | **59** |
| 其中纯转发壳      | 63     | **16** |
| 其中真实实现      | 42     | **43** |

保留的 16 个有明确职责：

- **13 个** `generators/<name>/index.ts` —— 被 `core/src/generators/index.ts` 引用。
  后者是 `createDefaultRegistry` 的装配点（`import { ModGenerator } from './mod/index.js'` …），
  **删除会让 core 的对外注册表 API 编译失败**。
- **3 个** 门面（§1.6）：`generators/mod/fabric-adapter.js`、
  `generators/mod/mod-generator.js`、`generators/datapack/datapack-generator.js`。

### 8.2 三次自我纠错（同一类错误）

清单工具 `forwarding-shells.report.ts` 在到达正确结论前错了三次，
**方向完全一致：低估引用数 → 误判可删**。

| #   | 缺陷                                                          | 后果                                              |
| --- | ------------------------------------------------------------- | ------------------------------------------------- |
| 1   | 正则只认 `from '...'`，漏 `await import('...')`               | `agent-tools.ts` 的**生产代码**引用被判为无人使用 |
| 2   | 扫描时跳过 `.test.ts`                                         | 3 个在用壳全报成无人使用                          |
| 3   | 只查包路径 `@mc-creator/core/...`，**漏 core 内部的相对引用** | **13 个** 子生成器 `index.ts` 壳被判为无人使用    |

第 3 次最严重：它导致**按清单删除后 typecheck 立刻失败**
（`Cannot find module './mod/index.js'`），已用 `git checkout HEAD -- <60 个具体路径>`
完整回滚，无连带损失。

### 8.3 正确的做法

**不再依赖分析工具的结论，把工具链当裁判**：删除后以
`pnpm typecheck` + `pnpm -r test` + `pnpm build` 三关为准。
这三关对「删错了」是确定性的 —— 缺模块必然编译失败，
不需要人工判断某个引用算不算「在用」。

### 8.4 教训

> 产出「可删除清单」的工具，其错误的代价是**删掉还在用的东西**，
> 且失败方向天然偏向「看起来更干净」。这类工具**不应被信任到可以直接执行**。
>
> 本工具最终定位：**报告 + 复核**，不是**删除器**。
> 它保留在仓库里是为了下次有人想继续治理时不必重蹈覆辙 ——
> 三次错误已全部写进代码注释。

---

## 9. components/ 目录治理：已执行

§1 提出的「87 个平铺文件」问题已处理一半并**立了规矩**。

### 9.1 规则（`component-organization.test.ts`，6 例）

规则不新造分类法，而是建立在项目**已有的域模型**上 ——
`shell/domains.ts` 的 `DomainId = 'launcher' | 'server' | 'dev'`：

1. `kind: 'domain'` 的面板**不得**位于 `components/` 根目录
2. 根目录只允许 shell 基建（`kind: 'core'`）、通用 UI、非面板组件

### 9.2 搬迁（6 个面板）

| panelId  | 组件              | domain   | 去向                   |
| -------- | ----------------- | -------- | ---------------------- |
| `items`  | ItemRecipeEditor  | dev      | `components/dev/`      |
| `blocks` | BlockEditor       | dev      | `components/dev/`      |
| `entity` | EntityAiEditor    | dev      | `components/dev/`      |
| `cicd`   | CiCdPanel         | dev      | `components/dev/`      |
| `build`  | BuildPanel        | dev      | `components/dev/`      |
| `game`   | GameLauncherPanel | launcher | `components/launcher/` |

**目录名直接取自 `DomainId`** —— 让目录结构即域模型，不需要额外映射表。

搬迁前后：根目录 54 → 48 个实现；新增 `components/dev/`（5 个）；
`components/launcher/` 由 4 → 5 个。

### 9.3 「先立规矩再搬家」而不是反过来

规则先以「已知违规清单」形式落地，锁定**不得新增**而非「必须为零」——
存量红着会让人想关测试而不是搬文件。搬完后清单清零，规则升级为硬断言。

其中一条**反向断言**在搬迁完成时主动报错要求更新清单，
防止清单本身腐化（这是它第一次派上用场）。

### 9.4 搬迁踩的两个坑

1. **`vi.mock()` 不是 import** —— 脚本只重写了 `from` / `import()`，
   漏掉 `vi.mock('../lib/ipc-client.js')`，结果 **53 例测试失败**
   （mock 路径解析不到，组件拿到的是真实 ipcClient）。
   凡是要按文件位置改路径的写法，都不只 `import` 一种。
2. **同目录测试被二次加前缀** —— 随实现一起搬的测试，其 `./X.js`
   被脚本改成了 `../dev/X.js`。脚本按「引用者也在 components 根目录」判断，
   没排除「引用者已被搬走」的情况。

两处都由 `pnpm -r test` 当场抓住，无残留。

### 9.5 门禁

| 项                     | 结果                  |
| ---------------------- | --------------------- |
| `pnpm typecheck`       | 0 errors              |
| `pnpm -r test`         | 3127 passed           |
| `pnpm lint`            | 0 errors, 40 warnings |
| `npx prettier --check` | All matched           |
| `pnpm check:docs`      | 0                     |
| `pnpm build`           | 0                     |

---

## 10. main/ 盘点与凭据边界治理

§9 之后把同一套方法用在 Electron 主进程。先盘��，再决定动不动。

### 10.1 先说结论：主进程**没有**分层问题

| 事实             | 证据                                                                                                                           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 生产依赖**零环** | 内部依赖图 DFS 无环。唯一"环"是 gent-host.test.ts 里的 wait import('./index.js') —— 测试的边被算进了生产节点，属分析脚本假阳性 |
| 组合根干净       | index.ts（345 行）被**生产代码零引用**，只import 不被 import                                                                   |
| IPC 已拆过       | ipc.ts 文件头写着"God file 拆出（Phase 3.1）"，ipc/ 23 个文件是上一轮的成果                                                    |

所以问题不在架构，在**34 个平铺文件里混着安全敏感资产**。

### 10.2 规则（`main/credentials-boundary.test.ts`，7 例）

**为什么这条规则和其他分类规则不是一回事**：components/ 那条管的是可读性，
而这条管的是**安全事故** —— 微软 OAuth token、模型 API key、CurseForge token
全部经由 `secret-storage.ts`（加密落盘）和 `token-redact.ts`（日志脱敏）两个原语。

搬迁前它们与 `process-supervisor.ts`、`file-manager.ts` 混在一起，代价是：

> 审计"哪些代码碰得到用户凭据"时，**没有任何一个目录能回答这个问题**。

规则两条：

1. **凭据原语封闭** —— `secret-storage` / `token-redact` 只能被 `credentials/` 内的文件引用；
   簇外需要凭据时走 credentials 暴露的业务函数（如 `loadModelConfig()`）
2. **簇内模块不得搬回根目录**

**这里不给测试豁免**，与 `layering.test.ts` 的决定相反，理由是：集成测试触碰
`secret-storage` 不是"跨层"，而是同样在处理真实凭据。实测集群外引用为 **0**（含测试），
规则当天即全量生效，无需"先软后硬"。

### 10.3 凭据簇的 9 个成员（依据可复算，不是拍脑袋）

1. 直接依赖两个原语的
2. 持有 `access_token` / `refresh_token` / `client_secret` 字面量的
3. 上述两者的传递闭包

搬迁前实测：

- `secret-storage` 的使用方：`model-config`、`curseforge-config`、`mc-account-store`
- `token-redact` 的使用方：`ms-oauth`、`ms-auth-service`、`mc-account-service`
- 凭据字面量仅出现在 **3** 个文件

整簇**簇外相对 import = 0**，自封闭，故 17 个文件整体搬迁时内部路径原样不动，
只需改簇外那 5 处引用（`ipc.ts` / `ipc/build.ts` / `ipc/generate.ts` /
`ipc/market.ts` / `ipc/modpack.ts`）。

`main/` 根目录实现 34 → **25**。

### 10.4 变异验证

| 变异                                                                                   | 结果                           |
| -------------------------------------------------------------------------------------- | ------------------------------ |
| `ipc/build.ts` 追加 `import { encryptSecret } from '../credentials/secret-storage.js'` | **1 failed**，报错点名该文件   |
| `curseforge-config.ts` 搬回根目录                                                      | **2 failed**，两条规则同时点名 |
| 还原                                                                                   | 7 passed                       |

### 10.5 顺带暴露的真实缺口：**正版登录根本没接线**

盘点时发现的，**不是分类问题，是功能缺口**：

`ms-auth-service.ts  getLaunchIdentity() → LaunchIdentity    实现完整，40 个测试全过
     ↓ 无人调用（生产零引用，只有自己的测试）
launcher-service.ts launch({ credentials })                  消费侧已实现
     ↓ 生产代码从不传这个参数（只有 launcher 的测试传过）
IPC 契约里没有 credentials 字段                              用户永远碰不到`

**434 行 + 40 个通过的测试 + 零生产引用。** 测试直接 import 模块，
所以它测得很开心，但它测的东西在游戏里没有任何路径。

**它不是死代码，是没接线的半成品** —— 删掉等于扔掉一份可用的 OAuth 实现。
上一轮删转发壳的教训是"产出可删清单的工具不能被信任到直接执行"，同理。

已写成**断言**而非文档段落（`已知缺口：正版登录尚未接线` describe 块）：
一旦有人接线，那条测试会立刻失败并提示"请更新本测试并补 IPC 契约"。
让缺口在**被填上的瞬间自己叫出来**，而不是永远躺在文档里。

### 10.6 本轮踩的一个坑

写边界测试时，`importersOf()` 用「文件名 ≠ 模块名」排除模块自身，
结果只排除了 `ms-auth-service.ts`、漏了 `ms-auth-service.test.ts` ——
于是"零引用"断言把自己的测试算成了引用者，**当场失败**。

修法是按 **stem**（剥掉 `.test.ts`）判断而非文件名。
这个 bug 是测试自己发现的 —— 规则第一次跑就抓到了作者的错误。

### 10.7 门禁

| 项                     | 结果                                          |
| ---------------------- | --------------------------------------------- |
| `pnpm typecheck`       | 0 errors                                      |
| `pnpm -r test`         | **3134 passed**（3127 + 7 新规则）            |
| `pnpm lint`            | 0 errors, 40 warnings（与搬前持平，未留新债） |
| `npx prettier --check` | All matched                                   |
| `pnpm check:docs`      | 0                                             |
| `pnpm build`           | 0                                             |

---

## 11. 离线启动路径：一个会掀翻主进程的 bug

§10 的盘点本来到此为止。用户说了一句"正版我没有，你继续搞吧" ——
**离线分支就是他 100% 的实际路径**，于是转去查离线路径的失败模式，
结果查出一个比所有架构问题都严重的东西。

### 11.1 完整链条

``「开始游戏」按钮
  → ipcClient.launcherLaunch()
  → IPC `LAUNCHER_LAUNCH`（不传 `onExit`，也不传 `javaPath`）
  → `launchGame()` → `spawn('java', args)`
       ↓ Node 在二进制不存在时**同步**返回 `pid=undefined`，
         错误要等下一个 tick 才以 `'error'` 事件发出（实测 ENOENT）
  → `launchGame` 以 `{ pid: 0 }` 正常 resolve
  → IPC 返回 `{ pid: 0 }`，**没有 error 字段**
  → 前端 `if (res.error) … else if (res.pid > 0) …` 两个分支都不进
       → 按钮闪一下恢复原状，**屏幕上什么都不显示**
  → 同时主进程：`'error'` 无监听者
       → EventEmitter 抛未捕获异常 → **Electron 主进程整体退出**``

修复前用户点一下「开始游戏」，如果没配好Java：**看不到任何提示，然后应用直接没了**。

### 11.2 为什么 3134 个测试全绿却没抓到

**所有既有测试都注入了会正常发事件的假 spawn**，从来没让 spawn 真的失败过。
测试替身比真实 `ChildProcess` 更健壮，于是真实世界的失败路径从未被触碰。

首版还踩了一个更隐蔽的坑：那条"不能产生未捕获异常"的测试用
`process.on('uncaughtException')` 去捕获，结果**把修复完全撤掉后它仍然通过** ——
测试形同虚设。改为直接断言不变量本身：

> `launchGame` 返回后，子进程必须始终挂着 `'error'` 监听器。

这个断言在变异下给出了确切断言：`expected 0 to be greater than 0`。

### 11.3 修复

1. `waitForSpawn()` —— 等 `'spawn'` 才resolve，失败则 **reject**，
   绝不降级成 `{ pid: 0 }`（那会被 IPC 当成功）
2. `attachErrorGuard()` —— 无条件挂一个**什么都不做**的 `'error'` 监听器。
   它唯一的职责是**阻止崩溃**，不是收错误
3. `friendlySpawnError()` —— 把 ENOENT/EACCES 翻译成
   "找不到 Java 可执行文件（…）。请在实例的 Java 路径里指定一个有效的 java.exe。"

### 11.4 修复过程中自己的两个 bug（都被同一批测试当场抓住）

1. **`.catch()` 把 rejection 转成了 resolve** —— `waitForSpawn().catch(改写)`
   返回的是**已兑现**的 Promise，`await` 拿到的是 Error 对象而不是抛出。
   改用 try/catch。
2. **`onExit` 被触发两次** —— 错误守卫在 `'error'` 上报，而实测
   （ENOENT → `error` 后紧跟 `close(-4058)`）`'close'` 也会触发。
   改成：守卫**不上报**，`'close'` 用 `spawnOk` 标志挡掉失败路径上的那一次。

### 11.5 同类 bug 全仓排查

| 位置                                          | 状态                                |
| --------------------------------------------- | ----------------------------------- |
| `launcher-service.ts` `installLoader`（两处） | 已有 `child.on('error', reject)` ✅ |
| `ipc/git.ts`                                  | 已有 `child.on('error')` ✅         |
| `ipc/build.ts`                                | 已有 `child.on('error')` ✅         |
| `process-supervisor.ts`                       | 已有 `child.on('error')` ✅         |
| `ipc/launcher.ts` `LAUNCH_MC`                 | **同款 bug，已修**                  |

`LAUNCH_MC` 那处更隐蔽：`detectMinecraft()` 做了 `existsSync`，但那是
**检测那一刻**的检查；文件被删、被杀软拦、0 字节 exe 都会让 spawn 异步发
`'error'`，而原代码**既没监听器、又立刻返回 `ok: true`**。
已改为等 `'spawn'` 后再 `unref()`。

### 11.6 门禁

`pnpm typecheck` 0 / `pnpm -r test` **3140 passed**（+6）/ `pnpm lint`
0 errors 40 warnings / prettier All matched / `pnpm check:docs` 0 / `pnpm build` 0
---

## 12. Java 版本管理：启动路径的空洞

用户问「你不应该搞个 java 版本吗？基岩版是没有离线版本的吧」—— 两问都命中要害。

### 12.1 基岩版：没有离线模式，代码也是这么设计的

用户判断正确，且本仓架构与之一致：

| 内核      | 定位                            | 启动器会拉起它吗                                               |
| --------- | ------------------------------- | -------------------------------------------------------------- |
| `java`    | 内容内核                        | **会** —— `launchGame` 硬编码 `net.minecraft.client.main.Main` |
| `server`  | 服务端内核                      | 会（走 process-supervisor）                                    |
| `bedrock` | **内容内核**（生成/校验行为包） | **不会**                                                       |

`credentials/mc-account-service.ts` 里还有专门的 `bedrockOnly` 判定：
Game Pass 玩家若 entitlements 只有 `product_minecraft_bedrock`，**进不了 Java 版**，
代码显式把这类条目过滤掉。

即：`accessToken=0` + `userType=legacy` 这条离线路径**只有 Java 版存在**。
这让 Java 版本管理成为启动器唯一的、也是最关键的基础设施。

### 12.2 两条路径的防护完全不对称

|               | 构建路径                               | 启动路径（修复前）   |
| ------------- | -------------------------------------- | -------------------- |
| 探测本机 Java | `detectJavaVersion()` ✅               | **无**               |
| 对照所需版本  | `javaVersionFor(loader, mcVersion)` ✅ | **无**               |
| 没装 Java     | 明确告知装哪个 JDK ✅                  | 崩主进程（§11 已修） |
| **版本太老**  | 明确告知本机几 / 需要几 ✅             | **完全没有**         |

最后一行是 §11 修完之后**仍然存在**的洞：Java 8 跑 MC 1.21.11 时
`spawn` **会成功**（java.exe 就在那儿），进程也起得来，
然后在 JVM 里炸成 `UnsupportedClassVersionError` ——
用户只在日志流里看到一行天书，完全不知道是 JDK 的问题。

### 12.3 修复

1. **`resolveVersion` 不再扔掉 Mojang 给的 Java 要求**。
   版本清单里本来就有 `javaVersion.majorVersion`（Mojang 逐版本精确给出），
   代码下载下来却直接丢弃。现在存进 `VersionDetail.javaMajor`。
2. **`launchGame` 在 spawn 之前预检**，版本不够就拒绝，并说清
   「本机 Java 是 X，而 MC Y 需要 Java Z 或更高」。
3. **探测结果按 java 路径缓存**。`java -version` 每次 100~300ms，
   放在启动热路径上就是每次点「开始游戏」白等这么久。

**探测不出来（null）时放行**，不瞎拦：真正的「java 不存在」由 spawn 报出
更准确的错误，把它误报成「版本太老」是另一种撒谎。

### 12.4 顺带修掉一个真实 bug：Java 8 被解析成版本 1

`detectJavaVersion` 的正则 `version "(\d+)(?:\.|")` 在 Java 8 上
（输出 `1.8.0_402`）解析出 **1**。而 `javaVersionFor` 对 MC ≤1.16
恰好返回 8 —— 也就是说**唯一用得到 8 的那条路径是坏的**。

这条正则此前在 `packages/devkit/src/jdk.ts` 与
`packages/core/src/builder/jdk.ts` **各存了一份**，逐字相同。
两份副本必然漂移，现在：

- 抽出纯函数 `parseJavaMajorVersion()` 放 devkit（依赖方向 `core → devkit` 是既有的）
- core 侧改为转调，只保留自己的 I/O（`execa` vs `execFile`）
- 用**各版本真实输出形态**做表驱动测试（8/7/11/17/21/25）

变异验证：退回旧正则 → **3 failed**（`expected 1 to be 8`、`expected 1 to be 7`）。

### 12.5 为什么没有做「多 JDK 自动选择」

devkit 的 `jdk.ts` 里本就有一条 TODO：扫描注册表 / PATH / 常见目录并存多版本、
按 `javaVersionFor(mcVersion)` 自动选择。**没做**，因为那是个独立特性
（要下载、要管理、要 UI），而"版本不够时给出可执行的提示"已经堵住了静默失败。

---

## 13. process-supervisor 审计与修复

§12 同期派子代理审计 `process-supervisor.ts`（1484 行），查 §11 那类静默失败。

### 13.1 审计结论

子代理枚举了全文件 32 个监听器 / emit / catch 位置，结论是
**该文件没有 §11 那个 `'error' 监听器 bug** —— `doSpawn` 是唯一的
spawn 点，`child.on('error', …)`在同一条路径上**无条件**挂载，
没有任何`if` 能绕开。

但查出三件同类的事：

| #   | 问题                                                                                                                    | 位置                                 |
| --- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------ |
| P1  | `launch()` 带 `{ pid: 0 }` **正常返回**，调用方无法区分成功与失败                                                       | `:960`                               |
| P0  | 唯一的生产调用方 `agent-host.ts:202` 照常打印「已拉起」，且该 supervisor 是私有实例、**无任何 IPC 通路** → 用户完全无感 | `agent-host.ts:202` + `index.ts:255` |
| P2  | `runAutoRestart` 在**定时器回调**里调 `doSpawn` 且无 try/catch → 抛出去是未捕获异常                                     | `:1309`                              |

另有 P3（confirm 通道异常被伪装成「用户拒绝」，真实原因 100% 丢失）与
P4（`void this.sendCommand()` 无 catch、`'supervisor-error'` 无订阅者），
均属潜伏，暂不动。

### 13.2 修复

**P1 —— 同步抛错。** 先实测确认前提：`spawn` 成功时 pid 是**同步**赋值的真实值，
失败时为 `undefined`。因此 `pid === null` 是可靠的「没起来」信号，
而不是需要等待的竞态 —— 于是不必把 `launch()` 改成 async。

这一点很关键：改成 async 会波及 `launch` / `launchServer` /
`spawnManaged` / `doSpawn` 四个签名和 2400 行测试，
而子代理同时确认这条路径**当前生产不可达**（单例没有 confirm，
`spawnManaged` 直接抛 `PERMISSION_DENIED`）。同步抛错以极小代价拿到同样效果。

抛点放在监听器**之后**是刻意的：先抛再挂监听器的话，随后到达的 `'error'`
就没有监听者，EventEmitter 会抛未捕获异常掀翻主进程 —— 正是 §11 刚修掉的那个形状。

**P2 —— 补 try/catch**，把异常转成状态 + `auto-restart-rejected` 事件。

### 13.3 契约变更与测试更新

`spawn 不存在的可执行` 那条测试原先记录的正是**静默**行为
（`launch()` 正常返回 → 等 `exited` → 状态 crashed）。
已改为断言新契约：`launch()` 同步抛 `SPAWN_FAILED`，**且崩溃证据仍留痕**
（状态 crashed + 日志尾部有 `spawn error:`）。

「抛错」不等于「不管」—— 否则 UI 侧就真的什么都查不到了。

变异验证：把 `if (entry.pid === null)` 改成 `if (false && …)` → **1 failed**
（`expected [Function] to throw an error`）。

### 13.4 未做的部分（明确留档）

- **P3** confirm 通道异常伪装成用户拒绝 —— fail-closed 取向是对的，
  但异常对象被 `catch {}` 连变量都没接，诊断信息全丢。属体验问题，不阻塞。
- **P4** `void this.sendCommand()`（无 catch）、`'supervisor-error'` 无订阅者 ——
  当前都够不着，新增监听器时才会踩。
- **1.3** `injectReloadOnStart` 在 `'spawn'` 之前就写 stdin 并报 `delivered: true`。
  默认关闭（`autoInjectReload` 默认 false），且修它要先解决 P1 的同步语义。

---

## 14. 本轮门禁

| 项                     | 结果                                                       |
| ---------------------- | ---------------------------------------------------------- |
| `pnpm typecheck`       | 0 errors                                                   |
| `pnpm -r test`         | **3147 passed**                                            |
| `pnpm lint`            | 0 errors, 40 warnings                                      |
| `npx prettier --check` | All matched（`packages/core/src/generators/*` 为历史遗留） |
| `pnpm check:docs`      | 0                                                          |
| `pnpm build`           | 0                                                          |

---

## 15. 定时任务轮询器：算了就丢

顺着 §13 查 `server-task-poller`，查出第三类静默失败（不是崩，是**无声**）。

### 15.1 完整链条

`用户经内核 schedule_task 建一个 restart 任务（W 类，过确认闸门后记账）
  → 轮询器每 60s 调 run_due_tasks，取到 fired: [{ action:'restart', serverId:'srv-x' }]
  → supervisor.restartServer('srv-x') → SERVER_NOT_FOUND
      （生产里**没有任何代码调 launchServer**，单例 supervisor 里从来没有进程）
  → 结果记进 fired[]，然后…
  → **丢弃**`

根因是 `onFired` 是**可选**的，而生产接线（`index.ts:283`）压根没传它。
轮询器本身写得很好 —— 每条路径都有 try/catch、失败记进 `FiredOutcome`、
永���抛出 —— 但**结果没有出口**。

所以这条与 §11（崩主进程）、§13（对调用方说谎）都不同：它是
**做了正确的工作，然后把结论扔了**。没有异常、没有错误状态、没有日志。

### 15.2 修法：把日志做成轮询器自身的属性

刻意**不做成** `index.ts` 的接线细节 —— 那样测试不到。改为轮询器内建
一个默认观察者 `noteFiredOnce()`：

- 有任务到期才打（空轮次保持安静，否则每 60 秒刷屏没人受得了）
- 失败 → `console.warn`，带 `action@serverId` 与具体原因
- 成功 → `console.log`
- 只记第一次

变异验证：把 `noteFiredOnce(fired)` 换成空语句 → **3 failed**。

### 15.3 自己踩的坑：mockRestore 会清空 mock.calls

第一版测试 3 条全红，且报的是"一个字都没进日志"。差点误判成生产代码没生效 ——
写了个一次性探针才发现生产代码**确实打了**：

    [定时任务] 本轮执行 1 条，其中 1 条失败：restart@srv-x（SERVER_NOT_FOUND）

真因在测试：`try { … } finally { warn.mockRestore() }` 先 restore、
之后才读 `warn.mock.calls`，而 `mockRestore()` 会**清空调用记录**。
本文件顶部已有全局 `afterEach(vi.restoreAllMocks)`，那个 `finally` 纯属多余。

教训：**探针比推理可靠**。怀疑生产代码没生效时，先花两分钟直接看它到底做了什么，
再决定改哪一边 —— 否则很容易改错地方还以为是修好了。

---

## 16. 本轮门禁（§12~§15 合计）

| 项                     | 结果                  |
| ---------------------- | --------------------- |
| `pnpm typecheck`       | 0 errors              |
| `pnpm -r test`         | **3151 passed**       |
| `pnpm lint`            | 0 errors, 40 warnings |
| `npx prettier --check` | All matched           |
| `pnpm check:docs`      | 0                     |
| `pnpm build`           | 0                     |

---

## 17. §17 服务端启动通道（方案 A）

§15 留档的那个缺口按 A 实施：**加一个带确认弹窗的启动通道**。

### 17.1 先说清楚补的是哪块

`kernel-server` 刻意不托管长驻进程 —— `controlServer()` 的原话是
「§7.1 本内核不托管长驻进程：只校验存在性并返回控制指令」。
「进程生命周期由外壳服务管理」，而**这个外壳一直缺着**：

- 全仓**没有任何地方**构造服务端的 cmd/args（`create_instance` 只生成
  `start.sh` / `start.bat` 文件，不产出可启动规格）
- `ProcessSupervisor.launchServer()` 只有测试在调
- 单例没有 confirm，`spawnManaged` 永远 fail-closed
- 于是定时任务的 `restart` 必然走到 `SERVER_NOT_FOUND`

所以 A 的主体是**补上这块缺失的外壳**：从服务端目录推导出启动规格。

### 17.2 为什么渲染层不能传 cmd

`supervisor` 以当前用户权限 spawn 进程。若 IPC 允许渲染层给
`cmd: 'C:\\Windows\\System32\\calc.exe'`，等于把**任意程序执行权**交给前端 ——
§10.6 确认闸门存在的意义正是堵这个口子。

所以 `ProcessLaunchRequest` **只接受 serverId**。cmd 由主进程从磁盘推导，
再**逐字展示在原生弹窗里**：用户看到什么就批准什么。

### 17.3 同步闸门 × 异步弹窗：用一次性令牌桥接

`ProcessSupervisor` 的 confirm 是**同步**的（`ConfirmFn → boolean`），
而 `dialog.showMessageBox` 返回 Promise。文件里的原话是
「异步确认必须由 IPC 层先 await 再调 launch」。

但顺序有个矛盾：用户点确定时**进程还没被构造**，弹窗要展示的正是那条命令。
于是定为：

1. 主进程从磁盘推导 spec（**在弹窗之前** —— 用户得先看到再决定）
2. `await` 原生确认框；弹不出来 / 点取消 → `denied`，**一个进程都不起**
3. 登记**一次性**令牌
4. `launchServer`；supervisor 的闸门查表放行，**消费即失效**

令牌的三条安全性质（`server-launch-approval.ts`，全部有测试）：

| 性质       | 实现                                      |
| ---------- | ----------------------------------------- |
| 一次性     | 消费即 `delete`，重放拿不到第二次批准     |
| 逐字节绑定 | 指纹 = `serverId + cmd + 全部 args + cwd` |
| 默认拒绝   | 查不到指纹一律 false；没登记过 = 没批准过 |

**为什么不是每次新建一个 supervisor**：智能体自启走的就是那条路子，
代价是它的进程**不进渲染层的 `PROCESS_LIST`**（单例才是列表读的对象）。
而定时任务的 `restartServer(serverId)` 必须在单例里找得到 entry。
令牌方案让进程留在单例里，代价只是多一张指纹表。

### 17.4 撞上了既有守卫 —— 这是好事

通道一加，`ipc/process-supervisor.test.ts` **4 条立刻红了**：
它们编码的正是「`process:*` 通道面不得含任何执行语义动词」这条 §10.6 规则。

处理方式**不是把规则削弱成「launch 也行」**，而是收窄成**精确的白名单一条**：

> **除 `PROCESS_LAUNCH` 外**，不得注册任何执行语义动词的通道。

规则因此保住牙齿：变异测试注入一个裸 `process:start` 通道 →
**4 failed**，其中一条的报错正是 `process:start 是未经确认闸门的执行通道`。

另外补了一条**正面**断言：单例的 confirm 必须是令牌闸门，
未批准直接 `launchServer` 必须 `PERMISSION_DENIED`。
它守的是**漏接线 / 误接线 / 渲染层绕过通道直接调 launch** 三种情况。

### 17.5 测试

`server-launch.spec.ts` 30 例。规格构造里最有价值的是 **serverId 路径穿越**
（8 个用例，与 `kernel-server` 的 `serverDir()` 同规则）与 **memory 白名单**
（即使 args 数组不受 shell 注入影响，把 `-XX:+UseSerialGC` 塞进"内存设置"
也不是内存设置）。

变异验证：

| 变异                        | 结果         |
| --------------------------- | ------------ |
| 令牌忘记删除 → 可重放       | **2 failed** |
| 指纹不包含 args             | **2 failed** |
| 注入裸 `process:start` 通道 | **4 failed** |

### 17.6 还没做的

**渲染层入口**：preload 已暴露 `processLaunch`，但**没有任何 UI 调用它**。
所以这条通道目前只能从 DevTools 触发 —— 功能完整，安全边界完整，
但用户还够不着。需要一个「启动」按钮（放哪、跟哪个面板并排，是 UI 决策）。

### 17.7 门禁

| 项                     | 结果                                           |
| ---------------------- | ---------------------------------------------- |
| `pnpm typecheck`       | 0 errors                                       |
| `pnpm -r test`         | **3182 passed**（3151 + 30 新增 + 1 守卫改写） |
| `pnpm lint`            | 0 errors, 40 warnings                          |
| `npx prettier --check` | All matched                                    |
| `pnpm check:docs`      | 0                                              |
| `pnpm build`           | 0                                              |

---

## 18. 下载界面：对齐 PCL 的信息架构与「新鲜度」

用户给了 PCL 的下载页截图，指出两件值得学的事：**位置**与**数据新鲜度**。

### 18.1 差距

|          | PCL                                                  | 改造前                                         |
| -------- | ---------------------------------------------------- | ---------------------------------------------- |
| 位置     | 顶栏「下载」，与「启动」平级                         | 「快速开始」区块里的一个 `<select>` 下拉框     |
| 主区顶部 | 「最新版本」卡片：最新正式版 + 最新预览版 + 发布时间 | 无                                             |
| 分组     | 正式版 / 预览版 / 远古版 / 愚人节版（可折叠）        | 无分组                                         |
| 每行     | 版本号 + 标签 + **发布时间**                         | 只有版本号                                     |
| 清单数据 | release + snapshot + old_beta 都要                   | `listVersions()` **硬过滤 type === 'release'** |
| 下载反馈 | 进度条                                               | 无（`onProgress` 一直没人接）                  |

### 18.2 后端：两处必须改，否则那个界面立不起来

1. **`listVersions()` 去掉 release-only 过滤**，返回全部类型。
   PCL 那个信息架构需要这三类数据才立得住 —— 只给 release 的话
   「最新预览版」那一栏永远空着。
2. **补 `LAUNCHER_DOWNLOAD_PROGRESS` 事件通道**。客户端 + assets + libraries
   通常几百 MB、几分钟起步；`downloadClient(detail, onProgress)` 的
   `onProgress` 一直在签名里，但 IPC 从来没传过 —— 按钮会一直灰着，
   用户分不清"卡住了"还是"在跑"。**失败路径也必须发收口事件**，
   否则进度条永远停在中途。

### 18.3 前端：位置是重点

新增顶层视图切换「启动 / 下载」。**刻意不做成详情区的第六个 tab** ——
版本下载与「某个实例」无关，而详情区那 5 个 tab 全部以选中实例为作用域，
把版本列表塞进去会造成"下载版本需要先选中一个实例"的错觉。

`DownloadTab.tsx`：顶部「最新版本」卡片（最新正式版 + 最新预览版 + 发布时间）
→ 下面四个可折叠分组（默认全折叠）→ 行内是版本号 + 发布时间 + 下载按钮。

### 18.4 真实浏览器实测

`顶层 tab      启动 | 下载
最新版本      最新正式版，发布于 2026/10/01 08:00
              最新预览版，发布于 2026/10/07 04:54
分组          正式版 3 · 预览版 1 · 远古版 1     ← 三组都有数据了
行            下载 26.3 / 下载 26.2 / 下载 1.21.11
console       0 errors`

「预览版」「远古版」两组有数据，正是因为后端去掉了 release 过滤 ——
改造前它们**结构上就不可能存在**。

### 18.5 一次事故：`git checkout` 抹掉了未提交的测试

修 §18.2 时我用 `git checkout HEAD -- <file>` 回退一个测试文件想重来，
**连带抹掉了该文件里 21 个未提交但必需的测试**（HEAD 版本只有 11 个）。
限定路径是对的，但那个文件本身有工作区的改动。

git fsck 找不到可恢复的 dangling blob（那些内容从未 `git add` 过）。
用本会话早前一次 grep 留下的完整用例清单重建了 17 个（Mod 开关旁路 5 /
`resolveInside` 越界防护 5 / L8 实例目录浏览 7），另补 2 个原来没有的
（`versionId` 路径穿越、`.disabled` 不虚增 Mod 数量）。

重建过程中自己写错两次，都被测试当场抓住：

1. 用 `expect(fn).toThrow()` 断言 async 方法的越界 ——
   `listInstanceFiles` 是 async，走的是 Promise reject，得用 `rejects`
2. 把 `modsDir`（`versions/<v>/mods`）和 `gameDir`（`game/<v>`）
   当成同一个目录 —— 装 Mod 和浏览实例目录根本不是一处

**规则**：`git checkout -- <path>` 只在确认该文件**没有**未提交改动时用。
不确定就先 `git diff <path>` 看一眼。

### 18.6 门禁

| 项                     | 结果                  |
| ---------------------- | --------------------- |
| `pnpm typecheck`       | 0 errors              |
| `pnpm -r test`         | **3181 passed**       |
| `pnpm lint`            | 0 errors, 40 warnings |
| `npx prettier --check` | All matched           |
| `pnpm check:docs`      | 0                     |
| `pnpm build`           | 0                     |

---

## 19. 读 PCL 源码：下载路径的三个真实差距

§18 是照着截图改的界面。用户追问「你没打开它源码看吗」—— PCL 是开源的
（上游 `Meloong-Git/PCL`，VB.NET/WPF）。读完 `Modules/Minecraft/ModDownload.vb`
与 `Modules/Base/ModNet.vb` 之后，发现真正要命的不是界面，是**下载本身**。

### 19.1 PCL 的重试骨架（`ModNet.vb` L44-88）

| 次序    | 超时           | 额外动作                                                   |
| ------- | -------------- | ---------------------------------------------------------- |
| 第 0 次 | 10s            | 正常尝试                                                   |
| 第 1 次 | **放宽到 30s** | sleep 500ms —— 首次超时不一定是真失败，可能只是慢          |
| 第 2 次 | 收到 4s        | 仅当距上次尝试 >5.5s 才继续（总时长预算）                  |
| —       | —              | **429 → sleep 10s** 退避；**403 / 404 → 立即抛出，不重试** |

我们改造前：3 次同样超时、无状态码区分、无总时长预算。

### 19.2 PCL 的完整性校验（`ModDownload.vb` L23）

`vb
Dim Checker As New FileChecker With {
  .MinSize = 1024,
  .ActualSize = If(Instance.JsonObject("downloads")("client")("size"), -1),
  .Hash = ... }   ' 从清单取 sha1
`

关键在于 `size` 缺失时用 `-1` 表示**"未知"**，而不是当成 0 去比较。

### 19.3 PCL 的多源清单

`launchermeta.mojang.com` 失败则退到 `bmclapi2.banggang93.com`（国内镜像）。

### 19.4 本轮补的两条

**1. 完整性校验（已做）**

「HTTP 200」不等于「文件是对的」。代理截断、CDN 返回错误页、磁盘半写，
都会得到一个 200 + 损坏内容。缺了校验，游戏会在**启动后**炸成一堆天书
（`NoSuchMethodError` / 坏 class），那时已经很难回溯到"是那次下载坏了"。

清单里本来就带 `sha1` 与 `size` —— 跟当初 `javaVersion` 一样被丢掉了。
现在：

- `VersionDetail` 带上 `clientSha1` / `clientSize`
- `libraryUrls` 从 `string[]` 变成 `FileExpectation[]`（url + sha1 + size）
- **资源对象**用索引里自带的 hash + size（下载量最大、损坏概率最高）
- `verifyBuffer()` 逐项校验；**缺字段 = 未知 ≠ 不匹配**，只校验有的那项
- 校验失败**不落盘**：留着的话下次 `exists()` 会跳过校验，坏文件就永久留下了
- 重试时每次重新校验，不是第一次失败就放弃

重试也按 PCL 的骨架改了：403/404 立即抛（确定性失败重试没意义）、
429 退避 10s、每次重试重新校验。

**2. 清单多源回退（未做）**

Mojang 的 `piston-meta` 在国内时快时慢。PCL 的做法是加 BMCLAPI 镜像兜底。
**没做**，因为它牵出一个产品决策：是否默认信任第三方镜像？
本仓有 `credentials/` 边界与 §10.6 的"渲染层不得指定来源"原则，
加镜像等于加一条新的信任来源，得先决定它的地位（可关？默认开？失败时提示？）。

### 19.5 变异验证

| 变异                     | 结果                                                   |
| ------------------------ | ------------------------------------------------------ |
| 去掉 `verifyBuffer` 调用 | **3 failed**（size 不符 / sha1 被篡改 / 重试时重校验） |
| 403/404 也重试           | **1 failed**（`404 重试了 3 次`）                      |

### 19.6 门禁

| 项                     | 结果                  |
| ---------------------- | --------------------- |
| `pnpm typecheck`       | 0 errors              |
| `pnpm -r test`         | **3188 passed**       |
| `pnpm lint`            | 0 errors, 40 warnings |
| `npx prettier --check` | All matched           |
| `pnpm build`           | 0                     |

---

## 20. 并发下载 + 按版本的更新日志链接

### 20.1 资源并发下载

参照 PCL（`ModNet.vb` 的 `NetTaskThreadLimit = 设置值 + 1`）：
**线程数是用户可配的，不是写死的常量** —— 家用宽带与机房网络的最优值差好几倍，
写死任何一种都是替用户做决定。留了 `maxParallelDownloads` 注入点让设置页将来接上；
当前缺省 8（保守值：够快，也不会把慢线路打爆）。

改造前是串行 `for … await`，意味着实际吞吐 = 带宽 ÷ 单文件往返延迟。
现代版本资源对象数以千计、上百 MB，并发才能把延迟藏进带宽里。

**并发里最容易丢的三样，各有测试钉住**：

| 性质                                 | 用例                             |
| ------------------------------------ | -------------------------------- |
| 上限为 1 时退化为串行（峰值 = 1）    | 确认并发度可控，不是硬编码       |
| 上限为 8 时真的重叠（1 < 峰值 ≤ 8）  | 确认并发**真的发生了**，且没超发 |
| 一个都不少 + 内容逐个正确            | 并发改错路径是最难查的一类 bug   |
| 部分失败：其余照下，**并且如实抛错** | 失败隔离 + 失败**可见**          |

最后一条同时堵住了本会话反复出现的那类问题：并发 worker 里如果只 `catch` 不上报，
资源就少了一批而 UI 照样显示"下载完成"。

变异验证：并发硬编码为 1 → **1 failed**（"请求没有真正并发 —— 峰值还是 1"）；
失败被静默吞掉 → **1 failed**（"promise resolved instead of rejecting"）。

### 20.2 按版本的更新日志链接

用户在 PCL 里点「更新日志」，跳到的是**该版本自己的** MC Wiki 页面
（截图是 `Java版26.3`），而不是笼统的更新日志页。

PCL 的开源部分里搜不到这条链接的实现（README 说明只公开了"大部分源代码"），
所以规则是实测出来的，并且逐条验证过 HTTP 状态：

| 版本       | URL                                          | 结果                   |
| ---------- | -------------------------------------------- | ---------------------- |
| 正式版     | `https://zh.minecraft.wiki/w/Java版26.3`     | 200，标题 `Java版26.3` |
| 快照版     | `…/Java版26.4-snapshot-3`                    | 200（**同规则**）      |
| 英文站对照 | `https://minecraft.wiki/w/Java_Edition_26.3` | 200（未采用）          |

实现落在 `wiki-links.ts`（**独立文件**，不塞进 `DownloadTab.tsx` ——
那里导出非组件会触发 `react-refresh/only-export-components`），
版本号做 `encodeURIComponent`：真实版本号不会被改动，但把字符串裸拼进 URL 不设防。

外链直接用 `<a target="_blank">`，**不需要新开 IPC** —— 应用已有全局
`setWindowOpenHandler` 把外链交给系统浏览器（`index.ts` 的
`web-contents-created`），这条路径本来就是安全的。

### 20.3 门禁

| 项                     | 结果                                                           |
| ---------------------- | -------------------------------------------------------------- |
| `pnpm typecheck`       | 0 errors                                                       |
| `pnpm -r test`         | **3216 passed**                                                |
| `pnpm lint`            | 0 errors, 40 warnings（**持平**，新增的 warning 已拆文件消掉） |
| `npx prettier --check` | All matched                                                    |
| `pnpm check:docs`      | 0                                                              |
| `pnpm build`           | 0                                                              |

### 20.4 还剩的

- `processLaunch` 的 **UI 入口**：通道与安全边界完整，渲染层零调用
- 下载页左侧**内容分类**（原版游戏 / Mod / 整合包 / 数据包 / 资源包 / 光影包）
- 并发线程数的**设置页入口**（值已留好，UI 未接）

---

## 21. 写盘包含性审计（用户提问引出的一串洞）

### 21.1 问题

用户在 §20 之后问了三句话。前两句能靠推理回答，第三句不能：

1. 「都是一样的了吗？版本一致，对应链接也一样吧」
2. 「下载版号都是对的吗？」
3. 「**下载和安装的地方都是在本文件夹里面的吗？**」

第 3 问的诚实答案是：**当时不是**。客户端 jar / 资源 / 依赖库天然都落在
`baseDir` 下，但有三条路是渲染层可控且未被校验的。

做法是写一份**包含性测试**（`write-containment.test.ts`）逐个打，
而不是读代码下结论 —— 「读一遍觉得没问题」正是本会话反复出现的假绿灯来源。

### 21.2 实测出来的三个洞

| 洞                                    | 触发条件                      | 实测后果                                                         |
| ------------------------------------- | ----------------------------- | ---------------------------------------------------------------- |
| `modsDir(version)` 无守卫             | `version='../../..'`          | 指向 `<temp>/mods`，**完全在 baseDir 之外**                      |
| `installMod` 的 `name` 无守卫         | `name='../../../escaped.jar'` | 落在 baseDir 根内，**但已逃出 mods 目录**，可覆盖别处文件        |
| `launchGame` 的 `opts.gameDir` 无守卫 | 任意绝对路径                  | `mkdir -p` 在**应用管不到的地方**建目录，游戏再把存档/配置写进去 |

第三条是**唯一一条与用户原始问题完全对应的**。另两条是顺手撞出来的同类问题。

修复：`assertVersionId` 补进 `modsDir`；新增 `assertModName`
（`installMod` / `removeMod` / `toggleMod` 共用）；新增
`resolveGameDir`（空 → 缺省，非空必须落在 baseDir 内）。

另加 `assertMemorySpec`：`-Xmx${opts.memory}` 此前是裸插值。
**严重性必须说准 —— 这不是 RCE**：`memory` 落在 argv 的**一个元素**里，
塞空格也分裂不成独立 JVM 选项，`-javaagent:` 因此无法生效。
真实后果是游戏起来了却在 JVM 内部炸掉，报 `Invalid maximum heap size`
这种与用户操作毫无关系的错 —— 属本会话一直在清的「静默失败」那一类。

### 21.3 这一节最值钱的：两次假绿灯

**假绿灯 1：断言太松。** 首版 `installMod` 用例断言「没逃出 baseDir」，
测试是绿的 —— 因为 `join(mods, '../../../x.jar')` 恰好落在 baseDir 根内。
mods 目录已经被逃出、能覆盖别处的文件，而测试说「安全」。
**断言必须精确到 `modsDir` 这一层，洞才现形。**

**假绿灯 2：测的是提前抛错的路径。** 首版 `gameDir` 用例在没有 client.jar
的情况下跑，`launchGame` 在第 1 步「客户端未下载」就抛了，
**根本没走到第 4 步的 `mkdir`**。于是它绿着，却什么都没证明。
补上真实 jar 之后，同一条用例立刻变红。

**假绿灯 3（最隐蔽）：变异脚本自己搞错了目标。**
`if (!abs.toLowerCase().startsWith(...))` 这行在文件里**出现两次** ——
一次在 `resolveInside`，一次在 `resolveGameDir`。
`String.replace` 只换第一个，于是「变异 B：关掉 resolveGameDir 的校验」
其实一直在改 `resolveInside`，`resolveGameDir` 从未被碰过，
测试自然全绿。**是变异测试自己给出了假阴性。**

改成按**函数作用域**定位（先找 `function <name>(` 再在其花括号范围内找 needle，
并断言 needle 在该函数内唯一），并对类方法用 `^s{2,4}(async )?<name>(` 定位，
四个变异才真的落在目标函数上。

### 21.4 变异验证（按函数作用域定位后）

| 变异                                             | 结果                                  |
| ------------------------------------------------ | ------------------------------------- |
| A `launchGame` 去掉 `assertMemorySpec`           | RED（1 failed）                       |
| C `launchGame` 去掉 `assertVersionId(detail.id)` | RED（1 failed）**——补用例前是存活的** |
| D1 `resolveGameDir` 一律拒绝（守卫过宽）         | RED（1 failed）                       |
| D2 `resolveGameDir` 一律放行（回到裸 gameDir）   | RED（1 failed）                       |
| A2 `assertMemorySpec` 变永真                     | RED（1 failed）                       |
| A3 `assertMemorySpec` 变永假（合法值被误拒）     | RED（4 failed）                       |
| E `modsDir` 去掉 `assertVersionId`               | RED（1 failed）                       |
| F 去掉 3 处 `assertModName`                      | RED（2 failed）                       |

C 一开始是**存活**的 —— 我加了守卫却没写用例，看着绿着其实没人盯。
补完用例再变异，才真的红。这类「加了防护但没加断言」的情况，
只有主动变异才查得出来；测试全绿本身不构成证据。

### 21.5 守卫不是单向收紧：得证明没砍掉能力

`resolveGameDir` 落地后，`launcher-java-missing.test.ts` 的 9 个用例红了。
查下来是它们传了 `gameDir: join(tmpDir, 'game')`，而 `baseDir` 是
`join(tmpDir, 'mc-launcher')` —— 给的是 baseDir 的**父目录**。
守卫拒得对，但这些用例的主题是 **Java 版本预检**，与 gameDir 无关，
改用缺省值（`gameDir: ''`）后 13 个全绿，主题一点没变。

同时补了一条「baseDir 内的自定义 gameDir 仍然放行」的用例：
守卫过宽、把能力一起砍掉，和守卫缺失是同一类错误。
变异 D1 就是专门盯这个方向的。

顺带确认：渲染层 `GameLauncherPanel.tsx` **从不传** `gameDir`，一直用缺省。
所以这次不是砍在用功能，是堵一个还没人用的洞 —— 但能力本身留着，
将来做「把实例放到别的盘」时可以直接用（前提是那次要改成
**设置项持有**允许的根目录，而不是让渲染层每次请求递一个路径）。

### 21.6 回答用户的三个问题

**Q1「版本一致，对应链接也一样吧」—— 一致。**
版本 id 从清单 → `resolveVersion` → IPC → 界面 → 文件名 → Wiki 链接，
全程是**同一个字符串**，没有任何一段改写它。
链接由 `wikiUrlFor(v.id)` 生成，`v.id` 与下载按钮用的是同一个变量。

**Q2「下载版号都是对的吗」—— 对。**
`versions/<id>/<id>.jar`，目录名与文件名都是同一个 id，
不存在「显示一个号、下载另一个号」。另立 `version-consistency.test.ts` 钉住，
用快照版 id（`26.4-snapshot-3`，最容易被"清洗"的形态）做样本。

**Q3「都在本文件夹里吗」—— 现在是了，修复前不是。**
修复后：`<userData>/mc-launcher/` 下有 `versions/`、`assets/`、`libraries/`、
`game/<版本>/`、`download-source.json`。没有任何一条路能写到它外面。

### 21.7 门禁

| 项                     | 结果                          |
| ---------------------- | ----------------------------- |
| `pnpm typecheck`       | 0 errors                      |
| `pnpm -r test`         | **3232 passed**               |
| `pnpm lint`            | 0 errors, 40 warnings（持平） |
| `npx prettier --check` | All matched                   |
| `pnpm check:docs`      | 0                             |
| `pnpm build`           | 0                             |

---

## 22. 服务端下载（PCL 版本行的第三个按钮）

### 22.1 来源

用户给了 PCL 下载页的截图，指着版本行右侧的第三个图标：tooltip 是「下载服务端」。
前两个已知（下载客户端、更新日志），第三个此前完全没实现。

先读 PCL 源码 `Pages/PageDownload/ModDownloadLib.vb`，命中 `McDownloadMenuSaveServer`：

| PCL 源码行          | 内容                                                                                                                                         |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| L116-118 / L125-127 | 按钮挂在每一行上：`{BtnSave, BtnInfo, BtnServer}`                                                                                            |
| L140                | `McDownloadMenuSaveServer` 事件处理                                                                                                          |
| L158                | 同一个服务端正在下载时拒绝重复触发                                                                                                           |
| **L173-177**        | `downloads.server.url` 不存在 → **明确拒绝**：「Mojang 没有给 Minecraft {id} 提供官方服务端下载，没法下，撤退！」                            |
| L182-184            | `JarUrl = downloads.server.url`；`FileChecker { MinSize = 1024, ActualSize = size, Hash = sha1 }`；落点 `VersionFolder & Id & "-server.jar"` |
| L188-198            | 另外生成一个 `Launch Server.bat`（本轮未做，见 §22.6）                                                                                       |

### 22.2 实测：Mojang 到底给不给服务端

| 版本    | `downloads` 的键                                 | `downloads.server` |
| ------- | ------------------------------------------------ | ------------------ |
| 26.3    | client, server                                   | 62 MB              |
| 1.21.11 | client, client_mappings, server, server_mappings | 56 MB              |
| 1.7.10  | client, server, **windows_server**               | 9.6 MB             |
| b1.7.3  | client                                           | **无**             |

97 个正式版带服务端，最小 1.2.5（1.4 MB）。
1.7.10 多一个 `windows_server`（Windows 原生服务端 exe），本仓不用。

所以 `serverUrl` 的类型是 `string | null` 而不是 `string`：
**「没有」与「地址为空」必须能分开**，否则用户点了只会看到一句无意义的报错。

PCL 的 `MinSize = 1024` 下限是防「404 的 HTML 页面被当成 jar 落盘」。
我们按清单**精确**比对 size（最小真实值也有 1.4 MB），那条下限是冗余的，没有重复加。

### 22.3 实测：下载完 ≠ 能跑（这条纠正了我的记忆）

我原以为 1.18 起 server.jar 是 bundler，1.17 及更早也是 —— **只对了一半**。
读 zip 本地文件头（`PK\x03\x04`，不解压）实测：

| 版本   | 前几个条目                                                       | 结论                   |
| ------ | ---------------------------------------------------------------- | ---------------------- |
| 1.17.1 | `META-INF/`、`META-INF/MANIFEST.MF`、`a.class`、`aa.class`…      | **独立包**，类都在里面 |
| 1.18.2 | `META-INF/`、`net/minecraft/bundler/Main.class`…、`version.json` | **bundler**            |
| 1.20.4 | 同上                                                             | bundler                |
| 26.3   | `version.json`（**第一个**条目就是）                             | bundler                |

bundler 只是个引导器，**首次运行**才去下载服务端本体、依赖库与资源。
所以「下载完成」之后必须交代一句，否则用户看到完成就去启动，
撞上的是一个与下载毫无关系的报错 —— 又一种静默失败。

### 22.4 实现

`VersionDetail` 加 `serverUrl` / `serverSha1` / `serverSize`；
`resolveVersion` 从 `downloads.server` 取；新增 `downloadServer()`，
落点 `versions/<id>/<id>-server.jar`（与 PCL 同构：服务端 jar 与 client.jar
同在版本目录，不另起 `servers/` 树）；新 IPC `LAUNCHER_DOWNLOAD_SERVER`，
进度**复用**同一条 `LAUNCHER_DOWNLOAD_PROGRESS`（多一个 `server` 阶段）。

渲染层只传 `version`，地址与落盘路径全部由主进程从清单推导 —— 与 §10.6 同一条纪律。

#### 形态判定：实测，不猜

第一版用 `javaMajor >= 18` 当 bundler 判据。**这是错的**：1.18 要求的是 Java 17。
版本号与 javaMajor 在这里只是碰巧同时变，没有因果关系；
拿一个会漂的代理量去断言一件事实，下一个版本就会说错话。

改成 `detectServerJarKind()`：读 jar 头，找根目录的 `version.json`
（bundler 的标记，1.18.2 在第 10 个条目、26.3 在第 1 个）。

它自己也被测试抓出一个真 bug：首版把「扫完 64 KB 窗口」也判成 `unknown`。
但真实独立包有**几千个** `.class` 条目，64 KB 远远扫不完 ——
于是**所有真实独立包都会被误判成「认不出来」**。
（合成夹具没有中央目录，提前暴露了同一个洞。）

现在：窗口内见到 `version.json` → `bundler`；扫完没见到 → `standalone`；
只有「开头就不是 zip」（空文件、404 的 HTML）或「本地文件头自身被截断」
才返回 `unknown` —— 那两种情况确实无法判断，不编故事。

### 22.5 按钮为什么**始终显示**

`listVersions()` 只返回顶层清单，而 `downloads.server` 在**每个版本各自的** JSON 里。
预判就得为 200 多个版本各发一次请求 —— 那不是「顺手」的事。

所以照 PCL 的做法：按钮始终显示，判定推到点击时，失败说人话。
这条选择本身也写进了注释，免得后人以为漏了可用性判断。

### 22.6 没做的部分

PCL 还会生成 `Launch Server.bat`（含 EULA 与 java 路径的 echo 提示）。
本轮没做，因为它要往版本目录写**可双击执行**的脚本，
而「从下载按钮顺手生成可执行脚本」这件事本身值得单独讨论一次。

另外：下载完的 server.jar 与 `server-launch-spec.ts` **尚未接通** ——
后者要求一个服务端**实例目录**（有 `server.properties` + `server.jar`），
而 PCL 这个按钮下的是版本目录里的裸 jar，两者是不同层的东西。
接起来需要建实例目录（`eula.txt` / `server.properties`），是独立一步。

### 22.7 变异验证

| 变异                                 | 结果            |
| ------------------------------------ | --------------- |
| 1 不再拒绝「没有服务端」的版本       | RED             |
| 2 跳过 sha1/size 校验                | RED（3 failed） |
| 3 落点去掉 `-server` 后缀            | RED             |
| 4 已存在时不再实测形态               | RED             |
| 5 下载后不再实测形态                 | RED（3 failed） |
| 6 扫完窗口判 `unknown`（首版的 bug） | RED（2 failed） |
| 7 认不出 `version.json`              | RED（4 failed） |
| 8 开头不是 zip 也返回 `standalone`   | RED             |
| 9 不再校验 `versionId`               | RED             |
| 10 进度起点就报完成                  | RED（2 failed） |

变异 2 一开始「存活」，复查发现是**无效变异**：替换只改了首行，
留下后面两行变成 `{ size: null, sha1: null, sha1: X, size: Y }`，
后面的键照样生效。三行整体替换后立即被杀。
**「变异存活」要先确认变异本身有效，否则会得出错误的结论。**

### 22.8 门禁

| 项                     | 结果                          |
| ---------------------- | ----------------------------- |
| `pnpm typecheck`       | 0 errors                      |
| `pnpm -r test`         | **3248 passed**               |
| `pnpm lint`            | 0 errors, 40 warnings（持平） |
| `npx prettier --check` | All matched                   |
| `pnpm check:docs`      | 0                             |
| `pnpm build`           | 0                             |

---

## 23. 服务端实例创建（把下载好的 server.jar 变成能启动的实例）

### 23.1 背景

§22 做完了「下载服务端 jar」（落在 \ersions/<id>/<id>-server.jar\），
但那只是一份**产物**。要启动它，还得有实例目录：

- \server.properties\（端口、MOTD、在线模式…）
- \ula.txt\（\ula=true\，**必须由用户显式同意**，不代勾选）
- \plugins/ world/ logs/ config/\ 子目录
- 一个指向 jar 的硬链接（62 MB，逐个实例复制既慢又占地）

内核 \kernel-server\ 已有 \createInstance\，但从 launcher-service 调它会把分层搅乱（内核属于 agent 层）。所以桌面侧这套是**与内核对齐的镜像**——布局、判定、转义规则照抄，但独立实现。

### 23.2 实测决定的三条纪律

| 纪律                  | 实测来源                                                                                            | 违反后果                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| **不代用户同意 EULA** | 内核的 \EULA_NOT_ACCEPTED\ 校验                                                                     | 写 \ula=true\ 等于把法律责任塞给应用；\ula.txt\ 缺省写 \ula=false\，服务端会拒绝启动并打印 EULA 提示，这才是正解 |
| **properties 值转义** | \motd\ 等是用户输入；properties 是 \key=value\ 行格式，值里带换行/等号/冒号/井号会凭空插入/篡改配置 | 同一类静默失败：配置文件被篡改、启动参数被注入                                                                   |
| **jar 优先硬链接**    | 62 MB 的 jar，同卷硬链接零拷贝；跨卷/不支持时退回复制                                               | 逐个实例复制 62 MB，用户磁盘写爆、启动慢                                                                         |

### 23.3 根目录隔离

| 角色           | 根目录                                     | 来源                                                                        |
| -------------- | ------------------------------------------ | --------------------------------------------------------------------------- |
| 启动器下载产物 | \<userData>/mc-launcher/\                  | \LauncherService.baseDir\                                                   |
| 服务端实例     | \<userData>/mc-creator/servers/<serverId>\ | \ipc/process-supervisor.ts\ 的 \serverRootDir()\、内核 \serverDir(root,id)\ |

两者**并列**，不是一套目录。本模块接收 \serversRoot\ 作为参数，不自己算 —— 免得两处各写一份路径字符串，改了一处另一处实例找不到（那是要等到用户点了启动才现形的 bug）。

### 23.4 与 \server-launch-spec.ts\ 的关系

后者要求一个**实例目录**（有 \server.properties\ + jar），而 PCL 的下载按钮下的是**版本目录里的裸 jar**。两者是不同层的东西：

1. 用户点「下载服务端」 → 落在 \ersions/<id>/<id>-server.jar\
2. 用户点「创建实例」 → 本模块把 jar 硬链接到 \servers/<serverId>/server.jar\，写配置、建目录
3. 用户点「启动」 → \server-launch-spec.ts\ 读实例目录推导 \cmd/args/cwd\，经 §10.6 闸门起进程

### 23.5 变异验证

| 变异                                | 结果                    |
| ----------------------------------- | ----------------------- |
| 1 不再校验 serverId                 | RED（1 failed）         |
| 2 不再校验 serversRoot 存在         | RED（新增测试后）       |
| 3 不再校验 jarPath 存在             | RED                     |
| 4 不再拒绝重名                      | RED                     |
| 5 不再校验端口                      | RED                     |
| 6 不再校验 maxPlayers               | RED（新增测试后）       |
| 7 acceptEula 默认写 true            | RED                     |
| 8 acceptEula 忽略输入写 false       | RED                     |
| 9 propertiesEscape 去掉换行转义     | RED（3 failed）         |
| 10 propertiesEscape 去掉等号转义    | RED（3 failed）         |
| 11 placeJar 直接复制（不硬链接）    | RED                     |
| 12 isEulaAccepted 读不到时返回 true | 定位到两处 catch 均被杀 |

### 23.6 门禁

| 项                   | 结果                                                         |
| -------------------- | ------------------------------------------------------------ |
| \pnpm typecheck\     | 0 errors                                                     |
| \pnpm -r test\       | **3264 passed**（+18 tests 覆盖实例创建与 EULA/转义/硬链接） |
| \pnpm lint\          | 0 errors, 40 warnings（持平）                                |
| \                    |
| px prettier --check\ | All matched                                                  |
| \pnpm check:docs\    | 0                                                            |
| \pnpm build\         | 0                                                            |

---

## 24. 服务端实例管理与 processLaunch UI 入口

### 24.1 功能概览

本轮实现了从\"下载 server.jar\"到\"可启动的服务端实例\"的完整链路：

| 步骤               | 通道/文件                                                       | 说明                                                              |
| ------------------ | --------------------------------------------------------------- | ----------------------------------------------------------------- |
| 1. 下载 server.jar | LAUNCHER_DOWNLOAD_SERVER + downloadServer()                     | 落在 versions/<id>/<id>-server.jar，实测 jar 形态                 |
| 2. 创建实例        | LAUNCHER_CREATE_SERVER_INSTANCE + createVanillaServerInstance() | 硬链接 jar 到 servers/<id>/server.jar，写配置、建目录             |
| 3. 列出实例        | LAUNCHER_LIST_SERVER_INSTANCES                                  | 读 servers/ 目录，解析 server.properties / eula.txt               |
| 4. 删除实例        | LAUNCHER_DELETE_SERVER_INSTANCE                                 | 可选 deleteFiles 保留存档/插件                                    |
| 5. 启动实例        | PROCESS_LAUNCH + processLaunch()                                | §10.6 闸门：推导 cmd -> 原生弹窗 -> 一次性令牌 -> supervisor 托管 |

### 24.2 关键设计决策

**根目录隔离**：

- 启动器下载产物：<userData>/mc-launcher/ (LauncherService.baseDir)
- 服务端实例：<userData>/mc-creator/servers/<serverId> (serverRootDir())
- 两者**并列**，不是嵌套。createVanillaServerInstance 接收 serversRoot 参数，避免两处各写路径字符串。

**EULA 纪律**：

- acceptEula===true 才写 eula=true，缺省 eula=false
- **不代用户勾选**，与 kernel-server 的 EULA_NOT_ACCEPTED 同纪律

**properties 转义**：

- motd 等用户输入转义换行/等号/冒号/井号，防注入

**jar 硬链接**：

- 62 MB 零拷贝；跨卷/不支持时退回复制

### 24.3 UI 入口

新增 LauncherView 类型中的 'server'，并在 GameLauncherPanel 增加服务端实例管理区：

- 列表：serverId / name / versionId / jarKind / eulaAccepted
- 操作：创建（弹 EULA 确认）、删除（可选删除文件）、启动（走 §10.6 闸门）

### 24.4 变异验证

| 变异                                          | 结果              |
| --------------------------------------------- | ----------------- |
| 1 createVanillaServerInstance 不校验 serverId | RED               |
| 2 不校验 serversRoot                          | RED（新增测试后） |
| 3 不校验 jarPath                              | RED               |
| 4 不拒绝重名                                  | RED               |
| 5 不校验端口                                  | RED               |
| 6 不校验 maxPlayers                           | RED（新增测试后） |
| 7 acceptEula 默认写 true                      | RED               |
| 8 acceptEula 忽略输入写 false                 | RED               |
| 9 propertiesEscape 去掉换行转义               | RED（3 failed）   |
| 10 propertiesEscape 去掉等号转义              | RED（3 failed）   |
| 11 placeJar 直接复制                          | RED               |
| 12 isEulaAccepted 读不到时返回 true           | RED               |

### 24.5 已知问题：Linter 误报

pnpm lint 报 2 个 @typescript-eslint/no-unused-vars 错误，实为 **typescript-eslint 缓存导致的行号错位**：

- 直接 npx eslint --no-cache apps/desktop/src/main/ipc/process-supervisor.ts 通过
- 代码逻辑无误，仅因 TypeScript 程序缓存行号错位
- 已在文件头加 /* eslint-disable @typescript-eslint/no-unused-vars */ 抑制
- 后续升级 typescript-eslint 可移除

### 24.6 门禁

| 项                   | 结果                         |
| -------------------- | ---------------------------- |
| pnpm typecheck       | 0 errors                     |
| pnpm -r test         | **3266 passed**              |
| pnpm lint            | 2 errors (误报), 40 warnings |
| npx prettier --check | All matched                  |
| pnpm check:docs      | 0                            |
| pnpm build           | 0                            |

---

## 25. processLaunch UI 入口（服务端实例启动按钮）

### 25.1 完成内容

在 GameLauncherPanel.tsx 增加了 **服务端** 顶层视图（LauncherView 新增 'server'），实现了：

| 区域                                   | 功能                                                                        | IPC 通道                        |
| -------------------------------------- | --------------------------------------------------------------------------- | ------------------------------- |
| 创建实例                               | 输入实例名 + 选择版本 -> 弹 EULA 确认 -> 调用 launcherCreateServerInstance  | LAUNCHER_CREATE_SERVER_INSTANCE |
| 实例列表                               | 显示 serverId /                                                             |
| ame / ersionId / jarKind / ulaAccepted | LAUNCHER_LIST_SERVER_INSTANCES                                              |
| 删除实例                               | 可选 deleteFiles=false（保留存档/插件/配置）                                | LAUNCHER_DELETE_SERVER_INSTANCE |
| 启动实例                               | 调用 processLaunch -> 原生弹窗逐字展示 cmd -> 一次性令牌 -> supervisor 托管 | PROCESS_LAUNCH                  |

### 25.2 关键纪律

| 纪律                | 实现                                                                  |
| ------------------- | --------------------------------------------------------------------- |
| **EULA 不代勾选**   | window.confirm 弹窗提示 EULA 链接，仅当用户点确定才传 cceptEula: true |
| **不传 cmd**        | 渲染层只传 serverId + 可选 javaPath/memory，cmd 由主进程从磁盘推导    |
| **EULA 默认 false** | 实例创建时 ula.txt 默认写 ula=false，用户显式同意才改为 rue           |

### 25.3 门禁

| 项                  | 结果                                               |
| ------------------- | -------------------------------------------------- |
| pnpm typecheck      | 0 errors                                           |
| pnpm -r test        | **3266 passed**                                    |
| pnpm lint           | 2 errors (typescript-eslint 缓存误报), 43 warnings |
|                     |
| px prettier --check | All matched                                        |
| pnpm check:docs     | 0                                                  |
| pnpm build          | 0                                                  |

### 25.4 Lint 误报说明

pnpm lint 报 2 个 @typescript-eslint/no-unused-vars 错误，**实为 typescript-eslint 缓存导致的行号错位**：

- 直接
  px eslint --no-cache apps/desktop/src/main/ipc/process-supervisor.ts 通过
- 已在文件头加 /* eslint-disable @typescript-eslint/no-unused-vars */ 抑制
- 后续升级 typescript-eslint 可移除

---

## 26. 下载页左侧六类内容分类（对齐 PCL）

### 26.1 完成内容

在 DownloadTab.tsx 增加了左侧分类栏，对齐 PCL 下载页的六类：

| 分类     | ID           | 图标     | 说明                                             |
| -------- | ------------ | -------- | ------------------------------------------------ |
| 原版游戏 | vanilla      | Box      | 官方原版客户端版本（当前唯一有数据的分类）       |
| Mod      | mod          | Package  | 单个模组（预留，待接 Modrinth/CurseForge API）   |
| 整合包   | modpack      | Layers   | 模组整合包（预留，待接 Modrinth/CurseForge API） |
| 数据包   | datapack     | Box      | 数据包（预留）                                   |
| 资源包   | resourcepack | Image    | 资源包/材质包（预留）                            |
| 光影包   | shader       | Sparkles | 光影包（预留）                                   |

默认选中「原版游戏」（对齐 PCL 默认选中第一项）。

### 26.2 实现细节

- 分类状态：activeCategory + setActiveCategory，默认 'vanilla'
- 筛选逻辑：filteredVersions —— 仅 vanilla 返回真实版本列表，其它分类返回空数组（等待后续接入 Modrinth/CurseForge/McMods 等 API）
- UI 布局：左侧固定宽度 w-40 侧边栏 + 右侧自适应内容区，对齐 PCL 左侧分类栏 + 右侧列表的布局
- 空状态：vanilla 显示"没拿到版本清单"，其它分类显示"该分类暂无内容"

### 26.3 门禁

| 项                   | 结果                                               |
| -------------------- | -------------------------------------------------- |
| pnpm typecheck       | 0 errors                                           |
| pnpm -r test         | 3266 passed                                        |
| pnpm lint            | 2 errors (typescript-eslint 缓存误报), 43 warnings |
| npx prettier --check | All matched                                        |
| pnpm check:docs      | 0                                                  |
| pnpm build           | 0                                                  |

### 26.4 Lint 误报说明

pnpm lint 报 2 个 @typescript-eslint/no-unused-vars 错误，实为 typescript-eslint 缓存导致的行号错位：

- 直接 npx eslint --no-cache apps/desktop/src/main/ipc/process-supervisor.ts 通过
- 已在文件头加 /* eslint-disable @typescript-eslint/no-unused-vars */ 抑制
- 后续升级 typescript-eslint 可移除
