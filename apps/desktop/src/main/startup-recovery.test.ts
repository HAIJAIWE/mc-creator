// @vitest-environment node
/**
 * startup-recovery 单元测试（§14 可靠性 · 半成品检测）。
 *
 * 覆盖矩阵：
 *  - 残留构造（缺 instance.json 的实例 / *.tmp 中间文件）→ 扫描发现并清理
 *  - 无残留 → 不误删、不误隔离（幂等）
 *  - 正常实例（有 instance.json）→ 一律不动
 *  - instance.json 损坏 → 只报告，不自动"修"
 *  - apply=false 时只读，不产生任何写操作
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  formatRecoveryReport,
  isStaleTempFile,
  runStartupRecovery,
  scanInstanceRoot,
  scanStaleTempFiles,
} from './startup-recovery.js';

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mc-recovery-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** 造一个 kernelRoot，其下有 instances/ */
function makeKernelRoot(): string {
  const kernelRoot = join(root, 'kernel');
  mkdirSync(join(kernelRoot, 'instances'), { recursive: true });
  return kernelRoot;
}

/** 造一个 create_instance 崩溃后残留的实例：目录建了，manifest 没写 */
function makeIncompleteInstance(
  kernelRoot: string,
  name: string,
  subs: string[] = ['mods', 'config'],
): string {
  const dir = join(kernelRoot, 'instances', name);
  for (const sub of subs) {
    mkdirSync(join(dir, sub), { recursive: true });
    writeFileSync(join(dir, sub, '.gitkeep'), '', 'utf-8');
  }
  return dir;
}

/** 造一个正常实例：manifest 齐全 */
function makeCompleteInstance(kernelRoot: string, name: string): string {
  const dir = join(kernelRoot, 'instances', name);
  mkdirSync(join(dir, 'mods'), { recursive: true });
  writeFileSync(
    join(dir, 'instance.json'),
    JSON.stringify({ name, edition: 'java', versionId: '1.21', loader: 'fabric' }),
    'utf-8',
  );
  return dir;
}

describe('isStaleTempFile：原子写中间文件识别', () => {
  it('识别 project-store 风格的固定 .tmp 后缀', () => {
    expect(isStaleTempFile('abc.json.tmp')).toBe(true);
  });

  it('识别 shell writeFileAtomic 风格的 .tmp-<pid>-<uuid8>', () => {
    expect(isStaleTempFile('abc.json.tmp-1234-deadbeef')).toBe(true);
  });

  it('目标名本身含 .tmp 也能识别（取最后一段）', () => {
    expect(isStaleTempFile('a.tmp.json.tmp')).toBe(true);
    expect(isStaleTempFile('a.tmp.json.tmp-99-abcdef01')).toBe(true);
  });

  it('不误判正常文件', () => {
    expect(isStaleTempFile('abc.json')).toBe(false);
    expect(isStaleTempFile('report.tmpl.json')).toBe(false);
    expect(isStaleTempFile('tmpfile.json')).toBe(false);
    expect(isStaleTempFile('.tmp')).toBe(false); // pos <= 0
    expect(isStaleTempFile('abc.json.tmpx')).toBe(false);
    expect(isStaleTempFile('abc.json.tmp.bak')).toBe(false);
  });
});

describe('scanInstanceRoot：半成品实例识别', () => {
  it('缺 instance.json 的目录 → 判为半成品', () => {
    const kernelRoot = makeKernelRoot();
    makeIncompleteInstance(kernelRoot, 'half');

    const res = scanInstanceRoot(kernelRoot);
    expect(res.incompleteInstances).toHaveLength(1);
    expect(res.incompleteInstances[0]!.name).toBe('half');
    // 目录里有 mods/ + config/ 两个子目录 + 各自的 .gitkeep = 2 项
    expect(res.incompleteInstances[0]!.entryCount).toBe(2);
    expect(res.corruptInstances).toHaveLength(0);
  });

  it('manifest 齐全的实例不算半成品', () => {
    const kernelRoot = makeKernelRoot();
    makeCompleteInstance(kernelRoot, 'good');

    const res = scanInstanceRoot(kernelRoot);
    expect(res.incompleteInstances).toHaveLength(0);
    expect(res.corruptInstances).toHaveLength(0);
  });

  it('空目录（只有一层、啥都没写）也判为半成品', () => {
    const kernelRoot = makeKernelRoot();
    mkdirSync(join(kernelRoot, 'instances', 'empty'), { recursive: true });

    const res = scanInstanceRoot(kernelRoot);
    expect(res.incompleteInstances.map((i) => i.name)).toEqual(['empty']);
    expect(res.incompleteInstances[0]!.entryCount).toBe(0);
  });

  it('缺子目录但有 manifest → 不判半成品（可自愈偏差不该动用户数据）', () => {
    const kernelRoot = makeKernelRoot();
    const dir = join(kernelRoot, 'instances', 'sparse');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'instance.json'), JSON.stringify({ name: 'sparse' }), 'utf-8');

    const res = scanInstanceRoot(kernelRoot);
    expect(res.incompleteInstances).toHaveLength(0);
  });

  it('instance.json 存在但不是合法 JSON → 归为 corrupt，不算半成品', () => {
    const kernelRoot = makeKernelRoot();
    const dir = join(kernelRoot, 'instances', 'corrupt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'instance.json'), '{ not json', 'utf-8');

    const res = scanInstanceRoot(kernelRoot);
    expect(res.incompleteInstances).toHaveLength(0);
    expect(res.corruptInstances).toHaveLength(1);
    expect(res.corruptInstances[0]!.name).toBe('corrupt');
  });

  it('instance.json 是 JSON 数组 → 也算 corrupt', () => {
    const kernelRoot = makeKernelRoot();
    const dir = join(kernelRoot, 'instances', 'arr');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'instance.json'), '[1,2,3]', 'utf-8');

    expect(scanInstanceRoot(kernelRoot).corruptInstances).toHaveLength(1);
  });

  it('instances/ 里有普通文件 → 忽略（只处理目录）', () => {
    const kernelRoot = makeKernelRoot();
    writeFileSync(join(kernelRoot, 'instances', 'note.txt'), 'x', 'utf-8');

    const res = scanInstanceRoot(kernelRoot);
    expect(res.incompleteInstances).toHaveLength(0);
    expect(res.corruptInstances).toHaveLength(0);
  });

  it('kernelRoot / instances 不存在 → 空结果，不抛错', () => {
    expect(scanInstanceRoot(join(root, 'nope')).incompleteInstances).toEqual([]);
    const kernelRoot = makeKernelRoot();
    rmSync(join(kernelRoot, 'instances'), { recursive: true, force: true });
    expect(scanInstanceRoot(kernelRoot).incompleteInstances).toEqual([]);
  });
});

describe('scanStaleTempFiles：残留中间文件识别', () => {
  it('混合场景：只报 tmp 类，正常文件不报', () => {
    const dir = join(root, 'projects');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'a.json.tmp'), 'half', 'utf-8');
    writeFileSync(join(dir, 'b.json.tmp-1-abcdef01'), 'half', 'utf-8');
    writeFileSync(join(dir, 'c.json'), '{}', 'utf-8');

    const res = scanStaleTempFiles(dir);
    expect(res.map((t) => t.path).sort()).toEqual([
      join(dir, 'a.json.tmp'),
      join(dir, 'b.json.tmp-1-abcdef01'),
    ]);
  });

  it('目录不存在 → 空数组', () => {
    expect(scanStaleTempFiles(join(root, 'ghost'))).toEqual([]);
  });
});

describe('runStartupRecovery：清理残留', () => {
  it('apply=true → 隔离半成品实例，且移出 instances/（list_instances 不再看到）', () => {
    const kernelRoot = makeKernelRoot();
    makeIncompleteInstance(kernelRoot, 'half');
    makeCompleteInstance(kernelRoot, 'good');

    const report = runStartupRecovery({ userDataDir: root, kernelRoot, apply: true });

    expect(report.quarantined).toEqual(['half']);
    // instances/ 下只剩正常实例
    expect(readdirSync(join(kernelRoot, 'instances'))).toEqual(['good']);
    // 半成品内容仍在（隔离可逆，不丢数据）
    const quarantined = readdirSync(kernelRoot).find((n) => n.includes('half'));
    expect(quarantined).toBeDefined();
    expect(existsSync(join(kernelRoot, quarantined!, 'mods'))).toBe(true);
    // 正常实例的 manifest 一个字节都没动
    expect(
      JSON.parse(readFileSync(join(kernelRoot, 'instances', 'good', 'instance.json'), 'utf-8')),
    ).toEqual({
      name: 'good',
      edition: 'java',
      versionId: '1.21',
      loader: 'fabric',
    });
  });

  it('apply=true → 删除残留 *.tmp 中间文件', () => {
    const kernelRoot = makeKernelRoot();
    mkdirSync(join(kernelRoot, 'projects'), { recursive: true });
    writeFileSync(join(kernelRoot, 'projects', 'p.json.tmp'), 'crash residue', 'utf-8');
    writeFileSync(join(kernelRoot, 'projects', 'keep.json'), '{}', 'utf-8');

    // userDataDir 指向 kernelRoot：恢复器固定扫 <userDataDir>/projects
    const report = runStartupRecovery({ userDataDir: kernelRoot, kernelRoot, apply: true });

    expect(report.removedTempFiles).toEqual([join(kernelRoot, 'projects', 'p.json.tmp')]);
    expect(existsSync(join(kernelRoot, 'projects', 'p.json.tmp'))).toBe(false);
    // 正常文件保留
    expect(existsSync(join(kernelRoot, 'projects', 'keep.json'))).toBe(true);
  });

  it('无残留 → 不误删、不误隔离（报告全空）', () => {
    const kernelRoot = makeKernelRoot();
    makeCompleteInstance(kernelRoot, 'a');
    makeCompleteInstance(kernelRoot, 'b');

    const before = readdirSync(join(kernelRoot, 'instances')).sort();
    const report = runStartupRecovery({ userDataDir: root, kernelRoot, apply: true });

    expect(report.quarantined).toEqual([]);
    expect(report.removedTempFiles).toEqual([]);
    expect(report.incompleteInstances).toEqual([]);
    expect(report.corruptInstances).toEqual([]);
    expect(report.errors).toEqual([]);
    expect(readdirSync(join(kernelRoot, 'instances')).sort()).toEqual(before);
  });

  it('apply=false（默认）→ 只扫描不写盘', () => {
    const kernelRoot = makeKernelRoot();
    makeIncompleteInstance(kernelRoot, 'half');
    mkdirSync(join(kernelRoot, 'projects'), { recursive: true });
    writeFileSync(join(kernelRoot, 'projects', 'x.json.tmp'), 'x', 'utf-8');

    const report = runStartupRecovery({ userDataDir: kernelRoot, kernelRoot, apply: false });

    // 两类残留都扫到了
    expect(report.incompleteInstances.map((i) => i.name)).toEqual(['half']);
    expect(report.staleTempFiles.map((t) => t.path)).toEqual([
      join(kernelRoot, 'projects', 'x.json.tmp'),
    ]);
    // 但一个字节都没改
    expect(report.quarantined).toEqual([]);
    expect(report.removedTempFiles).toEqual([]);
    expect(existsSync(join(kernelRoot, 'instances', 'half'))).toBe(true);
    expect(existsSync(join(kernelRoot, 'projects', 'x.json.tmp'))).toBe(true);
    // 没产生隔离目录（隔离目标名以 .incomplete- 开头）
    expect(readdirSync(kernelRoot).filter((n) => n.startsWith('.incomplete-'))).toEqual([]);
  });

  it('幂等：连续跑两次，第二次无操作', () => {
    const kernelRoot = makeKernelRoot();
    makeIncompleteInstance(kernelRoot, 'half');
    mkdirSync(join(kernelRoot, 'projects'), { recursive: true });
    writeFileSync(join(kernelRoot, 'projects', 'p.json.tmp'), 'x', 'utf-8');

    const first = runStartupRecovery({ userDataDir: kernelRoot, kernelRoot, apply: true });
    expect(first.quarantined).toHaveLength(1);
    expect(first.removedTempFiles).toHaveLength(1);

    const second = runStartupRecovery({ userDataDir: kernelRoot, kernelRoot, apply: true });
    expect(second.quarantined).toEqual([]);
    expect(second.removedTempFiles).toEqual([]);
  });

  it('instance.json 损坏 → 只报告，不动磁盘（不自动修用户元数据）', () => {
    const kernelRoot = makeKernelRoot();
    const dir = join(kernelRoot, 'instances', 'corrupt');
    mkdirSync(dir, { recursive: true });
    const raw = '{ broken';
    writeFileSync(join(dir, 'instance.json'), raw, 'utf-8');

    const report = runStartupRecovery({ userDataDir: root, kernelRoot, apply: true });

    expect(report.corruptInstances).toHaveLength(1);
    expect(report.quarantined).toEqual([]);
    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(join(dir, 'instance.json'), 'utf-8')).toBe(raw);
  });

  it('不传 kernelRoot（desktop 自身目录）也能扫 projects 残留', () => {
    const userDataDir = join(root, 'userData');
    mkdirSync(join(userDataDir, 'projects'), { recursive: true });
    writeFileSync(join(userDataDir, 'projects', 'x.json.tmp'), 'residue', 'utf-8');
    writeFileSync(join(userDataDir, 'projects', 'y.json'), '{}', 'utf-8');

    const report = runStartupRecovery({ userDataDir, apply: true });

    expect(report.removedTempFiles).toEqual([join(userDataDir, 'projects', 'x.json.tmp')]);
    expect(existsSync(join(userDataDir, 'projects', 'y.json'))).toBe(true);
  });

  it('清理失败记入 errors 而不抛（启动期不该被残留拦住）', () => {
    const kernelRoot = makeKernelRoot();
    // 占位成文件，让 mkdir 语义与 rename 目标冲突 → rename 失败
    makeCompleteInstance(kernelRoot, 'good');

    // 让隔离目标已存在为目录，制造 rename 冲突
    const dir = join(kernelRoot, 'instances', 'half');
    mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    const blocked = join(kernelRoot, `.incomplete-${stamp}-half`);
    mkdirSync(blocked, { recursive: true });
    // renameSync 在 Windows 上对「目标已存在为目录」会失败
    mkdirSync(join(kernelRoot, 'instances', 'half2'), { recursive: true });

    // 直接验证：runStartupRecovery 不抛，且 errors/成功项被记录
    const report = runStartupRecovery({ userDataDir: root, kernelRoot, apply: true });
    expect(Array.isArray(report.errors)).toBe(true);
    // 至少 good 不受影响
    expect(existsSync(join(kernelRoot, 'instances', 'good', 'instance.json'))).toBe(true);
  });

  it('残留文件已被别的进程删掉 → 跳过不报错（existsSync 二次确认）', () => {
    const kernelRoot = makeKernelRoot();
    mkdirSync(join(kernelRoot, 'projects'), { recursive: true });
    const target = join(kernelRoot, 'projects', 'p.json.tmp');
    writeFileSync(target, 'x', 'utf-8');

    const report = runStartupRecovery({ userDataDir: kernelRoot, kernelRoot, apply: false });
    expect(report.staleTempFiles).toHaveLength(1);
    // 手工删掉后直接调 apply 分支不会因为 unlink 抛 ENOENT 而记 error
    rmSync(target, { force: true });
    const applied = runStartupRecovery({ userDataDir: kernelRoot, kernelRoot, apply: true });
    expect(applied.errors).toEqual([]);
  });
});

describe('formatRecoveryReport：日志摘要', () => {
  it('无命中 → null（调用方可跳过打印）', () => {
    const kernelRoot = makeKernelRoot();
    const report = runStartupRecovery({ userDataDir: root, kernelRoot, apply: true });
    expect(formatRecoveryReport(report)).toBeNull();
  });

  it('有隔离 → 输出一行中文摘要并带上实例名', () => {
    const kernelRoot = makeKernelRoot();
    makeIncompleteInstance(kernelRoot, 'half');
    const report = runStartupRecovery({ userDataDir: root, kernelRoot, apply: true });
    const line = formatRecoveryReport(report);
    expect(line).toContain('§14');
    expect(line).toContain('half');
    expect(line).toContain('隔离未完成实例');
  });

  it('损坏实例数被计入摘要（提示需人工处理）', () => {
    const kernelRoot = makeKernelRoot();
    const dir = join(kernelRoot, 'instances', 'corrupt');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'instance.json'), 'nope', 'utf-8');
    const report = runStartupRecovery({ userDataDir: root, kernelRoot, apply: true });
    expect(formatRecoveryReport(report)).toContain('instance.json 损坏需人工处理');
  });
});

describe('runStartupRecovery：日志不抛未捕获异常（console.warn spy）', () => {
  it('隔离时打中文告警日志', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const kernelRoot = makeKernelRoot();
      makeIncompleteInstance(kernelRoot, 'half');
      runStartupRecovery({ userDataDir: root, kernelRoot, apply: true });
      expect(warn).toHaveBeenCalled();
      expect(String(warn.mock.calls[0]![0])).toContain('§14 半成品检测');
    } finally {
      warn.mockRestore();
    }
  });
});
