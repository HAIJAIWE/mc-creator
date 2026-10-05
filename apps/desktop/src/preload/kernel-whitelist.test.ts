/**
 * preload 白名单防回归测试（§4.2 / §4.3 / §10.6）。
 *
 * 背景：`preload/index.ts` 是 `sandbox: true` + `contextIsolation: true` 的**显式**
 * 白名单 —— 渲染层能触达什么完全由这里决定。所以「主进程注册了 handler」和
 * 「渲染层能用」是两件事，而**后者更容易被漏掉**（加了 handler 忘了加白名单，
 * 表现是 UI 里某个按钮永远报 "No handler registered"）。
 *
 * 这条测试同时守两件事：
 * 1. 内核通道**确实**进了白名单（正向：只读两通道 + 执行通道 + 确认两通道）；
 * 2. 白名单**仅含**这五个通道 —— 用源码级断言守住，不含其他 `kernel:*` 通道
 *    （X2a 设计变更：KERNEL_EXECUTE 按用户决策开放，W/X 可点；安全由三缓解兜底：
 *    超时拒绝 / id 关联 / 审计 confirmLog。白名单思想保留，名单更新）。
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  KERNEL_LIST_KINDS,
  KERNEL_READ,
  KERNEL_EXECUTE,
  KERNEL_CONFIRM_REQUEST,
  KERNEL_CONFIRM_RESPONSE,
  KernelConfirmResponse,
  PROCESS_LIST,
} from '../shared/ipc-channels.js';

const exposed = new Map<string, unknown>();
const invoked: Array<{ channel: string; args: unknown[] }> = [];
const subscribed: Array<{ channel: string; listener: (...args: unknown[]) => void }> = [];

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (key: string, value: unknown) => {
      exposed.set(key, value);
    },
  },
  ipcRenderer: {
    invoke: (channel: string, ...args: unknown[]) => {
      invoked.push({ channel, args });
      return Promise.resolve({ ok: true, data: null, error: null });
    },
    on: (channel: string, listener: (...args: unknown[]) => void) => {
      subscribed.push({ channel, listener });
      return undefined;
    },
    removeListener: () => undefined,
  },
}));

beforeEach(() => {
  invoked.length = 0;
  subscribed.length = 0;
});

/** preload 模块在 import 时就完成 exposeInMainWorld，故用动态 import 保证只跑一次。 */
async function loadApi(): Promise<Record<string, unknown>> {
  if (exposed.size === 0) {
    await import('./index.js');
  }
  return exposed.get('mcApi') as Record<string, unknown>;
}

describe('内核通道已进 preload 白名单（§4.2，X2a 名单）', () => {
  it('mcApi.kernelListKinds / kernelRead 都存在，且 invoke 到正确通道', async () => {
    const api = await loadApi();
    expect(typeof api['kernelListKinds']).toBe('function');
    expect(typeof api['kernelRead']).toBe('function');

    await (api['kernelListKinds'] as () => Promise<unknown>)();
    expect(invoked.at(-1)?.channel).toBe(KERNEL_LIST_KINDS);

    await (api['kernelRead'] as (req: unknown) => Promise<unknown>)({
      kind: 'list_instances',
      payload: {},
    });
    expect(invoked.at(-1)?.channel).toBe(KERNEL_READ);
    expect(invoked.at(-1)?.args[0]).toEqual({ kind: 'list_instances', payload: {} });
  });

  it('mcApi.kernelExecute 确已挂载：invoke 到 kernel:execute 并原样透传入参', async () => {
    const api = await loadApi();
    expect(typeof api['kernelExecute']).toBe('function');

    const req = { kind: 'stop_server', payload: { serverId: 's1' } };
    await (api['kernelExecute'] as (req: unknown) => Promise<unknown>)(req);
    expect(invoked.at(-1)?.channel).toBe(KERNEL_EXECUTE);
    expect(invoked.at(-1)?.args[0]).toEqual(req);
  });

  it('确认两通道确已挂载：请求可订阅、应答 invoke 到正确通道', async () => {
    const api = await loadApi();
    expect(typeof api['onKernelConfirmRequest']).toBe('function');
    expect(typeof api['respondKernelConfirm']).toBe('function');

    // 订阅：主进程 send(KERNEL_CONFIRM_REQUEST) 能被收到
    const seen: unknown[] = [];
    const off = (api['onKernelConfirmRequest'] as (cb: (req: unknown) => void) => () => void)(
      (req) => seen.push(req),
    );
    expect(subscribed.at(-1)?.channel).toBe(KERNEL_CONFIRM_REQUEST);
    expect(typeof off).toBe('function');
    // 模拟主进程 send：直接调订阅到的 listener（首参 event 位填 null）
    const wireReq = {
      id: randomUUID(),
      kind: 'stop_server',
      summary: '停止服务端 s1',
      risk: 'execute',
      requestedAt: Date.now(),
    };
    (subscribed.at(-1)?.listener as (...args: unknown[]) => void)(null, wireReq);
    expect(seen).toEqual([wireReq]);
    off();

    // 应答：invoke 回 KERNEL_CONFIRM_RESPONSE
    const wireRes = { id: wireReq.id, approved: true };
    await (api['respondKernelConfirm'] as (res: unknown) => Promise<unknown>)(wireRes);
    expect(invoked.at(-1)?.channel).toBe(KERNEL_CONFIRM_RESPONSE);
    expect(invoked.at(-1)?.args[0]).toEqual(wireRes);
  });

  it('confirm-response 非法 id 被拒（线上形状直接 parse）', () => {
    // 非 uuid 的 id 主进程侧 parse 即抛，invoke 侧可见拒绝，根本到不了 id 关联
    expect(KernelConfirmResponse.safeParse({ id: 'not-a-uuid', approved: true }).success).toBe(
      false,
    );
    expect(KernelConfirmResponse.safeParse({ approved: true }).success).toBe(false);
    expect(KernelConfirmResponse.safeParse({ id: randomUUID() }).success).toBe(false);
    // 合法形状一次过
    const good = KernelConfirmResponse.safeParse({ id: randomUUID(), approved: false });
    expect(good.success).toBe(true);
  });

  it('白名单里的每个内核方法都只 invoke 白名单通道（读+执行+确认应答）', async () => {
    const api = await loadApi();
    const allowed = new Set<string>([
      KERNEL_LIST_KINDS,
      KERNEL_READ,
      KERNEL_EXECUTE,
      KERNEL_CONFIRM_RESPONSE,
    ]);
    const kernelMethods = Object.entries(api).filter(([name]) => name.startsWith('kernel'));
    expect(kernelMethods.length).toBeGreaterThan(0);
    for (const [, fn] of kernelMethods) {
      await (fn as (arg?: unknown) => Promise<unknown>)({ kind: 'get_capabilities', payload: {} });
    }
    // X2a 起含 KERNEL_EXECUTE（用户决策开放 + 三缓解兜底）；确认请求是主进程
    // send 方向，不经 invoke，故此处只可能出现上述四个 invoke 通道。
    expect(invoked.length).toBeGreaterThan(0);
    for (const call of invoked) {
      expect(allowed.has(call.channel)).toBe(true);
    }
  });

  it('mcApi 暴露 kernelExecute（W/X 对渲染层可达，走 §10.6 确认闸门）', async () => {
    const api = await loadApi();
    expect(typeof api['kernelExecute']).toBe('function');
    // 进程托管的只读通道仍在（回归：别把 kernel 接线做成破坏性改动）
    expect(typeof api['processList']).toBe('function');
    expect(PROCESS_LIST).toBe('process:list');
  });
});

/** 粗粒度去注释：只看**代码**里有没有通道引用，注释里提到它不算。 */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** X2a 白名单名单（§4.5 裁决）：读两通道 + 执行通道 + 确认两通道，白名单思想保留。 */
const KERNEL_WHITELIST = [
  KERNEL_LIST_KINDS,
  KERNEL_READ,
  KERNEL_EXECUTE,
  KERNEL_CONFIRM_REQUEST,
  KERNEL_CONFIRM_RESPONSE,
];

/** 白名单常量名（preload 引通道一律经具名常量，不直接写 `kernel:*` 字面量）。 */
const KERNEL_WHITELIST_NAMES = [
  'KERNEL_LIST_KINDS',
  'KERNEL_READ',
  'KERNEL_EXECUTE',
  'KERNEL_CONFIRM_REQUEST',
  'KERNEL_CONFIRM_RESPONSE',
];

describe('源码级守卫：白名单仅含读+执行+确认通道，不含其他 kernel:* 通道', () => {
  it('preload/index.ts 的代码（去注释后）含全部五个白名单常量', () => {
    const code = stripComments(readFileSync(join(__dirname, 'index.ts'), 'utf8'));
    for (const name of KERNEL_WHITELIST_NAMES) {
      expect(code.includes(name), `白名单常量缺失: ${name}`).toBe(true);
    }
  });

  it('preload/index.ts 的代码（去注释后）不含白名单之外的 KERNEL_* 通道', () => {
    const code = stripComments(readFileSync(join(__dirname, 'index.ts'), 'utf8'));
    const seen = new Set(code.match(/KERNEL_[A-Z_]+/g) ?? []);
    expect([...seen].sort()).toEqual([...KERNEL_WHITELIST_NAMES].sort());
  });

  it('只读通道常量确实挂在 contextBridge 上（不是被注释掉的死代码）', () => {
    const code = stripComments(readFileSync(join(__dirname, 'index.ts'), 'utf8'));
    expect(code.includes('ipcRenderer.invoke(KERNEL_LIST_KINDS)')).toBe(true);
    expect(code.includes('ipcRenderer.invoke(KERNEL_READ, req)')).toBe(true);
    // 且两个只读通道都被 import 进来（import 段里出现 = 真在用）
    expect(code.includes('KERNEL_LIST_KINDS,')).toBe(true);
    expect(code.includes('KERNEL_READ,')).toBe(true);
  });

  it('三个通道常量互不相同（防止复制粘贴时把两个通道写成同一个名字）', () => {
    const all = [KERNEL_LIST_KINDS, KERNEL_READ, KERNEL_EXECUTE];
    expect(new Set(all).size).toBe(3);
    expect(KERNEL_LIST_KINDS).toBe('kernel:listKinds');
    expect(KERNEL_READ).toBe('kernel:read');
    expect(KERNEL_EXECUTE).toBe('kernel:execute');
  });

  it('确认两通道常量互不相同且与执行通道可区分', () => {
    expect(new Set(KERNEL_WHITELIST).size).toBe(KERNEL_WHITELIST.length);
    expect(KERNEL_CONFIRM_REQUEST).toBe('kernel:confirm-request');
    expect(KERNEL_CONFIRM_RESPONSE).toBe('kernel:confirm-response');
  });

  it('执行与确认应答确已挂载（不是被注释掉的死代码）', () => {
    const code = stripComments(readFileSync(join(__dirname, 'index.ts'), 'utf8'));
    expect(code.includes('ipcRenderer.invoke(KERNEL_EXECUTE, req)')).toBe(true);
    expect(code.includes('ipcRenderer.on(KERNEL_CONFIRM_REQUEST, wrapper)')).toBe(true);
    expect(code.includes('ipcRenderer.invoke(KERNEL_CONFIRM_RESPONSE, res)')).toBe(true);
  });
});
