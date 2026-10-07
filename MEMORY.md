# MEMORY.md · 进度与踩坑的唯一记忆入口

> 本文件是本仓的**唯一记忆入口**。接手前先读这里，不要靠猜。
> 最近更新：**§6.4 材质改走官方 Texture Set**（MER 只是其中一层，不是机制本身），见 §7.11；
> §6.2 基岩导入网关导入前校验落地，见 §7.10；§7.2 代理层上一版是假实现已重写，见 §7.9。
> 全绿 322/5475。
> NeoForge 端到端**本机不可验**（maven.neoforged.net 不通），见 §7.8

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
| `pnpm -r test`                   | ✅ exit 0 | 18 包/ 322 files / 5475 passed + 43 skipped                         |
| `pnpm -r typecheck`              | ✅ exit 0 | all 18 packages Done                                                |
| `pnpm lint`                      | ✅ exit 0 | **0 errors**（45 warnings，不影响退出码）                           |
| `pnpm format:check`              | ✅ exit 0 | All matched files use Prettier code style                           |
| `node scripts/check-docs.mjs`    | ✅ exit 0 | 所有文档数字与代码真值一致                                          |
| `node scripts/check-bundle.mjs`  | ✅ exit 0 | 入口 1.59MB / 非worker 13.20MB（体积未变，隔离代码在主进程侧）      |
| `pnpm --filter desktop test:e2e` | ✅ exit 0 | **11 passed**（真实拉起 Electron 44.4.3）                           |
| `pnpm --filter desktop build`    | ✅ exit 0 | 已验证 `@mc-creator/jobobject` 留在运行时 require，未被 rollup 内联 |

---

## 1. 最近 6 个提交

| commit    | 内容                                                 |
| --------- | ---------------------------------------------------- |
| `f8decc6` | §6.4 材质改走官方 Texture Set，接通物品 PBR          |
| `635efae` | §6.2 基岩导入网关：导入前校验落地                    |
| `41f30e3` | §7.2 代理层重写：落真配置 + 多子服路由表             |
| `5a3da26` | §7.2 代理层 8 个 kind（**配置格式是假的**，见 §7.9） |
| `27a3553` | DomainSwitcher hover 样式生成                        |
| `335f119` | agent-tools 时序缺陷（mergeFiles 缺 await）          |
| `c7e3060` | Bedrock 环境探测 + 文档 §6.1 纠错                    |

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
   而全部门禁全绿。判据：断言要问「被测行为的**可观测
   副作用**发生了吗」（产物存在 / 脚本写了标记），而不是「函数返回了什么」。
   写完「接线类」改动后，务必造一个**能在磁盘上留下痕迹**的 fixture 跑一遍真链路。
10. **测试解析器必须行尾无关。** 打包守卫测试逐行正则解析 yml，
    `[ \t]*$` 卡不住 CRLF 的 `\r`。一次 `git checkout -- <file>`（autocrlf=true）
    把工作区翻成 CRLF 后用例全红，而文件内容一个字符没变 —— 且在 LF 的 CI 上
    永远是绿的，只有 Windows 本机红。修法：解析前全局去 `\r`。
    教训：凡是自己解析文本的测试，第一行就该归一化行尾。
    同日第二起：`pnpm add` 写 LF → `git checkout` 翻 CRLF → prettier
    `--check` 对 package.json 报 warn（JSON 也卡行尾）。`--write` 归一化后
    磁盘与 blob 逐字节一致才绿。结论：本仓任何“没改却红”的门禁，先查行尾。
11. **`git checkout -- <file>` 会翻转行尾。** 同上 incident：revert 单个文件时，
    checkout 按 autocrlf 重写整个工作区副本。revert 后若有“明明没改却红了”的
    测试，先查行尾（`node -e` 读文件查 `\r\n`），再查逻辑。
12. **全量跑挂一次、重跑即过时，不要硬追。** 某次 `pnpm -r test` 中途 FAIL
    （总数对不上），同命令重跑全绿且无 FAIL 行。可能 flaky（定时器/端口/进程竞态），
    无复现不追查；若同一位置红第二次，就当真 bug 查。记在这里免得下次大惊小怪。

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

1. ~~**§10.0 模型接入层基本没做**~~ ✅ 接口层+真实传输已通：`infer.ts` + `openai-chat.ts`/`zen-free.ts` 传输 + `host.ts` + `agent-host.ts`。DashScope 兼容口（deepseek 系模型）经我方网关实测 ok:true（usage 真实记账）；测试 Key 只活在内存两次，未落仓。Zen 免费通道同样端到端实测通过。
2. **§4.6 / §15 的 electron-updater 灰度更新没有实现** —— 全仓 0 命中，
   只有 E2E 守卫在**确认它不存在**。§4.1 的「单实例锁/深链」未核实。（未动：需产品决策，接更新源即动发布链）
3. **§4.4 指定的 better-sqlite3 + electron-store 都没用** —— 状态持久化实际
   是各自的 JSON store。功能可用，技术选型与文档不符。（未动：迁移存储格式动用户磁盘数据，独立议题）
4. ~~**§8.3「产物哈希供用户审计」没闭环**~~ ✅ 已补：`KernelPanel` 新增“最近构建（只读）” section，经 `get_context_pack` 展示 `lastBuildHash` + isolation 明细（前向兼容）。
5. ~~**§8.3 运行验证缺失**~~ ✅ 已补（见上表阶段 6）。

> 结论更新：**阶段 0-10 接口层全部落地**。剩余是需产品/发布决策的两项
> （更新器、存储选型）+ 真实 LLM 供应商接入（需要 Key 与出境合规决策，见 §10.0 合规开关）。
> §17 闭环场景的链路已通（生成→编译→验证→部署），缺的是真实模型驱动。

## 7.8 真机构建链：干净机器上「生成 → 编译出 jar」实测（2026-10）

**方法**：不跑静态分析，用本仓生成器产出真实工程 + 真下 Gradle + 真跑构建，逐段量断点。

### 量到的阻断链（按发生顺序）

| #   | 阻断                                                               | 原文证据                                                                                                                                                                          | 修法                                            | 修后                                                                                                                                                 |
| --- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Gradle 8.12 **无法在 JDK 26 上启动**（`JAVA_HOME=D:\Java\jdk-26`） | `java.lang.IllegalArgumentException: Unsupported class file major version 70` / `BUILD FAILED in 5s`                                                                              | 宿主 JVM 必须 ≤23                               | 换 JDK 23 后正常启动                                                                                                                                 |
| 2   | toolchain 17 本机无、且无下载源                                    | `No locally installed toolchains match and toolchain download repositories have not been configured` / `BUILD FAILED in 1m 57s`                                                   | `settings.gradle` 加一行 foojay-resolver 0.10.0 | `BUILD SUCCESSFUL in 3m 14s`，Gradle 真下载了 `eclipse_adoptium-17-amd64-windows.2`（`JAVA_VERSION=17.0.20.1+1`），javac 真编译，jar 311 → 1458 字节 |
| 3   | 工程无 `gradlew`/`gradlew.bat`/`wrapper.jar`                       | 4 处 `spawn gradlew.bat`（`devkit/gradle.ts:97`、`core/builder/gradle.ts:26`、`kernel-server/kernel.ts:923`、`desktop/ipc/build.ts:192`），生成器只写 `gradle-wrapper.properties` | **未做**（唯一剩下的硬阻断）                    | 手工下 130MB Gradle 顶上了                                                                                                                           |
| 4   | NeoForge DSL 用了不存在的 `moddev {}` 包装                         | `Could not find method moddev() for arguments [...]` / `BUILD FAILED in 17s`                                                                                                      | 去掉包装，恒用顶层 `neoForge {}`                | 配置阶段通过，`:createArtifactManifest` 真的执行了                                                                                                   |

### 已端到端验证的完整链（Forge 1.20.1，产品真实代码路径）

```
生成器产出工程 → gradle wrapper --gradle-version 8.12 --no-validate-url（补齐 4 个文件）
→ gradlew.bat build → BUILD SUCCESSFUL in 21s
→ jar 1458 字节，内含 com/example/probemod/ProbeMod.class（真编译产物）
```

两个必须记住的陷阱：

- **`gradle wrapper` 默认联网校验 distribution URL**，网络抖就失败：
  `Test of distribution url https://services.gradle.org/distributions/gradle-8.12-bin.zip failed.`
  加 `--no-validate-url` 后 9s 成功，产出 gradlew(8763B) / gradlew.bat(2966B) /
  gradle-wrapper.jar(43583B)。
- **`wrapper` 任务会改写已存在的 `gradle-wrapper.properties`**（509B → 252B）：
  字段功能等价，但说明注释被冲掉、`validateDistributionUrl` 被翻成 `false`。
  bootstrap 因此必须**跑前读入、跑后写回**。

### NeoForge 端到端：**本机无法验证，归因环境，不要再重试**

修掉 `moddev {}` 后构建能跑到 `:createArtifactManifest`，然后卡在下载 NeoForge
本体，**且该 host 从本机不可达**：

```
Could not GET 'https://maven.neoforged.net/releases/net/neoforged/neoforge/21.1.1/neoforge-21.1.1.pom'
Connect to maven.neoforged.net:443 [89.187.187.20, .11, .14, 143.244.51.246, .58]
  failed: Connection timed out: getsockopt
```

直接 HEAD 同一 URL 也在 60s 后超时。**能证明「DSL 修复正确且生效」，不能证明
「NeoForge 工程在本机编得出 jar」。** 别把后者说成验过了，也别为此反复重试 ——
卡点不在代码。

### 第 4 条是本轮最重要的发现：**它被第 3 条挡了**

两个 bug 叠在一起，外层（ENOENT）先死，内层根本没机会求值。而且第 4 条
**不是「忘了写」，是有人特意实现并用 3 个测试钉住的错误分支**
（`neoforge-adapter.test.ts` / `mod-version-matrix.test.ts` / `parchment.test.ts`），
注释还写着「版本感知」。**测试全绿、快照全对、注释自洽 —— 所以静态看永远不会发现。**

判定方式（不靠文档记忆）：应用插件后枚举真实扩展名。

```
ModDevGradle 1.0.21  → EXTNAMES 含 neoForge，HAS_MODDEV=false，HAS_NEOFORGE=true
ModDevGradle 2.0.143 → EXTNAMES 含 neoForge，HAS_MODDEV=false，HAS_NEOFORGE=true
```

两个大版本一致 → 修法是**删掉版本分支**，不是再加一层判断。

**教训：两个 bug 叠着时，先修外层才会暴露内层。「跑一次真机构建」不能省。**

### 只有 Forge / NeoForge 需要 toolchain 解析器

`forge-gradle.ts:73`、`neoforge-gradle.ts:91` 用 `java.toolchain`；
`fabric-gradle.ts:88`、`quilt-adapter.ts:223`、`legacy-fabric-adapter.ts:101`
用 `sourceCompatibility`/`targetCompatibility` —— **不需要**解析器。
给不需要的地方加 resolver 是噪音，刻意没加。

### 预热的价值与形态（§7.8 续，commits `1e9a29b` + `d7fc861`）

同一工程冷启 `3m14s` → 热了之后 `17s`。但**「预热所有组合」是错的方向**，
量了磁盘构成才知道为什么。**下面的绝对值已经失效**（量完几轮后 `~/.gradle`
整个不存在了，本轮产生的缓存全被清掉），**有效的只有比例关系**：

```
（测于本轮中途的相对构成，量完即失效）
  caches/forge_gradle      385 MB   ← 反编译/映射，冷启开销的主要来源（每版本一份）
  jdks                     485 MB   ← foojay 下载的 JDK
  wrapper/dists            144 MB   ← 发行版，已由 gradle-bootstrap 覆盖
  caches/modules-2          99 MB   ← 真正的 Maven 依赖（原来以为的大头，其实是小的）
```

**比例是结论，MB 数已作废**：forge_gradle（反编译）远大于 modules-2（依赖下载），
这才是「预热单个版本 vs 铺满所有版本」的判据。
所以形态定为**用户主动预热单个 MC 版本**：每个版本数百 MB，8 个版本就是数 GB 加数十分钟，不现实。
入口在**设置面板**而非 BuildPanel —— 见下。

### 预热入口为什么不放 BuildPanel（设计陷阱，别改回去）

BuildPanel **不持有 MC/Forge 版本**：它的工程是生成出来的，版本只存在于
`build.gradle` 的**文本**里。要做预热就得去解析用户工程的构建脚本 ——
而那等于把预热对象变成「用户工程」，恰恰是预热必须避免的（会写他的 `build/`、
还可能被算进 `lastBuildHash`）。

解法：入口放设置面板，版本从 `LOADER_VERSIONS` 表出。**预热请求形状里刻意
不含 projectPath**（shared/ipc/build.ts 的 WarmDepsRequest），从**类型上**排除
「误落进用户工程」的可能；devkit 侧还有一道 `isPathInside` 拒绝式守卫。

界面上必须写清两件事，否则是在坑用户：① 代价（数百 MB 磁盘 + 数分钟）；
② **只支持 Forge**（NeoForge 与 Loom 的缓存布局不同，未支持 —— 见下）。

### NeoForge 预热为什么至今没做（已实测，别再重试同样的路）

试过了，**拿不到数据**：NeoForge 只发布在 `maven.neoforged.net`，而这台机器到它
**TCP 连不上**（DNS 正常解析到 `89.187.187.14`，`Test-NetConnection` 结果
`TcpTestSucceeded = False`）。换镜像无效，因为：

| 目标                                           | 结果                        |
| ---------------------------------------------- | --------------------------- |
| `maven.neoforged.net:443`                      | **TCP 连接失败**            |
| 阿里云 maven 镜像                              | DNS 解析失败                |
| 腾讯云 nexus（`net.neoforged` 路径）           | 404                         |
| Maven Central（`net.neoforged` 路径）          | 404（它根本不发在 Central） |
| Gradle Plugin Portal / libraries.minecraft.net | ✅ 200                      |

**Forge 能跑是因为它发在 `maven.minecraftforge.net`（实测可达）** —— 两个 loader
的发布仓库恰好一个通一个不通，纯属这台机器的网络环境。

所以 `neoformruntime` 的**目录名、层级、命中判据全都只能靠猜**。今天所有可信结论
（`moddev {}` 扩展名、`--no-validate-url`、toolchain 机制、预热形态）无一例外是
**跑出来的**。要延续这个标准，就得在能访问 `maven.neoforged.net` 的环境里：
跑一次真实 NeoForge 构建 → 把缓存目录树实测出来 → 再谈预热。

**下一个会话若在可联网环境**：先用 `Test-NetConnection maven.neoforged.net -Port 443`
确认通路，通了就照 §7.8 的 Forge 探针流程复刻一遍（生成器现在输出的是正确的
`neoForge {}` 形状，见 commit `5254dd7`），量出布局再动手。**不通就别猜着写。**

#### 补充（同日）：DNS 是被污染的，且 NeoForge 机制与 Forge 不是一套

三点新证据，都可复现：

1. **不是普通封锁，是 DNS 污染。** 三次 `Resolve-DnsName maven.neoforged.net`
   返回的 IP **每次都不同**（`89.187.187.10/.13/.15/.18` 与 `143.244.51.246/.59` 混杂），
   `Test-NetConnection` 恒 `False`。同一次探测里 `github.com`、
   `maven.minecraftforge.net`、`plugins.gradle.org`、`maven.aliyun.com`、
   `mirrors.cloud.tencent.com` **全部 TCP 通** —— 只有它不通。
   DoH 查真实 IP 这条路也堵死：`cloudflare-dns.com` 与 `dns.google` 的 SSL 都建不起来。
2. **换镜像无效**：`maven.aliyun.com/repository/{public,central}`、腾讯云 nexus、
   华为云 maven 对 `net/neoforged/neoforge/**` 一律 404 —— NeoForge 不发布在那里。
3. **从插件 jar 挖机制**（Plugin Portal 可达，下 `moddev-gradle-1.0.21.jar` 1.29MB，
   解包扫 747 个 class 的常量池）——**这条路绕过了制品不可达，结论是硬证据**：
   - `dsl.NeoFormRuntime` 上有 **`neoForge.neoFormRuntime.enableCache`**：
     缓存是**显式 DSL 开关**，不是自动生效的。
   - `internal.CreateMinecraftArtifactsTask` 把它当**命令行参数传给外部进程**：
     `--neoform` / `--disable-cache` / `--analyze-cache-misses`。
     即 Minecraft 工件由 **NeoFormRuntime 外部进程**产出并缓存，
     **缓存生命周期握在那个进程手里，不在 `~/.gradle/caches/` 的常规布局里**。
   - `ModDevPlugin` 里另有 `java-runtime`、`neoforge-`、`modDevBuildDir`、
     `build/minecraft-junit` 等字面量。

**因此即使网络通，也不该照抄 Forge 那套**：Forge 的 `~/.gradle/caches/forge_gradle`
是「跑一次就留下」，预热就是提前填满；NeoForge 是「显式开关 + 外部进程 + 另一套落点」。
要预热很可能得**先改用户 build.gradle 打开 `enableCache`** —— 那是替用户改构建语义，
不是我方能悄悄做的决定。**先确认预热有没有意义，再谈怎么做。**

### 写渲染层测试踩的三个坑（都不是代码 bug，是测试写法）

1. **jsdom 没有 `matchMedia`** → 组件挂载即 TypeError，多条用例一起红且看不出是哪条
   （本仓 `themes.ts:296 getEffectiveMode` 读系统配色）。
2. **主进程 push 触发的 setState 必须包 `act()`** —— React 18 会把更新排队不提交，
   断言看到的是旧树，报错是「找不到元素」，完全指不到真因。
3. **mock 返回形状必须先读消费点的解构**：`SettingsPanel.tsx:245` 读 `r.profiles`，
   我返回 `[]` → `setProfiles(undefined)` 抛 TypeError，而它**发生在测试之外的微任务里**，
   vitest 报成 "5 unhandled rejections"，把真正的断言结果全盖住，还害我差点把锅甩给
   无辜的 `process-supervisor.test.ts`（单跑却是 145 passed）。
   **教训：看到「别处坏了」先怀疑自己的 mock 形状。**

## 7.7 规格闭环点火（L2，commit `ffb87d8`）：真模型一轮过的三个真 bug

链路：`AgentPanel`「AI 闭环生成」→ IPC `agent:run-loop` → `runClosedLoop`
（Zen 免费通道）→ 真 `validateDatapack` → 合法 spec 经 `setSpec` 落编辑器。

### 第一次点火：三轮全废（abort）

| 轮  | 症状                                                                         |
| --- | ---------------------------------------------------------------------------- |
| 1   | `recipes.0.ingredient: Expected string, received object`                     |
| 2   | `recipes.0.result: Expected string, received object`（修了上一处，撞下一处） |
| 3   | `模型输出中没有配平的 JSON 块` → abort                                       |

看起来像「免费模型不行」，实际**三个 bug 全在代码里**：

1. **prompt 规格与 schema 相反。** `key` 的值是**字符串数组**
   （`{"R":["minecraft:redstone"]}`），我写成了对象；`ingredient`/`result`
   是**纯字符串**，我根本没写这句。模型照错规格生成，validate 当然全红。
   → 加最小合法样例（形状以此为准）+ 点名「key 值是数组不是对象」。
2. **我邀请模型写太长。** 我列了 30+ 个「选填数组」，模型全填。免费通道
   实测 `completion_tokens=14097` 里 **`reasoning_tokens=11991`** —— 推理
   吃掉 85%，正文被截断成半个 JSON。
   → 加「只写真正用到的字段，不写等于空数组，不要为完整而填满」。
   → 加「修复轮只改被点名的那一处，已正确的字段原样照抄」（治 whack-a-mole）。
3. **截断被误诊成形状错。** detail 写「没有配平的 JSON 块」，修复轮就去
   改形状，而真因是写太长 → 白烧一轮。
   → 现在按「JSON 未闭合」判定为**截断**，detail 明说「不是形状错，应缩短内容」。

### 第二次点火：一轮过

```
[agent-loop] stage=generate ok=true attempts=0 next=validate
[agent-loop] stage=validate ok=true attempts=0 next=succeed
ok = true   attempts = 0   elapsed = 3279 ms
```

### 关于 `max_tokens` 的实测（别再试这条路了）

| max_tokens | content 字数 | finish | completion | reasoning |
| ---------- | ------------ | ------ | ---------- | --------- |
| 不传       | 6917         | stop   | 14097      | 11991     |
| 16384      | **0**        | length | 16384      | 16381     |
| 24576      | 1552         | stop   | 5389       | 4979      |

给上限**不会**让正文变多，只会让推理吃光预算返回空串。解法只能是
**减输出量**（少填字段 + 给样例），不是调 `max_tokens`。

### 单轮超时提到 5 分钟

默认 `DEFAULT_INFER_TIMEOUT_MS`=120s，免费慢模型单轮实测可达 60s+
（修轮曾直接撞死超时）。闭环是后台任务、用户不等交互响应，宁可等足。
这是**调参不是绕过**：超时仍在，只是阈值对齐真实上界。

### 这轮的通用教训

**「模型不行」几乎总是「我的 prompt 与 schema 不一致」。** 先去核对 schema
真身（`packages/shared/src/schemas/datapack-spec.ts`），再怀疑模型。

---

## 7.9 §7.2 代理层：上一版是假实现，已按官方文档重写（commit 见 §1）

### 上一版错在哪（自己审出来的，不是被测出来的）

commit `5a3da26` 给 §7.2 代理层加了 8 个 kind + 8 个方法，测试全绿。**但测试只验了
「自己造的东西能被自己读回来」，没验「产物是不是代理真读的东西」**：

| 上一版                                             | 问题                                                              |
| -------------------------------------------------- | ----------------------------------------------------------------- |
| `config.json`，键 `proxyType`/`port`/`bindAddress` | **三个都不是任何代理的真实键**，代理根本不读这个文件              |
| 无路由表                                           | §7.2 对代理层的定义是「独立网络层，处理多子服路由」，**全没实现** |
| `startProxyServer` 硬编码 `java -jar velocity.jar` | bungee/waterfall 也返回这条命令，三种形态没区别                   |
| 无校验                                             | 空 `backends`、地址非法、重名、`try` 引用不存在子服，全放行       |

**教训（补 §10-9 同族）：绿测试不等于对的东西。** 当实现是「按想象造格式」时，
把它的输出读回来的测试**必然**是绿的，因为它验证的是自洽性而非正确性。
判据要落在**外部权威**上——这也是 §6.1 `Minecraft for Windows` 那次翻车的同源问题。

### 重写后的形态（键名出处，不是记忆）

| 形态       | 文件            | 格式 | 路由表                              | 路由顺序                 |
| ---------- | --------------- | ---- | ----------------------------------- | ------------------------ |
| velocity   | `velocity.toml` | TOML | `[servers]` 段 `name = "host:port"` | 顶层 `try = [...]`       |
| bungeecord | `config.yml`    | YAML | `servers.<name>.address`            | `listeners[].priorities` |
| waterfall  | `config.yml`    | YAML | 同 bungeecord                       | 同 bungeecord            |

出处（都已实抓，不是凭记忆）：

- **Velocity**：<https://docs.papermc.io/velocity/configuration>
  原文明确 “Every Velocity file is stored in velocity.toml … Velocity uses the
  TOML file format”，并列出 `servers` section、顶层 `try` Array、`bind`、`motd`、
  `show-max-players`、`online-mode`。
- **BungeeCord**：<https://www.spigotmc.org/wiki/bungeecord-configuration-guide/>
  贴出完整默认 `config.yml`，其中 `listeners` 是**列表**、`servers.<n>` 是带
  `address` 的映射、路由顺序在 `listeners[].priorities`（**不是**顶层 `try`）。

**最易错的一点**：`try` 必须落在 `[servers]` 段**之前**。TOML 里进了段之后的裸键
归属该段，放到段后会变成 `servers.try` —— 等于凭空多一个名叫 `try` 的后端。
而上游默认配置又把 `try` 放在文件**末尾**（已在 `[query]` 之后），所以**解析时
`try` 必须按键名认、不看当前段**。两个方向的坑各踩了一次，都是被自己写的测试
（`try` 位置断言 + 上游默认配置往返）钉住的，不是靠想。

### 代码位置与新增依赖

- `packages/kernel-server/src/proxy-config.ts`（新）：渲染 / 解析 / 校验三层，
  纯函数无 I/O。解析失败一律抛 `ProxyConfigParseError`，内核转 `validation`
  ——**不做乐观回退**（同 kernel-bedrock/probe.ts「存在≠可读」的纪律）。
- `packages/kernel-server/src/proxy-config.test.ts`（37 例）：键名快照 + 三形态
  往返 + **真实上游默认配置**（Velocity 官方 toml、BungeeCord 官方 yml）解析。
- `packages/kernel-server/src/proxy-execute.test.ts`（31 例）：内核任务面。
- **新增依赖 `yaml@2.9.0`**（lockfile 里已有，是 eslint 的传递依赖；
  `pnpm add` 实测 `downloaded 0`，纯离线链接，不引入新下载）。
  Velocity 用 TOML、仓里无 TOML 库，故 TOML 侧手写子集解析（只认官方列出的键，
  `[advanced]`/`[query]` 等无关段跳过；多行数组支持，因为上游 `try` 就是多行的）。

### 变异测试（四条，全部 RED 证明断言咬得住）

| 变异                                               | 结果     |
| -------------------------------------------------- | -------- |
| `bind` → `bindAddress`（自造键回归）               | RED      |
| `try` 移回 `[servers]` 段之后（TOML 语义错）       | RED      |
| `try` 改为按当前段判定（上游末尾布局会丢路由顺序） | RED      |
| create 的 `validateProxySpec` 去掉                 | RED (3)  |
| list 里吞掉单代理解析错误                          | RED      |
| 回落写 `config.json`（回到假格式）                 | RED (13) |

### 遗留（不猜）

代理官方 jar 的下载源未接：Velocity 走 `https://api.papermc.io/v2/projects/velocity`，
BungeeCord/Waterfall 走各自 API —— **这些 API 本轮未实测可达**，故 `start` 只返回
控制指令（与既有 `controlServer` 同口径，§7.1 进程生命周期不归内核），不自动下载。

---

## 7.10 §6.2 基岩导入网关：导入前校验落地（commit `635efae`）

### 做了什么

`packages/kernel-bedrock/src/import-gateway.ts`（新，纯函数无 I/O）：格式识别 +
三条导入前校验。**落位/解压不在这一层**，那是内核 install/import 任务的事。

出处（实抓，非凭记忆）：
<https://learn.microsoft.com/en-us/minecraft/creator/reference/content/addonsreference/packmanifest>
—— "Add-Ons Reference: manifest.json"，`ms.date 2025-08-04`，`updated_at 2026-04-21`。

### 官方事实要点（逐条对照原文，不是记忆）

| 事实                                                                                        | 原文依据                                                                                                |
| ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `format_version`：**1 用于 skin packs**；2 用于 resource·behavior·world template；3 preview | "This may be 1 for skin packs or 2 for resource, behavior, and world templates"                         |
| `min_engine_version` 对 resource/behavior **必填**                                          | "This is a required field for resource and behavior packs"                                              |
| `version` 覆盖语义：**更高才替换，同级或更低被忽略**                                        | "The new pack will replace the old one if the version is higher, and ignored if it's the same or lower" |
| `modules[].type`：`resources`/`data`/`world_template`/`script`                              | 官方枚举表                                                                                              |
| `modules[].language` 只在 `script` 时出现，**唯一支持值 javascript**                        | "The only supported value is `javascript`."                                                             |
| `capabilities`：`chemistry`/`editorExtension`/`experimental_custom_ui`/`raytraced`/`pbr`    | 官方枚举表                                                                                              |

### 修掉的一处过宽判定

`header.uuid` 本仓 `kernel.ts` 原用 `UUID_RE = /^[0-9a-fA-F-]{32,36}$/`
（"32/36 位十六进制或带连字符"）——**那会放过 `----------------` 这种零连字符串**。
导入网关里收严到官方形状 `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`（x 为十六进制，
大小写都接受，因为 Windows 工具链产出过大写）。

### 不做的一条（不猜）

§6.3 写「实验性 API 需在 manifest 声明」，**本轮不加这条校验**。官方参考里稳定通道的
依赖就是 `dependencies[].module_name = "@minecraft/server" + version`；而 beta 模块
（如 server-gestures）走 `@minecraft/server-<version>-beta` 形式的 module_name。
**哪些模块在哪个版本转入 beta 是游戏版本事实、随版本变动**，不在本仓静态判定范围 ——
硬编码一张 beta 列表就是猜，且必然随游戏更新过期。

### 测试与变异

`import-gateway.test.ts` 38 例，含**官方 Behavior Pack / Resource Pack 示例逐字解析**
（不只测我方生成物）。变异三条全 RED：uuid 判定退回旧宽松正则、兼容方向反转、
`format_version===1` 语义错成 `===2`。

门禁：321 files / 5435 passed + 43 skipped，typecheck 0，lint 0 errors，check-docs exit 0。

---

## 7.11 §6.4 / §5.5 材质：改走官方 Texture Set（commit `f8decc6`）

### 文档的一处措辞会误导实现

§6.4 原话是「无光影系统，替代物为 **RTX**：MER 贴图（Metalness/Emissive/Roughness）」。
**「MER 贴图」不是 Bedrock 的机制** —— Bedrock 走 **Texture Set**（`*.texture_set.json`），
MER 只是 texture_set 里的一层。本仓此前只生成 `textures/items/<id>.png`（纯色/渐变），
**没有 texture_set.json**，也就是产物在 Vibrant Visuals / RTX 下拿不到任何材质信息。
→ 与 §7.9 同一个病根：**按文档的笼统措辞造了个近似物，而不是去查真实机制**。

出处（实抓）：
<https://learn.microsoft.com/en-us/minecraft/creator/reference/content/texturesetsreference/texturesetsconcepts/texturesetsintroduction>
—— "Texture Set JSON and Introduction to Texture Sets"，
`ms.date 2025-05-28`，`updated_at 2025-12-03`，**schema 版本标注 1.21.30**。

### 按官方「Invalid」清单逐条校验（游戏真会拒绝的那批）

| 规则                                                                        | 官方依据                                                                          |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `color` 是**唯一必填**层，也是 Classic 管线唯一用到的层                     | "This is the only required layer."                                                |
| `normal` 与 `heightmap` **互斥**                                            | 两处分别写明 "should not both be defined"                                         |
| `heightmap` 单通道，且**不得用于 texture-based object**（物品）             | Caution 段                                                                        |
| `MER` 与 `MERS` **互斥**                                                    | "should not be defined at the same time"                                          |
| MER 通道 **R=Metalness, G=Emissive, B=Roughness**；MERS 的 **A=Subsurface** | Layers 段                                                                         |
| MERS **只被 Vibrant Visuals 支持，RTX 下 subsurface 被完全忽略**            | "not supported in RTX and any provided subsurface values will simply be ignored." |
| texture_set **只能引用同包贴图**                                            | "can only reference images that exist in the same resource pack"                  |
| 重复图片引用优先级 **`.tga > .png > .jpg > .jpeg`**                         | 官方明文                                                                          |
| 非法则记 `CONTENT_ERROR` 且**整份定义不被使用**                             | "Invalid *.texture_set.json" 段                                                   |

最后一条是关键：**非法 texture_set 是静默失效**，所以本模块校验失败直接抛，
不落一份会被游戏丢弃的文件。

### 不猜的一处（显式记录缺口）

官方**没规定**「字符串恰好形如 2 位十六进制」该按均匀值还是按贴图名解释。
本模块**取并集**（任一成立即合法），不自行发明优先级 —— 并有测试把这条缺口钉住，
免得日后有人以为已经消歧。

### 接线与「不猜材质」

`BpItemEntrySpec` 新增可选 `pbr`（metalness/emissive/roughness 0-255 + 可选 normal）。
**不声明就不产 texture_set.json**，也**不按贴图主色猜材质** —— 猜出来的 MER 会让用户
看到「我生成了金属剑却不像金属」且查不出原因。

变异五条全 RED：schema 版本、`normal`/`heightmap` 互斥、平局偏向 subsurface、
扩展名优先级、MER 通道顺序。

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
   **本轮再撞一次**：`feat(desktop): AI 规格闭环点火…` 被拒 —— 冒号后的
   **第一个 token** 是拉丁大写（AI）就按 pascal-case 判，不是「整句开头」。
   正确写法 `feat(desktop): 规格闭环点火（真模型一轮过）`。正文不受此限。
4. **`git commit` 失败后lint-staged 会留 `stash@{N}: lint-staged automatic
backup`**。不要盲删 stash 区，尤其指向旧 commit 的那些。
5. `E:\Cache\temp\opencode` 是已批准的临时目录，探针/临时产物放那里，
   **不要留在仓库内**。
6. **Windows PowerShell 读无 BOM 的 UTF-8 `.ps1` 会按 ANSI 解析**，中文注释会把
   脚本语法搞崩（报 `ParserError` 且**行号指向数组右括号，完全误导**）。
   临时 `.ps1` 一律**纯 ASCII**（中文写进同目录的 `.md`）——和 `packages/jobobject`
   「源文件纯 ASCII」是同一条规矩。
7. **Gradle 往 stderr 写 JVM 警告会让 PowerShell 管道直接中断**
   （`NativeCommandError`），表现为「命令失败」而 Gradle 其实刚启动。
   跑 Gradle 一律 `cmd /c "xxx.bat ... > log 2>&1"`，别用 `| Tee-Object`。
8. **这台机器连不上 `github.com` 的 release 资产，也连不上 `maven.neoforged.net`。**
   `github.com:443` TCP connect timeout（重试多次一致；`api.github.com` 正常）；
   `maven.neoforged.net:443` **TCP 连接失败**（DNS 正常，`TcpTestSucceeded=False`）。
   **可用的下载通道（实测 2026-10）**：
   - Gradle 发行版 → `https://mirrors.cloud.tencent.com/gradle/gradle-<ver>-bin.zip`
     （130MB / 53s；`downloads.gradle.org` 不通，阿里云 404）
   - JDK → `https://aka.ms/download-jdk/microsoft-jdk-<N>-windows-x64.zip`
   - 通：`api.github.com`、`plugins.gradle.org`、`libraries.minecraft.net`、
     `maven.minecraftforge.net`、`services.gradle.org`（校验用）
   - 不通：`github.com` release 资产、`maven.neoforged.net`、`mvn.aliyun.com`（DNS）
     未解之谜：Gradle 8.12 **不认**手动下载的 JDK 21（`gradle.properties` 与
     `-Dorg.gradle.java.installations.paths` 两种方式都试过，均未出现在
     `javaToolchains` 输出里，尽管 `release` 文件与 `bin/javac.exe` 都正常）。
     **原因未查清，不要当成 Gradle 的 bug 下结论。**
9. **量磁盘/文件大小要在动作前一刻量，别把半小时前的数当现状。**
   本轮**同一个坑踩了两次**：
   ① 清理探针时：删除时每个目录实测 **0 files**，而半小时前量它们是 846MB
   （gradle-8.12 130MB、jdk21 192MB 都真读到过）；
   ② 更糟：我接着对用户说「`~/.gradle` 1.2GB 没动」——**没重测**，
   下一轮实测 `C:\Users\Administrator\.gradle` **根本不存在**，全盘也搜不到。
   中间隔了几轮 + 一次命令超时中断，内容已被清空。同类坑还有 §4 那条「行尾」。
   **环境会漂移，证据有时效；报数字前重测，MEMORY 里存的比例关系比绝对值可靠。**
