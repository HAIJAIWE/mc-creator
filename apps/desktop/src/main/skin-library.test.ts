// @vitest-environment node
/**
 * 皮肤库：存储、导入校验、应用/取消应用。
 *
 * ## 这些用例在钉什么
 *
 * 「应用到实例」是**写盘**操作，写错地方的后果比报错严重得多 ——
 * 皮肤放进 `versions/` 而不是 `game/`、LocalSkin 没排到 loadlist 首位，
 * 症状都是「装了个皮肤但游戏里没变」，且没有任何提示。
 *
 * 所以这里直接断言**磁盘上的真实路径与文件内容**，而不是「函数被调用过」。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SkinLibrary,
  applySkinToInstance,
  unapplySkinFromInstance,
  listAppliedSkins,
  ensureLocalSkinFirst,
} from './skin-library.js';

/** 合法 PNG 头（64×64 现代 / 64×32 legacy）。内容随便 —— 本服务只看尺寸。 */
function png(width = 64, height = 64, filler = 0xab): Buffer {
  const b = Buffer.alloc(64, filler);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** 非 PNG —— 用来测校验失败路径。 */
const NOT_PNG = Buffer.from([
  0xff, 0xd8, 0xff, 0xe0, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
  21, 22, 23,
]);

let root: string;
let skinsRoot: string;
let gameDir: string;
let lib: SkinLibrary;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'skin-lib-'));
  skinsRoot = join(root, 'mc-launcher', 'skins');
  gameDir = join(root, 'mc-launcher', 'game', '我的空岛');
  mkdirSync(gameDir, { recursive: true });
  lib = new SkinLibrary(skinsRoot);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('SkinLibrary · 导入', () => {
  it('导入 64×64 PNG，字段齐全', () => {
    const e = lib.add({ png: png(), name: 'Steve 风', source: 'file' });
    expect(e).toMatchObject({
      name: 'Steve 风',
      model: 'classic',
      source: 'file',
      width: 64,
      height: 64,
    });
    expect(e.sizeBytes).toBe(64);
    expect(typeof e.createdAt).toBe('number');
  });

  it('导入 legacy 64×32 也接受（Java 至今支持这个旧格式）', () => {
    const e = lib.add({ png: png(64, 32), source: 'file' });
    expect(e).toMatchObject({ width: 64, height: 32, model: 'classic' });
  });

  it('64×128 被拒（旧的错白名单当它合法）', () => {
    expect(() => lib.add({ png: png(64, 128), source: 'file' })).toThrow(/高度必须是 64 或 32/);
    expect(lib.list()).toHaveLength(0);
  });

  it('legacy 64×32 即使调用方传 slim 也落成 classic（那个格式里 slim 不存在）', () => {
    const e = lib.add({ png: png(64, 32), model: 'slim', source: 'url' });
    expect(e.model).toBe('classic');
  });

  it('非 PNG → 抛可读原因（不写库）', () => {
    expect(() => lib.add({ png: NOT_PNG, source: 'file' })).toThrow(/不是 PNG/);
    expect(lib.list()).toHaveLength(0);
  });

  it('尺寸不对 → 抛可读原因（不写库）', () => {
    expect(() => lib.add({ png: png(32, 32), source: 'file' })).toThrow(/宽度必须是 64/);
    expect(lib.list()).toHaveLength(0);
  });

  it('PNG 真的落盘在 library/<id>.png', () => {
    const e = lib.add({ png: png(64, 64, 0x11), source: 'file' });
    const onDisk = readFileSync(join(skinsRoot, 'library', `${e.id}.png`));
    expect(onDisk.equals(png(64, 64, 0x11))).toBe(true);
  });

  it('新导入的排在最前（导入顺序 = 列表顺序）', () => {
    const a = lib.add({ png: png(64, 64, 1), name: 'A', source: 'file' });
    const b = lib.add({ png: png(64, 64, 2), name: 'B', source: 'file' });
    expect(lib.list().map((e) => e.id)).toEqual([b.id, a.id]);
  });

  it('名字为空时退回来源名，不写「undefined」', () => {
    expect(lib.add({ png: png(), name: '   ', source: 'mineskin' }).name).toBe('mineskin 皮肤');
    expect(lib.add({ png: png(), name: undefined, source: 'url' }).name).toBe('url 皮肤');
  });

  it('model 显式给 slim 时保留（PNG 判不出来，靠调用方）', () => {
    expect(lib.add({ png: png(), model: 'slim', source: 'file' }).model).toBe('slim');
  });

  it('尺寸不对的两种都拒：32×32 图标、512×512 大图', () => {
    expect(() => lib.add({ png: png(32, 32), source: 'file' })).toThrow(/宽度必须是 64/);
    expect(() => lib.add({ png: png(512, 512), source: 'file' })).toThrow(/宽度必须是 64/);
  });
});

describe('SkinLibrary · 持久化与增删改', () => {
  it('换一个实例读同一条索引（落盘了）', () => {
    const e = lib.add({ png: png(), name: 'X', source: 'file' });
    expect(new SkinLibrary(skinsRoot).list()[0]?.id).toBe(e.id);
  });

  it('索引损坏时当空库，不抛（PNG 可能还在，只是元数据丢了）', () => {
    lib.add({ png: png(), source: 'file' });
    writeFileSync(join(skinsRoot, 'library.json'), '{ 坏 JSON', 'utf-8');
    expect(() => new SkinLibrary(skinsRoot).list()).not.toThrow();
    expect(new SkinLibrary(skinsRoot).list()).toEqual([]);
  });

  it('改名字 / 模型，不动 PNG', () => {
    const e = lib.add({ png: png(64, 64, 7), name: '旧', source: 'file' });
    const before = readFileSync(join(skinsRoot, 'library', `${e.id}.png`));
    lib.update(e.id, { name: '新', model: 'slim' });
    const after = readFileSync(join(skinsRoot, 'library', `${e.id}.png`));
    expect(after.equals(before)).toBe(true);
    expect(lib.get(e.id)).toMatchObject({ name: '新', model: 'slim' });
  });

  it('legacy 改模型：改不动，仍是 classic（格式约束，UI 也会禁用该项）', () => {
    const e = lib.add({ png: png(64, 32), name: '旧格式', source: 'file' });
    expect(e.model).toBe('classic');
    const after = lib.update(e.id, { model: 'slim' });
    expect(after?.model).toBe('classic');
    expect(lib.get(e.id)?.model).toBe('classic');
  });

  it('update 空名字不改（挡掉把名字清空的调用）', () => {
    const e = lib.add({ png: png(), name: '原名', source: 'file' });
    lib.update(e.id, { name: '   ' });
    expect(lib.get(e.id)?.name).toBe('原名');
  });

  it('删除：索引与 PNG 都没了', () => {
    const e = lib.add({ png: png(), source: 'file' });
    expect(lib.remove(e.id)).toBe(true);
    expect(lib.get(e.id)).toBeNull();
    expect(existsSync(join(skinsRoot, 'library', `${e.id}.png`))).toBe(false);
  });

  it('删不存在的 id 返回 false（不抛）', () => {
    expect(lib.remove('s-nope')).toBe(false);
  });

  it('pngExists：索引在但文件没了的自愈探测', () => {
    const e = lib.add({ png: png(), source: 'file' });
    expect(lib.pngExists(e.id)).toBe(true);
    rmSync(join(skinsRoot, 'library', `${e.id}.png`));
    expect(lib.pngExists(e.id)).toBe(false);
  });

  it('pngPath 挡路径穿越', () => {
    for (const bad of ['../evil', 'a/b', 'a\\b', '..']) {
      expect(() => lib.pngPath(bad), `id=${bad} 必须被拒`).toThrow(/非法的皮肤 id/);
    }
  });
});

describe('applySkinToInstance · 落到 CustomSkinLoader/LocalSkin', () => {
  it('落点正是 CSL 的 LocalSkin 路径', () => {
    const e = lib.add({ png: png(64, 64, 0x42), name: '用在 Steve 上', source: 'file' });
    const { path } = applySkinToInstance({
      library: lib,
      instanceGameDir: gameDir,
      skinId: e.id,
      playerName: 'Steve',
    });
    expect(path.replace(/\\/g, '/')).toBe(
      `${gameDir.replace(/\\/g, '/')}/CustomSkinLoader/LocalSkin/skins/Steve.png`,
    );
    expect(readFileSync(path).equals(png(64, 64, 0x42))).toBe(true);
  });

  it('库里的原件还在（copy 不是 move —— 同一张皮肤要给多个玩家用）', () => {
    const e = lib.add({ png: png(), source: 'file' });
    applySkinToInstance({ library: lib, instanceGameDir: gameDir, skinId: e.id, playerName: 'A' });
    applySkinToInstance({ library: lib, instanceGameDir: gameDir, skinId: e.id, playerName: 'B' });
    expect(lib.pngExists(e.id)).toBe(true);
    expect(existsSync(join(gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins', 'A.png'))).toBe(true);
    expect(existsSync(join(gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins', 'B.png'))).toBe(true);
  });

  it('同一张皮肤应用到不同实例：各自的 gameDir 各一份', () => {
    const e = lib.add({ png: png(), source: 'file' });
    const other = join(root, 'mc-launcher', 'game', '高性能光影');
    applySkinToInstance({ library: lib, instanceGameDir: gameDir, skinId: e.id, playerName: 'S' });
    applySkinToInstance({ library: lib, instanceGameDir: other, skinId: e.id, playerName: 'S' });
    expect(existsSync(join(gameDir, 'CustomSkinLoader', 'LocalSkin', 'skins', 'S.png'))).toBe(true);
    expect(existsSync(join(other, 'CustomSkinLoader', 'LocalSkin', 'skins', 'S.png'))).toBe(true);
  });

  it('玩家名带路径穿越 → 拒（它会进文件名）', () => {
    const e = lib.add({ png: png(), source: 'file' });
    for (const bad of ['../evil', 'a/b', '..']) {
      expect(
        () =>
          applySkinToInstance({
            library: lib,
            instanceGameDir: gameDir,
            skinId: e.id,
            playerName: bad,
          }),
        `玩家名 ${bad} 必须被拒`,
      ).toThrow(/玩家名不合法/);
    }
  });

  it('皮肤不在库里 → 明确报错', () => {
    expect(() =>
      applySkinToInstance({
        library: lib,
        instanceGameDir: gameDir,
        skinId: 's-nope',
        playerName: 'S',
      }),
    ).toThrow(/皮肤不在库里/);
  });

  it('索引在但 PNG 丢了 → 报「文件缺失」而不是复制一个空文件', () => {
    const e = lib.add({ png: png(), source: 'file' });
    rmSync(join(skinsRoot, 'library', `${e.id}.png`));
    expect(() =>
      applySkinToInstance({
        library: lib,
        instanceGameDir: gameDir,
        skinId: e.id,
        playerName: 'S',
      }),
    ).toThrow(/皮肤文件缺失/);
  });
});

describe('unapply / listApplied', () => {
  it('取消应用只删该玩家名的文件', () => {
    const e = lib.add({ png: png(), source: 'file' });
    applySkinToInstance({ library: lib, instanceGameDir: gameDir, skinId: e.id, playerName: 'A' });
    applySkinToInstance({ library: lib, instanceGameDir: gameDir, skinId: e.id, playerName: 'B' });
    unapplySkinFromInstance({ instanceGameDir: gameDir, playerName: 'A' });
    const applied = listAppliedSkins(gameDir).map((a) => a.playerName);
    expect(applied).toEqual(['B']);
  });

  it('取消应用是幂等的（没有也不抛）', () => {
    expect(() =>
      unapplySkinFromInstance({ instanceGameDir: gameDir, playerName: 'Nobody' }),
    ).not.toThrow();
  });

  it('取消应用：玩家名非法时静默返回（不抛）', () => {
    expect(() =>
      unapplySkinFromInstance({ instanceGameDir: gameDir, playerName: '../x' }),
    ).not.toThrow();
  });

  it('listApplied 读的是磁盘上的文件（事实来源），不是库索引', () => {
    const e = lib.add({ png: png(), source: 'file' });
    applySkinToInstance({
      library: lib,
      instanceGameDir: gameDir,
      skinId: e.id,
      playerName: 'Steve',
    });
    // 从库里删掉皮肤 —— 已应用的副本仍在（那是实例数据）
    lib.remove(e.id);
    expect(listAppliedSkins(gameDir).map((a) => a.playerName)).toEqual(['Steve']);
  });

  it('listApplied 在目录不存在时返回空数组', () => {
    expect(listAppliedSkins(join(root, 'nothing', 'here'))).toEqual([]);
  });
});

describe('ensureLocalSkinFirst · loadlist 顺序', () => {
  /** 造一个 CSL 配置（形状照实测的 installSkinSupport 产物）。 */
  function writeCfg(loadlist: unknown[]): string {
    const dir = join(gameDir, 'config', 'CustomSkinLoader');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'CustomSkinLoader.json');
    writeFileSync(p, JSON.stringify({ loadlist, enableDynamicSkull: true }, null, 2), 'utf-8');
    return p;
  }

  it('没有 LocalSkin → 插到最前', () => {
    const p = writeCfg([
      { name: 'LittleSkin', type: 'CustomSkinAPI', root: 'https://littleskin.cn/api/yggdrasil' },
    ]);
    ensureLocalSkinFirst(gameDir);
    const cfg = JSON.parse(readFileSync(p, 'utf-8'));
    expect(cfg.loadlist[0]).toEqual({ name: 'LocalSkin', type: 'Legacy', root: 'LocalSkin/' });
    expect(cfg.loadlist[1].name).toBe('LittleSkin');
  });

  it('已有 LocalSkin → 不动（不在最前也不动，可能是用户有意排的）', () => {
    const p = writeCfg([
      { name: 'LocalSkin', type: 'Legacy', root: 'LocalSkin/' },
      { name: 'Mojang', type: 'MojangAPI' },
    ]);
    const before = readFileSync(p, 'utf-8');
    ensureLocalSkinFirst(gameDir);
    expect(readFileSync(p, 'utf-8')).toBe(before);
  });

  it('没有配置文件 → 什么都不做（不顺手启用 CSL，那要走合规闸门）', () => {
    expect(existsSync(join(gameDir, 'config'))).toBe(false);
    expect(() => ensureLocalSkinFirst(gameDir)).not.toThrow();
    expect(existsSync(join(gameDir, 'config'))).toBe(false);
  });

  it('配置损坏 → 不动它，让上层重建', () => {
    const dir = join(gameDir, 'config', 'CustomSkinLoader');
    mkdirSync(dir, { recursive: true });
    const p = join(dir, 'CustomSkinLoader.json');
    writeFileSync(p, '{ 坏 JSON', 'utf-8');
    ensureLocalSkinFirst(gameDir);
    expect(readFileSync(p, 'utf-8')).toBe('{ 坏 JSON');
  });
});
