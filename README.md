# MC Creator

[![CI](https://github.com/USER/REPO/actions/workflows/ci.yml/badge.svg)](https://github.com/USER/REPO/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

<!-- 推送到 GitHub 后，把上面的 USER/REPO 替换为你的仓库地址（owner/repo），CI 徽章会自动显示构建状态。 -->

AI 驱动的 Minecraft 内容创作桌面客户端。让 AI 帮你生成 Mod 代码、数据包、整合包、服务器配置、材质包、皮肤和资源包，并通过内置构建链编译成 `.jar`，支持项目管理与一键部署。

## 功能特性

支持 **10 种生成器类型**，覆盖 Minecraft 内容创作的主要场景：

| 类型             | 说明                                                                   | 产物                                                                                                                           |
| ---------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Mod**          | Fabric / NeoForge 模组源码                                             | 完整 Gradle 项目 + `.jar` + `_meta.json` 元数据                                                                                |
| **数据包**       | 原版数据包（配方 / 标签 / 函数 / 进度 / 战利品 / 谓词）                | `pack.mcmeta` + `data/<ns>/`                                                                                                   |
| **整合包**       | Modrinth / CurseForge 格式                                             | `modrinth.index.json` 或 `manifest.json` + overrides + server-overrides                                                        |
| **服务器配置**   | 服务端配置包 + 一键部署脚本                                            | `server.properties` / `eula.txt` / 启动脚本 / `ops.json` / `whitelist.json` / `mods/` + `deploy/`（systemd / Docker / backup） |
| **资源包**       | 贴图覆盖（含纯色 / 渐变 / 棋盘格 PNG 生成）/ 模型 / 字体 / 音效 / 语言 | `pack.mcmeta` + `assets/<ns>/textures/` + `models/` + `font/` + `sounds/` + `lang/`                                            |
| **皮肤**         | 64×64 玩家皮肤（classic / slim 模型）                                  | `<playerName>.png` + 可选 `preview.png`                                                                                        |
| **启动器配置**   | 官方 / PCL2 / HMCL 三型启动器配置                                      | `launcher.json` + `profiles.json` + 启动脚本（bat/sh/ps1）+ `versions.json` + `config/theme.json`                              |
| **KubeJS 脚本**  | KubeJS mod 脚本包（配方 / 标签 / 事件 / 工具提示 / 注册）              | `pack.mcmeta` + `kubejs/server_scripts/` + `startup_scripts/` + `client_scripts/` + `lang/`                                    |
| **CraftTweaker** | ZenScript 脚本包（配方 / 标签 / 事件 / 工具提示）                      | `pack.mcmeta` + `scripts/*.zs` + `lang/`                                                                                       |
| **行为包**       | 基岩版 Behavior Pack（实体 / 配方 / 战利品表）                         | `manifest.json` + `entities/` + `recipes/` + `loot_tables/`                                                                    |

### 低代码节点编辑器

内置 **Coze 风格的可视化节点图编辑器**，采用纯 MC 视觉美学（3D 凸起边框、像素字体、石头纹理、内嵌端口），支持 **15 种节点类型**：

| 分类     | 节点类型                                              | 说明                                                |
| -------- | ----------------------------------------------------- | --------------------------------------------------- |
| 内容节点 | item / block / entity / recipe / machine / multiblock | MC 内容定义                                         |
| 逻辑节点 | event / condition / action                            | 事件驱动控制流                                      |
| 代码节点 | code / comment / **procedure**                        | 自定义 Java 代码 / 备注 / 过程封装（PureCode 模式） |
| 高级节点 | **variable** / **subgraph** / **loop** / **custom**   | 变量 / 子图封装 / 循环 / 自定义节点                 |

**高级功能：**

- **变量节点**：声明 int/double/string/boolean/item/block 类型变量，编译为 Java 字段
- **子图系统**：右键选中节点 → 封装为子图 → 独立画布编辑 → 端口映射 → 内联展开编译
- **循环节点**：for / forEach / while 三种循环模式，循环体引用子图编译
- **自定义节点**：JSON Schema 定义节点类型 → Mustache 模板渲染 → 导入/导出/分享
- **外部 Mod API**：引用外部 mod 命名空间 → 编译时依赖检测 → 运行时缺失警告
- **新手引导**：5 步交互式引导流程 + 模板搜索/分类筛选
- **调试面板**：节点状态高亮 / 错误恢复 / 字段级校验提示

### 核心能力

- **Agent 双模式**：AgentPanel 支持 agent / chat 双模式 —— agent 模式走「描述 → Spec → 代码」生成链路，chat 模式与模型自由对话；内置 Spec 历史回滚 / 模板 / 多模型对比
- **Spec-first 工作流**：自然语言描述 → AI 生成结构化 Spec → 用户审阅 → 生成代码 → 编译
- **低代码节点图**：可视化拖拽编辑 → 编译为 ModSpec → 生成 Java 代码（支持 15 种节点 + 子图内联 + 自定义节点模板 + 过程封装/PureCode 模式）
- **Spec 编辑器**：生成 Spec 后可直接在 Monaco 编辑器中修改 JSON 再生成代码
- **Spec 模板库**：10 种生成器类型共 36 个预置模板（TemplatePicker UI），点击即预填描述
- **Loader Adapter 抽象**：同一 ModSpec 按 Fabric / NeoForge / Quilt / Legacy Fabric 产出不同源码
- **AI prompt 按类型优化**：每种生成器有独立的 schema 约束提示，提升 Spec 质量
- **AI 模型接入**：基于 Vercel AI SDK，兼容 OpenAI 接口（云端 / 本地模型均可）
- **模型预设**：内置 OpenAI / DeepSeek / 通义千问 / 智谱 GLM / Ollama / LM Studio 六种预设
- **流式输出**：AI 回复逐字显示 + 构建日志实时流式输出
- **构建修复循环**：Gradle 构建失败 → 解析错误 → AI 修复源码 → 重新构建（最多 3 次）+ BuildCache 增量缓存
- **构建日志高亮**：error 红色 / warning 黄色，自动提取 jar 路径
- **PNG 预览**：材质 / 皮肤生成后直接在应用内预览（棋盘格透明背景 / skinview3d 3D 预览）
- **导出 zip**：一键打包所有生成文件（PNG 自动解码为二进制）
- **项目管理**：Dashboard 视图，项目持久化到本地，支持保存 / 加载 / 删除 / 导入 / 导出（zip 备份迁移）
- **Mod 市场接入**：Modrinth / CurseForge 搜索与版本获取，直接挑选 mod 生成整合包
- **服务器一键部署**：生成 systemd service / Dockerfile / docker-compose.yml / 自动备份脚本

## 技术栈

| 层             | 技术                                      |
| -------------- | ----------------------------------------- |
| 桌面框架       | Electron 31 + electron-vite 2.3           |
| 前端           | React 18 + TypeScript 5 + Tailwind CSS 3  |
| 节点图编辑器   | React Flow 11                             |
| 状态管理       | Zustand 4                                 |
| 代码编辑器     | Monaco Editor                             |
| 3D 皮肤预览    | skinview3d                                |
| AI 编排        | Vercel AI SDK 4 + `@ai-sdk/openai` 1.x    |
| Schema 校验    | Zod 3                                     |
| 打包           | JSZip 3                                   |
| 测试           | Vitest 2 + Testing Library                |
| 包管理         | pnpm 9 workspaces                         |
| Minecraft 版本 | 1.21.1 / 1.21.11                          |
| Loader         | Fabric / NeoForge / Quilt / Legacy Fabric |

## 项目结构

```
mc-creator/
├── apps/
│   └── desktop/                  # Electron 桌面应用
│       ├── src/
│       │   ├── main/             # 主进程（IPC handler / 模型配置 / 构建调用）
│       │   ├── preload/          # contextBridge 桥接
│       │   │   ├── renderer/         # 渲染进程（React UI）
│       │   │   │   └── src/
│       │   │   │       ├── components/   # AgentPanel / TemplatePicker / SpecFormEditor / PreviewPanel 系列 / BuildPanel / SettingsPanel
│       │   │   │       │   ├── lowcode/  # 低代码节点图编辑器（15 节点 + 子图 + 自定义节点 + 编译器）
│       │   │   │       │   └── middle/   # 各生成器类型预览面板（Mod / Datapack / Modpack / Server / Launcher / ResourcePack / Skin）
│       │   │   │       ├── store/        # Zustand stores（mod-store / node-graph-store / drawer-store / debugger-store）
│       │   │   │       └── lib/          # compileNodeGraph + 4 编译器 + ipc-client + monaco-theme
│       │   └── shared/           # IPC 通道常量 + zod schema（main/preload/renderer 共享）
│       └── electron.vite.config.ts
├── packages/
│   ├── shared/                   # 共享 schema 与类型
│   │   └── src/
│   │       ├── schemas/          # mod-spec / datapack-spec / modpack-spec / server-spec / resource-pack-spec / skin-spec / launcher-spec / kubejs-spec / crafttweaker-spec / behavior-pack-spec / node-graph-spec
│   │       ├── templates/        # 10 种生成器类型的 Spec 模板库（36 个模板，TEMPLATES_BY_TYPE）
│   │       ├── presets/          # 数据包内容模板（矿石 / 食物 / 维度 / 附魔 / 效果 / 结构 / 生物群系）
│   │       └── types/            # Loader / McVersion
│   └── core/                     # 核心引擎（独立 TS 库）
│       └── src/
│           ├── generators/       # 生成器（按 type 注册路由）
│           │   ├── mod/          # ModGenerator + fabric/neoforge/quilt/legacy-fabric adapters
│           │   ├── datapack/     # DatapackGenerator
│           │   ├── modpack/      # ModpackGenerator（Modrinth + CurseForge）
│           │   ├── server/       # ServerGenerator
│           │   ├── resource-pack/ # ResourcePackGenerator（贴图 / 模型 / 字体 / 音效 / 语言）
│           │   ├── skin/         # SkinGenerator + PNG 编码器
│           │   ├── launcher/     # LauncherGenerator（官方 / PCL2 / HMCL）
│           │   ├── kubejs/       # KubejsGenerator
│           │   ├── crafttweaker/ # CraftTweakerGenerator（ZenScript）
│           │   ├── behavior-pack/ # BehaviorPackGenerator（基岩版）
│           │   ├── registry.ts   # 生成器注册表（按 type 路由）
│           │   └── types.ts      # Generator 接口
│           ├── builder/          # Gradle 构建 + BuildFixer 修复循环 + BuildCache + log-parser
│           ├── model-provider/   # ModelProvider 抽象 + VercelAiProvider + MockProvider
│           ├── orchestrator/     # AI 编排器（描述 → Spec，10 种类型独立 prompt）
│           ├── filesystem/       # 文件系统抽象（用于测试）
│           └── utils/            # PNG 编码器（基于 zlib，无原生依赖）
├── docs/
│   ├── superpowers/
│   │   ├── specs/                # 设计规格
│   │   └── plans/                # 实现计划
│   └── a11y-guidelines.md        # 无障碍设计规范
├── pnpm-workspace.yaml
└── package.json
```

## 快速开始

### 环境要求

- **Node.js** ≥ 18
- **pnpm** ≥ 9
- **JDK 21+**（仅 Mod 构建需要，其他生成器不需要）

### 安装

```bash
pnpm install
```

> 注：Electron 二进制在国内网络可能下载失败，可设置镜像：
>
> ```bash
> set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
> pnpm install
> ```

### 开发运行

```bash
pnpm --filter @mc-creator/desktop dev
```

### 测试

```bash
pnpm -r test          # 运行所有包的测试
pnpm -r typecheck     # 类型检查所有包
```

### 代码质量

```bash
pnpm lint             # ESLint 检查（flat config，按 main/preload/renderer/packages 区分规则）
pnpm lint:fix         # ESLint 自动修复
pnpm format           # Prettier 格式化所有源文件
pnpm format:check     # Prettier 检查格式（不修改文件，CI 用）
```

代码风格约定：

- ESLint 9 flat config（`eslint.config.mjs`）+ typescript-eslint + react-hooks + react-refresh
- Prettier：单引号 / 分号 / 100 列 / trailing comma all / LF（`.prettierrc.json`）
- EditorConfig：UTF-8 / LF / 2 空格（`.editorconfig`，bat/ps1 用 CRLF）

### 构建

```bash
pnpm --filter @mc-creator/desktop build
```

## 使用指南

### 1. 配置 AI 模型

启动应用后，点击右上角「设置」按钮，填写：

- **名称**：配置显示名（任意）
- **模型 ID**：如 `gpt-4o-mini` / `deepseek-chat` / `qwen-plus`
- **Base URL**：OpenAI 兼容接口地址（如 `https://api.openai.com/v1`）
- **API Key**：你的密钥

支持任何兼容 OpenAI 接口的云端或本地模型（如 [Ollama](https://ollama.ai) 跑本地模型时 Base URL 填 `http://localhost:11434/v1`）。

### 2. 选择生成器类型

顶部工具栏「类型」下拉框选择（共 10 种）：

- Mod（默认）
- 数据包
- 整合包
- 服务器配置
- 资源包
- 皮肤
- 启动器配置
- KubeJS 脚本
- CraftTweaker 脚本
- 行为包

### 3. 选择 Loader 和 MC 版本

- **Loader**：Fabric / NeoForge / Quilt / Legacy Fabric / Vanilla（Mod 类型必选；脚本 / 皮肤 / 行为包等不依赖 loader 但仍需选）
- **MC 版本**：1.21.11（默认）/ 1.21.1

### 4. 生成流程

1. 在 AgentPanel 左侧描述框输入自然语言需求（或从模板库选择预置模板预填）
2. 点击「生成 Spec」→ AI 返回结构化规格（JSON）
3. 审阅 Spec，必要时修改描述重新生成，或用 Monaco 直接编辑 Spec JSON / Spec 表单微调字段
4. 点击「生成代码」→ 调用对应 Generator 产出文件树
5. 在中部预览面板查看生成内容（PNG 图片预览 / 3D 皮肤 / 表格等）
6. 点击「导出 zip」保存到本地

### 5. 编译 Mod（仅 Mod 类型）

1. 点击「编译」按钮
2. 系统自动调用 Gradle 构建
3. 若失败，点击「带修复构建」→ BuildFixer 会解析错误 → AI 修复源码 → 重新构建（最多 3 次）
4. 成功后显示 `.jar` 路径

## 架构设计

### 分层架构

```
┌─────────────────────────────────────────┐
│  Renderer（React UI）                   │
│  AgentPanel / TemplatePicker /          │
│  PreviewPanels / BuildPanel             │
└──────────────┬──────────────────────────┘
               │ IPC（zod 校验）
┌──────────────┴──────────────────────────┐
│  Main（Electron 主进程）                │
│  IPC Handlers / ModelConfig             │
└──────────────┬──────────────────────────┘
               │ 调用
┌──────────────┴──────────────────────────┐
│  Core Engine（独立 TS 库）              │
│  Orchestrator / Generator Registry /    │
│  Builder / BuildFixer / ModelProvider   │
└──────────────┬──────────────────────────┘
               │ 依赖
┌──────────────┴──────────────────────────┐
│  Shared（Schema + 类型）                │
│  Zod schemas / Loader / McVersion       │
└─────────────────────────────────────────┘
```

### Spec-first 数据流

```
用户描述
   │
   ▼
Orchestrator.generateModSpec(description)
   │  调用 ModelProvider.complete(prompt)
   ▼
结构化 Spec（JSON）
   │  用户审阅
   ▼
Generator.generate(ctx)
   │  ctx = { loader, mcVersion, modId, spec, projectPath }
   ▼
FileNode[]（path + content）
   │
   ▼
CodePreview 展示 / 导出 zip
```

### Generator 接口

所有生成器实现统一接口：

```typescript
interface Generator {
  readonly type: string; // 'mod' | 'datapack' | 'modpack' | 'server' | 'texture' | 'skin'
  readonly loaders: Loader[]; // 支持的 loader
  readonly versions: McVersion[]; // 支持的 MC 版本
  generate(ctx: GeneratorContext): Promise<GenerationResult>;
}
```

`GeneratorRegistry` 按 `type` 路由到对应生成器。添加新生成器只需实现接口并注册。

### Loader Adapter

ModGenerator 内部通过 Loader Adapter 抽象，同一 ModSpec 按 loader 产出不同源码：

- `FabricAdapter` → `fabric.mod.json` + `fabric.build.gradle` + Mixin
- `NeoForgeAdapter` → `neoforge.mods.toml` + `neoforge.build.gradle` + `@Mod` 注解

### PNG 编码器

材质 / 皮肤生成器使用自研的 PNG 编码器（`packages/core/src/utils/png-encoder.ts`），基于 Node.js 内置 `zlib`，无原生依赖：

- 支持 RGBA 8-bit
- 提供 `fillSolid` / `fillGradient` / `fillCheckerboard` 填充工具
- 输出标准 PNG（signature + IHDR + IDAT + IEND + CRC32）

PNG 二进制在 IPC 传输时以 base64 字符串存入 `FileNode.content`，导出 zip 时由主进程解码为二进制。

### 构建修复循环

```
runGradleBuild
   │
   ├─ 成功 → 返回 .jar
   │
   └─ 失败 → parseGradleErrors(log)
              │
              ▼
           BuildError[]
              │
              ▼
           ModelProvider 修复源码
              │
              ▼
           重新构建（最多 3 次）
```

## 开发指南

### 添加新生成器

1. **定义 Schema**：在 `packages/shared/src/schemas/` 新建 `<type>-spec.ts`，用 zod 定义规格
2. **实现 Generator**：在 `packages/core/src/generators/<type>/` 新建 `<type>-generator.ts`，实现 `Generator` 接口
3. **注册**：在 `packages/core/src/generators/index.ts` 的 registry 注册，并导出
4. **配置 Prompt**：在 `packages/core/src/orchestrator/orchestrator.ts` 的 PROMPTS 映射加类型专属 prompt
5. **模板**：在 `packages/shared/src/templates/` 新建 `<type>-templates.ts` 并挂到 `TEMPLATES_BY_TYPE`
6. **测试**：编写 `<type>-generator.test.ts`（TDD：先写测试 → 实现 → 通过）
7. **接入 UI**：
   - `apps/desktop/src/shared/ipc-channels.ts`：`GENERATOR_TYPES` 数组追加新类型
   - `apps/desktop/src/main/ipc.ts`：`GENERATE_FILES` handler 加 case 分支
   - `apps/desktop/src/renderer/src/components/AgentPanel.tsx`：placeholder 映射表补新类型

### 内部命名规范

- Mod ID：小写下划线 `^[a-z0-9_]+$`
- MC 版本：内部使用 Mojang 官方版本号（如 `1.21.1` / `1.21.11`）
- Loader：`'fabric' | 'neoforge' | 'quilt' | 'legacy_fabric' | 'vanilla'`（小写）

### 测试策略

- **TDD**：每步先写测试 → 确认 FAIL → 写实现 → 确认 PASS → commit
- **单元测试**：每个 Generator / Builder / Provider 都有独立测试
- **集成测试**：`packages/core/src/generators/mod/integration.test.ts` 验证端到端流程
- **mock 策略**：AI 调用用 `MockProvider`，文件系统用 `memfs`，进程执行用函数注入

## 测试覆盖

当前共 **1699+ 个测试**通过（本地实测 `pnpm -r test`）：

| 包                    | 测试文件 | 测试用例 |
| --------------------- | -------- | -------- |
| `@mc-creator/shared`  | 9        | 82       |
| `@mc-creator/core`    | 30       | 381      |
| `@mc-creator/desktop` | 99       | 1236     |

低代码模块测试覆盖：432 个测试（55 个文件），覆盖全部 15 种节点组件、4 个编译器、子图系统、自定义节点系统、过程节点 / PureCode 模式。

## 路线图

### 已完成

- ✅ P1：项目脚手架（monorepo + electron-vite）
- ✅ P2：核心引擎（Generator 接口 + Loader Adapter）
- ✅ P3：Electron UI（9 个 TDD 任务）
- ✅ P4：AI 模型接入（Vercel AI SDK + 流式输出）
- ✅ P5：构建修复循环（BuildFixer 最多 3 次重试）
- ✅ P6：数据包生成器
- ✅ P7：整合包生成器 + 生成器类型切换 UI
- ✅ P8：服务器配置生成器
- ✅ P9：材质 / 皮肤生成器（含自研 PNG 编码器）
- ✅ P10：完善现有 spec 字段（向后兼容扩展）
- ✅ P11：CodePreview PNG 预览
- ✅ P12：导出 zip 功能
- ✅ P13：项目文档 README
- ✅ P14：资源包生成器（模型 / 音效 / 字体 / 贴图覆盖 / 语言）
- ✅ P15：多项目管理 + Dashboard（项目持久化 / 保存 / 加载 / 删除）
- ✅ P16：AI prompt 按类型优化（每种生成器独立 schema 约束提示）
- ✅ P17：服务器一键部署脚本（systemd / Docker / docker-compose / 自动备份）
- ✅ P18：本地模型预设（OpenAI / DeepSeek / 通义千问 / 智谱 GLM / Ollama / LM Studio）
- ✅ P19：Spec 编辑器（Monaco 编辑器内修改 JSON 再生成代码）
- ✅ P20：构建面板流式输出与错误高亮（Gradle 日志逐行染色 + 自动提取 jar 路径）
- ✅ P21：README 路线图与使用指南同步（资源包补入使用指南、测试覆盖数修正）
- ✅ P22：优化现有功能（构建路径硬编码修复 + UI 一致性 + Dashboard 删除确认 + buildStream await）
- ✅ P23：错误处理打磨（AiChat 卡死风险 + 项目保存失败静默）
- ✅ P24：Spec 模板库（7 种生成器类型 27 个预置模板 + TemplatePicker UI）
- ✅ P25：Modrinth API 接入（搜索/版本获取 IPC + ModrinthSearchPanel UI + 整合包流程集成）
- ✅ P26：Quilt Loader 支持（Loader 类型扩展 + QuiltAdapter 复用 Fabric 适配器 + UI 选项）
- ✅ P27：Legacy Fabric Loader 支持（LegacyFabricAdapter extends FabricAdapter，旧版 fabric-loom 0.5 + Yarn mappings + Java 8）
- ✅ P28：项目导入/导出（Project 打包 zip 备份/迁移/分享，导入生成新 id 避免覆盖）
- ✅ P29：CurseForge API 接入（搜索/文件获取 IPC + CurseForgeSearchPanel + SettingsPanel API key 配置）
- ✅ P30：现有功能走查打磨（Dashboard 导入/导出 loading 状态 + ChatPanel 提取公共 pickModToSpec）
- ✅ P31：lucide-react 专业图标库（11 个组件 emoji/SVG 替换为专业图标，统一视觉风格）
- ✅ P32：Toast 通知系统（ToastProvider + useToast，4 种类型 success/error/warning/info，替换 window.alert）
- ✅ P33：Dashboard 视觉增强（统计栏：总项目数/总文件数/各类型分布 + 卡片缩略图：类型图标/描述/文件数）
- ✅ P34：可拖拽分割条（Splitter 组件，三栏布局宽度可调：左栏 160-480px / 右栏 200-600px）
- ✅ **低代码 Phase A**：节点图编辑器 UI 重构（McNodeShell 3D MC 风格 + 11 种节点迁移 + React Flow 画布）
- ✅ **低代码 Phase B**：用户体验增强（字段工具提示 + 错误恢复 + 5 个预设模板 + 搜索筛选 + 5 步新手引导）
- ✅ **低代码 Phase C**：高级功能（variable/subgraph/loop/custom 4 种新节点 + 4 个编译器 + 子图内联 + 自定义节点 Mustache 模板 + 外部 Mod API 依赖检测 + 7 个端到端集成测试）
- ✅ **代码审查修复**：25 个问题修复（代码注入防护 + 子图内联边重映射 + 子图编辑器交互回调 + Java 标识符校验）
- ✅ P35：启动器配置生成器（官方 / PCL2 / HMCL 三型 + bat/sh/ps1 启动脚本 + 注入防护转义）
- ✅ P36：KubeJS 脚本生成器（server_scripts / startup_scripts / client_scripts + 注册表 + 语言文件）
- ✅ P37：CraftTweaker 脚本生成器（ZenScript 配方 / 标签 / 事件 / 工具提示，不含注册表）
- ✅ P38：行为包生成器（基岩版 manifest + 实体 / 配方 / 战利品表）
- ✅ P39：AgentPanel agent/chat 双模式（Spec 历史回滚 / 模板库 / 多模型对比 / Spec 表单编辑器 / Agent 会话面板）
- ✅ P40：低代码增强（ProcedureNode 过程封装 + PureCode 模式切换 + codeLock 代码锁定 + 条件代码生成）
- ✅ P41：核心增强（BuildCache 构建缓存 + recipe-adapter 配方适配 + 增量生成测试 + 数据包模板库扩展）
- ✅ P42：文档同步（README 与实际代码状态对齐，10 种生成器 / 15 种节点 / 实测测试数）

### 未来可能

- 多 Mod 项目管理增强（依赖图 / 版本对比）
- 协作编辑（多端同步 Spec / 评论）

## 许可证

MIT
