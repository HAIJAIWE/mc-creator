# MC 全链路 AI 工作台 · 完整设计文档

> 版本 v3.1 · 面向编程 AI 的实施规格（修订记录见 §24）
> 本文档是项目的唯一事实来源。实现前若与本文档冲突，以本文档为准；
> 本文档未覆盖处，标注 `[待核实]`，实现前须核对官方文档。

---

## 0. 项目定位

### 0.1 一句话定义

一个 **AI 原生的 Minecraft 全链路工作台**：以智能体为核心，统一覆盖
**客户端运行（启动器）· 服务端运维 · MC 内容开发** 三个领域，
形成「生成 → 部署 → 运行 → 观测 → 修复」的自驱动闭环。

### 0.2 本质结构（重要，纠正常见误解）

```
        智能体层（横向贯穿 · 唯一实现）
  生成 · 驱动 · 观测 · 修复 —— 对三个领域暴露同一套操作接口
                    │
   ┌────────────────┼────────────────┐
   │                │                │
 启动器           服务器           MC 开发
 把内容跑起来      长期运行形态      产出内容本身
 Java+基岩双端     Paper/Folia/    数据包/Add-on/
 实例·账户·装配    代理/BDS         插件/模组
   │                │                │
   └────────────────┼────────────────┘
                    │
        共享底座（跨三域复用）
   下载引擎·任务队列·原子写·凭据·运行抽象·验证闭环·工程化管线
```

**关键原则：智能体不是并列的第四项，而是贯穿前三项的执行方式。**
三域必须向智能体暴露同一套操作抽象，否则项目退化为「三个独立工具 + 一个聊天框」。

### 0.3 为什么这个组合成立

数据包与基岩脚本的**验证成本是秒级**，服务端插件/Mod 为**十秒到分钟级**——这条梯度是整套设计的物理基础（详见 §11）：

| 领域           | 改一行后的验证方式                | 反馈延迟 |
| -------------- | --------------------------------- | -------- |
| 数据包         | `/reload` + `/datapack list`      | 秒级     |
| 基岩 Add-on    | 装载 + 游戏内事件                 | 秒级     |
| Paper 插件     | 启动无头服务端 + 控制台/RCON 驱动 | 5~15 秒  |
| 服务端 Mod     | Gradle 增量构建 + 无头服务端      | 30~90 秒 |
| 客户端 Mod     | 需图形环境才能看效果              | 60 秒+   |
| Mixin 重度 Mod | 字节码注入，报错难定位            | 分钟级   |

**反馈速度决定了智能体能迭代多少轮。** 因此实现优先级应按此阶梯自下而上。

### 0.4 品类定位

本项目不是「一个更好用的启动器」（该赛道已满：PCL / HMCL / XMCL / Prism），
而是 **「MC 全链路的 AI 原生工作台」**。类比：Cursor 之于编程，
只不过运行环境是 MC 而非本地编译器。

差异化空位：**本地优先 + 跨域打通 + 闭环自驱动**。
现有竞品均在单点上（启动器只管运行，插件生成器只管产出 jar，服务端面板只管运维）。

### 0.5 硬约束

必须遵守：

1. **全栈单语言 TypeScript**（devkit 管理的 Java 工具链除外——那是被管理对象，不是本项目代码）
2. 工程结构参考 **XMCL**（MIT 授权，可自由借鉴）
3. **版本号、pack_format、加载器版本、映射版本一律运行时拉取**，禁止模型凭记忆输出
4. 所有 AI 生成的代码**必须在沙箱中编译与验证**，未经用户显式确认不得加载进正式实例或服务端
5. 生成代码的**产物哈希必须记录并对外可见**

### 0.6 非目标（明确不做，防止范围蔓延）

- 不内置游戏本体下载、不绕过正版验证
- 不做内容分发平台（不做 UGC 社区、不做投稿审核）
- 不做服务器托管服务（做本地/自托管管理工具，不做 SaaS 面板）
- 不做手机端 / 主机端
- 不做通用 Java IDE（只做「生成 + 编译 + 验证」闭环，不做代码编辑器）
- 不做反混淆破解工具的传播（映射数据仅用于正当模组开发）

---

## 1. 合规基线

> 本规格为工程文档，不构成法律意见。商业化前须由执业律师审查。

### 1.1 Mojang EULA

- 允许开发第三方工具，但**不得表现为官方或获官方认可**：
  不使用 Mojang/Minecraft 徽标、不使用官方字体做 Logo、名称与视觉不得引起官方联想
- **未经允许不得将 Mojang 创建的内容用于商业用途**
  → 收费模式、内置资源分发、皮肤/材质资产来源均需逐项审查
- 建议：产品名、图标、字体全部原创；收费点只落在「自有功能」（AI 生成、内容管理、云同步），
  不落在「Minecraft 内容本身」

### 1.2 账户立场（需产品决策）

- 以**正版（微软账户）为第一路径**
- 离线模式仅作为本地开发/测试用途保留，**不在产品宣传中作为卖点**
- 风险提示：微软服务协议限制绕过技术保护措施

### 1.3 第三方平台 AI 内容政策（直接影响 AI 功能定位）

- Modrinth 已规定：**完全由 AI「提示 + 测试」生成、几乎无人类原创内容的项目被禁止**，
  此类项目可设为不公开并禁止出现在公开搜索结果，同时强制 AI 披露
- **结论：AI 生成能力定位为「个人内容 + 创作辅助」，不作为「一键产出可发布内容」**
- 生成物默认标记为非公开用途；导出时提示用户目标平台政策

---

## 2. 总体架构

### 2.1 分层

```
┌──────────────────────────────────────────────────────┐
│ 共享外壳 Shell（唯一实现）                              │
│ Electron · 下载引擎 · 任务队列 · 凭据存储 · UI 组件库 ·  │
│ i18n/主题/设置 · 日志遥测 · 更新器 ·                     │
│ 智能体进程 · MCP 工具层 · 工程化管线                     │
├──────────────────────────────────────────────────────┤
│ 薄契约 Contract（只有类型，无实现）                      │
│ KernelContract · EditionCapability · Task ·           │
│ StatusSnapshot · KernelRegistry                       │
├────────────┬────────────┬────────────┬───────────────┤
│ Java 内核   │ Bedrock 内核│ 服务端内核  │ 开发内核       │
│ 客户端实例  │ 内容网关    │ 长期托管进程│ devkit        │
└────────────┴────────────┴────────────┴───────────────┘
```

### 2.2 设计原则

1. **禁止为对称而抽象。** 四个内核的内部架构可以完全不同
2. **外壳永不 import 内核具体实现**，只依赖契约接口
3. **内核可插拔**：Java 必装，其余可选 → 支持出轻量安装包
4. **跨内核不统一业务接口**，只统一：UI 呈现层 + MCP 工具签名 + 契约类型

### 2.3 通信

- 客户端 ↔ 能力层：Electron IPC（`invoke`/`handle`）+ `contextBridge` 白名单
- 智能体 ↔ 能力层：MCP（Streamable HTTP 生产环境 / stdio 本地工具）
- 长任务：**独立 Node 进程 + 持久化任务队列**（不随窗口存活而终止）

---

## 3. 薄契约（唯一强制统一的类型）

```ts
// packages/contract —— 只有类型，无实现

export type Edition = 'java' | 'bedrock' | 'server' | 'devkit';

export type ContentKind =
  | 'game-version'
  | 'java-runtime'
  | 'account'
  | 'cape'
  | 'instance'
  | 'world'
  | 'world-template'
  | 'modpack'
  | 'mod'
  | 'resourcepack'
  | 'shader'
  | 'datapack'
  | 'addon'
  | 'skinpack'
  | 'texturepack'
  | 'skin'
  | 'soundpack'
  | 'languagepack'
  | 'font'
  | 'structure'
  | 'server'
  | 'server-config'
  | 'server-plugin'
  | 'proxy'
  | 'proxy-plugin'
  | 'proxy-config'
  | 'server-backup'
  | 'server-task'
  | 'mod-project'
  | 'plugin-project'
  | 'build-artifact'
  | 'dev-toolchain'
  | 'mapping-set'
  | 'test-harness';

export interface EditionCapability {
  kind: ContentKind;
  supported: boolean;
  note?: string; // 语义差异说明（如"对应物为 Add-on"）
}

export interface KernelContract {
  readonly edition: Edition;
  capabilities(): EditionCapability[];
  status(): StatusSnapshot; // 统一状态快照，供 UI 与智能体消费
  dispatch(task: TaskSpec): TaskHandle; // 所有长任务统一入口
}

export interface TaskSpec {
  id: string;
  kind: string; // install_modpack / generate_content / ...
  payload: unknown;
}

export interface TaskHandle {
  readonly id: string;
  progress: AsyncIterable<ProgressEvent>;
  cancel(): void;
  result(): Promise<TaskResult>;
}

export interface TaskResult {
  ok: boolean;
  artifacts?: ArtifactRef[]; // 产物（含哈希）
  error?: ClassifiedError;
}

export interface ArtifactRef {
  path: string;
  sha256: string;
  kind: ContentKind;
}

export interface KernelRegistry {
  available(): KernelContract[];
  get(edition: Edition): KernelContract;
}
```

**关键：契约里没有内容操作的统一业务接口。** Mod、Add-on、Skin 等各自归属内核，
不强行统一。跨内核的「统一」只发生在 UI 呈现层和 MCP 工具层。

---

## 4. 共享外壳（清单）

### 4.1 系统与容器

Electron 43+（具体版本由 CI 锁定，不写死进生成上下文）· 窗口/托盘/多窗口 · 单实例锁 · 深链协议注册

### 4.2 基础能力

- **下载引擎**：undici，分块并发、断点续传、哈希校验、复用 socket
- **任务队列**：持久化、优先级、可取消、崩溃后可恢复
- **文件原子写**：临时目录 → 校验 → 原子重命名
- **路径工具**：Windows 长路径（`\\?\` 前缀）、Unicode 全链路
- **压缩解压**：含 zip-slip 防护、压缩炸弹防护

### 4.3 安全

`contextBridge` 白名单 · IPC `invoke`/`handle` · `safeStorage` 凭据加密 · CSP `'self'`

### 4.4 状态

better-sqlite3（元数据）· electron-store（设置）

### 4.5 呈现

UI 组件库 · 主题系统 · i18n · 错误文案映射层

### 4.6 运维

分级日志（Trace/Info/Warn/Error）+ 轮转 · 遥测 · electron-updater 灰度

### 4.7 智能体

独立进程 · MCP 工具层 · 编排 · 成本控制

### 4.8 工程化

esbuild + Vite · electron-builder · Vitest + Playwright · CI 六平台矩阵

---

## 5. Java 内核（客户端实例）

职责：**文件系统管理者 + 进程启动器**

### 5.1 版本与运行时

- Mojang `version_manifest_v2.json`（权威源）→ BMCLAPI 镜像加速
- 支持范围（建议）：`1.12.2 / 1.16.5 / 1.20.1 / 1.21.x / 26.x`
- Java 运行时：扫描注册表/PATH/常见目录；按版本匹配 Java 8/17/21；
  Adoptium API 自动下载；支持 x86/ARM/LoongArch

### 5.2 实例（Instance）

- 隔离模式：全局共享 / 完全隔离 / 仅加载器隔离
- 每实例独立：`mods / resourcepacks / shaderpacks / config / saves / JVM 参数`
- 目录布局兼容 MultiMC / Prism / CurseForge 导入导出（迁移是拉新关键功能）

### 5.3 模组（Mod）

- 加载器：Forge / NeoForge / Fabric / Quilt / LiteLoader
- 元数据：`mods.toml` / `fabric.mod.json` / `quilt.mod.json`
- 依赖语义：`depends / recommends / suggests / breaks / conflicts`；
  完整 Maven version range 解析；前置库自动补全
- 客户端/服务端标记；加载顺序；Mixin / AccessWidener 冲突检测
- **崩溃归因**：`latest.log` / `hs_err_pid` / `crash-report` → 映射到具体 Mod
- 双源检索：CurseForge API + Modrinth API

### 5.4 整合包（Modpack）

- CurseForge zip（`manifest.json` + overrides）
- Modrinth `.mrpack`（`modrinth.index.json`）
- **增量更新**（大整合包全量重下的体验不可接受）
- 依赖自动解析、冲突预检

### 5.5 资源包 / 材质

- `pack.mcmeta` 的 `pack_format`（⚠️ **与数据包已分离，是两个不同数值**）
- 分辨率 16x～512x；PBR：`_n`（法线）/ `_s`（高光）
- CIT（OptiFine 自定义物品纹理）、自定义模型/天空
- 字体（`font`）、音效（`sounds.json`）、语言文件（`lang`）
- 多包覆盖优先级与冲突检测

### 5.6 光影

- Iris / OptiFine shaderpack；Iris + Sodium 组合
- 与资源包 PBR 贴图协同

### 5.7 数据包

- `pack.mcmeta` + `data/<namespace>/`
- function / recipe / advancement / loot_table / tags / structure / dimension
- ⚠️ **目录层级陷阱**：根目录必须直接含 `pack.mcmeta` 与 `data/`，禁止多套一层
- 生成建议走 **Sandstone**（TS → 数据包），不裸写 JSON
- 静态验证：Spyglass 式检查；动态验证：`/reload` + `/datapack list`

### 5.8 账户

- 微软 OAuth 2.0（Authorization Code + PKCE / Device Code Flow）
- 多账户并存切换、token 刷新
- authlib-injector / Yggdrasil（第三方皮肤站）——**默认关闭**，仅面向已自建认证的私服/开发场景；
  不得用于绕过正版验证，启用须用户显式确认并提示合规风险（见 §1.2 / §19）
- 披风（Cape）：仅正版，走 Mojang API

### 5.9 皮肤

- `64×64` PNG；第二层 `64×64`（帽子/外套）
- 模型：classic（4px 手臂）/ slim（3px 手臂）
- 上传：Mojang 官方皮肤 API（需 access token）
- 预览渲染：skinview3d（Three.js 系）
- 本地皮肤库 + 快速切换

---

## 6. Bedrock 内核（内容网关）

职责：**导入网关 + 包生成器**（**不做通用文件管理**）

### 6.1 环境探测（关键约束）

- 内容目录（旧 UWP 形态）：`%localappdata%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang`
- 内容目录（新版 GDK，1.21.120 起）：`%appdata%\Minecraft Bedrock\users\shared\games\com.mojang`
  （预览版为 `Minecraft Bedrock Preview\users\shared\games\com.mojang`）
  — 依据微软官方 GDK 迁移文档
  `learn.microsoft.com/en-us/minecraft/creator/documents/gdkpcprojectfolder`
  （"GDK migration (the new style)"，ms.date 2025-10-24，2026-10 核实）。
  **注意新版 GDK 内容根在 `%APPDATA%` 下，不在 `%LOCALAPPDATA%\Packages\<包名>\` 下**
- 游戏安装目录在 `Program Files\WindowsApps\` 下，属 **UWP 受保护目录**，
  即使用管理员账户也可能无权访问 → **不得依赖直接读写**
- 目录名存在变更（本文档 v3.1 初稿曾写作「新版 GDK 包名为 `Minecraft for Windows`」，
  **该拼写未获权威来源证实，微软官方文档全文未出现该目录名，已于 2026-10 更正为上文的
  `%APPDATA%\Minecraft Bedrock\...` 形态**），必须做**名称探测 + 多路径回退**，不可硬编码
- **存在 ≠ 可读**：目录存在但无权读取（EACCES/EPERM）与目录不存在是两种不同结论，
  前者必须降级、后者才是「未安装」，不可合并，也不可对「存在即可读」做乐观回退 ——
  否则权限受限信号会被另一个恰好可读的路径掩盖，降级路径永不触发
- 权限不足时**降级为「生成合法包 + 引导用户双击导入」**

### 6.2 导入网关

- 支持格式：`.mcpack`（单包）/ `.mcaddon`（行为包+资源包成对）/ `.mcworld` / `.mctemplate`
- **官方深链协议优先**，文件落位为次选
- 导入前校验：`manifest.json` 完整性、uuid 唯一性、`min_engine_version` 兼容性

### 6.3 Add-on（附加包）

- `behavior_pack`（行为）+ `resource_pack`（资源）成对
- `manifest.json`：`uuid / version / min_engine_version / format_version`
- **Script API（TS 原生，AI 生成主战场）**：
  - `@minecraft/server` —— 实体/方块/物品/事件
  - `@minecraft/server-ui` —— 表单 UI
  - `@minecraft/server-admin` —— 服务器管理
  - `@minecraft/server-net` —— HTTP
- 实验性 API 需在 manifest 声明

### 6.4 材质与皮肤

- 资源包：`manifest.json` + `textures/` + `textures_list.json`
- 纹理图集（atlas）；字体 glyph；`sounds.json`
- 无光影系统，替代物为 **RTX**：MER 贴图（Metalness/Emissive/Roughness）
- 皮肤：PNG `64×64`；HD 皮肤尺寸更大；另有 Persona（3D/4D）皮肤
- 打包 skin pack（`.mcpack`）：`manifest.json` + `skins.json`
  `skins.json` 定义 geometry / texture 路径 / cape 引用 / 名称
- 平台限制：主机平台皮肤受政策限制，跨平台不通用

### 6.5 服务端

- BDS（Bedrock Dedicated Server）、`server.properties`、`allow-list`
- 脚本 API 支持；Realms

---

## 7. 服务端内核

职责：**长期托管进程管理**

### 7.1 与 Java 内核的本质差异

服务端是**长期托管进程**，需要：进程保活、控制台流式 I/O、优雅停机、
崩溃自动重启、以及「改配置要重启还是能热载」的判断。
因此它是**独立内核**，不是 Java 内核的子功能。

### 7.2 服务端运行时矩阵

| 形态            | 实现                                                            |
| --------------- | --------------------------------------------------------------- |
| Java 插件服务端 | Paper / Purpur / Folia / Spigot                                 |
| Java Mod 服务端 | Forge / NeoForge / Fabric 服务端形态                            |
| 基岩服务端      | BDS                                                             |
| 代理层          | Velocity / BungeeCord / Waterfall（独立网络层，处理多子服路由） |

### 7.3 插件开发（2026 关键变化）

- **Paper 新格式 `paper-plugin.yml`**：能利用 Mojang 现代概念（如数据包）扩展 API 能力面，
  **不是 `plugin.yml` 的直接替代**，两者可共存于同一 JAR
  → 工具链必须**同时支持两种清单格式**
- `api-version` 字段现在会出现 `'26.1.2'` 这样的新版本号
- **Folia 支持是硬开关**：插件不声明 `folia-supported: true` 则**无法在 Folia 上运行**
  - 运行时检测：判断 `io.papermc.paper.threadedregions.RegionizedServer` 类是否存在
  - **生成的插件代码必须知道自己在哪个平台上** → 上下文必须注入

### 7.4 服务端管理能力

- 配置管理：`server.properties` / `bukkit.yml` / `spigot.yml` / `paper-global.yml` / `purpur.yml`
- 控制台与 RCON：流式日志、命令注入
- 生命周期：启动/停止/重启/崩溃自动拉起/优雅停机
- 备份：定时快照、增量备份
- 定时任务：重启 / 备份 / 广播

---

## 8. 开发内核（devkit）

职责：**构建沙箱与工具链管理**（技术含量最高的一块）

### 8.1 能力清单

1. **JDK 工具链管理**：多版本并存（8 / 17 / 21 / 25），按目标 MC 版本与加载器自动选择
2. **Gradle 编排**：wrapper 复用、常驻 daemon、离线依赖缓存
3. **依赖解析**：Maven 仓库镜像、本地离线缓存（首次构建后应能断网工作）
4. **编译**：javac / Gradle build，捕获结构化错误
5. **隔离运行**：编译产物在一次性沙箱中加载测试
6. **产物签名与校验**：输出 JAR 的哈希记录

### 8.2 关键性能设计

- **Gradle daemon 常驻**：首次构建慢（下载依赖），后续增量构建可压到秒级
- **依赖缓存预热**：为高频版本组合预置依赖
  （1.20.1 Forge、1.21.1 NeoForge、1.21.x Fabric 等）
- **编译优先走 javac**（快），仅在需要完整构建产物时才走 Gradle
- **并发构建队列**：避免多个 Gradle 实例争抢内存

### 8.3 安全模型（关键）

```
⚠️ 约束：JDK 17 起 SecurityManager 被标记为待移除，JDK 24 已永久禁用
   → 无法在进程内沙箱化 Java 代码
   → 必须使用进程级或容器级隔离
```

隔离要求：

- 编译在**独立进程**，设 CPU / 内存 / 时间上限
- 运行验证在**一次性容器或进程**中，禁用网络出站（或白名单）
- 一次性沙箱内生成的代码**永不自动加载**进用户的正式服务端
- 所有产物**哈希记录**，供用户审计

### 8.4 开发语言技术线（2026 关键变化）

- **映射体系换代**：Yarn 一直是 Fabric 默认映射，但从 **26.1 起（即 1.21.11 之后的未混淆版本）Fabric 迁向 Mojang 官方映射**
  → 旧教程与现有语料大量基于 Yarn，生成器选错映射会让产出对不上文档
  - 迁移工具：Loom 的 `migrateMappings` 任务（半自动，**不支持 Kotlin**）；
    复杂项目用 IntelliJ 的 **Ravel** 插件（支持 Kotlin）
- **去混淆（已确认，非假设）**：Mojang 已宣布自 2026 年（`26.x` / 首个未混淆版本起）**不再对 Java 版混淆**，
  `1.21.11` 及更早版本仍为混淆；Fabric 已进入映射迁移准备期
  → 模组开发门槛将显著降低；但 `pack_format` / 映射 / API 仍须按版本运行时查表，禁止写死
- **Parchment** 必须配置：社区维护的参数名与 javadoc 映射，叠加在 Mojang 官方映射之上，
  把 `p_` 这种无意义参数名变成可读名称 → 对代码生成质量影响极大
  - 配置走 `gradle.properties`，ModDevGradle 与 NeoGradle 写法不同

---

## 9. 内容对象模型（34 类，按家族组织）

```markdown
A. 版本与运行时
GameVersion 版本清单、正式版/快照/远古版、加载器版本
JavaRuntime Java 运行时（Java only）

B. 身份
Account 账户（正版/离线/第三方）
Cape 披风

C. 实例与环境
Instance 游戏实例 / Profile
World 存档
WorldTemplate 世界模板

D. Java 内容
Modpack · Mod · ResourcePack · Shader · Datapack

E. Bedrock 内容
Add-on · SkinPack · TexturePack

F. 通用内容
Skin · SoundPack · LanguagePack · Font · Structure（.nbt/.schematic/.litematic）

G. 服务端
Server · ServerConfig · ServerPlugin · Proxy · ProxyPlugin · ProxyConfig
ServerBackup · ServerTask

H. 开发
ModProject · PluginProject · BuildArtifact
DevToolchain · MappingSet · TestHarness
```

**注**：Recipe / Advancement / LootTable 属数据包内部元素，
但需支持独立检索与单点生成。

---

## 10. 智能体层

### 10.0 模型接入层（架构前置，勿省略）

- **后端双通道**：内置默认供应商 + **BYOK（用户自带 Key / 自建 OpenAI 兼容端点）**
- **密钥安全**：LLM 凭据一律走 OS 级加密（Electron `safeStorage`），禁止明文落 json / 日志 / 遥测（对齐 §13.2）
- **推理网关**：统一 `infer(messages, tools, budget)` 接口，内置重试 / 限流 / 超时 / 多模型路由 / 流式输出
- **能力分级**：按任务复杂度路由（生成走强模型，校验 / 摘要走廉价模型）
- **失败降级**：超时或超预算 → 降级模型或转人工确认（对齐 §10.5）
- **合规开关**：生成内容是否出境 / 是否用于训练，作为企业采购选项（对齐 §21）

### 10.1 技术选型

- **协议**：MCP（Model Context Protocol）TypeScript SDK
- **传输**：Streamable HTTP（生产）/ stdio（本地工具）
- **编排**：轻量 SDK 级（单轮 + 工具调用为主），**不使用图状态机**
- **位置**：独立进程，长任务不随窗口关闭终止
- **工具设计**：能力只实现一次，同时暴露 IPC（UI）与 MCP（智能体）

### 10.2 MCP 工具清单（示例）

```
【读现状 —— 闭环必需，缺失则智能体只能盲生成】
get_capabilities(edition)                        R ← 强制第一步
list_versions(edition)                           R
get_target_state(target)                         R ← 已装内容/配置/上次构建产物与失败原因
read_config(target, scope)                       R
read_logs(target, filter)                        R
search_content(kind, query, edition, cursor)     R ← 支持分页/游标
list_instances() / list_servers()                R
get_context_pack(target)                         R ← 见 §10.4 状态注入

【内容装配 —— 写实例目录】
install_modpack(ref, target)                     W
install_mod(ref, target)                         W ← Java
install_addon(ref, target)                       W ← Bedrock
import_package(path, target)                     W ← .mcpack/.mcaddon/.mrpack
apply_skin(skinRef, target)                      W
uninstall_content(ref, target)                   W

【执行与运维 —— 必须弹窗确认】
launch_instance(instanceId)                      X
create_instance(spec) / delete_instance(id)      X
build_project(projectRef)                        X ← devkit
deploy_plugin(projectRef, serverId)              X
restart_server(serverId) / stop_server(id)       X
rollback_build(projectRef)                       X

【生成与校验】
generate_content(prompt, kind, edition, version) X
validate_content(path, edition, version)         R

（R=只读免确认 / W=写实例可配置免确认 / X=执行进程须弹窗，对齐 §10.6）
```

### 10.3 生成闭环与成功判据

```
生成 → 装载 → 验证 → 日志诊断 → 错误回灌修复
```

**「验证」必须机器可判定，否则自动循环不知该停还是该改：**

| 产物           | 成功信号（机器可判定）                                   |
| -------------- | -------------------------------------------------------- |
| 数据包         | `/reload` 无报错 且 `/datapack list` 含目标命名空间      |
| Bedrock Add-on | `manifest` 校验通过 且 事件回调触发（脚本日志出现）      |
| Paper 插件     | 日志出现启动完成标志 且 插件 `enabled`（无 `Exception`） |
| 服务端 Mod     | 无 `FATAL` / `Exception` 且 端口监听成功                 |
| 客户端 Mod     | 日志无崩溃 且 目标功能可观测（需图形环境，成本最高）     |

> 单圈成本：数据包 / 基岩秒级，插件十秒级，Mod 分钟级 → 迭代轮次随之递减。

### 10.4 上下文注入（强制）

- 版本号 / `pack_format` / 加载器版本 / 映射版本 ← **运行时从官方源拉取**
- 生成时按目标注入对应 API 的类型定义：
  - Java 数据包 → **Sandstone** 类型
  - Bedrock → **@minecraft/server** 类型
  - Paper 插件 → Paper API（含 Folia 兼容标记）
  - 模组 → 对应加载器 + 映射类型
- **状态注入 `context_pack`（闭环强依赖）**：每轮生成前注入 `get_context_pack(target)` 的运行时状态——
  当前实例已有 mod / 服务端插件与配置 / 上次构建产物与哈希 / 历史失败原因 / 目标平台（是否 Folia）——
  并按 token 预算截断，避免长上下文爆炸

### 10.5 成本控制

- 每会话 **token 预算上限 + 轮次上限**
- 类型定义与 manifest 走**提示缓存**（prompt caching）
- 超预算自动降级到更便宜模型或转入人工确认

### 10.6 权限分级

| 级别                               | 操作               | 确认要求         |
| ---------------------------------- | ------------------ | ---------------- |
| 只读                               | 查询、搜索、读日志 | 免确认           |
| 写入实例目录                       | 装模组、改配置     | 可配置为免确认   |
| 执行进程 / 写实例目录外 / 修改账户 | 编译、部署、启动   | **必须弹窗确认** |
| 网络出站                           | HTTP 请求          | 白名单域         |

---

## 11. 生成阶梯（实现优先级依据）

| 序  | 产物                  | 反馈延迟 | 验证手段                      | 优先级 |
| --- | --------------------- | -------- | ----------------------------- | ------ |
| 1   | 数据包                | 秒级     | `/reload` + `/datapack list`  | P0     |
| 2   | Bedrock Script Add-on | 秒级     | 装载 + 游戏内事件验证         | P0     |
| 3   | **Paper 插件**        | 5~15 秒  | 启动服务器 + 控制台/RCON 驱动 | **P1** |
| 4   | **服务端 Mod**        | 30~90 秒 | Gradle 构建 + 无头服务端验证  | **P1** |
| 5   | 客户端 Mod            | 60 秒+   | 需图形环境才能看效果          | P2     |
| 6   | Mixin 重度 Mod        | 分钟级   | 字节码注入，报错难定位        | P2     |

**关键结论**：第 3、4 层是 Java 代码生成的甜点区——服务端无需渲染、
可用控制台程序化驱动、启动只要几秒。**优先做服务端，后做客户端模组**，
与直觉相反但回报最高。

---

## 12. 数据模型（概要）

```ts
Instance       { id, edition, name, versionId, loader?, javaPath?, dir, createdAt }
Account        { id, type, uuid, name, encryptedToken, skinModel?, capeRef? }
ContentRef     { kind, source, projectId, versionId, hash, files[] }
ModpackRef     { source, projectId, versionId, files[], overrides[] }
Server         { id, runtime, versionId, dir, port, props, plugins[], state }
ServerConfig   { serverId, files: Record<path, content>, lastApplied }
PluginProject  { id, name, target: 'paper'|'folia'|'spigot', apiVersion, foliaSupported, files[] }
ProxyPlugin    { id, name, target: 'velocity'|'bungeecord'|'waterfall', apiVersion, files[] }
SchemaVersion  { version, appliedAt, checksum }        // 迁移幂等判断
BuildArtifact  { id, projectId, jarPath, sha256, targetMatrix[] }
TaskRecord     { id, kind, state, progress, startedAt, finishedAt, error? }
Setting        { key, value, scope }        // global / per-edition / per-instance
Conversation   { id, instanceId?, edition?, messages[], tokenUsage }
```

**约束**：所有表带 `edition` 字段或显式区域归属；所有写入走**版本化迁移脚本**。

---

## 13. 安全模型

### 13.1 压缩包安全

- 所有解压**必须校验条目路径**，拒绝绝对路径与 `../` 逃逸（zip-slip）
- 限制解压后**总大小与文件数**，防压缩炸弹
- 拒绝符号链接条目

### 13.2 凭据

- OAuth refresh token 必须走 **OS 级加密**（Electron `safeStorage`）
- 禁止明文落 json；日志与遥测中**过滤一切 token**

### 13.3 供应链

- 所有下载物**校验哈希**（manifest 提供或服务端签名）
- jar / addon 导入前做基础结构校验
- 提前准备**代码签名与杀软误报申诉流程**

### 13.4 代码执行（最高风险）

- **架构上放弃进程内沙箱**（SecurityManager 已禁用）
- 一律进程/容器隔离，设资源上限
- 生成的代码在沙箱内**永不自动加载**进正式环境

### 13.5 智能体权限

见 10.6 分级表。

---

## 14. 可靠性设计

- **原子性**：下载 → 临时目录 → 校验 → 原子重命名；失败可回滚
- **半成品检测**：启动时扫描并清理未完成实例
- **长路径**：Windows 统一走 `\\?\` 扩展路径
- **Unicode**：中文/emoji 路径全链路测试
- **并发**：下载队列优先级 + 带宽上限；多实例/服务端同时运行的资源争抢处理
- **只读运行**：从 Program Files 启动时的降级策略
- **错误分类**：网络 / 校验 / 版本 / 磁盘 / 权限 / 未知
  —— 每类对应独立文案与重试策略

---

## 15. 工程化底座

- **构建**：esbuild（主进程 + preload）+ Vite（渲染层）
- **打包**：electron-builder，`asar: true` + **`asarUnpack`（better-sqlite3 等原生模块必须解包，并做 Electron ABI rebuild）**，`compression: maximum`，
  `files` 白名单只含编译产物，**禁止整包 node_modules**
- **测试**：Vitest（单元）+ Playwright（E2E）
  - 固定 manifest fixture、mock CDN、假实例目录
  - **更新器必须 mock**，日常 CI 不得触碰真实更新源
- **更新**：electron-updater + 分阶段灰度
- **发布**：GitHub Actions
  - 版本号以 `package.json` 为唯一事实源
  - 构建前检查 Release 是否存在
  - 六平台矩阵：`win-x64 / win-arm64 / mac-x64 / mac-arm64 / linux-x64 / linux-arm64`
    （Electron 已终止 32 位平台支持，故不列 `win-ia32`）
  - Linux 额外出 deb / rpm / AppImage
- **签名**：Windows EV 证书 / macOS Developer ID + 公证 / Linux GPG

### monorepo 结构（pnpm workspaces）

```
apps/desktop              主进程 + 渲染层
packages/shell            共享外壳能力（不含内核）
packages/contract         薄契约（只有类型）
packages/kernel-java      Java 内核
packages/kernel-bedrock   Bedrock 内核
packages/kernel-server    服务端内核
packages/devkit           开发内核（构建沙箱与工具链）
packages/engine           下载引擎
packages/agent            MCP 工具层 + 编排
packages/generator-datapack     数据包生成（Sandstone）
packages/generator-bedrock      基岩脚本生成
packages/generator-plugin       插件生成（Paper/Folia）
packages/generator-mod          模组生成（NeoForge/Fabric）
packages/ui               组件库
packages/i18n             文案
```

---

## 16. 外部数据源

**Java 侧**

- Mojang `version_manifest_v2.json`（版本清单，权威源）
- BMCLAPI（bangbang93 运营的公共镜像，加速下载）
- CurseForge API（模组/整合包）
- Modrinth API（模组/整合包/资源包/数据包）
- Mojang 皮肤 API（正版皮肤上传）
- authlib-injector / Yggdrasil 协议（第三方皮肤站）
- Adoptium API（Java 运行时下载）
- mclo.gs（日志分享）

**Bedrock 侧**

- `@minecraft/server` 官方类型定义与文档
- 官方深链协议（内容导入）
- BDS 官方下载
- MCPEDL 等社区平台（需确认可用性与授权）

**服务端 / 开发侧**

- PaperMC 文档与 API
- NeoForged / Fabric 文档与工具链
- Parchment 映射
- Maven 中央仓库与其镜像

---

## 17. 智能体驱动的跨域闭环（示例场景）

**场景 A：一句需求到可玩服务端**

```
用户："做个自动钓鱼的插件，跑在测试服上"
→ get_capabilities('server')          确认插件受支持
→ 注入 Paper API + Folia 标记
→ generate_content(plugin)            生成工程
→ build_project(projectRef)           devkit 编译
→ deploy_plugin(projectRef, serverId) 部署
→ restart_server(serverId)            重启（hot reload 优先）
→ read_logs(serverId)                 验证加载成功
→ 失败则回灌修复，循环
```

**场景 B：跨域改动**

```
用户："把新地图包加到测试服，顺便让客户端也更新整合包"
→ install_modpack(ref, {edition:'java', instanceId})
→ import_package(worldPath, {edition:'server', serverId})
→ restart_server(serverId)
→ read_logs(...)
```

---

## 18. 落地顺序（依赖驱动）

| 阶段 | 内容                                                           |
| ---- | -------------------------------------------------------------- |
| 0    | `packages/contract` 定稿 + 34 类内容模型类型 + 数据 Schema     |
| 1    | 共享外壳（下载引擎 / 任务队列 / 原子写 / 路径工具 / 安全模型） |
| 2    | Java 内核——客户端启动链路                                      |
| 3    | Java 内核——内容管理（模组/资源包/光影/数据包/皮肤/存档）       |
| 4    | Bedrock 内核——环境探测 + 导入网关 + 包生成                     |
| 5    | 服务端内核——运行时矩阵 + 配置 + 控制台/RCON + 启停与备份       |
| 6    | 开发内核 devkit——JDK/Gradle 管理 + 依赖缓存 + 隔离沙箱         |
| 7    | MCP 工具层 + 智能体进程（含预算与权限分级）                    |
| 8    | 生成阶梯逐层攻：数据包 → 基岩脚本 → 服务端插件 → 服务端 Mod    |
| 9    | 客户端 Mod 生成（含 Mixin 支持）                               |
| 10   | 工程化补齐 + 产品体验层                                        |

> 阶段 8 的顺序不是随意的：**先把反馈最快的做完，让闭环跑起来验证整套基础设施，
> 再往上爬难度。**

---

## 19. 风险登记册

| 风险                      | 影响 | 应对                                          |
| ------------------------- | ---- | --------------------------------------------- |
| EULA 商业化限制           | 高   | 上线前法律审查；收费点只落在自有功能          |
| Modrinth AI 政策          | 中高 | AI 生成定位为个人/辅助用途，导出时提示        |
| Bedrock 目录权限受限      | 高   | 架构上明确为导入网关，不依赖直接读写          |
| 生成代码被执行（RCE）     | 高   | 进程/容器级隔离；沙箱内永不自动加载进正式环境 |
| SecurityManager 已禁用    | 高   | 放弃进程内方案，一律进程隔离                  |
| 版本号体系变更（26.x）    | 中   | 全部动态拉取，禁止硬编码与模型记忆            |
| pack_format 双值分离      | 中   | 运行时按版本查表，不写死                      |
| Yarn → Mojang 映射迁移期  | 中高 | 映射按目标版本查表注入；语料按映射分类标注    |
| 版本×加载器×API 矩阵爆炸  | 高   | 只为高频组合预置上下文，长尾按需拉取          |
| Gradle 首次构建体验差     | 中   | 依赖缓存预热 + 明确进度提示 + 可离线工作      |
| 插件/模组市场已有 AI 竞品 | 中   | 差异化落在本地优先 + 跨域打通 + 与启动器合一  |
| 杀软误报                  | 中   | 代码签名 + 提前申诉                           |

---

## 20. 竞品情报

- **BukkitCode**（2026-08 发布）：浏览器对话生成完整插件工程，由装在服务端上的
  编译器插件编译成 JAR，支持加载/卸载/重载/一键部署（**不重启服务器**），
  覆盖 Spigot/Paper/Folia 与 1.12~1.21
- **EnderDevelopment**：数据包/模组/插件生成，宣称 5 秒内编译出 .jar，
  编译失败自动读日志重试

**差异化空位**：

1. **本地执行**（竞品为云端或需装服务端插件）
2. **跨域打通**（同一工具管服务端 + 客户端 + 数据包 + 基岩）
3. **与启动器合一**（开发完直接部署到自己的实例或服务端，无需手动搬 jar）

---

## 21. 待核实清单

实现前逐一核对官方文档：

1. Bedrock HD / Persona 皮肤分辨率与 `skins.json` 字段结构
2. 各 MC 版本 `pack_format` 对照表（资源包与数据包已分离）
3. Bedrock `manifest.json` 的 `format_version` / `min_engine_version` 当前取值
4. MC 26.x 年份体系下 Java 与 Bedrock 版本号对应关系
5. CurseForge / Modrinth API 最新鉴权与配额
6. Electron 当前稳定版与 macOS 公证最新要求
7. Sandstone 与 `@minecraft/server` 当前版本与 API 覆盖面
8. ~~GDK 版 Minecraft for Windows 的内容目录确切路径与权限模型~~ —— **2026-10 部分核实**：
   内容根已确认是 `%appdata%\Minecraft Bedrock\users\shared\games\com.mojang`
   （官方 GDK 迁移文档），旧 UWP 路径保留为回退。**仍未核实**：各版本对
   `WindowsApps` 安装目录的实际读权限（需在装有 GDK 版的真实机器上探测）
9. 26.x 时代模组是否仍混淆（影响映射策略）
10. Paper `paper-plugin.yml` 与 `plugin.yml` 的最新字段差异

---

## 22. 交付说明

本文档为**唯一事实来源**，可直接作为编程 AI 的上下文输入。

建议消费方式：

- **整份投喂**：适合让 AI 理解全局后自行规划
- **分域投喂**：客户端 + 服务端内核一份；devkit + 代码生成一份
  （后者的上下文需求与前者的差异极大，分开效果更好）

实现顺序请严格遵循第 18 节的阶段划分，
每个阶段完成后对照第 19 节风险登记册复查。

---

## 23. 参考项目对照表（每个功能的落地参照）

> **目的**：让实现者不必从零摸索——每个能力点都能找到可读源码或权威规范的参照物。
> **选取原则**：优先「开源 + 与本项目同栈（TS/Node）」或「有权威规范」的项目。
> ⚠️ **许可证须逐一复核**；GPL 类项目仅作「行为/格式参照」，不得直接拷贝代码进本项目。

### 23.1 客户端 / 启动器

| 功能                                                | 参考项目                                | 可借鉴点                            | 栈 / 授权               |
| --------------------------------------------------- | --------------------------------------- | ----------------------------------- | ----------------------- |
| 启动器内核（版本装配 / library / assets / natives） | XMCL（Voxelum/x-minecraft-launcher）    | 模块化内核、实例管理、诊断          | TS / MIT                |
| 安装·启动核心库                                     | minecraft-launcher-core-node、`@xmcl/*` | 下载、校验、启动参数拼装            | TS / MIT                |
| 轻量启动器内核                                      | Pierce01/MinecraftLauncher-core         | 最小可用启动流程                    | JS / MIT                |
| 实例目录格式（导入导出）                            | Prism Launcher、MultiMC                 | instance.cfg / manifest / pack 布局 | C++ / GPL（仅参照格式） |
| 微软登录 OAuth                                      | `@xmcl/user`、Prism 认证模块            | Device Code / PKCE                  | TS / MIT                |
| 皮肤渲染                                            | skinview3d、Ears                        | 3D 预览                             | TS / MIT                |

### 23.2 内容管理（Java）

| 功能                 | 参考项目                       | 可借鉴点                   |
| -------------------- | ------------------------------ | -------------------------- |
| Modpack（`.mrpack`） | Modrinth 官方 spec、packwiz    | index 格式、增量更新算法   |
| CurseForge 包        | CurseForge API、packwiz        | `manifest.json` 解析       |
| Mod 元数据 / 依赖    | fabric-loader、NeoForge、Quilt | toml/json 结构、依赖语义   |
| 资源包 / 光影        | Sodium、Iris                   | `pack.mcmeta`、PBR 约定    |
| 第三方认证           | authlib-injector（官方仓库）   | Yggdrasil 协议（默认关闭） |

### 23.3 数据包生成

| 功能        | 参考项目              | 可借鉴点                     |
| ----------- | --------------------- | ---------------------------- |
| TS → 数据包 | Sandstone（TS / MIT） | 生成器 DSL 设计              |
| 静态校验    | Spyglass（Rust）      | 数据包 lint 规则             |
| 官方格式    | Mojang 数据包文档     | function / loot_table 等结构 |

### 23.4 Bedrock

| 功能              | 参考项目                                           | 可借鉴点                       |
| ----------------- | -------------------------------------------------- | ------------------------------ |
| 脚本 API 类型     | `@minecraft/server` 官方包、Mojang/bedrock-samples | API 面、示例行为包             |
| 服务端 Mod 加载器 | **LeviLamina**（LiteLDev，原 LiteLoaderBDS）       | BDS 原生模组加载（C++/JS/Lua） |
| Python 插件运行时 | Endstone、LeviStone                                | 插件生命周期                   |
| Java↔基岩互通     | GeyserMC + Floodgate                               | 协议翻译（如做联动）           |

### 23.5 服务端

| 功能                   | 参考项目                                                      | 可借鉴点                 |
| ---------------------- | ------------------------------------------------------------- | ------------------------ |
| 插件服务端             | Paper / Purpur / Folia / Spigot                               | 运行时行为、配置项       |
| 代理层                 | Velocity / BungeeCord / Waterfall                             | 多子服路由               |
| 插件清单               | PaperMC 官方 docs（`paper-plugin.yml`）                       | 新旧格式字段差异         |
| 服务端面板（运维参照） | MCSManager（MIT / Node+TS）、Pterodactyl、PufferPanel、Crafty | 进程管理、控制台、多实例 |
| RCON                   | rcon-client（TS）                                             | 协议实现                 |
| 日志分析 / 崩溃归因    | mclo.gs、Prism 崩溃解析                                       | 归因规则库               |

### 23.6 开发内核 / 代码生成

| 功能                 | 参考项目                                | 可借鉴点               |
| -------------------- | --------------------------------------- | ---------------------- |
| 插件生成（同类竞品） | BukkitCode、EnderDevelopment            | 生成-编译-部署闭环设计 |
| 模组 MDK             | NeoForge MDK、Fabric example-mod        | 工程模板、gradle 配置  |
| 多加载器             | Architectury                            | 一次代码多加载器       |
| Mixin                | SpongePowered/Mixin、Fabric Mixin       | 字节码注入规范         |
| 映射迁移             | Fabric Loom（`migrateMappings`）、Ravel | Yarn → Mojang 迁移     |
| 参数名映射           | Parchment                               | 叠加可读参数名         |
| JDK 分发             | Adoptium API、foojay-disco              | 按版本 / 平台拉 JDK    |
| 构建编排             | Gradle daemon、ModDevGradle、NeoGradle  | 增量构建、离线缓存     |

### 23.7 智能体 / 平台

| 功能       | 参考项目                               | 可借鉴点           |
| ---------- | -------------------------------------- | ------------------ |
| MCP 工具层 | `@modelcontextprotocol/sdk`（官方 TS） | 协议实现、工具暴露 |
| 版本清单   | Mojang `version_manifest_v2`、BMCLAPI  | 权威源 + 加速镜像  |
| 内容源 API | Modrinth API、CurseForge API           | 检索 / 下载接口    |

> 仍需在实现前逐条核对官方文档的项（授权配额、Bedrock HD 皮肤规格、`pack_format` 对照表等）见 §21。

---

## 24. 变更记录（v3.0 → v3.1）

本版针对审查报告（`MC全链路AI工作台-设计文档-审查报告.md`）的结论做了如下修订：

**阻断级（实现前必改）**

1. 内容模型计数更正：`32 类` → `34 类`（原枚举实为 33 项，并新增 `ProxyPlugin`）
2. 新增 **§10.0 模型接入层**：补齐 LLM 后端、BYOK、密钥安全、推理网关（原文档完全缺失）
3. 补齐 **§10.2「读现状 / 卸载回滚 / 服务端启停」** 等工具并标注权限级别（原仅「写」类，闭环无法落地）
4. 构建矩阵 `win-ia32` → `win-arm64`（Electron 已终止 32 位平台支持）
5. `authlib-injector` 增加边界与默认关闭声明，化解与「正版第一路径」的合规张力

**重要级** 6. §0.3 措辞更正：不再笼统称「三域都秒级」，改为梯度表述 7. 新增 §10.3 **成功判据表**（机器可判定的验证信号）8. 新增 §10.4 **`context_pack` 状态注入** 9. 新增 `ProxyPlugin` 内容类型（§3 / §9 / §12）与代理插件链路 10. §15 补充 `asarUnpack` 与原生模块 ABI rebuild 11. §8.4 映射迁移锚点更正为 **26.1（1.21.11 之后）**；「去混淆」由假设升级为**已确认事实** 12. `Electron 43` 口径统一为「43+，CI 锁定」

**新增** 13. **§23 参考项目对照表**（每个功能的落地参照）14. §12 增补 `ProxyPlugin` / `SchemaVersion`（迁移幂等）

> **仍待后续处理**（本版未解决，详见审查报告 §§2–3）：§0.3 与 §11 的反馈延迟表可进一步去重；
> §12 数据模型缺 `World` / `Message` / 产物关联表；缺对象级去重；缺多实例资源仲裁；RCON 网络暴露与口令安全策略。

---

_文档版本 v3.1 · 修订于 2026-10-04（v3.0 首版同日）_
_本文档为工程设计规格，不构成法律意见。_
