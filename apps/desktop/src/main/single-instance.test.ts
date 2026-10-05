// @vitest-environment node
/**
 * §4.1 单实例锁 + 深链协议测试。
 *
 * `app` 全注入 fake，零 Electron import（single-instance.ts 自身也不 import
 * electron，见其文件头注释）。
 *
 * 覆盖矩阵（任务书点名的四件事）：
 *  - 拿不到锁 → 返回 quit，且不注册回调、不注册协议；
 *  - 拿到锁 → 返回 primary，并注册协议 `mc-creator`；
 *  - second-instance（Windows：协议 URL 进 argv）→ 触发 onSecondInstance；
 *  - open-url（macOS）→ 解析出 URL 并透传给 onSecondInstance。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DEEP_LINK_PROTOCOL,
  ensureSingleInstance,
  findDeepLinkUrl,
  type SingleInstanceApp,
} from './single-instance.js';

function makeFakeApp(gotLock: boolean): {
  app: SingleInstanceApp;
  listeners: Map<string, (...args: any[]) => void>;
} {
  const listeners = new Map<string, (...args: any[]) => void>();
  const app: SingleInstanceApp = {
    requestSingleInstanceLock: vi.fn(() => gotLock),
    hasSingleInstanceLock: vi.fn(() => gotLock),
    on: vi.fn((event: string, listener: (...args: any[]) => void) => {
      listeners.set(event, listener);
      return app;
    }),
    setAsDefaultProtocolClient: vi.fn((_protocol: string) => true),
    quit: vi.fn(() => undefined),
  };
  return { app, listeners };
}

afterEach(() => {
  vi.restoreAllMocks();
});

/** 实现里用 console.log 落日志：触发回调的用例先静音，保持测试输出干净。 */
function silenceLogs(): void {
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
}

describe('ensureSingleInstance：拿不到锁', () => {
  it('返回 quit，且不注册任何回调、不注册协议', () => {
    const { app } = makeFakeApp(false);
    const onSecondInstance = vi.fn();

    const role = ensureSingleInstance({ app, onSecondInstance });

    expect(role).toBe('quit');
    expect(app.on).not.toHaveBeenCalled();
    expect(app.setAsDefaultProtocolClient).not.toHaveBeenCalled();
    expect(onSecondInstance).not.toHaveBeenCalled();
  });
});

describe('ensureSingleInstance：拿到锁', () => {
  it('返回 primary，并注册协议 mc-creator 与两个事件回调', () => {
    const { app, listeners } = makeFakeApp(true);

    const role = ensureSingleInstance({ app, onSecondInstance: () => undefined });

    expect(role).toBe('primary');
    expect(app.setAsDefaultProtocolClient).toHaveBeenCalledWith(DEEP_LINK_PROTOCOL);
    expect(DEEP_LINK_PROTOCOL).toBe('mc-creator');
    expect(app.on).toHaveBeenCalledWith('second-instance', expect.any(Function));
    expect(app.on).toHaveBeenCalledWith('open-url', expect.any(Function));
    expect(listeners.has('second-instance')).toBe(true);
    expect(listeners.has('open-url')).toBe(true);
  });
});

describe('second-instance（Windows：协议 URL 进 argv）', () => {
  it('argv 里带 mc-creator:// URL → onSecondInstance 收到该 URL', () => {
    silenceLogs();
    const { app, listeners } = makeFakeApp(true);
    const onSecondInstance = vi.fn();
    ensureSingleInstance({ app, onSecondInstance });

    const url = 'mc-creator://open?path=hello';
    listeners.get('second-instance')!({}, ['mc-creator.exe', '--some-flag', url], 'C:\\work');

    expect(onSecondInstance).toHaveBeenCalledTimes(1);
    expect(onSecondInstance).toHaveBeenCalledWith(url);
  });

  it('argv 里没有协议 URL → onSecondInstance(undefined)，调用方只做聚焦', () => {
    silenceLogs();
    const { app, listeners } = makeFakeApp(true);
    const onSecondInstance = vi.fn();
    ensureSingleInstance({ app, onSecondInstance });

    listeners.get('second-instance')!({}, ['mc-creator.exe', '--some-flag'], 'C:\\work');

    expect(onSecondInstance).toHaveBeenCalledTimes(1);
    expect(onSecondInstance).toHaveBeenCalledWith(undefined);
  });
});

describe('open-url（macOS）', () => {
  it('解析出 URL 并透传给 onSecondInstance，同时 preventDefault', () => {
    silenceLogs();
    const { app, listeners } = makeFakeApp(true);
    const onSecondInstance = vi.fn();
    ensureSingleInstance({ app, onSecondInstance });

    const event = { preventDefault: vi.fn() };
    const url = 'mc-creator://open?path=from-mac';
    listeners.get('open-url')!(event, url);

    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(onSecondInstance).toHaveBeenCalledTimes(1);
    expect(onSecondInstance).toHaveBeenCalledWith(url);
  });
});

describe('findDeepLinkUrl：argv 解析', () => {
  it('只认 `<protocol>://` 前缀，其余参数忽略；找不到返回 undefined', () => {
    expect(findDeepLinkUrl(['a.exe', 'mc-creator://open?path=x', '--flag'], 'mc-creator')).toBe(
      'mc-creator://open?path=x',
    );
    expect(findDeepLinkUrl(['a.exe', '--flag', 'C:\\foo\\mc-creator.txt'], 'mc-creator')).toBe(
      undefined,
    );
    expect(findDeepLinkUrl([], 'mc-creator')).toBe(undefined);
  });

  it('自定义 protocol 生效（前缀按传入的 protocol 拼）', () => {
    expect(findDeepLinkUrl(['x', 'other://a'], 'other')).toBe('other://a');
    expect(findDeepLinkUrl(['x', 'mc-creator://a'], 'other')).toBe(undefined);
  });
});
