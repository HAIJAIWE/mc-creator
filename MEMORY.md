# MEMORY.md — MC 全链路 AI 工作台改造进度

> 唯一事实来源：`D:\Downloads\MC全链路AI工作台-设计文档-v3.1.md`（下称「文档」）
> 最后更新：2026-10-05

---

## 一、环境事实（重要，每次开工先确认）

| 环境 | Node.js | pnpm | bun | 说明 |
|---|---|---|---|---|
| **用户本机** | ✅ v24.21.0（`C:\Users\Administrator\AppData\Local\Programs\nodejs\node.exe`） | ✅ 9.15.0 | 1.4.2 | 唯一能跑 vitest 的地方 |
| **子代理沙箱** | ⚠️ 有时能找到（需手动加 PATH），有时没有 | 不可用（`pnpm.cmd` 内部调 node） | ✅ | bun 可驱动 tsc |

**踩过的坑**：
- 用户 PowerShell 里 `cd D:\MC mod` 会报错（路径含空格需引号 `cd "D:\MC mod"`，但已在该目录时可直接跑命令）。
- **bun 跑 vitest 会让 zod 变成 undefined**（CJS 外部化）→ 83 个文件 collect 失败。**不要信 bun 跑 vitest 的结果**，bun 只用于 `tsc` 类型检查。
- bun 驱动 tsc 的正确写法：`bun node_modules/typescript/bin/tsc --noEmit -p <pkg>/tsconfig.json`
- Node 未在 PATH 时可用绝对路径：`C:\Users\Administrator\AppData\Local\Programs\nodejs\node.exe`
- 测试文件里 `*.tmp.ts` 会污染 `git status`，验证完必须删。
- 包内 `node_modules/@mc-creator/*` junction 是 gitignored 的临时产物，pnpm install 会重建，不要提交也不要手动删。

---

## 二、架构决策（勿推翻）

### 2.1 破坏性重构（用户明确选择）
按文档 §15 monorepo 结构重建，保留旧包但生成器实现真迁走，core 留 shim 保持 import 路径不断。

### 2.2 薄契约（§3）是唯一强制统一的类型
`packages/contract`：34 类 `ContentKind`（v3.1 更正值，非 32）、`KernelContract`、`TaskSpec/TaskHandle/TaskResult`、`TaskResult.data`（后加，用于只读查询数据透传）、四内核能力表、R/W/X 权限表、5 类验证判据。
**MCP 工具数是 25 不是 22** —— 文档 §24 修订 #3 补齐读现状/回滚/启停类后的数量，以 contract 为准。

### 2.3 确认闸门（W/X 任务）
`KernelContext { dataDir, confirm?, mode: 'sandbox'|'live', sandboxDir?, networkAllowlist? }`
- W/X 任务必须 `confirm()` 返回 true 才执行副作用，否则返回 `permission` + `data.confirmRequired:true`（§10.6 必须弹窗确认）
- `mode:'sandbox'` 时所有写操作落 `sandboxDir`，用 devkit `assertWithinRoot` 防护（§13.4 沙箱内代码永不自动加载进正式环境）
- MCP 通道即使内核支持也一律拒绝 W/X（该通道不做配置判断，统一拒绝）

### 2.4 不做什么（内核明确不托管的部分）
- `launch_instance` 只拼 `cmd`/`args` 返回，**不 spawn**（实际启动归 desktop 层 launcher-service）
- `restart_server`/`stop_server` 只校验服务端存在性 + 返回控制指令（§7.1 进程保活归外壳）
- `hotReload` 只返回 `reloadCommand:'/reload confirm'`（RCON 注入归外壳）
- `bedrock.generate_content` 不调 LLM，缺 spec 时返回 `SPEC_REQUIRED` + `specShape` 示例（§10.0 模型接入层在外壳）

---

## 三、已完成（16 个新包，全部 tsc 绿）

测试数为 2026-10-05 本机实跑值。

| 包 | 内容 | 测试 |
|---|---|---|
| `contract` | §3 薄契约 + §9 34 类 + §12 数据模型 + 能力表/权限表/判据 | 6 |
| `shell` | 原子写（sha256 可选）、zip-slip/炸弹防护、路径越界（跨盘符）、错误中文文案 | 20 |
| `engine` | 下载（超时/重试/Range 续传/sha256+sha512 校验/原子落盘）+ `FileTaskQueue`（JSONL 持久化/recover/优先级/cancel） | 19 |
| `kernel-java` | 内容管理 5 生成器 + R dispatch + **9 个 W/X 真实现** + `get_context_pack` | 177 |
| `kernel-server` | R dispatch + **7 个 W/X 真实现**（EULA 拦截/部署哈希账本/回滚备份）+ `get_context_pack` | 80 |
| `kernel-bedrock` | 目录探测 + **generate_content / validate_content 真实现**（manifest/uuid/目录层级） | 49 |
| `devkit` | JDK 版本映射、Gradle（超时杀树/磁盘扫 jar/分发验签）、沙箱选项、产物 sha256 | 20 |
| `agent` | MCP **stdio + Streamable HTTP** 双传输 + 编排 + 生成 + **§10.4 状态注入接线** | 159 |
| `generator-datapack` | datapack/kubejs/crafttweaker/enchantment 实现（真迁 + core shim） | 133 |
| `generator-bedrock` | behavior-pack/item/entity（真迁 + shim，png-encoder 本地化） | 41 |
| `generator-mod` | mod 集群 34 文件 + 13 测试（真迁 + shim，BuildCache 本地化） | 281 |
| `generator-plugin` | Paper/Folia 双清单 + validatePluginStructure | 19 |
| `i18n` | 29 key 中英双语 + `t()` 回退 + `opConfirm` | 13 |
| `ui` | **组件库真实现**：9 组件 + theme token + useTheme（theme/组件大部已落地） | 335 |

**旧包改动**：
- `core`：生成器实现全部迁走留 shim；`types.ts` 改重导出 shared 的 `Generator`；curseforge 客户端补超时重试
- `shared`：`schemas/generator.ts` 新增 `Generator` 接口
- `desktop`：接 `@mc-creator/shell`（4 处原子写 + IMPORT_PROJECT zip 门）；`@mc-creator/ui` 已加依赖但未实际替换组件；`electron-builder.yml` 打包路径改指 `generator-mod/src`

---

## 四、集成验证结果

跨包联调 30/30 全过（bun 实际执行），覆盖：确认闸门拒绝无副作用、confirm 后真实落盘 + sha256、重名/穿越/EULA 拦截、sandbox 隔离、launch 只拼命令、部署哈希账本与回滚、bedrock manifest 校验、MCP 通道仍拒绝 W/X。

---

## 五、待办

### 5.1 用户本机必须跑（子代理沙箱跑不了 pnpm）
```powershell
pnpm install                        # ⚠️ packages/ui 新增了 react/@testing-library 依赖，不能用 --frozen-lockfile
pnpm -r test
pnpm -r typecheck
```

### 5.2 全量测试结果（2026-10-05 用户本机实跑）
`pnpm -r test` **已全绿**：各包全过 + desktop `1661/1661`。
过程中修掉两个问题：
1. `nodeGraphPersistence.test.ts:219` 硬编码 `toBe(1)` 与 `SERIALIZER_VERSION = 2` 冲突 → **已改为 `toBe(SERIALIZER_VERSION)`**（用户默许；理由：同仓 `nodeGraphSerializer.test.ts:342` 早已是这个写法，是漏改的旧断言；改回 1 会静默删掉 pluginIds + v1→v2 迁移功能）
2. `packages/engine/src/engine.test.ts` 的 `PAYLOAD_SHA512` 定义未使用（TS6133，`noUnusedLocals`）→ **补了一条 sha512 正确路径的测试**把它用上（不是加 `void` 掩盖）

### 5.2c 本轮（2026-10-05 续做 §5.4）实测
| 包 | 测试数 | 备注 |
|---|---|---|
| `agent` | 63 → **159** | + MCP HTTP 75 条 + 状态注入接线 21 条 |
| `kernel-java` | 149 → **177** | + url 下载矩阵 19 条 + context_pack 9 条 |
| `kernel-server` | 62 → **80** | + build_project 成功路径 8 条 + context_pack 10 条 |
| `engine` | 19 | 错误分类改动后回归全绿 |
| `ui` | 1 → **414**（施工中） | 子代理仍在补 Tabs/Toast/Tooltip 测试 |

### 5.2b 遗留（低优先，不阻塞）
- desktop 尚未实际用 `@mc-creator/ui` 替换组件（§5.4）

### 5.3 危险提醒
`apps/desktop/src/renderer/src/shell/`（10 个文件）曾是 **untracked**，里面的 `registerPreviewPanels()` 修复是 MiddlePanel EmptyState 测试转绿的关键。**已于 2026-10-05 `git add` 进暂存区**。若日后 `git stash`/重置后这些文件又变 untracked，必须重新 `git add`，否则 MiddlePanel 重新变红。

### 5.4 待补实现（本轮已清空四项，余项见下）
| 项 | 状态 |
|---|---|
| `packages/ui` 组件真实现 | ✅ 已落地（theme token + useTheme + 9 组件 + 测试） |
| kernel url 下载成功分支测试 | ✅ 补齐（本地 http server + 白名单矩阵），**并顺手修了 2 个真 bug**（见 §5.5） |
| `build_project` 真实 Gradle 成功分支测试 | ✅ 补齐（假 gradlew 夹具，零 JDK 依赖） |
| MCP Streamable HTTP 传输（§10.1） | ✅ `packages/agent/src/mcp-http.ts`（batch / 会话 / Origin 校验 / SSE） |
| `get_context_pack` 状态注入接入内核（§10.4） | ✅ kernel-java + kernel-server 落地，MCP 通道接通 |

**剩余**：
- desktop 尚未实际用 `@mc-creator/ui` 替换组件（ConfirmDialog/ToastProvider/TabBar 等已可替换）
- MCP HTTP 层缺 `Accept` 头校验（规范要求 406，当前宽松放行）与主动推送源（`notify()` API 未设计）
- MCP HTTP 会话是单进程内存态，跨重启不持久（规范允许）
- `build_project` 显式 `jarName` 会绕过 devkit 的 `-sources/-javadoc` 排除（行为合理，但值得记一笔）

### 5.5 本轮修掉的两个真 bug（子代理暴露，非改测试凑绿）
1. **url 带 query string 时 install_mod 必然失败**（`kernel-java`）：`baseName()` 只按 `/\` 切分不剥 query，签名直链（`?token=` / `?X-Amz-Signature=`）会把 `mod.jar?token=x` 当文件名，Windows 下 `?` 非法 → ENOENT 且被误归类成 network 错误白重试 3 次。**修法**：新增 `fileNameFromUrl()` 取 `new URL(url).pathname` + `decodeURIComponent`，空/非法回退。
2. **白名单后缀匹配误放行 IP**（`kernel-java`）：`host.endsWith('.'+domain)` 对 IP 字面量也生效，`'127.0.0.1'.endsWith('.0.0.1')` 为真 → 白名单写 `0.0.1`/`0.1`/`1` 会放行本机。**修法**：`isIP(host) !== 0` 时只走全等。

附带（engine 侧，同源）：`download.ts` 的 `toClassifiedError` 把本地 `ENOENT`/`ENAMETOOLONG`/`EINVAL`/`EISDIR` 归成 `network+retryable`，导致「文件名非法」伪装成「网络错误」并白白重试满额。已改归 `validation` + `retryable:false`。

---

## 六、不要再犯的错

1. **不要改测试断言/skip 删测试**来"修"失败。改实现让测试过。断言与设计意图真冲突时，报告给用户裁决。
2. **不要用 bun 的 vitest 结果下结论**（zod 变 undefined）。
3. **不要手工改 `pnpm-lock.yaml`**（已被子代理改过一次 importers，需 `pnpm install` 让 pnpm 自己 reconcile）。
4. **不要在验证脚本里留下 `*.tmp.ts`**。
5. **bun 不解析 package `exports` 映射后的 `.js→.ts` 回退**，所以 bun 里 import 深路径会失败——这是 bun 限制，不是代码问题（tsc/vitest 正常）。需要时用仓库外 preload resolve shim。
6. 子代理 prompt 里必须写明「沙箱可能没 Node，先探测 `where node`」，否则会拿静态分析冒充实跑结果。
7. **并行派子代理时按「文件」而非按「话题」切分**，且各自 prompt 里写死不许碰的文件。两个代理若可能碰同一目录，后启动的那个会在施工中被前者改动打断（表现为「tsc 突然报一堆不相关的错」，实为对方文件处于半写状态）。
8. **子代理还在写文件时不要插手它的包**（包括「顺手修个 bug」），跑一次测试看到成片失败多半是它施工到一半，不是回归。
9. `pnpm install` 加了新依赖后**不能再用 `--frozen-lockfile`**，会让 lockfile 与 package.json 不一致直接失败。
10. `exactOptionalPropertyTypes: true` 下测试里写 `value={someStringOrUndefined}` 会编译失败；要么用 `...(x !== undefined ? { value: x } : {})`，要么让组件 prop 显式接受 `| undefined`。

---

## 七、关键参考

- 设计文档：`D:\Downloads\MC全链路AI工作台-设计文档-v3.1.md`
- 本机验收清单：`LOCAL_VERIFICATION.md`
- 内核 TODO 规格：`LOCAL_VERIFICATION.md` 第二节（已被 §2.3 确认闸门方案取代大部分）
- 参考项目对照表：文档 §23（BukkitCode/EnderDevelopment 是竞品，差异化在本地执行+跨域打通+与启动器合一）