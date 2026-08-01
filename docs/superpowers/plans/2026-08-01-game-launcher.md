# 游戏启动器(下载客户端 + 启动)— 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户要做"可以下载游戏客户端"的启动器功能

## 目标
从 MC Creator 内:选择 MC 版本 → 下载客户端 jar + 资源 → 离线启动游戏(迷你版 PCL2/HMCL)。

## 架构

### 主进程 `launcher-service.ts`(新建)
核心方法(全部用 Node 原生,无第三方依赖):
1. `fetchVersions()`:拉 Mojang version_manifest_v2.json,返回 release 列表
2. `downloadClient(version)`:解析版本 json → 下载 client.jar 到 `userData/mc-launcher/versions/<ver>/`
3. `downloadAssets(version)`:解析 assets index → 下载 asset 文件到 `assets/objects/<hash前2位>/<hash>`
4. `downloadLibraries(version)`:解析 libraries 列表 → 下载到 `libraries/`
5. `launchGame(version, username, memory)`:组装 Java 命令并 spawn(离线模式)

### 存储目录
`app.getPath('userData')/mc-launcher/`
- versions/<ver>/<ver>.json + <ver>.jar
- assets/indexes/<ver>.json + objects/
- libraries/<group>/<artifact>/<ver>/<artifact>-<ver>.jar
- natives/ (临时解压目录,可跳过 natives 用 1.21+ 的新库方案——1.21 无 natives jar,直接 libraries)

### IPC(`launcher:` 通道)
- `launcher:listVersions` → [{id, type, releaseTime}]
- `launcher:download` (version) → 事件流进度 {type: 'jar'|'assets'|'libraries'|'done', done, total}
- `launcher:launch` (version, username, memory) → {pid}
- `launcher:stop` (pid)

### UI `GameLauncherPanel`
- 版本列表(下拉 + 刷新)
- 下载按钮 + 进度条(分 jar/assets/libraries 三阶段)
- 启动配置(离线用户名、内存)
- 启动/停止按钮 + 运行状态
- 接入 App.tsx activity(加 'game' 类型)

### 1.21.x 启动命令
```
java -Xmx2G -cp "<libraries...>;<client.jar>" net.minecraft.client.main.Main
  --username <name> --version <ver> --gameDir <dir> --assetsDir <assets> --assetIndex <ver> --uuid <rand> --accessToken 0
```

## 测试
- launcher-service 单测:版本 json 解析(libraries/assets/client 提取)— mock 网络
- IPC schema 测试
- UI 面板测试(mock ipcClient)

## 验收
- typecheck/test/lint 全绿,独立提交
- 下载 + 启动链路代码完整(mock 测试覆盖)
