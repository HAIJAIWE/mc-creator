// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { KernelPanel } from './KernelPanel.js';
import type { KernelReadReq, KernelTaskResultT } from '../../../shared/ipc-channels.js';

/**
 * 内核面板测试（§18 阶段 10）。
 *
 * 这一屏存在的唯一目的是**证明链路通了**，所以测试也只关心三件事：
 * 1. 真的按 §10.2 的只读 kind 去问了主进程（不是渲染层自己编的数据）；
 * 2. 内核回的磁盘事实（实例 / 服务端 / 能力表）被如实呈现；
 * 3. 主进程返回错误时呈现错误，而不是静默空白。
 *
 * 刻意**没有**「点了会创建实例」的用例：W/X 类对 UI 还没暴露（见组件头注释）。
 */

const kernelListKinds = vi.fn();
const kernelRead = vi.fn();

vi.mock('../lib/ipc-client.js', () => ({
  ipcClient: {
    kernelListKinds: () => kernelListKinds(),
    kernelRead: (req: unknown) => kernelRead(req),
  },
}));

function ok(data: unknown): KernelTaskResultT {
  return { ok: true, data, error: null };
}
function fail(message: string): KernelTaskResultT {
  return {
    ok: false,
    data: null,
    error: { category: 'validation', message, code: 'X', retryable: false },
  };
}

const KIND_TABLE = {
  kinds: [
    {
      kind: 'get_capabilities',
      edition: 'java',
      permission: 'R',
      risk: 'write',
      uiReachable: true,
    },
    { kind: 'list_instances', edition: 'java', permission: 'R', risk: 'write', uiReachable: true },
    { kind: 'list_servers', edition: 'server', permission: 'R', risk: 'write', uiReachable: true },
    {
      kind: 'create_instance',
      edition: 'java',
      permission: 'X',
      risk: 'execute',
      uiReachable: false,
    },
    {
      kind: 'launch_instance',
      edition: 'java',
      permission: 'X',
      risk: 'execute',
      uiReachable: false,
    },
  ],
} as never;

function capsFor(edition: string) {
  return ok({
    edition,
    healthy: true,
    message: null,
    capabilities: [
      { kind: 'instance', supported: true },
      { kind: 'server', supported: edition === 'server' },
    ],
  });
}

beforeEach(() => {
  kernelListKinds.mockReset().mockResolvedValue(KIND_TABLE);
  kernelRead.mockReset().mockImplementation(async (req: KernelReadReq) => {
    switch (req.kind) {
      case 'get_capabilities':
        return capsFor(String(req.payload['edition']));
      case 'list_instances':
        return ok({ instances: ['inst-a', 'inst-b'] });
      case 'list_servers':
        return ok({
          servers: [
            { id: 'srv-a', hasConfig: true, hasLogs: false },
            { id: 'srv-b', hasConfig: false, hasLogs: false },
          ],
        });
      default:
        return fail(`不该被调用: ${req.kind}`);
    }
  });
});

describe('KernelPanel：只读链路确实走通了', () => {
  it('渲染后按 §10.2 的只读 kind 问主进程（含三种 edition 的能力表）', async () => {
    render(<KernelPanel />);
    await waitFor(() => expect(kernelRead).toHaveBeenCalled());
    const kinds = kernelRead.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds).toContain('get_capabilities');
    expect(kinds).toContain('list_instances');
    expect(kinds).toContain('list_servers');
    // 三张能力表都问了
    const editions = kernelRead.mock.calls
      .filter((c) => (c[0] as { kind: string }).kind === 'get_capabilities')
      .map((c) => (c[0] as { payload: { edition: string } }).payload.edition);
    expect(editions).toEqual(['java', 'server', 'bedrock']);
  });

  it('如实呈现内核回的实例与服务端列表', async () => {
    render(<KernelPanel />);
    expect(await screen.findByText('inst-a')).toBeTruthy();
    expect(screen.getByText('inst-b')).toBeTruthy();
    expect(screen.getByText('srv-a')).toBeTruthy();
    expect(screen.getByText('srv-b')).toBeTruthy();
    expect(screen.getByText('实例（2）')).toBeTruthy();
    expect(screen.getByText('服务端（2）')).toBeTruthy();
  });

  it('呈现三个内核的健康状态与支持数', async () => {
    render(<KernelPanel />);
    expect(await screen.findByText('java')).toBeTruthy();
    expect(screen.getByText('server')).toBeTruthy();
    expect(screen.getByText('bedrock')).toBeTruthy();
    // java 支持 1/2，server 支持 2/2，bedrock 1/2（两个 1/2，用 getAllByText）
    expect(screen.getAllByText('支持 1/2')).toHaveLength(2);
    expect(screen.getAllByText('支持 2/2')).toHaveLength(1);
  });

  it('把 kind 白名单摆在明面上：R 类可达、X 类标为仅主进程侧', async () => {
    render(<KernelPanel />);
    expect(await screen.findByText('list_instances')).toBeTruthy();
    expect(screen.getByText('create_instance')).toBeTruthy();
    expect(screen.getByText(/写\/执行 2 项已在主进程侧测通/)).toBeTruthy();
  });

  it('空实例目录时给出说明（含「为何不能在这里建实例」）', async () => {
    kernelRead.mockImplementation(async (req: KernelReadReq) => {
      if (req.kind === 'list_instances') return ok({ instances: [] });
      if (req.kind === 'list_servers') return ok({ servers: [] });
      return capsFor('java');
    });
    render(<KernelPanel />);
    expect(await screen.findByText(/create_instance 创建/)).toBeTruthy();
    expect(screen.getByText('无服务端目录。')).toBeTruthy();
  });

  it('主进程返回错误时呈现错误（role=alert），不静默空白', async () => {
    kernelRead.mockImplementation(async (req: KernelReadReq) => {
      if (req.kind === 'list_instances') return fail('内核数据根目录未配置');
      if (req.kind === 'list_servers') return ok({ servers: [] });
      return capsFor('java');
    });
    render(<KernelPanel />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('内核数据根目录未配置');
  });

  it('主进程返回形状不对的 data 时当作错误处理，不把整屏打崩', async () => {
    // 这条对应「渲染层必须校验主进程 data 形状」：一个 undefined 的 servers
    // 如果被直接 setState，面板会整屏白掉且没有任何提示。
    kernelRead.mockImplementation(async (req: KernelReadReq) => {
      if (req.kind === 'list_instances') return ok({ instances: ['ok-instance'] });
      if (req.kind === 'list_servers') return ok({ wrongKey: [] });
      return capsFor('java');
    });
    render(<KernelPanel />);
    expect(await screen.findByText('ok-instance')).toBeTruthy();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('形状不符合契约');
  });

  it('IPC 抛异常（通道未注册）时也呈现错误而不是崩掉', async () => {
    kernelRead.mockRejectedValue(new Error('No handler registered for kernel:read'));
    render(<KernelPanel />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('No handler registered');
  });

  it('点「刷新」会重新拉一遍（幂等刷新，不是只在 mount 时取一次）', async () => {
    render(<KernelPanel />);
    await waitFor(() => expect(kernelRead).toHaveBeenCalled());
    const first = kernelRead.mock.calls.length;
    fireEvent.click(screen.getByLabelText('刷新内核状态'));
    await waitFor(() => expect(kernelRead.mock.calls.length).toBeGreaterThan(first));
  });

  it('面板里没有任何创建/删除/启动类的按钮（破坏性 kind 未暴露）', async () => {
    render(<KernelPanel />);
    await screen.findByText('inst-a');
    const forbidden = ['创建', '删除', '启动', '部署', '回滚', '停止'];
    const clickable = screen.getAllByRole('button');
    for (const btn of clickable) {
      const label = btn.textContent ?? '';
      for (const word of forbidden) {
        expect(label.includes(word), `按钮「${label}」不应含破坏性动作「${word}」`).toBe(false);
      }
    }
  });
});

describe('KernelPanel：服务端日志/配置查看（只读）', () => {
  function mockDetailServers(opts: {
    tail: unknown;
    text: unknown;
    serverId?: string;
    hasLogs?: boolean;
    hasConfig?: boolean;
  }) {
    const serverId = opts.serverId ?? 'srv-logs';
    kernelRead.mockImplementation(async (req: KernelReadReq) => {
      switch (req.kind) {
        case 'get_capabilities':
          return capsFor(String(req.payload['edition']));
        case 'list_instances':
          return ok({ instances: [] });
        case 'list_servers':
          return ok({
            servers: [
              { id: serverId, hasConfig: opts.hasConfig ?? true, hasLogs: opts.hasLogs ?? true },
            ],
          });
        case 'get_context_pack':
          return fail('暂无构建记录');
        case 'read_logs':
          return ok({ serverId, file: 'logs/latest.log', tail: opts.tail });
        case 'read_config':
          return ok({ serverId, file: 'server.properties', text: opts.text });
        default:
          return fail(`不该被调用: ${req.kind}`);
      }
    });
    return serverId;
  }

  it('点日志展开后调 read_logs 并以 <pre> 展示 tail（只取尾 50 行）', async () => {
    const tail60 = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`);
    const serverId = mockDetailServers({ tail: tail60, text: 'motd=x' });
    render(<KernelPanel />);
    const btn = (await screen.findByLabelText(`查看 ${serverId} 日志`)) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    const pre = await screen.findByText(/line-60/);
    expect(pre.tagName).toBe('PRE');
    const lines = (pre.textContent ?? '').split('\n');
    expect(lines).toHaveLength(50);
    expect(lines[0]).toBe('line-11');
    expect(lines[49]).toBe('line-60');
    const logCalls = kernelRead.mock.calls.filter(
      (c) => (c[0] as { kind: string }).kind === 'read_logs',
    );
    expect(logCalls.length).toBeGreaterThan(0);
    expect((logCalls[0][0] as { payload: { serverId: string } }).payload.serverId).toBe(serverId);
  });

  it('点配置展开后调 read_config 并以 <pre> 展示 text', async () => {
    const serverId = mockDetailServers({
      tail: ['a'],
      text: 'motd=hello-world\nmax-players=20',
    });
    render(<KernelPanel />);
    const btn = (await screen.findByLabelText(`查看 ${serverId} 配置`)) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    const pre = await screen.findByText(/motd=hello-world/);
    expect(pre.tagName).toBe('PRE');
    expect(pre.textContent ?? '').toContain('max-players=20');
    const cfgCalls = kernelRead.mock.calls.filter(
      (c) => (c[0] as { kind: string }).kind === 'read_config',
    );
    expect(cfgCalls.length).toBeGreaterThan(0);
    expect((cfgCalls[0][0] as { payload: { serverId: string } }).payload.serverId).toBe(serverId);
  });

  it('hasLogs/hasConfig 为 false 时对应按钮 disabled 并注明原因', async () => {
    // 沿用 beforeEach 默认：srv-a（有配置无日志）、srv-b（都没配）
    render(<KernelPanel />);
    const logsBtn = (await screen.findByLabelText('查看 srv-a 日志')) as HTMLButtonElement;
    expect(logsBtn.disabled).toBe(true);
    const configBtn = screen.getByLabelText('查看 srv-a 配置') as HTMLButtonElement;
    expect(configBtn.disabled).toBe(false);
    expect((await screen.findAllByText('无日志文件，日志不可查看')).length).toBeGreaterThan(0);
    const bConfigBtn = screen.getByLabelText('查看 srv-b 配置') as HTMLButtonElement;
    expect(bConfigBtn.disabled).toBe(true);
    expect(screen.getAllByText('无配置文件，配置不可查看').length).toBeGreaterThan(0);
    // 未展开前不调 read_logs/read_config（纯懒加载）
    await waitFor(() => expect(kernelRead).toHaveBeenCalled());
    const calledKinds = kernelRead.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(calledKinds).not.toContain('read_logs');
    expect(calledKinds).not.toContain('read_config');
  });

  it('日志/配置形状错误只记本节错误，不打崩整屏、不污染全局 error', async () => {
    const serverId = mockDetailServers({ tail: { wrongKey: [] }, text: { wrongKey: [] } });
    render(<KernelPanel />);
    expect(await screen.findByText(serverId)).toBeTruthy();
    fireEvent.click(screen.getByLabelText(`查看 ${serverId} 日志`));
    expect(await screen.findByText(/KernelReadLogsResponse/)).toBeTruthy();
    // 整屏未崩：服务端行仍在；全局 role=alert 未被污染
    expect(screen.getByText(serverId)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    fireEvent.click(screen.getByLabelText(`查看 ${serverId} 配置`));
    expect(await screen.findByText(/KernelReadConfigResponse/)).toBeTruthy();
    expect(screen.getByText(serverId)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
