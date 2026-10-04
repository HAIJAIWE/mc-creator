import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ServerKernel } from './kernel.js';

describe('ServerKernel dispatch 只读任务（read_logs / read_config / get_capabilities）', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const mkTmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'server-kernel-'));
    dirs.push(d);
    return d;
  };
  const mkServer = (dataDir: string, serverId: string): string => {
    const dir = join(dataDir, serverId);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    const lines = Array.from({ length: 250 }, (_, i) => `[log line ${i}]`);
    writeFileSync(join(dir, 'logs', 'latest.log'), lines.join('\n'), 'utf8');
    writeFileSync(join(dir, 'server.properties'), 'motd=test\n', 'utf8');
    return dir;
  };

  it('未知 kind → ok:false + unknown 分类 + message 含 kind + retryable:false', async () => {
    const handle = new ServerKernel().dispatch({ id: 'u1', kind: 'nope_xyz', payload: null });
    expect(handle.id).toBe('u1');
    await expect(handle.result()).resolves.toEqual({
      ok: false,
      error: { category: 'unknown', message: '不支持的任务: nope_xyz', retryable: false },
    });
  });

  it('get_capabilities → ok:true + data 透传能力表', async () => {
    const result = await new ServerKernel()
      .dispatch({ id: 'c1', kind: 'get_capabilities', payload: null })
      .result();
    expect(result.ok).toBe(true);
    expect((result.data as { capabilities: unknown[] }).capabilities.length).toBeGreaterThan(0);
  });

  it('read_logs fixture 存在（250 行）→ ok:true + data 透传尾 200 行', async () => {
    const dataDir = mkTmp();
    mkServer(dataDir, 'srv1');
    const kernel = new ServerKernel({ dataDir });
    const result = await kernel
      .dispatch({ id: 'r1', kind: 'read_logs', payload: { serverId: 'srv1' } })
      .result();
    expect(result.ok).toBe(true);
    const data = result.data as { serverId: string; file: string; tail: string[] };
    expect(data.serverId).toBe('srv1');
    expect(data.file.endsWith('latest.log')).toBe(true);
    expect(data.tail).toHaveLength(200);
    expect(data.tail[199]).toBe('[log line 249]');
  });

  it('read_logs 文件缺失 → ok:false + validation 分类', async () => {
    const dataDir = mkTmp();
    const kernel = new ServerKernel({ dataDir });
    const result = await kernel
      .dispatch({ id: 'r2', kind: 'read_logs', payload: { serverId: 'ghost' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', retryable: false } });
    expect(typeof result.error?.message).toBe('string');
  });

  it('read_logs 缺 serverId → ok:false + validation 分类', async () => {
    const dataDir = mkTmp();
    const kernel = new ServerKernel({ dataDir });
    const result = await kernel
      .dispatch({ id: 'r3', kind: 'read_logs', payload: {} })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('read_logs 未传 dataDir → ok:false + validation，不抛裸异常', async () => {
    const result = await new ServerKernel()
      .dispatch({ id: 'r4', kind: 'read_logs', payload: { serverId: 'srv1' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('read_config server.properties 存在 → ok:true + data 透传全文', async () => {
    const dataDir = mkTmp();
    mkServer(dataDir, 'srv1');
    const kernel = new ServerKernel({ dataDir });
    const result = await kernel
      .dispatch({ id: 'g1', kind: 'read_config', payload: { serverId: 'srv1' } })
      .result();
    expect(result.ok).toBe(true);
    const data = result.data as { serverId: string; file: string; text: string };
    expect(data.serverId).toBe('srv1');
    expect(data.file.endsWith('server.properties')).toBe(true);
    expect(data.text).toContain('motd=test');
  });

  it('read_config 文件缺失 → ok:false + validation 分类', async () => {
    const dataDir = mkTmp();
    mkdirSync(join(dataDir, 'empty', 'logs'), { recursive: true });
    const kernel = new ServerKernel({ dataDir });
    const result = await kernel
      .dispatch({ id: 'g2', kind: 'read_config', payload: { serverId: 'empty' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation', retryable: false } });
  });

  it('cancel 可调不抛错，progress 为空', async () => {
    const handle = new ServerKernel().dispatch({ id: 'x1', kind: 'read_logs', payload: null });
    expect(() => handle.cancel()).not.toThrow();
    const seen: unknown[] = [];
    for await (const e of handle.progress) seen.push(e);
    expect(seen).toEqual([]);
  });

  it('status() 保持不动：healthy 且 edition=server', () => {
    const s = new ServerKernel().status();
    expect(s.edition).toBe('server');
    expect(s.healthy).toBe(true);
    expect(typeof s.updatedAt).toBe('string');
  });
});

describe('ServerKernel get_context_pack（§10.4 状态注入，只读 R 类）', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const mkTmp = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'server-ctx-'));
    dirs.push(d);
    return d;
  };
  /** 造一个带 plugins/ + server.properties 的服务端。 */
  const seed = (
    dataDir: string,
    serverId: string,
    opts: { plugins?: string[]; props?: string; records?: Record<string, unknown> } = {},
  ): string => {
    const dir = join(dataDir, serverId);
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    if (opts.records !== undefined) mkdirSync(join(dir, 'plugins', '.deployed'), { recursive: true });
    writeFileSync(join(dir, 'server.properties'), opts.props ?? 'motd=x\nserver-port=25565\n', 'utf8');
    for (const p of opts.plugins ?? []) writeFileSync(join(dir, 'plugins', p), 'x');
    for (const [name, body] of Object.entries(opts.records ?? {})) {
      writeFileSync(join(dir, 'plugins', '.deployed', name), JSON.stringify(body), 'utf8');
    }
    return dir;
  };

  it('正常服务端 → ok:true + target 带 serverId + parts.plugins 只列 jar', async () => {
    const dataDir = mkTmp();
    seed(dataDir, 's1', { plugins: ['Core.jar', 'Shop.jar', 'readme.txt'] });
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp1', kind: 'get_context_pack', payload: { serverId: 's1' } })
      .result();
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({
      target: { edition: 'server', serverId: 's1' },
      parts: { plugins: ['Core.jar', 'Shop.jar'] },
    });
  });

  it('部署账本 → lastBuildHash 取最新一条记录的 sha256（§0.5 哈希可见）', async () => {
    const dataDir = mkTmp();
    seed(dataDir, 's2', {
      plugins: ['A.jar'],
      records: {
        'A.jar.json': { jar: 'A.jar', sha256: 'a'.repeat(64) },
        'B.jar.json': { jar: 'B.jar', sha256: 'b'.repeat(64) },
      },
    });
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp2', kind: 'get_context_pack', payload: { serverId: 's2' } })
      .result();
    expect(result.ok).toBe(true);
    const hash = (result.data as { parts: { lastBuildHash?: string } }).parts.lastBuildHash;
    expect(hash === undefined ? '' : hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('serverConfigSummary 只取白名单关键项，不灌整份配置', async () => {
    const dataDir = mkTmp();
    seed(dataDir, 's3', {
      props: [
        '# 注释行应被忽略',
        'server-port=25577',
        'gamemode=creative',
        'view-distance=12',
        'some-unknown-key=whatever',
        'server-password=hunter2',
        '',
      ].join('\n'),
    });
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp3', kind: 'get_context_pack', payload: { serverId: 's3' } })
      .result();
    expect(result.ok).toBe(true);
    const summary = (result.data as { parts: { serverConfigSummary?: string } }).parts.serverConfigSummary ?? '';
    expect(summary).toContain('server-port=25577');
    expect(summary).toContain('gamemode=creative');
    expect(summary).toContain('view-distance=12');
    // 非白名单项（尤其口令类）不得进入上下文包。
    expect(summary).not.toContain('hunter2');
    expect(summary).not.toContain('some-unknown-key');
    expect(summary).not.toContain('#');
  });

  it('账本 json 损坏 → lastBuildHash 缺失但整体 ok:true（局部缺失不整体失败）', async () => {
    const dataDir = mkTmp();
    // 账本目录存在但内容损坏（模拟写到一半/被外部改坏）。
    seed(dataDir, 's4', { plugins: ['A.jar'], records: { 'A.jar.json': {} } });
    writeFileSync(join(dataDir, 's4', 'plugins', '.deployed', 'A.jar.json'), '{ broken', 'utf8');
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp4', kind: 'get_context_pack', payload: { serverId: 's4' } })
      .result();
    expect(result.ok).toBe(true);
    expect(result.data).toMatchObject({ parts: { plugins: ['A.jar'] } });
    expect((result.data as { parts: { lastBuildHash?: string } }).parts.lastBuildHash).toBeUndefined();
  });

  it('无 plugins/ 与账本 → ok:true 且 parts 为空对象（不臆造内容）', async () => {
    const dataDir = mkTmp();
    const dir = join(dataDir, 's5');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'server.properties'), 'motd=x\n', 'utf8');
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp5', kind: 'get_context_pack', payload: { serverId: 's5' } })
      .result();
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ target: { edition: 'server', serverId: 's5' }, parts: {} });
  });

  it('缺 serverId → validation（不臆造目标）', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp6', kind: 'get_context_pack', payload: {} })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(result.error?.message).toMatch(/serverId/);
  });

  it('serverId 路径穿越 → validation（不读界外目录）', async () => {
    const dataDir = mkTmp();
    const outside = mkTmp();
    seed(outside, 'victim');
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp7', kind: 'get_context_pack', payload: { serverId: '../outside' } })
      .result();
    expect(result.ok).toBe(false);
    expect(result.error?.category).toBe('validation');
  });

  it('服务端不存在 → validation', async () => {
    const dataDir = mkTmp();
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp8', kind: 'get_context_pack', payload: { serverId: 'ghost' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('未配置 dataDir → validation，不抛裸异常', async () => {
    const result = await new ServerKernel()
      .dispatch({ id: 'cp9', kind: 'get_context_pack', payload: { serverId: 's1' } })
      .result();
    expect(result).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('R 类免确认：不需要 confirm 也返回 ok:true（§10.6 只读免确认）', async () => {
    const dataDir = mkTmp();
    seed(dataDir, 's10', { plugins: ['A.jar'] });
    const result = await new ServerKernel({ dataDir })
      .dispatch({ id: 'cp10', kind: 'get_context_pack', payload: { serverId: 's10' } })
      .result();
    expect(result.ok).toBe(true);
  });
});
