# MC Creator 设计规格

> AI 驱动的 Minecraft 内容创作桌面客户端。本规格覆盖**阶段 1（核心平台）+ 阶段 2（Mod 生成）**，其余 5 个生成器在路线图中标注，后续各开规格。

- 创建日期：2026-07-13
- 状态：待用户审查

---

## 1. 背景与目标

做一个桌面客户端，让 AI 帮用户写 Minecraft 相关内容：mod、整合包、服务器、材质、皮肤等。本工具是「平台 + 多个可插拔生成器」结构，第一阶段聚焦**核心平台 + Mod 代码生成**，跑通从自然语言描述到可安装 .jar 的完整链路。

### 1.1 已核实的关键背景（2026 年中 MC 生态）

- **版本号体系变更**：2026 年起 MC 改用 `26.1`/`26.2`（年.次版本）。最新 `26.1.1`（Tiny Takeover），主流稳定版 `1.21.11`。
- **去混淆（根本性变化）**：`26.1` 起游戏代码不再混淆，Yarn/Quilt Mappings 等映射项目对 26.1+ 不再需要，大幅降低 AI 生成难度。26.1 需 Java 25。
- **Loader 格局**：NeoForge 接管重型/内容 mod（Create/Mekanism 先发）；Fabric 占性能优化（Sodium/Iris）；老 Forge 靠 1.20.1 存量；Quilt 退役中。Sinytra Connector 可在 NeoForge 跑 Fabric mod。
- **同类 AI 工具已存在**（验证方向）：MineArcane、ModCraft（含可视化 DSL 画布）、BlockGPT（节点式脚本）。均为 Web 端、优先 Fabric、采用「描述→spec→编译 JAR」流程。本工具以**桌面客户端**为差异化（离线/本地模型/直接写文件）。

### 1.2 关键决策汇总

| 项 | 决策 |
|---|---|
| 范围 | 核心平台 + Mod 生成（阶段 1+2），7 生成器路线图 |
| 构建 | 内置完整构建链（自动 JDK + Gradle → .jar） |
| AI 模型 | 混合：云端为主（GLM/DeepSeek/Kimi 等）+ 本地可选（Ollama），抽象「模型提供者」接口 |
| 定位 | 个人工具优先，预留产品化（导出/导入、配置分享），暂不做账号系统 |
| 技术栈 | Electron + React + TypeScript |
| 架构 | 分层式：核心引擎独立 TS 库 + UI 壳 + 生成器插件 |
| Loader | Fabric + NeoForge 同时支持，UI 提供 loader 切换器 |
| MC 版本 | 1.21.11 为主，架构预留 26.1（去混淆成熟后切换） |
| 交互流程 | spec-first（描述→spec 审阅→生成→编译），已被竞品验证 |
| 可选高阶 | 可视化节点画布（React Flow） |

---

## 2. 整体架构（分层式）

三层 + 插件式生成器：

### 2.1 UI 层（Electron 渲染进程 · React）
- 对话界面（描述需求）
- Spec 审阅界面（确认规格）
- 代码预览（Monaco）
- 节点画布（React Flow，可选高阶）
- **Loader/版本切换器**（常驻顶部，醒目显示当前目标，避免生成错框架）

### 2.2 核心引擎（独立 TS 库 · 无 UI 依赖 · 可跑 worker 线程）
核心引擎是纯 TS 库，不 import 任何 Electron/React，可在 Node 直接运行、可单测、未来可包成 HTTP 服务端。包含 6 个组件：

| 组件 | 职责 |
|---|---|
| AI 编排器 | 多步任务流、工具调用、流式输出、上下文/token 管理（基于 Vercel AI SDK 原语 + 自建薄编排层，见 2.4） |
| 模型提供者 | 统一接口：云端 + 本地，能力声明（是否支持工具调用/视觉） |
| 文件系统 | 项目读写、原子写入、diff 生成、回滚、忽略规则 |
| 项目管理 | 多项目、元数据、导入/导出（预留产品化）、版本历史 |
| 构建器 | JDK 检测/安装、Gradle 调用、日志流、产物提取 |
| 生成器注册表 | 插件接口、按类型路由、能力声明（支持哪些 loader/版本） |

### 2.3 生成器层（插件 · 实现统一 Generator 接口）
统一接口：`describe → spec → generate → build`，核心引擎按类型路由。第一版实现 Mod 生成器，其余按路线图接入。

### 2.4 AI 编排技术选型

采用 **Vercel AI SDK（基础原语）+ 自建薄编排层**，不使用 LangChain/LangGraph。

- **Vercel AI SDK 提供**：`streamText` 流式输出、工具调用（tool calling）、多步循环（multi-step）等原语，统一各家云端模型 + 本地 Ollama 的调用接口。
- **自建薄编排层负责**：spec-first 结构化流程（描述→spec→生成→编译→修复）、Spec JSON Schema 校验重试、Gradle 构建失败修复循环。
- **不用 LangChain/LangGraph 的理由**：我们的流程是结构化的（非自由游走的 coding agent），重框架的图式工作流抽象过重、调试难、纯 TS 核心引擎不需其依赖。
- **模型提供者抽象**：AI SDK 的 provider 机制 + 能力声明（是否支持工具调用/视觉），云端为主、本地可选切换。

---

## 3. Mod 生成器设计

### 3.1 spec-first 多 loader 流程

```
① 描述需求（用户选 loader + MC 版本 + 自然语言描述）
   ↓
② AI 生成 ModSpec（loader 无关的结构化规格）
   ↓
③ 用户审阅/编辑 Spec
   ↓
④ Loader Adapter 按 loader 翻译 Spec：
     ├─ FabricAdapter  → fabric.mod.json + Fabric Loom build.gradle + Fabric API 注册代码
     └─ NeoForgeAdapter → mods.toml + NeoForge moddev build.gradle + DeferredRegister 代码
   ↓
⑤ 构建器调 Gradle 编译 → 产出 .jar
   ↓
⑥ 输出：可安装 .jar + /give 命令 + 项目源码（可导出给 IDE）
```

### 3.2 Loader Adapter 差异点

| 项 | Fabric | NeoForge |
|---|---|---|
| 元数据 | `fabric.mod.json` | `mods.toml` |
| 构建插件 | Fabric Loom | NeoForge moddev |
| 注册方式 | Fabric API 事件（`Registry.register`） | `DeferredRegister` |
| 入口 | `ModInitializer` | `@Mod` 注解类 |
| 映射 | Yarn / Mojang | Mojang 官方 |

切换 loader 时，Adapter 重新翻译同一 Spec → 重新生成代码（不丢规格）。

**内部命名规范**：Loader Adapter **以 Mojang 官方名为内部规范名**。1.21.11 阶段 Fabric 侧加一层「Yarn → 官方」映射薄层；NeoForge 本就用官方名，无需转换。这样 26.1（两者都用官方名）切换时 Adapter 几乎不用改，去混淆对多 loader 支持是利好。

### 3.3 关键数据结构

- `ModSpec`（loader 无关）：`{ modId, version, items[], blocks[], recipes[], tags[] }`
- `GeneratorContext`：`{ loader, mcVersion, spec, projectPath }`
- `GenerationResult`：`{ files: FileTree, warnings[], buildCmd }`

---

## 4. 端到端数据流

```
用户输入（描述 + loader + MC版本）
   │
   ▼
AI 编排器 ──► 模型提供者（流式） ──► 产出 ModSpec(JSON)
   │                                    │ schema 校验失败 → 重试(最多3次)
   ▼                                    │
Spec 审阅 UI ◄──────────────────────────┘
   │ 用户确认/编辑
   ▼
Loader Adapter（按 loader 翻译 Spec）
   ├─ FabricAdapter  → 文件树 A
   └─ NeoForgeAdapter → 文件树 B
   ▼
文件系统（原子写入项目目录 + 生成 diff 预览）
   ▼
构建器（spawn Gradle，流式日志）
   ├─ 编译成功 → 提取 build/libs/*.jar
   └─ 编译失败 → 解析日志 → AI 修复循环(最多3次)
   ▼
输出：.jar + /give 命令 + 可导出源码项目
```

---

## 5. 错误处理

| 场景 | 策略 |
|---|---|
| AI 输出不合规 | JSON Schema 校验 → 失败带错误回灌 AI 重试（最多 3 次）→ 仍失败降级为人工编辑 |
| Gradle 编译失败 | 解析错误日志定位文件/行 → AI 修复循环（最多 3 次）→ 仍失败展示日志+建议 |
| JDK 缺失/版本不符 | 启动检测 → 引导安装正确版本（1.21.11 需 Java 21，26.1 需 Java 25） |
| 模型限流/网络断 | 指数退避重试 → 自动切换备选模型 → 提示用户 |
| 文件写入冲突 | 原子写入（写临时文件再 rename）+ 操作前快照可回滚 |
| 所有错误 | 用户可见的清晰中文错误 + 可操作建议 |

---

## 6. 测试策略

- **核心引擎单测（Vitest）**：Loader Adapter 各 loader 产出、Spec 校验、文件 diff、构建日志解析
- **黄金样本快照**：一组固定 Spec → 期望文件树快照，防止 Adapter 回归
- **集成冒烟**：端到端「描述 → .jar」，用最小 mod（单个物品）验证全链路
- **构建 CI**：Docker JDK 镜像里跑真实 Gradle 编译，确保产出有效 .jar
- **AI 不确定性**：只对 AI 输出做 Schema 校验断言，不做精确文本断言（避免脆弱测试）

---

## 7. 项目结构与技术栈

### 7.1 Monorepo（pnpm workspaces）

```
mc-creator/
├── packages/
│   ├── core/          # 核心引擎（纯 TS，无 UI 依赖）
│   │   ├── orchestrator/
│   │   ├── model-provider/
│   │   ├── filesystem/
│   │   ├── project/
│   │   ├── builder/
│   │   └── generators/
│   │       └── mod/           # Mod 生成器 + Loader Adapters
│   ├── ui/            # React 渲染进程
│   ├── electron/      # 主进程 + 类型化 IPC
│   └── shared/        # 类型、JSON Schema
├── apps/desktop/      # Electron 打包入口
└── pnpm-workspace.yaml
```

### 7.2 技术选型

| 层 | 选型 |
|---|---|
| 构建 | Vite + electron-vite |
| UI | React + TypeScript + Tailwind + shadcn/ui |
| 代码预览 | Monaco Editor |
| 节点画布（可选） | React Flow |
| 状态管理 | Zustand |
| IPC | 类型化（zod schema 校验） |
| AI 调用 | Vercel AI SDK（原语）+ 自建薄编排层（详见 2.4） |
| 测试 | Vitest |
| 打包 | electron-builder |

---

## 8. 7 生成器路线图

| 阶段 | 内容 | 说明 |
|---|---|---|
| 1 | 核心平台 | 壳 + 引擎 + AI + 文件 + 构建（本规格） |
| 2 | Mod 生成 | Fabric + NeoForge（本规格） |
| 3 | 数据包 | JSON 驱动，AI 最友好 |
| 4 | 整合包 + 服务器 | 配置组装 |
| 5 | 资源包（材质/音效/模型）+ 皮肤 | 图像生成 |
| 6 | 命令/函数 | mcfunction |
| 7 | 光影（可选） | shader packs |

---

## 9. v1 成功标准

- 自然语言描述一个含自定义物品/方块/配方的 mod
- 选 Fabric 或 NeoForge + 1.21.11
- AI 生成可审阅 Spec
- 一键编译产出可安装 .jar
- .jar 能进游戏，`/give` 能拿到自定义物品

---

## 10. 非目标（YAGNI，明确不做）

- 账号系统 / 多租户 / 在线服务（个人工具阶段）
- Forge / Quilt 支持（衰落/退役，不投入）
- 26.1 作为第一版默认目标（去混淆刚落地，生态转型中，仅预留适配）
- 可视化节点画布作为 v1 必须项（可选高阶，后续阶段）
- 复杂 mixin/世界生成类 mod 的自动生成（v1 聚焦物品/方块/配方等结构化内容）
