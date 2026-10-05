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

  it('把 kind 白名单摆在明面上：R/W/X 可达状态与确认闸门说明一致', async () => {
    // 主代理裁决（§4.5）：X2b 起 W/X 经 kernel:execute+确认可达，旧文案
    // “写/执行 2 项已在主进程侧测通”已过期；断言意图（名单摆明面上）不变。
    render(<KernelPanel />);
    expect(await screen.findByText('list_instances')).toBeTruthy();
    expect(screen.getByText('create_instance')).toBeTruthy();
    expect(screen.getByText(/重启\/停止已在服务端行暴露按钮/)).toBeTruthy();
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

  it('破坏性按钮仅限重启/停止（服务端行，确认闸门覆盖；创建/删除等仍未暴露）', async () => {
    // 主代理裁决（§4.5）：X2b 起重启/停止按钮存在且走确认闸门；旧“零破坏性按钮”
    // 断言已过期。新不变量：创建/删除/部署/回滚类按钮仍不得出现，重启/停止必须出现。
    render(<KernelPanel />);
    await screen.findByText('inst-a');
    const labels = screen.getAllByRole('button').map((btn) => btn.textContent ?? '');
    for (const word of ['创建', '删除', '部署', '回滚']) {
      for (const label of labels) {
        expect(label.includes(word), `按钮「${label}」不应含未暴露动作「${word}」`).toBe(false);
      }
    }
    expect(
      labels.some((l) => l.includes('重启')),
      '应有重启按钮',
    ).toBe(true);
    expect(
      labels.some((l) => l.includes('停止')),
      '应有停止按钮',
    ).toBe(true);
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

describe('KernelPanel：服务端重启/停止（X2b，经 kernel:execute + 确认闸门）', () => {
  async function mockExecute(
    impl: (req: { kind: string; payload: { serverId: string } }) => unknown,
  ): Promise<ReturnType<typeof vi.fn>> {
    const mod = await import('../lib/ipc-client.js');
    const mocked = mod.ipcClient as unknown as Record<string, unknown>;
    const fn = vi.fn(impl);
    mocked['kernelExecute'] = fn;
    return fn;
  }

  function executeOk(kind: string) {
    return {
      ok: true,
      data: {},
      error: null,
      kind,
      permission: 'X',
      risk: 'execute',
      confirmRequested: true,
    };
  }

  it('重启按钮调 kernelExecute 并传对 serverId', async () => {
    const fn = await mockExecute(async (req) => executeOk(req.kind));
    render(<KernelPanel />);
    const btn = (await screen.findByLabelText('重启 srv-a')) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
    fireEvent.click(btn);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(fn.mock.calls[0]?.[0]).toEqual({
      kind: 'restart_server',
      payload: { serverId: 'srv-a' },
    });
  });

  it('停止按钮调 kernelExecute 并传对 serverId', async () => {
    const fn = await mockExecute(async (req) => executeOk(req.kind));
    render(<KernelPanel />);
    const btn = (await screen.findByLabelText('停止 srv-b')) as HTMLButtonElement;
    fireEvent.click(btn);
    await waitFor(() => expect(fn).toHaveBeenCalledTimes(1));
    expect(fn.mock.calls[0]?.[0]).toEqual({
      kind: 'stop_server',
      payload: { serverId: 'srv-b' },
    });
  });

  it('执行失败时进本节错误条，不打崩整屏', async () => {
    await mockExecute(async (req) => ({
      ok: false,
      data: null,
      error: {
        category: 'permission',
        message: '用户取消了确认',
        code: 'KERNEL_CONFIRM_DENIED',
        retryable: false,
      },
      kind: req.kind,
      permission: 'X',
      risk: 'execute',
      confirmRequested: true,
    }));
    render(<KernelPanel />);
    const btn = await screen.findByLabelText('停止 srv-a');
    fireEvent.click(btn);
    expect(await screen.findByText('用户取消了确认')).toBeTruthy();
    // 整屏未崩：服务端行仍在
    expect(screen.getByText('srv-a')).toBeTruthy();
    expect(screen.getByText('srv-b')).toBeTruthy();
  });
});

/**
 * W1：`ServerConsole` 此前全仓无任何组件引用（只有它自己的测试渲染它）= 死代码。
 * 这一组钉死接线后的两条硬约束：懒挂载（不展开就不渲染/不轮询）与单槽（同时至多一个）。
 *
 * 断言用 `ServerConsole` 自带的 `data-testid`（console-status / console-file /
 * console-tail），不用 `.xterm` 选择器：复核源码后该组件是 `<pre>` 轮询渲染，
 * 并不引入 xterm（任务书里「自带 xterm」的说法与当前源码不符，见交付说明）。
 */
describe('KernelPanel：服务端控制台（W1 接死代码 ServerConsole）', () => {
  /** 两台服务端，read_logs 各自回不同 file/tail，便于分辨当前挂着的是哪一个实例。 */
  function mockConsoleServers(ids: string[]) {
    kernelRead.mockImplementation(async (req: KernelReadReq) => {
      switch (req.kind) {
        case 'get_capabilities':
          return capsFor(String(req.payload['edition']));
        case 'list_instances':
          return ok({ instances: [] });
        case 'list_servers':
          return ok({ servers: ids.map((id) => ({ id, hasConfig: true, hasLogs: true })) });
        case 'get_context_pack':
          return fail('暂无构建记录');
        case 'read_logs': {
          const serverId = String((req.payload as { serverId: string }).serverId);
          return ok({ serverId, file: `logs/${serverId}.log`, tail: [`${serverId}-行-1`] });
        }
        default:
          return fail(`不该被调用: ${req.kind}`);
      }
    });
  }

  function readLogsCalls(): string[] {
    return kernelRead.mock.calls
      .filter((c) => (c[0] as { kind: string }).kind === 'read_logs')
      .map((c) => (c[0] as { payload: { serverId: string } }).payload.serverId);
  }

  it('懒挂载：未展开时控制台不在 DOM 里、也不调 read_logs；点开后就地出现', async () => {
    mockConsoleServers(['srv-x']);
    render(<KernelPanel />);
    const btn = await screen.findByLabelText('查看 srv-x 控制台');
    expect(btn.getAttribute('aria-expanded')).toBe('false');

    // 未展开：组件未挂载（无它自带的任何 testid），且一次 read_logs 都没发。
    expect(screen.queryByTestId('console-status')).toBeNull();
    expect(screen.queryByTestId('console-file')).toBeNull();
    expect(readLogsCalls()).toEqual([]);

    fireEvent.click(btn);
    // 展开后就地渲染，且开始按 serverId 轮询只读 read_logs。
    expect(await screen.findByTestId('console-status')).toBeTruthy();
    expect(screen.getByTestId('console-file').textContent).toBe('logs/srv-x.log');
    expect(screen.getByTestId('console-tail').textContent).toContain('srv-x-行-1');
    await waitFor(() => expect(readLogsCalls()).toEqual(['srv-x']));
    expect(screen.getByLabelText('查看 srv-x 控制台').getAttribute('aria-expanded')).toBe('true');

    // 再点一次 = 收起：组件卸载、轮询随之停止（不新增 read_logs 调用）。
    const callsBefore = readLogsCalls().length;
    fireEvent.click(screen.getByLabelText('查看 srv-x 控制台'));
    expect(screen.queryByTestId('console-status')).toBeNull();
    expect(readLogsCalls()).toHaveLength(callsBefore);
  });

  it('单槽：开第二个控制台时第一个卸载，同一时刻只有一个实例', async () => {
    mockConsoleServers(['srv-a1', 'srv-b1']);
    render(<KernelPanel />);
    const first = await screen.findByLabelText('查看 srv-a1 控制台');
    fireEvent.click(first);
    expect(await screen.findByTestId('console-file')).toBeTruthy();
    expect(screen.getByTestId('console-file').textContent).toBe('logs/srv-a1.log');
    expect(screen.getAllByTestId('console-status')).toHaveLength(1);

    // 点第二台：旧的必须卸载（否则就是两个 5s 轮询同时跑）。
    fireEvent.click(screen.getByLabelText('查看 srv-b1 控制台'));
    await waitFor(() =>
      expect(screen.getByTestId('console-file').textContent).toBe('logs/srv-b1.log'),
    );
    expect(screen.getAllByTestId('console-status')).toHaveLength(1);
    expect(screen.queryByText('logs/srv-a1.log')).toBeNull();
    // 两台的 aria-expanded 状态也必须互斥（单槽的可见证据）。
    expect(screen.getByLabelText('查看 srv-a1 控制台').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByLabelText('查看 srv-b1 控制台').getAttribute('aria-expanded')).toBe('true');
  });

  it('控制台只读：展开它不发任何 kernel:execute（不碰确认闸门）', async () => {
    mockConsoleServers(['srv-ro']);
    const mod = await import('../lib/ipc-client.js');
    const mocked = mod.ipcClient as unknown as Record<string, unknown>;
    const execute = vi.fn();
    mocked['kernelExecute'] = execute;
    render(<KernelPanel />);
    fireEvent.click(await screen.findByLabelText('查看 srv-ro 控制台'));
    await screen.findByTestId('console-status');
    expect(execute).not.toHaveBeenCalled();
  });
});
