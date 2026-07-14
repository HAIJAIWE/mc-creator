import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { ProjectSchema, type Project } from '../shared/ipc-channels.js';

/** 项目持久化（用 JSON 文件存 app.getPath('userData')） */
const PROJECTS_FILE = 'projects.json';

function projectsPath(): string {
  return join(app.getPath('userData'), PROJECTS_FILE);
}

function readAll(): Project[] {
  try {
    if (existsSync(projectsPath())) {
      const raw = readFileSync(projectsPath(), 'utf-8');
      const arr = JSON.parse(raw) as unknown[];
      return arr.map((item) => ProjectSchema.parse(item));
    }
  } catch {
    // 文件损坏，当作空列表
  }
  return [];
}

function writeAll(projects: Project[]): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(projectsPath(), JSON.stringify(projects, null, 2), 'utf-8');
}

/** 读取所有项目 */
export function loadProjects(): Project[] {
  return readAll();
}

/** 新增或更新（按 id 匹配） */
export function saveProject(project: Project): void {
  const parsed = ProjectSchema.parse(project);
  const projects = readAll();
  const idx = projects.findIndex((p) => p.id === parsed.id);
  if (idx >= 0) {
    projects[idx] = parsed;
  } else {
    projects.push(parsed);
  }
  writeAll(projects);
}

/** 删除项目 */
export function deleteProject(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}

/** 获取单个项目 */
export function getProject(id: string): Project | null {
  return readAll().find((p) => p.id === id) ?? null;
}
