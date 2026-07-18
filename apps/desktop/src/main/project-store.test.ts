import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readdirSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// Mock electron：把 app.getPath('userData') 指向每个用例独立的临时目录
let tmpDir: string;
vi.mock('electron', () => ({
  app: {
    getPath: () => tmpDir,
  },
}));

// 必须在 mock 之后导入被测模块
import { loadProjects, saveProject, deleteProject, getProject } from './project-store.js';
import { ProjectSchema } from '../shared/ipc-channels.js';

/** 构造一个最小有效 Project */
function makeProject(overrides: Partial<Record<string, unknown>> = {}) {
  return ProjectSchema.parse({
    id: 'p1',
    name: 'demo',
    generatorType: 'mod',
    loader: 'fabric',
    mcVersion: '1.21',
    description: 'd',
    spec: {},
    files: [],
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    ...overrides,
  });
}

describe('project-store（分文件存储）', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mc-ps-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('saveProject 后 loadProjects 能读回', () => {
    const p = makeProject({ id: 'abc', name: 'first' });
    saveProject(p);
    const list = loadProjects();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('abc');
    expect(list[0].name).toBe('first');
  });

  it('getProject 按 id 读取单条', () => {
    const p = makeProject({ id: 'xyz' });
    saveProject(p);
    expect(getProject('xyz')?.id).toBe('xyz');
    expect(getProject('not-exist')).toBeNull();
  });

  it('saveProject 同 id 覆盖（不新增）', () => {
    saveProject(makeProject({ id: 'dup', name: 'v1' }));
    saveProject(makeProject({ id: 'dup', name: 'v2' }));
    const list = loadProjects();
    expect(list).toHaveLength(1);
    expect(list[0].name).toBe('v2');
  });

  it('多个项目共存，每个独立文件', () => {
    saveProject(makeProject({ id: 'a' }));
    saveProject(makeProject({ id: 'b' }));
    saveProject(makeProject({ id: 'c' }));
    const list = loadProjects();
    expect(list.map((p) => p.id).sort()).toEqual(['a', 'b', 'c']);
    // 验证分文件：projects 目录下应有 a.json/b.json/c.json 三个文件
    const files = readdirSync(join(tmpDir, 'projects')).filter((f) => f.endsWith('.json'));
    expect(files.sort()).toEqual(['a.json', 'b.json', 'c.json']);
  });

  it('deleteProject 删除对应文件', () => {
    saveProject(makeProject({ id: 'keep' }));
    saveProject(makeProject({ id: 'del' }));
    deleteProject('del');
    const list = loadProjects();
    expect(list.map((p) => p.id)).toEqual(['keep']);
    expect(existsSync(join(tmpDir, 'projects', 'del.json'))).toBe(false);
    expect(existsSync(join(tmpDir, 'projects', 'keep.json'))).toBe(true);
  });

  it('deleteProject 不存在的 id 不抛错', () => {
    expect(() => deleteProject('nope')).not.toThrow();
  });

  it('非法 id 拒绝（路径穿越防护）', () => {
    // ProjectSchema 接受任意 string 作为 id，但 projectFile 会拒绝
    // 直接调用 saveProject 传入恶意 id 时应抛错
    const evil = { ...makeProject({ id: 'safe' }), id: '../escape' };
    expect(() => saveProject(evil as never)).toThrow(/Invalid project id/);
    expect(() => getProject('../escape')).toThrow(/Invalid project id/);
  });

  it('单个项目文件损坏不影响其他项目', () => {
    saveProject(makeProject({ id: 'good1' }));
    saveProject(makeProject({ id: 'good2' }));
    saveProject(makeProject({ id: 'broken' }));

    // 手动破坏 broken.json
    writeFileSync(join(tmpDir, 'projects', 'broken.json'), '{ not json', 'utf-8');

    const list = loadProjects();
    expect(list.map((p) => p.id).sort()).toEqual(['good1', 'good2']);
  });

  it('从旧 projects.json 自动迁移到分文件', () => {
    // 模拟旧版数据：直接写 userData/projects.json
    const legacy = [
      makeProject({ id: 'old1', name: 'legacy1' }),
      makeProject({ id: 'old2', name: 'legacy2' }),
    ];
    writeFileSync(join(tmpDir, 'projects.json'), JSON.stringify(legacy, null, 2), 'utf-8');

    const list = loadProjects();
    expect(list.map((p) => p.id).sort()).toEqual(['old1', 'old2']);

    // 旧文件应被改名为 .migrated（保留为备份）
    expect(existsSync(join(tmpDir, 'projects.json'))).toBe(false);
    expect(existsSync(join(tmpDir, 'projects.json.migrated'))).toBe(true);

    // 每个项目应有独立文件
    expect(existsSync(join(tmpDir, 'projects', 'old1.json'))).toBe(true);
    expect(existsSync(join(tmpDir, 'projects', 'old2.json'))).toBe(true);
  });

  it('已迁移过则不重复迁移', () => {
    // 同时存在旧文件和迁移标记
    writeFileSync(
      join(tmpDir, 'projects.json'),
      JSON.stringify([makeProject({ id: 'old1', name: 'legacy1' })]),
      'utf-8',
    );
    writeFileSync(join(tmpDir, 'projects.json.migrated'), '', 'utf-8');
    // 同时存在新的分文件
    saveProject(makeProject({ id: 'new1' }));

    const list = loadProjects();
    // 只读到分文件的，不读旧文件
    expect(list.map((p) => p.id)).toEqual(['new1']);
  });

  it('原子写：保存后文件可读且为合法 JSON', () => {
    const p = makeProject({ id: 'atom', name: 'atomic' });
    saveProject(p);
    const raw = readFileSync(join(tmpDir, 'projects', 'atom.json'), 'utf-8');
    expect(() => JSON.parse(raw)).not.toThrow();
    // .tmp 中间文件不应残留
    expect(existsSync(join(tmpDir, 'projects', 'atom.json.tmp'))).toBe(false);
  });

  it('空 userData 目录返回空列表', () => {
    expect(loadProjects()).toEqual([]);
  });
});
