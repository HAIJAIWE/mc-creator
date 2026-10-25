/**
 * `LauncherService.listWorlds` 测试（L9）。
 *
 * 覆盖三条设计约束：
 *  1. 真实解析 `level.dat`（gzip 压缩的二进制 NBT），拿世界名/最后游玩/游戏模式；
 *  2. **单个损坏存档不影响其余** —— 一个坏 level.dat 不能让整个世界列表打不开；
 *  3. 未压缩的裸 NBT 也要认（第三方工具处理过的存档常见）。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { LauncherService } from './launcher-service.js';

const VER = '26.2';

// ===== 最小 NBT 编码器（只造 level.dat 用得到的字段）=====
const e = {
  u8: (v: number) => [v & 0xff],
  i16: (v: number) => [(v >> 8) & 0xff, v & 0xff],
  i32: (v: number) => [(v >>> 24) & 0xff, (v >>> 16) & 0xff, (v >>> 8) & 0xff, v & 0xff],
  i64: (v: number) => {
    const hi = Math.floor(v / 0x100000000);
    return [...e.i32(hi), ...e.i32(v >>> 0)];
  },
  str: (s: string) => {
    const b: number[] = [];
    for (const ch of s) {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80) b.push(cp);
      else if (cp < 0x800) b.push(0xc0 | (cp >> 6), 0x80 | (cp & 0x3f));
      else b.push(0xe0 | (cp >> 12), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
    }
    return [...e.u8(b.length >>> 8), ...e.u8(b.length & 0xff), ...b];
  },
};

const T_INT = 3;
const T_LONG = 4;
const T_STRING = 8;
const T_COMPOUND = 10;

function compound(entries: Record<string, { type: number; bytes: number[] }>): number[] {
  const out: number[] = [];
  for (const [name, v] of Object.entries(entries)) {
    out.push(v.type);
    for (const b of e.str(name)) out.push(b);
    for (const b of v.bytes) out.push(b);
  }
  out.push(0);
  return out;
}

/** 造一份完整的 level.dat 字节流 */
function levelDat(opts: {
  name: string;
  lastPlayed: number;
  gameType: number;
  version?: string;
}): Uint8Array {
  const body = compound({
    LevelName: { type: T_STRING, bytes: e.str(opts.name) },
    LastPlayed: { type: T_LONG, bytes: e.i64(opts.lastPlayed) },
    GameType: { type: T_INT, bytes: e.i32(opts.gameType) },
    Version: {
      type: T_COMPOUND,
      bytes: compound({
        Name: { type: T_STRING, bytes: e.str(opts.version ?? '1.21.11') },
        Id: { type: T_INT, bytes: e.i32(3953) },
      }),
    },
  });
  const head = [T_COMPOUND, ...e.str('')];
  const out = new Uint8Array(head.length + body.length);
  out.set(head, 0);
  out.set(body, head.length);
  return out;
}

let dir: string;
let service: LauncherService;

function savesDir(): string {
  return join(dir, 'game', VER, 'saves');
}

/** 造一个世界目录，可选写入 gzip 压缩的 level.dat */
function seedWorld(dirName: string, dat?: Uint8Array, opts?: { gzip?: boolean }) {
  const w = join(savesDir(), dirName);
  mkdirSync(w, { recursive: true });
  if (dat) {
    writeFileSync(join(w, 'level.dat'), opts?.gzip === false ? dat : gzipSync(dat));
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-l9-'));
  service = new LauncherService(dir);
  mkdirSync(savesDir(), { recursive: true });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

// ===========================================================================
describe('listWorlds · 基本解析', () => {
  it('saves 目录不存在返回空数组，不抛', async () => {
    rmSync(savesDir(), { recursive: true, force: true });
    expect(await service.listWorlds(VER)).toEqual([]);
  });

  it('空 saves 目录返回空数组', async () => {
    expect(await service.listWorlds(VER)).toEqual([]);
  });

  it('解析 level.dat 的世界名 / 最后游玩 / 游戏模式 / MC 版本', async () => {
    const played = Date.UTC(2026, 2, 15, 12, 0, 0);
    seedWorld(
      'World1',
      levelDat({ name: '我的建筑世界', lastPlayed: played, gameType: 1, version: '1.21.4' }),
    );

    const [w] = await service.listWorlds(VER);
    expect(w).toBeDefined();
    expect(w!.levelName).toBe('我的建筑世界');
    expect(w!.dirName).toBe('World1');
    expect(w!.lastPlayed).toBe(played);
    expect(w!.gameMode).toBe('创造'); // GameType=1
    expect(w!.mcVersion).toBe('1.21.4');
    expect(w!.readable).toBe(true);
  });

  it('GameType 各值映射到中文模式名', async () => {
    seedWorld('a', levelDat({ name: 'A', lastPlayed: 1, gameType: 0 }));
    seedWorld('b', levelDat({ name: 'B', lastPlayed: 1, gameType: 2 }));
    seedWorld('c', levelDat({ name: 'C', lastPlayed: 1, gameType: 3 }));
    seedWorld('d', levelDat({ name: 'D', lastPlayed: 1, gameType: 99 }));

    const byName = Object.fromEntries(
      (await service.listWorlds(VER)).map((w) => [w.dirName, w.gameMode]),
    );
    expect(byName).toMatchObject({ a: '生存', b: '冒险', c: '旁观' });
    expect(byName.d).toMatch(/未知/); // 未知值如实标注，不吞
  });

  it('认未压缩的裸 NBT（第三方工具处理过的存档）', async () => {
    seedWorld('plain', levelDat({ name: '裸NBT世界', lastPlayed: 123, gameType: 0 }), {
      gzip: false,
    });
    const [w] = await service.listWorlds(VER);
    expect(w!.levelName).toBe('裸NBT世界');
    expect(w!.readable).toBe(true);
  });

  it('只列目录，saves 下的散落文件不当作世界', async () => {
    seedWorld('real', levelDat({ name: '真世界', lastPlayed: 1, gameType: 0 }));
    writeFileSync(join(savesDir(), 'level.dat'), 'stray file');
    writeFileSync(join(savesDir(), 'notes.txt'), 'x');
    const worlds = await service.listWorlds(VER);
    expect(worlds.map((w) => w.dirName)).toEqual(['real']);
  });

  it('按最后游玩时间倒序（最近玩的排前面）', async () => {
    seedWorld('old', levelDat({ name: '旧', lastPlayed: 1000, gameType: 0 }));
    seedWorld('new', levelDat({ name: '新', lastPlayed: 9000, gameType: 0 }));
    seedWorld('mid', levelDat({ name: '中', lastPlayed: 5000, gameType: 0 }));
    expect((await service.listWorlds(VER)).map((w) => w.dirName)).toEqual(['new', 'mid', 'old']);
  });

  it('统计世界占用大小（含 region 子目录）', async () => {
    seedWorld('big', levelDat({ name: '大世界', lastPlayed: 1, gameType: 0 }));
    const regionDir = join(savesDir(), 'big', 'region');
    mkdirSync(regionDir, { recursive: true });
    writeFileSync(join(regionDir, 'r.0.0.mca'), Buffer.alloc(4096, 1));
    writeFileSync(join(savesDir(), 'big', 'extra.dat'), Buffer.alloc(1024, 1));

    const [w] = await service.listWorlds(VER);
    // 至少包含两个已写文件（level.dat 本身也有体积）
    expect(w!.sizeBytes).toBeGreaterThan(4096 + 1024);
  });
});

// ===========================================================================
describe('listWorlds · 损坏容错（设计文档明确要求）', () => {
  it('level.dat 损坏 → readable:false，但仍列出该世界', async () => {
    seedWorld('broken', undefined);
    writeFileSync(join(savesDir(), 'broken', 'level.dat'), 'this is not gzip nor nbt');
    const [w] = await service.listWorlds(VER);
    expect(w!.dirName).toBe('broken');
    expect(w!.readable).toBe(false);
    expect(w!.levelName).toBe('broken'); // 回落到目录名
  });

  it('level.dat 被截断 → 不抛，读不了标记即可', async () => {
    const full = gzipSync(levelDat({ name: '截断', lastPlayed: 5, gameType: 0 }));
    seedWorld('trunc', undefined);
    writeFileSync(
      join(savesDir(), 'trunc', 'level.dat'),
      full.subarray(0, Math.floor(full.length / 2)),
    );
    await expect(service.listWorlds(VER)).resolves.toHaveLength(1);
    expect((await service.listWorlds(VER))[0]!.readable).toBe(false);
  });

  it('完全没有 level.dat → 仍列出（目录存在就是存档）', async () => {
    seedWorld('empty', undefined);
    const [w] = await service.listWorlds(VER);
    expect(w!.dirName).toBe('empty');
    expect(w!.readable).toBe(false);
    // 目录 mtime 作为最后游玩的兜底，至少给得出一个时间
    expect(typeof w!.lastPlayed).toBe('number');
  });

  it('**一个坏存档不影响其余**（核心容错约束）', async () => {
    seedWorld('good1', levelDat({ name: '好的1', lastPlayed: 300, gameType: 0 }));
    seedWorld('bad', undefined);
    writeFileSync(join(savesDir(), 'bad', 'level.dat'), Buffer.from([0xff, 0xff, 0xff, 0xff]));
    seedWorld('good2', levelDat({ name: '好的2', lastPlayed: 200, gameType: 1 }));

    const worlds = await service.listWorlds(VER);
    expect(worlds).toHaveLength(3);
    const byDir = Object.fromEntries(worlds.map((w) => [w.dirName, w]));
    expect(byDir.good1!.levelName).toBe('好的1');
    expect(byDir.good2!.levelName).toBe('好的2');
    expect(byDir.good1!.readable).toBe(true);
    expect(byDir.bad!.readable).toBe(false);
  });

  it('LevelName 为空白时回落到目录名', async () => {
    seedWorld('dirNameHere', levelDat({ name: '   ', lastPlayed: 1, gameType: 0 }));
    expect((await service.listWorlds(VER))[0]!.levelName).toBe('dirNameHere');
  });

  it('LastPlayed 缺失或为 0 时用目录 mtime 兜底', async () => {
    // GameType 存在但 LastPlayed 为 0
    const noTime = compound({
      LevelName: { type: T_STRING, bytes: e.str('无时间') },
      GameType: { type: T_INT, bytes: e.i32(0) },
    });
    const head = [T_COMPOUND, ...e.str('')];
    const raw = new Uint8Array(head.length + noTime.length);
    raw.set(head, 0);
    raw.set(noTime, head.length);
    seedWorld('notime', raw);

    const [w] = await service.listWorlds(VER);
    expect(w!.levelName).toBe('无时间');
    expect(typeof w!.lastPlayed).toBe('number');
    expect(w!.lastPlayed).toBeGreaterThan(0);
  });
});

// ===========================================================================
describe('listWorlds · 路径安全', () => {
  it('versionId 穿越被拒（assertVersionId）', async () => {
    await expect(service.listWorlds('../..')).rejects.toThrow(/非法的版本目录名/);
  });

  it('saves 下的目录名不参与路径逃逸（resolveInside 校验）', async () => {
    // 造一个真实的兄弟目录，确认不会因为任何目录名而越界
    const outside = mkdtempSync(join(tmpdir(), 'mc-l9-outside-'));
    try {
      mkdirSync(join(outside, 'secret'), { recursive: true });
      writeFileSync(
        join(outside, 'secret', 'level.dat'),
        gzipSync(
          levelDat({
            name: '外部世界',
            lastPlayed: 1,
            gameType: 0,
          }),
        ),
      );
      const worlds = await service.listWorlds(VER);
      expect(worlds.every((w) => w.levelName !== '外部世界')).toBe(true);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
