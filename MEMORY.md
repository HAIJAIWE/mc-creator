# MEMORY.md · 进度与踩坑的唯一记忆入口

> 本文件是本仓的**唯一记忆入口**。接手前先读这里，不要靠猜。
> 最近更新：顺序补齐 6 个缺口（UI 哈希展示→运行验证→构建接线→智能体宿主→主进程拉起→推理网关）

> 📄 **设计文档已找到**：`D:\Downloads\MC全链路AI工作台-设计文档-v3.1.md`（931 行）。
> 之前两轮「文档不在仓内」的判断只对仓内而言 —— 文档在 `D:\Downloads` 下，
> **不在 git 仓库内**，所以 grep/git 搜不到。建议复制一份进仓（`docs/`），
> 否则每个新会话都会重新踩「靠代码注释猜原文」这个坑。
> §24 记录了 v3.0→v3.1 的修订（ContentKind 32→34，新增 ProxyPlugin）。

---

## 0. 当前状态一句话

**阶段 0-10 全部落地；§8.3 编译侧+运行验证+智能体宿主+推理网关接口已补齐。**
设计文档在 `D:\Downloads\MC全链路AI工作台-设计文档-v3.1.md`（**不在 git 仓库内**，
建议复制一份进 `docs/`，否则每会话重踩“靠注释猜原文”坑）。

| 门禁                             | 状态      | 实测                                                                |
| -------------------------------- | --------- | ------------------------------------------------------------------- |
| `pnpm -r test`                   | ✅ exit 0 | 18 包/ 295 files / 4893 passed + 43 skipped                         |
| `pnpm -r typecheck`              | ✅ exit 0 | all 18 packages Done                                                |
| `pnpm lint`                      | ✅ exit 0 | **0 errors**（44 warnings，不影响退出码）                           |
| `pnpm format:check`              | ✅ exit 0 | All matched files use Prettier code style                           |
| `node scripts/check-docs.mjs`    | ✅ exit 0 | 所有文档数字与代码真值一致                                          |
| `node scripts/check-bundle.mjs`  | ✅ exit 0 | 入口 1.59MB / 非worker 13.20MB（体积未变，隔离代码在主进程侧）      |
| `pnpm --filter desktop test:e2e` | ✅ exit 0 | **11 passed**（真实拉起 Electron 44.4.3）                           |
| `pnpm --filter desktop build`    | ✅ exit 0 | 已验证 `@mc-creator/jobobject` 留在运行时 require，未被 rollup 内联 |

---

## 1. 最近 6 个提交

| commit    | 内容                                   |
| --------- | -------------------------------------- |
| `8eea38e` | 推理网关接口层（§10.0，不接真实 LLM）  |
| `eaa59b3` | 主进程显式拉起智能体独立进程（§10.1）  |
| `94cf084` | 智能体生产宿主入口（阶段 7）           |
| `5070ab9` | build_project 接入一次性沙箱产物验证   |
| `0d885e9` | 一次性沙箱产物加载冒烟（§8.1#5）       |
| `5ad9388` | 内核面板展示产物哈希与隔离回报（只读） |

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
7. **探针自己骗我，比探针写错更危险。** §8.3 那轮我用 `process.kill(pid, 0)`
   判存活，在 Windows 上它对**活着的进程也返回「已死」**，于是我一度以为
   「整树终止把父子都杀了」，差点把一个真实的 bug 当成通过。**测量方法本身要先
   自检**（拿已知存活的 pid 验证），再拿去测别人。
8. **「测试全绿」不等于「测试有效」。** 同一个探针里，内存上限测试在
   **去掉上限的变异体下依然全绿** —— 因为 `while(true)` 狂分配本来就会耗尽
   内存。判据：一条断言若在「被测行为被移除」时仍然通过，它测的就不是那个行为。
   必须做变异测试（MEMORY §4.9）。
9. **「API 返回成功」不等于「事情真的发生了」。** §8.3 收尾时我漏掉一个
   致命 bug：`build_project` 在 `Path`/`PATH` 大小写问题下**返回 `ok=true`
   且 `isolation` 字段完整**，但一个 jar 都没构建、构建脚本从未执行 ——
   而全部门禁（含 4874 条测试与 E2E）全绿。判据：断言要问「被测行为的**可观测
   副作用**发生了吗」（产物存在 / 脚本写了标记），而不是「函数返回了什么」。
   写完「接线类」改动后，务必造一个**能在磁盘上留下痕迹**的 fixture 跑一遍真链路。

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

## 7. §7 阶段 10 产品体验层（**已完成**，见 commit `d219777`）

> 本节原是「下一步」，现已落地。保留设计决策与踩坑记录供后续查阅：
> 内核在**主进程内构造**、经 IPC 白名单暴露给渲染层，**不走 MCP 子进程**。
> 实现文件：`src/main/kernel-runtime.ts`、`src/main/ipc/kernel.ts`、
> `src/main/kernel-confirm.ts`、`src/shared/ipc/kernel.ts`、
> 渲染层 `components/KernelPanel.tsx`。

**§18 阶段 10 = 工程化补齐（已完成）+ 产品体验层（未开始）。**

**以下是动手前的核实结论（现已全部落地，此处保留作为「为什么这么接」的依据）**：
当时核实到**内核层根本没接进 desktop**。

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

实施时的实际范围：

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

## 7.5 §8.3 进程级隔离（本轮落地，含 5 个真踩坑）

### 起点：约束在代码里，不在文档里

`进程隔离` 这个词**全仓与全历史零命中**（`git log -S` 为空）。真正的锚点是
`packages/devkit/src/sandbox.ts:2` → `设计文档 §8.3 安全模型 / §13.4 代码执行`，
而**设计文档本身不在仓内**，只有代码注释引用了原文片段：

> JDK 17 起 SecurityManager 被标记为待移除，JDK 24 已永久禁用
> → 无法在进程内沙箱化 Java 代码 → **必须使用进程级或容器级隔离**

`sandbox.ts` 明确写了它**不提供**进程内限制，只声明契约，由「进程/容器实施者」
消费 —— 而那个实施者**当时根本不存在**。核实差距：

| §8.3 约束               | 落地前                                                  | 落地后                                    |
| ----------------------- | ------------------------------------------------------- | ----------------------------------------- |
| cwd jail / 路径逃逸防护 | ✅ `assertWithinRoot`                                   | ✅ 不变                                   |
| 墙钟超时 + 杀整棵树     | ✅ taskkill /t /f                                       | ✅ 且改为 job 句柄（更强）                |
| `envAllowlist`          | ❌ **从未执行**（`gradle.ts:84` 是 `{...process.env}`） | ✅ 执行器按白名单过滤                     |
| 内存硬上限              | ❌ 未实施                                               | ✅ `JOB_OBJECT_LIMIT_PROCESS_MEMORY`      |
| CPU 配额                | ❌ 未实施                                               | ✅ `JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP` |
| **禁用网络出站**        | ❌ 未实施                                               | ❌ **仍然未强制**（见下）                 |
| `buildSandboxOptions`   | ❌ **生产零引用**（死代码）                             | ✅ 被 `build_project` 调用                |

### ⚠️ 网络隔离：原生绑定也做不到

**Job Object 无法禁止网络访问。** 需要 Windows 防火墙按程序规则（要管理员权限）
或容器级隔离。所以 `enforced.network` 恒为 `false`，且被类型钉成字面量 `false`
（`EnforcedReport.network: false`），`kernel-server` 的 `build_project` 把它放进
返回值 `data.isolation` 向上暴露。**UI 因此无法显示一个永远为绿的「已沙箱化」。**

### 五个真踩坑（都不是 lint 能发现的）

1. **`cflags_cc` 不会传给 MSVC** —— `/utf-8` 和 `/EHsc` 都被**静默丢弃**。
   症状：中文注释按系统代码页（936/GBK）读，GBK 尾字节含 `0x5C`(`\`) 被误读成
   行尾续行符，**吞掉后面的 `#endif`** → `error C1020: unexpected #endif`；
   `/EHsc` 丢失则报 C4530 且异常展开不可靠。修法：用 `msvs_settings`
   （node-pty 已在用），并且把 `src/binding.cc` 改成**纯 ASCII**、中文说明移进
   `README.md` —— ASCII 对任何 locale 的 CI 都免疫。

2. **`terminateTree` 返回裸 boolean 是最坏的失败形态** —— 它在进程明明还活着
   时返回 `true`（早期版本 + 陈旧二进制的组合）。改成返回诊断对象
   `{ok, lastError, activeBefore, activeProcesses}`，并配了一条**对照实验**证明
   `terminateTree` 变 no-op 时该用例确实变红。

3. **「杀掉孙进程」这个断言测不出整树终止** —— 实测 Windows 上父进程被终止时
   其非 detached 子进程会一并消失，所以「孙进程死了」**无法**区分
   `TerminateJobObject`（杀整树）与 `TerminateProcess`（只杀父）：变异体存活。
   真正能判别的是 **job 记账** —— 孤立的孙进程**仍留在 job 内**，
   `activeProcesses === 0` 只有整树终止才做得到。

4. **`process.kill(pid, 0)` 在 Windows 上不是有效的存活检查** —— 会给出「进程已死」
   的假象（第一版探针因此误报 "tree died too early"）。改用 `tasklist`，且
   **先自检方法本身**（用已知存活的自身 pid 验证），否则整套存活断言都是测量假象。
   同理 `tasklist` 在无匹配时 exit 1，那是确定的「已死」而非测量错误。

5. **内存上限测试最初毫无鉴别力** —— 用 `while(true)` 狂分配时，**去掉上限的
   变异体也能拿到同样的 exit 9**（靠耗尽系统内存）。改成「单次分配 400MB +
   上限 200MB」，并让分配量**远小于本机物理内存**，再配一条无上限的对照实验。

6. **本机 `process.env` 里存的是 `Path` 而不是 `PATH`** —— Windows 环境变量
   大小写不敏感，但 JS 对象键敏感。`'PATH' in process.env` 为 true（Node 做了
   别名），**可 `{...process.env}` 展开后只有 `Path`** —— 再用 `source['PATH']`
   读就是 `undefined`。

   后果链：PATH 被静默丢弃 → `.bat` 里的 `node` 找不到（cmd.exe 报「'node' 不是
   内部或外部命令」）→ **退出码仍是 0** → `build_project` 返回 `ok=true`，
   一个 jar 都没构建。**全部门禁全绿**，因为没有任何测试断言「构建产物里的脚本
   真的执行了」。

   修法：`filterEnv` 建一张小写索引做不区分大小写查找。已加两条回归测试
   （含一条直接对真实 `process.env` 展开后的对象断言）。

7. **`devkit` 是 `"type": "module"`，里面裸 `require` 是 ReferenceError** ——
   被 `catch` 吞掉后静默降级成 `enforced.source='unisolated'`，隔离形同虚设而
   测试全绿。必须用 `createRequire(import.meta.url)`。**加上**
   `@mc-creator/jobobject` 到 devkit 的 `dependencies`（pnpm 只为直接依赖建
   软链，不列就 require 不到）。

8. **测量要能区分「没执行」与「执行了但成功」** —— 我一度把「脚本从未运行」
   读成「内存上限没生效」。判据：让被测脚本**先写 `start` 标记**再尝试分配，
   这样 `start` / `ok` / `refused` / 缺失 四种状态互不混淆。同理对照组必须
   跑在**不同目录**，否则它的产物会污染正式测量的读数（我犯过：对照组写的
   `alloc-ok` 被当成了内核的结果）。

> 这 5 条（③④⑤⑥⑦⑧）有个共同形态：**失败都表现为「成功」**。退出码 0、
> `ok=true`、`enforced` 字段齐全、测试全绿。要抓住它们，只能问「被测的那个
> 行为真的发生了吗」，而不是「API 返回了什么」。

### 变异测试实测（MEMORY §4.9 要求，含主代理自己改的东西）

| 变异                         | 结果                              |
| ---------------------------- | --------------------------------- |
| 去掉内存上限 flag            | ✅ 被杀死                         |
| 去掉 `KILL_ON_JOB_CLOSE`     | ✅ 被杀死                         |
| `spawnInJob` 不返回 pid      | ✅ 被杀死                         |
| `terminateTree` 退化成只杀父 | ✅ 被杀死（靠 job 记账断言）      |
| **去掉 `CREATE_SUSPENDED`**  | ❌ **存活 —— 已知无法用单测覆盖** |

最后一条是**设计约束而非测试缺口**：它消除的是「分配 job 之前」那个微秒级
TOCTOU 窗口，构造它需要子进程在自己第一条指令里就 spawn 孙进程，本质不可确定性
复现。正确性依据是 Win32 语义（后代由内核自动继承进 job）。**改动
`spawnInJob` 的创建标志时，请把这条当设计约束看。**

另有一件对 §8.3 至关重要、且已验证的事：**内存上限对孙进程同样生效**。
`JOB_OBJECT_LIMIT_PROCESS_MEMORY` 若只约束 job 的**直接子进程**，那对 Gradle
毫无意义 —— 真正吃内存的是 `.bat` 拉起的 java，那是孙进程。实测
`cmd.exe → node alloc.js` 这个同构形状下，200MB 上限确实让孙进程的 400MB 分配
失败（`alloc-refused`），无上限时成功（`alloc-ok`）。已固化为测试用例。

### §8.3 原文的四条要求 vs 实际完成度

拿到 v3.1 原文后重新核对（此前只靠 `sandbox.ts` 注释里的片段推断）：

| §8.3 原文要求                                              | 状态                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| 编译在**独立进程**，设 CPU / 内存 / 时间上限               | ✅ 本轮完成并端到端实测                                            |
| 运行验证在**一次性容器或进程**中，禁用网络出站（或白名单） | ❌ **运行验证整体不存在**；网络也未强制                            |
| 一次性沙箱内生成的代码**永不自动加载**进正式服务端         | ✅ kernel `mode='sandbox'` 写 sandboxDir 且不自动部署              |
| 所有产物**哈希记录**，供用户审计                           | ⚠️ 哈希已记录并经 IPC 返回，但**UI 从不显示** → 不算「供用户审计」 |

> 第二条是 §8.1#5「隔离运行：编译产物在一次性沙箱中加载测试」，全仓只有注释提及。
> 换句话说：**编译侧隔离做完了，验证侧隔离一行都没有。**

### 落地清单

- **`waitForExit(child, 0)` 曾表示 INFINITE** → 想轮询的调用方永久阻塞。
  现在 `0` = 轮询、`<0` = 无限等。开发时被这个坑过。
- **`SystemRoot` 是硬性必需，不是可选加固** —— Windows 的 `CreateProcess` 靠它解析
  DLL 搜索路径。实测逐一保留候选变量时，**只有带 `SystemRoot` 子进程才起得来**
  （退 0），只带 `windir`/`TEMP`/`ComSpec`/`PATHEXT` 一律退 134。
  所以 `filterEnv` 隐式保留 `SystemRoot`/`TEMP`/`TMP`（值由系统提供，无凭据）——
  **收紧 env 本身会变成故障源**。

### 落地清单

| 文件                                        | 动作                                                              |
| ------------------------------------------- | ----------------------------------------------------------------- |
| `packages/jobobject/`（新包）               | N-API addon（7 个绑定）+ `launcher.js` + 永不抛错的加载器         |
| `packages/devkit/src/sandbox-exec.ts`（新） | 沙箱执行器，让 `buildSandboxOptions` 变活；env 白名单             |
| `packages/kernel-server/src/kernel.ts`      | `build_project` 走执行器，返回 `data.isolation`                   |
| `apps/desktop/electron.vite.config.ts`      | `runtimeOnlyModules` 显式 external（`.node` 不能内联）            |
| `apps/desktop/electron-builder.yml`         | `asarUnpack` 加一条 scoped 包路径                                 |
| `apps/desktop/electron-builder.test.ts`     | 断言正则放行 `@scope/name`（**故意设卡的测试**）                  |
| `eslint.config.mjs`                         | jobobject 的 CJS 规则 + sandbox-exec 的 `no-require-imports` 例外 |

> **已验证**：`build` 后产物里是 `require("@mc-creator/jobobject")`（运行时解析），
> **无 `.node` 字面量** → 不会重演 MEMORY §2-①「打包启动即崩」。
> **已验证**：`--dir` 打包实测 `.node` 落到 `app.asar.unpacked`，且从解包路径
> 加载后隔离仍生效（200MB 上限下 400MB 分配被拒）。
> **已知遗留**：electron-builder **不对 workspace 软链包应用其 `files[]`**
> （实测打包产物里仍带 1.4MB node-gyp 垃圾）。已写进 yml 注释，未修。

---

## 7.6 对齐 v3.1 设计文档的完成度盘点（逐条核实，非印象）

判据一律用代码证据，不靠注释声称。括号内为核实方式。

### §18 阶段 0-10

| 阶段                                     | 状态      | 证据                                                                                                                                                     |
| ---------------------------------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 契约 + 34 类内容模型                   | ✅        | `contract.ts` ContentKind **34 项逐条对齐**，含 ProxyPlugin（§24 新增项）                                                                                |
| 1 共享外壳（下载/队列/原子写/路径/安全） | ✅ 大部分 | `engine/{download,task-queue}.ts`（持久化+优先级+cancel+recover 齐全）、`shell/{atomic-write,paths,zip-safety}.ts`。**例外见下表**                       |
| 2 Java 内核启动链路                      | ✅        | kernel-java 201 测试                                                                                                                                     |
| 3 Java 内核内容管理                      | ✅        | kernel-java                                                                                                                                              |
| 4 Bedrock 内核                           | ✅        | kernel-bedrock 49 测试                                                                                                                                   |
| 5 服务端内核                             | ✅        | kernel-server 81 测试；**§7.3 Folia 硬开关 + paper-plugin.yml 双清单已实现且有测试**                                                                     |
| 6 devkit                                 | ✅        | 编译侧隔离 + 运行验证（`validateArtifact` 一次性沙箱冒烟，已接进 `build_project` step 2.5，不推翻构建成功）                                              |
| 7 MCP 工具层 + 智能体进程                | ✅ 接口层 | `host.ts`（startStdio/startHttp/main，无副作用）+ 主进程 `agent-host.ts`（显式拉起独立进程）+ `infer.ts` 网关接口；真实 LLM 传输与 BYOK 落盘由调用方注入 |
| 8 生成阶梯（数据包→基岩→插件→服务端Mod） | ✅        | 4 个 generator 包                                                                                                                                        |
| 9 客户端 Mod（含 Mixin）                 | ✅        | `generator-mod/src/fabric/mixin.ts` + mixins.json + 测试                                                                                                 |
| 10 工程化 + 产品体验层                   | ✅        | CI 六门禁 + E2E                                                                                                                                          |

### SQLite 迁移已叫停（证据充分，不是拖延）

用户追问“哪来的用户数据”后逐条核实：`mc-accounts.json`（账户+OAuth token）、
`projects/<id>.json`（项目元数据）确实是用户数据。但继续深挖发现迁移**收益≈零**：

1. 访问模式只有四种：全量枚举、按 id 读、按 id 写、按 id 删。零联表、零范围查询、
   数据量是十几条。SQLite 对这种模式相对 JSON 没有可测量的优势。
2. 代价是实的：`project-store.test.ts` 24 条用例里大多数直接断言**文件语义**
   （独立文件、删文件、`.tmp` 原子写、信封落盘、legacy 迁移标记），换后端等于重写
   它们 —— 正是 §4.5 禁止的“改测试来修失败”的擦边情形，不碰为妙。
3. `mc-account-store` 更糟：fail-closed 加密 + token 续期逻辑和文件读取绞在一起，
   动它冒的是登录回归风险，换来的查询收益还是零。
4. `build-cache` 文件头自己写了“没有用户数据”，小 KV 配置也没毛病 —— 这两处连迁的
   理由都没有，electron-store 也不引。

附带实测证据（将来重开机时不用重探）：better-sqlite3@13.0.3 预编译不带 abi 标签，
同一份二进制已在真实 Electron 44.4.3 里加载 + 文件 CRUD 成功 —— 它**不是**
isolated-vm 那类问题，原生链是通的。S1（sqlite 底座+依赖+打包）已验证通过但**整体
revert，未提交**：无消费者就留着是死代码（§2-⑥ 模式），证据记在这里即可。

重开条件（满足任一）：① 测出 JSON store 的可量化毛病（如百级项目下 loadProjects
耗时超标）；② 出现需要联表/全文检索的新需求（如 MCP search_content 分页查元数据）。

### 核实出的缺口（都有代码证据，不是猜测）—— 本轮已补 1/4/5，剩余 2 项

1. ~~**§10.0 模型接入层基本没做**~~ ✅ 已补接口层：`infer.ts`（路由分级/重试1次/超时与超预算转人工，凭据注入不碰 Electron）+ `host.ts`（生产宿主入口）+ 主进程 `agent-host.ts`（独立进程显式拉起）。真实 LLM 传输与 BYOK 落盘仍由调用方注入。
2. **§4.6 / §15 的 electron-updater 灰度更新没有实现** —— 全仓 0 命中，
   只有 E2E 守卫在**确认它不存在**。§4.1 的「单实例锁/深链」未核实。（未动：需产品决策，接更新源即动发布链）
3. **§4.4 指定的 better-sqlite3 + electron-store 都没用** —— 状态持久化实际
   是各自的 JSON store。功能可用，技术选型与文档不符。（未动：迁移存储格式动用户磁盘数据，独立议题）
4. ~~**§8.3「产物哈希供用户审计」没闭环**~~ ✅ 已补：`KernelPanel` 新增“最近构建（只读）” section，经 `get_context_pack` 展示 `lastBuildHash` + isolation 明细（前向兼容）。
5. ~~**§8.3 运行验证缺失**~~ ✅ 已补（见上表阶段 6）。

> 结论更新：**阶段 0-10 接口层全部落地**。剩余是需产品/发布决策的两项
> （更新器、存储选型）+ 真实 LLM 供应商接入（需要 Key 与出境合规决策，见 §10.0 合规开关）。
> §17 闭环场景的链路已通（生成→编译→验证→部署），缺的是真实模型驱动。

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

**尚未派代理执行。** 阶段 10 接线（§7）已完成，**现在可以动了** ——
但建议先跑一次 `electron-builder --dir` 确认 asarUnpack 那条新路径（§7.5 唯一未验证项），
把打包链的不确定性先排除，再叠版本升级。

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
