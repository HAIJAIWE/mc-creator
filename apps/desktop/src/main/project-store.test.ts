import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  readdirSync,
  readFileSync,
} from 'fs';
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
import {
  loadProjects,
  saveProject,
  deleteProject,
  getProject,
  peekProjectFileVersion,
  PROJECT_ENVELOPE_VERSION,
  PROJECT_MIGRATIONS,
} from './project-store.js';
import { assertChainIsSane, latestVersion } from './schema-migrations.js';
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

/**
 * §12 版本化迁移的项目存储集成测试。
 *
 * 硬回归点：老项目文件（**没有 schemaVersion 字段**的裸 Project 对象）
 * 必须能正常读出且一个字段都不丢 —— 这是老用户升级路径。
 */
describe('project-store（§12 版本化迁移）', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'mc-ps-mig-'));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  /** 造一个 projects 目录 */
  function projectsDirPath(): string {
    return join(tmpDir, 'projects');
  }

  /** 直接写一个「裸 Project」老文件（无 schemaVersion 信封） */
  function writeLegacyProjectFile(id: string, overrides: Record<string, unknown> = {}): void {
    mkdirSync(projectsDirPath(), { recursive: true });
    const bare = {
      id,
      name: `legacy-${id}`,
      generatorType: 'mod',
      loader: 'fabric',
      mcVersion: '1.21',
      description: '老数据',
      spec: { hello: 'world' },
      files: [{ path: 'src/Main.java', content: 'class M{}' }],
      createdAt: '2023-05-01T10:00:00.000Z',
      updatedAt: '2023-06-02T11:22:33.000Z',
      ...overrides,
    };
    writeFileSync(join(projectsDirPath(), `${id}.json`), JSON.stringify(bare, null, 2), 'utf-8');
  }

  /** 读回磁盘上的原始信封 */
  function readEnvelope(id: string): Record<string, unknown> {
    return JSON.parse(readFileSync(join(projectsDirPath(), `${id}.json`), 'utf-8')) as Record<
      string,
      unknown
    >;
  }

  it('新写入的项目文件带 schemaVersion 信封（§12 形状）', () => {
    saveProject(makeProject({ id: 'fresh', name: 'new' }));
    const env = readEnvelope('fresh');
    const stamp = env['schemaVersion'] as Record<string, unknown>;
    expect(stamp['version']).toBe(PROJECT_ENVELOPE_VERSION);
    expect(typeof stamp['appliedAt']).toBe('string');
    expect(Number.isNaN(Date.parse(stamp['appliedAt'] as string))).toBe(false);
    // checksum 字段存在但当前留空（理由见 schema-migrations.ts）
    expect(stamp['checksum']).toBe('');
    // 业务数据在 data 层
    expect((env['data'] as Record<string, unknown>)['id']).toBe('fresh');
  });

  it('老项目文件（无 schemaVersion）能读出且不丢任何字段', () => {
    writeLegacyProjectFile('old1');

    const list = loadProjects();
    expect(list).toHaveLength(1);
    const p = list[0]!;
    expect(p.id).toBe('old1');
    expect(p.name).toBe('legacy-old1');
    expect(p.generatorType).toBe('mod');
    expect(p.loader).toBe('fabric');
    expect(p.mcVersion).toBe('1.21');
    expect(p.description).toBe('老数据');
    expect(p.spec).toEqual({ hello: 'world' });
    expect(p.files).toEqual([{ path: 'src/Main.java', content: 'class M{}' }]);
    expect(p.createdAt).toBe('2023-05-01T10:00:00.000Z');
    expect(p.updatedAt).toBe('2023-06-02T11:22:33.000Z');
  });

  it('老文件读出后被原子回写升级为带信封的当前版本', () => {
    writeLegacyProjectFile('old2');
    expect(peekProjectFileVersion('old2')).toBe(0); // 迁移前：BASE_VERSION

    loadProjects();

    // 回写后磁盘上已是 v1 信封
    expect(peekProjectFileVersion('old2')).toBe(PROJECT_ENVELOPE_VERSION);
    const env = readEnvelope('old2');
    expect((env['data'] as Record<string, unknown>)['name']).toBe('legacy-old2');
  });

  it('迁移幂等：第二次 loadProjects 不再重跑迁移（appliedAt 不变、无重复包裹）', () => {
    writeLegacyProjectFile('idem');

    loadProjects();
    const firstAppliedAt = (readEnvelope('idem')['schemaVersion'] as Record<string, unknown>)[
      'appliedAt'
    ] as string;
    const firstRaw = readFileSync(join(projectsDirPath(), 'idem.json'), 'utf-8');

    loadProjects();
    loadProjects();

    const secondAppliedAt = (readEnvelope('idem')['schemaVersion'] as Record<string, unknown>)[
      'appliedAt'
    ] as string;
    // 已达目标版本 → 不重跑 → 磁盘内容逐字节不变（appliedAt 未被刷新）
    expect(secondAppliedAt).toBe(firstAppliedAt);
    expect(readFileSync(join(projectsDirPath(), 'idem.json'), 'utf-8')).toBe(firstRaw);
    // data 层仍是 data 层，没有被二次包裹成 data.data
    const data = readEnvelope('idem')['data'] as Record<string, unknown>;
    expect(data['data']).toBeUndefined();
    expect(data['schemaVersion']).toBeUndefined();
  });

  it('getProject 与 loadProjects 对老文件给出一致结果（同一套迁移逻辑）', () => {
    writeLegacyProjectFile('consist');
    loadProjects(); // 先跑一次升级
    const viaList = loadProjects().find((p) => p.id === 'consist');
    const viaGet = getProject('consist');
    expect(viaGet).toEqual(viaList);
    expect(viaGet?.files).toEqual([{ path: 'src/Main.java', content: 'class M{}' }]);
  });

  it('getProject 单条读取也会升级老文件（不必先 loadProjects）', () => {
    writeLegacyProjectFile('single');
    expect(peekProjectFileVersion('single')).toBe(0);

    const p = getProject('single');
    expect(p?.id).toBe('single');
    expect(peekProjectFileVersion('single')).toBe(PROJECT_ENVELOPE_VERSION);
  });

  it('数据版本高于当前代码 → 明确报错拒绝降级，该项目被跳过但不影响其他项目', () => {
    writeLegacyProjectFile('normal');
    mkdirSync(projectsDirPath(), { recursive: true });
    // 伪造一个 v99 的信封，内含 v1 不认识的字段
    writeFileSync(
      join(projectsDirPath(), 'future.json'),
      JSON.stringify({
        schemaVersion: { version: 99, appliedAt: 'x', checksum: '' },
        data: { ...makeProject({ id: 'future' }), futureOnlyField: 'keep' },
      }),
      'utf-8',
    );

    const list = loadProjects();

    // 正常项目照常读出
    expect(list.map((p) => p.id)).toEqual(['normal']);
    // 高版本项目被跳过（不尝试降级），磁盘文件保持原样不被改写
    expect(readEnvelope('future')['schemaVersion']).toMatchObject({ version: 99 });
    expect((readEnvelope('future')['data'] as Record<string, unknown>)['futureOnlyField']).toBe(
      'keep',
    );
  });

  it('迁移是原子的：回写后无 .tmp 残留，且文件一次成型可读', () => {
    writeLegacyProjectFile('atomic');
    loadProjects();

    // tmp 中间文件不残留（与既有原子写约定一致）
    expect(existsSync(join(projectsDirPath(), 'atomic.json.tmp'))).toBe(false);
    expect(readdirSync(projectsDirPath())).toEqual(['atomic.json']);
    // 成品是合法 JSON 且带信封
    const env = readEnvelope('atomic');
    expect(env['schemaVersion']).toBeDefined();
    expect(env['data']).toBeDefined();
  });

  it('多个老文件混合：全部升级，且新旧文件读出字段一致', () => {
    writeLegacyProjectFile('m1', { name: 'A' });
    writeLegacyProjectFile('m2', { name: 'B' });
    // 混入一个已是当前版本的文件
    saveProject(makeProject({ id: 'm3', name: 'C' }));

    const list = loadProjects();
    expect(list.map((p) => p.name).sort()).toEqual(['A', 'B', 'C']);
    for (const id of ['m1', 'm2', 'm3']) {
      expect(peekProjectFileVersion(id)).toBe(PROJECT_ENVELOPE_VERSION);
    }
    // 两个老文件的 spec / files 在迁移中未被丢弃（m3 本来就是当前格式，spec 为 {}）
    for (const p of list.filter((x) => x.id !== 'm3')) {
      expect(p.spec).toEqual({ hello: 'world' });
      expect(p.files).toEqual([{ path: 'src/Main.java', content: 'class M{}' }]);
    }
    // 新写入的那条原样往返
    expect(list.find((p) => p.id === 'm3')?.spec).toEqual({});
  });

  it('信封结构损坏（schemaVersion 是字符串）→ 该项跳过，不炸整个目录', () => {
    mkdirSync(projectsDirPath(), { recursive: true });
    writeFileSync(
      join(projectsDirPath(), 'badstamp.json'),
      JSON.stringify({ schemaVersion: 'v1', data: makeProject({ id: 'badstamp' }) }),
      'utf-8',
    );
    saveProject(makeProject({ id: 'ok', name: 'fine' }));

    const list = loadProjects();
    expect(list.map((p) => p.id)).toEqual(['ok']);
  });

  it('迁移链定义合法：版本连续、1..N（模块加载期已 fail-fast，这里再钉一次）', () => {
    expect(() => assertChainIsSane(PROJECT_MIGRATIONS)).not.toThrow();
    expect(PROJECT_MIGRATIONS.map((m) => m.version)).toEqual([1]);
    expect(latestVersion(PROJECT_MIGRATIONS)).toBe(PROJECT_ENVELOPE_VERSION);
  });

  it('老 projects.json 单文件迁移出来的项目也带信封（两条迁移路径统一）', () => {
    writeFileSync(
      join(tmpDir, 'projects.json'),
      JSON.stringify([makeProject({ id: 'leg1', name: 'fromLegacy' })]),
      'utf-8',
    );

    const list = loadProjects();
    expect(list.map((p) => p.id)).toEqual(['leg1']);
    expect(peekProjectFileVersion('leg1')).toBe(PROJECT_ENVELOPE_VERSION);
  });
});
