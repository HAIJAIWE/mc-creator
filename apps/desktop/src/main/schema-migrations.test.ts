// @vitest-environment node
/**
 * schema-migrations 单元测试（§12「所有写入走版本化迁移脚本」+「迁移幂等判断」）。
 *
 * 覆盖矩阵：
 *  - 无版本号的老数据 → 按 BASE_VERSION(0) 走全链
 *  - 已是最新 → 幂等短路，一个迁移都不重跑
 *  - 数据版本高于代码 → 明确报错（拒绝降级）
 *  - 迁移链有洞 / 重复 / 非正整数 → fail-fast
 *  - 多步迁移按 version 升序执行，且只跑 from 之后的部分
 *  - 每步入参深拷贝，改写不污染原始对象
 *  - schemaVersion 结构非法 → 抛错而不是当 0
 */
import { describe, it, expect } from 'vitest';
import {
  BASE_VERSION,
  MigrationChainError,
  SchemaVersionTooNewError,
  assertChainIsSane,
  latestVersion,
  migrate,
  readSchemaVersion,
  type SchemaMigration,
} from './schema-migrations.js';

/** 造一条迁移：给 version 打上标记并累加 trail。 */
function step(version: number, trail: string[]): SchemaMigration {
  return {
    version,
    description: `迁移到 v${version}`,
    up(data: Record<string, unknown>) {
      trail.push(`v${version}`);
      return { ...data, [`v${version}`]: true, version };
    },
  };
}

describe('schema-migrations：常量与版本读取', () => {
  it('BASE_VERSION 为 0（无版本号 = 迁移前）', () => {
    expect(BASE_VERSION).toBe(0);
  });

  it('readSchemaVersion：无 schemaVersion 字段的老数据视为 BASE_VERSION', () => {
    expect(readSchemaVersion({ id: 'p1' })).toBe(BASE_VERSION);
    expect(readSchemaVersion({ schemaVersion: undefined })).toBe(BASE_VERSION);
  });

  it('readSchemaVersion：非对象（null / 数组 / 原始值）也视为 BASE_VERSION', () => {
    expect(readSchemaVersion(null)).toBe(BASE_VERSION);
    expect(readSchemaVersion([1, 2, 3])).toBe(BASE_VERSION);
    expect(readSchemaVersion('x')).toBe(BASE_VERSION);
    expect(readSchemaVersion(42)).toBe(BASE_VERSION);
  });

  it('readSchemaVersion：正常信封读出整数版本', () => {
    expect(
      readSchemaVersion({ schemaVersion: { version: 3, appliedAt: 'now', checksum: '' } }),
    ).toBe(3);
    expect(readSchemaVersion({ schemaVersion: { version: 0 } })).toBe(0);
  });

  it('readSchemaVersion：信封结构非法 → 抛错，不静默当 0（否则掩盖数据损坏）', () => {
    expect(() => readSchemaVersion({ schemaVersion: 'v3' })).toThrow(MigrationChainError);
    expect(() => readSchemaVersion({ schemaVersion: 3 })).toThrow(MigrationChainError);
    expect(() => readSchemaVersion({ schemaVersion: [] })).toThrow(MigrationChainError);
    expect(() => readSchemaVersion({ schemaVersion: { version: -1 } })).toThrow(
      MigrationChainError,
    );
    expect(() => readSchemaVersion({ schemaVersion: { version: 1.5 } })).toThrow(
      MigrationChainError,
    );
    expect(() => readSchemaVersion({ schemaVersion: { version: 'x' } })).toThrow(
      MigrationChainError,
    );
    expect(() => readSchemaVersion({ schemaVersion: { version: NaN } })).toThrow(
      MigrationChainError,
    );
  });

  it('latestVersion：空迁移链 → BASE_VERSION；否则取最大 version', () => {
    expect(latestVersion([])).toBe(BASE_VERSION);
    expect(latestVersion([step(1, []), step(2, [])])).toBe(2);
  });
});

describe('schema-migrations：迁移链连续性校验（fail-fast）', () => {
  it('连续链 1..N 通过', () => {
    expect(() => assertChainIsSane([step(1, []), step(2, []), step(3, [])])).not.toThrow();
    expect(() => assertChainIsSane([])).not.toThrow();
    expect(() => assertChainIsSane([step(1, [])])).not.toThrow();
  });

  it('有洞（1 → 3 缺 2）抛 MigrationChainError 并指名缺失版本', () => {
    const bad = [step(1, []), step(3, [])];
    expect(() => assertChainIsSane(bad)).toThrow(MigrationChainError);
    expect(() => assertChainIsSane(bad)).toThrow(/缺失: 2/);
  });

  it('从 2 开始（缺 1）也判为不连续', () => {
    expect(() => assertChainIsSane([step(2, []), step(3, [])])).toThrow(MigrationChainError);
  });

  it('重复版本号抛错', () => {
    const dup = [step(1, []), step(1, [])];
    expect(() => assertChainIsSane(dup)).toThrow(MigrationChainError);
    expect(() => assertChainIsSane(dup)).toThrow(/重复版本号/);
  });

  it('非正整数 / 非整数版本号抛错', () => {
    expect(() => assertChainIsSane([step(0, [])])).toThrow(/从 1 开始的整数/);
    expect(() =>
      assertChainIsSane([
        { version: 1.5, description: 'x', up: (d) => d },
        { version: 2, description: 'y', up: (d) => d },
      ]),
    ).toThrow(/从 1 开始的整数/);
  });

  it('注册顺序乱序不影响校验（以 version 为准）', () => {
    expect(() => assertChainIsSane([step(3, []), step(1, []), step(2, [])])).not.toThrow();
  });

  it('migrate 自身也校验链（有洞时抛错而非跳过）', () => {
    expect(() => migrate({ a: 1 }, [step(1, []), step(3, [])])).toThrow(MigrationChainError);
  });
});

describe('schema-migrations：migrate 执行语义', () => {
  it('无版本号的老数据 → 按 BASE_VERSION 跑完整条链', () => {
    const trail: string[] = [];
    const res = migrate<Record<string, unknown>>({ id: 'old' }, [step(1, trail), step(2, trail)]);
    expect(res.from).toBe(BASE_VERSION);
    expect(res.to).toBe(2);
    expect(res.applied).toEqual([1, 2]);
    expect(trail).toEqual(['v1', 'v2']);
    expect(res.data).toMatchObject({ id: 'old', v1: true, v2: true });
    // 老字段不丢
    expect(res.data['id']).toBe('old');
  });

  it('多步迁移严格按 version 升序执行（注册顺序乱序时也成立）', () => {
    const trail: string[] = [];
    const res = migrate<Record<string, unknown>>({ schemaVersion: { version: 0 } }, [
      step(3, trail),
      step(1, trail),
      step(2, trail),
    ]);
    expect(trail).toEqual(['v1', 'v2', 'v3']);
    expect(res.applied).toEqual([1, 2, 3]);
  });

  it('已是最新版本 → 幂等短路：不重跑任何迁移', () => {
    const trail: string[] = [];
    const raw = { schemaVersion: { version: 2, appliedAt: 'x', checksum: '' }, name: 'n' };
    const res = migrate<Record<string, unknown>>(raw, [step(1, trail), step(2, trail)]);
    expect(res.applied).toEqual([]);
    expect(res.from).toBe(2);
    expect(res.to).toBe(2);
    expect(trail).toEqual([]);
    // 原样返回同一个引用（幂等的字面含义：一个字节都不动）
    expect(res.data).toBe(raw);
  });

  it('部分落后 → 只跑 from 之后的步骤', () => {
    const trail: string[] = [];
    const raw = { schemaVersion: { version: 1 }, keep: 'me' };
    const res = migrate<Record<string, unknown>>(raw, [
      step(1, trail),
      step(2, trail),
      step(3, trail),
    ]);
    expect(res.applied).toEqual([2, 3]);
    expect(trail).toEqual(['v2', 'v3']);
    expect(res.data['keep']).toBe('me');
  });

  it('数据版本高于代码 → SchemaVersionTooNewError，且提示升级应用', () => {
    const trail: string[] = [];
    const raw = { schemaVersion: { version: 9 }, futureField: 'x' };
    let caught: unknown;
    try {
      migrate(raw, [step(1, trail), step(2, trail)]);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(SchemaVersionTooNewError);
    const err = caught as SchemaVersionTooNewError;
    expect(err.dataVersion).toBe(9);
    expect(err.supportedVersion).toBe(2);
    expect(err.message).toMatch(/请升级应用/);
    // 关键：一个迁移都没跑，新字段没被丢弃（是拒绝，不是降级）
    expect(trail).toEqual([]);
    expect((raw as Record<string, unknown>)['futureField']).toBe('x');
  });

  it('数据版本比代码新 1 个版本也算过高（拒绝降级，不做 best-effort）', () => {
    expect(() => migrate({ schemaVersion: { version: 3 } }, [step(1, []), step(2, [])])).toThrow(
      SchemaVersionTooNewError,
    );
  });

  it('空迁移链 + BASE_VERSION 数据 → 幂等返回原对象', () => {
    const raw = { a: 1 };
    const res = migrate(raw, []);
    expect(res.data).toBe(raw);
    expect(res.applied).toEqual([]);
    expect(res.to).toBe(BASE_VERSION);
  });

  it('空迁移链 + 有版本的数据 → 视为过高（无任何迁移可跑）', () => {
    expect(() => migrate({ schemaVersion: { version: 1 } }, [])).toThrow(SchemaVersionTooNewError);
  });

  it('每步入参是独立深拷贝：就地改写不污染原始对象', () => {
    const inPlace: SchemaMigration = {
      version: 1,
      description: '就地改写型迁移',
      up(data) {
        const rec = data as { nested: { n: number }; added?: boolean };
        rec.nested.n = 999;
        rec.added = true;
        return rec;
      },
    };
    const raw: { nested: { n: number }; added?: boolean } = { nested: { n: 1 } };
    const res = migrate<{ nested: { n: number }; added?: boolean }>(raw, [inPlace]);
    expect(res.data.nested.n).toBe(999);
    expect(res.data.added).toBe(true);
    // 原始对象没被改 —— 否则读路径上"先判断再迁移"的调用方会被污染
    expect(raw.nested.n).toBe(1);
  });

  it('迁移抛错时错误向上传播（不吞掉，交给调用方决定跳过还是中止）', () => {
    const boom: SchemaMigration = {
      version: 1,
      description: '会炸的迁移',
      up() {
        throw new Error('migration exploded');
      },
    };
    expect(() => migrate({}, [boom])).toThrow(/migration exploded/);
  });

  it('信封里的 appliedAt / checksum 由迁移自己维护，框架不覆盖', () => {
    const stampMigration: SchemaMigration = {
      version: 1,
      description: '盖时间戳',
      up(data) {
        const rec = data as Record<string, unknown>;
        return { ...rec, schemaVersion: { version: 1, appliedAt: 'FIXED', checksum: '' } };
      },
    };
    const res = migrate<{ schemaVersion: unknown }>({}, [stampMigration]);
    expect(res.data.schemaVersion).toEqual({ version: 1, appliedAt: 'FIXED', checksum: '' });
  });

  it('readSchemaVersion 与 migrate 对同一份数据给出一致的 from（避免两处语义分叉）', () => {
    const raw = { schemaVersion: { version: 2 } };
    const migrations = [step(1, []), step(2, []), step(3, [])];
    const res = migrate(raw, migrations);
    expect(res.from).toBe(readSchemaVersion(raw));
    expect(res.from).toBe(2);
  });

  it('链在两次调用之间被改坏 → 第二次 migrate 立即抛错（不缓存陈旧校验结论）', () => {
    const trail: string[] = [];
    const migrations: SchemaMigration[] = [step(1, trail), step(2, trail)];
    expect(() => migrate({}, migrations)).not.toThrow();
    // 模拟开发期有人插入了有洞的版本
    migrations.push(step(4, trail));
    expect(() => migrate({}, migrations)).toThrow(MigrationChainError);
  });
});
