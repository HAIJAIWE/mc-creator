## 10. 智能体层

### 10.0 模型接入层（架构前置，勿省略）

- **后端双通道**：内置默认供应商 + **BYOK（用户自带 Key / 自建 OpenAI 兼容端点）**
- **密钥安全**：LLM 凭据一律走 OS 级加密（Electron `safeStorage`），禁止明文落 json / 日志 / 遥测（对齐 §13.2）
- **推理网关**：统一 `infer(messages, tools, budget)` 接口，内置重试 / 限流 / 超时 / 多模型路由 / 流式输出
- **能力分级**：按任务复杂度路由（生成走强模型，校验 / 摘要走廉价模型）
- **失败降级**：超时或超预算 → 降级模型或转人工确认（对齐 §10.5）
- **合规开关**：生成内容是否出境 / 是否用于训练，作为企业采购选项（对齐 §21）

### 10.1 技术选型

- **协议**：MCP（Model Context Protocol）TypeScript SDK
- **传输**：Streamable HTTP（生产）/ stdio（本地工具）
- **编排**：轻量 SDK 级（单轮 + 工具调用为主），**不使用图状态机**
- **位置**：独立进程，长任务不随窗口关闭终止
- **工具设计**：能力只实现一次，同时暴露 IPC（UI）与 MCP（智能体）

### 10.2 MCP 工具清单（示例）

```
【读现状 —— 闭环必需，缺失则智能体只能盲生成】
get_capabilities(edition)                        R ← 强制第一步
list_versions(edition)                           R
get_target_state(target)                         R ← 已装内容/配置/上次构建产物与失败原因
read_config(target, scope)                       R
read_logs(target, filter)                        R
search_content(kind, query, edition, cursor)     R ← 支持分页/游标
list_instances() / list_servers()                R
get_context_pack(target)                         R ← 见 §10.4 状态注入

【内容装配 —— 写实例目录】
install_modpack(ref, target)                     W
install_mod(ref, target)                         W ← Java
install_addon(ref, target)                       W ← Bedrock
import_package(path, target)                     W ← .mcpack/.mcaddon/.mrpack
apply_skin(skinRef, target)                      W
uninstall_content(ref, target)                   W

【执行与运维 —— 必须弹窗确认】
launch_instance(instanceId)                      X
create_instance(spec) / delete_instance(id)      X
build_project(projectRef)                        X ← devkit
deploy_plugin(projectRef, serverId)              X
restart_server(serverId) / stop_server(id)       X
rollback_build(projectRef)                       X

【生成与校验】
generate_content(prompt, kind, edition, version) X
validate_content(path, edition, version)         R

（R=只读免确认 / W=写实例可配置免确认 / X=执行进程须弹窗，对齐 §10.6）
```

### 10.3 生成闭环与成功判据

```
生成 → 装载 → 验证 → 日志诊断 → 错误回灌修复
```

**「验证」必须机器可判定，否则自动循环不知该停还是该改：**

| 产物           | 成功信号（机器可判定）                                   |
| -------------- | -------------------------------------------------------- |
| 数据包         | `/reload` 无报错 且 `/datapack list` 含目标命名空间      |
| Bedrock Add-on | `manifest` 校验通过 且 事件回调触发（脚本日志出现）      |
| Paper 插件     | 日志出现启动完成标志 且 插件 `enabled`（无 `Exception`） |
| 服务端 Mod     | 无 `FATAL` / `Exception` 且 端口监听成功                 |
| 客户端 Mod     | 日志无崩溃 且 目标功能可观测（需图形环境，成本最高）     |

> 单圈成本：数据包 / 基岩秒级，插件十秒级，Mod 分钟级 → 迭代轮次随之递减。

### 10.4 上下文注入（强制）

- 版本号 / `pack_format` / 加载器版本 / 映射版本 ← **运行时从官方源拉取**
- 生成时按目标注入对应 API 的类型定义：
  - Java 数据包 → **Sandstone** 类型
  - Bedrock → **@minecraft/server** 类型
  - Paper 插件 → Paper API（含 Folia 兼容标记）
  - 模组 → 对应加载器 + 映射类型
- **状态注入 `context_pack`（闭环强依赖）**：每轮生成前注入 `get_context_pack(target)` 的运行时状态——
  当前实例已有 mod / 服务端插件与配置 / 上次构建产物与哈希 / 历史失败原因 / 目标平台（是否 Folia）——
  并按 token 预算截断，避免长上下文爆炸

### 10.5 成本控制

- 每会话 **token 预算上限 + 轮次上限**
- 类型定义与 manifest 走**提示缓存**（prompt caching）
- 超预算自动降级到更便宜模型或转入人工确认

### 10.6 权限分级

| 级别                               | 操作               | 确认要求         |
| ---------------------------------- | ------------------ | ---------------- |
| 只读                               | 查询、搜索、读日志 | 免确认           |
| 写入实例目录                       | 装模组、改配置     | 可配置为免确认   |
| 执行进程 / 写实例目录外 / 修改账户 | 编译、部署、启动   | **必须弹窗确认** |
| 网络出站                           | HTTP 请求          | 白名单域         |

---
