/**
 * 内核 IPC 薄壳测试（§4.2 / §10.2 / §10.6）。
 *
 * 覆盖四件事：
 * 1. 三个通道都注册，且 **`kernel:execute` 不在 preload 白名单**（渲染层触达不到，
 *    见 kernel-whitelist.test.ts；这里测的是「handler 确实存在且确实过闸门」）；
 * 2. 每个暴露的 kind 至少一条成功用例（证明链路真的通了，不只是注册了名字）；
 * 3. **入参校验必须真的拒绝非法输入**（空 / 类型错 / 越界 / 路径穿越）——这是本仓
 *    既有纪律，ipc/file-manager.ts 刚被清掉 21 个从不 `.parse()` 的死 schema 就是
 *    反例，所以每个 kind 都有一组非法输入用例；
 * 4. 非白名单 kind 一律报错，且**根本到不了内核**（断言内核侧零副作用）。
 */

// Mock electron：记录 ipcMain.handle 注册的通道与处理器。
const handlers = new Map<string, (e: unknown, ...args: unknown[]) => unknown>();

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (e: unknown, ...args: unknown[]) => unknown) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  app: { getPath: () => 'C:\\mock\\userData' },
}));

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { registerKernelHandlers } from './kernel.js';
import { createKernelRuntime, setKernelRuntime, type KernelRuntime } from '../kernel-runtime.js';
import {
  KERNEL_LIST_KINDS,
  KERNEL_READ,
  KERNEL_EXECUTE,
  KernelListKindsResponse,
  KernelExecuteRequest,
  KernelTaskResultSchema,
  KernelExecuteResponse,
  KernelCapabilitiesResponse,
  KernelListInstancesResponse,
  KernelListServersResponse,
  KernelReadLogsResponse,
  KernelReadConfigResponse,
  KERNEL_READ_KINDS,
  KERNEL_WRITE_KINDS,
  type KernelTaskResultT,
} from '../../shared/ipc-channels.js';

const YES = (): boolean => true;
const NO = (): boolean => false;

let dirs: string[] = [];
let rt: KernelRuntime | null = null;
let dataDir = '';
/** bedrock 包目录刻意放在 dataDir 之外：它不是服务端目录，放进去会被 list_servers 列出来。 */
let packDir = '';

/** 取已注册 handler（未注册即测试失败，而不是静默 undefined）。 */
function handler(channel: string): (e: unknown, ...args: unknown[]) => unknown {
  const h = handlers.get(channel);
  if (h === undefined) throw new Error(`通道未注册: ${channel}`);
  return h;
}

async function call(channel: string, raw: unknown): Promise<KernelTaskResultT> {
  const result = await handler(channel)(null, raw);
  // 统一 Result 形状必须始终成立（每个成功分支都 parse 一次）
  return KernelTaskResultSchema.parse(result);
}

beforeEach(async () => {
  handlers.clear();
  dirs = [];
  dataDir = await mkdtemp(join(tmpdir(), 'mc-kernel-ipc-'));
  dirs.push(dataDir);
  setKernelRuntime(null);
});

afterEach(async () => {
  rt?.dispose();
  rt = null;
  setKernelRuntime(null);
  for (const d of dirs) await rm(d, { recursive: true, force: true });
  dirs = [];
});

describe('通道注册', () => {
  it('只注册三个内核通道', () => {
    rt = createKernelRuntime({ dataDir, confirm: YES });
    registerKernelHandlers(rt);
    expect([...handlers.keys()].sort()).toEqual(
      [KERNEL_EXECUTE, KERNEL_LIST_KINDS, KERNEL_READ].sort(),
    );
    // 通道名沿用既有「域:动作」驼峰风格
    expect(KERNEL_READ.startsWith('kernel:')).toBe(true);
    expect(KERNEL_EXECUTE.startsWith('kernel:')).toBe(true);
  });

  it('kernel:listKinds 自描述全部 kind，并标出哪些对渲染层可达', async () => {
    rt = createKernelRuntime({ dataDir, confirm: YES });
    registerKernelHandlers(rt);
    const res = KernelListKindsResponse.parse(await handler(KERNEL_LIST_KINDS)(null));
    const byName = new Map(res.kinds.map((k) => [k.kind, k]));

    // R 类可达，W/X 不可达（这正是 preload 白名单的依据）
    for (const kind of KERNEL_READ_KINDS) {
      expect(byName.get(kind)?.permission, `${kind} 应是 R 类`).toBe('R');
      expect(byName.get(kind)?.uiReachable, `${kind} 应可达`).toBe(true);
    }
    for (const kind of KERNEL_WRITE_KINDS) {
      expect(byName.get(kind)?.permission, `${kind} 应是 W/X 类`).not.toBe('R');
      expect(byName.get(kind)?.uiReachable, `${kind} 不可达`).toBe(false);
    }
    expect(res.kinds).toHaveLength(KERNEL_READ_KINDS.length + KERNEL_WRITE_KINDS.length);
  });

  it('内核未初始化时给出结构化的 KERNEL_RUNTIME_NOT_READY（而不是抛异常）', async () => {
    registerKernelHandlers(undefined); // 不注入，走单例（此刻为 null）
    const res = await call(KERNEL_READ, { kind: 'get_capabilities', payload: {} });
    expect(res.ok).toBe(false);
    expect(res.error?.code).toBe('KERNEL_RUNTIME_NOT_READY');
    expect(res.error?.retryable).toBe(true);
  });
});

describe('只读通道：每个暴露的 kind 至少一条', () => {
  beforeEach(async () => {
    // 造出各类真实磁盘事实，避免「用例只测了错误分支」
    await mkdir(join(dataDir, 'instances', 'inst-a'), { recursive: true });
    await writeFile(
      join(dataDir, 'instances', 'inst-a', 'instance.json'),
      JSON.stringify({ name: 'inst-a', edition: 'java', versionId: '1.21.1' }),
    );
    await mkdir(join(dataDir, 'srv-b', 'logs'), { recursive: true });
    await writeFile(join(dataDir, 'srv-b', 'server.properties'), 'motd=from-kernel\n');
    await writeFile(join(dataDir, 'srv-b', 'logs', 'latest.log'), 'boot-line\n');

    const packRoot = await mkdtemp(join(tmpdir(), 'mc-kernel-ipc-pack-'));
    dirs.push(packRoot);
    await writeFile(
      join(packRoot, 'manifest.json'),
      JSON.stringify({
        header: {
          uuid: '0123456789abcdef0123456789abcdef',
          version: [1, 0, 0],
          min_engine_version: [1, 20, 0],
        },
        modules: [{ uuid: 'fedcba9876543210fedcba9876543210', version: [1, 0, 0], type: 'data' }],
      }),
    );
    packDir = packRoot;

    rt = createKernelRuntime({ dataDir, confirm: YES });
    registerKernelHandlers(rt);
  });

  it('get_capabilities（java/server/bedrock 三种 edition 都可）', async () => {
    for (const edition of ['java', 'server', 'bedrock'] as const) {
      const res = await call(KERNEL_READ, { kind: 'get_capabilities', payload: { edition } });
      expect(res.ok).toBe(true);
      const body = KernelCapabilitiesResponse.parse(res.data);
      expect(body.edition).toBe(edition);
      expect(body.healthy).toBe(true);
      expect(body.capabilities.length).toBeGreaterThan(0);
    }
  });

  it('list_instances 列出 <dataDir>/instances 下的目录名', async () => {
    const res = await call(KERNEL_READ, { kind: 'list_instances', payload: {} });
    expect(res.ok).toBe(true);
    expect(KernelListInstancesResponse.parse(res.data).instances).toEqual(['inst-a']);
  });

  it('list_servers 排除保留目录名 instances，并标出 hasConfig/hasLogs', async () => {
    const res = await call(KERNEL_READ, { kind: 'list_servers', payload: {} });
    expect(res.ok).toBe(true);
    const body = KernelListServersResponse.parse(res.data);
    expect(body.servers.map((s) => s.id)).toEqual(['srv-b']);
    expect(body.servers[0]).toMatchObject({ hasConfig: true, hasLogs: true });
    expect(body.servers.map((s) => s.id)).not.toContain('instances');
  });

  it('read_logs 读到日志尾部', async () => {
    const res = await call(KERNEL_READ, { kind: 'read_logs', payload: { serverId: 'srv-b' } });
    expect(res.ok).toBe(true);
    expect(KernelReadLogsResponse.parse(res.data).tail.join('\n')).toContain('boot-line');
  });

  it('read_config 读到 server.properties 文本', async () => {
    const res = await call(KERNEL_READ, { kind: 'read_config', payload: { serverId: 'srv-b' } });
    expect(res.ok).toBe(true);
    expect(KernelReadConfigResponse.parse(res.data).text).toContain('motd=from-kernel');
  });

  it('get_context_pack（java 用 instanceId / server 用 serverId）', async () => {
    const javaPack = await call(KERNEL_READ, {
      kind: 'get_context_pack',
      payload: { edition: 'java', instanceId: 'inst-a' },
    });
    expect(javaPack.ok).toBe(true);
    expect((javaPack.data as { target: { instanceId: string } }).target.instanceId).toBe('inst-a');

    const serverPack = await call(KERNEL_READ, {
      kind: 'get_context_pack',
      payload: { edition: 'server', serverId: 'srv-b' },
    });
    expect(serverPack.ok).toBe(true);
    expect((serverPack.data as { target: { serverId: string } }).target.serverId).toBe('srv-b');
  });

  it('get_target_state 返回 com.mojang 目录探测结果（Windows）或明确的降级说明', async () => {
    const res = await call(KERNEL_READ, { kind: 'get_target_state', payload: {} });
    // bedrock 内核只在 win32 探测；非 win32 会给出明确 error 而不是崩
    if (process.platform === 'win32') {
      if (res.ok) {
        expect(typeof (res.data as { comMojangDir: string }).comMojangDir).toBe('string');
      } else {
        expect(res.error?.category).toBe('validation');
      }
    } else {
      expect(res.ok).toBe(false);
      expect(res.error?.message).toContain('Windows');
    }
  });

  it('validate_content 校验 bedrock 包 manifest（§10.3）', async () => {
    const res = await call(KERNEL_READ, { kind: 'validate_content', payload: { path: packDir } });
    expect(res.ok).toBe(true);
    const body = res.data as { errors: string[]; modules: number };
    expect(body.errors).toEqual([]);
    expect(body.modules).toBe(1);
  });
});

describe('只读通道：入参校验（非法输入必须被拒）', () => {
  beforeEach(() => {
    rt = createKernelRuntime({ dataDir, confirm: YES });
    registerKernelHandlers(rt);
  });

  /** handler 抛 zod 错误 = 入参被拒；返回 Result = 被接受。 */
  async function rejects(raw: unknown): Promise<boolean> {
    try {
      await call(KERNEL_READ, raw);
      return false;
    } catch {
      return true;
    }
  }

  it('非白名单 kind 一律拒绝（含 §10.2 里有但内核未实现的 list_versions / search_content）', async () => {
    for (const kind of [
      'list_versions',
      'search_content',
      'launch_instance',
      'delete_instance',
      'rollback_build',
      'generate_content',
      'rm -rf',
      '',
      '__proto__',
    ]) {
      expect(await rejects({ kind, payload: {} }), `kind=${kind} 应被拒`).toBe(true);
    }
  });

  it('非白名单 kind 被拒时内核侧零副作用（不是「报个错但顺手干了」）', async () => {
    const runtime = rt as KernelRuntime;
    const before = runtime.confirmLog().length;
    await rejects({ kind: 'delete_instance', payload: { instanceId: 'inst-a' } });
    expect(runtime.confirmLog()).toHaveLength(before);
  });

  it('payload 缺省 / 类型错误 / 数组 / null 全部拒绝', async () => {
    expect(await rejects(undefined)).toBe(true);
    expect(await rejects(null)).toBe(true);
    expect(await rejects('get_capabilities')).toBe(true);
    expect(await rejects(42)).toBe(true);
    expect(await rejects([])).toBe(true);
    // kind 合法但 payload 不是对象
    expect(await rejects({ kind: 'read_logs' })).toBe(true);
    expect(await rejects({ kind: 'read_logs', payload: 'srv-b' })).toBe(true);
    expect(await rejects({ kind: 'read_logs', payload: ['srv-b'] })).toBe(true);
    expect(await rejects({ kind: 'read_logs', payload: null })).toBe(true);
  });

  it('read_logs / read_config：serverId 空串、纯空白、超长、路径穿越一律拒绝', async () => {
    for (const serverId of [
      '',
      '   ',
      '..',
      '../../etc',
      'a/b',
      'a\\b',
      'C:\\win',
      'x'.repeat(200),
    ]) {
      expect(
        await rejects({ kind: 'read_logs', payload: { serverId } }),
        `read_logs serverId=${JSON.stringify(serverId)} 应被拒`,
      ).toBe(true);
      expect(
        await rejects({ kind: 'read_config', payload: { serverId } }),
        `read_config serverId=${JSON.stringify(serverId)} 应被拒`,
      ).toBe(true);
    }
    // 类型错误
    for (const serverId of [1, true, null, {}, []]) {
      expect(await rejects({ kind: 'read_logs', payload: { serverId } })).toBe(true);
    }
  });

  it('get_context_pack：edition 非法 / 定位符与 edition 不匹配 / 缺失 全部拒绝', async () => {
    expect(
      await rejects({ kind: 'get_context_pack', payload: { edition: 'devkit', instanceId: 'a' } }),
    ).toBe(true);
    expect(await rejects({ kind: 'get_context_pack', payload: {} })).toBe(true);
    // java 必须给 instanceId（只给 serverId 不算）
    expect(
      await rejects({ kind: 'get_context_pack', payload: { edition: 'java', serverId: 'a' } }),
    ).toBe(true);
    // server 必须给 serverId
    expect(
      await rejects({ kind: 'get_context_pack', payload: { edition: 'server', instanceId: 'a' } }),
    ).toBe(true);
    // 两个都给 = 歧义，拒绝
    expect(
      await rejects({
        kind: 'get_context_pack',
        payload: { edition: 'java', instanceId: 'a', serverId: 'b' },
      }),
    ).toBe(true);
    // 路径穿越
    expect(
      await rejects({ kind: 'get_context_pack', payload: { edition: 'java', instanceId: '../x' } }),
    ).toBe(true);
  });

  it('validate_content：path 空 / 缺字段 / 类型错 一律拒绝', async () => {
    expect(await rejects({ kind: 'validate_content', payload: {} })).toBe(true);
    expect(await rejects({ kind: 'validate_content', payload: { path: '' } })).toBe(true);
    expect(await rejects({ kind: 'validate_content', payload: { path: '   ' } })).toBe(true);
    expect(await rejects({ kind: 'validate_content', payload: { path: 42 } })).toBe(true);
    expect(await rejects({ kind: 'validate_content', payload: { path: null } })).toBe(true);
  });

  it('get_capabilities：edition 非法值（devkit 本仓未接线）在 zod 层就被拒', async () => {
    // 与「handler 手写 if 判断」不同，这条由 enum 兜住：新增内核时改一处即可，
    // 不会出现「忘了加校验分支」。
    expect(await rejects({ kind: 'get_capabilities', payload: { edition: 'devkit' } })).toBe(true);
    expect(await rejects({ kind: 'get_capabilities', payload: { edition: 7 } })).toBe(true);
    expect(await rejects({ kind: 'get_capabilities', payload: { edition: '' } })).toBe(true);
  });

  it('list_instances / list_servers / get_target_state 忽略多余 payload 字段（宽容但有界）', async () => {
    const res = await call(KERNEL_READ, { kind: 'list_instances', payload: { whatever: 1 } });
    expect(res.ok).toBe(true);
  });
});

describe('执行通道 kernel:execute（主进程侧可达，不进 preload 白名单）', () => {
  it('create_instance 经确认闸门后真的落盘', async () => {
    const seen: string[] = [];
    rt = createKernelRuntime({
      dataDir,
      confirm: (req) => {
        seen.push(req.kind);
        return true;
      },
    });
    registerKernelHandlers(rt);

    const res = KernelExecuteResponse.parse(
      await handler(KERNEL_EXECUTE)(null, {
        kind: 'create_instance',
        payload: { name: 'made-by-ipc', versionId: '1.21.1' },
      }),
    );
    expect(res.ok).toBe(true);
    expect(res.kind).toBe('create_instance');
    expect(res.permission).toBe('X');
    expect(res.risk).toBe('execute');
    expect(res.confirmRequested).toBe(true);
    expect(seen).toEqual(['create_instance']);
    expect(existsSync(join(dataDir, 'instances', 'made-by-ipc', 'instance.json'))).toBe(true);
  });

  it('confirm 拒绝时 confirmRequested 仍为 true（区分「问过但被拒」与「压根没问」）', async () => {
    rt = createKernelRuntime({ dataDir, confirm: NO });
    registerKernelHandlers(rt);
    const res = KernelExecuteResponse.parse(
      await handler(KERNEL_EXECUTE)(null, {
        kind: 'delete_instance',
        payload: { instanceId: 'whatever' },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.confirmRequested).toBe(true);
    expect(res.error?.category).toBe('permission');
  });

  it('只接受 W/X kind：R 类 kind 从执行通道走一律被拒', async () => {
    rt = createKernelRuntime({ dataDir, confirm: YES });
    registerKernelHandlers(rt);
    expect(() => KernelExecuteRequest.parse({ kind: 'get_capabilities', payload: {} })).toThrow();
    expect(() => KernelExecuteRequest.parse({ kind: 'list_instances', payload: {} })).toThrow();
    // 未在 W/X 清单里的 §10.2 kind 也拒（devkit 内核未接线）
    expect(() => KernelExecuteRequest.parse({ kind: 'build_project', payload: {} })).not.toThrow();
    expect(() => KernelExecuteRequest.parse({ kind: 'not_a_kind', payload: {} })).toThrow();
  });

  it('入参非法（payload 不是对象 / kind 缺失）一律被 zod 拒', async () => {
    rt = createKernelRuntime({ dataDir, confirm: YES });
    registerKernelHandlers(rt);
    for (const raw of [
      undefined,
      null,
      'create_instance',
      7,
      [],
      { kind: 'create_instance', payload: 5 },
    ]) {
      await expect(handler(KERNEL_EXECUTE)(null, raw)).rejects.toThrow();
    }
  });

  it('内核未初始化时 execute 也返回结构化错误，不抛', async () => {
    registerKernelHandlers(undefined);
    const res = KernelExecuteResponse.parse(
      await handler(KERNEL_EXECUTE)(null, { kind: 'create_instance', payload: { name: 'x' } }),
    );
    expect(res.ok).toBe(false);
    expect(res.confirmRequested).toBe(false);
    expect(res.error?.code).toBe('KERNEL_RUNTIME_NOT_READY');
  });

  it('保留目录名在执行通道同样被拒（且不弹确认窗）', async () => {
    rt = createKernelRuntime({
      dataDir,
      confirm: () => {
        throw new Error('保留名应在闸门之前就被拒，不该弹窗');
      },
    });
    registerKernelHandlers(rt);
    const res = KernelExecuteResponse.parse(
      await handler(KERNEL_EXECUTE)(null, {
        kind: 'create_instance',
        payload: { name: 'instances' },
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.confirmRequested).toBe(false);
    expect(res.error?.code).toBe('KERNEL_ID_RESERVED');
  });
});
