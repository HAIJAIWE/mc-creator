// @vitest-environment node
/**
 * 离线皮肤资源包：**证据全部来自真 jar / 官方表**，所以这里的断言也全部对着它们。
 *
 * 三条不能忘的出处（改任何期望值先把这三条重新看一遍）：
 * 1. `1.19.3+` 的 18 份贴图路径 —— 下载真 client.jar 列 `assets/minecraft/
 *    textures/entity/**` 得到的：1.20.4 有 `entity/player/{wide,slim}/` + 9 个
 *    名字 = 18 个文件；1.19.2 / 1.12.2 只有 `entity/{steve,alex}.png`。
 * 2. `pack_format` —— minecraft.wiki「Pack format」页 Resource pack format
 *    history 的 Releases 列（2026-10 在线核验）。
 * 3. 「默认皮肤可以被资源包替换」—— Minecraft Wiki「Skin」条原文。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import JSZip from 'jszip';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  DEFAULT_SKIN_NAMES,
  OFFLINE_PACK_FILE_NAME,
  addResourcePackToOptions,
  planOfflineSkinPack,
  playerDefaultSkinPath,
  removeOfflineSkinPack,
  removeResourcePackFromOptions,
  writeOfflineSkinPack,
} from './offline-skin-pack.js';

/** 一张假皮肤 PNG（只校验尺寸，内容随便）。 */
function png(width = 64, height = 64): Uint8Array {
  const b = Buffer.alloc(64, 0xab);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8);
  Buffer.from('IHDR').copy(b, 12);
  b.writeUInt32BE(width, 16);
  b.writeUInt32BE(height, 20);
  return b;
}

/** 1.20.4 真 jar 里那 18 个文件的路径，按本模块的规则重算一遍的标准答案。 */
const EXPECTED_1193_PATHS = [
  ...['wide', 'slim'].flatMap((model) =>
    DEFAULT_SKIN_NAMES.map((name) => playerDefaultSkinPath(model, name)),
  ),
].sort();

describe('planOfflineSkinPack · 1.19.3+ 覆盖 18 份（真 jar 清单）', () => {
  it.each(['1.19.3', '1.20.4', '1.21.9', '26.3'])('%s：2 个模型 × 9 个名字', (v) => {
    const plan = planOfflineSkinPack({ mcVersion: v, width: 64, height: 64, png: png() });
    expect(plan.ok, `应为成功: ${JSON.stringify(plan)}`).toBe(true);
    if (!plan.ok) return;
    expect(plan.entries.map((e) => e.path).sort()).toEqual(EXPECTED_1193_PATHS);
    expect(plan.entries).toHaveLength(18);
  });

  it('九个名字就是 jar 里那九个（写死字面量，不是从代码里取的）', () => {
    expect([...DEFAULT_SKIN_NAMES]).toEqual([
      'alex',
      'ari',
      'efe',
      'kai',
      'makena',
      'noor',
      'steve',
      'sunny',
      'zuri',
    ]);
  });

  it('每一份都是同一张 PNG（覆盖的是贴图，不是每人一份）', () => {
    const bytes = png();
    const plan = planOfflineSkinPack({ mcVersion: '1.20.4', width: 64, height: 64, png: bytes });
    if (!plan.ok) throw new Error('应为成功');
    for (const e of plan.entries) expect(e.bytes).toBe(bytes);
  });
});

describe('planOfflineSkinPack · 1.19.3 之前只覆盖 steve/alex', () => {
  it.each(['1.6.1', '1.7.10', '1.8.9', '1.12.2', '1.16.5', '1.19.2'])('%s：就两份', (v) => {
    // 1.6/1.7 的皮肤是 64×32，1.8 起是 64×64
    const height = v === '1.6.1' || v === '1.7.10' ? 32 : 64;
    const plan = planOfflineSkinPack({
      mcVersion: v,
      width: 64,
      height,
      png: png(64, height),
    });
    expect(plan.ok, `应为成功: ${JSON.stringify(plan)}`).toBe(true);
    if (!plan.ok) return;
    expect(plan.entries.map((e) => e.path)).toEqual([
      'assets/minecraft/textures/entity/steve.png',
      'assets/minecraft/textures/entity/alex.png',
    ]);
  });
});

describe('planOfflineSkinPack · pack.mcmeta 与官方格式号', () => {
  it('pack_format 逐版本对得上官方表（含老版本）', () => {
    // [版本, 皮肤高, 期望格式号] —— 高必须按版本给：1.6/1.7 只吃 64×32
    const expected: Array<[string, number, number]> = [
      ['1.6.1', 32, 1],
      ['1.8.9', 64, 1],
      ['1.9.4', 64, 2],
      ['1.11.1', 64, 3],
      ['1.13.2', 64, 4],
      ['1.16.1', 64, 5],
      ['1.16.5', 64, 6],
      ['1.17.1', 64, 7],
      ['1.18.2', 64, 8],
      ['1.19.2', 64, 9],
      ['1.19.3', 64, 12],
      ['1.19.4', 64, 13],
      ['1.20.1', 64, 15],
      ['1.21.9', 64, 69],
    ];
    for (const [v, h, want] of expected) {
      const plan = planOfflineSkinPack({ mcVersion: v, width: 64, height: h, png: png(64, h) });
      if (!plan.ok) throw new Error(`${v} 应为成功: ${plan.reason}`);
      const parsed = JSON.parse(plan.packMcmeta) as {
        pack: { pack_format?: number; min_format?: number };
      };
      expect(parsed.pack.pack_format ?? parsed.pack.min_format, v).toBe(want);
    }
  });

  it('1.21.9+ 用 min_format/max_format（官方 25w31a 起换了字段）', () => {
    const parsed = (v: string) => {
      const plan = planOfflineSkinPack({ mcVersion: v, width: 64, height: 64, png: png() });
      if (!plan.ok) throw new Error('应为成功');
      const p = JSON.parse(plan.packMcmeta) as {
        pack: { pack_format?: number; min_format?: number; max_format?: number };
      };
      return p.pack;
    };
    const modern = parsed('1.21.11');
    expect(modern.min_format).toBe(75);
    expect(modern.max_format).toBe(75);
    expect(modern.pack_format).toBeUndefined();
    const old = parsed('1.20.4');
    expect(old.pack_format).toBe(22);
    expect((old as { min_format?: number }).min_format).toBeUndefined();
  });

  /**
   * 带次版本的格式号（官方表里 26.3 的资源包格式是 `97.1`）**不能**写成浮点。
   *
   * 官方 pack.mcmeta 文档：`min_format: <int>` 等价于 `[<int>, 0]`，
   * `max_format: <int>` 等价于「主版本 <int>，次版本任意」。所以主版本整数 97
   * 既盖得住 `[97, 1]`，也是唯一合法的写法；写成 `97.1` 是浮点，游戏读不了。
   */
  it('次版本不为 0 的版本（26.3 = 97.1）写主版本整数，不是浮点', () => {
    const plan = planOfflineSkinPack({ mcVersion: '26.3', width: 64, height: 64, png: png() });
    if (!plan.ok) throw new Error(`应为成功: ${plan.reason}`);
    expect(plan.packMcmeta).toContain('"min_format": 97');
    expect(plan.packMcmeta).not.toContain('97.1');
    const p = JSON.parse(plan.packMcmeta) as { pack: { min_format: number; max_format: number } };
    expect(Number.isInteger(p.pack.min_format)).toBe(true);
    expect(Number.isInteger(p.pack.max_format)).toBe(true);
  });

  it('描述写明是离线皮肤（游戏里资源包列表能看到）', () => {
    const plan = planOfflineSkinPack({ mcVersion: '1.20.4', width: 64, height: 64, png: png() });
    if (!plan.ok) throw new Error('应为成功');
    expect(JSON.parse(plan.packMcmeta).pack.description).toContain('离线皮肤');
  });

  it('options.txt 引用的是 file/<文件名>', () => {
    const plan = planOfflineSkinPack({ mcVersion: '1.20.4', width: 64, height: 64, png: png() });
    if (!plan.ok) throw new Error('应为成功');
    expect(plan.optionsEntry).toBe(`file/${OFFLINE_PACK_FILE_NAME}`);
  });
});

describe('planOfflineSkinPack · 不支持的组合必须说清为什么', () => {
  it('1.6.1 之前没有资源包', () => {
    for (const v of ['1.5.2', '1.4.7']) {
      const r = planOfflineSkinPack({ mcVersion: v, width: 64, height: 32, png: png(64, 32) });
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.reason).toContain('资源包');
    }
  });

  it('Beta/Audit 之类的非发布版号 → 说「认不出」，不去猜', () => {
    for (const v of ['b1.7.3', 'a0.1.0', '1.9-pre4']) {
      const r = planOfflineSkinPack({ mcVersion: v, width: 64, height: 32, png: png(64, 32) });
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.reason).toContain('认不出');
    }
  });

  it('版本号不认识 → 说清楚，不猜', () => {
    for (const v of ['', 'not-a-version', '1.21', 'x.y.z']) {
      const r = planOfflineSkinPack({ mcVersion: v, width: 64, height: 64, png: png() });
      expect(r.ok, v).toBe(false);
    }
  });

  it('1.8+ 不收 64×32（左肢 UV 在图外）', () => {
    const r = planOfflineSkinPack({ mcVersion: '1.20.4', width: 64, height: 32, png: png(64, 32) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('CustomSkinLoader');
  });

  it('1.6/1.7 不收 64×64（没有裁剪工具）', () => {
    const r = planOfflineSkinPack({ mcVersion: '1.7.10', width: 64, height: 64, png: png() });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain('64×32');
  });
});

describe('options.txt 的 resourcePacks 行', () => {
  /**
   * 这里的输入**按真实文件写**：options.txt 是 `key:value`（冒号）。
   * 拿 26.3 实例里那份 FO 的 options.txt 数过：210 行全冒号、0 行等号。
   * 老测试全用等号 → 内部自洽，但和游戏真实文件对不上（真机实测会
   * `Skipping bad option`），所以整组按冒号重写。
   */
  it('没有这行 → 新建一行（冒号），且 1.13+ 带 "vanilla"', () => {
    expect(addResourcePackToOptions('renderDistance:8\n', 'file/a.zip', '1.20.4')).toBe(
      'renderDistance:8\nresourcePacks:["vanilla","file/a.zip"]\n',
    );
  });

  it('真实文件的空列表 `resourcePacks:[]` → 原地改写，不是另起一行', () => {
    const text = 'version:5023\nresourcePacks:[]\nincompatibleResourcePacks:[]\n';
    expect(addResourcePackToOptions(text, 'file/a.zip', '26.3')).toBe(
      'version:5023\nresourcePacks:["vanilla","file/a.zip"]\nincompatibleResourcePacks:[]\n',
    );
  });

  it('1.13 之前不加 "vanilla"（那会儿没这个概念）', () => {
    expect(addResourcePackToOptions('', 'file/a.zip', '1.12.2')).toBe(
      'resourcePacks:["file/a.zip"]\n',
    );
  });

  it('已有别人的包 → 原样保留，只把我们的追加到后面', () => {
    const text = 'renderDistance:8\nresourcePacks:["vanilla","file/other.zip"]\nmaxFps:120\n';
    const out = addResourcePackToOptions(text, 'file/a.zip', '1.20.4');
    expect(out).toBe(
      'renderDistance:8\nresourcePacks:["vanilla","file/other.zip","file/a.zip"]\nmaxFps:120\n',
    );
  });

  it('已有 "vanilla" 不重复插', () => {
    const out = addResourcePackToOptions('resourcePacks:["vanilla"]', 'file/a.zip', '1.20.4');
    expect(out).toBe('resourcePacks:["vanilla","file/a.zip"]');
  });

  it('幂等：加两次只有一份', () => {
    const once = addResourcePackToOptions('', 'file/a.zip', '1.20.4');
    const twice = addResourcePackToOptions(once, 'file/a.zip', '1.20.4');
    expect(twice).toBe(once);
  });

  /**
   * 真实 Windows 上的 options.txt 是 CRLF（Java `Properties.store` 用平台行尾）。
   * 只改一行时不能把整份文件搞成混合行尾，也不能把 `\r` 吃掉。
   */
  it('CRLF 的 options.txt：改动那行仍是 CRLF，其余行一个字节都不动', () => {
    const text = 'renderDistance:8\r\nresourcePacks:["vanilla"]\r\nmaxFps:120\r\n';
    const out = addResourcePackToOptions(text, 'file/a.zip', '1.20.4');
    expect(out).toBe(
      'renderDistance:8\r\nresourcePacks:["vanilla","file/a.zip"]\r\nmaxFps:120\r\n',
    );
    // 三行三行尾：没有出现「\r 丢了」或「多了一个 \n」
    expect(out.split('\r\n')).toHaveLength(4);
    expect(out).not.toContain('\n\r');
    // 删回去要能一模一样地还原（apply → unapply 不留痕）
    expect(removeResourcePackFromOptions(out, 'file/a.zip')).toBe(text);
  });

  /**
   * 文件最后一行可能没有换行符。这时候直接往后接字符串，会把新键粘在
   * 上一个键的**值后面**（游戏读到的是 `renderDistance` = `8resourcePacks:[…]`），
   * 属于「改了用户的配置文件还改坏了」。
   */
  it('末行没有换行符 → 先补一个，别把两个键粘成一行', () => {
    const out = addResourcePackToOptions('renderDistance:8', 'file/a.zip', '1.20.4');
    expect(out).toBe('renderDistance:8\nresourcePacks:["vanilla","file/a.zip"]\n');
  });

  it('删：只删我们那项，别人的留下', () => {
    const text = 'resourcePacks:["vanilla","file/a.zip","file/other.zip"]\n';
    expect(removeResourcePackFromOptions(text, 'file/a.zip')).toBe(
      'resourcePacks:["vanilla","file/other.zip"]\n',
    );
  });

  it('删一个不存在的项 → 原文返回', () => {
    const text = 'resourcePacks:["vanilla"]\n';
    expect(removeResourcePackFromOptions(text, 'file/a.zip')).toBe(text);
  });

  it('没有这一行时删 → 原文返回', () => {
    const text = 'renderDistance:8\n';
    expect(removeResourcePackFromOptions(text, 'file/a.zip')).toBe(text);
  });

  /**
   * 旧版本（只认等号那版）会往真文件末尾**追加**一行 `resourcePacks=[…]`，
   * 于是用户 options.txt 里会同时有游戏写的 `resourcePacks:[]` 和我们追加的
   * 等号行（游戏报 `Skipping bad option` 丢掉它）。修完必须：改写冒号那行、
   * 把重复的等号行清掉，不能留两行同键。
   */
  it('清掉旧版本追加的等号行，只留一行冒号行', () => {
    const text =
      'version:5023\nresourcePacks:[]\nincompatibleResourcePacks:[]\nresourcePacks=["vanilla","file/a.zip"]\n';
    expect(addResourcePackToOptions(text, 'file/a.zip', '26.3')).toBe(
      'version:5023\nresourcePacks:["vanilla","file/a.zip"]\nincompatibleResourcePacks:[]\n',
    );
  });

  it('文件里只有等号行（更老的残留）→ 改写成冒号行', () => {
    const text = 'renderDistance:8\nresourcePacks=["vanilla"]\n';
    expect(addResourcePackToOptions(text, 'file/a.zip', '1.20.4')).toBe(
      'renderDistance:8\nresourcePacks:["vanilla","file/a.zip"]\n',
    );
  });
});

describe('读盘：写进去 → 读回来（真 zip）', () => {
  let root: string;
  let gameDir: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'offline-skin-'));
    gameDir = join(root, 'game', '我的空岛');
    rmSync(gameDir, { recursive: true, force: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('资源包落在 resourcepacks/ 下，zip 内容就是计划的那些', async () => {
    const bytes = png(64, 64);
    await writeOfflineSkinPack({
      instanceGameDir: gameDir,
      mcVersion: '1.20.4',
      width: 64,
      height: 64,
      png: bytes,
    });
    const packPath = join(gameDir, 'resourcepacks', OFFLINE_PACK_FILE_NAME);
    expect(existsSync(packPath)).toBe(true);

    const zip = await JSZip.loadAsync(readFileSync(packPath));
    // 注意：Object.keys 会把 JSZip 自动建的**目录条目**也算进来，这里只要真文件
    const names = Object.values(zip.files)
      .filter((f) => !f.dir)
      .map((f) => f.name)
      .sort();
    expect(names).toHaveLength(19); // 18 份贴图 + pack.mcmeta
    expect(names).toContain('pack.mcmeta');
    expect(names).toContain('assets/minecraft/textures/entity/player/wide/steve.png');
    expect(names).toContain('assets/minecraft/textures/entity/player/slim/zuri.png');
    // 贴图内容与库里的 PNG 逐字节相同
    const back = await zip
      .file('assets/minecraft/textures/entity/player/wide/steve.png')!
      .async('uint8array');
    expect(Buffer.compare(Buffer.from(back), Buffer.from(bytes))).toBe(0);
  });

  it('options.txt 写上了 file/ 引用（原本没有这个文件）', async () => {
    await writeOfflineSkinPack({
      instanceGameDir: gameDir,
      mcVersion: '1.20.4',
      width: 64,
      height: 64,
      png: png(),
    });
    const text = readFileSync(join(gameDir, 'options.txt'), 'utf-8');
    expect(text).toContain(`resourcePacks:["vanilla","file/${OFFLINE_PACK_FILE_NAME}"]`);
  });

  it('已有的 options.txt 只动资源包那一行', async () => {
    const { mkdirSync } = await import('node:fs');
    mkdirSync(gameDir, { recursive: true });
    writeFileSync(
      join(gameDir, 'options.txt'),
      'renderDistance:12\nresourcePacks:["vanilla","file/朋友的包.zip"]\nmaxFps:60\n',
      'utf-8',
    );
    await writeOfflineSkinPack({
      instanceGameDir: gameDir,
      mcVersion: '1.20.4',
      width: 64,
      height: 64,
      png: png(),
    });
    expect(readFileSync(join(gameDir, 'options.txt'), 'utf-8')).toBe(
      `renderDistance:12\nresourcePacks:["vanilla","file/朋友的包.zip","file/${OFFLINE_PACK_FILE_NAME}"]\nmaxFps:60\n`,
    );
  });

  it('再写一次不会追加第二次（幂等）', async () => {
    const args = {
      instanceGameDir: gameDir,
      mcVersion: '1.20.4',
      width: 64,
      height: 64,
      png: png(),
    };
    await writeOfflineSkinPack(args);
    await writeOfflineSkinPack(args);
    const text = readFileSync(join(gameDir, 'options.txt'), 'utf-8');
    expect(text.match(new RegExp(OFFLINE_PACK_FILE_NAME.replace(/\./g, '\\.'), 'g'))).toHaveLength(
      1,
    );
  });

  it('版本不支持 → 不写任何东西，note 把原因说清', async () => {
    const r = await writeOfflineSkinPack({
      instanceGameDir: gameDir,
      mcVersion: '1.5.2',
      width: 64,
      height: 32,
      png: png(64, 32),
    });
    expect(r.packPath).toBeNull();
    expect(r.note).toContain('资源包');
    expect(existsSync(join(gameDir, 'options.txt'))).toBe(false);
    expect(existsSync(join(gameDir, 'resourcepacks'))).toBe(false);
  });

  it('remove：zip 删掉、options.txt 摘掉，且没有我们的残留', async () => {
    await writeOfflineSkinPack({
      instanceGameDir: gameDir,
      mcVersion: '1.20.4',
      width: 64,
      height: 64,
      png: png(),
    });
    const r = await removeOfflineSkinPack({ instanceGameDir: gameDir });
    expect(existsSync(join(gameDir, 'resourcepacks', OFFLINE_PACK_FILE_NAME))).toBe(false);
    expect(readFileSync(join(gameDir, 'options.txt'), 'utf-8')).toBe('resourcePacks:["vanilla"]\n');
    expect(r.note).toContain(OFFLINE_PACK_FILE_NAME);
  });

  it('remove：本来就什么都没写 → 不炸、不报错', async () => {
    const r = await removeOfflineSkinPack({ instanceGameDir: gameDir });
    expect(r.packPath).toBeNull();
    expect(r.note).toBe('');
  });
});
