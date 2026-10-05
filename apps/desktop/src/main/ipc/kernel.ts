/**
 * 内核 IPC 处理器（外壳层薄壳，§4.2 / §10.2 / §10.6）。
 *
 * 沿用本目录既有模式：薄壳只做三件事 —— zod 解析入参 → 调 service → 包成统一
 * Result。业务逻辑一律不写在这里（内核在 `../kernel-runtime.ts` 托管）。
 *
 * ## 为什么不给渲染层一个 `kernel:dispatch`
 *
 * 内核的 `dispatch(task)` 是无鉴权万能入口。把它透传给渲染层 = 把
 * `delete_instance` / `rollback_build` 与 `get_capabilities` 摆在同一个按钮后面，
 * 违反 §4.3 的白名单原则（渲染进程可能存在 XSS 面）。所以 `kernel:read` 的
 * `kind` 是 `z.enum(KERNEL_READ_KINDS)` —— 非白名单 kind 在 zod 解析阶段就被拒，
 * 根本到不了内核。允许清单与逐条依据见 `../../shared/ipc/kernel.ts`。
 *
 * ## `kernel:execute`（W/X 类）为什么不进 preload 白名单
 *
 * `kernel:execute` 走的是**已实现、已接线、同样过 §10.6 confirm 闸门**的路径
 * （`runtime.runWrite`），但它**刻意不在 `preload/index.ts` 的 contextBridge
 * 白名单里**，因此渲染层目前触达不到。理由：
 *  1. 确认弹窗的**错误呈现**路径还没验证过 —— confirm 拒绝时内核返回
 *     `{ ok:false, data:{confirmRequired:true}, error:{category:'permission'} }`，
 *     这套形状在 UI 上还没有对应组件，先做会得到一个「点了没反应且不知道为什么」的
 *     半成品入口；
 *  2. W/X 的影响面（写实例目录 / 停服务端 / 回滚构建）在没有 UI 复核的情况下
 *     暴露给渲染层，风险不对称 —— 漏发的代价远大于晚发的代价；
 *  3. 门控本身已经在主进程侧测透（kernel-runtime.test.ts 断言 confirm 回调确实
 *     被调用、拒绝时不产生副作用），解除限制只需要 preload 加一行 + 补 UI。
 *
 * 综上：`kernel:execute` 在**主进程侧可达并测透**（本文件 + kernel-runtime.test.ts），
 * 渲染层暂不可达。
 */

import { ipcMain } from 'electron';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import {
  KERNEL_LIST_KINDS,
  KERNEL_READ,
  KERNEL_EXECUTE,
  KernelReadRequest,
  KernelExecuteRequest,
  KernelEmptyRequest,
  KernelCapabilitiesRequest,
  KernelReadLogsRequest,
  KernelReadConfigRequest,
  KernelContextPackRequest,
  KernelValidateContentRequest,
  KernelListInstancesResponse,
  KernelReadLogsResponse,
  KernelReadConfigResponse,
  KernelContextPackResponse,
  KernelGetTargetStateResponse,
  KernelValidateContentResponse,
  type KernelExecuteRes,
  type KernelCapabilitiesRes,
  type KernelListInstancesRes,
  type KernelListServersRes,
  type KernelReadLogsRes,
  type KernelReadConfigRes,
  type KernelGetTargetStateRes,
  type KernelValidateContentRes,
  type KernelErrorT,
  type KernelResult,
  type KernelTaskResultT,
} from '../../shared/ipc-channels.js';
import {
  describeKernelKinds,
  getKernelRuntime,
  permissionOf,
  riskOf,
  type KernelRuntime,
} from '../kernel-runtime.js';

/** 内核未初始化（渲染层抢在 whenReady 之前 invoke）时的统一返回。 */
function notReady<T>(): KernelResult<T> {
  return {
    ok: false,
    data: null,
    error: {
      category: 'unknown',
      message: '内核宿主尚未初始化（主进程启动未完成），请稍后重试',
      code: 'KERNEL_RUNTIME_NOT_READY',
      retryable: true,
    },
  };
}

/** 内核返回的 TaskResult → 统一 Result 形状（把 undefined 归一成 null）。 */
function toResult<T>(r: {
  ok: boolean;
  data?: unknown;
  error?: {
    category: 'network' | 'validation' | 'version' | 'disk' | 'permission' | 'unknown';
    message: string;
    code?: string;
    retryable?: boolean;
  };
}): KernelResult<T> {
  const error: KernelErrorT | null =
    r.ok || r.error === undefined
      ? null
      : {
          category: r.error.category,
          message: r.error.message,
          code: r.error.code ?? null,
          retryable: r.error.retryable ?? false,
        };
  return { ok: r.ok, data: r.ok ? ((r.data ?? null) as T) : null, error };
}

/**
 * `list_servers` 的外壳侧推导。
 *
 * §10.2 列了 `list_servers`，但三个内核的 dispatch **都没有实现这个 kind**
 * （kernel-server 只实现了 get_capabilities / read_logs / read_config /
 * get_context_pack；agent 的 MCP 通道同样把它标成未实现）。
 * 与其透传一个稳定返回「不支持的任务」的通道，不如按 kernel-server 自己那套
 * 目录事实推导 —— `<dataDir>/<serverId>/` 下有 `server.properties` / `logs/`。
 *
 * 推导口径与内核 `read_config` / `read_logs` 的可读前提**逐字对齐**，所以
 * 列表里 hasConfig=false 的项点进去只会得到一个明确的 validation 错误，
 * 而不是「列出来了但读不了」。`instances` 是内核数据根下的保留目录名，必须排除
 * （否则 java 的实例目录会被当成一个服务端）。
 *
 * 注意：这里用「目录里有子目录或文件」判定存在，而非只认目录 —— 一个刚被
 * create_server 拷空目录、还没写 server.properties 的服务端也应当被列出来，
 * 只是 hasConfig=false。
 */
function listServersFrom(root: string): KernelListServersRes {
  const servers: KernelListServersRes['servers'] = [];
  let entries: import('node:fs').Dirent[];
  try {
    if (!existsSync(root) || !statSync(root).isDirectory()) return { servers };
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return { servers };
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith('.')) continue;
    // kernel-java 的实例目录：排除，否则会把实例当成服务端。
    if (entry.name === 'instances') continue;
    const dir = join(root, entry.name);
    servers.push({
      id: entry.name,
      hasConfig: existsSync(join(dir, 'server.properties')),
      hasLogs: existsSync(join(dir, 'logs', 'latest.log')),
    });
  }
  servers.sort((a, b) => a.id.localeCompare(b.id));
  return { servers };
}

/**
 * 注册内核 IPC 处理器。
 *
 * @param runtime 注入的内核宿主；不传则每请求现取单例（生产路径）。
 *                测试注入一个用临时目录构造的实例，避免污染真实 userData。
 */
export function registerKernelHandlers(runtime?: KernelRuntime): void {
  const pick = (): KernelRuntime | null => runtime ?? getKernelRuntime();

  // --- 自描述表：kind → 内核 / 权限 / 风险 / 是否渲染层可达（只读）---
  ipcMain.handle(KERNEL_LIST_KINDS, (): { kinds: ReturnType<typeof describeKernelKinds> } => ({
    kinds: describeKernelKinds(),
  }));

  // --- 只读通道（R 类，§10.2 读现状）---
  // 每个 kind 都先走**自己的** zod schema `.parse()`，非法入参在这里就抛 ZodError，
  // 根本到不了内核。绝不允许出现「schema 定义了但从不 .parse()」的死代码
  // （ipc/file-manager.ts 刚被清掉 21 个这种 schema）。
  ipcMain.handle(KERNEL_READ, async (_e, raw: unknown): Promise<KernelTaskResultT> => {
    const req = KernelReadRequest.parse(raw);
    const rt = pick();
    if (rt === null) return notReady();
    const payload = req.payload;

    switch (req.kind) {
      case 'get_capabilities': {
        // §10.2：get_capabilities 是强制第一步，edition 决定问哪个内核。
        const { edition } = KernelCapabilitiesRequest.parse(payload);
        const kernel =
          edition === 'server' ? rt.server : edition === 'bedrock' ? rt.bedrock : rt.java;
        const status = kernel.status();
        const body: KernelCapabilitiesRes = {
          edition: kernel.edition,
          healthy: status.healthy,
          message: status.message ?? null,
          capabilities: kernel.capabilities().map((c) => ({
            kind: c.kind,
            supported: c.supported,
            ...(c.note === undefined ? {} : { note: c.note }),
          })),
        };
        return { ok: true, data: body, error: null };
      }

      case 'list_instances': {
        KernelEmptyRequest.parse(payload);
        const r = await rt.runRead('list_instances');
        const wrapped = toResult<KernelListInstancesRes>(r);
        if (!wrapped.ok || wrapped.data === null) return { ...wrapped, data: null };
        return { ...wrapped, data: KernelListInstancesResponse.parse(wrapped.data) };
      }

      case 'list_servers': {
        KernelEmptyRequest.parse(payload);
        return { ok: true, data: listServersFrom(rt.dataDir), error: null };
      }

      case 'read_logs': {
        const { serverId } = KernelReadLogsRequest.parse(payload);
        const r = await rt.runRead('read_logs', { serverId });
        const wrapped = toResult<KernelReadLogsRes>(r);
        if (!wrapped.ok || wrapped.data === null) return { ...wrapped, data: null };
        return { ...wrapped, data: KernelReadLogsResponse.parse(wrapped.data) };
      }

      case 'read_config': {
        const { serverId } = KernelReadConfigRequest.parse(payload);
        const r = await rt.runRead('read_config', { serverId });
        const wrapped = toResult<KernelReadConfigRes>(r);
        if (!wrapped.ok || wrapped.data === null) return { ...wrapped, data: null };
        return { ...wrapped, data: KernelReadConfigResponse.parse(wrapped.data) };
      }

      case 'get_context_pack': {
        // §10.4：java 按 instanceId、server 按 serverId 定位。这里显式要求 edition，
        // 而不是像 MCP 通道那样靠「有没有 serverId」猜 —— 猜错就是一条无意义的
        // validation，白名单通道的入参不该靠猜（refine 在 zod 里已经把这条钉死）。
        const locator = KernelContextPackRequest.parse(payload);
        const r = await rt.runRead('get_context_pack', { ...locator });
        const wrapped = toResult<{ target?: unknown; parts?: unknown }>(r);
        if (!wrapped.ok || wrapped.data === null) return { ...wrapped, data: null };
        return {
          ...wrapped,
          data: KernelContextPackResponse.parse({
            edition: locator.edition,
            target: (wrapped.data.target ?? {}) as Record<string, unknown>,
            parts: (wrapped.data.parts ?? {}) as Record<string, unknown>,
          }),
        };
      }

      case 'get_target_state': {
        KernelEmptyRequest.parse(payload);
        const r = await rt.runRead('get_target_state');
        const wrapped = toResult<KernelGetTargetStateRes>(r);
        if (!wrapped.ok || wrapped.data === null) return { ...wrapped, data: null };
        return { ...wrapped, data: KernelGetTargetStateResponse.parse(wrapped.data) };
      }

      case 'validate_content': {
        const { path } = KernelValidateContentRequest.parse(payload);
        const r = await rt.runRead('validate_content', { path });
        const wrapped = toResult<KernelValidateContentRes>(r);
        if (!wrapped.ok || wrapped.data === null) return { ...wrapped, data: null };
        return { ...wrapped, data: KernelValidateContentResponse.parse(wrapped.data) };
      }

      case 'list_backups': {
        // §7.4 快照列表：内核要求按 serverId 定位（无 serverId 直接 validation 拒绝），
        // 故复用读通道既有的 serverId schema（与 read_logs / read_config 同形）。
        const { serverId } = KernelReadLogsRequest.parse(payload);
        const r = await rt.runRead('list_backups', { serverId });
        return toResult<unknown>(r);
      }

      case 'list_tasks': {
        // §7.4 定时账本：内核接受空 payload（查全部，不过滤）；serverId 过滤是轮询器
        //（R2b）的事，本分支只保证名单与通道一致。
        KernelEmptyRequest.parse(payload);
        const r = await rt.runRead('list_tasks');
        return toResult<unknown>(r);
      }

      default:
        // TS 穷尽性兜底：KERNEL_READ_KINDS 加了新 kind 而这里没加 case 时编译失败。
        return unimplementedKind(String((req as { kind: string }).kind));
    }
  });

  // --- 执行通道（W/X 类）：已接线、已测透，**刻意不进 preload 白名单** ---
  ipcMain.handle(KERNEL_EXECUTE, async (_e, raw: unknown): Promise<KernelExecuteRes> => {
    const req = KernelExecuteRequest.parse(raw);
    const rt = pick();
    if (rt === null) {
      return {
        ok: false,
        data: null,
        kind: req.kind,
        permission: permissionOf(req.kind) ?? 'X',
        risk: riskOf(req.kind, permissionOf(req.kind)),
        confirmRequested: false,
        error: notReady().error as KernelErrorT,
      };
    }
    const permission = permissionOf(req.kind) ?? 'X';
    const before = rt.confirmLog().length;
    const result = await rt.runWrite(req.kind, req.payload);
    const wrapped = toResult<unknown>(result);
    return {
      ok: wrapped.ok,
      data: wrapped.data,
      error: wrapped.error,
      kind: req.kind,
      permission,
      risk: riskOf(req.kind, permission),
      // 内核真的问过闸门吗？内核在 confirm 缺失时也会返回 permission 拒绝，
      // 两者靠这个标志区分 —— UI 要据此决定「弹窗」还是「报配置错误」。
      confirmRequested: rt.confirmLog().length > before,
    };
  });
}

function unimplementedKind(kind: string): KernelTaskResultT {
  return {
    ok: false,
    data: null,
    error: {
      category: 'unknown',
      message: `未实现的只读 kind: ${kind}（KERNEL_READ_KINDS 加了新 kind 但这里没接）`,
      code: 'KERNEL_KIND_UNIMPLEMENTED',
      retryable: false,
    },
  };
}
