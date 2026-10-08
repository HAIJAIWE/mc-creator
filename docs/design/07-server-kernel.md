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
