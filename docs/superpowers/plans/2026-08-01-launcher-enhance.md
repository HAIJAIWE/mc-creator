# 启动器增强:加载器 + Mod 管理 + 离线皮肤 — 2026-08-01

- 日期:2026-08-01
- 状态:计划
- 触发:用户确认做国内离线生态标配(加载器一键装 / Mod 管理 / 离线皮肤)

## Task 1: 加载器一键安装(Fabric / NeoForge)
- launcher-service 加 `installLoader(version, loader)`:
  - Fabric:下载 fabric-installer.jar → `java -jar fabric-installer.jar client -mcversion <ver> -dir <launcherDir> -loader latest`(生成 versions/fabric-loader-<ver> 目录)
  - NeoForge:下载 neoforge installer → 运行 client 安装
- 下载进度回传;检测已装(versions 目录存在)跳过
- IPC:launcher:installLoader + 面板 UI(加载器选择 Fabric/NeoForge/无)

## Task 2: Mod 管理
- 启动器版本目录 `versions/<ver>/mods/`(Fabric 版)与 game/<ver>/mods/
- IPC:launcher:listMods(version)、launcher:installMod(version, modrinthVersionId)
- 复用 Modrinth API:搜索 → 取版本 jar URL → 下载到 mods 目录
- 面板 UI:Mod 列表(已装)+ 搜索添加(简版内嵌 Modrinth 搜索)

## Task 3: 离线皮肤(CustomSkinLoader)
- 下载 CustomSkinLoader mod(Fabric)到版本 mods 目录
- 生成 cs-customskinloader 配置(默认 LittleSkin API)到 config 目录
- 面板 UI:皮肤站选择(LittleSkin/官方/自定义 URL)+ 启用开关

## 测试
- installLoader:Fabric installer 命令组装、已装检测(mock 下载)
- Mod 下载:URL 组装、mods 目录写入
- 面板:加载器选择、Mod 列表、皮肤配置

## 验收
- typecheck/test/lint 全绿,独立提交
