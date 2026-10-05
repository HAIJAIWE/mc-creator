/**
 * 版本化数据迁移框架（设计文档 §12 数据模型）。
 *
 * §12 结尾的硬性约束：
 * > **约束**：所有表带 `edition` 字段或显式区域归属；**所有写入走版本化迁移脚本**。
 *
 * §12 同时定义了迁移幂等判断依据：
 * ```ts
 * SchemaVersion  { version, appliedAt, checksum }        // 迁移幂等判断
 * ```
 *
 * ## 为什么需要「版本号」而不是「按字段猜」
 *
 * 分文件存储（project-store 的 `userData/projects/<id>.json`）在没有版本号时
 * 无法区分两种语义完全不同的数据：
 *  - 老版本应用写出的**合法但缺字段**的数据（需要迁移、补默认值）
 *  - 新版本应用写出的**同样缺字段**的数据（说明写入方有 bug）
 * 老用户升级后拿到的是缺字段的旧数据，应用无从检测，也就无从修复。
 * 版本号把这个「二义性」变成显式事实：读到的数据自带一个可比较的整数。
 *
 * ## 为什么数据版本高于代码时必须报错而不是降级
 *
 * 假设数据是 v5、当前代码只认 v3。若「尽力而为」地把 v5 数据塞进 v3 的结构，
 * v4/v5 引入而 v3 不认识的字段会被**静默丢弃**（zod 默认 strip 未知键）。
 * 用户下次启动会发现自己的数据凭空少了几项，且没有任何报错可查 —— 这是
 * 比「明确拒绝启动」严重得多的数据丢失。因此这里 fail-fast。
 *
 * ## 为什么迁移链有洞要在启动时炸
 *
 * 迁移链 `1 → 3`（缺 2）是**开发期错误**，不是运行时数据问题：如果静默跳过，
 * 一份 v1 数据会被当成 v3 处理，v2 该做的转换永远不发生，且线上无法察觉。
 * 所以 `assertChainIsSane` 在模块加载期就抛错（fail-fast），让错误在
 * 开发机第一时间暴露，而不是在用户机器上。
 *
 * ## checksum 为什么当前留空
 *
 * §12 的 `SchemaVersion.checksum` 字段保留在写入的信封里，但当前实现写空串，
 * 理由见 `PROJECT_ENVELOPE_VERSION` 处的注释：本地单用户 json 的唯一写入方是
 * 本应用自己，checksum 在「检测外部手改」这件事上会产生持续误报
 * （用户手工编辑项目文件是正常操作），而在「迁移幂等判断」上完全多余
 * （`version` 整数本身就是幂等键）。为一个当前无判据的字段编造校验和，
 * 只会制造「校验失败」的噪音，所以宁可留空等真正有判据时再填。
 */

/**
 * 无版本号数据的基准版本。
 *
 * 老文件（`projects/<id>.json` 早期形态）根本没有 `schemaVersion` 字段，
 * 语义上等价于「v0：还没有任何版本化约束的历史数据」。把它显式定为 0，
 * 好处是迁移链从 1 开始编号，0 天然表示「迁移前」，不需要哨兵值 / null 分支。
 */
export const BASE_VERSION = 0;

/** §12 的 SchemaVersion 形状（与 @mc-creator/contract 的定义同形）。 */
export interface SchemaVersionStamp {
  /** 数据当前所处的 schema 版本。 */
  version: number;
  /** 该版本落地的时间（ISO 8601）。 */
  appliedAt: string;
  /**
   * §12 预留字段。**当前实现恒为空串**，理由见文件头「checksum 为什么当前留空」。
   * 保留它是为了信封形状与 §12 一致，将来有真实判据时可原地启用。
   */
  checksum: string;
}

/** 一条迁移步骤：`up` 把 version-1 形态的数据变成 version 形态。 */
export interface SchemaMigration {
  /** 该步骤产出的目标版本（必须等于前一步的 version + 1）。 */
  readonly version: number;
  /** 该步骤做了什么（仅用于报错信息与调试，不参与逻辑）。 */
  readonly description: string;
  /**
   * 纯函数：接收上一步的输出，返回新对象。
   * 框架会为每一步提供独立的深拷贝入参，因此实现里**可以**就地改写，
   * 但推荐返回新对象以保持可测试性。
   */
  up(data: unknown): unknown;
}

/** 迁移链本身不合法（版本号有洞 / 重复 / 非正整数）—— 开发期错误。 */
export class MigrationChainError extends Error {
  override readonly name = 'MigrationChainError';
}

/**
 * 数据版本高于当前代码支持的版本 —— 运行期错误，且**不可降级**。
 * 消息里必须包含「请升级应用」，这是给用户的行动指引。
 */
export class SchemaVersionTooNewError extends Error {
  override readonly name = 'SchemaVersionTooNewError';
  readonly dataVersion: number;
  readonly supportedVersion: number;

  constructor(dataVersion: number, supportedVersion: number) {
    super(
      `数据 schema 版本 v${dataVersion} 高于当前应用支持的 v${supportedVersion}` +
        `：数据由更高版本创建，请升级应用后再打开（拒绝降级以免静默丢弃新字段）`,
    );
    this.dataVersion = dataVersion;
    this.supportedVersion = supportedVersion;
  }
}

/**
 * 校验迁移链连续无洞、版本号唯一且从 1 开始。
 *
 * 刻意在**模块加载期**由各 store 调用（见 project-store.ts），
 * 让「1→3 缺 2」这类开发错误在应用启动的第一时间炸出来，
 * 而不是等到某个用户的旧数据触发迁移时才发现。
 */
export function assertChainIsSane(migrations: readonly SchemaMigration[]): void {
  const versions = migrations.map((m) => m.version);
  const dup = versions.filter((v, i) => versions.indexOf(v) !== i);
  if (dup.length > 0) {
    throw new MigrationChainError(
      `迁移链存在重复版本号: ${[...new Set(dup)].join(', ')}（同一版本只能有一条迁移）`,
    );
  }
  // 升序副本：调用方可能按任意顺序注册，逻辑上以 version 为准。
  const sorted = [...versions].sort((a, b) => a - b);
  sorted.forEach((v, i) => {
    if (!Number.isInteger(v) || v < 1) {
      throw new MigrationChainError(`迁移版本号必须是从 1 开始的整数，收到: ${v}`);
    }
    // 连续性：第 i 项必须恰好是 i+1，任何空洞都意味着数据会被跳过转换。
    if (v !== i + 1) {
      const missing = Array.from({ length: sorted.length }, (_, k) => k + 1)
        .filter((n) => !sorted.includes(n))
        .join(', ');
      throw new MigrationChainError(
        `迁移链不连续：期望 1..${sorted.length}，实际 [${sorted.join(', ')}]` +
          (missing ? `（缺失: ${missing}）` : ''),
      );
    }
  });
}

/** 迁移链支持的最高版本（空链即 BASE_VERSION）。 */
export function latestVersion(migrations: readonly SchemaMigration[]): number {
  return migrations.length === 0 ? BASE_VERSION : Math.max(...migrations.map((m) => m.version));
}

/**
 * 从原始数据里读出 schema 版本。
 *
 * 三种情形：
 *  1. `schemaVersion.version` 是正整数 → 该值
 *  2. 完全没有 `schemaVersion` 字段（老文件）→ `BASE_VERSION`（0）
 *  3. 有 `schemaVersion` 但结构不合法（字符串 / 负数 / NaN）→ 抛错。
 *     这一类**不能**当 0 处理：当成 0 会让一条已损坏的信封触发全量迁移，
 *     把「数据可疑」掩盖成「数据很老」。
 */
export function readSchemaVersion(raw: unknown): number {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return BASE_VERSION;
  const stamp = (raw as Record<string, unknown>)['schemaVersion'];
  if (stamp === undefined) return BASE_VERSION;
  if (stamp === null || typeof stamp !== 'object' || Array.isArray(stamp)) {
    throw new MigrationChainError(
      `schemaVersion 字段结构非法（应为 { version, appliedAt, checksum } 对象）: ${JSON.stringify(stamp)}`,
    );
  }
  const version = (stamp as Record<string, unknown>)['version'];
  if (typeof version !== 'number' || !Number.isInteger(version) || version < BASE_VERSION) {
    throw new MigrationChainError(
      `schemaVersion.version 非法（应为 >= 0 的整数）: ${JSON.stringify(version)}`,
    );
  }
  return version;
}

export interface MigrationResult<T> {
  /** 迁移后的数据（若无需迁移则为原对象引用，未做任何拷贝）。 */
  data: T;
  /** 数据原本的版本。 */
  from: number;
  /** 迁移链支持的目标版本。 */
  to: number;
  /** 实际执行过的迁移版本号，升序；无需迁移时为空数组（§12 幂等判断）。 */
  applied: number[];
}

/**
 * 按版本号升序执行迁移链。
 *
 * 幂等语义（§12「迁移幂等判断」）：
 *  - `from === to` → 原样返回，`applied` 为空，**不重跑任何一步**。
 *    这条很重要：迁移可能不是纯函数（会填 `appliedAt` 时间戳），重跑会
 *    污染数据并让「上次迁移时间」失去意义。
 *  - `from < to`  → 只跑 `version > from` 的步骤。
 *  - `from > to`  → 抛 `SchemaVersionTooNewError`（拒绝降级，见文件头）。
 */
export function migrate<T>(
  raw: unknown,
  migrations: readonly SchemaMigration[],
): MigrationResult<T> {
  assertChainIsSane(migrations);
  const from = readSchemaVersion(raw);
  const to = latestVersion(migrations);

  if (from > to) {
    throw new SchemaVersionTooNewError(from, to);
  }
  // 幂等短路：已是目标版本，一个字节都不动。
  if (from === to) {
    return { data: raw as T, from, to, applied: [] };
  }

  const pending = migrations.filter((m) => m.version > from).sort((a, b) => a.version - b.version);
  const applied: number[] = [];
  let data: unknown = raw;
  for (const step of pending) {
    // 每步给独立深拷贝：实现里就地改写也不会污染调用方的原始对象
    // （读路径上原始对象来自 JSON.parse，调用方可能拿去做别的判断）。
    data = step.up(structuredClone(data));
    applied.push(step.version);
  }
  return { data: data as T, from, to, applied };
}
