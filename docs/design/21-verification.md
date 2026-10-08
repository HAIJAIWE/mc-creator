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
