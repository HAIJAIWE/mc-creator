import { app } from 'electron';
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  readdirSync,
  unlinkSync,
  watch,
  FSWatcher,
} from 'fs';
import { join } from 'path';
import { ProjectSchema, type Project } from '../shared/ipc-channels.js';
import {
  assertChainIsSane,
  latestVersion,
  migrate,
  readSchemaVersion,
  SchemaVersionTooNewError,
  type SchemaMigration,
} from './schema-migrations.js';
import { assertValidProjectId, ID_RE } from './validation.js';

/**
 * 项目持久化（P3-3：分文件存储 + §12 版本化迁移）
 *
 * 每个项目独立存于 `userData/projects/<id>.json`，相比旧的单文件 `projects.json`：
 *  - saveProject 只写 1 个文件，不必重写全部
 *  - deleteProject 只删 1 个文件，不必重写全部
 *  - 单文件损坏不影响其他项目
 *  - 每文件原子写（tmp + rename）
 *
 * ## 落盘信封
 *
 * 每个项目文件写成 `{ schemaVersion, data }`：
 * ```
 * { "schemaVersion": { "version": 1, "appliedAt": "...", "checksum": "" },
 *   "data": { id, name, generatorType, ... } }
 * ```
 * `schemaVersion` 就是 §12 定义的 `SchemaVersion { version, appliedAt, checksum }`，
 * 是「迁移幂等判断」的唯一依据。
 *
 * ## 为什么 data 要套一层信封而不是把版本字段平铺进 Project
 *
 * 平铺（`{ id, ..., schemaVersion: {...} }`）有两个问题：
 *  1. `ProjectSchema` 是 zod object，**默认 strip 未知键**。平铺的话每次
 *     `ProjectSchema.parse` 都会把 `schemaVersion` 吃掉，读出来再写回去时
 *     版本号就丢了 —— 幂等判断随之失效，数据永远被当成 v0 反复迁移。
 *  2. 版本元数据和业务字段混在一个命名空间，未来 `Project` 加同名字段就撞车。
 * 套信封让 zod 只校验 `data`，版本号由框架单独负责。
 *
 * ## 迁移链
 *
 * 链的定义必须**连续无洞**（`assertChainIsSane` 在模块加载期执行，见下方
 * `assertChainIsSane(PROJECT_MIGRATIONS)`）。有洞意味着某版数据的转换被静默
 * 跳过，且线上无从察觉，所以这类开发期错误要在启动第一时间炸掉。
 *
 * ## checksum
 *
 * 当前恒写空串。信封字段保留是为了与 §12 形状一致；本地单用户 json 的唯一
 * 写入方是本应用自己，checksum 对「迁移幂等判断」没有增量（`version` 整数
 * 就是幂等键），对「检测外部手改」则会因为用户正常的手工编辑持续误报。
 * 详见 schema-migrations.ts 文件头。
 */

const PROJECTS_DIR = 'projects';
const LEGACY_FILE = 'projects.json';
const LEGACY_MIGRATED = 'projects.json.migrated';

/** 项目文件信封的 schema 版本（§12）。有且仅有一条 v1 迁移。 */
export const PROJECT_ENVELOPE_VERSION = 1;

/** 一次写盘的时间来源，单独抽出便于测试固定 appliedAt。 */
const nowIso = (): string => new Date().toISOString();

/** 盖一个符合 §12 形状的 SchemaVersion 信封。 */
function makeStamp(version: number): { version: number; appliedAt: string; checksum: string } {
  return { version, appliedAt: nowIso(), checksum: '' };
}

/** 读出信封里的 data（不做迁移）。信封外的数据没有 data 层，返回 null。 */
function peekData(raw: unknown): unknown | null {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = (raw as Record<string, unknown>)['data'];
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;
  return data;
}

/**
 * 项目迁移链。
 *
 * v1 是「引入信封」这一步：把裸 Project 对象包成 `{ schemaVersion, data }`。
 * 之所以把信封化本身算作一次迁移（而不是在读取处特判），是为了让**所有**
 * 归一化都走同一条版本化路径 —— §12 要求「所有写入走版本化迁移脚本」，
 * 特判会在下一次 schema 变更时变成第二套并行逻辑。
 *
 * v1 刻意**不改任何业务字段**：老文件的字段集合与当前 `ProjectSchema` 完全
 * 兼容（读路径上一直靠 zod 默认值之外的真实数据），所以这一步是纯粹的
 * 结构升级。这样将来新增字段时，只需在末尾追加一条 vN 迁移。
 */
export const PROJECT_MIGRATIONS: readonly SchemaMigration[] = [
  {
    version: 1,
    description: '裸 Project 对象 → { schemaVersion, data } 信封',
    up(data) {
      const rec = data as Record<string, unknown>;
      // 已经是信封（防御：重复跑同一步不应二次包裹）
      if (rec['schemaVersion'] !== undefined && rec['data'] !== undefined) return data;
      return { schemaVersion: makeStamp(1), data: rec };
    },
  },
];

// fail-fast：链有洞（1→3 缺 2）时在模块加载期就抛错，而不是等某个用户的
// 旧数据触发迁移时才发现。放在模块顶层是因为 store 被 import 即代表
// 应用启动路径已走到这里。
assertChainIsSane(PROJECT_MIGRATIONS);

function projectsDir(): string {
  return join(app.getPath('userData'), PROJECTS_DIR);
}

function projectFile(id: string): string {
  assertValidProjectId(id);
  return join(projectsDir(), `${id}.json`);
}

function legacyPath(): string {
  return join(app.getPath('userData'), LEGACY_FILE);
}

function legacyMigratedPath(): string {
  return join(app.getPath('userData'), LEGACY_MIGRATED);
}

/** 项目变更事件类型 */
export type ProjectChangeEvent = 'created' | 'updated' | 'deleted';

/**
 * 监听器签名。
 *
 * 不能写成 `(...args: unknown[]) => void`：strictFunctionTypes 下函数参数是逆变的，
 * 而唯一的调用方（ipc/project.ts）传的是 `(type: ProjectChangeEvent, projectId: string)`，
 * 这种**收窄**的回调无法赋给 `(...args: unknown[])`。这里直接把真实签名写出来，
 * on/off 的入参和 emit 的实参就都是强类型检查的。
 */
type ProjectEventListener = (type: ProjectChangeEvent, projectId: string) => void;

/** 简单的事件发射器 */
class ProjectEventEmitter {
  private listeners: Map<string, Set<ProjectEventListener>> = new Map();

  on(event: string, listener: ProjectEventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return () => this.off(event, listener);
  }

  off(event: string, listener: ProjectEventListener): void {
    this.listeners.get(event)?.delete(listener);
  }

  emit(event: string, ...args: Parameters<ProjectEventListener>): void {
    this.listeners.get(event)?.forEach((listener) => {
      try {
        listener(...args);
      } catch (e) {
        console.error(`[ProjectEventEmitter] Listener error for ${event}:`, e);
      }
    });
  }
}

/** 全局项目事件发射器 */
export const projectEvents = new ProjectEventEmitter();

/** 文件监视器实例 */
let projectWatcher: FSWatcher | null = null;

/** 启动项目目录监视 */
export function startProjectWatcher(): void {
  if (projectWatcher) return;

  const dir = projectsDir();
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  projectWatcher = watch(dir, { recursive: false }, (eventType, filename) => {
    if (!filename || !filename.endsWith('.json')) return;
    if (filename.endsWith('.tmp')) return;

    const id = filename.slice(0, -5);
    if (!ID_RE.test(id)) return;

    if (eventType === 'rename') {
      // rename 可能是创建或删除，需配合 exists 判断
      const filepath = join(projectsDir(), filename);
      if (existsSync(filepath)) {
        projectEvents.emit('changed', 'created', id);
      } else {
        projectEvents.emit('changed', 'deleted', id);
      }
    } else if (eventType === 'change') {
      projectEvents.emit('changed', 'updated', filename.slice(0, -5));
    }
  });

  projectWatcher.on('error', (err) => {
    console.error('[ProjectWatcher] Error:', err);
  });

  console.log('[ProjectWatcher] Started watching:', projectsDir());
}

/** 停止项目目录监视 */
export function stopProjectWatcher(): void {
  if (projectWatcher) {
    projectWatcher.close();
    projectWatcher = null;
  }
}

/**
 * 原子写单个项目文件（tmp + rename，复用既有写法，不另造）。
 *
 * 写入内容带 §12 的 `schemaVersion` 信封。注意：**先写 tmp 再 rename**，
 * 保证读者永远看到「旧版本完整数据」或「新版本完整数据」，不会看到
 * 迁移到一半的形态。这正是「迁移必须原子」的落点。
 */
function writeProjectFile(project: Project, version: number = PROJECT_ENVELOPE_VERSION): void {
  const path = projectFile(project.id);
  const tmpPath = path + '.tmp';
  const envelope = { schemaVersion: makeStamp(version), data: project };
  writeFileSync(tmpPath, JSON.stringify(envelope, null, 2), 'utf-8');
  renameSync(tmpPath, path);
  projectEvents.emit('changed', 'updated', project.id);
}

/**
 * 读取并迁移单个项目文件。
 *
 * 返回 null 表示「这个文件读不出来」，调用方按既有约定跳过该项
 * （不阻塞其他项目）。三类情况都归到这里：
 *  - JSON 语法错误 / 结构不符 ProjectSchema（沿用原有行为）
 *  - 数据版本高于当前代码（抛 SchemaVersionTooNewError → 拒绝降级）
 *  - 迁移链自身抛错（开发期 bug）
 *
 * `migrated` 标志告知调用方磁盘上的数据是否已升级，升级后需要原子回写。
 */
function readProjectFile(
  filePath: string,
  id: string,
): { project: Project; migrated: boolean } | null {
  try {
    const raw = readFileSync(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(raw);

    const result = migrate<unknown>(parsed, PROJECT_MIGRATIONS);
    const data = peekData(result.data);
    if (data === null) return null;

    return { project: ProjectSchema.parse(data), migrated: result.applied.length > 0 };
  } catch (e) {
    // 数据来自更高版本：明确记录原因。整目录里只有这类项目才会走到这，
    // 其余项目照常读取（单文件问题不扩散），但要让日志能指出「请升级应用」。
    if (e instanceof SchemaVersionTooNewError) {
      console.error(`[ProjectStore] 项目 ${id} 跳过：${e.message}`);
      return null;
    }
    if (e instanceof Error && /迁移链/.test(e.message)) {
      console.error(`[ProjectStore] 项目 ${id} 跳过：迁移链异常`, e);
      return null;
    }
    // 单个项目损坏跳过，不阻塞其他项目读取
    return null;
  }
}

/** 一次性从旧 projects.json 迁移到分文件存储 */
function migrateFromLegacy(): void {
  if (!existsSync(legacyPath())) return;
  // 已迁移过则跳过
  if (existsSync(legacyMigratedPath())) return;
  try {
    const raw = readFileSync(legacyPath(), 'utf-8');
    const arr = JSON.parse(raw) as unknown[];
    const projects = arr.map((item) => ProjectSchema.parse(item));
    if (!existsSync(projectsDir())) mkdirSync(projectsDir(), { recursive: true });
    for (const p of projects) {
      writeProjectFile(p);
    }
    // 标记迁移完成（保留原文件作为备份）
    renameSync(legacyPath(), legacyMigratedPath());
  } catch {
    // 迁移失败不阻塞读取，下次启动再试
  }
}

/** 读取所有项目（按文件枚举，跳过损坏项） */
export function loadProjects(): Project[] {
  migrateFromLegacy();
  const dir = projectsDir();
  if (!existsSync(dir)) return [];
  const out: Project[] = [];
  for (const name of readdirSync(dir)) {
    // 只处理 *.json，跳过 *.tmp 等中间文件
    if (!name.endsWith('.json')) continue;
    const id = name.slice(0, -5); // strip ".json"
    if (!ID_RE.test(id)) continue;
    const filePath = join(dir, name);
    const read = readProjectFile(filePath, id);
    if (read === null) continue;
    // 读到的是旧版本数据：立刻原子回写升级结果，让下次启动直接命中幂等短路。
    // 回写失败不阻塞本次读取（内存里已是升级后的数据）。
    if (read.migrated) {
      try {
        writeProjectFile(read.project, latestVersion(PROJECT_MIGRATIONS));
      } catch (e) {
        console.error(`[ProjectStore] 项目 ${id} 迁移结果回写失败：`, e);
      }
    }
    out.push(read.project);
  }
  return out;
}

/** 新增或更新（按 id 写入对应文件） */
export function saveProject(project: Project): void {
  const parsed = ProjectSchema.parse(project);
  if (!existsSync(projectsDir())) mkdirSync(projectsDir(), { recursive: true });
  const isNew = !existsSync(projectFile(parsed.id));
  writeProjectFile(parsed);
  if (isNew) {
    projectEvents.emit('changed', 'created', parsed.id);
  }
}

/** 删除项目（删除对应文件） */
export function deleteProject(id: string): void {
  assertValidProjectId(id);
  try {
    const path = projectFile(id);
    if (existsSync(path)) {
      unlinkSync(path);
      projectEvents.emit('changed', 'deleted', id);
    }
  } catch {
    // 删除失败不抛，调用方按 ok 处理
  }
}

/** 获取单个项目（与 loadProjects 走同一套迁移逻辑） */
export function getProject(id: string): Project | null {
  assertValidProjectId(id);
  try {
    const path = projectFile(id);
    if (!existsSync(path)) return null;
    const read = readProjectFile(path, id);
    if (read === null) return null;
    if (read.migrated) {
      try {
        writeProjectFile(read.project, latestVersion(PROJECT_MIGRATIONS));
      } catch {
        // 回写失败不影响本次返回
      }
    }
    return read.project;
  } catch {
    return null;
  }
}

/**
 * 读取磁盘上某个项目文件声明的 schema 版本（不跑迁移）。
 * 仅供诊断 / 测试使用：回答「这个文件现在自称是第几版」。
 */
export function peekProjectFileVersion(id: string): number {
  assertValidProjectId(id);
  const path = projectFile(id);
  if (!existsSync(path)) return -1;
  return readSchemaVersion(JSON.parse(readFileSync(path, 'utf-8')));
}
