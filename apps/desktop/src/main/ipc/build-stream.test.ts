/**
 * `main/ipc/build.ts` 的 BUILD_STREAM（流式构建）分支测试。
 *
 * 为什么要专门测它：这条通道是**用户实际点的那个构建按钮**（BuildPanel 的流式构建），
 * 它自己 spawn `gradlew.bat`，不经 devkit 的 runGradleBuild，所以 §8.1 的 wrapper 自举
 * 必须在这里单独接一次（实测阻断：生成工程没有启动脚本 → ENOENT）。
 *
 * 断言两件事：
 *  1. 自举失败 → **不 spawn**，并把可读原因作为一条 stderr 推给渲染层（done=true）；
 *  2. 自举成功 → 才 spawn，且命令名与 cwd 正确。
 * 全 mock：不联网、不真下 Gradle、不真 spawn。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>();
const spawnCalls: Array<{ cmd: string; args: string[]; opts: unknown }> = [];
const sent: Array<{ channel: string; payload: unknown }> = [];
let wrapperResult: { ok: boolean; error?: string } = { ok: true };
let childStub: Record<string, unknown> = {};

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (e: unknown, raw: unknown) => unknown) => {
      handlers.set(channel, handler);
    },
    removeHandler: (channel: string) => {
      handlers.delete(channel);
    },
  },
  // registerBuildHandlers 末尾会 app.on('before-quit', …) 清理活跃构建子进程，
  // 所以 getPath 之外还得有 on（否则注册阶段就 TypeError，三条用例全红）。
  app: {
    getPath: () => 'C:\\mock\\userData',
    on: () => undefined,
  },
}));

vi.mock('node:child_process', () => {
  const spawn = (cmd: string, args: string[], opts: unknown) => {
    spawnCalls.push({ cmd, args, opts });
    return childStub;
  };
  // 依赖链里既有模块（core 侧）用 default 导入 child_process，
  // mock 只给具名 spawn 会在 import 阶段就炸：No "default" export is defined。
  return { spawn, default: { spawn } };
});

vi.mock('@mc-creator/devkit', () => ({
  ensureGradleWrapper: async () => wrapperResult,
}));

import { registerBuildHandlers } from './build.js';
import { BUILD_STREAM, BUILD_STREAM_CHUNK } from '../../shared/ipc-channels.js';

/** 造一个够用的 ChildProcess 桩：stdout/stderr 是 EventEmitter，close 可手动触发。 */
function makeChild(): Record<string, unknown> {
  const { EventEmitter } = require('node:events') as typeof import('node:events');
  // 经 unknown 中转：EventEmitter 没有字符串索引签名，直接断言成
  // Record<string, unknown> 会被 tsc 判为「无足够重叠」（TS2352）。
  const child = new EventEmitter() as unknown as Record<string, unknown>;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = (): void => undefined;
  return child;
}

/** 触发 BUILD_STREAM 并等它把 handler 里的 await 链跑完。 */
async function callStream(projectPath: string): Promise<void> {
  const handler = handlers.get(BUILD_STREAM);
  if (handler === undefined) throw new Error('BUILD_STREAM handler 未注册');
  const e = {
    sender: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
  };
  await handler(e, { projectPath, requestId: 'r1' });
}

describe('流式构建：Gradle wrapper 自举（W2 接线）', () => {
  beforeEach(() => {
    handlers.clear();
    spawnCalls.length = 0;
    sent.length = 0;
    wrapperResult = { ok: true };
    childStub = makeChild();
    registerBuildHandlers();
  });

  it('自举失败：不 spawn，把可读原因作为 stderr 推回（done=true）', async () => {
    wrapperResult = { ok: false, error: 'Gradle 8.12 不支持 JDK 26（最高支持 JDK 23）' };
    await callStream('D:\\proj');

    // 关键断言：宁可明确报错，也不 spawn 出一个更难懂的 ENOENT。
    expect(spawnCalls).toHaveLength(0);
    expect(sent).toHaveLength(1);
    const first = sent[0]!;
    expect(first.channel).toBe(BUILD_STREAM_CHUNK);
    const payload = first.payload as { type: string; text: string; done: boolean };
    expect(payload.type).toBe('stderr');
    expect(payload.text).toContain('Gradle wrapper 准备失败');
    expect(payload.text).toContain('不支持 JDK 26');
    expect(payload.done).toBe(true);
  });

  it('自举成功：才 spawn，且命令与 cwd 用请求里的 projectPath', async () => {
    await callStream('D:\\proj');

    expect(spawnCalls).toHaveLength(1);
    const call = spawnCalls[0]!;
    expect(call.opts).toMatchObject({ cwd: 'D:\\proj' });
    expect(call.cmd).toBe(process.platform === 'win32' ? 'gradlew.bat' : './gradlew');
    expect(call.args).toEqual(['build']);
    // 启动就绪，不该先抛一条 wrapper 错误
    expect(
      sent.every(
        (s) => !String((s.payload as { text?: string }).text ?? '').includes('wrapper 准备失败'),
      ),
    ).toBe(true);
  });

  it('自举失败时工程路径原样传下去（不能被改写或吞掉）', async () => {
    wrapperResult = { ok: false, error: 'boom' };
    // 用一个带空格与中文的路径，顺带钉住「不假设路径形态」
    await callStream('D:\\我的 工程\\demo mod');
    expect(sent[0]!.payload).toMatchObject({ type: 'stderr', done: true });
    expect(spawnCalls).toHaveLength(0);
  });
});
