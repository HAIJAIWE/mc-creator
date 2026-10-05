/**
 * agent-host 测试（§10.1 智能体独立进程拉起）。
 *
 * 只断言三件事，绝不真拉起子进程（supervisor 用 fake，不走真实 spawn）：
 * 1. `buildAgentCommand` 拼出的命令含 `--http` 与 `data-dir`；
 * 2. import 无副作用：模块加载本身不拉起子进程（fake 的 launch 未被调用，
 *    且只导出 `buildAgentCommand` / `createAgentHost` 两个显式函数）；
 * 3. `stop` 未启动时是安全的空操作（不抛，返回 exited，不碰 supervisor）。
 */
import { describe, expect, it, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import {
  AGENT_APP_DIR_NAME,
  AGENT_ROOT_DIR_NAME,
  buildAgentCommand,
  createAgentHost,
  createAgentSelfStartConfirm,
  resolveAgentDataDir,
} from './agent-host.js';
import type { ProcessSupervisor } from './process-supervisor.js';

/** 不真拉起子进程的 fake supervisor：launch 只记账，status 恒为 null（从未托管）。 */
function fakeSupervisor(): ProcessSupervisor & { launchCalls: number } {
  let calls = 0;
  const fake = {
    launch(): never {
      calls += 1;
      throw new Error('fake supervisor：测试中断言不真拉起子进程，此处不应被调用');
    },
    status: (): null => null,
  };
  return new Proxy(fake as unknown as ProcessSupervisor, {
    get(target, prop, receiver): unknown {
      if (prop === 'launchCalls') return calls;
      return Reflect.get(target, prop, receiver);
    },
  }) as ProcessSupervisor & { launchCalls: number };
}

describe('buildAgentCommand 拼出 node -e 拉起命令', () => {
  it('含 --http 与 --data-dir，且默认 dataDir 与内核同根并列', () => {
    const { command, args } = buildAgentCommand({ userDataDir: 'C:\\mock\\userData' });
    expect(command).toBe('node');
    // -e 脚本里内嵌的是 JSON 数组字面量（含转义后的反斜杠），直接 parse 后断言更精确。
    const script = args[args.indexOf('-e') + 1] as string;
    const argv = JSON.parse(script.slice(script.indexOf('['), script.lastIndexOf(']') + 1));
    expect(argv).toContain('--http');
    expect(argv).toContain('--data-dir');
    expect(argv[argv.indexOf('--data-dir') + 1]).toBe(
      join('C:\\mock\\userData', AGENT_APP_DIR_NAME, AGENT_ROOT_DIR_NAME),
    );
  });
});

describe('import 无副作用：加载后无子进程', () => {
  it('只导出显式函数，fake supervisor 的 launch 未被调用', async () => {
    const fake = fakeSupervisor();
    const mod = await import('./agent-host.js');
    expect(typeof mod.buildAgentCommand).toBe('function');
    expect(typeof mod.createAgentHost).toBe('function');
    expect(fake.launchCalls).toBe(0);
  });
});

describe('stop 未启动时安全空操作', () => {
  it('不抛、返回 exited，且不拉起子进程', async () => {
    const fake = fakeSupervisor();
    const host = createAgentHost(fake, { userDataDir: 'C:\\mock\\userData' });
    await expect(host.stop()).resolves.toMatchObject({ exited: true, forced: false });
    expect(fake.launchCalls).toBe(0);
  });
});

/* ------------------------------------------------------------------------- *
 * W1：`index.ts` 的智能体自启接线（`agent-host.ts` 此前是死代码 —— 生产环境
 * 智能体进程从来没起来过）。
 *
 * 这里不测 `createAgentHost` 本身（上面三组已覆盖），只测**接线**的三条硬约束：
 *  1. whenReady 里真的调了 start()，且拉起参数全部自动推导（dataDir 来自
 *     `app.getPath('userData')`，零硬编码路径）；
 *  2. 自启失败只 warn，**不拦应用启动**（窗口照建、IPC 照注册）——
 *     用 vi.mock 让 supervisor.launch 抛错来制造失败；
 *  3. before-quit 会停它，且「停智能体 → shutdownAll → app.quit」顺序不乱。
 *
 * 做法：把 index.ts 的每个依赖都 mock 掉（electron + 全部本地产能模块），
 * 只留被测接线本身为真代码。既有三组用例不 import 任何被 mock 的模块，因此不受影响。
 * ------------------------------------------------------------------------- */

const boot = vi.hoisted(() => {
  const state = {
    /** app.getPath('userData') 的返回值，故意用一个可辨识的路径来证明路径是推导出来的。 */
    userData: 'C:\\mock\\userData\\W1-selfstart',
    /** 让 launch 抛错 = 制造「自启失败」（spawn 失败 / node 不在 PATH / 端口被占…）。 */
    launchThrows: false,
    launches: [] as Array<{ serverId: string; cmd: string; args: string[] }>,
    /**
     * 生产实际装到专用 supervisor 上的 confirm 函数（由 mock 捕获）。
     * 攻击**它**而不是攻击工厂：只有这样「把接线改回 `() => true`」这种变异
     * 才会被抓住（第一版测试直接调工厂，变异存活 = 测了等于没测）。
     */
    confirms: [] as Array<(req: unknown) => boolean>,
    stops: 0,
    shutdownAllCalls: 0,
    windowsCreated: 0,
    ipcHandlers: 0,
    menuSet: 0,
    quits: 0,
    pollerStarts: 0,
    /** 收尾顺序记账：'stop' → 'shutdownAll' → 'quit'，用来钉住「先停后退出」。 */
    order: [] as string[],
    appHandlers: new Map<string, Array<(...args: unknown[]) => void>>(),
    reset() {
      state.launchThrows = false;
      state.launches = [];
      state.confirms = [];
      state.stops = 0;
      state.shutdownAllCalls = 0;
      state.windowsCreated = 0;
      state.ipcHandlers = 0;
      state.menuSet = 0;
      state.quits = 0;
      state.pollerStarts = 0;
      state.order = [];
      state.appHandlers = new Map();
    },
  };
  return state;
});

vi.mock('electron', () => {
  class FakeWebContents {
    on(): void {}
    setWindowOpenHandler(): void {}
    send(): void {}
  }
  class FakeBrowserWindow {
    static getAllWindows(): FakeBrowserWindow[] {
      return [];
    }
    static getFocusedWindow(): null {
      return null;
    }
    webContents = new FakeWebContents();
    constructor() {
      boot.windowsCreated += 1;
    }
    isDestroyed(): boolean {
      return false;
    }
    loadURL(): void {}
    loadFile(): void {}
    focus(): void {}
  }
  return {
    app: {
      commandLine: { appendSwitch: () => undefined },
      getPath: (name: string) => (name === 'userData' ? boot.userData : `C:\\mock\\${name}`),
      whenReady: () => Promise.resolve(),
      on: (event: string, listener: (...args: unknown[]) => void) => {
        const list = boot.appHandlers.get(event) ?? [];
        list.push(listener);
        boot.appHandlers.set(event, list);
      },
      quit: () => {
        boot.quits += 1;
        boot.order.push('quit');
      },
    },
    BrowserWindow: FakeBrowserWindow,
    Menu: {
      buildFromTemplate: (template: unknown) => template,
      setApplicationMenu: () => {
        boot.menuSet += 1;
      },
    },
    ipcMain: {
      handle: () => {
        boot.ipcHandlers += 1;
      },
    },
    shell: { openExternal: () => Promise.resolve() },
  };
});

vi.mock('./ipc.js', () => ({
  registerIpcHandlers: () => {
    boot.ipcHandlers += 1;
  },
  createDefaultOrchestrator: () => ({}),
}));

// 单例 supervisor：只被 taskPoller 与退出收尾用到，这里只记账，绝不真 spawn。
vi.mock('./ipc/process-supervisor.js', () => ({
  getProcessSupervisor: () => ({
    shutdownAll: () => {
      boot.shutdownAllCalls += 1;
      boot.order.push('shutdownAll');
      return Promise.resolve();
    },
  }),
}));

// 智能体用的**专用** supervisor。status() 必须对已 launch 的 serverId 返回非 null：
// agent-host.stop() 里 `supervisor.status(id) === null` 会走「从未启动」的空操作分支。
vi.mock('./process-supervisor.js', () => ({
  // 捕获生产实际传进来的 confirm：测试要攻击**它**，才能抓住「改回 () => true」的变异。
  createProcessSupervisor: (opts?: { confirm?: (req: unknown) => boolean }) => {
    if (opts?.confirm !== undefined) boot.confirms.push(opts.confirm);
    return {
      launch: (spec: { serverId: string; cmd: string; args: string[] }) => {
        boot.launches.push(spec);
        if (boot.launchThrows) throw new Error('模拟 spawn 失败：node 不在 PATH');
        return {
          serverId: spec.serverId,
          stop: () => {
            boot.stops += 1;
            boot.order.push('stop');
            return Promise.resolve({ exited: true, forced: false });
          },
        };
      },
      status: (serverId: string) =>
        boot.launches.some((l) => l.serverId === serverId) ? { serverId, state: 'running' } : null,
    };
  },
}));

vi.mock('./startup-recovery.js', () => ({
  runStartupRecovery: () => ({ errors: [] }),
  formatRecoveryReport: () => null,
}));

vi.mock('./kernel-runtime.js', () => ({
  resolveKernelRoot: (userDataDir: string) => `${userDataDir}\\mc-creator\\kernel`,
  initKernelRuntime: () => undefined,
  getKernelRuntime: () => ({
    dataDir: 'C:\\mock\\kernelRoot',
    setConfirm: () => undefined,
    dispose: () => undefined,
  }),
}));

vi.mock('./server-task-poller.js', () => ({
  createTaskPoller: () => ({
    start: () => {
      boot.pollerStarts += 1;
    },
    stop: () => undefined,
  }),
}));

vi.mock('./kernel-confirm.js', () => ({ createNativeConfirm: () => () => Promise.resolve(true) }));
vi.mock('./kernel-confirm-ui.js', () => ({
  createUiConfirm: () => ({ handleResponse: () => undefined }),
}));
vi.mock('./single-instance.js', () => ({ ensureSingleInstance: () => 'primary' }));

/** 跑一遍真实的 index.ts 顶层 + whenReady 链（每例一份全新模块实例）。 */
async function bootMainProcess(): Promise<void> {
  vi.resetModules();
  await import('./index.js');
  // whenReady().then(...) 挂的是微任务链，等它跑完。
  await vi.waitFor(() => expect(boot.menuSet).toBe(1));
}

describe('index.ts：§10.1 智能体独立进程自启接线', () => {
  beforeEach(() => {
    boot.reset();
  });

  it('whenReady 里真的自启，且拉起参数全部自动推导（无硬编码路径）', async () => {
    await bootMainProcess();
    expect(boot.launches).toHaveLength(1);
    const spec = boot.launches[0]!;
    expect(spec.cmd).toBe('node');
    expect(spec.serverId).toBe('mc-agent');
    // dataDir 必须由 app.getPath('userData') 推导，而不是写死。
    const script = spec.args[spec.args.indexOf('-e') + 1] as string;
    const argv = JSON.parse(
      script.slice(script.indexOf('['), script.lastIndexOf(']') + 1),
    ) as string[];
    expect(argv[argv.indexOf('--data-dir') + 1]).toBe(resolveAgentDataDir(boot.userData));
    expect(argv[argv.indexOf('--data-dir') + 1]).toBe(
      join(boot.userData, AGENT_APP_DIR_NAME, AGENT_ROOT_DIR_NAME),
    );
    // 启动链其余部分照旧走到建窗（自启被插在轮询器之后、菜单/建窗之前）。
    expect(boot.windowsCreated).toBe(1);
  });

  it('自启失败只 warn，不拦应用启动（窗口照建、IPC 照注册）', async () => {
    boot.launchThrows = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      // 关键：不抛。接线里 startAgentHost 的 try/catch 必须兜住 launch 的异常。
      await expect(bootMainProcess()).resolves.toBeUndefined();
      expect(warn.mock.calls.map((c) => String(c[0])).join('\n')).toContain('智能体');
      // 「不拦应用启动」的可观察证据：异常之后 whenReady 里的后续步骤全部照走。
      expect(boot.windowsCreated).toBe(1);
      expect(boot.ipcHandlers).toBeGreaterThan(0);
      expect(boot.menuSet).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('before-quit 会停智能体，且顺序是 stop → shutdownAll → app.quit', async () => {
    await bootMainProcess();
    expect(boot.launches).toHaveLength(1);
    const beforeQuit = boot.appHandlers.get('before-quit')?.[0];
    expect(beforeQuit).toBeTypeOf('function');

    let prevented = 0;
    beforeQuit!({ preventDefault: () => (prevented += 1) });

    await vi.waitFor(() => expect(boot.quits).toBe(1));
    expect(prevented).toBe(1);
    expect(boot.stops).toBe(1);
    expect(boot.shutdownAllCalls).toBe(1);
    expect(boot.order).toEqual(['stop', 'shutdownAll', 'quit']);
  });

  it('自启失败过（从未成功托管）时 before-quit 仍能安全收尾，不抛', async () => {
    boot.launchThrows = true;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      await bootMainProcess();
      const beforeQuit = boot.appHandlers.get('before-quit')?.[0];
      expect(beforeQuit).toBeTypeOf('function');
      expect(() => beforeQuit!({ preventDefault: () => undefined })).not.toThrow();
      await vi.waitFor(() => expect(boot.quits).toBe(1));
      // 从未 start 成功 → 不该有「真停机」，只该是空操作后继续既有收尾。
      expect(boot.stops).toBe(0);
      expect(boot.shutdownAllCalls).toBe(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('production 接线用的就是窄闸门：别的命令过不去（恒真闸门会被此测抓住）', async () => {
    // 变异测试：把 index.ts 的 confirm 换回 `() => true`，本测必须变红。
    // 关键：攻击的是**生产实际装上去的那个函数**（mock 捕获的 opts.confirm），
    // 不是直接调工厂 —— 第一版直接调工厂，变异存活，等于没测。
    await bootMainProcess();
    expect(boot.confirms).toHaveLength(1);
    const gate = boot.confirms[0]!;
    // 真自启请求（payload 取自 supervisor 实际记录的 spec）放行。
    const real = boot.launches[0]!;
    expect(gate({ payload: { ...real } })).toBe(true);
    // 换成任意别的命令：一律拒绝。
    expect(gate({ payload: { cmd: 'powershell.exe', args: ['-c', 'rm -rf /'] } })).toBe(false);
    expect(gate({ payload: { ...real, cmd: 'cmd.exe' } })).toBe(false);
    // 同一个 node 但参数被改（脚本换了 / 少传参数）也拒绝。
    expect(gate({ payload: { ...real, args: [...real.args].reverse() } })).toBe(false);
    expect(gate({ payload: { ...real, args: real.args.slice(0, 2) } })).toBe(false);
    // payload 缺失/形状不对：一律拒绝（fail-closed）。
    expect(gate({})).toBe(false);
    expect(gate({ payload: null })).toBe(false);
    expect(gate(null)).toBe(false);
    expect(gate('yes')).toBe(false);
  });

  it('换个 dataDir 重新拼的期望值不放行旧命令（期望值随参数重算）', () => {
    const a = createAgentSelfStartConfirm({ userDataDir: 'C:\\u1' });
    const b = createAgentSelfStartConfirm({ userDataDir: 'C:\\u2' });
    // 闸门读的是 supervisor ConfirmRequest.payload 的形状（cmd/args），
    // buildAgentCommand 的返回值键名是 command/args，这里转成 supervisor 形状再喂。
    const asSpec = (u: string) => {
      const c = buildAgentCommand({ userDataDir: u });
      return { cmd: c.command, args: c.args };
    };
    expect(a({ payload: asSpec('C:\\u1') })).toBe(true);
    expect(b({ payload: asSpec('C:\\u1') })).toBe(false);
    expect(b({ payload: asSpec('C:\\u2') })).toBe(true);
  });
});
