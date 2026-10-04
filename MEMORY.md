# MEMORY.md — MC 全链路 AI 工作台改造进度

> 唯一事实来源：`D:\Downloads\MC全链路AI工作台-设计文档-v3.1.md`（下称「文档」）
> 最后更新：2026-10-05

---

## 一、环境事实（重要，每次开工先确认）

| 环境           | Node.js                                                                        | pnpm                             | bun   | 说明                   |
| -------------- | ------------------------------------------------------------------------------ | -------------------------------- | ----- | ---------------------- |
| **用户本机**   | ✅ v24.21.0（`C:\Users\Administrator\AppData\Local\Programs\nodejs\node.exe`） | ✅ 9.15.0                        | 1.4.2 | 唯一能跑 vitest 的地方 |
| **子代理沙箱** | ⚠️ 有时能找到（需手动加 PATH），有时没有                                       | 不可用（`pnpm.cmd` 内部调 node） | ✅    | bun 可驱动 tsc         |

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

| 包                   | 内容                                                                                                            | 测试 |
| -------------------- | --------------------------------------------------------------------------------------------------------------- | ---- |
| `contract`           | §3 薄契约 + §9 34 类 + §12 数据模型 + 能力表/权限表/判据                                                        | 6    |
| `shell`              | 原子写（sha256 可选）、zip-slip/炸弹防护、路径越界（跨盘符）、错误中文文案                                      | 20   |
| `engine`             | 下载（超时/重试/Range 续传/sha256+sha512 校验/原子落盘）+ `FileTaskQueue`（JSONL 持久化/recover/优先级/cancel） | 19   |
| `kernel-java`        | 内容管理 5 生成器 + R dispatch + **9 个 W/X 真实现** + `get_context_pack`                                       | 177  |
| `kernel-server`      | R dispatch + **7 个 W/X 真实现**（EULA 拦截/部署哈希账本/回滚备份）+ `get_context_pack`                         | 80   |
| `kernel-bedrock`     | 目录探测 + **generate_content / validate_content 真实现**（manifest/uuid/目录层级）                             | 49   |
| `devkit`             | JDK 版本映射、Gradle（超时杀树/磁盘扫 jar/分发验签）、沙箱选项、产物 sha256                                     | 20   |
| `agent`              | MCP **stdio + Streamable HTTP** 双传输 + 编排 + 生成 + **§10.4 状态注入接线**                                   | 159  |
| `generator-datapack` | datapack/kubejs/crafttweaker/enchantment 实现（真迁 + core shim）                                               | 133  |
| `generator-bedrock`  | behavior-pack/item/entity（真迁 + shim，png-encoder 本地化）                                                    | 41   |
| `generator-mod`      | mod 集群 34 文件 + 13 测试（真迁 + shim，BuildCache 本地化）                                                    | 281  |
| `generator-plugin`   | Paper/Folia 双清单 + validatePluginStructure                                                                    | 19   |
| `i18n`               | 29 key 中英双语 + `t()` 回退 + `opConfirm`                                                                      | 13   |
| `ui`                 | **组件库真实现**：9 组件 + theme token + useTheme（theme/组件大部已落地）                                       | 335  |

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

| 包              | 测试数          | 备注                                                             |
| --------------- | --------------- | ---------------------------------------------------------------- |
| `agent`         | 63 → **226**    | + MCP HTTP 75 条 + 状态注入接线 21 条 + Accept/推送/持久化 67 条 |
| `kernel-java`   | 149 → **177**   | + url 下载矩阵 19 条 + context_pack 9 条                         |
| `kernel-server` | 62 → **80**     | + build_project 成功路径 8 条 + context_pack 10 条               |
| `engine`        | 19              | 错误分类改动后回归全绿                                           |
| `ui`            | 1 → **460**     | 9 组件 + theme + hooks；后补 actions/closeLabel/titleAction 三槽 |
| `desktop`       | 1661 → **1844** | + process-supervisor 109 条 + 组件迁移 60 条 + 冲突提示 13 条    |

### 5.2b 遗留（低优先，不阻塞）

- `TabBar` 未迁到 ui `Tabs`：desktop TabBar 的 tab 内嵌关闭按钮（nested-interactive）、
  脏标记、中键关闭、右键菜单，ui `Tabs` 只有 `{value,label,disabled,badge}` 且强制渲染
  `role="tabpanel"`。这是能力缺口而非接线问题，重写等于在 desktop 侧复刻整个 Tabs。

### 5.3 危险提醒

`apps/desktop/src/renderer/src/shell/`（10 个文件）曾是 **untracked**，里面的 `registerPreviewPanels()` 修复是 MiddlePanel EmptyState 测试转绿的关键。**已于 2026-10-05 `git add` 进暂存区**。若日后 `git stash`/重置后这些文件又变 untracked，必须重新 `git add`，否则 MiddlePanel 重新变红。

### 5.4 待补实现（本轮已清空四项，余项见下）

| 项                                           | 状态                                                                                          |
| -------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `packages/ui` 组件真实现                     | ✅ 已落地（theme token + useTheme + 9 组件 + 测试）                                           |
| kernel url 下载成功分支测试                  | ✅ 补齐（本地 http server + 白名单矩阵），**并顺手修了 2 个真 bug**（见 §5.5）                |
| `build_project` 真实 Gradle 成功分支测试     | ✅ 补齐（假 gradlew 夹具，零 JDK 依赖）                                                       |
| MCP Streamable HTTP 传输（§10.1）            | ✅ `packages/agent/src/mcp-http.ts`（batch / 会话 / Origin 校验 / SSE）                       |
| MCP HTTP Accept 校验 / 主动推送 / 会话持久化 | ✅ `parseAccept` + `NotificationHub` + `createJsonFilePersistence`                            |
| `get_context_pack` 状态注入接入内核（§10.4） | ✅ kernel-java + kernel-server 落地，MCP 通道接通                                             |
| 外壳层进程托管（§7.1 / §7.4）                | ✅ `apps/desktop/src/main/process-supervisor.ts`（状态机 / 优雅停机 / 端口等待 / 崩溃可观测） |
| desktop 组件迁移到 `@mc-creator/ui`          | ✅ ConfirmDialog / PromptDialog / ErrorBanner / WarningBanner / ToastProvider                 |

**剩余**：

- `TabBar` 未迁（能力缺口，见 §5.2b）
- MCP HTTP 的 `Accept` 校验**默认宽松**（`requireAccept: false`）：规范用 MAY，且已有 Origin
  - 授权钩子守安全边界；生产暴露到非本机时建议置 true
- process-supervisor 未做**崩溃自动重启**（§7.1）与 **RCON/控制台注入**（`reloadCommand` 只记录
  不自动发）；`crashed → starting` 流转已合法，加自动重启是纯增量
- process-supervisor 的 IPC **只暴露只读查询**，无「直接启停」通道（那必须走内核确认闸门）
- `build_project` 显式 `jarName` 会绕过 devkit 的 `-sources/-javadoc` 排除（行为合理，但值得记一笔）

### 5.4b 命名陷阱（踩过）

`apps/desktop/src/main/launcher-service.ts` **已存在**且是在跑的功能：PCL2/HMCL Minecraft
客户端下载器 + 离线启动器（`downloadClient`/`downloadAssets`/`launchGame`，`ipc/launcher.ts` 接线，
11 条既有测试）。**进程托管服务另命名为 `process-supervisor.ts`**，两者不是同一件事。
kernel-java 的注释原写「归 desktop 层 launcher-service」已改正 —— 那是错的，指了个下载器。

### 5.5 本轮修掉的真 bug（子代理暴露，非改测试凑绿）

1. **url 带 query string 时 install_mod 必然失败**（`kernel-java`）：`baseName()` 只按 `/\` 切分不剥 query，签名直链（`?token=` / `?X-Amz-Signature=`）会把 `mod.jar?token=x` 当文件名，Windows 下 `?` 非法 → ENOENT 且被误归类成 network 错误白重试 3 次。**修法**：新增 `fileNameFromUrl()` 取 `new URL(url).pathname` + `decodeURIComponent`，空/非法回退。
2. **白名单后缀匹配误放行 IP**（`kernel-java`）：`host.endsWith('.'+domain)` 对 IP 字面量也生效，`'127.0.0.1'.endsWith('.0.0.1')` 为真 → 白名单写 `0.0.1`/`0.1`/`1` 会放行本机。**修法**：`isIP(host) !== 0` 时只走全等。
3. **`Accept` 校验排在 GET 分支之后**（`mcp-http`）：自定义 `acceptChecker` 永远管不到 SSE 流。测试照出来了，已前移。
4. **关停时把空集合落盘**（`SessionStore`）：`serveHttp.close()` 走「服务没了」路径，却顺手把空存档写回，抹掉上一轮所有会话。**修法**：新增 `dispose()` 区分「关停」与「删除全部」。
5. **`#flush` 只 `.catch()` 没包 try/catch**：后端同步抛错（JSON 后端遇不可写路径会 throw）时 `Promise.resolve` 还没接管，异常直接冒泡打断请求。
6. **`Modal` 焦点陷阱选择器把 `tabIndex={-1}` 当可聚焦**（ui）：CSS 逗号是「或」，只在最后一项写 `not([tabindex="-1"])` 无效 —— `button:not([disabled])` 依然匹配 tabIndex=-1 的按钮，环绕计算被污染。每个条目都要自带排除条件。
7. **`Dropdown` 回退高亮把「显式清空」与「从未导航」混为一谈**（ui）：收起后 `aria-activedescendant` 仍指向已消失的浮层，读屏会宣告一个看不见的位置。**修法**：`activeIndex` 改三态（`null` 从未导航 / `>=0` 显式 / `-1` 清空）。
8. **`Modal` 初始焦点落在关闭按钮上**（ui）：关闭键在 DOM 里排最前，用户手一抖按 Enter 就把弹窗关了。改为优先 `initialFocusRef` → 首个非关闭元素 → 面板。
9. **`Modal` / `Toast` 关闭按钮硬编码中文**（ui）：英文环境下读屏会读出中文。**修法**：加 `closeLabel` 可注入。
10. **`i18n` 测试用相对路径 import 别的包源码**：`composite + rootDir` 下报 TS6059/TS6307。改成按包名 import 并在 `devDependencies` 声明。
11. **`devkit.test.ts` 未使用的 `mkdir` import**（TS6133，`noUnusedLocals`）—— 删 import，不加 `void` 掩盖。

附带（engine 侧，同源于 bug 1）：`download.ts` 的 `toClassifiedError` 把本地 `ENOENT`/`ENAMETOOLONG`/`EINVAL`/`EISDIR` 归成 `network+retryable`，导致「文件名非法」伪装成「网络错误」并白白重试满额。已改归 `validation` + `retryable:false`。

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
11. **CSS 逗号选择器是「或」不是「与」**：`a:not([x]), b:not([disabled])` 里只有最后一项带排除条件，前面的 `a` 仍会匹配 —— 每个条目都要自带排除条件。
12. **块注释里不能出现 `*/*`**（如写 Accept 的通配符 `*/*`）：它会**提前闭合注释**，后面全部解析失败，报出一堆看不懂的 TS1005/TS1434。写通配符用中文「全通配」或 `&#42;/&#42;`。
13. **直接调含 `setState` 的 hook API 时要 `act()` 包**：脱离 React 事件系统调用不会自动 flush，断言看到的是上一帧 DOM，报「找不到元素」。
14. **desktop 的 vitest 没装 jest-dom**：`toHaveClass`/`toHaveAttribute` 在 desktop 侧不可用（ui 侧装了）。用原生 `className` 断言 + `getAttribute`。
15. **命名先查重**：`launcher-service.ts` 这类名字可能已被在跑的功能占用。让子代理实现前先 `Select-String` 探一次被占用的名字，或在 prompt 里写明「若重名则另取名并在报告里说明」。

---

## 七、关键参考

- 设计文档：`D:\Downloads\MC全链路AI工作台-设计文档-v3.1.md`
- 本机验收清单：`LOCAL_VERIFICATION.md`
- 内核 TODO 规格：`LOCAL_VERIFICATION.md` 第二节（已被 §2.3 确认闸门方案取代大部分）
- 参考项目对照表：文档 §23（BukkitCode/EnderDevelopment 是竞品，差异化在本地执行+跨域打通+与启动器合一）
