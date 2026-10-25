/**
 * 「启动器下过什么」—— 每个实例一份小账本，用来做**同项目旧文件替换**。
 *
 * ## 为什么需要它（实测，2026-10-18）
 *
 * 从搜索页把 JEI 下进 `cf-263-neoforge` 两次（第二次源站已经发了更新的构建，
 * 文件名从 `…31.15.0.79.jar` 变成 `…31.15.0.81.jar`），`mods/` 里就并排躺着
 * 两个 jar。它们**mod id 相同** ⇒ NeoForge 启动时直接
 * `Duplicate mod` 拒绝启动。用户的症状是「装了个 mod 之后就再也打不开游戏了」，
 * 而界面当时说的是「下载成功」。
 *
 * 同样的坑在「从详情页版本列表挑另一个版本」时也会踩到：新 jar 落盘，旧 jar
 * 还在。
 *
 * ## 边界：只动**自己下过**的文件
 *
 * 用户手动丢进 `mods/` 的 jar 一概不碰（可能是他自己编译的、或改过配置的）。
 * 所以靠的是账本 —— 只有启动器写下去的文件才会入账，也只有入账的文件会被
 * 替换时删掉。账本里指向的文件如果已经不在了（用户手删、或被他移走），条目
 * 会在下次读取时顺手清掉，不会越攒越脏。
 *
 * 账本落在 `<实例目录>/.mc-launcher-downloads.json`（**不放进 `mods/`**：
 * 加载器会扫那个目录，没必要让它看见我们的账本）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve, sep } from 'node:path';

/** 一笔下载记录。 */
export interface DownloadRecord {
  /** 相对**实例目录**的落盘目录（`mods` / `resourcepacks` / `saves/<世界>/datapacks`）。 */
  dir: string;
  /** 文件名。 */
  name: string;
  /** 项目 id（`mr_xxx` / `cf_123`）—— 换版本时靠它认亲。 */
  projectId: string;
  /**
   * 这份文件是哪个整合包装进来的（`mr_xxx` / `cf_123`）。
   *
   * 只用于「换整合包版本时清掉新版已移除的项目」：手动下载、用户自己丢进
   * `mods/` 的文件都没有这个字段，永远不会被批量清理碰到。
   */
  packId?: string;
  /** 下载地址（排查用；可选）。 */
  url?: string;
  /** 记下来的时间（毫秒）。 */
  at: number;
}

const INDEX_FILE = '.mc-launcher-downloads.json';

export function downloadIndexPath(instanceDir: string): string {
  return join(instanceDir, INDEX_FILE);
}

/**
 * 落盘目录统一写成 `/` 分隔的相对路径。
 *
 * 两个写入方给的形状不一样：mod 下载走 `path.relative()`（Windows 上是
 * `saves\world\datapacks`），整合包清单里则是 `saves/world/datapacks`。
 * 不归一化的话「同一个目录」会变成两个字符串，替换就永远不命中 ——
 * 而且**只在嵌套目录上出错**（`mods` 两种写法一样），最难发现的那种。
 */
function normalizeDir(dir: string): string {
  return dir
    .split(/[\\/]+/)
    .filter((s) => s !== '.')
    .join('/');
}

/**
 * `dir` + `name` 是否**确实落在实例目录内**。
 *
 * 账本是我们自己写的，但它终究是个磁盘上的 JSON —— 被人改一手（或者路径里混进
 * `..`）就能让「替换旧文件」删到实例之外。删除动作必须先过这道闸。
 */
function insideInstance(instanceDir: string, dir: string, name: string): boolean {
  if (name === '' || name === '.' || name === '..') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  const base = resolve(instanceDir);
  return resolve(base, normalizeDir(dir), name).startsWith(base + sep);
}

/** 把一条形状不对劲的 JSON 记录过滤掉（宁可不认，也不猜）。 */
function asRecord(value: unknown): DownloadRecord | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Record<string, unknown>;
  if (typeof o.dir !== 'string' || typeof o.name !== 'string') return null;
  if (typeof o.projectId !== 'string') return null;
  return {
    dir: normalizeDir(o.dir),
    name: o.name,
    projectId: o.projectId,
    ...(typeof o.packId === 'string' ? { packId: o.packId } : {}),
    ...(typeof o.url === 'string' ? { url: o.url } : {}),
    at: typeof o.at === 'number' ? o.at : 0,
  };
}

/**
 * 读账本。**文件缺失 / 损坏 / 条目形状不对一律当空账本** —— 账本出问题不该让
 * 下载失败。返回的条目都已确认过：路径在实例内，且文件**现在还在**。
 */
export function readDownloadIndex(instanceDir: string): DownloadRecord[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(downloadIndexPath(instanceDir), 'utf8'));
  } catch {
    return [];
  }
  const files = (raw as { files?: unknown } | null)?.files;
  if (!Array.isArray(files)) return [];

  const out: DownloadRecord[] = [];
  for (const item of files) {
    const rec = asRecord(item);
    if (rec === null) continue;
    if (!insideInstance(instanceDir, rec.dir, rec.name)) continue;
    if (!existsSync(join(instanceDir, rec.dir, rec.name))) continue;
    out.push(rec);
  }
  return out;
}

/**
 * 同项目、同目录、**不是这一份**的旧文件（纯函数）。
 *
 * 只在同一个 `dir` 里替换：同一个项目可能同时以 mod 与资源包两种形态存在
 * （有的项目两种构建都发），把 `mods/` 里那份删掉去装 `resourcepacks/` 是错的。
 */
export function replacementTargets(
  records: readonly DownloadRecord[],
  next: { projectId: string; dir: string; name: string },
): string[] {
  const dir = normalizeDir(next.dir);
  const victims = new Set<string>();
  for (const rec of records) {
    if (rec.projectId !== next.projectId) continue;
    if (rec.dir !== dir) continue;
    if (rec.name === next.name) continue;
    victims.add(rec.name);
  }
  return [...victims];
}

/** 把（已经算好的）记录写回账本。写不进去只吞掉 —— 一次成功的下载不该因此变失败。 */
function persist(instanceDir: string, records: DownloadRecord[]): void {
  try {
    mkdirSync(dirname(downloadIndexPath(instanceDir)), { recursive: true });
    writeFileSync(
      downloadIndexPath(instanceDir),
      JSON.stringify({ version: 1, files: records }, null, 2),
      'utf8',
    );
  } catch {
    // 见上
  }
}

/** 账本里「同一个目录 + 同名」的旧条目（重新下载同一个文件时该被顶掉的那条）。 */
function withoutSameFile(
  records: readonly DownloadRecord[],
  dir: string,
  names: ReadonlySet<string>,
): DownloadRecord[] {
  return records.filter((r) => !(r.dir === dir && names.has(r.name)));
}

/**
 * 记一笔下载：先**删掉同项目的旧文件**（只删账本里记过的），再把新文件入账。
 *
 * 返回被删掉的文件名 —— 测试要断言、将来要提示也用得上。
 */
export function commitDownload(
  instanceDir: string,
  next: { projectId: string; dir: string; name: string; url?: string; packId?: string },
): string[] {
  const dir = normalizeDir(next.dir);
  // 记的前提是它真的落在实例里：落到别处的路径不进账本，免得将来"替换"时删错地方
  if (!insideInstance(instanceDir, dir, next.name)) return [];

  const records = readDownloadIndex(instanceDir);
  const victims = replacementTargets(records, { ...next, dir });

  for (const name of victims) {
    try {
      rmSync(join(instanceDir, dir, name), { force: true });
    } catch {
      // 删不掉（被占用等）不影响这次下载本身；下一次下载还会再试
    }
  }

  const kept = withoutSameFile(records, dir, new Set([next.name, ...victims]));
  kept.push({ ...next, dir, at: Date.now() });
  persist(instanceDir, kept);
  return victims;
}

/**
 * 只记一笔，**不删任何东西**。
 *
 * 给「一批文件一起铺下去」的场合用（整合包安装）—— 那批文件之间不该互相删。
 */
export function recordDownload(
  instanceDir: string,
  next: { projectId: string; dir: string; name: string; url?: string; packId?: string },
): void {
  const dir = normalizeDir(next.dir);
  if (!insideInstance(instanceDir, dir, next.name)) return;
  const kept = withoutSameFile(readDownloadIndex(instanceDir), dir, new Set([next.name]));
  kept.push({ ...next, dir, at: Date.now() });
  persist(instanceDir, kept);
}

/**
 * 整合包清单里的一个文件 → 账本要记的形状（认不出项目的条目返回 `null`）。
 *
 * 适配两个形状差异：清单里的 `targetPath` 是**相对 gameDir** 的 posix 路径
 * （`mods/xxx.jar`），账本要的是**相对实例目录**的目录名 + 文件名；而且清单可能
 * 缩在子目录里（`saves/<世界>/datapacks/x.zip`）。宁可不记，也不猜一个项目 id ——
 * 记错的代价是把别的文件当「同项目旧文件」删掉。
 */
export function batchEntry(
  file: { projectId?: string | undefined; targetPath: string },
  url: string,
  packId?: string,
): { projectId: string; dir: string; name: string; url: string; packId?: string } | null {
  if (file.projectId === undefined) return null;
  const dir = posix.dirname(file.targetPath);
  return {
    projectId: file.projectId,
    dir: dir === '.' ? '' : dir,
    name: posix.basename(file.targetPath),
    url,
    ...(packId === undefined ? {} : { packId }),
  };
}

/**
 * 一批安装（整合包：一次几十上百个文件）的记账器。
 *
 * 语义刻意分两次：
 * - 同一个「项目 + 目录」在本批里**第一次**出现 → 用替换语义
 *   （删掉上一次装这个包留下的旧版本文件；重装/更新整合包靠它，不然旧 jar
 *   会和新 jar 并排躺着 → `Duplicate mod` 拒启动）
 * - 同批里**后续**同项目同目录的文件 → 只记录，不删
 *   （一个项目在同一目录下发两个文件很少见，但不是没有；让它们互相删是错的）
 */
export function batchRecorder(
  instanceDir: string,
): (next: {
  projectId: string;
  dir: string;
  name: string;
  url?: string;
  packId?: string;
}) => string[] {
  const handled = new Set<string>();
  return (next) => {
    const key = `${next.projectId}|${normalizeDir(next.dir)}`;
    if (handled.has(key)) {
      recordDownload(instanceDir, next);
      return [];
    }
    handled.add(key);
    return commitDownload(instanceDir, next);
  };
}

/**
 * 整合包安装专用：直接把它当 `installModpackFiles` 的 `onFileInstalled` 交出去。
 *
 * `onFileInstalled: modpackLedgerRecorder(gameDir)` —— 线上和测试用的是同一个
 * 适配器。测试里再抄一份「清单文件 → 账本条目」的转换，抄件绿了说明不了线上那份。
 */
export function modpackLedgerRecorder(
  instanceDir: string,
  packId?: string,
): (file: { projectId?: string | undefined; targetPath: string }, url: string) => void {
  const record = batchRecorder(instanceDir);
  return (file, url) => {
    // 认不出项目的条目（清单没给归属）不记账：宁可不记，也不猜一个
    const entry = batchEntry(file, url, packId);
    if (entry !== null) record(entry);
  };
}

/**
 * 换整合包版本后，清掉「这个包上一版装过、新版清单里已经没有了」的文件。
 *
 * 只在**新版清单铺完之后**调用。`keepPaths` 是新版清单里的 `targetPath`
 * （相对 gameDir 的 posix 路径）；不在其中的、且 `packId` 对得上的条目才会被删。
 *
 * 为什么必须按 `packId` 认领：账本里还有用户从搜索页下的 mod、以及手动放进
 * `mods/` 的文件。只看「不在新清单里」会把它们一起删掉 —— 那是在删用户数据。
 *
 * 删除失败（文件被占用等）时保留账本条目，下次换版本还会再试。
 */
export function prunePackFiles(
  instanceDir: string,
  packId: string,
  keepPaths: Iterable<string>,
): string[] {
  const keep = new Set<string>();
  for (const p of keepPaths) keep.add(normalizeDir(p));

  const records = readDownloadIndex(instanceDir);
  const kept: DownloadRecord[] = [];
  const removed: string[] = [];
  let changed = false;

  for (const rec of records) {
    const key = normalizeDir(`${rec.dir}/${rec.name}`);
    if (rec.packId !== packId || keep.has(key)) {
      kept.push(rec);
      continue;
    }
    changed = true;
    try {
      rmSync(join(instanceDir, rec.dir, rec.name), { force: true });
    } catch {
      // 下一个版本安装时再试
    }
    // 删不掉就继续记账 —— 不能假装已经清掉了
    if (existsSync(join(instanceDir, rec.dir, rec.name))) {
      kept.push(rec);
    } else {
      removed.push(key);
    }
  }

  if (changed) persist(instanceDir, kept);
  return removed;
}
