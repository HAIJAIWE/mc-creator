import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  InstanceLoader,
  InstanceRecord as InstanceRecordSchema,
  InstanceSource,
  InstanceSummary as InstanceSummarySchema,
  InstanceWritable,
  LAUNCHER_CREATE_INSTANCE,
  LAUNCHER_DELETE_INSTANCE,
  LAUNCHER_LIST_INSTANCES,
  LAUNCHER_UPDATE_INSTANCE,
  LauncherCreateInstanceRequest,
  LauncherCreateInstanceResponse,
  LauncherDeleteInstanceRequest,
  LauncherDeleteInstanceResponse,
  LauncherListInstancesRequest,
  LauncherListInstancesResponse,
  LauncherUpdateInstanceRequest,
  LauncherUpdateInstanceResponse,
  type InstanceLoader as InstanceLoaderT,
  type InstanceRecord as InstanceRecordT,
  type InstanceSource as InstanceSourceT,
  type InstanceSummary as InstanceSummaryT,
  type LauncherCreateInstanceReq,
  type LauncherUpdateInstanceReq,
} from '../shared/ipc/launcher.js';

/**
 * 本测试文件刻意放在 `src/main/` 而非 `src/shared/ipc/`：
 * 它要 import 实现（`instance-registry.ts`）来证明契约与实现对得上，
 * 而 `tsconfig.web.json` 的 include 里没有 `src/main/**` —— 放在 shared 下
 * 会因 TS6307（composite 项目跨引用）被迫写 `@ts-ignore`。
 * `tsconfig.node.json` 同时 include 了 main 与 shared，所以放这里是干净解。
 */
import {
  InstanceRegistry,
  type InstanceLoader as MainLoader,
  type InstanceRecord as MainRecord,
  type InstanceSource as MainSource,
  type InstanceSummary as MainSummary,
} from './instance-registry.js';

/**
 * L1 实例注册表的 IPC 契约测试。
 *
 * 最关键的一条是最后那个 describe：**schema 与 `main/instance-registry.ts`
 * 的真实类型双向兼容**。schema 与实现对不上是静默 bug —— 编译能过、
 * 运行时字段被 zod strip 掉、注册表里凭空少一列，等用户发现时已经丢数据了。
 * 这里用「编译期互赋值 + 真实注册表往返」两道闸门夹住它。
 */

// ===== 编译期兼容工具 =====

/**
 * 把可选性拉平后再比。
 *
 * 直接 `A extends B` 在本项目过不了：开了 `exactOptionalPropertyTypes`，
 * zod 推断出的 `a?: string | undefined` 不能赋给实现接口的 `a?: string`。
 * 而 `T[K]` 对可选属性取值时**本来就带 `| undefined`**，`-?` 去掉修饰符之后
 * 两侧形状一致，判断才有意义。
 */
type Flat<T> = { [K in keyof T]-?: T[K] };

/** 双向可赋值（对联合类型同样成立，所以枚举也能用）。 */
type Mutual<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** 字段名 + 可选性 + 类型三者都相同才算通过。 */
type Exact<A, B> = Mutual<Flat<A>, Flat<B>>;

/** 必填键集合。 */
type RequiredKeys<T> = { [K in keyof T]-?: object extends Pick<T, K> ? never : K }[keyof T];

// ===== 测试夹具 =====

/** 必填字段：与实现里 `InstanceRecord` 的非 `?` 字段逐项对应。 */
const REQUIRED_KEYS = ['createdAt', 'id', 'loader', 'name', 'source', 'versionId'];

/** 可选字段：与实现里 `InstanceRecord` 的 `?` 字段逐项对应。 */
const OPTIONAL_KEYS = [
  'gameDir',
  'group',
  'iconKey',
  'javaPath',
  'lastLaunchedAt',
  'memory',
  'sourceVersion',
  'username',
];

/**
 * 调用方可写的键 = 记录里的可选字段 + `name` / `loader` / `source`
 * （这三个在记录里是必填，但用户确实能改）。
 * 刻意不含 `id` / `versionId` / `createdAt` —— 由注册表单方面决定。
 */
const WRITABLE_KEYS = [...OPTIONAL_KEYS, 'loader', 'name', 'source'].sort();

const MINIMAL_RECORD = {
  id: '1.21.11',
  name: '1.21.11',
  versionId: '1.21.11',
  loader: 'vanilla' as const,
  source: 'downloaded' as const,
  createdAt: 1_700_000_000_000,
};

const FULL_RECORD = {
  id: '1.21.11',
  name: 'Fabric 26.2',
  versionId: '1.21.11',
  loader: 'fabric' as const,
  source: 'downloaded' as const,
  sourceVersion: '26.2-1.2.1',
  gameDir: join('C:', 'mc', 'game', '1.21.11'),
  memory: '4G',
  javaPath: join('C:', 'Java', 'bin', 'javaw.exe'),
  iconKey: 'grass_block',
  group: '自定义组',
  username: 'Steve',
  createdAt: 1_700_000_000_000,
  lastLaunchedAt: 1_700_000_100_000,
};

// ===== 通道常量 =====

describe('L1 实例注册表 · 通道常量', () => {
  it('四个通道名唯一，且都挂在 launcher: 前缀下', () => {
    const channels = [
      LAUNCHER_LIST_INSTANCES,
      LAUNCHER_CREATE_INSTANCE,
      LAUNCHER_UPDATE_INSTANCE,
      LAUNCHER_DELETE_INSTANCE,
    ];
    expect(new Set(channels).size).toBe(channels.length);
    for (const c of channels) expect(c.startsWith('launcher:')).toBe(true);
  });

  it('通道名不是本文件里已有的 launcher 通道（防止撞车）', () => {
    const existing = new Set([
      'launcher:listVersions',
      'launcher:download',
      'launcher:launch',
      'launcher:installLoader',
      'launcher:installSkin',
      'launcher:listInstanceFiles',
      'launcher:listMods',
      'launcher:installMod',
      'launcher:removeMod',
      'launcher:toggleMod',
      'launcher:logStream',
      'launcher:readLatestLog',
      'launcher:listCrashReports',
      'launcher:readCrashReport',
    ]);
    for (const c of [
      LAUNCHER_LIST_INSTANCES,
      LAUNCHER_CREATE_INSTANCE,
      LAUNCHER_UPDATE_INSTANCE,
      LAUNCHER_DELETE_INSTANCE,
    ]) {
      expect(existing.has(c)).toBe(false);
    }
  });
});

// ===== 枚举 =====

describe('L1 · InstanceLoader / InstanceSource 枚举', () => {
  it('InstanceLoader 接受 vanilla / fabric / neoforge', () => {
    expect(InstanceLoader.parse('vanilla')).toBe('vanilla');
    expect(InstanceLoader.parse('fabric')).toBe('fabric');
    expect(InstanceLoader.parse('neoforge')).toBe('neoforge');
    expect(InstanceLoader.options).toEqual(['vanilla', 'fabric', 'neoforge']);
  });

  it('InstanceLoader 拒绝未知加载器', () => {
    expect(InstanceLoader.safeParse('quilt').success).toBe(false);
    expect(InstanceLoader.safeParse('').success).toBe(false);
    expect(InstanceLoader.safeParse(1).success).toBe(false);
  });

  it('InstanceSource 接受四条来源路径', () => {
    expect(InstanceSource.options).toEqual([
      'downloaded',
      'imported',
      'offline-dir',
      'project-jar',
    ]);
    for (const s of ['downloaded', 'imported', 'offline-dir', 'project-jar']) {
      expect(InstanceSource.safeParse(s).success).toBe(true);
    }
  });

  it('InstanceSource 拒绝未知来源', () => {
    expect(InstanceSource.safeParse('modrinth').success).toBe(false);
    expect(InstanceSource.safeParse('Downloaded').success).toBe(false);
    expect(InstanceSource.safeParse(null).success).toBe(false);
  });
});

// ===== InstanceRecord =====

describe('L1 · InstanceRecord schema', () => {
  it('全字段记录 parse 成功且一个字段都不丢', () => {
    const parsed = InstanceRecordSchema.parse(FULL_RECORD);
    expect(parsed).toEqual(FULL_RECORD);
  });

  it('只给必填字段也合法（可选字段缺省）', () => {
    expect(InstanceRecordSchema.safeParse(MINIMAL_RECORD).success).toBe(true);
    expect(InstanceRecordSchema.parse(MINIMAL_RECORD)).toEqual(MINIMAL_RECORD);
  });

  it('必填字段逐个缺失都被拒', () => {
    for (const key of REQUIRED_KEYS) {
      const broken: Record<string, unknown> = { ...MINIMAL_RECORD };
      delete broken[key];
      expect(InstanceRecordSchema.safeParse(broken).success, `缺 ${key} 应该被拒`).toBe(false);
    }
  });

  it('类型错一律被拒（数字字段不收字符串，枚举不收自由文本）', () => {
    expect(InstanceRecordSchema.safeParse({ ...MINIMAL_RECORD, createdAt: '1700' }).success).toBe(
      false,
    );
    expect(
      InstanceRecordSchema.safeParse({ ...MINIMAL_RECORD, lastLaunchedAt: '1700' }).success,
    ).toBe(false);
    expect(InstanceRecordSchema.safeParse({ ...MINIMAL_RECORD, loader: 'quilt' }).success).toBe(
      false,
    );
    expect(InstanceRecordSchema.safeParse({ ...MINIMAL_RECORD, source: 'modrinth' }).success).toBe(
      false,
    );
    expect(InstanceRecordSchema.safeParse({ ...MINIMAL_RECORD, id: 42 }).success).toBe(false);
    expect(InstanceRecordSchema.safeParse({ ...MINIMAL_RECORD, memory: 4096 }).success).toBe(false);
  });

  it('未知字段被 strip —— 不会顺着 IPC 悄悄混进注册表', () => {
    const parsed = InstanceRecordSchema.parse({ ...MINIMAL_RECORD, __proto__hack: 'x', evil: 1 });
    expect(parsed).toEqual(MINIMAL_RECORD);
    expect(Object.keys(parsed).sort()).toEqual([...REQUIRED_KEYS].sort());
  });

  it('字段清单与实现逐项对应（必填 / 可选分开核对）', () => {
    expect(Object.keys(InstanceRecordSchema.shape).sort()).toEqual(
      [...REQUIRED_KEYS, ...OPTIONAL_KEYS].sort(),
    );
    const required = Object.entries(InstanceRecordSchema.shape)
      .filter(([, s]) => !s.isOptional())
      .map(([k]) => k)
      .sort();
    expect(required).toEqual(REQUIRED_KEYS);
  });
});

// ===== InstanceSummary =====

describe('L1 · InstanceSummary schema', () => {
  it('记录 + clientReady 才能通过', () => {
    expect(InstanceSummarySchema.safeParse({ ...MINIMAL_RECORD, clientReady: true }).success).toBe(
      true,
    );
    expect(InstanceSummarySchema.safeParse(MINIMAL_RECORD).success).toBe(false);
    expect(InstanceSummarySchema.safeParse({ ...MINIMAL_RECORD, clientReady: 'yes' }).success).toBe(
      false,
    );
  });

  it('字段 = InstanceRecord 的全部字段 + clientReady', () => {
    expect(Object.keys(InstanceSummarySchema.shape).sort()).toEqual(
      [...REQUIRED_KEYS, ...OPTIONAL_KEYS, 'clientReady'].sort(),
    );
  });
});

// ===== Request =====

describe('L1 · Request schema', () => {
  it('ListInstances 无参（实现 list() 本来就没有入参）', () => {
    expect(LauncherListInstancesRequest.safeParse({}).success).toBe(true);
    // 多余参数被 strip，不报错（IPC 客户端升级滞后时不至于整个调用挂掉）
    expect(LauncherListInstancesRequest.parse({ group: 'x' })).toEqual({});
  });

  it('CreateInstance：全字段 / 最小字段都合法', () => {
    expect(LauncherCreateInstanceRequest.safeParse(FULL_RECORD).success).toBe(true);
    expect(LauncherCreateInstanceRequest.safeParse({ versionId: '1.20.1' }).success).toBe(true);
  });

  it('CreateInstance：versionId 缺失 / 空串 / 类型错都被拒', () => {
    expect(LauncherCreateInstanceRequest.safeParse({}).success).toBe(false);
    expect(LauncherCreateInstanceRequest.safeParse({ versionId: '' }).success).toBe(false);
    expect(LauncherCreateInstanceRequest.safeParse({ versionId: 121 }).success).toBe(false);
    expect(
      LauncherCreateInstanceRequest.safeParse({ versionId: '1.20.1', loader: 'quilt' }).success,
    ).toBe(false);
    expect(
      LauncherCreateInstanceRequest.safeParse({ versionId: '1.20.1', source: 'x' }).success,
    ).toBe(false);
  });

  it('CreateInstance：id / createdAt 不在白名单，传了也被 strip', () => {
    // 这两个由注册表单方面决定；开放它们等于「传了但没生效」
    const parsed = LauncherCreateInstanceRequest.parse({
      versionId: '1.20.1',
      id: 'hijack',
      createdAt: 0,
    });
    expect(parsed).toEqual({ versionId: '1.20.1' });
  });

  it('UpdateInstance：{ id, patch } 合法，空 patch 也合法', () => {
    expect(LauncherUpdateInstanceRequest.safeParse({ id: '1.20.1', patch: {} }).success).toBe(true);
    expect(
      LauncherUpdateInstanceRequest.safeParse({ id: '1.20.1', patch: FULL_RECORD }).success,
    ).toBe(true);
  });

  it('UpdateInstance：id 缺失 / 空串，patch 缺字段或类型错都被拒', () => {
    expect(LauncherUpdateInstanceRequest.safeParse({ patch: {} }).success).toBe(false);
    expect(LauncherUpdateInstanceRequest.safeParse({ id: '', patch: {} }).success).toBe(false);
    expect(LauncherUpdateInstanceRequest.safeParse({ id: 'a' }).success).toBe(false);
    expect(
      LauncherUpdateInstanceRequest.safeParse({ id: 'a', patch: { memory: 4096 } }).success,
    ).toBe(false);
    expect(
      LauncherUpdateInstanceRequest.safeParse({ id: 'a', patch: { loader: 'quilt' } }).success,
    ).toBe(false);
  });

  it('DeleteInstance：支持 deleteFiles 开关，且必须是布尔', () => {
    expect(LauncherDeleteInstanceRequest.safeParse({ id: '1.20.1' }).success).toBe(true);
    expect(
      LauncherDeleteInstanceRequest.safeParse({ id: '1.20.1', deleteFiles: true }).success,
    ).toBe(true);
    expect(
      LauncherDeleteInstanceRequest.safeParse({ id: '1.20.1', deleteFiles: 'yes' }).success,
    ).toBe(false);
    expect(LauncherDeleteInstanceRequest.safeParse({ id: '' }).success).toBe(false);
    expect(LauncherDeleteInstanceRequest.safeParse({}).success).toBe(false);
  });

  it('可写字段白名单与实现的可编辑字段对齐（不含 id / versionId / createdAt）', () => {
    expect(Object.keys(InstanceWritable.shape).sort()).toEqual(WRITABLE_KEYS);
  });
});

// ===== Response =====

describe('L1 · Response schema', () => {
  it('List 响应：instances 是 InstanceSummary[]，error 可缺省 / 可为 null', () => {
    const body = { instances: [{ ...MINIMAL_RECORD, clientReady: true }] };
    expect(LauncherListInstancesResponse.safeParse(body).success).toBe(true);
    expect(LauncherListInstancesResponse.safeParse({ ...body, error: null }).success).toBe(true);
    expect(LauncherListInstancesResponse.safeParse({ ...body, error: 'x' }).success).toBe(true);
    expect(LauncherListInstancesResponse.safeParse({ ...body, error: 1 }).success).toBe(false);
  });

  it('List 响应：缺 instances 被拒，实例缺 clientReady 被拒', () => {
    expect(LauncherListInstancesResponse.safeParse({}).success).toBe(false);
    expect(LauncherListInstancesResponse.safeParse({ instances: [MINIMAL_RECORD] }).success).toBe(
      false,
    );
  });

  it('Create / Update 响应：instance 可为 null（主键拼错必须看得出来）', () => {
    expect(LauncherCreateInstanceResponse.safeParse({ ok: false, instance: null }).success).toBe(
      true,
    );
    expect(
      LauncherCreateInstanceResponse.safeParse({ ok: true, instance: FULL_RECORD }).success,
    ).toBe(true);
    expect(LauncherCreateInstanceResponse.safeParse({ ok: true }).success).toBe(false);
    expect(LauncherUpdateInstanceResponse.safeParse({ ok: false, instance: null }).success).toBe(
      true,
    );
    expect(
      LauncherUpdateInstanceResponse.safeParse({ ok: true, instance: MINIMAL_RECORD }).success,
    ).toBe(true);
    expect(LauncherUpdateInstanceResponse.safeParse({ instance: null }).success).toBe(false);
  });

  it('Delete 响应：ok + filesDeleted 必填，error 可选', () => {
    // filesDeleted 必填：删除记录总会发生，但「有没有真的删磁盘」必须由 UI 区分
    expect(
      LauncherDeleteInstanceResponse.safeParse({ ok: true, filesDeleted: false }).success,
    ).toBe(true);
    expect(
      LauncherDeleteInstanceResponse.safeParse({ ok: true, filesDeleted: true, error: null })
        .success,
    ).toBe(true);
    expect(
      LauncherDeleteInstanceResponse.safeParse({ ok: false, filesDeleted: false }).success,
    ).toBe(true);
    expect(
      LauncherDeleteInstanceResponse.safeParse({ ok: 'true', filesDeleted: false }).success,
    ).toBe(false);
    // 漏掉 filesDeleted 必须拒绝
    expect(LauncherDeleteInstanceResponse.safeParse({ ok: true }).success).toBe(false);
    expect(LauncherDeleteInstanceResponse.safeParse({}).success).toBe(false);
  });
});

// ===== 与实现的双向兼容 =====

describe('L1 · schema 与 main/instance-registry.ts 的双向兼容', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mc-instschema-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** 造一个「已下载客户端」的版本目录，好让 list() 算出 clientReady: true */
  function seedVersion(versionId: string): void {
    const v = join(dir, 'versions', versionId);
    mkdirSync(v, { recursive: true });
    writeFileSync(join(v, `${versionId}.jar`), 'fake-jar');
  }

  it('【编译期】枚举双向可赋值', () => {
    const loaderOk: Mutual<InstanceLoaderT, MainLoader> = true;
    const sourceOk: Mutual<InstanceSourceT, MainSource> = true;
    expect(loaderOk).toBe(true);
    expect(sourceOk).toBe(true);
  });

  it('【编译期】InstanceRecord / InstanceSummary 字段名、可选性、类型全等', () => {
    // 这两行只要 schema 与实现对不上（改名 / 少字段 / 多字段 / 必填变可选）就编译不过
    const recordOk: Exact<InstanceRecordT, MainRecord> = true;
    const summaryOk: Exact<InstanceSummaryT, MainSummary> = true;
    expect(recordOk).toBe(true);
    expect(summaryOk).toBe(true);
  });

  it('【编译期】必填键集合与实现一致', () => {
    const reqOk: Mutual<RequiredKeys<InstanceRecordT>, RequiredKeys<MainRecord>> = true;
    const sumReqOk: Mutual<RequiredKeys<InstanceSummaryT>, RequiredKeys<MainSummary>> = true;
    expect(reqOk).toBe(true);
    expect(sumReqOk).toBe(true);
  });

  it('【编译期】create 请求的每个字段都能被实现接住（没有凭空多出来的键）', () => {
    type CreateKeys = keyof LauncherCreateInstanceReq;
    type UpdateKeys = keyof LauncherUpdateInstanceReq;
    const createKeysOk: Extract<CreateKeys, keyof MainRecord> extends CreateKeys
      ? Extract<CreateKeys, keyof MainRecord>
      : never = 'versionId';
    const updateKeysOk: Extract<UpdateKeys, keyof MainRecord | 'id' | 'patch'> = 'id';
    expect(createKeysOk).toBe('versionId');
    expect(updateKeysOk).toBe('id');
  });

  it('【运行时】真实注册表产出的记录能被 schema 完整接住（往返无字段丢失）', () => {
    seedVersion('1.21.11');
    const reg = new InstanceRegistry(dir);
    const created = reg.create({
      versionId: '1.21.11',
      name: 'Fabric 26.2',
      loader: 'fabric',
      source: 'downloaded',
      sourceVersion: '26.2-1.2.1',
      memory: '4G',
      group: '自定义组',
      iconKey: 'grass_block',
      gameDir: join(dir, 'game', '1.21.11'),
      javaPath: 'C:/Java/bin/javaw.exe',
    });
    const updated = reg.update('1.21.11', { memory: '8G', lastLaunchedAt: 42 });

    // 走一遍真实的 IPC 编解码（结构化克隆 ≈ JSON）
    for (const record of [created, updated!]) {
      const wire = JSON.parse(JSON.stringify(record)) as MainRecord;
      expect(InstanceRecordSchema.safeParse(wire).success).toBe(true);
      const parsed = InstanceRecordSchema.parse(wire);
      expect(parsed).toEqual(record);
      expect(Object.keys(parsed).sort()).toEqual(Object.keys(record).sort());
    }
    expect(updated!.memory).toBe('8G');
  });

  it('【运行时】真实 list() 的 summary 往返无字段丢失，clientReady 被校验', () => {
    seedVersion('1.21.11');
    const reg = new InstanceRegistry(dir);
    const list = reg.list();
    expect(list.length).toBe(1);

    const wire = JSON.parse(JSON.stringify(list[0])) as MainSummary;
    const parsed = InstanceSummarySchema.parse(wire);
    expect(parsed).toEqual(list[0]);
    expect(parsed.clientReady).toBe(true);
    // 关键：实现给出的每个键，schema 都认
    expect(Object.keys(parsed).sort()).toEqual(Object.keys(list[0]).sort());

    // 去掉 clientReady 就不该通过（证明 schema 真的在校验这个字段，而不是恰好放过）
    const { clientReady: _dropped, ...without } = wire;
    expect(InstanceSummarySchema.safeParse(without).success).toBe(false);
  });

  it('【运行时】实现里的枚举值全部被 schema 接受', () => {
    for (const loader of ['vanilla', 'fabric', 'neoforge'] as const) {
      expect(InstanceLoader.safeParse(loader).success).toBe(true);
      expect(InstanceRecordSchema.safeParse({ ...MINIMAL_RECORD, loader }).success).toBe(true);
    }
    for (const source of ['downloaded', 'imported', 'offline-dir', 'project-jar'] as const) {
      expect(InstanceSource.safeParse(source).success).toBe(true);
      expect(InstanceRecordSchema.safeParse({ ...MINIMAL_RECORD, source }).success).toBe(true);
    }
  });
});
