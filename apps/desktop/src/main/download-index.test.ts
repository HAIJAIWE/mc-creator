/**
 * 下载账本（`download-index.ts`）的用例。
 *
 * 它管的是"重新下载同一个项目时，把上一次下的那个文件删掉"—— 起因是实测踩到的
 * 真事故：JEI 下了两次（第二次源站已发新构建，文件名不同），`mods/` 里留下两个
 * 同 mod id 的 jar，NeoForge 启动直接 `Duplicate mod` 拒启动。
 *
 * 这里刻意同时钉住**反向**的一面：账本没记过的文件（用户手放的 jar）绝不能被删。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  batchEntry,
  batchRecorder,
  commitDownload,
  downloadIndexPath,
  modpackLedgerRecorder,
  prunePackFiles,
  readDownloadIndex,
  recordDownload,
  replacementTargets,
} from './download-index.js';

let instanceDir = '';

const writeMod = (name: string, body = 'jar'): string => {
  const dir = join(instanceDir, 'mods');
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, body);
  return p;
};

beforeEach(() => {
  instanceDir = mkdtempSync(join(tmpdir(), 'mc-dl-index-'));
});

afterEach(() => {
  rmSync(instanceDir, { recursive: true, force: true });
});

describe('commitDownload / readDownloadIndex', () => {
  it('记一笔下载后能读回来（dir 是相对实例目录的）', () => {
    writeMod('jei-26.3-neoforge-31.15.0.79.jar');
    commitDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-26.3-neoforge-31.15.0.79.jar',
      url: 'https://edge.forgecdn.net/files/9221/721/jei.jar',
    });

    const recs = readDownloadIndex(instanceDir);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-26.3-neoforge-31.15.0.79.jar',
    });
    expect(recs[0].at).toBeGreaterThan(0);
    // 账本落在实例目录下，**不放进 mods/**（加载器会扫那个目录）
    expect(existsSync(downloadIndexPath(instanceDir))).toBe(true);
    expect(existsSync(join(instanceDir, 'mods', '.mc-launcher-downloads.json'))).toBe(false);
  });

  it('同项目换文件名 ⇒ 旧文件被删、新文件留下（这就是 Duplicate mod 的修法）', () => {
    const oldJar = writeMod('jei-26.3-neoforge-31.15.0.79.jar');
    commitDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-26.3-neoforge-31.15.0.79.jar',
    });

    const newJar = writeMod('jei-26.3-neoforge-31.15.0.81.jar');
    const victims = commitDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-26.3-neoforge-31.15.0.81.jar',
    });

    expect(victims).toEqual(['jei-26.3-neoforge-31.15.0.79.jar']);
    expect(existsSync(oldJar)).toBe(false);
    expect(existsSync(newJar)).toBe(true);
    expect(readDownloadIndex(instanceDir)).toHaveLength(1);
    expect(readDownloadIndex(instanceDir)[0].name).toBe('jei-26.3-neoforge-31.15.0.81.jar');
  });

  it('只删同项目的：别人的文件与手上没记过的文件都不碰', () => {
    // 用户手放的 jar（没有账本条目）
    const manualJar = writeMod('my-custom-build.jar');
    const otherJar = writeMod('sodium-fabric-0.9.2.jar');
    commitDownload(instanceDir, {
      projectId: 'mr/Sodium',
      dir: 'mods',
      name: 'sodium-fabric-0.9.2.jar',
    });
    writeMod('jei-26.3-neoforge-31.15.0.79.jar');
    commitDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-26.3-neoforge-31.15.0.79.jar',
    });

    const victims = commitDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-26.3-neoforge-31.15.0.84.jar',
    });

    expect(victims).toEqual(['jei-26.3-neoforge-31.15.0.79.jar']);
    expect(existsSync(manualJar)).toBe(true);
    expect(existsSync(otherJar)).toBe(true);
  });

  it('目录不同不替换（同一个项目的 mod 与资源包可以并存）', () => {
    writeMod('jei-0.79.jar');
    commitDownload(instanceDir, { projectId: 'cf_238222', dir: 'mods', name: 'jei-0.79.jar' });
    mkdirSync(join(instanceDir, 'resourcepacks'), { recursive: true });
    writeFileSync(join(instanceDir, 'resourcepacks', 'jei-pack.zip'), 'zip');

    // 同一个项目、同文件名，但落在 resourcepacks/ —— mods/ 里那份必须活着
    commitDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'resourcepacks',
      name: 'jei-pack.zip',
    });

    expect(existsSync(join(instanceDir, 'mods', 'jei-0.79.jar'))).toBe(true);
    expect(readDownloadIndex(instanceDir)).toHaveLength(2);
  });

  it('文件已经不在了 ⇒ 条目顺手清掉，不会拿着空条目去删', () => {
    const jar = writeMod('gone.jar');
    commitDownload(instanceDir, { projectId: 'cf_1', dir: 'mods', name: 'gone.jar' });
    rmSync(jar);

    expect(readDownloadIndex(instanceDir)).toEqual([]);

    // 下一次入账会把死条目冲掉
    writeMod('alive.jar');
    commitDownload(instanceDir, { projectId: 'cf_2', dir: 'mods', name: 'alive.jar' });
    const raw = JSON.parse(readFileSync(downloadIndexPath(instanceDir), 'utf8'));
    expect(raw.files.map((f: { name: string }) => f.name)).toEqual(['alive.jar']);
  });

  it('账本损坏 / 形状不对 ⇒ 当空账本，不抛异常，并且下次写入会修好它', () => {
    writeFileSync(downloadIndexPath(instanceDir), '{ 这不是 JSON', 'utf8');
    expect(readDownloadIndex(instanceDir)).toEqual([]);

    writeFileSync(downloadIndexPath(instanceDir), JSON.stringify({ files: 'nope' }), 'utf8');
    expect(readDownloadIndex(instanceDir)).toEqual([]);

    writeFileSync(
      downloadIndexPath(instanceDir),
      JSON.stringify({ files: [{ dir: 'mods' }, { name: 'x.jar' }, 42, null] }),
      'utf8',
    );
    expect(readDownloadIndex(instanceDir)).toEqual([]);

    writeMod('ok.jar');
    commitDownload(instanceDir, { projectId: 'cf_3', dir: 'mods', name: 'ok.jar' });
    expect(readDownloadIndex(instanceDir).map((r) => r.name)).toEqual(['ok.jar']);
  });

  it('可疑路径（穿越 / 绝对路径）一律不算数 —— 不许删到实例外面去', () => {
    const outside = join(instanceDir, '..', 'victim.jar');
    writeFileSync(outside, 'x');
    writeFileSync(
      downloadIndexPath(instanceDir),
      JSON.stringify({
        files: [
          { dir: '..', name: 'victim.jar', projectId: 'cf_evil', at: 1 },
          { dir: '../..', name: 'victim.jar', projectId: 'cf_evil', at: 1 },
          { dir: 'mods', name: '..\\victim.jar', projectId: 'cf_evil', at: 1 },
        ],
      }),
      'utf8',
    );

    expect(readDownloadIndex(instanceDir)).toEqual([]);
    writeMod('mine.jar');
    const victims = commitDownload(instanceDir, {
      projectId: 'cf_evil',
      dir: 'mods',
      name: 'mine.jar',
    });

    expect(victims).toEqual([]);
    expect(existsSync(outside)).toBe(true);
    rmSync(outside, { force: true });
  });

  it('要记的路径本身在实例外 ⇒ 连记都不记（账本保持诚实）', () => {
    const victims = commitDownload(instanceDir, {
      projectId: 'cf_1',
      dir: '..',
      name: 'outside.jar',
    });
    expect(victims).toEqual([]);
    expect(existsSync(downloadIndexPath(instanceDir))).toBe(false);
  });
});

describe('replacementTargets（纯函数）', () => {
  const rec = (
    dir: string,
    name: string,
    projectId: string,
  ): Parameters<typeof replacementTargets>[0][number] => ({ dir, name, projectId, at: 0 });

  it('只挑同项目 + 同目录 + 不同名，并去重', () => {
    expect(
      replacementTargets(
        [
          rec('mods', 'a-1.jar', 'cf_1'),
          rec('mods', 'a-2.jar', 'cf_1'),
          rec('mods', 'a-2.jar', 'cf_1'),
          rec('mods', 'b.jar', 'cf_2'),
          rec('resourcepacks', 'a.zip', 'cf_1'),
          rec('mods', 'a-3.jar', 'cf_1'),
        ],
        { projectId: 'cf_1', dir: 'mods', name: 'a-3.jar' },
      ),
    ).toEqual(['a-1.jar', 'a-2.jar']);
  });

  it('同名的自己不算"旧文件"', () => {
    expect(
      replacementTargets([rec('mods', 'a.jar', 'cf_1')], {
        projectId: 'cf_1',
        dir: 'mods',
        name: 'a.jar',
      }),
    ).toEqual([]);
  });
});

/**
 * 整合包安装路径（`batchRecorder` / `recordDownload`）。
 *
 * 装整合包是「一批文件一起铺下去」：那批文件之间不能互相替换（同项目同目录
 * 发两份文件罕见但不是没有），但**上一版整合包留下的旧文件**必须清掉 ——
 * 重装/更新整合包时旧 jar 和新 jar 并排躺着，就是 `Duplicate mod` 拒启动。
 */
describe('batchRecorder / recordDownload', () => {
  it('recordDownload 只记不删：同项目换名字也不动旧文件', () => {
    const oldJar = writeMod('jei-31.15.0.79.jar');
    recordDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-31.15.0.79.jar',
    });
    const newJar = writeMod('jei-31.15.0.81.jar');
    recordDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-31.15.0.81.jar',
    });

    // 两份都活着（一批安装的过程中，谁都不该被自己的同类删掉）
    expect(existsSync(oldJar)).toBe(true);
    expect(existsSync(newJar)).toBe(true);
    expect(
      readDownloadIndex(instanceDir)
        .map((r) => r.name)
        .sort(),
    ).toEqual(['jei-31.15.0.79.jar', 'jei-31.15.0.81.jar']);
  });

  it('同一批里同项目同目录的文件不互相删，但上一版装的旧文件会被替换掉', () => {
    // 上一版整合包留下的（账本里记着）
    const stale = writeMod('jei-31.15.0.70.jar');
    commitDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-31.15.0.70.jar',
    });

    const batch = batchRecorder(instanceDir);
    const first = writeMod('jei-31.15.0.81.jar');
    expect(batch({ projectId: 'cf_238222', dir: 'mods', name: 'jei-31.15.0.81.jar' })).toEqual([
      'jei-31.15.0.70.jar',
    ]);

    // 同一批里同项目同目录的第二个文件（例如同一项目的 core 与附属）：
    // 只记录 —— 否则它会把刚写下的第一个删掉
    const sibling = writeMod('jei-addon.jar');
    expect(batch({ projectId: 'cf_238222', dir: 'mods', name: 'jei-addon.jar' })).toEqual([]);

    expect(existsSync(stale)).toBe(false);
    expect(existsSync(first)).toBe(true);
    expect(existsSync(sibling)).toBe(true);
    expect(
      readDownloadIndex(instanceDir)
        .map((r) => r.name)
        .sort(),
    ).toEqual(['jei-31.15.0.81.jar', 'jei-addon.jar']);
  });

  it('不同项目互不干扰（一个整合包几十个 mod，只有同一个项目才替换）', () => {
    const jei = writeMod('jei-31.15.0.81.jar');
    commitDownload(instanceDir, {
      projectId: 'cf_238222',
      dir: 'mods',
      name: 'jei-31.15.0.81.jar',
    });

    const batch = batchRecorder(instanceDir);
    const sodium = writeMod('sodium-0.9.2.jar');
    expect(batch({ projectId: 'mr_AANobbMI', dir: 'mods', name: 'sodium-0.9.2.jar' })).toEqual([]);

    expect(existsSync(jei)).toBe(true);
    expect(existsSync(sodium)).toBe(true);
  });

  /**
   * 两个写入方的 dir 形状不一样：mod 下载走 `path.relative()`（Windows 上是
   * `saves\world\datapacks`），整合包清单是 posix 形状（`saves/world/datapacks`）。
   * 不归一化的话嵌套目录上的替换永远不命中 —— 而 `mods` 这类一层目录又看不出问题。
   */
  it('dir 形状归一化：`saves\\world\\datapacks` 与 `saves/world/datapacks` 是同一个目录', () => {
    const nested = join(instanceDir, 'saves', 'world', 'datapacks');
    mkdirSync(nested, { recursive: true });
    const oldPack = join(nested, 'old.zip');
    writeFileSync(oldPack, 'zip');
    recordDownload(instanceDir, {
      projectId: 'mr_abc123',
      dir: 'saves\\world\\datapacks',
      name: 'old.zip',
    });

    // 新文件先落盘（下载流程就是这样：写盘成功再记账/替换）
    writeFileSync(join(nested, 'new.zip'), 'zip2');
    const victims = commitDownload(instanceDir, {
      projectId: 'mr_abc123',
      dir: 'saves/world/datapacks',
      name: 'new.zip',
    });

    expect(victims).toEqual(['old.zip']);
    expect(existsSync(oldPack)).toBe(false);
    expect(readDownloadIndex(instanceDir).map((r) => r.dir)).toEqual(['saves/world/datapacks']);
  });

  it('batchEntry：清单路径 → 账本形状（认不出项目就 null，不猜）', () => {
    expect(
      batchEntry({ projectId: 'mr_m5T5xmUy', targetPath: 'mods/a.jar' }, 'https://x/a'),
    ).toEqual({ projectId: 'mr_m5T5xmUy', dir: 'mods', name: 'a.jar', url: 'https://x/a' });
    // 嵌套目录（数据包）也照实拆
    expect(
      batchEntry({ projectId: 'cf_1', targetPath: 'saves/world/datapacks/x.zip' }, 'https://x/z'),
    ).toEqual({
      projectId: 'cf_1',
      dir: 'saves/world/datapacks',
      name: 'x.zip',
      url: 'https://x/z',
    });
    // 没有归属：宁可不记
    expect(batchEntry({ targetPath: 'config/a.json' }, 'https://x/a')).toBeNull();
  });

  it('modpackLedgerRecorder：没有归属的文件不记（账本里不出现它）', () => {
    const record = modpackLedgerRecorder(instanceDir);
    writeMod('owned.jar');
    record({ projectId: 'mr_abc123', targetPath: 'mods/owned.jar' }, 'https://x/a');
    // 整合包里没有项目归属的那种（overrides / 作者自制的文件）
    record({ targetPath: 'config/a.json' }, 'https://x/a');

    expect(readDownloadIndex(instanceDir).map((r) => r.name)).toEqual(['owned.jar']);
  });

  it('modpackLedgerRecorder：记下 packId，供换版本时认领旧文件', () => {
    const record = modpackLedgerRecorder(instanceDir, 'mr_pack');
    writeMod('owned.jar');
    record({ projectId: 'mr_abc123', targetPath: 'mods/owned.jar' }, 'https://x/a');

    expect(readDownloadIndex(instanceDir)[0]).toMatchObject({ packId: 'mr_pack' });
  });

  it('prunePackFiles：只清同一个包、且不在新清单里的文件；手动下的绝不动', () => {
    writeMod('keep.jar');
    writeMod('removed.jar');
    writeMod('manual.jar');
    writeMod('other-pack.jar');

    // 这个包上一版装的两个（新版只剩 keep）
    recordDownload(instanceDir, {
      projectId: 'mr_keep',
      dir: 'mods',
      name: 'keep.jar',
      packId: 'mr_pack',
    });
    recordDownload(instanceDir, {
      projectId: 'mr_removed',
      dir: 'mods',
      name: 'removed.jar',
      packId: 'mr_pack',
    });
    // 用户从搜索页下的（没有 packId）
    recordDownload(instanceDir, {
      projectId: 'mr_manual',
      dir: 'mods',
      name: 'manual.jar',
    });
    // 另一个整合包装的，不能被这个包的清单影响
    recordDownload(instanceDir, {
      projectId: 'mr_other',
      dir: 'mods',
      name: 'other-pack.jar',
      packId: 'mr_other_pack',
    });

    const removed = prunePackFiles(instanceDir, 'mr_pack', ['mods/keep.jar']);

    expect(removed).toEqual(['mods/removed.jar']);
    expect(existsSync(join(instanceDir, 'mods', 'keep.jar'))).toBe(true);
    expect(existsSync(join(instanceDir, 'mods', 'removed.jar'))).toBe(false);
    expect(existsSync(join(instanceDir, 'mods', 'manual.jar'))).toBe(true);
    expect(existsSync(join(instanceDir, 'mods', 'other-pack.jar'))).toBe(true);

    const names = readDownloadIndex(instanceDir)
      .map((r) => r.name)
      .sort();
    expect(names).toEqual(['keep.jar', 'manual.jar', 'other-pack.jar']);
  });
});
