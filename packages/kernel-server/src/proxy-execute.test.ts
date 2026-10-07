/**
 * 代理层内核任务测试（§7.2 Velocity / BungeeCord / Waterfall）。
 *
 * 覆盖要点：
 * 1. create 落盘的是**代理真读的配置文件**（velocity.toml / config.yml），
 *    且包含 §7.2 的多子服路由表；不是自造的 config.json。
 * 2. 未确认 → 拒绝且零副作用（与既有 X 级任务同口径，§10.6）。
 * 3. 校验失败（无路由表 / 地址非法 / 重名）→ validation，且不留下半成品目录。
 * 4. 读配置 / 改配置走「解析 → 受限补丁 → 复校验 → 原子重写」；
 *    配置文件被手改坏时读/改都报 validation，不做乐观回退。
 * 5. list 里单个代理配置坏掉不影响其余代理（标 parseError）。
 * 6. delete 对不存在的代理报错，不静默成功。
 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { TaskResult } from '@mc-creator/contract';
import { ServerKernel } from './kernel.js';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function mkTmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'mc-proxy-'));
  dirs.push(d);
  return d;
}

const YES = async () => true;
const NO = async () => false;

const BACKENDS = [
  { name: 'lobby', address: '127.0.0.1:30066' },
  { name: 'survival', address: '127.0.0.1:30067' },
];

function run(dataDir: string, kind: string, payload: unknown, confirm?: () => Promise<boolean>) {
  return new ServerKernel({ dataDir, ...(confirm === undefined ? {} : { confirm }) })
    .dispatch({ id: `p-${kind}`, kind, payload })
    .result() as Promise<TaskResult>;
}

/** 失败结果的错误文案（成功时抛，避免测试只看 category 而漏掉文案回归）。 */
function errText(result: TaskResult): string {
  if (result.ok) throw new Error('期望失败但成功：' + JSON.stringify(result.data));
  return result.error?.message ?? '';
}

function createPayload(over: Record<string, unknown> = {}) {
  return { proxyId: 'px1', proxyType: 'velocity', backends: BACKENDS, ...over };
}

describe('§7.2 create_proxy_server：落盘真配置', () => {
  it('velocity 落 velocity.toml（TOML），含 [servers] 与顶层 try', async () => {
    const dataDir = mkTmp();
    const r = await run(dataDir, 'create_proxy_server', createPayload(), YES);
    expect(r.ok).toBe(true);
    const dir = join(dataDir, 'proxies', 'px1');
    const tomlPath = join(dir, 'velocity.toml');
    expect(existsSync(tomlPath)).toBe(true);
    // 关键回归：上一版实现写的 config.json 三个键都不是真实键，Velocity 根本不读。
    expect(existsSync(join(dir, 'config.json'))).toBe(false);
    const toml = readFileSync(tomlPath, 'utf8');
    expect(toml).toMatch(/^bind = "0\.0\.0\.0:25577"$/m);
    expect(toml).toMatch(/^lobby = "127\.0\.0\.1:30066"$/m);
    expect(toml).toContain('try = ["lobby", "survival"]');
  });

  it('bungeecord / waterfall 落 config.yml（YAML），路由在 listeners[].priorities', async () => {
    const dataDir = mkTmp();
    for (const t of ['bungeecord', 'waterfall'] as const) {
      const proxyId = `px-${t}`;
      const r = await run(
        dataDir,
        'create_proxy_server',
        createPayload({ proxyId, proxyType: t }),
        YES,
      );
      expect(r.ok, t).toBe(true);
      const dir = join(dataDir, 'proxies', proxyId);
      expect(existsSync(join(dir, 'config.yml'))).toBe(true);
      expect(existsSync(join(dir, 'velocity.toml'))).toBe(false);
      const yaml = readFileSync(join(dir, 'config.yml'), 'utf8');
      expect(yaml).toContain('online_mode: true');
      expect(yaml).toMatch(/priorities:\n {6}- lobby/);
    }
  });

  it('servers 映射写法（对齐 BungeeCord 形状）也能建出路由表', async () => {
    const dataDir = mkTmp();
    const r = await run(
      dataDir,
      'create_proxy_server',
      createPayload({ backends: undefined, servers: { lobby: '127.0.0.1:30066' } }),
      YES,
    );
    expect(r.ok).toBe(true);
    const toml = readFileSync(join(dataDir, 'proxies', 'px1', 'velocity.toml'), 'utf8');
    expect(toml).toContain('lobby = "127.0.0.1:30066"');
  });

  it('offline 模式 Velocity 转发模式退回 none（否则等不到转发握手）', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload({ onlineMode: false }), YES);
    const toml = readFileSync(join(dataDir, 'proxies', 'px1', 'velocity.toml'), 'utf8');
    expect(toml).toContain('player-info-forwarding-mode = "none"');
  });

  it('未确认 → 拒绝且零副作用', async () => {
    const dataDir = mkTmp();
    const r = await run(dataDir, 'create_proxy_server', createPayload(), NO);
    expect(r).toMatchObject({ ok: false, error: { category: 'permission' } });
    expect(existsSync(join(dataDir, 'proxies', 'px1'))).toBe(false);
  });

  it('未传 confirm → permission，且不建目录', async () => {
    const dataDir = mkTmp();
    const r = await run(dataDir, 'create_proxy_server', createPayload());
    expect(r).toMatchObject({ ok: false, error: { category: 'permission' } });
    expect(existsSync(join(dataDir, 'proxies'))).toBe(false);
  });
});

describe('§7.2 create 校验失败：不留半成品', () => {
  it('无后端（代理层无路由表就失去意义）→ validation 且目录未创建', async () => {
    const dataDir = mkTmp();
    const r = await run(dataDir, 'create_proxy_server', createPayload({ backends: [] }), YES);
    expect(r).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(errText(r)).toContain('至少需要一个后端子服');
    expect(existsSync(join(dataDir, 'proxies', 'px1'))).toBe(false);
  });

  it('后端地址非法 → validation', async () => {
    const dataDir = mkTmp();
    const r = await run(
      dataDir,
      'create_proxy_server',
      createPayload({ backends: [{ name: 'lobby', address: '127.0.0.1' }] }),
      YES,
    );
    expect(r).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(existsSync(join(dataDir, 'proxies', 'px1'))).toBe(false);
  });

  it('路由名重复 → validation', async () => {
    const dataDir = mkTmp();
    const r = await run(
      dataDir,
      'create_proxy_server',
      createPayload({
        backends: [
          { name: 'lobby', address: '127.0.0.1:1' },
          { name: 'lobby', address: '127.0.0.1:2' },
        ],
      }),
      YES,
    );
    expect(errText(r)).toContain('重复');
  });

  it('未知代理类型 → validation 并列出三种合法值', async () => {
    const dataDir = mkTmp();
    const r = await run(
      dataDir,
      'create_proxy_server',
      createPayload({ proxyType: 'bungee' }),
      YES,
    );
    expect(errText(r)).toContain('velocity / bungeecord / waterfall');
  });

  it('重名代理 → validation', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const again = await run(dataDir, 'create_proxy_server', createPayload(), YES);
    expect(errText(again)).toContain('已存在');
  });

  it('proxyId 含路径穿越 → validation 且外部目录未被创建', async () => {
    const dataDir = mkTmp();
    const r = await run(
      dataDir,
      'create_proxy_server',
      createPayload({ proxyId: '../escape' }),
      YES,
    );
    expect(r).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(existsSync(join(dataDir, 'escape'))).toBe(false);
  });
});

describe('§7.2 get/set_proxy_server_config', () => {
  it('读回渲染出的配置（raw 与结构化视图都在）', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const r = await run(dataDir, 'get_proxy_server_config', { proxyId: 'px1' }, YES);
    expect(r.ok).toBe(true);
    const d = r.data as {
      configFile: string;
      raw: string;
      config: { bind: string; backends: { name: string }[]; tryOrder: string[] };
    };
    expect(d.configFile).toBe('velocity.toml');
    expect(d.raw).toContain('bind = "0.0.0.0:25577"');
    expect(d.config.backends.map((b) => b.name)).toEqual(['lobby', 'survival']);
    expect(d.config.tryOrder).toEqual(['lobby', 'survival']);
  });

  it('patch 改字段后磁盘与视图一致', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const r = await run(
      dataDir,
      'set_proxy_server_config',
      { proxyId: 'px1', patch: { motd: '&cnew', maxPlayers: 42 } },
      YES,
    );
    expect(r.ok).toBe(true);
    const toml = readFileSync(join(dataDir, 'proxies', 'px1', 'velocity.toml'), 'utf8');
    expect(toml).toContain('motd = "&cnew"');
    expect(toml).toContain('show-max-players = 42');
    // 未提及的字段保留
    expect(toml).toContain('online-mode = true');
  });

  it('patch 增删后端可用（改路由表是代理层的主要用途）', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    await run(
      dataDir,
      'set_proxy_server_config',
      {
        proxyId: 'px1',
        patch: {
          backends: [{ name: 'pvp', address: '127.0.0.1:30070' }],
          tryOrder: ['pvp'],
        },
      },
      YES,
    );
    const toml = readFileSync(join(dataDir, 'proxies', 'px1', 'velocity.toml'), 'utf8');
    expect(toml).toContain('pvp = "127.0.0.1:30070"');
    expect(toml).not.toContain('lobby =');
    expect(toml).toContain('try = ["pvp"]');
  });

  it('patch 含 type → validation（换类型等于换格式，须走 create）', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const r = await run(
      dataDir,
      'set_proxy_server_config',
      { proxyId: 'px1', patch: { type: 'bungeecord' } },
      YES,
    );
    expect(errText(r)).toContain('type');
  });

  it('非法 patch（后端地址坏）→ validation 且磁盘不被写坏', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const before = readFileSync(join(dataDir, 'proxies', 'px1', 'velocity.toml'), 'utf8');
    const r = await run(
      dataDir,
      'set_proxy_server_config',
      { proxyId: 'px1', patch: { backends: [{ name: 'x', address: 'no-port' }] } },
      YES,
    );
    expect(r).toMatchObject({ ok: false, error: { category: 'validation' } });
    expect(readFileSync(join(dataDir, 'proxies', 'px1', 'velocity.toml'), 'utf8')).toBe(before);
  });

  it('空 patch → validation', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const r = await run(dataDir, 'set_proxy_server_config', { proxyId: 'px1', patch: {} }, YES);
    expect(r).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('配置文件被手改坏 → 读/改都 validation，不做乐观回退', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const path = join(dataDir, 'proxies', 'px1', 'velocity.toml');
    writeFileSync(path, '[servers\nlobby = ', 'utf8');
    const g = await run(dataDir, 'get_proxy_server_config', { proxyId: 'px1' }, YES);
    expect(g).toMatchObject({ ok: false, error: { category: 'validation' } });
    const s = await run(
      dataDir,
      'set_proxy_server_config',
      { proxyId: 'px1', patch: { motd: 'x' } },
      YES,
    );
    expect(s).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('不存在的代理 → validation', async () => {
    const dataDir = mkTmp();
    const r = await run(dataDir, 'get_proxy_server_config', { proxyId: 'ghost' }, YES);
    expect(errText(r)).toContain('不存在');
  });
});

describe('§7.2 list / start / stop / restart / delete', () => {
  it('list 返回每个代理的真实配置摘要；单个配置坏掉只标 parseError', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    await run(
      dataDir,
      'create_proxy_server',
      createPayload({ proxyId: 'px2', proxyType: 'bungeecord' }),
      YES,
    );
    writeFileSync(join(dataDir, 'proxies', 'px2', 'config.yml'), 'listeners: [ oops\n', 'utf8');

    const r = await run(dataDir, 'list_proxy_servers', {}, YES);
    expect(r.ok).toBe(true);
    const { proxies } = r.data as {
      proxies: { proxyId: string; proxyType?: string; parseError?: string; backends?: unknown[] }[];
    };
    expect(proxies.map((p) => p.proxyId)).toEqual(['px1', 'px2']);
    const px1 = proxies.find((p) => p.proxyId === 'px1');
    expect(px1?.proxyType).toBe('velocity');
    expect(px1?.parseError).toBeUndefined();
    expect(px1?.backends).toHaveLength(2);
    const px2 = proxies.find((p) => p.proxyId === 'px2');
    expect(px2?.proxyType).toBe('bungeecord');
    expect(px2?.parseError).toBeTruthy();
  });

  it('list 在无代理时返回空数组而非报错', async () => {
    const r = await run(mkTmp(), 'list_proxy_servers', {}, YES);
    expect(r.ok).toBe(true);
    expect((r.data as { proxies: unknown[] }).proxies).toEqual([]);
  });

  it('start 校验配置可解析并回传路由；无后端 → validation', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const ok = await run(dataDir, 'start_proxy_server', { proxyId: 'px1' }, YES);
    expect(ok.ok).toBe(true);
    const d = ok.data as { backends: unknown[]; tryOrder: string[] };
    expect(d.backends).toHaveLength(2);
    expect(d.tryOrder).toEqual(['lobby', 'survival']);

    // 手删后端 → 代理没有路由表，启动必然无意义
    const dir = join(dataDir, 'proxies', 'px1');
    rmSync(join(dir, 'velocity.toml'));
    writeFileSync(
      join(dir, 'velocity.toml'),
      ['bind = "0.0.0.0:25577"', 'motd = "x"', 'try = []', '[servers]', ''].join('\n'),
      'utf8',
    );
    const bad = await run(dataDir, 'start_proxy_server', { proxyId: 'px1' }, YES);
    expect(errText(bad)).toContain('未声明任何后端子服');
  });

  it('start 缺元信息文件 → validation（不乐观猜类型）', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    rmSync(join(dataDir, 'proxies', 'px1', '.proxy.json'));
    const r = await run(dataDir, 'start_proxy_server', { proxyId: 'px1' }, YES);
    expect(errText(r)).toContain('.proxy.json');
  });

  it('stop 校验存在性并返回控制指令（不 spawn 进程）', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const r = await run(dataDir, 'stop_proxy_server', { proxyId: 'px1' }, YES);
    expect(r.ok).toBe(true);
    expect((r.data as { controlCommand: string }).controlCommand).toBe('shutdown');
  });

  it('stop 对不存在的代理报错', async () => {
    const r = await run(mkTmp(), 'stop_proxy_server', { proxyId: 'ghost' }, YES);
    expect(errText(r)).toContain('不存在');
  });

  it('restart 走 stop→start 语义，仍返回控制指令', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const r = await run(dataDir, 'restart_proxy_server', { proxyId: 'px1' }, YES);
    expect(r.ok).toBe(true);
    expect((r.data as { proxyType: string }).proxyType).toBe('velocity');
  });

  it('delete 真删目录；对不存在的代理报错（不静默成功）', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    expect(existsSync(join(dataDir, 'proxies', 'px1'))).toBe(true);
    const d = await run(dataDir, 'delete_proxy_server', { proxyId: 'px1' }, YES);
    expect(d.ok).toBe(true);
    expect(existsSync(join(dataDir, 'proxies', 'px1'))).toBe(false);
    const again = await run(dataDir, 'delete_proxy_server', { proxyId: 'px1' }, YES);
    expect(again).toMatchObject({ ok: false, error: { category: 'validation' } });
  });

  it('X 级：未确认的写/启停一律拒绝且零副作用', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    for (const kind of ['start_proxy_server', 'stop_proxy_server', 'delete_proxy_server']) {
      const r = await run(dataDir, kind, { proxyId: 'px1' }, NO);
      expect(r, kind).toMatchObject({ ok: false, error: { category: 'permission' } });
    }
    expect(existsSync(join(dataDir, 'proxies', 'px1'))).toBe(true);
  });
});

describe('§7.2 proxyId 兼容 serverId 字段', () => {
  it('serverId 也能定位代理（前端 IPC schema 用 serverId 传 id）', async () => {
    const dataDir = mkTmp();
    await run(dataDir, 'create_proxy_server', createPayload(), YES);
    const r = await run(dataDir, 'get_proxy_server_config', { serverId: 'px1' }, YES);
    expect(r.ok).toBe(true);
  });

  it('proxyId 含路径穿越时不会逃出根目录', async () => {
    const dataDir = mkTmp();
    mkdirSync(join(dataDir, 'outside'), { recursive: true });
    const r = await run(dataDir, 'get_proxy_server_config', { proxyId: '../outside' }, YES);
    expect(r.ok).toBe(false);
  });
});
