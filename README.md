# MC Creator

AI 驱动的 Minecraft 内容创作桌面客户端。让 AI 帮你生成 Mod 代码、数据包、整合包、服务器配置、材质包、皮肤和资源包，并通过内置构建链编译成 `.jar`，支持项目管理与一键部署。

## 功能特性

支持 **7 种生成器类型**，覆盖 Minecraft 内容创作的主要场景：

| 类型 | 说明 | 产物 |
|------|------|------|
| **Mod** | Fabric / NeoForge 模组源码 | 完整 Gradle 项目 + `.jar` + `_meta.json` 元数据 |
| **数据包** | 原版数据包（配方 / 标签 / 函数 / 进度 / 战利品 / 谓词） | `pack.mcmeta` + `data/<ns>/` |
| **整合包** | Modrinth / CurseForge 格式 | `modrinth.index.json` 或 `manifest.json` + overrides + server-overrides |
| **服务器配置** | 服务端配置包 + 一键部署脚本 | `server.properties` / `eula.txt` / 启动脚本 / `ops.json` / `whitelist.json` / `mods/` + `deploy/`（systemd / Docker / backup） |
| **材质包** | 资源包（纯色 / 渐变 / 棋盘格 PNG） | `pack.mcmeta` + `assets/<modId>/textures/` |
| **皮肤** | 64×64 玩家皮肤（classic / slim 模型） | `<playerName>.png` + 可选 `preview.png` |
| **资源包** | 贴图覆盖 / 模型 / 字体 / 音效 / 语言 | `pack.mcmeta` + `assets/<ns>/textures/` + `models/` + `font/` + `sounds/` + `lang/` |

### 核心能力

- **Spec-first 工作流**：自然语言描述 → AI 生成结构化 Spec → 用户审阅 → 生成代码 → 编译
- **Spec 编辑器**：生成 Spec 后可直接在 Monaco 编辑器中修改 JSON 再生成代码
- **Loader Adapter 抽象**：同一 ModSpec 按 Fabric / NeoForge 产出不同源码
- **AI prompt 按类型优化**：每种生成器有独立的 schema 约束提示，提升 Spec 质量
- **AI 模型接入**：基于 Vercel AI SDK，兼容 OpenAI 接口（云端 / 本地模型均可）
- **模型预设**：内置 OpenAI / DeepSeek / 通义千问 / 智谱 GLM / Ollama / LM Studio 六种预设
- **流式输出**：AI 回复逐字显示 + 构建日志实时流式输出
- **构建修复循环**：Gradle 构建失败 → 解析错误 → AI 修复源码 → 重新构建（最多 3 次）
- **构建日志高亮**：error 红色 / warning 黄色，自动提取 jar 路径
- **PNG 预览**：材质 / 皮肤生成后直接在应用内预览（棋盘格透明背景）
- **导出 zip**：一键打包所有生成文件（PNG 自动解码为二进制）
- **项目管理**：Dashboard 视图，项目持久化到本地，支持保存 / 加载 / 删除
- **服务器一键部署**：生成 systemd service / Dockerfile / docker-compose.yml / 自动备份脚本

## 技术栈

| 层 | 技术 |
|---|---|
| 桌面框架 | Electron 31 + electron-vite 2.3 |
| 前端 | React 18 + TypeScript 5 + Tailwind CSS 3 |
| 状态管理 | Zustand 4 |
| 代码编辑器 | Monaco Editor |
| AI 编排 | Vercel AI SDK 4 + `@ai-sdk/openai` 1.x |
| Schema 校验 | Zod 3 |
| 打包 | JSZip 3 |
| 测试 | Vitest 2 |
| 包管理 | pnpm 9 workspaces |
| Minecraft 版本 | 1.21.1 / 1.21.11 |
| Loader | Fabric + NeoForge |

## 项目结构

```
mc-creator/
├── apps/
│   └── desktop/                  # Electron 桌面应用
│       ├── src/
│       │   ├── main/             # 主进程（IPC handler / 模型配置 / 构建调用）
│       │   ├── preload/          # contextBridge 桥接
│       │   ├── renderer/         # 渲染进程（React UI）
│       │   │   └── src/
│       │   │       ├── components/   # TopBar / ChatPanel / AiChat / CodePreview / BuildPanel / SettingsPanel / ErrorBanner / FileTree
│       │   │       ├── store/        # Zustand stores（mod-store / model-config-store）
│       │   │       └── lib/          # ipc-client 封装
│       │   └── shared/           # IPC 通道常量 + zod schema（main/preload/renderer 共享）
│       └── electron.vite.config.ts
├── packages/
│   ├── shared/                   # 共享 schema 与类型
│   │   └── src/
│   │       ├── schemas/          # mod-spec / datapack-spec / modpack-spec / server-spec / texture-spec / generator
│   │       └── types/            # Loader / McVersion
│   └── core/                     # 核心引擎（独立 TS 库）
│       └── src/
│           ├── generators/       # 生成器
│           │   ├── mod/          # ModGenerator + fabric-adapter + neoforge-adapter + templates
│           │   ├── datapack/     # DatapackGenerator
│           │   ├── modpack/      # ModpackGenerator（Modrinth + CurseForge）
│           │   ├── server/       # ServerGenerator
│           │   ├── texture/      # TextureGenerator + SkinGenerator
│           │   ├── registry.ts   # 生成器注册表（按 type 路由）
│           │   └── types.ts      # Generator 接口
│           ├── builder/          # Gradle 构建 + BuildFixer 修复循环 + log-parser
│           ├── model-provider/   # ModelProvider 抽象 + VercelAiProvider + MockProvider
│           ├── orchestrator/     # AI 编排器（描述 → Spec）
│           ├── filesystem/       # 文件系统抽象（用于测试）
│           └── utils/            # PNG 编码器（基于 zlib，无原生依赖）
├── docs/
│   └── superpowers/
│       ├── specs/                # 设计规格
│       └── plans/                # 实现计划（P1-P5）
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

顶部工具栏「类型」下拉框选择：
- Mod（默认）
- 数据包
- 整合包
- 服务器配置
- 材质包
- 皮肤
- 资源包

### 3. 选择 Loader 和 MC 版本

- **Loader**：Fabric / NeoForge（Mod 类型必选；材质 / 皮肤不依赖 loader 但仍需选）
- **MC 版本**：1.21.11（默认）/ 1.21.1

### 4. 生成流程

1. 在左侧描述框输入自然语言需求
2. 点击「生成 Spec」→ AI 返回结构化规格（JSON）
3. 审阅 Spec，必要时修改描述重新生成
4. 点击「生成代码」→ 调用对应 Generator 产出文件树
5. 在右侧 CodePreview 查看文件（PNG 文件会显示图片预览）
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
│  TopBar / ChatPanel / AiChat /          │
│  CodePreview / BuildPanel               │
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
  readonly type: string;              // 'mod' | 'datapack' | 'modpack' | 'server' | 'texture' | 'skin'
  readonly loaders: Loader[];         // 支持的 loader
  readonly versions: McVersion[];     // 支持的 MC 版本
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
3. **导出**：在 `packages/core/src/generators/index.ts` 追加导出
4. **测试**：编写 `<type>-generator.test.ts`（TDD：先写测试 → 实现 → 通过）
5. **接入 UI**：
   - `apps/desktop/src/shared/ipc-channels.ts`：`GENERATOR_TYPES` 数组追加新类型
   - `apps/desktop/src/main/ipc.ts`：`GENERATE_FILES` handler 加 case 分支
   - `apps/desktop/src/renderer/src/components/TopBar.tsx`：加 `<option>`
   - `apps/desktop/src/renderer/src/components/ChatPanel.tsx`：加 placeholder

### 内部命名规范

- Mod ID：小写下划线 `^[a-z0-9_]+$`
- MC 版本：内部使用 Mojang 官方版本号（如 `1.21.1` / `1.21.11`）
- Loader：`'fabric' | 'neoforge'`（小写）

### 测试策略

- **TDD**：每步先写测试 → 确认 FAIL → 写实现 → 确认 PASS → commit
- **单元测试**：每个 Generator / Builder / Provider 都有独立测试
- **集成测试**：`packages/core/src/generators/mod/integration.test.ts` 验证端到端流程
- **mock 策略**：AI 调用用 `MockProvider`，文件系统用 `memfs`，进程执行用函数注入

## 测试覆盖

当前共 **153 个测试**通过：

| 包 | 测试文件 | 测试用例 |
|---|---|---|
| `@mc-creator/core` | 19 | 138 |
| `@mc-creator/desktop` | 4 | 15 |

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

### 未来可能

- Spec 模板库（常见 Mod 类型一键起手）
- 在线素材市场接入（Modrinth / CurseForge 资源直链下载）
- 多 Mod 项目管理增强（依赖图 / 版本对比 / 导入导出）
- 协作编辑（多端同步 Spec / 评论）
- 更多 MC 版本与 Loader（Quilt / Legacy Fabric）

## 许可证

MIT
