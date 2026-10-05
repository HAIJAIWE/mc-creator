# 本机验收清单（pnpm install + 全量测试）

## 前置检查

- [ ] Node.js ≥ 18（建议用 `nvm use 20` 或同版本）
- [ ] pnpm ≥ 9（`corepack enable && corepack prepare pnpm@9.15.0 --activate`）
- [ ] JDK 21+（Mod 构建需要，其他生成器不需要）

## 1. 安装依赖

```powershell
# 设置 Electron 镜像（国内网络加速）
$env:ELECTRON_MIRROR = "https://npmmirror.com/mirrors/electron/"
pnpm install
```

> 预期：所有 15 个包（contract/shell/engine/kernel-_/devkit/agent/generator-_/i18n/ui + core/shared/desktop）被 pnpm workspace 链接，`node_modules/@mc-creator/*` 出现对应 symlink/junction。

## 2. 类型检查（可选，CI 会跑）

```powershell
pnpm typecheck          # 全包 tsc --noEmit
# 或分包
pnpm --filter @mc-creator/contract typecheck
pnpm --filter @mc-creator/shell typecheck
...
pnpm --filter @mc-creator/desktop typecheck
```

## 3. 运行测试（核心验收）

```powershell
# 全量跑（约 2000+ 旧 + 300+ 新）
pnpm -r test

# 或分包跑，优先核心链路：
pnpm --filter @mc-creator/contract test
pnpm --filter @mc-creator/shell test
pnpm --filter @mc-creator/engine test
pnpm --filter @mc-creator/kernel-java test
pnpm --filter @mc-creator/kernel-server test
pnpm --filter @mc-creator/kernel-bedrock test
pnpm --filter @mc-creator/devkit test
pnpm --filter @mc-creator/agent test
pnpm --filter @mc-creator/generator-datapack test
pnpm --filter @mc-creator/generator-bedrock test
pnpm --filter @mc-creator/generator-mod test
pnpm --filter @mc-creator/generator-plugin test
pnpm --filter @mc-creator/i18n test
pnpm --filter @mc-creator/ui test
pnpm --filter @mc-creator/core test
pnpm --filter @mc-creator/shared test
pnpm --filter @mc-creator/desktop test
```

## 4. 常见失败点自查

| 现象                                                | 原因                          | 处理                                                                       |
| --------------------------------------------------- | ----------------------------- | -------------------------------------------------------------------------- |
| `Cannot find module 'vitest'`                       | pnpm 未完成 link              | 删除 `node_modules` 与 `pnpm-lock.yaml` 重跑 `pnpm install`                |
| `electron` 下载卡住/失败                            | 网络                          | `ELECTRON_MIRROR` 已在步骤 1 设置；仍失败可手动下载放 `~/.cache/electron/` |
| `isolated-vm` / `node-pty` 编译报错                 | 可选依赖，无 native toolchain | 忽略（`optionalDependencies`），不影响主功能                               |
| desktop `typecheck:web` 报 `@xyflow/react` 类型缺失 | vitest 环境 jsdom 版本        | 已在 `vitest.config.ts` 配置 `environment: 'jsdom'`                        |
| `generator-mod` 集成测试 skip                       | 无 Gradle/JDK                 | 只要 `unit` 测试过即可；集成测试需 `CI=true` 环境变量                      |

## 5. 验收标准

- ✅ 所有包 `tsc --noEmit` 退出码 0
- ✅ `pnpm -r test` 全绿（或仅 `vitest` 相关报错均为环境限制、非代码逻辑）
- ✅ `pnpm --filter @mc-creator/desktop build` 生成 `out/` 产物

---

## 内核 TODO 填实规格（后续可并行）

### kernel-java (`packages/kernel-java/src/kernel.ts`)

| kind                                                                 | 需填实的副作用                                                                                                                                                   | 关键点                                                                                           |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `launch_instance`                                                    | 拼装 JVM 参数（`-Xms/Xmx`、`-Djava.library.path=natives`、`-cp classpath`、`mainClass`）、spawn `java` 进程、捕获 stdout/stderr、返回 PID                        | 版本/loader 映射 MCP_VERSIONS/LOADER_VERSIONS；assets/natives 目录来自 launcher-service 下载缓存 |
| `install_modpack`                                                    | 解析 `modrinth.index.json` 或 `manifest.json`、并发下载 `files[].downloadUrl`（用 engine/downloadFile）、校验 sha1/sha512、overrides 覆盖、server-overrides 分发 | 并发数 4、断点续传、失败重试 3 次                                                                |
| `import_package`                                                     | `assertSafeEntries` + `checkZipLimits`（shell）、解压到实例 `overrides/`                                                                                         | 复用 shell zip-safety、大文件流式写入                                                            |
| `install_mod` / `install_addon` / `apply_skin` / `uninstall_content` | 目标目录存在性 + 原子写（shell/writeFileAtomic）+ sha256 校验                                                                                                    | 同步操作，进度 2-3 步                                                                            |

### kernel-server (`packages/kernel-server/src/kernel.ts`)

| kind                             | 需填实的副作用                                                                                                                              | 关键点                     |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `build_project`                  | 调用 `devkit/runGradleBuild(projectDir, { javaHome: resolveJavaHome(mcVersion) })`、扫描 `build/libs/*.jar`、计算 sha256 登记 `ArtifactRef` | 超时 5 min、取消杀进程树   |
| `deploy_plugin`                  | 复制 jar 到 `<dataDir>/<serverId>/plugins/`、可选发送 `/reload confirm` 或重启                                                              | 热重载优先                 |
| `restart_server` / `stop_server` | 管理子进程：`SIGTERM` → 等待端口释放 → 再 spawn                                                                                             | 优雅停机 30s 内            |
| `create_instance`                | 生成 `server.properties`/`eula.txt`/启动脚本、目录结构                                                                                      | 复用 generator-server 逻辑 |

### kernel-bedrock (`packages/kernel-bedrock/src/kernel.ts`)

| kind               | 需填实的副作用                                                                                                                        | 关键点                |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------- |
| `generate_content` | 调用 `generator-bedrock` 实现（BehaviorPackGenerator/BehaviorItemGenerator/BehaviorEntityGenerator）产出 `FileNode[]`、算 sha256 登记 | 仅 Windows 生效       |
| `validate_content` | 解析 `manifest.json`、校验 uuid 唯一、`min_engine_version` 兼容、schema 结构                                                          | 返回 `{ok, errors[]}` |

> 以上规格已在各 kernel 源码中以 `// TODO: 真实实现需运行时环境` 注释标记，直接搜索即可定位。

---

## 6. E2E（Playwright + 真实 Electron 进程）

设计文档 §15 要求「Vitest（单元）+ Playwright（E2E）」。单元测试那 1931 条
**没有一条真的启动过 Electron** —— 它们 mock 掉 `electron` 模块、mock 掉
`window.mcApi`。E2E 补的就是这一段：真实主进程 + 真实 preload + 真实 IPC。

### 6.1 首次准备

```powershell
# ① 装依赖（含 @playwright/test）
pnpm install

# ② 构建产物 —— E2E 打的是 out/ 里的编译产物，不是 vite dev server
pnpm --filter @mc-creator/desktop build
```

`@playwright/test` 装上后**不需要** `npx playwright install chromium`：
这套用例只用 `electron.launch()` 拉起应用自带的 Electron 二进制，用不到
Playwright 自带的浏览器。真要跑 `--ui` 模式或将来加 chromium project 时再补：

```powershell
pnpm --filter @mc-creator/desktop test:e2e:install
```

### 6.2 跑

```powershell
pnpm --filter @mc-creator/desktop test:e2e       # 全部用例
pnpm --filter @mc-creator/desktop test:e2e:ui    # UI 模式（需先装浏览器）
```

单跑一条：`pnpm --filter @mc-creator/desktop test:e2e -g "主题"`

### 6.3 覆盖了什么

| 分组          | 用例                                               | 断言的事                                                                            |
| ------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| 启动地基      | 首个窗口 / preload 桥 / 首屏元素                   | 应用能起、`contextBridge` 真把 API 送到了渲染层、加载的是 `out/renderer/index.html` |
| 真实 IPC 往返 | UI 新建项目 / `process:list`                       | 渲染层 → preload → IPC → 主进程 → 磁盘整条链通；项目落在假实例目录                  |
| 交互          | ActivityBar 切面板                                 | 活动栏 `aria-pressed` 与中部主视图同步                                              |
| 主题换肤      | 切主题 / 切颜色模式                                | `--mc-accent` CSS 变量真被改写、computed 颜色跟着变、选择落 localStorage            |
| §15 硬约束    | 零出站 / 零更新器 / 零真实 userData / **闸门自检** | 见下                                                                                |

### 6.4 §15 三条硬约束怎么落地的

1. **假实例目录**：`e2e/fixtures/main-guard.cjs` 在应用代码之前把
   `userData` / `sessionData` / `temp` / `logs` / `crashDumps` 全部重定向到
   `os.tmpdir()` 下的一次性目录，用完即删。主进程所有磁盘读写都走
   `app.getPath('userData')`，所以这一刀就够。**并且有断言兜底**：守卫在重定向
   之前给真实 userData 拍一张文件清单快照，收尾时再拍一张比对 —— 不是「我们改了
   路径所以应该没事」，而是「真实目录一个字节都没变」。
2. **更新器必须 mock**：仓库当前**没有**任何自动更新实现（既无 `electron-updater`
   依赖，也无 `autoUpdater` 调用）。守卫做两件事：记录 `electron-updater` 是否可
   解析；把 Electron 内置 `autoUpdater.checkForUpdates/downloadUpdate/quitAndInstall`
   换成抛错桩。这条断言是给「将来有人接上自动更新」埋的雷 —— 接上的那天 E2E 会
   先变红，逼着接的人先决定 E2E 里怎么 mock，而不是让 CI 去拉真实更新包。
3. **mock CDN / 外部 API**：主进程侧 patch `fetch` / `net.request` / `http(s).request|get`，
   渲染层侧 patch `fetch` / `XMLHttpRequest` / `WebSocket`，命中一律**记账 + 立刻中止**
   （所以请求根本不会离开本机）。索引页 CSP 的 `connect-src` 是放行外网的
   （`'self' ws: http: https:`），也就是说拦住这些请求的只有 E2E 守卫本身。
   最后一条「闸门自检」用例会**主动打一次** `api.modrinth.com` / `api.curseforge.com` /
   `launchermeta.mojang.com`，证明闸门真的会响 —— 否则「零出站」这条断言可能只是
   空转通过。

### 6.5 CI 上跑在哪、为什么

独立 job `e2e`，矩阵 `ubuntu-latest` + `windows-latest`，不混进现有 `test` job
（Playwright 要装浏览器/系统依赖，vitest 不需要，需求不同）。
Linux 侧用 `xvfb-run`：GitHub 的 ubuntu runner 没有 X display，而 Electron 的
`BrowserWindow` 不支持真正的 headless 模式。
**不跑 macOS**：仓库既有的 `build` 矩阵本来就没有 macOS，加上 GUI 会话在 macOS
runner 上最容易出现只在 CI 复现的偶发失败 —— 一个时好时坏的信号比没有信号更糟。

首次跑需要留意：Electron 在 CI 上的冷启动抖动明显，配置里给了 `retries: 2`
（仅 CI）+ `trace: 'retain-on-failure'`（本地 `retries: 0` 也留 trace，
因为本地最缺的就是「第一次跑就红了」的现场）。

### 6.6 排查

```powershell
# 看 HTML 报告（trace / screenshot / DOM 快照）
pnpm --filter @mc-creator/desktop exec playwright show-report playwright-report

# 看某条用例的 trace
pnpm --filter @mc-creator/desktop exec playwright show-trace "<test-results 里的 trace.zip>"
```

常见问题：

| 现象                                                   | 原因                                                          | 处理                                                                               |
| ------------------------------------------------------ | ------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `[e2e] 缺少编译产物`                                   | 没 build                                                      | `pnpm --filter @mc-creator/desktop build`                                          |
| `firstWindow: Timeout 30000ms exceeded`                | 主进程崩了（看 stderr 里的 `App threw an error during load`） | 多半是主进程产物里有解析不了的 `require`，先单独 `electron out/main/index.js` 复现 |
| Linux CI 上窗口起不来                                  | 缺 X display / 系统库                                         | 确认 job 里有 `xvfb-run` 与 `npx playwright install-deps`                          |
| `App threw an error during load: ERR_MODULE_NOT_FOUND` | 有「TS 源码包」被 externalize 成运行时 require                | 把它加进 `electron.vite.config.ts` 的 `workspacePkgs` + alias，让 rollup 内联      |
