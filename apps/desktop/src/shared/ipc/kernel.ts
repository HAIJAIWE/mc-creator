import { z } from 'zod';

/**
 * 内核 IPC 契约（外壳 ↔ 内核，§4.2 / §10.2 / §10.6）。
 *
 * ## 这个文件是「哪些 kind 可以从渲染层触达」的唯一真相源
 *
 * `KERNEL_READ_KINDS`（R 类，只读免确认）会**同时**被三处消费，任何一处漏改都会
 * 变成安全洞或死代码，所以刻意只定义一次：
 *  1. `src/main/ipc/kernel.ts` —— 注册 `kernel:read` 通道时用它做白名单（zod enum）；
 *  2. `src/main/kernel-runtime.ts` —— 判断某 kind 是否属于「渲染层可达集合」；
 *  3. `src/preload/index.ts` —— 通道本身（不含 dispatch 透传）进 contextBridge 白名单。
 *
 * ## 为什么只暴露读通道，不把 `dispatch` 原样透传
 *
 * 内核的 `dispatch(task)` 是一个**无鉴权的万能入口**：传什么 kind 就跑什么 kind。
 * 把它接到渲染层等于把 `delete_instance` / `rollback_build` 这类 X 类操作和
 * `get_capabilities` 摆在同一个按钮后面 —— §10.6 的确认闸门虽然仍在主进程侧，
 * 但「整个内核面」就这么暴露给了一个可能存在 XSS 的渲染进程，违反 §4.3 白名单原则。
 * 所以这里显式枚举允许的 kind，未列入者由 `kernel:read` 直接拒绝。
 *
 * ## W/X 类为什么单列一个「主进程侧」通道
 *
 * `KERNEL_WRITE_KINDS` 是 §10.2 里的写实例 / 执行进程类 kind。它们**已实现**、
 * 也**已接线**（走 `kernel:execute`，同样过 §10.6 确认闸门），但
 * `KERNEL_EXECUTE` **刻意不进 preload 的 contextBridge 白名单**：
 * 门控弹窗的呈现与错误分类还没在 UI 上验证过，先只在主进程侧可达并测透。
 * 详见 `src/main/ipc/kernel.ts` 的注释。
 */

/** 本仓装配的三内核（§2.2：Java 必装，服务端/Bedrock 可选；devkit 尚未接线）。 */
export const KERNEL_EDITIONS = ['java', 'server', 'bedrock'] as const;
export const KernelEditionSchema = z.enum(KERNEL_EDITIONS);
export type KernelEditionT = z.infer<typeof KernelEditionSchema>;

/** §10.6 权限分级（R 只读 / W 写实例 / X 执行进程）。 */
export const KernelPermissionSchema = z.enum(['R', 'W', 'X']);
export type KernelPermissionT = z.infer<typeof KernelPermissionSchema>;

/** §10.6 风险等级：write=写实例目录；execute=执行进程 / 改实例目录外。 */
export const KernelRiskSchema = z.enum(['write', 'execute']);
export type KernelRiskT = z.infer<typeof KernelRiskSchema>;

/**
 * 渲染层可达的 kind（全部是 §10.2 清单里的 **R 类**）。
 *
 * 逐条依据（不是「顺手把所有能跑的塞进来」）：
 * - `get_capabilities`（java/server/bedrock）§10.2 标注「强制第一步」，且内核实现里
 *   三个 dispatch 都直接透传 `capabilities()`，零副作用。
 * - `list_instances`（java）只读 `<dataDir>/instances/` 的子目录名；目录不存在返回
 *   空数组不报错 —— 是 UI「实例列表」唯一的真实来源。
 * - `list_servers`（server）§10.2 与 `list_instances` 并列；但**三内核都没有实现
 *   `list_servers` 这个 kind**（server 内核 dispatch 只实现 get_capabilities /
 *   read_logs / read_config / get_context_pack），所以由外壳侧按同一套目录事实
 *   推导，不臆造内核 kind。见 main/ipc/kernel.ts 的实现注释。
 * - `read_logs` / `read_config`（server）读文件尾部与 server.properties，纯读。
 * - `get_context_pack`（java/server）§10.4 状态注入，内核只给磁盘事实。
 * - `get_target_state`（bedrock）探测 com.mojang 内容目录，纯读。
 * - `validate_content`（bedrock）§10.3「验证必须机器可判定」，只校验 manifest 结构。
 *
 * **刻意不暴露**：`list_versions` / `search_content` —— §10.2 列了它们，但三内核都
 * 没有对应实现（agent 层的 MCP 通道同样把它们标成 `unimplemented`）。暴露一个只会
 * 稳定返回「不支持的任务」的通道没有意义，等内核真的实现了再加。
 */
export const KERNEL_READ_KINDS = [
  'get_capabilities',
  'list_instances',
  'list_servers',
  'read_logs',
  'read_config',
  'get_context_pack',
  'get_target_state',
  'validate_content',
] as const;
export const KernelReadKindSchema = z.enum(KERNEL_READ_KINDS);
export type KernelReadKindT = z.infer<typeof KernelReadKindSchema>;

/**
 * W/X 类 kind：已接线、只在**主进程侧**可达（`kernel:execute`，不进 preload 白名单）。
 *
 * 依据 §10.2 的「内容装配 / 执行与运维 / 生成」三组，全部经内核的 confirm 闸门
 * （§10.6）。`generate_content` 只有 bedrock 内核实现了 `validate_content` 的
 * 同族分支，`generate_content` 本身在 bedrock 里是 X 类。
 */
export const KERNEL_WRITE_KINDS = [
  'install_modpack',
  'install_mod',
  'install_addon',
  'import_package',
  'apply_skin',
  'uninstall_content',
  'launch_instance',
  'create_instance',
  'delete_instance',
  'build_project',
  'deploy_plugin',
  'restart_server',
  'stop_server',
  'rollback_build',
  'generate_content',
] as const;
export const KernelWriteKindSchema = z.enum(KERNEL_WRITE_KINDS);
export type KernelWriteKindT = z.infer<typeof KernelWriteKindSchema>;

/** 主进程侧可达的全部 kind（读 + 写）。渲染层只允许读。 */
export const KERNEL_ALL_KINDS = [...KERNEL_READ_KINDS, ...KERNEL_WRITE_KINDS] as const;

// ---------------------------------------------------------------------------
// 请求
// ---------------------------------------------------------------------------

/** 非空字符串 + 长度上限：所有「标识类」入参的统一门槛（防超长/空白串）。 */
const IdString = z.string().trim().min(1).max(128);

/**
 * 标识符额外禁止路径分隔符与 `..`。
 *
 * 内核侧（server 的 serverIdOf / java 的 instanceId）本来就会拦，但这层是** IPC 边界**：
 * 白名单通道的入参必须自己拒干净，不能把「内核会不会报错」当成入参校验。
 */
const SafeIdString = IdString.refine(
  (v) => !v.includes('..') && !/[\\/]/.test(v) && !/^[a-zA-Z]:/.test(v),
  '标识符不得包含路径分隔符、".." 或盘符前缀',
);

/** 无参数的只读 kind（list_instances / list_servers / get_target_state）的入参。 */
export const KernelEmptyRequest = z.object({}).default({});

/** get_capabilities 的入参：edition 可选；非法值（如 §2.1 的 devkit，本仓未接线）由 enum 直接拒。 */
export const KernelCapabilitiesRequest = z
  .object({ edition: KernelEditionSchema.optional() })
  .default({});
export type KernelCapabilitiesReq = z.infer<typeof KernelCapabilitiesRequest>;

/** 读通道请求：`kind` 是 zod.enum 白名单，非白名单 kind 在解析阶段就被拒。 */
export const KernelReadRequest = z.object({
  kind: KernelReadKindSchema,
  payload: z.record(z.unknown()).default({}),
});
export type KernelReadReq = z.infer<typeof KernelReadRequest>;

export const KernelListKindsResponse = z.object({
  kinds: z.array(
    z.object({
      kind: z.string(),
      edition: KernelEditionSchema,
      permission: KernelPermissionSchema,
      risk: KernelRiskSchema,
      /** 该通道是否已挂到 preload 白名单（false = 仅主进程侧可达）。 */
      uiReachable: z.boolean(),
    }),
  ),
});
export type KernelListKindsRes = z.infer<typeof KernelListKindsResponse>;

export const KernelCapabilityItemSchema = z.object({
  kind: z.string(),
  supported: z.boolean(),
  note: z.string().optional(),
});

export const KernelCapabilitiesResponse = z.object({
  edition: KernelEditionSchema,
  healthy: z.boolean(),
  message: z.string().nullable(),
  capabilities: z.array(KernelCapabilityItemSchema),
});
export type KernelCapabilitiesRes = z.infer<typeof KernelCapabilitiesResponse>;

export const KernelListInstancesResponse = z.object({
  instances: z.array(z.string()),
});
export type KernelListInstancesRes = z.infer<typeof KernelListInstancesResponse>;

export const KernelServerEntrySchema = z.object({
  id: z.string(),
  /** 该目录下是否已有 server.properties（内核 read_config 的可读前提）。 */
  hasConfig: z.boolean(),
  /** 该目录下是否已有 logs/latest.log（内核 read_logs 的可读前提）。 */
  hasLogs: z.boolean(),
});

export const KernelListServersResponse = z.object({
  servers: z.array(KernelServerEntrySchema),
});
export type KernelListServersRes = z.infer<typeof KernelListServersResponse>;

export const KernelReadLogsRequest = z.object({ serverId: SafeIdString });
export type KernelReadLogsReq = z.infer<typeof KernelReadLogsRequest>;

export const KernelReadLogsResponse = z.object({
  serverId: z.string(),
  file: z.string(),
  tail: z.array(z.string()),
});
export type KernelReadLogsRes = z.infer<typeof KernelReadLogsResponse>;

export const KernelReadConfigRequest = z.object({ serverId: SafeIdString });
export type KernelReadConfigReq = z.infer<typeof KernelReadConfigRequest>;

export const KernelReadConfigResponse = z.object({
  serverId: z.string(),
  file: z.string(),
  text: z.string(),
});
export type KernelReadConfigRes = z.infer<typeof KernelReadConfigResponse>;

/** §10.4 状态注入：`edition=java` 定位 instanceId，`edition=server` 定位 serverId。 */
export const KernelContextPackRequest = z
  .object({
    edition: z.enum(['java', 'server']),
    instanceId: SafeIdString.optional(),
    serverId: SafeIdString.optional(),
  })
  .refine(
    (v) =>
      (v.edition === 'java' && v.instanceId !== undefined && v.serverId === undefined) ||
      (v.edition === 'server' && v.serverId !== undefined && v.instanceId === undefined),
    'context_pack 必须给出与 edition 匹配的定位符：java→instanceId，server→serverId',
  );
export type KernelContextPackReq = z.infer<typeof KernelContextPackRequest>;

export const KernelContextPackResponse = z.object({
  edition: KernelEditionSchema,
  target: z.record(z.unknown()),
  parts: z.record(z.unknown()),
});
export type KernelContextPackRes = z.infer<typeof KernelContextPackResponse>;

export const KernelGetTargetStateRequest = z.object({}).default({});
export type KernelGetTargetStateReq = z.infer<typeof KernelGetTargetStateRequest>;

export const KernelGetTargetStateResponse = z.object({
  comMojangDir: z.string(),
  candidates: z.array(z.string()),
});
export type KernelGetTargetStateRes = z.infer<typeof KernelGetTargetStateResponse>;

export const KernelValidateContentRequest = z.object({ path: IdString });
export type KernelValidateContentReq = z.infer<typeof KernelValidateContentRequest>;

export const KernelValidateContentResponse = z.object({
  path: z.string(),
  manifestPath: z.string(),
  uuid: z.string().nullable(),
  version: z.array(z.number()).nullable(),
  minEngineVersion: z.array(z.number()).nullable(),
  modules: z.number(),
  /** manifest 结构问题（§6.2/§6.3）；为空即通过。 */
  errors: z.array(z.string()),
});
export type KernelValidateContentRes = z.infer<typeof KernelValidateContentResponse>;

// ---------------------------------------------------------------------------
// 统一 Result 形状（读通道与执行通道共用）
// ---------------------------------------------------------------------------

/** §14 错误分类（与 contract 的 ClassifiedError 同形，本地声明以免主/渲染都拉内核包）。 */
export const KernelErrorSchema = z.object({
  category: z.enum(['network', 'validation', 'version', 'disk', 'permission', 'unknown']),
  message: z.string(),
  code: z.string().nullable(),
  retryable: z.boolean(),
});
export type KernelErrorT = z.infer<typeof KernelErrorSchema>;

/**
 * 统一返回形状：`{ ok, data, error }`。
 *
 * 与既有 handler 的 `{ ok: boolean, error: string | null }` 同构，区别只是把内核的
 * §14 分类错误**结构化**带出来（category/code），UI 才能按类别决定提示文案。
 * `data` 保持 `unknown`：不同 kind 的 data 形状天差地别，强转会退化成
 * `Record<string, unknown>` 并丢掉可校验性 —— 通道各自的 Response schema 才是
 * 真正的形状契约。
 */
export const KernelTaskResultSchema = z.object({
  ok: z.boolean(),
  data: z.unknown().nullable(),
  error: KernelErrorSchema.nullable(),
});
export type KernelTaskResultT = z.infer<typeof KernelTaskResultSchema>;

/** 各读通道的 Result 特化：data 用该通道自己的 Response schema 收窄。 */
export type KernelResult<D> = Omit<KernelTaskResultT, 'data'> & { data: D | null };

export const KernelCapabilitiesResult = z.object({
  ok: z.boolean(),
  data: KernelCapabilitiesResponse.nullable(),
  error: KernelErrorSchema.nullable(),
});
export type KernelCapabilitiesResultT = z.infer<typeof KernelCapabilitiesResult>;

export const KernelListInstancesResult = z.object({
  ok: z.boolean(),
  data: KernelListInstancesResponse.nullable(),
  error: KernelErrorSchema.nullable(),
});
export type KernelListInstancesResultT = z.infer<typeof KernelListInstancesResult>;

export const KernelListServersResult = z.object({
  ok: z.boolean(),
  data: KernelListServersResponse.nullable(),
  error: KernelErrorSchema.nullable(),
});
export type KernelListServersResultT = z.infer<typeof KernelListServersResult>;

// ---------------------------------------------------------------------------
// 执行通道（主进程侧可达，不进 preload 白名单）
// ---------------------------------------------------------------------------

export const KernelExecuteRequest = z.object({
  kind: KernelWriteKindSchema,
  payload: z.record(z.unknown()).default({}),
});
export type KernelExecuteReq = z.infer<typeof KernelExecuteRequest>;

/**
 * 执行通道返回：多带 `permission` 与 `risk`。
 *
 * 内核在未获确认时返回 `{ ok:false, data:{confirmRequired:true}, error:{category:'permission'} }`，
 * 把 permission/risk 显式带出来，调用方（未来的 UI）才知道「该弹什么窗」而不是
 * 只能看到一个 permission 分类的错误。
 */
export const KernelExecuteResponse = z.object({
  ok: z.boolean(),
  data: z.unknown().nullable(),
  error: KernelErrorSchema.nullable(),
  kind: z.string(),
  permission: KernelPermissionSchema,
  risk: KernelRiskSchema,
  /** 内核是否真的问过 §10.6 确认闸门（false = 被白名单/闸门提前拒掉）。 */
  confirmRequested: z.boolean(),
});
export type KernelExecuteRes = z.infer<typeof KernelExecuteResponse>;
