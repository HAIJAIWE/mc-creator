# 一键开服部署包(本地 + 云服务器)— 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户要"真开服"(本地联机 + 云服务器 24h 在线)

## 现状
ServerGenerator 已有:server.properties/eula/start.bat/start.sh/ops/whitelist/modlist/README + systemd/Docker/备份部署脚本。
缺:**一键部署**——自动装 Java、按 serverType 下载服务端、放配置、systemd 自启。

## 方案

### Task 1: ServerSpec 扩展
- `serverType: 'vanilla' | 'paper' | 'fabric'`(默认 vanilla)
- `serverVersion: string`(默认 '1.21.1',用于下载匹配的服务端)

### Task 2: 一键部署脚本生成
- **install.sh**(云服务器 Linux 一键):
  1. 检测/安装 Java 21(apt)
  2. 按 serverType 下载服务端:
     - vanilla:piston-meta 版本清单解析 server.jar 直链
     - paper:PaperMC API 取最新 build 下载
     - fabric:下 fabric-installer + server.jar,静默生成服务端
  3. 复制配置文件
  4. 安装 systemd service 并 enable(开机自启,24h 在线)
- **install.bat**(Windows 本地一键):
  1. 检测 Java(无则提示安装)
  2. 下载服务端(按 serverType)
  3. 复制配置 + 提示运行 start.bat 开服(局域网联机)
- 下载 URL 按 serverType/serverVersion 拼装

### Task 3: 测试
- install.sh 断言:含对应 serverType 下载 URL、systemctl enable、Java 安装
- install.bat 断言:含下载命令、start.bat 提示
- serverType 不同 → 下载 URL 不同

### 验收
- typecheck/test/lint 全绿,独立 commit
