# MEMORY.md · 进度与踩坑的唯一记忆入口

> 本文件是本仓的**唯一记忆入口**。接手前先读这里，不要靠猜。
> 最近更新：阶段 10 前的收尾轮（CI 全绿 + 5 个真缺陷修复 + 6 个提交）

---

## 0. 当前状态一句话

**阶段 0-9 全部落地，§15 工程化补齐已完成，CI 六个门禁全绿。**
剩余唯一整块工作：**阶段 10 的产品体验层**—— 把内核层接进 desktop（见 §7）。

| 门禁                             | 状态      | 实测                                                      |
| -------------------------------- | --------- | --------------------------------------------------------- |
| `pnpm -r test`                   | ✅ exit 0 | 17 包/ 268 files / 4303 tests（4282 passed + 21 skipped） |
| `pnpm -r typecheck`              | ✅ exit 0 | all 17 packages Done                                      |
| `pnpm lint`                      | ✅ exit 0 | **0 errors**（44 warnings，不影响退出码）                 |
| `pnpm format:check`              | ✅ exit 0 | All matched files use Prettier code style                 |
| `node scripts/check-docs.mjs`    | ✅ exit 0 | 所有文档数字与代码真值一致                                |
| `node scripts/check-bundle.mjs`  | ✅ exit 0 | 入口 1.58MB / 首屏 2.15MB / 非worker 13.20MB              |
| `pnpm --filter desktop test:e2e` | ✅ exit 0 | **11 passed**（真实拉起 Electron 44.4.3）                 |

---

## 1. 最近 6 个提交

| commit        | 内容                                                                |
| ------------- | ------------------------------------------------------------------- |
| `2e55ac1`     | asarUnpack + 修「打包启动即崩」+ Playwright E2E 门禁                |
| `1ac0cb7`     | §12 版本化迁移框架 + §14 半成品检测                                 |
| `84ac067`     | 移除失效的 isolated-vm 沙箱 + Mustache 加固 + file-manager 路径泄露 |
| `b95b467`     | packages/ui 无效类名 + Tailwind 扫描范围漏包                        |
| `996d127`     | PanelHost hook 崩溃 + Monaco 拆出主 chunk + 校验脚本读错文件        |
| （格式/lint） | 全仓 prettier 259→0、eslint 100→0                                   |

---

## 2. §2 本轮挖出并修掉的真缺陷（都不是 lint 能发现的）

### ① 打包出来的桌面应用启动即崩

`@mc-creator/shell` 是 **TS 源码包**（`package.json` 的 `main` 指向
`./src/index.ts`，无 dist）。electron-vite 默认 externalize 所有 dependencies，
产物里留下 `require('@mc-creator/shell')`，运行时 Node 读到 `index.ts` 再解析
其内部的 `'./errors.js'` —— 磁盘上只有 `errors.ts` → `ERR_MODULE_NOT_FOUND`。

**此前 CI 的 build job 一直是绿的**：build 只做 rollup，产物能否被 Node 加载
从来没人验。修法：照 `core`/`shared` 的既有做法把 shell 也列入 `workspacePkgs`

- alias 让 rollup 内联。

> **教训**：`pnpm build` 通过 ≠ 产物可加载。这类断言只能靠真启动进程来验，
> 这就是 E2E 存在的理由。

### ② `electron-builder.yml` 的 `files` 一打包就挂

`- from: out` 的 `to` 默认是**包根**，会剥掉 `out/` 前缀；且 `from != appDir`
时 electron-builder 不再自动补 `package.json`。结果 `package.json` 缺失 +
`out/main/index.js` 进包变 `main/index.js` → `Application entry file ... was
not found in this archive`。

> **陷阱**：顶层写 `'!**/node_modules/**'` 会被 `getNodeModuleFileMatcher`
> 一并收走，**排除掉全部生产依赖**。排除规则必须关在对象形式的 `filter` 里。

### ③ isolated-vm 沙箱**从来没生效过**（两条独立硬证据）

沙箱里跑的**不是用户代码**，是我们自己写死的约 100 行 Mustache 渲染器；
`template`/`fields` 只作为 `ExternalCopy` 数据注入，从不当代码执行。所以它防的
是「恶意输入打爆进程」，靠输入校验就够，不需要 V8 级隔离。

1. ABI：预编译只有 abi137/abi147，Electron 44 是 abi149，require 必抛
   `No native build was found for runtime=electron abi=149`；
2. **与 ABI 无关**：那段沙箱脚本字符串本身是 TypeScript（`x as Record<...>`、
   `let condVal: unknown;`），即便原生模块能加载，`compileScript` 也必然抛
   `SyntaxError: Unexpected identifier 'as'` 然后静默回退。

> **教训**：定性要先看代码到底在沙箱里跑什么。「原生模块 ABI 不兼容」是个
> 看似专业的定性，但方向可能是错的 —— 它把「架构误用」误判成「环境问题」。

### ④ 渲染层回退把加固成果整个抵消（**本轮最严重**）

`compileCustomNode.ts` 原本是 `sandboxed ?? renderMustache(...)`：主进程拒绝时
`console.warn` 后回退到渲染层那份**完全未加固**的实现（零预算约束、6 处用
`in` 读键可命中原型链）。

于是**攻击输入一旦触发主进程的 `OUTPUT_LIMIT_EXCEEDED`，主进程返回
`ok:false`，渲染层就回退到未加固那份，攻击在渲染进程里重新无上限生效**，
且 `{{field:constructor}}` 真的泄出 Object 构造函数。加固只覆盖了成功路径。

> **教训**：加固一个入口前，必须先确认「失败时会走去哪」。回退路径是攻击面的
> 组成部分，不是安全网。

### ⑤ file-manager 7 个通道路径信息泄露

`file:project:get{Workspace,OutputDir,BuildCacheDir,TempDir,ResourcePacksDir,
ModsDir,ExportsDir}` **零校验**直接返回
`resolve(userData, 'mc-creator', 'workspaces', projectId)`，渲染层传
`projectId = "../../../../.."` 即拿到任意绝对路径。同文件的流式通道本来就有
`checkSafePath`，只有这 7 个「返回路径」的漏了。

修法**不做事后路径补救**，改为入口拒绝非法 id —— `projectId` 语义上就是 id
而不是路径片段。复用 `project-store.ts` 已有的 `ID_RE`，抽到
`src/main/validation.ts` 共享。

顺带：`maxDepth = NaN` → 判据 `maxDepth >= 0 && depth > maxDepth` 恒 false
→ **无界递归遍历**（DoS）。非字符串 `projectId` 会让 `path.resolve` 抛
`TypeError` 逃出 `ipcMain.handle`。

### ⑥ 21 个 zod schema 是死代码，注释在骗人

`ipc/file-manager.ts` 的 21 个 `z.object` 只被 `z.infer` 当类型用，从未
`.parse()`；该文件**唯一 export 是 `registerFileManagerHandlers`**，所以它们
根本没被导出、别的模块无法 import。而文件头注释写着「用于 Zod 校验，保证跨
进程数据安全」。

> **这 21 条 `no-unused-vars` 是死代码告警，不是 lint 噪音。** 差点被当噪音处理。
> 判据：某条 lint 报错指向的东西，如果承载着「它声称的职责」，那它就不是噪音。

### ⑦ PanelHost hook 顺序崩溃（白屏级）

`lazy()` 的 useMemo 写在 early return **之后** → hook 数量随 `registration`
在1/2 之间变 → React 抛 `Rendered fewer/more hooks than expected` → 面板树白屏。

**触发路径必须换 `panelId`**：`registration` 的 useMemo 只依赖 `[panelId]`，
同一 id 重渲染不会重查注册表，所以「同 id 下注册表增删」观察不到。这决定了两件
事：测试怎么写（`rerender` 换 id），以及为什么这个 bug 能在 164 个测试文件下活着。

### ⑧ Monaco 一直在主 chunk 里，懒加载形同虚设

`lazy-monaco.ts` 的注释写着「Monaco 约 5MB，首次用编辑器前不要加载」，但它是
**死代码，全仓零引用**；真正的入口是 `App.tsx:26` 的静态副作用导入
`import './lib/monaco-setup.js'`。

效果：主 chunk **8.53 MB → 1.58 MB**，主 chunk 内 `monaco` 出现次数 613 → 8。

### ⑨ 三个 Tailwind 类名压根不存在（静默失效）

`text-mc-text-dim` / `text-mc-text-mute` / `animate-mc-fade-in` 在
`tailwind.config.js` 里查无此键（config 定义的是 `mc.dim`/`mc.mute` →
`text-mc-dim`/`text-mc-mute`；animation 里没有 `mc-fade-in`）。而同库
`Input.tsx`/`Progress.tsx`/`Tabs.tsx` 用的正是正确写法 —— 同库混用证明是笔误。
class 不存在 ≠ 报错，只是不生成样式，所以一直在静默失效。

### ⑩ Tailwind 扫描范围漏掉 packages/ui

`content` 只有 `./src/renderer/**`。而 desktop **确实在真实消费**该包（6 个组件
import 它）。关键机制：**Tailwind v3 对 `@layer components` 里自定义的类同样
「未用即删」**，所以连 `index.css` 里明确定义的类也会从产物消失。
修复后从 0 变 1 的：`mc-badge`、`tabular-nums`、`min-w-[240px]`、
`max-w-[420px]` —— 即 Tabs 脏徽标、Toast 宽度约束、Progress 数字对齐
**此前都是没样式的**。

### ⑪ `.prettierignore` 漏 `.pnpm-store`，一次 write 重写 1007 个缓存文件

`eslint.config.mjs` 早就忽略 `.pnpm-store`，prettier 是唯一例外。

---

## 3. §3 E2E 的设计（值得复用）

**走 Electron E2E（`_electron.launch()`），不走渲染层 `preview:web`。**
后者给 `window.mcApi` 注入的是 **Proxy 桩**，preload 的 `contextBridge`
一行都没覆盖、主进程一行都没跑，§15 的硬约束在桩下根本无法验证。
测试里**反向断言** `isPreviewStub === false`。

三条设计要点：

1. **入口包装**：`electron.launch()` 拿不到「应用代码之前」的钩子，所以用
   `main-guard.cjs` 作为入口，装好闸门后才 `require('out/main/index.js')`。
2. **文件系统闸门要给可执行证据**：守卫在重定向**之前**给真实 userData 拍
   递归文件清单快照，收尾再拍一张逐项比对。光说「我们改了路径所以没事」不是证据。
3. **闸门自检（第 11 条用例）**：主动打一次外网，证明闸门真的会响。
   「全程零出站」在守卫没装上时会**空转通过**，给出虚假安全感。
   这条用例当场抓到作者自己的断言错误（查错了那本账）。

顺带发现：**仓库根本没有自动更新实现**（`autoUpdater`/`electron-updater`
全仓 0 命中），所以「mock 更新器」当前无对象可 mock。守卫仍把内置
`autoUpdater` 三方法换抛错桩+ 断言 `electron-updater` 不可解析，
给「将来接上更新」埋雷 —— 接上的那天 E2E 会先变红。

Linux 腿**未本机验证**（依据官方 CI 同样在 ubuntu + xvfb 上跑 Electron +
`--with-deps` 覆盖系统库）。若要首次推送绝对绿，可从矩阵去掉 `ubuntu-latest`。

---

## 4. §4 子代理纪律（血泪）

1. **按文件切分，不按话题切分。** 同一话题不同文件可以并行；同一文件两个代理必打架。
2. **子代理不`git add`/`git commit`**，主代理统一提交（否则会互相吞改动）。
3. **每个代理必须实跑并贴原文输出**，禁止静态分析冒充实跑；跑不起来要明说。
4. **子代理卡住就直接接手**，不要等（见 MEMORY 历史：26 分钟零产出）。
5. **不许改测试断言/skip/删测试来"修"失败。** 断言与设计意图冲突时报告主代理裁决。
6. **不许留 `*.tmp.*`**，验证完删。
7. **施工中的包不要插手。**
8. **给子代理的情报必须自己先核实过。** 我曾发未核实的错误情报让代理白做排查。
9. **主代理自己动手改的东西也要做变异测试** —— 还原缺陷确认测试变红，
   否则测试可能是「恒真通过」。PanelHost 那6 条就是这么验证的。

---

## 5. §5 我犯过的错（别重犯）

1. **只搜字面量就断言死代码。** 搜 `<TabBar` 漏了
   `App.tsx → MainPanelView → MiddlePanel` 的间接引用，它在生产路径上。
2. **用 `**` glob 搜 src。** PowerShell 的 `**` **不递归** —— 曾因此误报
   safeStorage 未实现。**必须用 `Get-ChildItem -Recurse` 或 grep 工具。**
3. **把「架构误用」误判成「环境问题」。** isolated-vm 那次我第一反应是
   「降级 Electron 或换沙箱库」，两个选项都在解一个不存在的问题。
4. **采信子代理的「证据」而不验证其推论。** Tailwind 代理用
   `.mc-panel`/`.mc-divider` 产物中出现 0 次来论证「扫描范围有问题」——
   现象对，但推论错（那两个类源码里确实没被引用，`.mc-divider` 是死 CSS）。
   它的**结论**（packages/ui 没被扫描）是对的，但要用它自己的对照实验来证。
5. **信任代理给的「基线数字」而不复核。** 我给 eslint 代理的brief 里
   `create-demo-project.js` 写「21 条」，实际是 7 条；让它必须顺带处理
   `no-require-imports` 才够数。
6. **给brief 里写错误的修法。** 我让代理把 `Function` 改成
   `(...args: unknown[]) => void`，实测**破坏 tsc**（strictFunctionTypes
   参数逆变，窄回调不可赋给 `unknown[]` 形参）。代理自己发现并改了。

---

## 6. §6 已知遗留债（有据可查，不是模糊的「以后再说」）

| 项                                                                      | 状态                                                                                                                              | 触发重做的条件                                                                                   |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| **两份 Mustache 渲染实现**                                              | 两侧都有全套防线，`DEFAULT_LIMITS` 相等性测试锁死。但「同一逻辑写两遍」的结构性隐患在（未来语义改动漏一处 = 行为分裂）            | 彻底删需改 `graphRoundTripCoverage.test.ts` 的断言语义（它在 jsdom 无bridge 时断言本地渲染结果） |
| **Monaco 门控靠人工枚举三个入口**                                       | 新增渲染 `<Editor>` 的面板若忘套 `withMonacoSetup` 会退化成 CDN 回退（被 CSP 拦 → 编辑器无高亮）                                  | 建议改自动检测：面板声明 `needsMonaco: true`，或加 lint 规则                                     |
| **`lazy-monaco.ts` 的 `LazyEditor`/`LazyDiffEditor` 无人使用**          | 那些组件的测试是同步 `render()` 后立即断言，改为 `React.lazy` 会挂在 Suspense fallback 上                                         | 需要先改测试写法                                                                                 |
| **`vendor-xyflow` 550KB 仍被 index.html 预加载**                        | 只服务 lowcode 面板，不该在首屏；占首屏预算 26%                                                                                   | 独立一轮                                                                                         |
| **`file-manager` IPC 无运行时校验**                                     | 21 个 schema 转成了 TS type，**没补 `.parse()`**（会改变运行时行为）。`registerFileManagerHandlers` 当时零测试覆盖                | 作为独立安全加固做：补 parse + 修 7 个 get*Dir + 定projectId 约束 + 建回归网                     |
| **`engine.run` / 生成器在 `packages/core` 下有大量 prettier-only 改动** | 纯格式化，无行为变化                                                                                                              | —                                                                                                |
| **44 条 eslint warning**                                                | `react-refresh` 30（要拆导出）+ `exhaustive-deps` 14（改依赖数组会改 memo 身份）                                                  | 不影响退出码，按需                                                                               |
| **本机 Node 24 vs CI Node 20**                                          | 本机过 ≠ CI 过。CI 出本地复现不了的失败时，这是第一个该查的                                                                       | —                                                                                                |
| **`engines.node: ">=18"` 与 Playwright 需要 `>=20` 不一致**             | pnpm 默认只警告不强制，实际无碍                                                                                                   | 收紧声明或锁到 1.55.x                                                                            |
| **stash 区有 2 条残留**                                                 | `stash@{0}` 是 commitlint 钩子拒绝提交时 lint-staged 的自动备份（内容已进提交）；`stash@{1}` 指向 `18e9940`，是本会话之外的旧 WIP | **不要盲删**，尤其 `stash@{1}` 可能有未完成工作                                                  |

---

## 7. §7 下一步：阶段 10 产品体验层（唯一剩余整块）

**§18 阶段 10 = 工程化补齐（已完成）+ 产品体验层（未开始）。**

已核实的现状：**内核层根本没接进 desktop**。

- `apps/desktop/package.json` 只依赖 `core`/`shared`/`shell`/`ui` ——
  **不依赖 agent，也不依赖任何 kernel 包**
- 内核唯一的生产构造点 `packages/agent` 的 `createMcpServer` **只被测试调用**，
  没有生产宿主
- desktop 的 12 个 IPC handler（generate/build/project/market/modpack/git/
  terminal/launcher/node-graph/file-manager/rag/process-supervisor）
  **没有一个碰内核**

后果：设计文档 §17 的两个闭环场景**目前跑不起来**（场景 A 要
`deploy_plugin → restart_server → read_logs`；场景 B 要
`install_modpack → import_package → restart_server`）。这些 kind 在 kernel 里
实现得挺全（kernel-java 177 测试、kernel-server 80），但**从 UI 无路可达**。

**接线方式设计文档已给出答案，不要问用户**（§4.2 / line 141）：

> 客户端 ↔ 能力层：Electron IPC（`invoke`/`handle`）+ `contextBridge` 白名单

即内核在**主进程内构造**，经 IPC 白名单暴露给渲染层，**不走 MCP 子进程**
（MCP §10 是给外部 AI 客户端的工具面，是另一条通道）。

范围：

| 文件                                       | 动作                                                                 |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `src/main/kernel-runtime.ts`               | 新建：主进程构造三内核 + dataDir + §10.6 确认门控 + 进程状态事件转发 |
| `src/main/ipc/kernel.ts`                   | 新建：按 §4.2 的 zod 入参/出参模式注册 handler                       |
| `src/shared/ipc/channels.ts`               | 加 `KERNEL_*` 白名单                                                 |
| `src/preload/index.ts`                     | 加进 contextBridge 白名单                                            |
| `src/main/ipc.ts`                          | 2 行注册                                                             |
| `package.json` / `electron.vite.config.ts` | 加 4 个 workspace 依赖 + external                                    |

接上后 `index.ts` 的 `kernelRoot` 才有值 —— 它现在传 `undefined` **不是忘了传
参数**，注释已改成准确表述。半成品实例扫描逻辑（`startup-recovery.ts` 的
`scanInstanceRoot`）已落地并测透，无需改动。

---

## 8. §8 版本升级（评估已完成，未执行）

### React 18 → 19：**需中等改造**（0.5-1 人日）

11 条破坏性变更里 **9 条已核实未命中**（这个代码库在 18.3 时代就把迁移做干净了），
3 个真命中：

1. **`RefObject<T>` 去掉 `| null`** → 3 个 prop 声明静默断裂（`Modal.tsx:73`、
   `SkinPreviewPanel.tsx:1689`）。19 下 `useRef<X>(null)` 返回
   `RefObject<X | null>`，赋不进 `RefObject<X>`。
2. **全局 `JSX` 命名空间移除** → `RecentGraphsMenu.tsx:70` 一处，改
   `React.JSX.Element`。
3. **`useId()` 前缀在 19.1 变化**（`:r0:` → `«r0»` → 19.2 又变 `_r_<n>_`）。
   本仓 5 处用 `.replace(/:/g,'')` 清洗，在 19.1 下变成 no-op。
   **唯一真红**：`Tabs.slots.test.tsx:661` 的 `/mc-tab-\w+-/` 归一化正则。
   > 关键：`^19.0.0` 会解析到 19.1+，所以**实际必踩**，与是否写 `^19` 无关。
   > 代理建议选 `^19` + 改 1 行正则（而非 pin `~19.0.0`）——
   > 理由是「一个格式在两个 minor 里变了两次的东西，不该被写进断言」。

**硬性 peer 阻塞**：`@testing-library/react` 15 的 peer 是 `react ^18`，
不升到 16 就装不上 React 19。

顺带的**真实收益**：`RefObject` 变可变后，`Tabs.tsx:397` /
`CodeDiff.tsx:599` / `RecentGraphsMenu.tsx:168` 那类「往 ref 数组里塞元素」
的写法不再需要类型体操。

**建议执行顺序**（关键在第 1 步）：

1. **只升 `@types/react` 到 19，不动 runtime** —— 零运行时风险，一次纯类型
   检查把全仓 React 19 类型断裂一次性扫出来。**类型检查不可能把绿测试搞红。**
2. 升 `@testing-library/react` 到 16 + react 到 19，跑全量测试（预期红 0-1 条）
3. typecheck → lint → 全量测试 → build → **E2E**（E2E 是唯一能验证真实浏览器
   行为的关卡，jsdom 测不到真实 `useId`、aria 解析、Suspense 时序、Monaco 集成）

**尚未派代理执行。** 建议等阶段 10 接线完成后再动 —— 在 4300 条绿测试基线上
叠版本升级，会让「升级引入的问题」和「新功能的问题」纠缠不清。

### 其它落后一代（文档要求的是**能力**不是版本）

React 18.3（19 已发布）、Vite 5.4（6/7 已发布）、Vitest 2（3 已发布）、
Tailwind 3.4（4 已发布）、Zod 3.23（4 已发布）。

**Tailwind v4 的真实战场全在 desktop**，不在 `packages/ui`（ui 里 `@tailwind`/
`@apply` 出现 0 次）。但 v4 迁移有个坑：必须加
`@source "../../../../../packages/ui/src"`，否则 §2-⑩ 那个扫描范围缺陷会继续
静默存在。视觉回归点：`backdrop-blur-sm` → `backdrop-blur-xs`、
`rounded-sm` → `rounded-xs`、border 默认色 `gray-200` → `currentColor`。

---

## 9. §9 环境

- 本机 Node **v24.21.0** / pnpm 9.15.0 / bun 1.4.2
- **`where node` 大概率查不到**，每条命令前置：
  `$env:Path = "C:\Users\Administrator\AppData\Local\Programs\nodejs;" + $env:Path`
- CI 用 **Node 20**（gradle-matrix 用 22）—— **本机过 ≠ CI 过**
- bun 能驱动 tsc，**但不能信 bun 跑 vitest 的结果**
- 所有命令用 workdir 参数指定，**不要 cd**（路径含空格）

---

## 10. §10 容易踩的坑（工具层）

1. **PowerShell 的 `Select-String -SimpleMatch` 配 `-AllMatches` 不填充
   `.Matches`** —— 计数会得 0。要么用正则（**不要** `Regex.Escape`，
   它不转义 `/` 而 CSS 里是 `\/`），要么 `-SimpleMatch` 不用 `-AllMatches`。
2. **git commit 消息含反引号会被 PowerShell 吞掉**，多行中文消息一律用
   `git commit -F <文件>`。
3. **commitlint 的 `subject-case`**：subject 不能以大写字母开头
   （`fix(security): Mustache ...` 会被拒）。中文开头即可。
4. **`git commit` 失败后lint-staged 会留 `stash@{N}: lint-staged automatic
backup`**。不要盲删 stash 区，尤其指向旧 commit 的那些。
5. `E:\Cache\temp\opencode` 是已批准的临时目录，探针/临时产物放那里，
   **不要留在仓库内**。
