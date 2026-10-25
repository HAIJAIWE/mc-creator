/**
 * 皮肤库 IPC 接线回归（§5.9）。
 *
 * 与 `launcher-mods-ipc.test.ts` 同构：只验「通道注册了、请求 schema 收得住、
 * handler 不把脏数据写进磁盘」。真正的 PNG 校验 / loadlist 顺序在
 * `skin-library.test.ts` 里。
 *
 * 这里特意盯的三件事：
 * 1. 通道名字符串 —— 主进程注册键与 preload invoke 的字面量必须是同一个。
 * 2. `LAUNCHER_SKIN_READ_PNG` —— 预览通道会把磁盘上的字节读进渲染进程，
 *    id 校验必须挡住穿越，否则等于任意文件读取。
 * 3. `LAUNCHER_PICK_FILES` —— 用户取消时返回空数组，不抛。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const h = vi.hoisted(() => ({
  handlers: new Map<string, (e: unknown, raw: unknown) => unknown>(),
  userData: '',
  openDialog: vi.fn(),
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
  dialog: {
    showOpenDialog: h.openDialog,
    showMessageBox: vi.fn(),
  },
  app: { getPath: () => h.userData, on: () => undefined },
}));

import { registerLauncherHandlers } from './ipc/launcher.js';
import { SkinLibrary } from './skin-library.js';
import { InstanceRegistry } from './instance-registry.js';
import {
  LAUNCHER_SKIN_LIST,
  LAUNCHER_SKIN_ADD_LOCAL,
  LAUNCHER_SKIN_ADD_URL,
  LAUNCHER_SKIN_ADD_MINESKIN,
  LAUNCHER_SKIN_REMOVE,
  LAUNCHER_SKIN_UPDATE,
  LAUNCHER_SKIN_MINESKIN_PAGE,
  LAUNCHER_SKIN_APPLY,
  LAUNCHER_SKIN_UNAPPLY,
  LAUNCHER_SKIN_LIST_APPLIED,
  LAUNCHER_SKIN_READ_PNG,
  LAUNCHER_PICK_FILES,
} from '../shared/ipc-channels.js';

/** 合法 PNG 头（64×64）。内容随便 —— 只看魔数与尺寸。 */
function png(width = 64, height = 64): Buffer {
  const b = Buffer.alloc(64, 0xab);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

let root: string;

/** 调 handler。返回其返回值，不吞异常。 */
function call(ch: string, raw: unknown): unknown {
  const fn = h.handlers.get(ch);
  if (!fn) throw new Error(`通道未注册: ${ch}`);
  return fn({}, raw);
}

beforeEach(() => {
  // 顺序要紧：handler 里 `new SkinLibrary(join(launcherDir, 'skins'))` 是
  // **注册时**求值一次并捕获的，不像别的 handler 那样每次调用重读
  // `app.getPath('userData')`。所以必须先落定 userData 再注册，
  // 而且每条用例都要重来一遍（换 userData 就得重新注册）。
  root = mkdtempSync(join(tmpdir(), 'skin-ipc-'));
  h.userData = root;
  h.handlers.clear();
  registerLauncherHandlers();
  h.openDialog.mockReset();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/**
 * handler 手里的那个库的 baseDir。
 *
 * 与 `ipc/launcher.ts` 的 `join(launcherDir, 'skins')` 对应，
 * 而 launcherDir = `<userData>/mc-launcher`。
 */
function handlerLibDir(): string {
  return join(h.userData, 'mc-launcher', 'skins');
}

/**
 * 建一个已注册实例，返回它的 id（= 目录名 = 显示名）。
 *
 * 为什么必须先建：apply 链路上 `requireInstance()` 排在
 * `applySkinToInstance()`（也就是玩家名校验所在）**前面**。
 * 没有实例的话请求会先死在「实例不存在」，玩家名穿越那条防护根本没被执行到 ——
 * 测试会绿，但防护没被验证过。
 */
function seedInstance(versionId = '26.2'): string {
  const inst = new InstanceRegistry(join(h.userData, 'mc-launcher')).create({ versionId });
  return inst.id;
}

describe('皮肤 IPC 通道注册', () => {
  it('11 个皮肤通道全部有 handler', () => {
    const channels = [
      LAUNCHER_SKIN_LIST,
      LAUNCHER_SKIN_ADD_LOCAL,
      LAUNCHER_SKIN_ADD_URL,
      LAUNCHER_SKIN_ADD_MINESKIN,
      LAUNCHER_SKIN_REMOVE,
      LAUNCHER_SKIN_UPDATE,
      LAUNCHER_SKIN_MINESKIN_PAGE,
      LAUNCHER_SKIN_APPLY,
      LAUNCHER_SKIN_UNAPPLY,
      LAUNCHER_SKIN_LIST_APPLIED,
      LAUNCHER_SKIN_READ_PNG,
      LAUNCHER_PICK_FILES,
    ];
    const missing = channels.filter((c) => !h.handlers.has(c));
    expect(missing).toEqual([]);
  });

  it('通道名与 preload/渲染层 invoke 的字面量一致', () => {
    // 硬编码字符串是故意的：要钉住的正是「注册键」与「invoke 字面量」同一个，
    // 防止有人改了常量值却只改一侧。
    expect(LAUNCHER_SKIN_READ_PNG).toBe('launcher:skinReadPng');
    expect(LAUNCHER_PICK_FILES).toBe('launcher:pickFiles');
    expect(LAUNCHER_SKIN_ADD_URL).toBe('launcher:skinAddUrl');
  });
});

describe('LAUNCHER_SKIN_READ_PNG：预览通道不能变成任意文件读取', () => {
  it('合法 id 返回 data URL（渲染层靠它做 2D/3D 预览）', async () => {
    const lib = new SkinLibrary(handlerLibDir());
    const entry = lib.add({ png: png(), name: '测试', source: 'file' });

    const res = (await call(LAUNCHER_SKIN_READ_PNG, { id: entry.id })) as {
      dataUrl: string | null;
      error: string | null;
    };
    // 显式断言 data URL 的字节与原 PNG 一致（base64 往返），而不是只断言
    // 「非空」—— 形状对了内容错了照样是 bug。
    expect(res.error).toBeNull();
    expect(res.dataUrl).toMatch(/^data:image\/png;base64,/);
    const b64 = res.dataUrl!.split(',')[1]!;
    expect(Buffer.from(b64, 'base64').equals(png())).toBe(true);
  });

  it('id 含路径穿越时被拒，不返回任何字节', async () => {
    const res = (await call(LAUNCHER_SKIN_READ_PNG, { id: '../../secret' })) as {
      dataUrl: string | null;
      error: string | null;
    };
    expect(res.dataUrl).toBeNull();
    expect(res.error).toBeTruthy();
  });

  it('id 为空串被 schema 拒绝', async () => {
    const res = (await call(LAUNCHER_SKIN_READ_PNG, { id: '' })) as {
      dataUrl: string | null;
      error: string | null;
    };
    expect(res.dataUrl).toBeNull();
    expect(res.error).toBeTruthy();
  });

  it('id 不带 ../ 但库里没有该文件时也报缺文件（不返回空 data URL）', async () => {
    const res = (await call(LAUNCHER_SKIN_READ_PNG, { id: 'sNotThere' })) as {
      dataUrl: string | null;
      error: string | null;
    };
    expect(res.dataUrl).toBeNull();
    expect(res.error).toBeTruthy();
  });
});

describe('LAUNCHER_PICK_FILES', () => {
  it('用户取消 → 空数组 + 无 error（不是抛异常）', async () => {
    h.openDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    const res = (await call(LAUNCHER_PICK_FILES, {
      title: '选择皮肤 PNG',
      filters: [{ name: 'PNG 图片', extensions: ['png'] }],
      properties: ['openFile'],
    })) as { paths: string[]; error: string | null };
    expect(res.paths).toEqual([]);
    expect(res.error).toBeNull();
  });

  it('正常选择 → 原样返回路径', async () => {
    h.openDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\a.png', 'C:\\b.png'] });
    const res = (await call(LAUNCHER_PICK_FILES, {
      title: '选择皮肤 PNG',
      properties: ['openFile', 'multiSelections'],
    })) as { paths: string[]; error: string | null };
    expect(res.paths).toEqual(['C:\\a.png', 'C:\\b.png']);
  });

  it('filters 缺省也能弹（filters 是可选的，不该在这里抛）', async () => {
    h.openDialog.mockResolvedValue({ canceled: false, filePaths: ['C:\\x.png'] });
    const res = (await call(LAUNCHER_PICK_FILES, { title: '任意文件' })) as {
      paths: string[];
      error: string | null;
    };
    expect(res.error).toBeNull();
    expect(res.paths).toEqual(['C:\\x.png']);
  });

  it('title 必填 —— 缺了就拒', async () => {
    const res = (await call(LAUNCHER_PICK_FILES, {})) as { paths: string[]; error: string | null };
    expect(res.paths).toEqual([]);
    expect(res.error).toBeTruthy();
  });
});

describe('LAUNCHER_SKIN_ADD_LOCAL', () => {
  it('不存在的路径被拒，不落库', async () => {
    const res = (await call(LAUNCHER_SKIN_ADD_LOCAL, {
      path: join(root, 'nope.png'),
    })) as { entry: unknown; error: string | null };
    expect(res.entry).toBeFalsy();
    expect(res.error).toBeTruthy();
  });

  it('非 PNG 文件被拒（校验在库里，不在这里重写一遍）', async () => {
    const bad = join(root, 'not.png');
    writeFileSync(bad, Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3]));
    const res = (await call(LAUNCHER_SKIN_ADD_LOCAL, { path: bad })) as {
      entry: unknown;
      error: string | null;
    };
    expect(res.entry).toBeFalsy();
    expect(res.error).toBeTruthy();
  });
});

describe('LAUNCHER_SKIN_APPLY：落盘位置', () => {
  // ⚠️ 字段名是 `skinId`（不是 `id`）。写错的话 schema 会因为「缺必填字段」
  // 直接拒掉，下面每条断言都变成「因为别的原因被拒」的假绿 —— 所以这里
  // 单独钉一条「字段名对了才走到底」的用例。
  it('用 skinId 传对字段时，不会被 schema 挡在门外', async () => {
    const inst = seedInstance();
    const res = (await call(LAUNCHER_SKIN_APPLY, {
      skinId: 'sNotInLibrary',
      instance: inst,
      playerName: 'Steve',
    })) as { ok: boolean; error: string | null };
    expect(res.ok).toBe(false);
    // 字段名对了才会走到业务分支；schema 拒绝的消息会带字段名
    // （形如 `Required at "skinId"`）。
    expect(res.error).toContain('不在库里');
    expect(res.error).not.toMatch(/Required|Invalid/i);
  });

  it('缺 playerName 被 schema 拒（LocalSkin 的键就是玩家名，不能猜）', async () => {
    const inst = seedInstance();
    const res = (await call(LAUNCHER_SKIN_APPLY, {
      skinId: 'sX',
      instance: inst,
    })) as { ok: boolean; error: string | null };
    expect(res.ok).toBe(false);
    // 必须是 schema 层的拒绝（消息里带字段名），而不是后面才撞上别的错
    expect(res.error).toMatch(/playerName/i);
  });

  it('playerName 含路径穿越时被拒，且不落任何文件到实例外面', async () => {
    const inst = seedInstance();
    const res = (await call(LAUNCHER_SKIN_APPLY, {
      skinId: 'sX',
      instance: inst,
      playerName: '../../escape',
    })) as { ok: boolean; error: string | null };
    expect(res.ok).toBe(false);
    // 错误说的是玩家名不合法 —— 说明确实走到了 localSkinFileName 那道闸，
    // 而不是先死在「实例不存在」。
    expect(res.error).toContain('玩家名不合法');
    // 穿越目标必须不存在
    expect(existsSync(join(h.userData, 'mc-launcher', 'escape.png'))).toBe(false);
  });

  it('playerName 含反斜杠（Windows 路径分隔符）同样被拒', async () => {
    const inst = seedInstance();
    const res = (await call(LAUNCHER_SKIN_APPLY, {
      skinId: 'sX',
      instance: inst,
      playerName: 'a\\b',
    })) as { ok: boolean; error: string | null };
    expect(res.ok).toBe(false);
    expect(res.error).toContain('玩家名不合法');
  });

  it('库 id 不存在时被拒，且不留下任何文件', async () => {
    const inst = seedInstance();
    const res = (await call(LAUNCHER_SKIN_APPLY, {
      skinId: 'sDoesNotExist',
      instance: inst,
      playerName: 'Steve',
    })) as { ok: boolean; error: string | null };
    expect(res.ok).toBe(false);
    expect(existsSync(join(h.userData, 'mc-launcher', 'game', inst))).toBe(false);
  });
});

/**
 * 离线皮肤资源包那条路（不用装 mod 也能显示皮肤）。
 *
 * 这里盯的是**接线**：apply 顺手写资源包、note 把结果说清、unapply 在
 * 「实例上再没有已应用皮肤」时把资源包一起删。贴图路径 / pack_format /
 * options.txt 解析这些事实在 `offline-skin-pack.test.ts` 里钉。
 */
describe('LAUNCHER_SKIN_APPLY / UNAPPLY：离线皮肤资源包', () => {
  /** 实例游戏目录（实例 id = 目录名）。 */
  function gameDirOf(inst: string): string {
    return join(h.userData, 'mc-launcher', 'game', inst);
  }

  it('apply 成功 → 资源包与 options.txt 都写了，note 说清做了什么', async () => {
    const inst = seedInstance('1.20.4');
    const lib = new SkinLibrary(handlerLibDir());
    const entry = lib.add({ png: png(), name: '测试皮肤', source: 'file' });

    const res = (await call(LAUNCHER_SKIN_APPLY, {
      skinId: entry.id,
      instance: inst,
      playerName: 'Steve',
    })) as { ok: boolean; path: string | null; note: string | null; error: string | null };
    expect(res.ok, res.error ?? '').toBe(true);
    expect(res.path).toContain('CustomSkinLoader');
    expect(res.note).toContain('18');
    expect(existsSync(join(gameDirOf(inst), 'resourcepacks', 'MC Creator Skin.zip'))).toBe(true);
    expect(readFileSync(join(gameDirOf(inst), 'options.txt'), 'utf-8')).toContain(
      'file/MC Creator Skin.zip',
    );
  });

  it('apply 到 1.5.2（没有资源包的版本）→ 仍然成功，note 说清原因', async () => {
    const inst = seedInstance('1.5.2');
    const lib = new SkinLibrary(handlerLibDir());
    const entry = lib.add({ png: png(64, 32), name: '老皮肤', source: 'file' });

    const res = (await call(LAUNCHER_SKIN_APPLY, {
      skinId: entry.id,
      instance: inst,
      playerName: 'Steve',
    })) as { ok: boolean; path: string | null; note: string | null };
    // CSL 那条路照样落盘 —— 写不成资源包「不等于失败」
    expect(res.ok).toBe(true);
    expect(res.path).toContain('CustomSkinLoader');
    expect(res.note).toContain('资源包');
    expect(existsSync(join(gameDirOf(inst), 'resourcepacks'))).toBe(false);
  });

  it('unapply 清掉最后一个已应用皮肤时，资源包跟着删', async () => {
    const inst = seedInstance('1.20.4');
    const lib = new SkinLibrary(handlerLibDir());
    const entry = lib.add({ png: png(), name: '测试皮肤', source: 'file' });
    await call(LAUNCHER_SKIN_APPLY, { skinId: entry.id, instance: inst, playerName: 'Steve' });

    const res = (await call(LAUNCHER_SKIN_UNAPPLY, {
      instance: inst,
      playerName: 'Steve',
    })) as { ok: boolean; note: string | null; error: string | null };
    expect(res.ok, res.error ?? '').toBe(true);
    expect(res.note).toContain('MC Creator Skin.zip');
    expect(existsSync(join(gameDirOf(inst), 'resourcepacks', 'MC Creator Skin.zip'))).toBe(false);
    expect(readFileSync(join(gameDirOf(inst), 'options.txt'), 'utf-8')).not.toContain(
      'file/MC Creator Skin.zip',
    );
  });

  it('unapply 之后还有别的玩家名 → 资源包留着（它是按实例覆盖的）', async () => {
    const inst = seedInstance('1.20.4');
    const lib = new SkinLibrary(handlerLibDir());
    const entry = lib.add({ png: png(), name: '测试皮肤', source: 'file' });
    await call(LAUNCHER_SKIN_APPLY, { skinId: entry.id, instance: inst, playerName: 'Steve' });
    await call(LAUNCHER_SKIN_APPLY, { skinId: entry.id, instance: inst, playerName: 'Alex' });

    const res = (await call(LAUNCHER_SKIN_UNAPPLY, {
      instance: inst,
      playerName: 'Steve',
    })) as { ok: boolean; note: string | null };
    expect(res.ok).toBe(true);
    expect(res.note).toBeNull();
    expect(existsSync(join(gameDirOf(inst), 'resourcepacks', 'MC Creator Skin.zip'))).toBe(true);
  });
});
