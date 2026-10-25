/**
 * L1「实例注册表」在**主进程侧**的接线测试。
 *
 * 与 `launcher-log-ipc.test.ts` 共用同一套 electron mock 思路：
 * `vi.mock('electron')` 把 `ipcMain.handle` 收进 Map，直接调 handler，
 * 避免真的起 Electron。
 *
 * 重点不是「handler 存在」，而是三条语义：
 *  1. `clientReady` 是**派生**的（现场看 jar 在不在），不是注册表里存的陈旧值；
 *  2. `update` 打到不存在的实例必须**报错**，不能返回 ok —— 主键拼错静默成功最坑人；
 *  3. `deleteFiles: true` 才是破坏性操作，且只删该实例自己的两个子树，
 *     公共目录（assets / libraries）绝不能动。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, raw: unknown) => unknown>(),
  userData: '',
  openPath: vi.fn(async (_p: string) => ''),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw: unknown) => unknown) => {
      h.handlers.set(ch, fn);
    },
    on: () => undefined,
    removeHandler: (ch: string) => {
      h.handlers.delete(ch);
    },
  },
  dialog: { showOpenDialog: vi.fn(), showMessageBox: vi.fn() },
  app: { getPath: () => h.userData, on: () => undefined },
  shell: { openPath: h.openPath },
}));

import { registerLauncherHandlers } from './ipc/launcher.js';
import { InstanceRegistry } from './instance-registry.js';
import {
  LAUNCHER_CREATE_INSTANCE,
  LAUNCHER_DELETE_INSTANCE,
  LAUNCHER_LIST_INSTANCES,
  LAUNCHER_OPEN_INSTANCE_FOLDER,
  LAUNCHER_UPDATE_INSTANCE,
} from '../shared/ipc-channels.js';

const VER = '26.2';

let dir: string;

function invoke<T>(channel: string, raw: unknown = {}): Promise<T> {
  const fn = h.handlers.get(channel);
  if (!fn) throw new Error(`${channel} handler 未注册`);
  return Promise.resolve(fn({ sender: {} }, raw)) as Promise<T>;
}

interface ListRes {
  instances: {
    id: string;
    versionId: string;
    clientReady: boolean;
    username?: string;
    memory?: string;
  }[];
  error: string | null;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-l1-ipc-'));
  h.userData = dir;
  h.handlers.clear();
  registerLauncherHandlers();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 注册表存在 `<userData>/mc-launcher/instances.json` */
const registry = () => new InstanceRegistry(join(dir, 'mc-launcher'));

describe('L1 IPC · LIST_INSTANCES', () => {
  it('空注册表返回空数组而非抛', async () => {
    const res = await invoke<ListRes>(LAUNCHER_LIST_INSTANCES);
    expect(res.instances).toEqual([]);
    expect(res.error).toBeNull();
  });

  it('clientReady 随磁盘上的客户端 jar 实时变化（派生字段，不是陈旧快照）', async () => {
    registry().create({ versionId: VER });
    const jar = join(dir, 'mc-launcher', 'versions', VER, `${VER}.jar`);

    expect((await invoke<ListRes>(LAUNCHER_LIST_INSTANCES)).instances[0]?.clientReady).toBe(false);

    mkdirSync(join(dir, 'mc-launcher', 'versions', VER), { recursive: true });
    writeFileSync(jar, 'PK');
    expect((await invoke<ListRes>(LAUNCHER_LIST_INSTANCES)).instances[0]?.clientReady).toBe(true);

    // 删掉 jar 后必须立刻翻回 false —— 证明是现场算的而非创建时快照的
    rmSync(jar);
    expect((await invoke<ListRes>(LAUNCHER_LIST_INSTANCES)).instances[0]?.clientReady).toBe(false);
  });

  it('带出 username / memory 等实例字段', async () => {
    registry().create({ versionId: VER, username: 'Alex', memory: '4G' });
    const [inst] = (await invoke<ListRes>(LAUNCHER_LIST_INSTANCES)).instances;
    expect(inst?.username).toBe('Alex');
    expect(inst?.memory).toBe('4G');
  });
});

describe('L1 IPC · CREATE_INSTANCE', () => {
  it('创建成功返回 instance', async () => {
    const res = await invoke<{
      ok: boolean;
      instance: { id: string; versionId: string } | null;
      error: string | null;
    }>(LAUNCHER_CREATE_INSTANCE, { versionId: VER, name: '测试实例' });
    expect(res.ok).toBe(true);
    // id = **实例名**，不再是版本号（多实例）
    expect(res.instance?.id).toBe('测试实例');
    expect(res.instance?.versionId).toBe(VER);
    expect(registry().list()).toHaveLength(1);
  });

  it('★ 同版本不同名 → 两个独立实例（这正是多实例）', async () => {
    await invoke(LAUNCHER_CREATE_INSTANCE, { versionId: VER, name: 'A' });
    await invoke(LAUNCHER_CREATE_INSTANCE, { versionId: VER, name: 'B' });
    const list = registry().list();
    expect(list.map((i) => i.id).sort()).toEqual(['A', 'B']);
    // 版本产物共享，游戏数据隔离
    expect(new Set(list.map((i) => i.versionId))).toEqual(new Set([VER]));
    expect(list[0]?.gameDir).not.toBe(list[1]?.gameDir);
  });

  it('同名重复创建是幂等覆盖，不产生第二条', async () => {
    await invoke(LAUNCHER_CREATE_INSTANCE, { versionId: VER, name: 'A' });
    await invoke(LAUNCHER_CREATE_INSTANCE, { versionId: VER, name: 'A' });
    expect(registry().list()).toHaveLength(1);
  });

  it('缺 versionId 返回 ok:false + 错误信息，不抛异常穿出 IPC', async () => {
    const res = await invoke<{ ok: boolean; error: string | null }>(LAUNCHER_CREATE_INSTANCE, {});
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it('username 经 IPC 传入能被保留（曾经被 setIf 白名单静默丢弃）', async () => {
    await invoke(LAUNCHER_CREATE_INSTANCE, { versionId: VER, username: 'Alex' });
    expect(registry().list()[0]?.username).toBe('Alex');
  });
});

describe('L1 IPC · UPDATE_INSTANCE', () => {
  beforeEach(() => {
    // id = 实例名（不再是版本号）
    registry().create({ versionId: VER, name: '原名', memory: '2G' });
  });

  it('局部更新：只覆盖传入的键', async () => {
    const res = await invoke<{
      ok: boolean;
      instance: { name: string; memory?: string } | null;
    }>(LAUNCHER_UPDATE_INSTANCE, { id: '原名', patch: { memory: '6G' } });
    expect(res.ok).toBe(true);
    expect(res.instance?.memory).toBe('6G');
    expect(res.instance?.name).toBe('原名'); // 没传的键保持原值
  });

  it('⚠️ 改名改不动：name 必须等于 id（= 目录名）', async () => {
    const res = await invoke<{ ok: boolean; instance: { name: string } | null }>(
      LAUNCHER_UPDATE_INSTANCE,
      { id: '原名', patch: { name: '新名' } },
    );
    expect(res.ok).toBe(true);
    // 改了名字但目录没动的话，用户以后按界面名字去磁盘上找不到存档
    expect(res.instance?.name).toBe('原名');
  });

  it('实例不存在必须报错，不能静默 ok（主键拼错最坑人）', async () => {
    const res = await invoke<{ ok: boolean; instance: unknown; error: string | null }>(
      LAUNCHER_UPDATE_INSTANCE,
      { id: '不存在的实例', patch: { name: 'x' } },
    );
    expect(res.ok).toBe(false);
    expect(res.instance).toBeNull();
    expect(res.error).toMatch(/不存在/);
  });

  it('patch 里带 id / versionId 也改不动主键', async () => {
    await invoke(LAUNCHER_UPDATE_INSTANCE, {
      id: VER,
      patch: { versionId: '别的版本' } as Record<string, string>,
    });
    expect(registry().list()[0]?.versionId).toBe(VER);
  });
});

describe('L1 IPC · DELETE_INSTANCE', () => {
  beforeEach(() => {
    registry().create({ versionId: VER });
    const root = join(dir, 'mc-launcher');
    mkdirSync(join(root, 'versions', VER), { recursive: true });
    mkdirSync(join(root, 'game', VER, 'saves'), { recursive: true });
    writeFileSync(join(root, 'game', VER, 'saves', 'world.dat'), 'data');
    // 公共目录：绝不能被实例删除波及
    mkdirSync(join(root, 'assets'), { recursive: true });
    writeFileSync(join(root, 'assets', 'index.bin'), 'shared');
  });

  it('默认只删记录，不动磁盘（存档是用户数据）', async () => {
    const res = await invoke<{ ok: boolean; filesDeleted: boolean }>(LAUNCHER_DELETE_INSTANCE, {
      id: VER,
    });
    expect(res.ok).toBe(true);
    expect(res.filesDeleted).toBe(false);
    expect(registry().list()).toHaveLength(0);
    expect(existsSync(join(dir, 'mc-launcher', 'game', VER, 'saves', 'world.dat'))).toBe(true);
  });

  it('deleteFiles:true 才删磁盘，且只删该实例的两个子树', async () => {
    const res = await invoke<{ ok: boolean; filesDeleted: boolean }>(LAUNCHER_DELETE_INSTANCE, {
      id: VER,
      deleteFiles: true,
    });
    expect(res.filesDeleted).toBe(true);
    expect(existsSync(join(dir, 'mc-launcher', 'game', VER))).toBe(false);
    expect(existsSync(join(dir, 'mc-launcher', 'versions', VER))).toBe(false);
    // 公共目录必须还在
    expect(existsSync(join(dir, 'mc-launcher', 'assets', 'index.bin'))).toBe(true);
  });

  it('删不存在的实例返回 ok:false（UI 不该显示「删除成功」而列表纹丝不动）', async () => {
    const res = await invoke<{ ok: boolean; filesDeleted: boolean; error: string | null }>(
      LAUNCHER_DELETE_INSTANCE,
      { id: '幽灵' },
    );
    expect(res.ok).toBe(false);
    expect(res.filesDeleted).toBe(false);
    expect(res.error).toMatch(/不存在/);
  });
});

describe('L1 IPC · OPEN_INSTANCE_FOLDER', () => {
  beforeEach(() => {
    h.openPath.mockClear();
    h.openPath.mockResolvedValue('');
  });

  it('按记录里的 gameDir 打开目录；目录不存在时先创建', async () => {
    const inst = registry().create({ versionId: VER, name: '我的空岛' });
    const expected = inst.gameDir!;
    expect(existsSync(expected)).toBe(false);

    const res = await invoke<{ ok: boolean; path: string | null; error: string | null }>(
      LAUNCHER_OPEN_INSTANCE_FOLDER,
      { id: inst.id },
    );

    expect(res.ok).toBe(true);
    expect(res.path).toBe(expected);
    expect(existsSync(expected)).toBe(true);
    expect(h.openPath).toHaveBeenCalledWith(expected);
  });

  it('实例不存在时返回 ok:false，不调用 shell.openPath', async () => {
    const res = await invoke<{ ok: boolean; path: string | null; error: string | null }>(
      LAUNCHER_OPEN_INSTANCE_FOLDER,
      { id: '幽灵' },
    );
    expect(res.ok).toBe(false);
    expect(res.path).toBeNull();
    expect(res.error).toMatch(/不存在/);
    expect(h.openPath).not.toHaveBeenCalled();
  });

  it('系统打开失败时把错误原样带回（不谎报成功）', async () => {
    const inst = registry().create({ versionId: VER });
    h.openPath.mockResolvedValue('拒绝访问');

    const res = await invoke<{ ok: boolean; path: string | null; error: string | null }>(
      LAUNCHER_OPEN_INSTANCE_FOLDER,
      { id: inst.id },
    );
    expect(res.ok).toBe(false);
    expect(res.path).toBe(inst.gameDir);
    expect(res.error).toBe('拒绝访问');
  });
});
