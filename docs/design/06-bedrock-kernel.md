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
