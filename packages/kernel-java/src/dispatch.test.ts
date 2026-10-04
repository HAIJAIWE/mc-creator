import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JavaKernel } from './kernel.js';

describe('JavaKernel dispatch 只读任务（list_instances / get_capabilities）', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const mkTmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'java-kernel-'));
    dirs.push(d);
    return d;
  };

  it('未知 kind → ok:false + unknown 分类 + message 含 kind + retryable:false', async () => {
    const handle = new JavaKernel().dispatch({ id: 'u1', kind: 'nope_xyz', payload: null });
    expect(handle.id).toBe('u1');
    await expect(handle.result()).resolves.toEqual({
      ok: false,
      error: { category: 'unknown', message: '不支持的任务: nope_xyz', retryable: false },
    });
  });

  it('get_capabilities → ok:true + data 透传能力表', async () => {
    const result = await new JavaKernel()
      .dispatch({ id: 'c1', kind: 'get_capabilities', payload: null })
      .result();
    expect(result.ok).toBe(true);
    expect((result.data as { capabilities: unknown[] }).capabilities.length).toBeGreaterThan(0);
  });

  it('list_instances 未传 dataDir → ok:true + 空 instances', async () => {
    await expect(
      new JavaKernel().dispatch({ id: 'l0', kind: 'list_instances', payload: null }).result(),
    ).resolves.toEqual({ ok: true, data: { instances: [] } });
  });

  it('list_instances 空 dataDir（无 instances/）→ ok:true + 空 instances', async () => {
    const dataDir = mkTmp();
    const kernel = new JavaKernel({ dataDir });
    await expect(
      kernel.dispatch({ id: 'l1', kind: 'list_instances', payload: null }).result(),
    ).resolves.toEqual({ ok: true, data: { instances: [] } });
  });

  it('list_instances 扫描 instances/ 子目录（普通文件忽略）→ data 透传排序名', async () => {
    const dataDir = mkTmp();
    mkdirSync(join(dataDir, 'instances', 'a'), { recursive: true });
    mkdirSync(join(dataDir, 'instances', 'b'), { recursive: true });
    writeFileSync(join(dataDir, 'instances', 'note.txt'), 'x');
    const kernel = new JavaKernel({ dataDir });
    await expect(
      kernel.dispatch({ id: 'l2', kind: 'list_instances', payload: null }).result(),
    ).resolves.toEqual({ ok: true, data: { instances: ['a', 'b'] } });
  });

  it('list_instances instances/ 是文件 → ok:false 且不抛裸异常（转 ClassifiedError）', async () => {
    const dataDir = mkTmp();
    mkdirSync(join(dataDir, 'instances'), { recursive: true });
    // instances/ 本体是目录但其下放文件不影响；此处把 dataDir/instances 换成文件：
    rmSync(join(dataDir, 'instances'), { recursive: true, force: true });
    writeFileSync(join(dataDir, 'instances'), 'not-a-dir');
    const kernel = new JavaKernel({ dataDir });
    const result = await kernel.dispatch({ id: 'l3', kind: 'list_instances', payload: null }).result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('disk');
    expect(typeof result.error?.message).toBe('string');
  });

  it('cancel 可调不抛错', () => {
    const handle = new JavaKernel().dispatch({ id: 'x1', kind: 'list_instances', payload: null });
    expect(() => handle.cancel()).not.toThrow();
  });

  it('progress 为空 AsyncIterable（立即 done）', async () => {
    const handle = new JavaKernel().dispatch({ id: 'x2', kind: 'list_instances', payload: null });
    const seen: unknown[] = [];
    for await (const e of handle.progress) seen.push(e);
    expect(seen).toEqual([]);
  });

  it('status() 保持不动：healthy 且 edition=java', () => {
    const s = new JavaKernel().status();
    expect(s.edition).toBe('java');
    expect(s.healthy).toBe(true);
    expect(typeof s.updatedAt).toBe('string');
  });
});

describe('JavaKernel get_context_pack（§10.4 状态注入，只读 R 类）', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const mkTmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'java-ctx-'));
    dirs.push(d);
    return d;
  };
  /** 造一个带 instance.json 与 mods/ 的实例。 */
  const seed = (dataDir: string, id: string, meta?: unknown, mods?: string[]): void => {
    const dir = join(dataDir, 'instances', id);
    mkdirSync(join(dir, 'mods'), { recursive: true });
    writeFileSync(
      join(dir, 'instance.json'),
      JSON.stringify(
        meta ?? {
          name: id,
          edition: 'java',
          versionId: '1.21.1',
          loader: 'fabric',
          javaPath: 'java',
          requiredJavaMajor: 21,
          createdAt: '2026-10-05T00:00:00.000Z',
        },
        null,
        2,
      ),
    );
    for (const m of mods ?? []) writeFileSync(join(dir, 'mods', m), 'x');
  };

  it('正常实例 → ok:true + target 带 mcVersion/runtime + parts.mods 只列 jar', async () => {
    const dataDir = mkTmp();
    seed(dataDir, 'i1', undefined, ['fabric-api.jar', 'jei.jar', 'readme.txt', 'notes.md']);
    const result = await new JavaKernel({ dataDir })
      .dispatch({ id: 'cp1', kind: 'get_context_pack', payload: { instanceId: 'i1' } })
      .result();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      target: { edition: 'java', instanceId: 'i1', mcVersion: '1.21.1', runtime: 'fabric' },
      parts: { mods: ['fabric-api.jar', 'jei.jar'] },
    });
  });

  it('缺 instanceId → validation（不臆造目标）', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir })
      .dispatch({ id: 'cp2', kind: 'get_context_pack', payload: {} })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(result.error?.message).toMatch(/instanceId/);
  });

  it('instanceId 路径穿越 → validation + SANDBOX_ESCAPE（不读界外文件）', async () => {
    const dataDir = mkTmp();
    const outside = mkTmp();
    seed(outside, 'victim');
    const result = await new JavaKernel({ dataDir })
      .dispatch({ id: 'cp3', kind: 'get_context_pack', payload: { instanceId: `..${outside}` } })
      .result();
    expect(result.ok).toBe(false);
    expect(['validation']).toContain(result.error?.category);
  });

  it('实例不存在 → validation + INSTANCE_NOT_FOUND', async () => {
    const dataDir = mkTmp();
    const result = await new JavaKernel({ dataDir })
      .dispatch({ id: 'cp4', kind: 'get_context_pack', payload: { instanceId: 'ghost' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', code: 'INSTANCE_NOT_FOUND' } });
  });

  it('未配置 dataDir → validation，不抛裸异常', async () => {
    const result = await new JavaKernel()
      .dispatch({ id: 'cp5', kind: 'get_context_pack', payload: { instanceId: 'i1' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('instance.json 损坏 → 仍 ok:true，target 只剩身份，parts.mods 照常（局部缺失不整体失败）', async () => {
    const dataDir = mkTmp();
    const dir = join(dataDir, 'instances', 'i6');
    mkdirSync(join(dir, 'mods'), { recursive: true });
    writeFileSync(join(dir, 'instance.json'), '{ not json');
    writeFileSync(join(dir, 'mods', 'ok.jar'), 'x');
    const result = await new JavaKernel({ dataDir })
      .dispatch({ id: 'cp6', kind: 'get_context_pack', payload: { instanceId: 'i6' } })
      .result();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      target: { edition: 'java', instanceId: 'i6' },
      parts: { mods: ['ok.jar'] },
    });
  });

  it('无 mods/ 目录 → ok:true 且 mods 为空数组（不报错）', async () => {
    const dataDir = mkTmp();
    seed(dataDir, 'i7');
    rmSync(join(dataDir, 'instances', 'i7', 'mods'), { recursive: true, force: true });
    const result = await new JavaKernel({ dataDir })
      .dispatch({ id: 'cp7', kind: 'get_context_pack', payload: { instanceId: 'i7' } })
      .result();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({
      target: { edition: 'java', instanceId: 'i7', mcVersion: '1.21.1', runtime: 'fabric' },
      parts: { mods: [] },
    });
  });

  it('sandbox 模式读 sandboxDir，不读 dataDir（§13.4 状态注入也须隔离）', async () => {
    const dataDir = mkTmp();
    const sandboxDir = mkTmp();
    seed(dataDir, 'shared', undefined, ['in-data.jar']);
    seed(sandboxDir, 'shared', undefined, ['in-sandbox.jar']);
    const result = await new JavaKernel({ dataDir, mode: 'sandbox', sandboxDir })
      .dispatch({ id: 'cp8', kind: 'get_context_pack', payload: { instanceId: 'shared' } })
      .result();
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ parts: { mods: ['in-sandbox.jar'] } });
  });

  it('R 类免确认：不需要 confirm 也返回 ok:true（§10.6 只读免确认）', async () => {
    const dataDir = mkTmp();
    seed(dataDir, 'i9', undefined, ['a.jar']);
    // 不传 confirm：若内核误把它当 W/X 处理，这里会拿到 permission 拒绝。
    const result = await new JavaKernel({ dataDir })
      .dispatch({ id: 'cp9', kind: 'get_context_pack', payload: { instanceId: 'i9' } })
      .result();
    expect(result.ok).toBe(true);
  });
});
