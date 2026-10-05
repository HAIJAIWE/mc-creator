import { useCallback, useEffect, useState } from 'react';
import { Button, Card } from '@mc-creator/ui';
import { Cpu, RefreshCw, Server, Box } from 'lucide-react';
import { McIcon } from '../assets/mc-ui/McIcon';
import { ipcClient } from '../lib/ipc-client.js';
import type {
  KernelEditionT,
  KernelListKindsRes,
  KernelTaskResultT,
} from '../../../shared/ipc-channels.js';
import {
  KernelCapabilitiesResponse,
  KernelListInstancesResponse,
  KernelListServersResponse,
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
 */

const EDITIONS: KernelEditionT[] = ['java', 'server', 'bedrock'];

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
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const read = useCallback(async (req: Parameters<typeof ipcClient.kernelRead>[0]) => {
    return await ipcClient.kernelRead(req);
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
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
      if (srvParsed !== null && srvParsed.success) {
        setServers(srvParsed.data.servers);
      } else {
        setError(srvRes.error?.message ?? '服务端列表形状不符合契约（KernelListServersResponse）');
      }
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
                className="flex items-center gap-2 rounded-mc border border-mc-border bg-mc-surface-2 px-2 py-1 text-[11px]"
              >
                <span className="text-mc-text">{s.id}</span>
                <span className="ml-auto flex items-center gap-1 text-[9px] text-mc-dim">
                  <span className={s.hasConfig ? 'text-green-400' : 'text-mc-mute'}>config</span>
                  <span className={s.hasLogs ? 'text-green-400' : 'text-mc-mute'}>logs</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* kind 白名单自述：把「哪些能做、哪些还锁着」摆在明面上 */}
      <section className="px-3 py-2">
        <Card title="内核 kind（§10.2）" padding="sm">
          <p className="mb-1.5 text-[10px] text-mc-dim">
            只读 {reachable.length} 项已接入 UI；写/执行 {gated.length} 项已在主进程侧测通，
            但未暴露给 UI（§10.6 确认门控的 UI 呈现尚未验证）。
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
                title={`${k.edition} · ${k.permission} · ${k.risk}${k.uiReachable ? '' : ' · 仅主进程侧'}`}
              >
                {k.kind}
              </li>
            ))}
          </ul>
        </Card>
      </section>
    </div>
  );
}
