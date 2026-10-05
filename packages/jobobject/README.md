# @mc-creator/jobobject

Windows **Job Object** 原生绑定 —— 落地设计文档 §8.3 的「进程级隔离」。

> 面向人的设计说明在本文；C++ 源文件 `src/binding.cc` **刻意只用 ASCII**，
> 原因见该文件头部注释（MSVC 按系统代码页读源文件，中文注释会被误判成行尾
> 续行符并吞掉后面的 `#endif`）。

---

## 1. 为什么需要它

§8.3 的约束原文：

> JDK 17 起 SecurityManager 被标记为待移除，JDK 24 已永久禁用
> → 无法在进程内沙箱化 Java 代码
> → **必须使用进程级或容器级隔离**

Node 的 `child_process` 不提供任何资源上限接口。所以两件事必须落到 Win32：

| 需求               | Win32 机制                                                  |
| ------------------ | ----------------------------------------------------------- |
| 内存硬上限         | `JOB_OBJECT_LIMIT_PROCESS_MEMORY`                           |
| CPU 配额           | `JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP`                      |
| 整棵进程树可靠终止 | `TerminateJobObject` / `JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE` |

## 2. 为什么是 N-API

仓里的 `isolated-vm` 曾在 Electron 44 上**一次都没加载成功**（MEMORY §2-③）：

- 它用裸 V8 ABI，预编译只到 `abi147`，而 Electron 44 是 `abi149` → require 必抛；
- 且那段"沙箱脚本"本身就是 TypeScript，即便模块能加载也必然 `SyntaxError`。

本模块用 `node-addon-api`（N-API），**ABI 跨 Node/Electron 稳定**，预编译文件名
不带 abi 标签即可通用。这与仓里已在 Electron 44 上正常工作的 `node-pty` 是同一套
机制（见 `apps/desktop/electron-builder.yml` 里 `npmRebuild: false` 的说明）。

## 3. 为什么必须由本模块自己 `CreateProcess`

直觉做法是「JS 先 spawn，再按 pid `AssignProcessToJobObject`」。这条路有 **TOCTOU
窗口**：子进程在被纳入 job 之前已经能执行指令，恶意构建脚本可以在最初几毫秒内
spawn 一个**不在 job 内**的孙进程 —— 它既不受内存/CPU 上限约束，也不会被整树
终止一并杀掉。

**子进程一旦在 job 内，其后代由内核自动继承进同一个 job。** 所以唯一能消除窗口的
做法是把分配放在第一条指令之前：

```
CreateProcess(CREATE_SUSPENDED) → AssignProcessToJobObject → ResumeThread
```

这就是 `spawnInJob` 的实现。

> 一个能被绕过的隔离，和「未加固的回退路径」是同一类缺陷（MEMORY §2-④）。

## 4. 为什么多一层 `launcher.js`

原生模块**不接管子进程管道**（`bInheritHandles=FALSE` 且不重定向标准句柄），
因为在 C++ 里造管道再把句柄塞回 Node 既难测又脆。

但 Gradle 构建必须要日志（`findJarInLog` 回退、错误文案、`build_project`
进度事件全靠 stdout/stderr）。于是：

```
上层（已测的 spawn 逻辑） ──管道──> launcher.js ──继承 stdio──> gradle
                                   └─ 在 job 内 suspended-create ─┘
```

日志照常回到上层，隔离由 job 保证。

**顺带得到一个比 `taskkill /t /f` 更强的终止保证**：launcher 一死 → job 句柄随进程
关闭 → `KILL_ON_JOB_CLOSE` 触发 → 整棵树（含所有孙进程）被**内核**终止。不依赖
外部工具是否存在，也不受 pid 复用影响。

## 5. 降级契约（重要）

`scripts/install.js` **永远 exit 0**：编不出来不是错误（多半是那台机器没装 MSVC），
降级才是正确行为。`index.js` 相应地**在 import 时永不抛错**，只暴露：

```js
{ available, supportedPlatform, reason, binaryPath, ... }
```

`available === false` 时调用任一 API 会抛出**带 `reason` 的中文错误**。

### ⚠️ 网络隔离仍未强制

**Job Object 无法禁止网络访问。** 即使原生绑定齐全，§8.3 的「禁用网络出站」仍需
Windows 防火墙按程序规则（要管理员权限）或容器级隔离。所以本模块交付后：

| 约束                    | 状态                                      |
| ----------------------- | ----------------------------------------- |
| cwd jail / 路径逃逸防护 | ✅ `devkit` 的 `assertWithinRoot`         |
| 墙钟超时 + 杀整棵树     | ✅ 本模块（且比 taskkill 更强）           |
| 内存上限                | ✅ `JOB_OBJECT_LIMIT_PROCESS_MEMORY`      |
| CPU 配额                | ✅ `JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP` |
| env 白名单              | ✅ 执行器侧过滤                           |
| **禁用网络出站**        | ❌ **未强制**（需防火墙规则或容器）       |

执行器会把这一项如实标成 `enforced.network = false` 并向上暴露，**不假装已隔离**。

## 6. 实测证据（本机真跑，非静态分析）

| 断言                        | 实测                                                                 |
| --------------------------- | -------------------------------------------------------------------- |
| 纯 N-API addon 在本机可编译 | node-gyp v12.4.0 + MSVC + Python 3.14 → `jobobject.node` 166 KB      |
| `spawnInJob` 非阻塞         | 返回耗时 28 ms                                                       |
| 子进程确实在 job 内         | `isInJob = true`                                                     |
| 超时不误杀                  | `waitForExit(500ms)` 对 60s 子进程 → `timedOut: true, exited: false` |
| **内存上限真被强制**        | 96MB 上限下狂分配 → 58 ms 内以 `ERR_MEMORY_ALLOCATION_FAILED` 终止   |
| **孙进程继承 job**          | 父 + 孙均存活时一次 `terminateTree` → 两者皆死                       |

## 7. 构建产物从哪来

本包**没有 registry 可发预编译产物**，所以按「安装时编译 + 缺失则降级」：

```bash
pnpm --filter @mc-creator/jobobject build:addon   # 改了 C++ 之后强制重编
```

加载顺序：`prebuilds/<platform>-<arch>/` → `build/Release/` → `build/Debug/`。

> 装载器扫描顺序里 `prebuilds` 在前，是为将来「提交预编译二进制」这条路线留的
> 插口：那时无需改任何调用方代码。
