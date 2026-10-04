// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { ModGenerator } from '@mc-creator/core/generators/mod/mod-generator.js';
import { ipcClient } from './ipc-client.js';
import { useModStore } from '../store/mod-store.js';

/**
 * 全链路 E2E（Vitest integration；repo 无 Playwright，沿用现有 Vitest 方案）：
 * generateFiles(mock spec) → setFiles → prepareBuildDir → build →
 * exportZip(mock dialog) → launcherListVersions
 *
 * 全部 mock，不依赖真实网络 / 真实 MC 下载 / 真实 Gradle：
 * - generateFiles：调真实 core 生成器（本地 registry，无网络），mock 的只是 IPC 边界
 * - prepareBuildDir / build / exportZip：在 os.tmpdir 落真实临时文件，
 *   断言 jarPath / zipPath 存在
 * - launcherListVersions：返回 canned 版本列表
 * 可重复跑：每次用 mkdtemp 隔离，afterEach 清理。
 */

const tmpRoots: string[] = [];
function trackDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // 清理失败不影响测试结果
    }
  }
});

const MOCK_SPEC = {
  modId: 'demo',
  name: 'Demo',
  version: '1.0.0',
  description: 'e2e mock spec',
  items: [],
  blocks: [],
};

beforeEach(() => {
  useModStore.setState({
    loader: 'fabric',
    mcVersion: '1.21.11',
    description: '',
    generatorType: 'mod',
    spec: null,
    files: [],
    previousFiles: [],
    selectedFile: null,
    unimplemented: [],
    buildStats: null,
    openTabs: [],
    splitFile: null,
    dirtyFiles: new Set<string>(),
    lastKnownMeta: {},
    buildLog: '',
    buildSuccess: null,
    jarPath: null,
    loading: false,
    error: null,
    fixLog: [],
    conflictDialog: null,
  });
  (window as unknown as { __MC_PREVIEW__?: boolean }).__MC_PREVIEW__ = false;

  const generateFiles = vi.fn(async (req: {
    loader: string;
    mcVersion: string;
    spec: unknown;
    generatorType: 'mod';
    projectId?: string;
  }) => {
    // 真实本地生成（ModGenerator，无网络），仅 IPC 边界被 mock；
    // 直引生成器文件，避开顶层 barrel（modpack 侧正在重构，barrel 暂不稳定）
    const gen = new ModGenerator();
    const spec = req.spec as { modId?: string; packId?: string };
    const result = await gen.generate({
      loader: req.loader,
      mcVersion: req.mcVersion,
      modId: spec.modId ?? spec.packId ?? 'demo',
      spec: spec as never,
      projectPath: '',
    } as never);
    return {
      files: result.files,
      warnings: result.warnings ?? [],
      unimplemented: result.unimplemented ?? [],
      spec: spec as Record<string, unknown>,
    };
  });

  const prepareBuildDir = vi.fn(async (files: { path: string; content: string }[]) => {
    const dir = trackDir('mc-e2e-build-');
    for (const f of files) {
      const p = join(dir, f.path);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, f.content, 'utf8');
    }
    return { projectPath: dir, estimatedSteps: files.length };
  });

  const build = vi.fn(async (projectPath: string) => {
    const jarPath = join(projectPath, 'build', 'libs', 'demo-1.0.0.jar');
    mkdirSync(dirname(jarPath), { recursive: true });
    writeFileSync(jarPath, 'fake-jar-bytes', 'utf8');
    return { success: true, jarPath, log: 'BUILD SUCCESSFUL (mock, no gradle)' };
  });

  const exportZip = vi.fn(
    async (req: { files: { path: string; content: string }[]; defaultName: string }) => {
      const dir = trackDir('mc-e2e-export-');
      const savedPath = join(dir, req.defaultName);
      // mock 文件对话框：直接落盘一个占位 zip（内容仅用于存在性断言）
      writeFileSync(savedPath, `fake-zip-entries:${req.files.length}`, 'utf8');
      return { ok: true, canceled: false, savedPath };
    },
  );

  const launcherListVersions = vi.fn(async () => ({
    versions: [{ id: '1.21.11', type: 'release', releaseTime: '2024-12-01T00:00:00Z' }],
  }));

  (window as unknown as { mcApi: unknown }).mcApi = {
    generateFiles,
    prepareBuildDir,
    build,
    exportZip,
    launcherListVersions,
  };
});

function mcApi() {
  return (window as unknown as { mcApi: Record<string, ReturnType<typeof vi.fn>> }).mcApi;
}

describe('全链路 E2E：生成 → 构建 → 导出 → 启动器', () => {
  it('generateFiles(mock spec) → setFiles → prepareBuildDir → build → exportZip → launcherListVersions 跑通', async () => {
    // 1. 生成（mock spec，经真实 core 生成器）
    const genRes = await ipcClient.generateFiles({
      loader: 'fabric',
      mcVersion: '1.21.11',
      spec: MOCK_SPEC,
      generatorType: 'mod',
      projectId: 'e2e-p1',
    });
    expect(mcApi().generateFiles).toHaveBeenCalledOnce();
    expect(genRes.files.length).toBeGreaterThan(0);
    const paths = genRes.files.map((f) => f.path);
    expect(paths).toContain('src/main/resources/fabric.mod.json');
    expect(new Set(paths).size).toBe(paths.length);

    // 2. 入库（ files 非空 + 自动选中首文件）
    useModStore.getState().setFiles(genRes.files);
    const stored = useModStore.getState();
    expect(stored.files.length).toBe(genRes.files.length);
    expect(stored.selectedFile).toBe(genRes.files[0].path);

    // 3. 准备构建目录（内存 files 落盘，返回真实存在的 projectPath）
    const prep = await ipcClient.prepareBuildDir(stored.files);
    expect(mcApi().prepareBuildDir).toHaveBeenCalledOnce();
    expect(existsSync(prep.projectPath)).toBe(true);
    expect(existsSync(join(prep.projectPath, 'src/main/resources/fabric.mod.json'))).toBe(
      true,
    );
    expect(prep.estimatedSteps).toBe(stored.files.length);

    // 4. 构建（mock gradle，jarPath 真实存在）+ 写回 store
    const buildRes = await ipcClient.build(prep.projectPath);
    expect(mcApi().build).toHaveBeenCalledWith(prep.projectPath);
    expect(buildRes.success).toBe(true);
    expect(buildRes.jarPath).not.toBeNull();
    expect(existsSync(buildRes.jarPath as string)).toBe(true);
    useModStore
      .getState()
      .setBuildResult({ success: buildRes.success, log: buildRes.log, jarPath: buildRes.jarPath });
    expect(useModStore.getState().buildSuccess).toBe(true);
    expect(useModStore.getState().jarPath).toBe(buildRes.jarPath);

    // 5. 导出 zip（mock dialog，zipPath 真实存在）
    const zipRes = await ipcClient.exportZip({
      files: stored.files,
      defaultName: 'demo-1.0.0.zip',
    });
    expect(mcApi().exportZip).toHaveBeenCalledOnce();
    expect(zipRes.ok).toBe(true);
    expect(zipRes.canceled).toBe(false);
    expect(zipRes.savedPath).not.toBeNull();
    expect(existsSync(zipRes.savedPath as string)).toBe(true);

    // 6. 启动器版本列表（mock，无网络）
    const versions = await ipcClient.launcherListVersions();
    expect(mcApi().launcherListVersions).toHaveBeenCalledOnce();
    expect(versions.versions.length).toBeGreaterThan(0);
    expect(versions.versions.map((v: { id: string }) => v.id)).toContain('1.21.11');
  });

  it('导出取消路径：canceled=true 时 savedPath 为 null（可重复跑）', async () => {
    mcApi().exportZip.mockResolvedValueOnce({ ok: true, canceled: true, savedPath: null });
    const res = await ipcClient.exportZip({ files: [], defaultName: 'x.zip' });
    expect(res.canceled).toBe(true);
    expect(res.savedPath).toBeNull();
  });
});
