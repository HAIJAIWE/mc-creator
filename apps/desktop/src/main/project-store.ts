import { app } from 'electron';
import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
  renameSync, readdirSync, unlinkSync,
} from 'fs';
import { join } from 'path';
import { ProjectSchema, type Project } from '../shared/ipc-channels.js';

/**
 * 项目持久化（P3-3：分文件存储）
 *
 * 每个项目独立存于 `userData/projects/<id>.json`，相比旧的单文件 `projects.json`：
 *  - saveProject 只写 1 个文件，不必重写全部
 *  - deleteProject 只删 1 个文件，不必重写全部
 *  - 单文件损坏不影响其他项目
 *  - 每文件原子写（tmp + rename）
 *
 * 首次启动时若发现旧 `projects.json` 存在，自动迁移到分文件，原文件改名为
 * `projects.json.migrated` 作为备份保留。
 */

const PROJECTS_DIR = 'projects';
const LEGACY_FILE = 'projects.json';
const LEGACY_MIGRATED = 'projects.json.migrated';

/** id 仅允许这些字符，避免路径穿越/异常文件名 */
const ID_RE = /^[a-zA-Z0-9_-]+$/;

/** 校验 id 合法性（路径穿越防护） */
function assertValidId(id: string): void {
  if (!ID_RE.test(id)) {
    throw new Error(`Invalid project id: ${JSON.stringify(id)}`);
  }
}

function projectsDir(): string {
  return join(app.getPath('userData'), PROJECTS_DIR);
}

function projectFile(id: string): string {
  assertValidId(id);
  return join(projectsDir(), `${id}.json`);
}

function legacyPath(): string {
  return join(app.getPath('userData'), LEGACY_FILE);
}

function legacyMigratedPath(): string {
  return join(app.getPath('userData'), LEGACY_MIGRATED);
}

/** 原子写单个项目文件 */
function writeProjectFile(project: Project): void {
  const path = projectFile(project.id);
  const tmpPath = path + '.tmp';
  writeFileSync(tmpPath, JSON.stringify(project, null, 2), 'utf-8');
  renameSync(tmpPath, path);
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
    try {
      const raw = readFileSync(join(dir, name), 'utf-8');
      out.push(ProjectSchema.parse(JSON.parse(raw)));
    } catch {
      // 单个项目损坏跳过，不阻塞其他项目读取
    }
  }
  return out;
}

/** 新增或更新（按 id 写入对应文件） */
export function saveProject(project: Project): void {
  const parsed = ProjectSchema.parse(project);
  if (!existsSync(projectsDir())) mkdirSync(projectsDir(), { recursive: true });
  writeProjectFile(parsed);
}

/** 删除项目（删除对应文件） */
export function deleteProject(id: string): void {
  assertValidId(id);
  try {
    const path = projectFile(id);
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // 删除失败不抛，调用方按 ok 处理
  }
}

/** 获取单个项目 */
export function getProject(id: string): Project | null {
  assertValidId(id);
  try {
    const path = projectFile(id);
    if (!existsSync(path)) return null;
    const raw = readFileSync(path, 'utf-8');
    return ProjectSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}
