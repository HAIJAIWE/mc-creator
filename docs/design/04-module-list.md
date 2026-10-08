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
