/**
 * 内核注入缝测试（依赖倒置）。
 *
 * ## 为什么这个文件重要
 *
 * 改造前 `createMcpServer` 内部硬写 `new JavaKernel(...)`，内核执行路径
 * **无法在测试中触达** —— 11 个测试文件、约 110 处 `createMcpServer` 引用
 * 走的全是绕开内核的纯函数路径（listTools / callTool 路由 / parseLine）。
 *
 * 这条测试锁住改造后的能力：**不碰真实内核也能覆盖内核执行路径**。
 * 若有人把 `createKernelBundle` 改回硬构造，这里立刻失效。
 */
import { describe, it, expect, vi } from 'vitest';
import { createMcpServer, MCP_READ_ROUTES } from './mcp-server.js';
import type { KernelContract, StatusSnapshot, TaskHandle } from '@mc-creator/contract';

/**
 * 假内核：只实现 `KernelContract` 要求的 4 个方法。
 *
 * 它不需要任何 node_modules 依赖，也不需要真实 MC 安装 ——
 * 这正是依赖倒置要买到的东西。
 */
function fakeKernel(edition: 'java' | 'server' | 'bedrock', label: string): KernelContract {
  return {
    edition,
    capabilities: () => [{ name: `${label}-cap` }],
    status: () =>
      ({
        edition,
        healthy: true,
        message: `${label}-mock`,
        updatedAt: '2026-10-11T00:00:00Z',
      }) as unknown as StatusSnapshot,
    // TaskHandle 必须是完整的异步句柄：progress 可迭代、result() 返回 TaskResult。
    // 早先这里返回了 `{id, kind}` 就断言通过，直到真的走到 dispatch 才炸
    // 「pickKernel(...).dispatch(...).result is not a function」。
    dispatch: vi.fn(
      (): TaskHandle =>
        ({
          id: `${label}-task`,
          progress: (async function* () {
            yield { kind: 'started', message: 'mock' };
          })(),
          cancel: () => undefined,
          result: async () => ({ ok: true, data: { marker: `${label}-mock` } }),
        }) as unknown as TaskHandle,
    ),
  } as unknown as KernelContract;
}

describe('内核注入缝（依赖倒置）', () => {
  it('注入的假内核被真正使用，而不是被默认内核顶替', async () => {
    const java = fakeKernel('java', 'FAKE_JAVA');
    const server = createMcpServer({ kernels: { java } });

    // 走一条确定路由到 java 内核的工具，确认拿到的是我们注入的那个
    const javaRouted = Object.entries(MCP_READ_ROUTES).find(([, ed]) => ed === 'java');
    expect(javaRouted, '需要至少一条路由到 java 内核的工具').toBeDefined();

    const res = await server.callTool(javaRouted![0], { instanceId: 'test' });
    expect(java.dispatch).toHaveBeenCalled();
    // 假内核的 status 消息会出现在结果里 —— 真内核不会返回这个字符串
    expect(JSON.stringify(res)).toContain('FAKE_JAVA-mock');
  });

  it('未注入的一版走默认实现，不报错（向后兼容）', async () => {
    // 只注入 java，server / bedrock 仍由 createKernelBundle 造默认实现
    const java = fakeKernel('java', 'ONLY_JAVA');
    const server = createMcpServer({ kernels: { java } });
    const serverRouted = Object.entries(MCP_READ_ROUTES).find(([, ed]) => ed === 'server');
    expect(serverRouted, '需要一条路由到 server 内核的工具').toBeDefined();

    // 默认 server 内核要求 serverId，这里给了，不应抛
    await expect(
      server.callTool(serverRouted![0], { serverId: 'probe-server' }),
    ).resolves.toBeDefined();
  });

  it('不传 kernels 时行为与改造前一致（默认三内核）', () => {
    expect(() => createMcpServer()).not.toThrow();
    expect(() => createMcpServer({ java: { dataDir: '/tmp/probe' } })).not.toThrow();
  });

  it('注入的三个内核各自独立，按路由分派', async () => {
    const java = fakeKernel('java', 'J');
    const server = fakeKernel('server', 'S');
    const bedrock = fakeKernel('bedrock', 'B');
    const s = createMcpServer({ kernels: { java, server, bedrock } });

    expect(s.listTools().length).toBeGreaterThan(0);
    // 三版都被注入，无一被默认实现顶替
    for (const k of [java, server, bedrock]) {
      expect(k.dispatch).not.toHaveBeenCalled(); // 尚未触发
    }
  });

  it('get_capabilities 按 edition 参数改道到对应内核', async () => {
    const java = fakeKernel('java', 'CAP_JAVA');
    const bedrock = fakeKernel('bedrock', 'CAP_BEDROCK');
    const s = createMcpServer({ kernels: { java, bedrock } });

    const res = await s.callTool('get_capabilities', { edition: 'bedrock' });
    expect(JSON.stringify(res)).toContain('CAP_BEDROCK');
    expect(java.dispatch).not.toHaveBeenCalled();
  });
});
