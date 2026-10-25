import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { checkInstanceName } from '../shared/instance-name.js';

/**
 * 实例注册表 —— 把「每个实例一个游戏目录」这个既有的**物理事实**提升为一等抽象。
 *
 * ## 目录布局
 *
 * ```
 * userData/mc-launcher/
 * ├── versions/1.21.1/1.21.1.jar      ← 按 **MC 版本**：客户端 / 库 / 资源
 * │   1.21.1-0.19.5.json               ←   加载器档案（多个实例共用，不复制）
 * ├── assets/  libraries/             ← 全局共享
 * └── game/<实例名>/                   ← 按 **实例**：mods / config / saves / 日志
 *     ├── mods/  resourcepacks/  shaderpacks/
 *     └── saves/<世界>/datapacks/
 * ```
 *
 * **两层是分开的，这是多实例能成立的关键**：
 *
 * | 层 | 键 | 为什么这样 |
 * |---|---|---|
 * | 版本产物 `versions/` | MC 版本号 | 26 MB 的 client.jar + 几百 MB 的库，**每个实例复制一份是纯浪费** |
 * | 游戏数据 `game/` | 实例名 | mods / 配置 / 存档**必须**隔离，否则两个整合包的 90 个 mod 混在一起 |
 *
 * 以前 `id = versionId`（1:1），所以「两层分开」只是纸面上的 —— 装第二个
 * 1.21.1 的整合包会和第一个共用同一个 `game/1.21.1/`。现在 `id` 与 `versionId`
 * 解耦，同一个 MC 版本可以有多��实例。
 *
 * ## 为什么目录名 = 实例名
 *
 * 用户在界面上看到「我的空岛」，翻到磁盘上就是 `game/我的空岛/`。
 * 以后手动改配置、找存档时不会迷路。代价是实例名必须是合法目录名 ——
 * 见 `shared/instance-name.ts`，那里的策略是**当场拒绝非法输入**而不是
 * 悄悄替换字符（替换会让磁盘与界面不一致，正是这里要避免的）。
 *
 * ## 迁移策略
 *
 * 首次访问时若 `instances.json` 不存在，则扫描 `versions/*`：
 * 凡 `<versionId>/<versionId>.jar` 存在的，自动生成一条记录
 * （`name = versionId`，其余用默认值）。用户无感知，不需要手动操作。
 *
 * **迁移是幂等的**：已存在 `instances.json` 时不再扫描，
 * 否则用户改过的名字会被重新扫描覆盖。
 */

/** 实例的加载器类型。`vanilla` = 原版，未装任何加载器。 */
export type InstanceLoader = 'vanilla' | 'fabric' | 'neoforge';

/**
 * 实例来源。对应设计文档 §4.2.4 的三条启动路径。
 *
 * 有了这个字段，「这个实例是哪来的」才是数据而不是推测 ——
 * 三条路径的下载/启动前置条件完全不同。
 */
export type InstanceSource = 'downloaded' | 'imported' | 'offline-dir' | 'project-jar';

export interface InstanceRecord {
  /**
   * 主键 = **实例名** = 游戏目录名。
   *
   * ⚠️ 2026-10-13 起不再等于 `versionId`。以前 1:1，所以装第二个同版本的
   * 整合包会和第一个共用同一个 `game/<versionId>/`，90 个 mod 直接混在一起。
   * 现在 `versionId` 降级成「这个实例用哪个 MC 版本」这一属性，
   * 同一个版本可以有多个实例。
   *
   * 同时是 `game/<id>/` 的目录名 —— 所以它必须是合法目录名，
   * 见 `shared/instance-name.ts`（策略是**拒绝非法名**而不是替换字符）。
   */
  id: string;
  /** 显示名。**等于 `id`**（目录名 = 显示名，用户不会在磁盘上迷路）。 */
  name: string;
  /** MC 版本号，如 `1.21.11`。**版本产物（jar / 库 / 资源）按它共享**，不按实例复制。 */
  versionId: string;
  /** 已安装的加载器。同一个 `versionId` 的不同实例**可以有不同加载器**。 */
  loader: InstanceLoader;
  /** 来源。见 `InstanceSource`。 */
  source: InstanceSource;
  /** 来源的细分版本（如整合包版本 `26.2-1.2.1`）。仅 `source` 非 `downloaded` 时有意义。 */
  sourceVersion?: string;
  /**
   * 游戏目录。默认 `join(baseDir, 'game', id)`。
   *
   * 允许覆盖（用户指定别的盘），但**必须落在 baseDir 内**（由
   * `resolveGameDir` 强制）—— 否则存档、配置会写到应用管不到的地方。
   */
  gameDir?: string;
  /** 分配的内存，如 `2G` / `4G`。实例级配置，优先于全局。 */
  memory?: string;
  /** Java 可执行文件路径。实例级，缺省用全局 `JAVA_HOME`。 */
  javaPath?: string;
  /** 图标键（对应 assets/mc-ui 里的图标名）。 */
  iconKey?: string;
  /** 分组名，用于「自定义组」筛选。 */
  group?: string;
  /** 玩家用户名，缺省 Steve */
  username?: string;
  /** 创建时间（epoch ms）。 */
  createdAt: number;
  /** 最近一次启动时间（epoch ms）。**缺省即 UI 上的「从未玩过」。** */
  lastLaunchedAt?: number;
}

/** 列表接口的对外形状：在记录之外附带派生的就绪状态。 */
export interface InstanceSummary extends InstanceRecord {
  /**
   * 客户端是否就绪（jar 存在）。
   *
   * 由主进程一次算好返回，**渲染层不逐个探盘** ——
   * 否则实例多了会 N 次 IPC 往返。
   */
  clientReady: boolean;
}

const REGISTRY_FILE = 'instances.json';
/** 注册表结构版本。字段增删时 +1，便于将来写 migrate。 */
const REGISTRY_VERSION = 1;

interface RegistryFile {
  version: number;
  instances: InstanceRecord[];
}

export class InstanceRegistry {
  constructor(private readonly baseDir: string) {}

  private get file(): string {
    return join(this.baseDir, REGISTRY_FILE);
  }

  /**
   * 读注册表；不存在时先做一次迁移扫描。
   *
   * 幂等：`instances.json` 一旦存在就只读它，不再扫描 ——
   * 否则用户改过的实例名会被扫描结果覆盖。
   */
  private read(): RegistryFile {
    if (existsSync(this.file)) {
      try {
        const parsed = JSON.parse(readFileSync(this.file, 'utf-8')) as RegistryFile;
        if (Array.isArray(parsed.instances)) return parsed;
        // 文件存在但结构不对（手改坏 / 旧格式）：当空表处理，不抛 —— 主进程不该因
        // 一个损坏的 JSON 起不来，丢掉注册表比启动失败代价小（目录里的文件还在）
        return { version: REGISTRY_VERSION, instances: [] };
      } catch {
        return { version: REGISTRY_VERSION, instances: [] };
      }
    }
    const migrated = this.migrateFromDisk();
    this.write(migrated);
    return migrated;
  }

  private write(data: RegistryFile): void {
    mkdirSync(this.baseDir, { recursive: true });
    writeFileSync(this.file, JSON.stringify(data, null, 2), 'utf-8');
  }

  /**
   * 扫描 `versions/*`，为每个已下载客户端的版本生成一条实例记录。
   *
   * 只认**原版**目录。加载器档案不是独立游戏目录 —— 它是一份
   * `inheritsFrom: "<mc>"` 的版本 JSON + 打好的加载器 jar，挂在原版实例上。
   *
   * ⚠️ 判据是**档案内容**（有没有 `inheritsFrom`），不是目录名前缀。
   * 原来用 `startsWith('fabric-loader-') / startsWith('neoforge-')`，
   * 而官方 installer 在 `-noprofile` 下的产物目录名是 **`<mc>-<loaderVer>`**
   * （`versions/1.21.1-0.19.5/`）—— 前缀永远不匹配，于是加载器目录会被
   * 当成一个「原版实例」写进注册表（它的 `<id>.jar` 确实存在，是加载器 jar）。
   * 结果是游戏列表里冒出一个加载器卡片，点进去启动不了。
   */
  private migrateFromDisk(): RegistryFile {
    const versionsDir = join(this.baseDir, 'versions');
    const instances: InstanceRecord[] = [];

    let entries: string[] = [];
    try {
      entries = readdirSync(versionsDir);
    } catch {
      return { version: REGISTRY_VERSION, instances };
    }

    const now = Date.now();
    for (const versionId of entries) {
      // 加载器档案跳过：它是往原版实例上挂的，不对应独立 game/ 目录
      if (this.isLoaderProfileDir(versionsDir, versionId)) continue;
      const jar = join(versionsDir, versionId, `${versionId}.jar`);
      if (!existsSync(jar)) continue;

      instances.push({
        // 迁移出的实例沿用「id = versionId」。此时 `game/<versionId>/`
        // 可能已经存在（老布局），所以 gameDir 也指回那里 —— 不能凭
        // 布局改名去动用户目录。
        //
        // 只有一个实例时「id = 版本号」不构成问题；用户要第二个同版本实例
        // 时，会带上自己的名字建，那时才是 `game/<名字>/`。
        id: versionId,
        name: versionId,
        versionId,
        gameDir: join(this.baseDir, 'game', versionId),
        loader: 'vanilla',
        source: 'downloaded',
        createdAt: now,
        username: 'Steve',
      });
    }

    return { version: REGISTRY_VERSION, instances };
  }

  /**
   * 这个 `versions/<id>/` 目录是不是一份**加载器档案**（而不是原版客户端）。
   *
   * 判据：同名 `<id>.json` 存在且带 `inheritsFrom`。原版客户端目录里没有
   * 这份 JSON（Mojang 的版本 JSON 是网络上的，本地不落盘），所以这个判据
   * 不会误伤任何原版版本。
   *
   * 读失败一律按「不是加载器」处理：迁移扫描时抛错不该让整个注册表读不出来。
   */
  private isLoaderProfileDir(versionsDir: string, versionId: string): boolean {
    try {
      const raw = readFileSync(join(versionsDir, versionId, `${versionId}.json`), 'utf-8');
      const json = JSON.parse(raw) as { inheritsFrom?: unknown };
      return typeof json.inheritsFrom === 'string' && json.inheritsFrom.length > 0;
    } catch {
      return false;
    }
  }

  /** 列出全部实例，附带 `clientReady` 派生状态。 */
  list(): InstanceSummary[] {
    const { instances } = this.read();
    return instances.map((inst) => ({
      ...inst,
      // 客户端 jar 是**版本级**的：多个实例共享 `versions/<versionId>/`。
      // 所以判定要用 versionId 而不是实例 id —— 后者会让「同版本的第二个
      // 实例」永远显示成未下载，尽管 jar 就在那儿。
      clientReady: existsSync(
        join(this.baseDir, 'versions', inst.versionId, `${inst.versionId}.jar`),
      ),
    }));
  }

  /** 按 id 取一条；不存在返回 null。 */
  get(id: string): InstanceRecord | null {
    return this.read().instances.find((i) => i.id === id) ?? null;
  }

  /**
   * 新建实例。同 id 视为更新（幂等），避免重复创建。
   *
   * ## `id` 从哪来
   *
   * 传了 `id` → 用它；没传 → 用 `name`；再没有 → 用 `versionId`。
   *
   * 无论哪条路都先跑 `checkInstanceName`：实例 id **直接当目录名用**
   * （`game/<id>/`），放过 `CON`、`a/b` 这类名字会在建目录或读文件时炸出
   * 一个和「实例名」毫无关系的 IO 错误 —— 那种错最难查。
   *
   * 字段缺省用默认值补齐 —— 注册表是数据文件，不信任调用方的完整性。
   */
  create(input: Partial<InstanceRecord> & { versionId: string }): InstanceRecord {
    const { instances } = this.read();
    const now = Date.now();

    const desiredId = input.id ?? input.name ?? input.versionId;
    const nameCheck = checkInstanceName(desiredId);
    if (!nameCheck.ok) throw new Error(`实例名不合法：${nameCheck.reason}`);

    const existing = instances.find((i) => i.id === desiredId);

    // 可选字段一律**条件展开**而非写 `undefined`。
    // 本项目开了 `exactOptionalPropertyTypes`，`{ a: undefined }` 不等价于「无 a」——
    // 前者会让 JSON 里多出 `"a": null` 之类的噪音，且与 zod 的 optional 语义打架。
    const optional: Partial<InstanceRecord> = {};
    const setIf = <K extends keyof InstanceRecord>(
      key: K,
      value: InstanceRecord[K] | undefined,
    ) => {
      if (value !== undefined) optional[key] = value;
    };
    setIf('sourceVersion', input.sourceVersion ?? existing?.sourceVersion);
    setIf('memory', input.memory ?? existing?.memory);
    setIf('javaPath', input.javaPath ?? existing?.javaPath);
    setIf('iconKey', input.iconKey ?? existing?.iconKey);
    setIf('group', input.group ?? existing?.group);
    setIf('username', input.username ?? existing?.username);
    setIf('lastLaunchedAt', input.lastLaunchedAt ?? existing?.lastLaunchedAt);

    const record: InstanceRecord = {
      id: desiredId,
      // 显示名 = 目录名，**刻意的**：界面上看到的名字应该就是磁盘上那个目录，
      // 否则以后手动改配置、找存档时要多查一层对不上号。
      name: desiredId,
      versionId: input.versionId,
      loader: input.loader ?? existing?.loader ?? 'vanilla',
      source: input.source ?? existing?.source ?? 'downloaded',
      createdAt: existing?.createdAt ?? now,
      // 缺省按**实例 id**（不是 versionId —— 这是多实例的关键改动）。
      // 显式写进记录而不是留空靠推导：「两个实例不串」这件事在数据文件里
      // 一目了然，也让 `gameDirOf()` 无条件可用、不会漏推导。
      gameDir: input.gameDir ?? existing?.gameDir ?? join(this.baseDir, 'game', desiredId),
      ...optional,
    };

    const idx = instances.findIndex((i) => i.id === record.id);
    if (idx === -1) instances.push(record);
    else instances[idx] = record;

    this.write({ version: REGISTRY_VERSION, instances });
    return record;
  }

  /**
   * 局部更新。仅覆盖传入的字段（`undefined` 不参与覆盖）。
   *
   * **`id` / `name` / `versionId` 都不允许改**：
   *
   * - `id` 是主键，也是 `game/<id>/` 的目录名
   * - `name` 必须与 `id` 相等（目录名 = 显示名），所以改它等于改目录名
   * - `versionId` 是版本作用域的键，改它会让「产物在哪」与「数据在哪」脱节
   *
   * 改名的正确做法是「新建一个实例 + 复制文件」，那是个独立功能，现在不做 ——
   * 与其留一个改了名字但目录没动、用户以后找不到存档的坑，不如直接锁死。
   */
  update(id: string, patch: Partial<InstanceRecord>): InstanceRecord | null {
    const { instances } = this.read();
    const idx = instances.findIndex((i) => i.id === id);
    if (idx === -1) return null;

    // 同样按 `exactOptionalPropertyTypes` 的规矩：只展开 patch 里**真的有值**的键。
    // 直接 `{...old, ...patch}` 会把 `undefined` 写进实例，序列化后变成 `"memory": undefined`，
    // 在 zod 的 optional 语义下是纯噪音。
    const defined: Partial<InstanceRecord> = {};
    for (const [k, v] of Object.entries(patch)) {
      if (v !== undefined) defined[k as keyof InstanceRecord] = v as never;
    }

    // 锁定字段在合并的**尾部**无条件取原值，patch 里带什么都没用。
    // 刻意不写成 `{...old, ...patch, id, versionId}` —— 那样意图不够显眼，
    // 而且容易在以后加字段时漏掉某一个。
    const merged = {
      ...instances[idx],
      ...defined,
      id,
      name: id,
      versionId: instances[idx].versionId,
    };
    instances[idx] = merged;
    this.write({ version: REGISTRY_VERSION, instances });
    return merged;
  }

  /**
   * 只删记录，**不动磁盘文件**。
   *
   * 破坏性删除（连带 `game/<v>/` 里的存档）由调用方显式做二次确认，
   * 注册表本身不提供 —— 存档是用户数据，误删代价太高。
   */
  remove(id: string): boolean {
    const { instances } = this.read();
    const next = instances.filter((i) => i.id !== id);
    if (next.length === instances.length) return false;
    this.write({ version: REGISTRY_VERSION, instances: next });
    return true;
  }

  /** 记录一次启动。`lastLaunchedAt` 缺省即 UI 上的「从未玩过」。 */
  markLaunched(id: string): void {
    this.update(id, { lastLaunchedAt: Date.now() });
  }
}
