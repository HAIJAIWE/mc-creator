/**
 * 四类内容的**落盘目录**分流。
 *
 * ## 曾经的 bug
 *
 * `LAUNCHER_DOWNLOAD_URL` 一律落 `gameDir/mods/`。那对 mod 是对的，对另外
 * 三类是明确的错误：Fabric / NeoForge 的加载器会扫 `mods/` 下的一切，把
 * 资源包 / 光影包 / 数据包当 mod 加载 —— 症状是启动时在加载器阶段炸，
 * 而报错与「资源包」毫无关系，用户完全无从下手。
 *
 * 这类 bug 特别难被现有测试抓到，因为「文件确实下下来了」。所以这里直接
 * 断言**磁盘上的真实路径**。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { LauncherService } from './launcher-service.js';

let root: string;
let base: string;
let svc: LauncherService;

const VERSION = '1.21.1';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'content-dir-'));
  base = join(root, 'mc-launcher');
  mkdirSync(base, { recursive: true });
  svc = new LauncherService(base, async () => new Response('{}'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('contentDir · 四类内容各有各的目录', () => {
  it('mod → mods/', () => {
    expect(svc.contentDir(VERSION, 'mod')).toBe(join(base, 'game', VERSION, 'mods'));
  });

  it('资源包 → resourcepacks/（游戏内「打开资源包文件夹」就是它）', () => {
    expect(svc.contentDir(VERSION, 'resourcepack')).toBe(
      join(base, 'game', VERSION, 'resourcepacks'),
    );
  });

  it('光影包 → shaderpacks/', () => {
    expect(svc.contentDir(VERSION, 'shader')).toBe(join(base, 'game', VERSION, 'shaderpacks'));
  });

  it('⚠️ 资源包/光影包**不能**落 mods/（加载器会把它当 mod 扫）', () => {
    const mods = svc.contentDir(VERSION, 'mod');
    expect(svc.contentDir(VERSION, 'resourcepack')).not.toBe(mods);
    expect(svc.contentDir(VERSION, 'shader')).not.toBe(mods);
    expect(svc.contentDir(VERSION, 'datapack')).not.toBe(mods);
  });

  it('modpack 走 mods 目录兜底（整合包不靠目录区分，是整套铺进 gameDir）', () => {
    expect(svc.contentDir(VERSION, 'modpack')).toBe(join(base, 'game', VERSION, 'mods'));
  });

  it('未知 kind 退回 mods/ 而不是 undefined（防止调用方拿到 undefined 路径）', () => {
    expect(svc.contentDir(VERSION, 'nonsense' as never)).toBe(join(base, 'game', VERSION, 'mods'));
  });

  it('都跟着实例自定义的 gameDir 走', () => {
    const custom = join(base, 'D-drive', VERSION);
    expect(svc.contentDir(VERSION, 'resourcepack', custom)).toBe(join(custom, 'resourcepacks'));
    expect(svc.contentDir(VERSION, 'mod', custom)).toBe(join(custom, 'mods'));
  });
});

describe('datapackDir · 数据包必须落到某个世界', () => {
  it('正常情况 → saves/<世界>/datapacks/', () => {
    expect(svc.datapackDir(VERSION, 'New World')).toBe(
      join(base, 'game', VERSION, 'saves', 'New World', 'datapacks'),
    );
  });

  it('世界名可以是中文/带空格（玩家自己起的，不是受控 id）', () => {
    expect(svc.datapackDir(VERSION, '我的世界 2')).toBe(
      join(base, 'game', VERSION, 'saves', '我的世界 2', 'datapacks'),
    );
  });

  it('世界名带路径穿越 → 拒（世界名来自玩家硬盘，会被拼进路径）', () => {
    for (const bad of ['../../..', '..', 'a/b', 'a\\b', '', 'C:/x']) {
      expect(() => svc.datapackDir(VERSION, bad), `world=${bad} 必须被拒`).toThrow(
        /非法的世界目录名/,
      );
    }
  });

  it('世界名合法但最终路径仍受 resolveInside 约束', () => {
    // 上面的字面检查是第一道；这里确认第二道（resolveInside）接得上：
    // 合法世界名不应被第二道误伤。
    expect(() => svc.datapackDir(VERSION, 'ok-name')).not.toThrow();
  });

  it('versionId 越界仍被 assertVersionId 挡住', () => {
    expect(() => svc.datapackDir('../../..', 'w')).toThrow(/非法的版本目录名/);
  });
});

describe('整合包路径不受影响', () => {
  it('mods 目录仍然是 gameDir 下的（整合包的 mods/ 目标路径依赖它）', () => {
    expect(svc.modsDir(VERSION)).toBe(join(base, 'game', VERSION, 'mods'));
    expect(svc.modsDir(VERSION).startsWith(svc.gameDir(VERSION))).toBe(true);
  });

  it('实例自定义 gameDir 时 mods 跟着走', () => {
    const custom = join(base, 'elsewhere', VERSION);
    expect(svc.modsDir(VERSION, custom)).toBe(join(custom, 'mods'));
  });
});

describe('实际写盘：不同类型落在不同目录', () => {
  it('资源包不会出现在 mods/ 里', () => {
    const dir = svc.contentDir(VERSION, 'resourcepack');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'pack.zip'), 'PK');
    expect(existsSync(join(dir, 'pack.zip'))).toBe(true);
    expect(existsSync(join(base, 'game', VERSION, 'mods', 'pack.zip'))).toBe(false);
  });

  it('光影包与资源包可以共存于同一实例', () => {
    const rp = svc.contentDir(VERSION, 'resourcepack');
    const sp = svc.contentDir(VERSION, 'shader');
    mkdirSync(rp, { recursive: true });
    mkdirSync(sp, { recursive: true });
    writeFileSync(join(rp, 'a.zip'), 'x');
    writeFileSync(join(sp, 'b.zip'), 'y');
    expect(existsSync(join(rp, 'a.zip'))).toBe(true);
    expect(existsSync(join(sp, 'b.zip'))).toBe(true);
    // 且都不在 mods/
    expect(existsSync(join(base, 'game', VERSION, 'mods', 'a.zip'))).toBe(false);
    expect(existsSync(join(base, 'game', VERSION, 'mods', 'b.zip'))).toBe(false);
  });
});
