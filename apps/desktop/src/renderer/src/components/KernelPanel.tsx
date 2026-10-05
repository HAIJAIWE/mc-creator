import { useCallback, useEffect, useState } from 'react';
import { z } from 'zod';
import { Button, Card } from '@mc-creator/ui';
import { Cpu, RefreshCw, Server, Box } from 'lucide-react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { ipcClient } from '../lib/ipc-client.js';
import { KernelConfirmHost } from './KernelConfirmHost.js';
import { ServerConsole } from './ServerConsole.js';
import type {
  KernelEditionT,
  KernelListKindsRes,
  KernelTaskResultT,
} from '../../../shared/ipc-channels.js';
import {
  KernelCapabilitiesResponse,
  KernelContextPackResponse,
  KernelListInstancesResponse,
  KernelListServersResponse,
  KernelReadConfigResponse,
  KernelReadLogsResponse,
} from '../../../shared/ipc-channels.js';

/**
 * 内核面板 —— §18 阶段 10「内核接进 desktop」的**最小可验证界面**。
 *
 * ## 这一屏要证明什么
 *
 * 只有一件事：**链路真的通了**。渲染层 → preload 白名单 → ipcMain.handle →
 * 主进程内核宿主 → 三内核的磁盘事实，全程是活的。所以它刻意只做只读：
 *  - 列实例（kernel-java 的 `list_instances`，即内核数据根下的 instances/）
 *  - 列服务端（外壳侧按 kernel-server 的目录事实推导的 `list_servers`）
 *  - 读三张能力表（`get_capabilities`，§10.2 强制第一步）
 *  - 列 kind 自描述表（哪些 R/W/X、哪些对 UI 可达）
 *
 * ## 为什么 UI 上**没有**破坏性 kind 的按钮
 *
 * W/X 类（create_instance / launch_instance / deploy_plugin / rollback_build…）
 * 已经接进主进程并测透（`src/main/ipc/kernel.test.ts`），但**刻意不在这一屏暴露**，
 * 也不在 preload 白名单里。两个原因：
 *  1. §10.6 的确认弹窗目前是 Electron 原生对话框，它从内核的 confirm 闸门弹出，
 *     但「用户点了取消之后 UI 该怎么解释接下来发生什么」这套呈现还没验证；
 *  2. 先给一个「点了没反应又不知道为什么」的入口，比不给更糟 —— 用户会把
 *     「闸门在工作」误读成「产品坏了」。
 *
 * 解锁条件：UI 侧确认框 + 权限拒绝的呈现做好之后，在 preload 白名单里加一行
 * `kernelExecute`，本面板再加按钮。闸门接线本身不需要再改内核。
 *
 * ## 服务端行的「控制台」开关（任务 W1：接线 ServerConsole）
 *
 * `ServerConsole.tsx` 此前**全仓没有任何组件引用它**（只有它自己的测试渲染它），
 * 即一整块已写好、已测透的只读观测面在产品里不可达。本节把它接进服务端行。
 *
 * 三条硬约束（主代理拍板）：
 * 1. **懒挂载**：`ServerConsole` 只在用户点开后才渲染。理由是它是自带 5s 轮询
 *    `read_logs` 的活组件 —— 未展开就挂载等于让每台服务端在用户没要求时就开始
 *    轮询主进程。与既有「日志/配置也是懒加载、不随 refresh 预取」同一取向。
 * 2. **同一时刻最多开一个**（单槽 `string | null` 槽位，点别的先关旧的）：
 *    多个同时轮询的控制台是真实的 IPC / 主进程读盘开销，而用户一次只会盯一台。
 *    本仓已有同款先例：`KernelConfirmHost` 的确认弹窗就是单槽（后到覆盖先到）。
 * 3. **只读**：控制台不新增任何 IPC 面、不碰 `kernel:execute`、不经确认闸门 ——
 *    它读的就是 `read_logs`，与上方「日志」按钮同源，只是多了自动刷新与暂停。
 */

const EDITIONS: KernelEditionT[] = ['java', 'server', 'bedrock'];

/**
 * 构建隔离回报（kernel-server `build_project` 的 `data.isolation` 形状）。
 * network 恒为 false —— Job Object 管不到网络，不要假装已禁网。
 */
const IsolationSchema = z.object({
  source: z.enum(['job-object', 'unisolated']),
  memory: z.boolean(),
  cpu: z.boolean(),
  network: z.boolean(),
  treeKill: z.boolean(),
  reason: z.string().nullable(),
});
type IsolationInfo = z.infer<typeof IsolationSchema>;

/**
 * 只读链路可见的构建信息（`get_context_pack` 的 `parts` 子集）。
 * `lastBuildHash` 即部署账本里最新一条记录的 sha256（§0.5 哈希可见）；
 * `isolation` 目前只读链路不返回，留作前向兼容（后端若在 parts 里回报则直接展示）。
 */
const BuildPartsSchema = z
  .object({
    lastBuildHash: z.string().min(1).optional(),
    isolation: IsolationSchema.optional(),
  })
  .passthrough();

interface EditionState {
  edition: KernelEditionT;
  healthy: boolean;
  supported: number;
  total: number;
  message: string | null;
}

export function KernelPanel() {
  const [kinds, setKinds] = useState<KernelListKindsRes | null>(null);
  const [editions, setEditions] = useState<EditionState[]>([]);
  const [instances, setInstances] = useState<string[]>([]);
  const [servers, setServers] = useState<{ id: string; hasConfig: boolean; hasLogs: boolean }[]>(
    [],
  );
  const [buildSha256, setBuildSha256] = useState<string | null>(null);
  const [buildServerId, setBuildServerId] = useState<string | null>(null);
  const [isolation, setIsolation] = useState<IsolationInfo | null>(null);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // 服务端日志/配置查看（纯只读）：按 serverId 展开后懒加载，不随 refresh 预取。
  // 所有响应走各自 zod schema safeParse，形状不对只记本节错误，不污染全局 error。
  const [logsOpen, setLogsOpen] = useState<Record<string, boolean>>({});
  const [configOpen, setConfigOpen] = useState<Record<string, boolean>>({});
  const [logTails, setLogTails] = useState<Record<string, string[]>>({});
  const [logFiles, setLogFiles] = useState<Record<string, string>>({});
  const [logErrors, setLogErrors] = useState<Record<string, string | null>>({});
  const [logLoading, setLogLoading] = useState<Record<string, boolean>>({});
  const [configTexts, setConfigTexts] = useState<Record<string, string>>({});
  const [configFiles, setConfigFiles] = useState<Record<string, string>>({});
  const [configErrors, setConfigErrors] = useState<Record<string, string | null>>({});
  const [configLoading, setConfigLoading] = useState<Record<string, boolean>>({});
  // 服务端重启/停止（X 类，经 kernel:execute + §10.6 确认闸门）：错误进本节错误条，不打崩。
  const [actionErrors, setActionErrors] = useState<Record<string, string | null>>({});
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  // 控制台展开槽（单槽，见文件头「服务端行的控制台开关」）：存当前展开的 serverId，
  // null = 全关。存 id 而不是 Record<id, boolean> 是为了从类型上就不可能同时开两个。
  const [consoleServerId, setConsoleServerId] = useState<string | null>(null);

  const read = useCallback(async (req: Parameters<typeof ipcClient.kernelRead>[0]) => {
    return await ipcClient.kernelRead(req);
  }, []);

  const toggleLogs = useCallback(
    async (serverId: string) => {
      if (logsOpen[serverId]) {
        setLogsOpen((prev) => ({ ...prev, [serverId]: false }));
        return;
      }
      setLogsOpen((prev) => ({ ...prev, [serverId]: true }));
      setLogLoading((prev) => ({ ...prev, [serverId]: true }));
      setLogErrors((prev) => ({ ...prev, [serverId]: null }));
      try {
        // serverId 直接用列表返回的 id，不做任何拼接。
        const res = await read({ kind: 'read_logs', payload: { serverId } });
        const parsed =
          res.ok && res.data !== null ? KernelReadLogsResponse.safeParse(res.data) : null;
        if (parsed !== null && parsed.success) {
          setLogTails((prev) => ({ ...prev, [serverId]: parsed.data.tail.slice(-50) }));
          setLogFiles((prev) => ({ ...prev, [serverId]: parsed.data.file }));
        } else {
          setLogErrors((prev) => ({
            ...prev,
            [serverId]: res.error?.message ?? '日志形状不符合契约（KernelReadLogsResponse）',
          }));
        }
      } catch (e) {
        setLogErrors((prev) => ({ ...prev, [serverId]: (e as Error).message }));
      } finally {
        setLogLoading((prev) => ({ ...prev, [serverId]: false }));
      }
    },
    [logsOpen, read],
  );

  const toggleConfig = useCallback(
    async (serverId: string) => {
      if (configOpen[serverId]) {
        setConfigOpen((prev) => ({ ...prev, [serverId]: false }));
        return;
      }
      setConfigOpen((prev) => ({ ...prev, [serverId]: true }));
      setConfigLoading((prev) => ({ ...prev, [serverId]: true }));
      setConfigErrors((prev) => ({ ...prev, [serverId]: null }));
      try {
        // serverId 直接用列表返回的 id，不做任何拼接。
        const res = await read({ kind: 'read_config', payload: { serverId } });
        const parsed =
          res.ok && res.data !== null ? KernelReadConfigResponse.safeParse(res.data) : null;
        if (parsed !== null && parsed.success) {
          setConfigTexts((prev) => ({ ...prev, [serverId]: parsed.data.text }));
          setConfigFiles((prev) => ({ ...prev, [serverId]: parsed.data.file }));
        } else {
          setConfigErrors((prev) => ({
            ...prev,
            [serverId]: res.error?.message ?? '配置形状不符合契约（KernelReadConfigResponse）',
          }));
        }
      } catch (e) {
        setConfigErrors((prev) => ({ ...prev, [serverId]: (e as Error).message }));
      } finally {
        setConfigLoading((prev) => ({ ...prev, [serverId]: false }));
      }
    },
    [configOpen, read],
  );

  const runServerAction = useCallback(
    async (serverId: string, kind: 'restart_server' | 'stop_server') => {
      const key = `${serverId}:${kind}`;
      setActionLoading((prev) => ({ ...prev, [key]: true }));
      setActionErrors((prev) => ({ ...prev, [serverId]: null }));
      try {
        const res = await ipcClient.kernelExecute({ kind, payload: { serverId } });
        if (!res.ok) {
          setActionErrors((prev) => ({
            ...prev,
            [serverId]: res.error?.message ?? `${kind} 执行失败`,
          }));
        }
      } catch (e) {
        setActionErrors((prev) => ({ ...prev, [serverId]: (e as Error).message }));
      } finally {
        setActionLoading((prev) => ({ ...prev, [key]: false }));
      }
    },
    [],
  );

  const toggleConsole = useCallback((serverId: string) => {
    // 单槽切换：再点已展开的那台 = 收起；点别的 = 先关旧的再开新的（旧的随之 unmount，
    // 它的 5s 轮询与 interval 在 unmount 时清掉，见 ServerConsole 的 mountedRef 守卫）。
    setConsoleServerId((cur) => (cur === serverId ? null : serverId));
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    setBuildError(null);
    try {
      const kindTable = await ipcClient.kernelListKinds();
      setKinds(kindTable);

      const nextEditions: EditionState[] = [];
      for (const edition of EDITIONS) {
        const res: KernelTaskResultT = await read({
          kind: 'get_capabilities',
          payload: { edition },
        });
        const parsed =
          res.ok && res.data !== null ? KernelCapabilitiesResponse.safeParse(res.data) : null;
        if (parsed !== null && parsed.success) {
          nextEditions.push({
            edition,
            healthy: parsed.data.healthy,
            supported: parsed.data.capabilities.filter((c) => c.supported).length,
            total: parsed.data.capabilities.length,
            message: parsed.data.message,
          });
        } else {
          nextEditions.push({
            edition,
            healthy: false,
            supported: 0,
            total: 0,
            message: res.error?.message ?? '能力表形状不符合契约（KernelCapabilitiesResponse）',
          });
        }
      }
      setEditions(nextEditions);

      // 渲染层**不信任**主进程返回的 data 形状：统一走各自的 zod Response schema
      // 校验（与主进程薄壳同一套 schema，单一真相源）。形状对不上就当错误处理，
      // 绝不让一个 undefined 直接把整屏打崩 —— 那正是「面板白屏且无提示」的成因。
      const instRes = await read({ kind: 'list_instances', payload: {} });
      const instParsed =
        instRes.ok && instRes.data !== null
          ? KernelListInstancesResponse.safeParse(instRes.data)
          : null;
      if (instParsed !== null && instParsed.success) {
        setInstances(instParsed.data.instances);
      } else {
        setError(instRes.error?.message ?? '实例列表形状不符合契约（KernelListInstancesResponse）');
      }

      const srvRes = await read({ kind: 'list_servers', payload: {} });
      const srvParsed =
        srvRes.ok && srvRes.data !== null ? KernelListServersResponse.safeParse(srvRes.data) : null;
      const serverIds: string[] =
        srvParsed !== null && srvParsed.success ? srvParsed.data.servers.map((s) => s.id) : [];
      if (srvParsed !== null && srvParsed.success) {
        setServers(srvParsed.data.servers);
      } else {
        setError(srvRes.error?.message ?? '服务端列表形状不符合契约（KernelListServersResponse）');
      }

      // 最近构建（只读）：经 get_context_pack 取部署账本的 lastBuildHash（§0.5 哈希可见）。
      // build_project 本身是 X 类，仅主进程侧可达，渲染层绝不直接触达；此处只展示
      // 只读链路可见的产物哈希与隔离回报（parts.isolation 目前只读链路不返回，留作前向兼容）。
      // 无数据是正常态（展示“暂无构建记录”），形状对不上记为本节错误，绝不打崩整屏、
      // 也不污染全局 error（富集失败不应掩盖实例/服务端的主错误）。
      let foundHash: string | null = null;
      let foundServer: string | null = null;
      let foundIso: IsolationInfo | null = null;
      let sectionError: string | null = null;
      for (const sid of serverIds) {
        let packRes: KernelTaskResultT;
        try {
          packRes = await read({
            kind: 'get_context_pack',
            payload: { edition: 'server', serverId: sid },
          });
        } catch {
          continue;
        }
        const packParsed =
          packRes.ok && packRes.data !== null
            ? KernelContextPackResponse.safeParse(packRes.data)
            : null;
        if (packParsed === null || !packParsed.success) {
          if (packRes.ok) {
            sectionError = '构建信息形状不符合契约（KernelContextPackResponse）';
          }
          continue;
        }
        const partsParsed = BuildPartsSchema.safeParse(packParsed.data.parts);
        if (!partsParsed.success) {
          sectionError = '构建信息形状不符合契约（context parts）';
          continue;
        }
        if (foundHash === null && partsParsed.data.lastBuildHash !== undefined) {
          foundHash = partsParsed.data.lastBuildHash;
          foundServer = sid;
        }
        if (foundIso === null && partsParsed.data.isolation !== undefined) {
          foundIso = partsParsed.data.isolation;
          if (foundServer === null) foundServer = sid;
        }
        if (foundHash !== null && foundIso !== null) break;
      }
      setBuildSha256(foundHash);
      setBuildServerId(foundServer);
      setIsolation(foundIso);
      setBuildError(sectionError);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [read]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const reachable = kinds?.kinds.filter((k) => k.uiReachable) ?? [];
  const gated = kinds?.kinds.filter((k) => !k.uiReachable) ?? [];

  return (
    <div className="flex h-full flex-col overflow-y-auto bg-mc-surface">
      <div className="flex items-center gap-2 border-b border-mc-border px-3 py-2">
        <McIcon scope="pixel" name="chest" size={14} className="text-mc-accent" />
        <span className="text-xs font-medium text-mc-text">内核</span>
        <span className="text-[10px] text-mc-mute">§10 只读链路</span>
        <div className="ml-auto">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void refresh()}
            loading={loading}
            iconLeft={loading ? undefined : <RefreshCw className="h-3 w-3" />}
            aria-label="刷新内核状态"
          >
            刷新
          </Button>
        </div>
      </div>

      {error !== null && (
        <div
          role="alert"
          className="border-b border-mc-border bg-red-500/10 px-3 py-2 text-[11px] text-red-400"
        >
          {error}
        </div>
      )}

      {/* 内核能力表（§10.2 get_capabilities 强制第一步）*/}
      <section className="border-b border-mc-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-mc-dim">
          <Cpu className="h-3 w-3" /> 内核能力
        </div>
        <ul className="space-y-1">
          {editions.map((e) => (
            <li
              key={e.edition}
              className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px]"
            >
              <span className="text-mc-text">{e.edition}</span>
              <span
                className={`rounded-mc px-1 text-[9px] ${
                  e.healthy ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                }`}
              >
                {e.healthy ? 'healthy' : 'unhealthy'}
              </span>
              <span className="ml-auto text-[10px] text-mc-dim">
                支持 {e.supported}/{e.total}
              </span>
            </li>
          ))}
          {editions.length === 0 && (
            <li className="py-2 text-center text-[11px] text-mc-mute">
              {loading ? '加载中…' : '暂无数据'}
            </li>
          )}
        </ul>
      </section>

      {/* 实例（kernel-java list_instances）*/}
      <section className="border-b border-mc-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-mc-dim">
          <Box className="h-3 w-3" /> 实例（{instances.length}）
        </div>
        {instances.length === 0 ? (
          <p className="py-1 text-[11px] text-mc-mute">
            无实例。实例由 kernel-java 的 create_instance 创建 —— 该 kind 属 X 类，已在主进程侧
            接通但未在 UI 暴露（§10.6 确认 UI 未验证）。
          </p>
        ) : (
          <ul className="space-y-1">
            {instances.map((name) => (
              <li
                key={name}
                className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text"
              >
                {name}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 服务端（外壳侧按 kernel-server 目录事实推导）*/}
      <section className="border-b border-mc-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-mc-dim">
          <Server className="h-3 w-3" /> 服务端（{servers.length}）
        </div>
        {servers.length === 0 ? (
          <p className="py-1 text-[11px] text-mc-mute">无服务端目录。</p>
        ) : (
          <ul className="space-y-1">
            {servers.map((s) => (
              <li
                key={s.id}
                className="rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px]"
              >
                <div className="flex items-center gap-2">
                  <span className="text-mc-text">{s.id}</span>
                  <span className="ml-auto flex items-center gap-1 text-[9px] text-mc-dim">
                    <span className={s.hasConfig ? 'text-green-400' : 'text-mc-mute'}>config</span>
                    <span className={s.hasLogs ? 'text-green-400' : 'text-mc-mute'}>logs</span>
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-1">
                  <button
                    type="button"
                    aria-label={`查看 ${s.id} 日志`}
                    aria-expanded={logsOpen[s.id] === true}
                    disabled={!s.hasLogs}
                    onClick={() => void toggleLogs(s.id)}
                    className="rounded-mc border border-mc-border px-1.5 py-0.5 text-[10px] text-mc-text disabled:opacity-40"
                  >
                    日志
                  </button>
                  <button
                    type="button"
                    aria-label={`查看 ${s.id} 配置`}
                    aria-expanded={configOpen[s.id] === true}
                    disabled={!s.hasConfig}
                    onClick={() => void toggleConfig(s.id)}
                    className="rounded-mc border border-mc-border px-1.5 py-0.5 text-[10px] text-mc-text disabled:opacity-40"
                  >
                    配置
                  </button>
                  <button
                    type="button"
                    aria-label={`查看 ${s.id} 控制台`}
                    aria-expanded={consoleServerId === s.id}
                    onClick={() => toggleConsole(s.id)}
                    className="rounded-mc border border-mc-border px-1.5 py-0.5 text-[10px] text-mc-text"
                  >
                    控制台
                  </button>
                  <button
                    type="button"
                    aria-label={`重启 ${s.id}`}
                    disabled={actionLoading[`${s.id}:restart_server`] === true}
                    onClick={() => void runServerAction(s.id, 'restart_server')}
                    className="rounded-mc border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-400 disabled:opacity-40"
                  >
                    重启
                  </button>
                  <button
                    type="button"
                    aria-label={`停止 ${s.id}`}
                    disabled={actionLoading[`${s.id}:stop_server`] === true}
                    onClick={() => void runServerAction(s.id, 'stop_server')}
                    className="rounded-mc border border-red-500/40 px-1.5 py-0.5 text-[10px] text-red-400 disabled:opacity-40"
                  >
                    停止
                  </button>
                  {!s.hasLogs && (
                    <span className="text-[10px] text-mc-mute">无日志文件，日志不可查看</span>
                  )}
                  {!s.hasConfig && (
                    <span className="text-[10px] text-mc-mute">无配置文件，配置不可查看</span>
                  )}
                </div>
                {actionErrors[s.id] != null && (
                  <p className="mt-1 text-[10px] text-red-400">{actionErrors[s.id]}</p>
                )}
                {logsOpen[s.id] === true && s.hasLogs && (
                  <div className="mt-1">
                    {logLoading[s.id] === true ? (
                      <p className="text-[10px] text-mc-mute">日志加载中…</p>
                    ) : logErrors[s.id] != null ? (
                      <p className="text-[10px] text-red-400">{logErrors[s.id]}</p>
                    ) : (
                      <>
                        {logFiles[s.id] !== undefined && (
                          <div className="text-[10px] text-mc-dim">{logFiles[s.id]}</div>
                        )}
                        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] text-mc-text">
                          {(logTails[s.id] ?? []).join('\n')}
                        </pre>
                      </>
                    )}
                  </div>
                )}
                {configOpen[s.id] === true && s.hasConfig && (
                  <div className="mt-1">
                    {configLoading[s.id] === true ? (
                      <p className="text-[10px] text-mc-mute">配置加载中…</p>
                    ) : configErrors[s.id] != null ? (
                      <p className="text-[10px] text-red-400">{configErrors[s.id]}</p>
                    ) : (
                      <>
                        {configFiles[s.id] !== undefined && (
                          <div className="text-[10px] text-mc-dim">{configFiles[s.id]}</div>
                        )}
                        <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap break-all font-mono text-[10px] text-mc-text">
                          {configTexts[s.id] ?? ''}
                        </pre>
                      </>
                    )}
                  </div>
                )}
                {/* 控制台（W1 接死代码）：懒挂载 + 单槽，同一时刻全面板至多一个实例。
                    刻意**不**用 hasLogs 门禁 —— 没有日志文件时 ServerConsole 自己会
                    呈现空态/错误态（它就是为「服务端刚起、还没日志」准备的），在这里
                    把入口按 hasLogs 灰掉等于把它刚修好的降级路径又藏回去。 */}
                {consoleServerId === s.id && (
                  <div className="mt-1 overflow-hidden rounded-mc border border-mc-border">
                    <ServerConsole serverId={s.id} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* 最近构建（只读）：产物哈希与隔离回报 */}
      <section className="border-b border-mc-border px-3 py-2">
        <div className="mb-1.5 flex items-center gap-1 text-[10px] font-medium text-mc-dim">
          <Box className="h-3 w-3" /> 最近构建（只读）
        </div>
        {buildSha256 === null && isolation === null ? (
          <p className="py-1 text-[11px] text-mc-mute">暂无构建记录</p>
        ) : (
          <div className="space-y-1">
            {buildSha256 !== null && (
              <div className="rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px]">
                <div className="text-[10px] text-mc-dim">
                  产物 sha256{buildServerId !== null ? `（${buildServerId}）` : ''}
                </div>
                <div className="break-all font-mono text-[10px] text-mc-text">{buildSha256}</div>
              </div>
            )}
            {isolation !== null ? (
              <ul className="rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px] text-mc-text">
                <li>source：{isolation.source}</li>
                <li>memory：{String(isolation.memory)}</li>
                <li>cpu：{String(isolation.cpu)}</li>
                <li>network：{String(isolation.network)}</li>
                <li>treeKill：{String(isolation.treeKill)}</li>
                <li>reason：{isolation.reason ?? '—'}</li>
              </ul>
            ) : (
              buildSha256 !== null && (
                <p className="text-[10px] text-mc-mute">
                  隔离状态未上报（只读链路未返回 isolation 明细；build_project 为 X
                  类，仅主进程侧可达）。
                </p>
              )
            )}
          </div>
        )}
        {buildError !== null && <p className="mt-1 text-[10px] text-red-400">{buildError}</p>}
        <p className="mt-1 text-[10px] text-mc-mute">
          构建执行类未在 UI 暴露；此处仅展示只读链路可见的产物哈希与隔离回报，其中 network 恒为
          false。
        </p>
      </section>

      {/* kind 白名单自述：把「哪些能做、哪些还锁着」摆在明面上 */}
      <section className="px-3 py-2">
        <Card title="内核 kind（§10.2）" padding="sm">
          <p className="mb-1.5 text-[10px] text-mc-dim">
            共 {kinds?.kinds.length ?? 0} 项已接入 UI（含只读与经 §10.6 确认闸门可达的写/执行，UI
            可达 {reachable.length} 项、未达 {gated.length}{' '}
            项）；其中重启/停止已在服务端行暴露按钮，其余写/执行（build_project
            等）需参数，暂未暴露。
          </p>
          <ul className="flex flex-wrap gap-1">
            {kinds?.kinds.map((k) => (
              <li
                key={k.kind}
                className={`rounded-mc px-1.5 py-0.5 font-mono text-[9px] ${
                  k.uiReachable
                    ? 'bg-green-500/15 text-green-400'
                    : 'bg-yellow-500/15 text-yellow-400'
                }`}
                title={`${k.edition} · ${k.permission} · ${k.risk}${k.uiReachable ? '' : ' · 需参数，暂未暴露'}`}
              >
                {k.kind}
              </li>
            ))}
          </ul>
        </Card>
      </section>
      <KernelConfirmHost />
    </div>
  );
}
