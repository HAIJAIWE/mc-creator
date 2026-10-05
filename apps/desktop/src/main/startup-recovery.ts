/**
 * §14 可靠性 · 半成品检测：启动时扫描并清理未完成实例 + 残留中间文件。
 *
 * ## 先说结论：原子写解决了什么、没解决什么
 *
 * §14 第一条「原子性：下载 → 临时目录 → 校验 → 原子重命名」在本仓已经落实：
 *  - `packages/shell/src/atomic-write.ts` 的 `writeFileAtomic`（tmp + fsync + rename，
 *    失败清理 tmp）
 *  - `apps/desktop/src/main/project-store.ts` 的 `writeProjectFile`（tmp + rename）
 *
 * 所以「单个文件写了一半」这种半成品**已经不存在**：读者要么看到完整的旧内容，
 * 要么看到完整的新内容。
 *
 * 但原子性是**逐文件**的，它管不到**跨文件的一致性**。而 `create_instance`
 * 恰好是跨文件的（`packages/kernel-java/src/kernel.ts` createInstance）：
 * ```
 * 1. existsSync(instances/<name>) → 已存在则 INSTANCE_EXISTS 报错
 * 2. 逐个 writeFileAtomic(instances/<name>/<sub>/.gitkeep)   ← 这里创建了目录
 * 3. writeFileAtomic(instances/<name>/instance.json)          ← manifest 最后写
 * ```
 * 进程在第 2 步之后、第 3 步之前被杀掉（崩溃 / 断电 / 任务管理器结束进程），
 * 就会留下一个**有目录、没有 instance.json** 的实例。从代码事实推导其后果：
 *
 *  - `list_instances`（kernel.ts 的 list_instances 分支）**只枚举子目录名**，
 *    完全不检查 instance.json → 半成品会**被当成正常实例列出来**。
 *  - `launch_instance` 读到 `existsSync(instance.json)` 为 false →
 *    `INSTANCE_META_MISSING` 报错 → **启动不了**。
 *  - 用户重试 `create_instance` → 第 1 步 `existsSync` 为 true →
 *    `INSTANCE_EXISTS` 报错 → **连重建都做不到**。
 *
 * 也就是说：一个进程崩溃留下的半成品，会把该实例名**永久卡死**，且它在 UI 上
 * 看起来完全正常。这是 §14「半成品检测」要解决的真问题，也是原子写**覆盖不到**的
 * 那部分 —— 所以本模块不去造实例状态机（没有 journal 就没有真相来源，造出来的
 * 状态机和磁盘事实会各说各话），只做最小可用的一件事：**扫出「有目录无 manifest」
 * 的实例，把它移出 instances/ 让它不再污染列表**。
 *
 * ## 为什么是「隔离」而不是「删除」
 *
 * 半成品目录理论上只有空的 `.gitkeep` 占位（create_instance 崩在写 manifest 之前，
 * 用户还没机会往里装模组），删除是安全的。但这份代码无法区分「崩在 manifest 之前」
 * 和「用户手工删了 manifest」，后者里可能有用户自己放的模组。
 * 所以默认**改名隔离**到 userData 下：既让 `list_instances` 不再看到它、
 * 用户能立刻用同名重建，又保留了现场供 bug 反馈，且完全可逆。
 *
 * ## 关于 tmp 残留
 *
 * `writeFileAtomic` 只在**抛错**时清 tmp。进程被硬杀（SIGKILL / 断电）时
 * 清理代码不会执行，`*.tmp` 与 `*.tmp-<pid>-<uuid8>` 会永久留在磁盘上。
 * 它们不会被误读（project-store 只认 `*.json`），但会一直占空间、且在
 * `projects/` 里堆积后干扰人工排查。本模块一并扫掉。
 *
 * 与 build-cache-store.ts 同一约定：**刻意不 import electron**，根目录由调用方
 * 传入，模块本身可脱离 Electron 单元测试。
 */

import { readdirSync, renameSync, statSync, existsSync, readFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';

/** 隔离目录名后缀（便于人工辨认 + 后续手动清理）。 */
const QUARANTINE_MARK = '.incomplete-';

/**
 * 判定一个文件名是不是原子写留下的中间文件。
 *
 * 两种形态（必须都覆盖，否则清理不彻底）：
 *  - project-store 的 `xxx.json.tmp`（固定后缀）
 *  - shell 的 writeFileAtomic 的 `xxx.json.tmp-<pid>-<8位hex>`
 *
 * 用 `indexOf('.tmp')` 而非 `endsWith`：中间文件是 `<目标名>.tmp[-...]`，
 * 目标名本身可能含 `.tmp`（如 `a.tmp.json.tmp`），只要存在「最后一段是 tmp」的
 * 结构就该清。`slice(pos+4)` 之后必须为空或以 `-` 开头，避免误删
 * `report.tmpl.json` 这类正常文件。
 */
export function isStaleTempFile(name: string): boolean {
  const pos = name.lastIndexOf('.tmp');
  if (pos <= 0) return false;
  const rest = name.slice(pos + '.tmp'.length);
  return rest === '' || rest.startsWith('-');
}

/** 扫描结果里的一项：某个实例目录缺 manifest。 */
export interface IncompleteInstance {
  /** 实例名（instances/ 下的目录名）。 */
  name: string;
  /** 绝对路径。 */
  path: string;
  /** 实例目录里的条目数（用于日志判断「几乎必然是空壳」还是「有用户数据」）。 */
  entryCount: number;
}

/** 扫描结果里的一项：残留的原子写中间文件。 */
export interface StaleTempFile {
  /** 绝对路径。 */
  path: string;
  /** 文件所在目录的绝对路径。 */
  dir: string;
}

/** instance.json 存在但内容不是合法 JSON —— 数据损坏（非半成品）。 */
export interface CorruptInstanceMeta {
  name: string;
  path: string;
}

export interface ScanResult {
  /** 有目录、无 instance.json 的实例（真·半成品）。 */
  incompleteInstances: IncompleteInstance[];
  /** 有 instance.json 但解析失败的实例。只报告，不动。 */
  corruptInstances: CorruptInstanceMeta[];
  /** 残留的 *.tmp / *.tmp-* 中间文件。 */
  staleTempFiles: StaleTempFile[];
}

export interface RecoveryReport extends ScanResult {
  /** 被隔离（改名移出 instances/）的实例目录名。 */
  quarantined: string[];
  /** 被删除的残留中间文件路径。 */
  removedTempFiles: string[];
  /** 扫描 / 清理过程中的错误（不抛：启动期清理失败不该拦住应用启动）。 */
  errors: string[];
}

export interface StartupRecoveryOptions {
  /** 实例根目录，其下应有 `instances/`。不存在则跳过。 */
  kernelRoot?: string | undefined;
  /** 隔离目录的父目录（通常是 app.getPath('userData')）。 */
  userDataDir: string;
  /**
   * 是否真的执行清理（改名 / 删除）。默认 false —— 扫描是只读的，
   * 便于先看清「会动什么」再决定。
   */
  apply?: boolean;
}

/** 列出目录下的子目录名；目录不存在返回空数组。 */
function listDirs(dir: string): string[] {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 列出目录下的文件名；目录不存在返回空数组。 */
function listFiles(dir: string): string[] {
  try {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/** 数一个目录里有多少条目（含子目录）。读不到返回 0。 */
function countEntries(dir: string): number {
  try {
    return readdirSync(dir).length;
  } catch {
    return 0;
  }
}

/**
 * 扫描实例根目录，识别三类异常。
 *
 * 判定「半成品」的唯一依据是 **缺 `instance.json`**：这是 createInstance 里
 * 最后写的那个文件（也是 launchInstance 唯一强依赖的文件），
 * 所以「目录在、manifest 不在」等价于「创建过程没走完」。
 *
 * 刻意**不**检查子目录是否齐全（mods/config/...）：缺子目录不影响启动，
 * 属于可自愈的偏差，不该被判成半成品去动用户数据。
 */
export function scanInstanceRoot(kernelRoot: string): ScanResult {
  const instancesDir = join(kernelRoot, 'instances');
  const incompleteInstances: IncompleteInstance[] = [];
  const corruptInstances: CorruptInstanceMeta[] = [];

  for (const name of listDirs(instancesDir)) {
    const dir = join(instancesDir, name);
    const metaPath = join(dir, 'instance.json');
    if (!existsSync(metaPath)) {
      incompleteInstances.push({ name, path: dir, entryCount: countEntries(dir) });
      continue;
    }
    // manifest 在但内容坏了：这是数据损坏，不是半成品。
    // 只报告不处理 —— 自动「修」一个用户的实例元数据比留着报错更危险。
    try {
      const parsed: unknown = JSON.parse(readFileSync(metaPath, 'utf-8'));
      if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
        corruptInstances.push({ name, path: metaPath });
      }
    } catch {
      corruptInstances.push({ name, path: metaPath });
    }
  }

  return { incompleteInstances, corruptInstances, staleTempFiles: [] };
}

/** 扫描一个目录下的原子写残留（只看本层，不递归）。 */
export function scanStaleTempFiles(dir: string): StaleTempFile[] {
  return listFiles(dir)
    .filter(isStaleTempFile)
    .map((name) => ({ path: join(dir, name), dir }));
}

/**
 * 启动扫描 + 清理（§14 半成品检测）。
 *
 * 幂等且可重复调用：扫描无命中时不做任何写操作（不误删、不产生空目录）。
 * 任何一步失败都记进 `errors` 而不抛出 —— 清理是「尽力而为」的维护动作，
 * 拦住应用启动的代价远大于残留几个文件。
 */
export function runStartupRecovery(options: StartupRecoveryOptions): RecoveryReport {
  const { userDataDir, kernelRoot, apply = false } = options;
  const report: RecoveryReport = {
    incompleteInstances: [],
    corruptInstances: [],
    staleTempFiles: [],
    quarantined: [],
    removedTempFiles: [],
    errors: [],
  };

  // --- 1. 半成品实例 ---
  if (kernelRoot !== undefined && kernelRoot !== '') {
    try {
      const scanned = scanInstanceRoot(kernelRoot);
      report.incompleteInstances = scanned.incompleteInstances;
      report.corruptInstances = scanned.corruptInstances;
    } catch (e) {
      report.errors.push(`扫描实例目录失败 (${kernelRoot}): ${(e as Error).message}`);
    }
  }

  // --- 2. 残留中间文件 ---
  // 扫两处：内核实例根与其 instances/ 层。只扫顶层即可 ——
  // writeFileAtomic 的 tmp 与目标同目录，中间文件不会跨层堆积。
  const tmpScanDirs: string[] = [];
  if (kernelRoot !== undefined && kernelRoot !== '') {
    tmpScanDirs.push(kernelRoot, join(kernelRoot, 'instances'));
  }
  for (const dir of tmpScanDirs) {
    try {
      report.staleTempFiles.push(...scanStaleTempFiles(dir));
    } catch (e) {
      report.errors.push(`扫描残留文件失败 (${dir}): ${(e as Error).message}`);
    }
  }
  try {
    report.staleTempFiles.push(...scanStaleTempFiles(join(userDataDir, 'projects')));
  } catch (e) {
    report.errors.push(`扫描残留文件失败 (projects): ${(e as Error).message}`);
  }

  if (!apply) return report;

  // --- 3. 隔离半成品：改名移出 instances/ ---
  // 目标是 instances/ 的**同级**目录（而不是 instances/ 内部），
  // 否则 list_instances 仍会枚举到它，达不到「清理」的效果。
  for (const inst of report.incompleteInstances) {
    const target = join(kernelRoot as string, `${QUARANTINE_MARK}${Date.now()}-${inst.name}`);
    try {
      renameSync(inst.path, target);
      report.quarantined.push(inst.name);
      console.warn(
        `[§14 半成品检测] 隔离未完成实例 ${inst.name} → ${basename(target)}` +
          `（目录存在但缺 instance.json，create_instance 中途崩溃；隔离后可重新创建同名实例）`,
      );
    } catch (e) {
      report.errors.push(`隔离实例 ${inst.name} 失败: ${(e as Error).message}`);
    }
  }

  // --- 4. 删除残留中间文件 ---
  for (const tmp of report.staleTempFiles) {
    try {
      // existsSync 再确认一次：扫描与清理之间可能有别的进程已经 rename 掉了它。
      if (!existsSync(tmp.path)) continue;
      unlinkSync(tmp.path);
      report.removedTempFiles.push(tmp.path);
    } catch (e) {
      report.errors.push(`删除残留文件 ${tmp.path} 失败: ${(e as Error).message}`);
    }
  }

  return report;
}

/** 把报告压成一行日志（无命中时返回 null，便于调用方跳过打印）。 */
export function formatRecoveryReport(report: RecoveryReport): string | null {
  const bits: string[] = [];
  if (report.quarantined.length > 0) {
    bits.push(`隔离未完成实例 ${report.quarantined.length} 个 (${report.quarantined.join(', ')})`);
  }
  if (report.removedTempFiles.length > 0) {
    bits.push(`清理残留中间文件 ${report.removedTempFiles.length} 个`);
  }
  if (report.corruptInstances.length > 0) {
    bits.push(`instance.json 损坏需人工处理 ${report.corruptInstances.length} 个`);
  }
  if (report.errors.length > 0) {
    bits.push(`异常 ${report.errors.length} 条`);
  }
  if (bits.length === 0) return null;
  return `[§14 半成品检测] ${bits.join('；')}`;
}
