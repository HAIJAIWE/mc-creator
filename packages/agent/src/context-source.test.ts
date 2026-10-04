/**
 * 状态注入接线测试（§10.4）：normalizeContextState 纯函数 +
 * buildContextPackFromKernel 与 MCP 通道 get_context_pack 的端到端行为。
 *
 * 用真实内核（JavaKernel / ServerKernel）+ 真实临时目录，
 * 不 mock 内核：接线的价值就在于「内核事实 → 上下文包」这条链真的通。
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { JavaKernel } from '@mc-creator/kernel-java';
import { ServerKernel } from '@mc-creator/kernel-server';
import {
  buildContextPackFromKernel,
  fetchContextState,
  normalizeContextState,
} from './context-source.js';
import { createMcpServer } from './mcp-server.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mkTmp = (prefix: string): string => {
  const d = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(d);
  return d;
};

/** 造一个带 instance.json + mods/ 的 Java 实例。 */
function seedJava(dataDir: string, id: string, mods: string[]): string {
  const dir = join(dataDir, 'instances', id);
  mkdirSync(join(dir, 'mods'), { recursive: true });
  writeFileSync(
    join(dir, 'instance.json'),
    JSON.stringify({
      name: id,
      edition: 'java',
      versionId: '1.21.1',
      loader: 'neoforge',
      javaPath: 'java',
      requiredJavaMajor: 21,
      createdAt: '2026-10-05T00:00:00.000Z',
    }),
  );
  for (const m of mods) writeFileSync(join(dir, 'mods', m), 'x');
  return dir;
}

describe('normalizeContextState（宽松校验，脏字段不炸）', () => {
  it('结构完整 → 原样保留', () => {
    expect(
      normalizeContextState({
        target: { edition: 'java', instanceId: 'i1', mcVersion: '1.21.1', runtime: 'fabric' },
        parts: { mods: ['a.jar'], plugins: ['b.jar'], lastBuildHash: 'abc', isFolia: false },
      }),
    ).toEqual({
      target: { edition: 'java', instanceId: 'i1', mcVersion: '1.21.1', runtime: 'fabric' },
      parts: { mods: ['a.jar'], plugins: ['b.jar'], lastBuildHash: 'abc', isFolia: false },
    });
  });

  it('非对象 / null / 数组 → 空状态而非抛异常', () => {
    for (const bad of [null, undefined, 42, 'x', [], true]) {
      expect(normalizeContextState(bad)).toEqual({ target: {}, parts: {} });
    }
  });

  it('类型不符的字段被丢弃（数字/布尔不当字符串用）', () => {
    expect(
      normalizeContextState({
        target: { edition: 1, instanceId: 'i1', mcVersion: null },
        parts: { mods: 'not-array', lastBuildHash: 999, isFolia: 'yes' },
      }),
    ).toEqual({ target: { instanceId: 'i1' }, parts: {} });
  });

  it('数组内的非字符串元素被过滤，空数组不下发（不产出空 installed 段）', () => {
    expect(
      normalizeContextState({ parts: { mods: ['a.jar', 1, null, ''], plugins: [] } }).parts,
    ).toEqual({
      mods: ['a.jar'],
    });
  });

  it('空串字段视为缺失（不产出 "": 这样的噪声行）', () => {
    expect(
      normalizeContextState({
        target: { instanceId: '', mcVersion: '1.21' },
        parts: { lastBuildHash: '', lastFailure: 'boom' },
      }),
    ).toEqual({ target: { mcVersion: '1.21' }, parts: { lastFailure: 'boom' } });
  });

  it('isFolia: false 被保留（false 是有意义的硬开关信息，不能当缺失丢掉）', () => {
    expect(normalizeContextState({ parts: { isFolia: false } }).parts.isFolia).toBe(false);
  });
});

describe('fetchContextState（内核事实读取，失败降级不抛）', () => {
  it('Java 实例 → 读到 mcVersion / runtime / mods', async () => {
    const dataDir = mkTmp('ctx-src-java-');
    seedJava(dataDir, 'i1', ['jei.jar', 'notes.txt']);
    const state = await fetchContextState(new JavaKernel({ dataDir }), { instanceId: 'i1' });
    expect(state).not.toBeNull();
    expect(state?.target).toMatchObject({ edition: 'java', instanceId: 'i1', mcVersion: '1.21.1' });
    expect(state?.parts.mods).toEqual(['jei.jar']);
  });

  it('实例不存在 → 返回 null（降级），不抛异常', async () => {
    const dataDir = mkTmp('ctx-src-miss-');
    expect(
      await fetchContextState(new JavaKernel({ dataDir }), { instanceId: 'ghost' }),
    ).toBeNull();
  });

  it('内核 dispatch 抛异常 → 返回 null（生成流程不被状态注入打断）', async () => {
    const broken = {
      edition: 'java',
      capabilities: () => [],
      status: () => ({ edition: 'java', healthy: true, updatedAt: '' }),
      dispatch: () => {
        throw new Error('内核炸了');
      },
    };
    // 结构上满足 KernelContract，但 dispatch 会抛 —— 验证状态注入不被它打断
    expect(
      await fetchContextState(broken as unknown as Parameters<typeof fetchContextState>[0], {
        instanceId: 'i1',
      }),
    ).toBeNull();
  });
});

describe('buildContextPackFromKernel（内核事实 + 调用方补充 → 预算截断包）', () => {
  it('内核事实进入上下文包文本（已装 mod 与版本号可见）', async () => {
    const dataDir = mkTmp('ctx-pack-java-');
    seedJava(dataDir, 'i1', ['jei.jar', 'fabric-api.jar']);
    const { pack, fromKernel } = await buildContextPackFromKernel(new JavaKernel({ dataDir }), {
      target: { instanceId: 'i1' },
    });
    expect(fromKernel).toBe(true);
    expect(pack.text).toContain('installed_mods: fabric-api.jar, jei.jar');
    expect(pack.text).toContain('mc_version: 1.21.1');
    expect(pack.text).toContain('runtime: neoforge');
  });

  it('服务端：已装插件 + 上次部署哈希 + 配置摘要进尾部段', async () => {
    const dataDir = mkTmp('ctx-pack-server-');
    const dir = join(dataDir, 'srv1');
    mkdirSync(join(dir, 'plugins', '.deployed'), { recursive: true });
    writeFileSync(join(dir, 'server.properties'), 'server-port=25577\ngamemode=creative\n');
    writeFileSync(join(dir, 'plugins', 'Core.jar'), 'x');
    writeFileSync(
      join(dir, 'plugins', '.deployed', 'Core.jar.json'),
      JSON.stringify({ jar: 'Core.jar', sha256: 'c'.repeat(64) }),
    );
    const { pack } = await buildContextPackFromKernel(new ServerKernel({ dataDir }), {
      target: { serverId: 'srv1', edition: 'server' },
    });
    expect(pack.text).toContain('installed_plugins: Core.jar');
    expect(pack.text).toContain(`last_build_hash: ${'c'.repeat(64)}`);
    expect(pack.text).toContain('server-port=25577');
    expect(pack.text).toContain('## server_config');
  });

  it('调用方 lastFailure 覆盖并出现在头部（§10.3 回灌修复）', async () => {
    const dataDir = mkTmp('ctx-pack-fail-');
    seedJava(dataDir, 'i1', ['a.jar']);
    const { pack } = await buildContextPackFromKernel(new JavaKernel({ dataDir }), {
      target: { instanceId: 'i1' },
      lastFailure: 'NullPointerException at ModInit',
    });
    expect(pack.text).toContain('last_failure: NullPointerException at ModInit');
  });

  it('调用方 target 覆盖内核返回值（调用方知道刚做了什么）', async () => {
    const dataDir = mkTmp('ctx-pack-override-');
    seedJava(dataDir, 'i1', ['a.jar']);
    const { pack } = await buildContextPackFromKernel(new JavaKernel({ dataDir }), {
      target: { instanceId: 'i1', mcVersion: '1.20.4' },
    });
    expect(pack.text).toContain('mc_version: 1.20.4');
    expect(pack.text).not.toContain('mc_version: 1.21.1');
  });

  it('内核读不到 → fromKernel=false，但仍产出可用包（降级不阻断生成）', async () => {
    const dataDir = mkTmp('ctx-pack-degrade-');
    const { pack, fromKernel } = await buildContextPackFromKernel(new JavaKernel({ dataDir }), {
      target: { instanceId: 'ghost', edition: 'java' },
    });
    expect(fromKernel).toBe(false);
    expect(pack.text).toContain('edition: java');
    expect(pack.text).toContain('instance: ghost');
  });

  it('预算截断生效且恒 text.length <= budget（§10.4 硬约束）', async () => {
    const dataDir = mkTmp('ctx-pack-budget-');
    const many = Array.from({ length: 200 }, (_, i) => `mod-number-${i}.jar`);
    seedJava(dataDir, 'i1', many);
    const { pack } = await buildContextPackFromKernel(new JavaKernel({ dataDir }), {
      target: { instanceId: 'i1' },
      extra: 'x'.repeat(5000),
      budgetChars: 600,
    });
    expect(pack.text.length).toBeLessThanOrEqual(600);
    expect(pack.truncated).toBe(true);
    // 头部 targeting 信息永远保留（这是 §10.4 截断策略的核心）。
    expect(pack.text).toContain('instance: i1');
  });
});

describe('MCP 通道 get_context_pack 端到端（§10.4 + §10.6 只读免确认）', () => {
  it('给 serverId → 改道 server 内核并返回拼装好的上下文包', async () => {
    const dataDir = mkTmp('ctx-mcp-server-');
    const dir = join(dataDir, 'srv1');
    mkdirSync(join(dir, 'plugins'), { recursive: true });
    writeFileSync(join(dir, 'server.properties'), 'server-port=25577\n');
    writeFileSync(join(dir, 'plugins', 'Core.jar'), 'x');
    const server = createMcpServer({ server: { dataDir } });
    const out = await server.callTool('get_context_pack', { serverId: 'srv1' });
    expect(out.isError).toBeUndefined();
    expect(out.content[0]?.text).toContain('installed_plugins: Core.jar');
    const sc = out.structuredContent as { contextPack?: { text?: string } };
    expect(sc.contextPack?.text).toContain('server: srv1');
  });

  it('给 instanceId → 改道 java 内核并返回已装 mod', async () => {
    const dataDir = mkTmp('ctx-mcp-java-');
    seedJava(dataDir, 'i1', ['jei.jar']);
    const server = createMcpServer({ java: { dataDir } });
    const out = await server.callTool('get_context_pack', { instanceId: 'i1' });
    expect(out.isError).toBeUndefined();
    expect(out.content[0]?.text).toContain('installed_mods: jei.jar');
  });

  it('显式 edition=java 覆盖改道推断', async () => {
    const dataDir = mkTmp('ctx-mcp-edition-');
    seedJava(dataDir, 'i1', ['jei.jar']);
    const server = createMcpServer({ java: { dataDir } });
    const out = await server.callTool('get_context_pack', {
      serverId: 'anything',
      edition: 'java',
      instanceId: 'i1',
    });
    expect(out.isError).toBeUndefined();
    expect(out.content[0]?.text).toContain('installed_mods: jei.jar');
  });

  it('附带 lastFailure / apiTypes / extra → 进包（尾部段按优先级截断）', async () => {
    const dataDir = mkTmp('ctx-mcp-extra-');
    seedJava(dataDir, 'i1', ['jei.jar']);
    const server = createMcpServer({ java: { dataDir } });
    const out = await server.callTool('get_context_pack', {
      instanceId: 'i1',
      lastFailure: 'ClassNotFoundException',
      apiTypes: 'interface IMod {}',
      extra: '调用方备注',
    });
    expect(out.content[0]?.text).toContain('last_failure: ClassNotFoundException');
    expect(out.content[0]?.text).toContain('## api_types');
    expect(out.content[0]?.text).toContain('## extra');
  });

  it('R 类：不需要任何确认即返回（§10.6 只读免确认）', async () => {
    const dataDir = mkTmp('ctx-mcp-noconfirm-');
    seedJava(dataDir, 'i1', ['jei.jar']);
    // createMcpServer 不接受 confirm（内核构造 ctx 里也没传）：
    // 若内核把 get_context_pack 当 W/X 处理，这里必然拿到 permission 拒绝。
    const server = createMcpServer({ java: { dataDir } });
    const out = await server.callTool('get_context_pack', { instanceId: 'i1' });
    expect(out.isError).toBeUndefined();
    expect(out.content[0]?.text).not.toMatch(/须弹窗确认/);
  });

  it('目标不存在 → 透传内核的 validation 错误（isError + 原因可读）', async () => {
    const dataDir = mkTmp('ctx-mcp-missing-');
    const server = createMcpServer({ java: { dataDir } });
    const out = await server.callTool('get_context_pack', { instanceId: 'ghost' });
    expect(out.isError).toBe(true);
    const sc = out.structuredContent as { error?: { category?: string } };
    expect(sc.error?.category).toBe('validation');
  });
});
