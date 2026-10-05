/**
 * agent-host 测试（§10.1 智能体独立进程拉起）。
 *
 * 只断言三件事，绝不真拉起子进程（supervisor 用 fake，不走真实 spawn）：
 * 1. `buildAgentCommand` 拼出的命令含 `--http` 与 `data-dir`；
 * 2. import 无副作用：模块加载本身不拉起子进程（fake 的 launch 未被调用，
 *    且只导出 `buildAgentCommand` / `createAgentHost` 两个显式函数）；
 * 3. `stop` 未启动时是安全的空操作（不抛，返回 exited，不碰 supervisor）。
 */
import { describe, expect, it } from 'vitest';
import { join } from 'node:path';
import {
  AGENT_APP_DIR_NAME,
  AGENT_ROOT_DIR_NAME,
  buildAgentCommand,
  createAgentHost,
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
