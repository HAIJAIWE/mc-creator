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
