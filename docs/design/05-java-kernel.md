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
