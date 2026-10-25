import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceRegistry, type InstanceRecord } from './instance-registry.js';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'mc-instreg-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** 在磁盘上造一个「已下载客户端」的版本目录 */
function seedDownloadedVersion(versionId: string, base = dir): void {
  const v = join(base, 'versions', versionId);
  mkdirSync(v, { recursive: true });
  writeFileSync(join(v, `${versionId}.jar`), 'fake-jar');
}

describe('InstanceRegistry · 迁移扫描', () => {
  it('空目录 → 空表，且写出 instances.json', () => {
    const reg = new InstanceRegistry(dir);
    expect(reg.list()).toEqual([]);
    expect(existsSync(join(dir, 'instances.json'))).toBe(true);
  });

  it('扫描已下载客户端的版本 → 生成实例', () => {
    seedDownloadedVersion('1.21.11');
    seedDownloadedVersion('1.20.1');
    const reg = new InstanceRegistry(dir);
    const list = reg.list();
    expect(list.map((i) => i.versionId).sort()).toEqual(['1.20.1', '1.21.11']);
    expect(list[0].name).toBe(list[0].versionId);
    expect(list[0].loader).toBe('vanilla');
    expect(list[0].source).toBe('downloaded');
  });

  it('加载器目录不单独成实例（它们挂在原版实例上）', () => {
    seedDownloadedVersion('1.21.11');

    // 官方 installer `-noprofile` 的**真实产物形态**：目录名是 `<mc>-<loaderVer>`，
    // 里面是一份 `inheritsFrom` 的档案 + 打好的加载器 jar。
    //
    // 旧实现按 `fabric-loader-*` 前缀跳，于是这个目录（jar 确实存在）
    // 会被当成一个原版实例写进注册表，游戏列表里冒出一个启动不了的卡片。
    const loaderDir = join(dir, 'versions', '1.21.11-0.16.9');
    mkdirSync(loaderDir, { recursive: true });
    writeFileSync(join(loaderDir, '1.21.11-0.16.9.jar'), 'x');
    writeFileSync(
      join(loaderDir, '1.21.11-0.16.9.json'),
      JSON.stringify({
        id: '1.21.11-0.16.9',
        inheritsFrom: '1.21.11',
        mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
        libraries: [],
      }),
    );

    const reg = new InstanceRegistry(dir);
    // 只应有原版那一条
    expect(reg.list()).toHaveLength(1);
    expect(reg.list()[0].versionId).toBe('1.21.11');
    expect(reg.list()[0].loader).toBe('vanilla');
  });

  it('同名但没有档案 JSON 的目录不算加载器（别按名字猜）', () => {
    seedDownloadedVersion('1.21.11');
    // 只有 jar、没有 <id>.json —— 那就是一个普通的原版客户端目录，
    // 不该因为名字里带 `fabric-loader` 就被跳过。
    const odd = join(dir, 'versions', 'fabric-loader-0.16.9-1.21.11');
    mkdirSync(odd, { recursive: true });
    writeFileSync(join(odd, 'fabric-loader-0.16.9-1.21.11.jar'), 'x');

    expect(
      new InstanceRegistry(dir)
        .list()
        .map((i) => i.versionId)
        .sort(),
    ).toEqual(['1.21.11', 'fabric-loader-0.16.9-1.21.11']);
  });

  it('只有目录没有 jar 的版本不算已下载', () => {
    mkdirSync(join(dir, 'versions', '1.19.4'), { recursive: true });
    const reg = new InstanceRegistry(dir);
    expect(reg.list()).toEqual([]);
  });

  it('迁移是幂等的：已存在 instances.json 时不重新扫描', () => {
    seedDownloadedVersion('1.21.11');
    const reg = new InstanceRegistry(dir);
    // 迁移出的那条 id = '1.21.11'。用户起名叫「我的整合包」时是**新建**
    // ——多实例语义：同一个 MC 版本可以有多个实例，各自独立。
    reg.create({ versionId: '1.21.11', name: '我的整合包' });
    expect(existsSync(join(dir, 'instances.json'))).toBe(true);
    expect(
      reg
        .list()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['1.21.11', '我的整合包']);

    // 磁盘上多出一个版本：instances.json 已存在，**不应**被扫进来。
    // （否则会凭空多出一条用户没建过的实例。）
    seedDownloadedVersion('1.20.1');
    expect(
      new InstanceRegistry(dir)
        .list()
        .map((i) => i.id)
        .sort(),
    ).toEqual(['1.21.11', '我的整合包']);
  });

  it('instances.json 损坏时当空表处理，不抛异常', () => {
    seedDownloadedVersion('1.21.11');
    const reg = new InstanceRegistry(dir);
    reg.list(); // 触发迁移并落盘
    writeFileSync(join(dir, 'instances.json'), '{ 这不是合法 JSON', 'utf-8');

    // 主进程不该因一个损坏的 JSON 起不来
    expect(() => new InstanceRegistry(dir).list()).not.toThrow();
    expect(new InstanceRegistry(dir).list()).toEqual([]);
  });
});

describe('InstanceRegistry · CRUD', () => {
  it('create 补齐默认值', () => {
    const reg = new InstanceRegistry(dir);
    const rec = reg.create({ versionId: '1.21.11' });
    expect(rec).toMatchObject({
      id: '1.21.11',
      name: '1.21.11',
      versionId: '1.21.11',
      loader: 'vanilla',
      source: 'downloaded',
    });
    expect(typeof rec.createdAt).toBe('number');
  });

  it('create 保留传入的 username（曾被 setIf 白名单漏掉，静默丢弃）', () => {
    const reg = new InstanceRegistry(dir);
    const rec = reg.create({ versionId: '1.21.11', username: 'Alex' });
    expect(rec.username).toBe('Alex');
    // 落盘后重开仍在
    expect(new InstanceRegistry(dir).list()[0]?.username).toBe('Alex');
  });

  it('create 同版本重复调用时 username 取新值（existing 合并路径同样不丢）', () => {
    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11', username: 'Alex' });
    const again = reg.create({ versionId: '1.21.11', username: 'Steve' });
    expect(again.username).toBe('Steve');
  });

  it('create 不传 username 时该字段保持缺省（不写 null 噪音）', () => {
    const reg = new InstanceRegistry(dir);
    const rec = reg.create({ versionId: '1.21.11' });
    expect(rec.username).toBeUndefined();
    expect(Object.keys(rec)).not.toContain('username');
  });

  it('create 同 id 视为更新，不产生重复', () => {
    const reg = new InstanceRegistry(dir);
    // 同一个 id 调两次 = 更新那条，不是新建
    reg.create({ versionId: '1.21.11', name: 'A' });
    reg.create({ versionId: '1.21.11', name: 'A', loader: 'fabric' });
    const list = reg.list();
    expect(list).toHaveLength(1);
    expect(list[0].loader).toBe('fabric');
  });

  it('★ 多实例：同一个 MC 版本可以有多个实例，各自有独立 gameDir', () => {
    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11', name: '我的空岛' });
    reg.create({ versionId: '1.21.11', name: '高性能光影' });

    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((i) => i.id).sort()).toEqual(['我的空岛', '高性能光影']);
    // 版本产物共享（同一个 versions/1.21.11/），游戏数据隔离
    expect(new Set(list.map((i) => i.versionId))).toEqual(new Set(['1.21.11']));
    expect(list[0].gameDir).not.toBe(list[1].gameDir);
    expect(list[0].gameDir).toContain('我的空岛');
  });

  it('create 二次调用（同 id）时保留未传入的已有字段', () => {
    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11', name: '战斗服', memory: '4G', group: '战斗' });
    // 同 id 再调一次 → 更新；没传的字段要沿用旧值
    const rec = reg.create({ versionId: '1.21.11', name: '战斗服', loader: 'fabric' });
    expect(rec.memory).toBe('4G');
    expect(rec.group).toBe('战斗');
    expect(rec.loader).toBe('fabric');
  });

  it('非法实例名被拒（id 直接当目录名用）', () => {
    const reg = new InstanceRegistry(dir);
    for (const bad of ['', '  ', 'a/b', 'a\\b', 'a:b', 'CON', '我的整合包.', ' 我的世界']) {
      expect(() => reg.create({ versionId: '1.21.11', name: bad }), `名字 ${bad} 应被拒`).toThrow(
        /实例名不合法/,
      );
    }
  });

  it('get 命中 / 未命中', () => {
    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11' });
    expect(reg.get('1.21.11')?.versionId).toBe('1.21.11');
    expect(reg.get('__nope__')).toBeNull();
  });

  it('update 只覆盖传入的字段', () => {
    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11', memory: '2G', group: 'A' });
    const rec = reg.update('1.21.11', { memory: '8G' });
    expect(rec?.memory).toBe('8G');
    expect(rec?.group).toBe('A');
  });

  it('update 不允许改主键 id / versionId', () => {
    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11' });
    const rec = reg.update('1.21.11', {
      id: 'hacked',
      versionId: '9.9.9',
    } as Partial<InstanceRecord>);
    expect(rec?.id).toBe('1.21.11');
    expect(rec?.versionId).toBe('1.21.11');
  });

  it('update 未命中返回 null', () => {
    const reg = new InstanceRegistry(dir);
    expect(reg.update('__nope__', { memory: '2G' })).toBeNull();
  });

  it('remove 只删记录，不动磁盘上的游戏目录', () => {
    seedDownloadedVersion('1.21.11');
    const gameDir = join(dir, 'game', '1.21.11', 'saves');
    mkdirSync(gameDir, { recursive: true });

    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11' });
    expect(reg.remove('1.21.11')).toBe(true);
    expect(reg.list()).toHaveLength(0);
    // 存档必须还在 —— 破坏性删除由调用方二次确认后单独做
    expect(existsSync(gameDir)).toBe(true);
  });

  it('remove 未命中返回 false', () => {
    const reg = new InstanceRegistry(dir);
    expect(reg.remove('__nope__')).toBe(false);
  });
});

describe('InstanceRegistry · 派生状态', () => {
  it('clientReady 反映 jar 是否存在，且由主进程算好', () => {
    seedDownloadedVersion('1.21.11');
    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11' });
    reg.create({ versionId: '1.20.1' }); // 只建记录，没有 jar

    const list = reg.list();
    const byId = Object.fromEntries(list.map((i) => [i.versionId, i]));
    expect(byId['1.21.11'].clientReady).toBe(true);
    expect(byId['1.20.1'].clientReady).toBe(false);
  });

  it('lastLaunchedAt 缺省 = 从未玩过；markLaunched 后有值', () => {
    const reg = new InstanceRegistry(dir);
    const created = reg.create({ versionId: '1.21.11' });
    expect(created.lastLaunchedAt).toBeUndefined();

    reg.markLaunched('1.21.11');
    expect(reg.get('1.21.11')?.lastLaunchedAt).toBeTypeOf('number');
  });

  it('多次启动刷新 lastLaunchedAt', () => {
    const reg = new InstanceRegistry(dir);
    reg.create({ versionId: '1.21.11' });
    reg.markLaunched('1.21.11');
    const first = reg.get('1.21.11')!.lastLaunchedAt!;
    reg.markLaunched('1.21.11');
    expect(reg.get('1.21.11')!.lastLaunchedAt!).toBeGreaterThanOrEqual(first);
  });
});

describe('InstanceRegistry · 持久化', () => {
  it('新 Registry 实例能读到上次写入的数据', () => {
    const reg = new InstanceRegistry(dir);
    // 按**实例名**建（id = name），不是按版本号
    reg.create({ versionId: '1.21.11', name: '持久化测试', memory: '6G' });

    const reopened = new InstanceRegistry(dir);
    expect(reopened.get('持久化测试')).toMatchObject({
      id: '持久化测试',
      name: '持久化测试',
      versionId: '1.21.11',
      memory: '6G',
    });
  });

  it('baseDir 不存在时会自动创建', () => {
    const nested = join(dir, 'deep', 'nested');
    const reg = new InstanceRegistry(nested);
    expect(() => reg.create({ versionId: '1.21.11' })).not.toThrow();
    expect(existsSync(join(nested, 'instances.json'))).toBe(true);
  });
});
