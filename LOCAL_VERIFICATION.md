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

> 预期：所有 15 个包（contract/shell/engine/kernel-*/devkit/agent/generator-*/i18n/ui + core/shared/desktop）被 pnpm workspace 链接，`node_modules/@mc-creator/*` 出现对应 symlink/junction。

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

| 现象 | 原因 | 处理 |
|---|---|---|
| `Cannot find module 'vitest'` | pnpm 未完成 link | 删除 `node_modules` 与 `pnpm-lock.yaml` 重跑 `pnpm install` |
| `electron` 下载卡住/失败 | 网络 | `ELECTRON_MIRROR` 已在步骤 1 设置；仍失败可手动下载放 `~/.cache/electron/` |
| `isolated-vm` / `node-pty` 编译报错 | 可选依赖，无 native toolchain | 忽略（`optionalDependencies`），不影响主功能 |
| desktop `typecheck:web` 报 `@xyflow/react` 类型缺失 | vitest 环境 jsdom 版本 | 已在 `vitest.config.ts` 配置 `environment: 'jsdom'` |
| `generator-mod` 集成测试 skip | 无 Gradle/JDK | 只要 `unit` 测试过即可；集成测试需 `CI=true` 环境变量 |

## 5. 验收标准
- ✅ 所有包 `tsc --noEmit` 退出码 0
- ✅ `pnpm -r test` 全绿（或仅 `vitest` 相关报错均为环境限制、非代码逻辑）
- ✅ `pnpm --filter @mc-creator/desktop build` 生成 `out/` 产物

---

## 内核 TODO 填实规格（后续可并行）

### kernel-java (`packages/kernel-java/src/kernel.ts`)
| kind | 需填实的副作用 | 关键点 |
|---|---|---|
| `launch_instance` | 拼装 JVM 参数（`-Xms/Xmx`、`-Djava.library.path=natives`、`-cp classpath`、`mainClass`）、spawn `java` 进程、捕获 stdout/stderr、返回 PID | 版本/loader 映射 MCP_VERSIONS/LOADER_VERSIONS；assets/natives 目录来自 launcher-service 下载缓存 |
| `install_modpack` | 解析 `modrinth.index.json` 或 `manifest.json`、并发下载 `files[].downloadUrl`（用 engine/downloadFile）、校验 sha1/sha512、overrides 覆盖、server-overrides 分发 | 并发数 4、断点续传、失败重试 3 次 |
| `import_package` | `assertSafeEntries` + `checkZipLimits`（shell）、解压到实例 `overrides/` | 复用 shell zip-safety、大文件流式写入 |
| `install_mod` / `install_addon` / `apply_skin` / `uninstall_content` | 目标目录存在性 + 原子写（shell/writeFileAtomic）+ sha256 校验 | 同步操作，进度 2-3 步 |

### kernel-server (`packages/kernel-server/src/kernel.ts`)
| kind | 需填实的副作用 | 关键点 |
|---|---|---|
| `build_project` | 调用 `devkit/runGradleBuild(projectDir, { javaHome: resolveJavaHome(mcVersion) })`、扫描 `build/libs/*.jar`、计算 sha256 登记 `ArtifactRef` | 超时 5 min、取消杀进程树 |
| `deploy_plugin` | 复制 jar 到 `<dataDir>/<serverId>/plugins/`、可选发送 `/reload confirm` 或重启 | 热重载优先 |
| `restart_server` / `stop_server` | 管理子进程：`SIGTERM` → 等待端口释放 → 再 spawn | 优雅停机 30s 内 |
| `create_instance` | 生成 `server.properties`/`eula.txt`/启动脚本、目录结构 | 复用 generator-server 逻辑 |

### kernel-bedrock (`packages/kernel-bedrock/src/kernel.ts`)
| kind | 需填实的副作用 | 关键点 |
|---|---|---|
| `generate_content` | 调用 `generator-bedrock` 实现（BehaviorPackGenerator/BehaviorItemGenerator/BehaviorEntityGenerator）产出 `FileNode[]`、算 sha256 登记 | 仅 Windows 生效 |
| `validate_content` | 解析 `manifest.json`、校验 uuid 唯一、`min_engine_version` 兼容、schema 结构 | 返回 `{ok, errors[]}` |

> 以上规格已在各 kernel 源码中以 `// TODO: 真实实现需运行时环境` 注释标记，直接搜索即可定位。