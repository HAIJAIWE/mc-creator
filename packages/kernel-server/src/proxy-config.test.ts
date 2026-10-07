/**
 * 代理层配置格式测试（§7.2）。
 *
 * 核心断言是**「键名必须是代理真读的键」**——本仓曾用过自造的
 * `config.json`（`proxyType`/`port`/`bindAddress`），那些键三个都不是真实格式。
 * 所以这里对渲染产物做的是「键名快照」，并用变异测试钉住：
 * 一旦有人改回自造键或改错文件名，本文件必须红。
 *
 * 出处（不是记忆）：
 * - Velocity：https://docs.papermc.io/velocity/configuration
 * - BungeeCord：https://www.spigotmc.org/wiki/bungeecord-configuration-guide/
 */
import { describe, expect, it } from 'vitest';
import {
  PROXY_TYPES,
  ProxyConfigParseError,
  applyProxyConfigPatch,
  isProxyType,
  parseAddress,
  parseProxyConfig,
  proxyConfigFileName,
  renderBungeeYaml,
  renderProxyConfig,
  renderVelocityToml,
  validateProxySpec,
  type ProxyConfigSpec,
} from './proxy-config.js';

const SPEC: ProxyConfigSpec = {
  type: 'velocity',
  bind: '0.0.0.0:25577',
  motd: '&aMy &lProxy',
  maxPlayers: 500,
  onlineMode: true,
  backends: [
    { name: 'lobby', address: '127.0.0.1:30066' },
    { name: 'survival', address: '127.0.0.1:30067' },
  ],
};

describe('代理类型与配置文件名（§7.2 三形态）', () => {
  it('恰有 velocity / bungeecord / waterfall 三种', () => {
    expect([...PROXY_TYPES]).toEqual(['velocity', 'bungeecord', 'waterfall']);
  });

  it('velocity 读 velocity.toml，bungee/waterfall 读 config.yml（文件名不能互换）', () => {
    expect(proxyConfigFileName('velocity')).toBe('velocity.toml');
    expect(proxyConfigFileName('bungeecord')).toBe('config.yml');
    expect(proxyConfigFileName('waterfall')).toBe('config.yml');
  });

  it('未知类型不误判为合法', () => {
    expect(isProxyType('velocity')).toBe(true);
    expect(isProxyType('waterfall')).toBe(true);
    expect(isProxyType('Velocity')).toBe(false);
    expect(isProxyType('bungee')).toBe(false);
    expect(isProxyType(undefined)).toBe(false);
    expect(isProxyType(1)).toBe(false);
  });
});

describe('地址解析：host:port / 端口边界', () => {
  it('IPv4、域名、[IPv6] 字面量均可', () => {
    expect(parseAddress('127.0.0.1:25565')).toEqual({ host: '127.0.0.1', port: 25565 });
    expect(parseAddress('srv.example.com:1')).toEqual({ host: 'srv.example.com', port: 1 });
    expect(parseAddress('[::1]:25577')).toEqual({ host: '::1', port: 25577 });
  });

  it('端口越界/缺端口/带空格一律拒绝', () => {
    expect(parseAddress('127.0.0.1:0')).toBeUndefined();
    expect(parseAddress('127.0.0.1:65536')).toBeUndefined();
    expect(parseAddress('127.0.0.1')).toBeUndefined();
    expect(parseAddress(':25565')).toBeUndefined();
    expect(parseAddress('a b:25565')).toBeUndefined();
  });
});

describe('生成前校验：§7.2 代理层必须有路由表', () => {
  it('合法 spec 无错误', () => {
    expect(validateProxySpec(SPEC)).toEqual([]);
  });

  it('空后端表被拒——代理层的职责是「处理多子服路由」', () => {
    const errs = validateProxySpec({ ...SPEC, backends: [] });
    expect(errs.some((e) => e.includes('至少需要一个后端子服'))).toBe(true);
  });

  it('路由顺序引用未声明子服被拒', () => {
    const errs = validateProxySpec({ ...SPEC, tryOrder: ['lobby', 'ghost'] });
    expect(errs.some((e) => e.includes('ghost'))).toBe(true);
  });

  it('重名 / 同地址两路由名 / 非法路由名 / 空 try 各被拒', () => {
    expect(
      validateProxySpec({
        ...SPEC,
        backends: [
          { name: 'lobby', address: '1.1.1.1:1' },
          { name: 'lobby', address: '1.1.1.1:2' },
        ],
      }).some((e) => e.includes('重复')),
    ).toBe(true);
    expect(
      validateProxySpec({
        ...SPEC,
        backends: [
          { name: 'a', address: '1.1.1.1:1' },
          { name: 'b', address: '1.1.1.1:1' },
        ],
      }).some((e) => e.includes('同一地址')),
    ).toBe(true);
    expect(
      validateProxySpec({ ...SPEC, backends: [{ name: 'bad name', address: '1.1.1.1:1' }] }).some(
        (e) => e.includes('路由名非法'),
      ),
    ).toBe(true);
    expect(validateProxySpec({ ...SPEC, tryOrder: [] }).some((e) => e.includes('不得为空'))).toBe(
      true,
    );
  });

  it('motd 空 / maxPlayers 非法 / bind 非法各被拒，且一次返回全部问题', () => {
    const errs = validateProxySpec({ ...SPEC, motd: '  ', maxPlayers: -1, bind: 'nope' });
    expect(errs).toHaveLength(3);
  });
});

describe('velocity.toml 键名快照（官方 docs.papermc.io）', () => {
  const toml = renderVelocityToml(SPEC);

  it('顶层键是官方 root section 的真实键', () => {
    expect(toml).toContain('config-version = "2.7"');
    expect(toml).toMatch(/^bind = "0\.0\.0\.0:25577"$/m);
    expect(toml).toContain('show-max-players = 500');
    expect(toml).toContain('online-mode = true');
    expect(toml).toContain('player-info-forwarding-mode = "modern"');
    expect(toml).toContain('forwarding-secret-file = "forwarding.secret"');
  });

  it('是 TOML 不是 YAML：绝不出现 yaml 的冒号映射写法', () => {
    expect(toml).toContain('[servers]');
    expect(toml).toContain('[advanced]');
    expect(toml).not.toContain('servers:\n');
    expect(toml).not.toMatch(/^\s*address:/m);
  });

  it('[servers] 段是 name = "host:port" 直写', () => {
    expect(toml).toMatch(/^lobby = "127\.0\.0\.1:30066"$/m);
    expect(toml).toMatch(/^survival = "127\.0\.0\.1:30067"$/m);
  });

  it('顶层 try 是字符串数组且顺序可路由', () => {
    expect(toml).toContain('try = ["lobby", "survival"]');
  });

  it('`try` 必须落在 [servers] 段之前（TOML 段内裸键归属该段）', () => {
    const tryAt = toml.indexOf('\ntry = ');
    const serversAt = toml.indexOf('\n[servers]');
    expect(tryAt).toBeGreaterThan(-1);
    expect(serversAt).toBeGreaterThan(-1);
    // 变异钉：try 挪到 [servers] 之后会成为 servers.try（一个假后端），本断言必须红。
    expect(tryAt).toBeLessThan(serversAt);
    // 往返也会露馅——多出一个名为 try 的后端。
    expect(parseProxyConfig('velocity', toml).backends.map((b) => b.name)).not.toContain('try');
  });

  it('offline 模式退回 forwarding none（否则等不到转发握手）', () => {
    const t = renderVelocityToml({ ...SPEC, onlineMode: false });
    expect(t).toContain('player-info-forwarding-mode = "none"');
  });

  it('motd 含引号/反斜杠时按 TOML 基本字符串转义，且能原样解析回来', () => {
    const motd = 'he said "hi"\\bye';
    const t = renderVelocityToml({ ...SPEC, motd });
    // 转义形态：引号与反斜杠都被反斜杠转义。
    expect(t).toContain('motd = ' + JSON.stringify(motd));
    expect(t).not.toContain('motd = "he said "hi"');
    // 真正的判据是往返无损。
    expect(parseProxyConfig('velocity', t).motd).toBe(motd);
  });
});

describe('config.yml 键名快照（官方 spigotmc wiki）', () => {
  const yaml = renderBungeeYaml(SPEC);

  it('顶层键是官方默认 config.yml 的真实键', () => {
    expect(yaml).toContain('online_mode: true');
    expect(yaml).toContain('ip_forward: true');
    expect(yaml).toContain('player_limit: -1');
    expect(yaml).toContain('server_connect_timeout: 5000');
    expect(yaml).toContain('remote_ping_cache: -1');
    expect(yaml).toContain('connection_throttle: 4000');
    expect(yaml).toContain('network_compression_threshold: 256');
  });

  it('servers.<name> 是带 address 的映射（不是字符串）', () => {
    expect(yaml).toMatch(
      /servers:\n {2}lobby:\n {4}address: 127\.0\.0\.1:30066\n {4}restricted: false/,
    );
  });

  it('路由顺序在 listeners[].priorities（BungeeCord 不是顶层 try）', () => {
    expect(yaml).toMatch(/listeners:\n[\s\S]*priorities:\n {6}- lobby\n {6}- survival/);
    expect(yaml).not.toMatch(/^try:/m);
  });

  it('监听地址/人数/motd 在 listeners 条目里，不在顶层', () => {
    expect(yaml).toMatch(/host: 0\.0\.0\.0:25577/);
    expect(yaml).toMatch(/max_players: 500/);
    expect(yaml).not.toMatch(/^host:/m);
    expect(yaml).not.toMatch(/^motd:/m);
  });

  it('offline 模式 ip_forward 与 online_mode 同步落 false', () => {
    const y = renderBungeeYaml({ ...SPEC, onlineMode: false });
    expect(y).toContain('online_mode: false');
    expect(y).toContain('ip_forward: false');
  });

  it('waterfall 复用同一 config.yml 渲染路径', () => {
    expect(renderProxyConfig({ ...SPEC, type: 'waterfall' })).toBe(
      renderBungeeYaml({ ...SPEC, type: 'waterfall' }),
    );
  });
});

describe('解析往返：三种格式都必须是无损的', () => {
  it('velocity 往返保真', () => {
    const view = parseProxyConfig('velocity', renderVelocityToml(SPEC));
    expect(view.bind).toBe('0.0.0.0:25577');
    expect(view.motd).toBe('&aMy &lProxy');
    expect(view.maxPlayers).toBe(500);
    expect(view.onlineMode).toBe(true);
    expect(view.backends).toEqual([
      { name: 'lobby', address: '127.0.0.1:30066' },
      { name: 'survival', address: '127.0.0.1:30067' },
    ]);
    expect(view.tryOrder).toEqual(['lobby', 'survival']);
  });

  it('bungeecord 往返保真', () => {
    const view = parseProxyConfig('bungeecord', renderBungeeYaml(SPEC));
    expect(view.bind).toBe('0.0.0.0:25577');
    expect(view.motd).toBe('&aMy &lProxy');
    expect(view.maxPlayers).toBe(500);
    expect(view.onlineMode).toBe(true);
    expect(view.backends).toEqual([
      { name: 'lobby', address: '127.0.0.1:30066' },
      { name: 'survival', address: '127.0.0.1:30067' },
    ]);
    expect(view.tryOrder).toEqual(['lobby', 'survival']);
  });

  it('waterfall 往返保真（同 config.yml）', () => {
    const view = parseProxyConfig('waterfall', renderBungeeYaml({ ...SPEC, type: 'waterfall' }));
    expect(view.backends).toHaveLength(2);
    expect(view.tryOrder).toEqual(['lobby', 'survival']);
  });
});

describe('解析真实上游默认配置（不是我方生成物）', () => {
  it('BungeeCord 官方 wiki 默认 config.yml 的 servers/listeners 能读出', () => {
    // 摘自 https://www.spigotmc.org/wiki/bungeecord-configuration-guide/ 的默认配置。
    const upstream = [
      'servers:',
      '  lobby:',
      "    motd: '&1Just another BungeeCord - Forced Host'",
      '    address: localhost:25565',
      '    restricted: false',
      'listeners:',
      '- query_port: 25577',
      "  motd: '&1Another Bungee server'",
      '  tab_list: GLOBAL_PING',
      '  priorities:',
      '  - lobby',
      '  host: 0.0.0.0:25577',
      '  max_players: 1',
      '  force_default_server: false',
      'online_mode: true',
      '',
    ].join('\n');
    const view = parseProxyConfig('bungeecord', upstream);
    expect(view.bind).toBe('0.0.0.0:25577');
    expect(view.motd).toBe('&1Another Bungee server');
    expect(view.maxPlayers).toBe(1);
    expect(view.onlineMode).toBe(true);
    expect(view.backends).toEqual([{ name: 'lobby', address: 'localhost:25565' }]);
    expect(view.tryOrder).toEqual(['lobby']);
  });

  it('Velocity 官方默认 velocity.toml 的关键键能读出（[advanced]/[query] 被跳过而非报错）', () => {
    const upstream = [
      'config-version = "2.7"',
      'bind = "0.0.0.0:25577"',
      'motd = "&3A Velocity Server"',
      'show-max-players = 500',
      'online-mode = true',
      'player-info-forwarding-mode = "modern"',
      '',
      '[advanced]',
      'compression-threshold = 256',
      'login-ratelimit = 3000',
      '',
      '[query]',
      'enabled = false',
      'port = 25577',
      '',
      '[servers]',
      'lobby = "127.0.0.1:30066"',
      'factions = "127.0.0.1:30067"',
      '',
      'try = [',
      '    "lobby"',
      ']',
      '',
    ].join('\n');
    const view = parseProxyConfig('velocity', upstream);
    expect(view.bind).toBe('0.0.0.0:25577');
    expect(view.motd).toBe('&3A Velocity Server');
    expect(view.maxPlayers).toBe(500);
    expect(view.backends).toEqual([
      { name: 'lobby', address: '127.0.0.1:30066' },
      { name: 'factions', address: '127.0.0.1:30067' },
    ]);
    expect(view.tryOrder).toEqual(['lobby']);
  });

  it('多行 try 数组也能读出', () => {
    const view = parseProxyConfig(
      'velocity',
      ['[servers]', 'a = "1.1.1.1:1"', 'b = "1.1.1.1:2"', '', 'try = ["a", "b"]', ''].join('\n'),
    );
    expect(view.tryOrder).toEqual(['a', 'b']);
  });
});

describe('解析失败必须抛（不做乐观回退，MEMORY §10-9）', () => {
  it('YAML 语法坏 → ProxyConfigParseError', () => {
    expect(() => parseProxyConfig('bungeecord', 'listeners:\n  - host: [oops\n')).toThrow(
      ProxyConfigParseError,
    );
  });

  it('YAML 顶层不是映射 → ProxyConfigParseError', () => {
    expect(() => parseProxyConfig('bungeecord', '- a\n- b\n')).toThrow(ProxyConfigParseError);
  });

  it('TOML 段名未闭合 / 行内无 = → ProxyConfigParseError', () => {
    expect(() => parseProxyConfig('velocity', '[servers\n')).toThrow(ProxyConfigParseError);
    expect(() => parseProxyConfig('velocity', 'garbage line\n')).toThrow(ProxyConfigParseError);
  });

  it('多行数组中途夹非字符串元素 → ProxyConfigParseError（不静默丢）', () => {
    expect(() =>
      parseProxyConfig(
        'velocity',
        ['[servers]', 'a = "1.1.1.1:1"', '', 'try = [', '  oops', ']', ''].join('\n'),
      ),
    ).toThrow(ProxyConfigParseError);
  });

  it('未识别的多行数组键 → ProxyConfigParseError（不猜键义）', () => {
    expect(() => parseProxyConfig('velocity', ['foo = [', '  "x"', ']', ''].join('\n'))).toThrow(
      ProxyConfigParseError,
    );
  });

  it('[servers] 的值不是字符串地址 → ProxyConfigParseError（不静默跳过）', () => {
    expect(() => parseProxyConfig('velocity', '[servers]\nlobby = 30066\n')).toThrow(
      ProxyConfigParseError,
    );
  });
});

describe('增量补丁：受限字段 + 渲染前复校验', () => {
  it('只改白名单字段，其余保留', () => {
    const cur = parseProxyConfig('velocity', renderVelocityToml(SPEC));
    const next = applyProxyConfigPatch(cur, { maxPlayers: 100, motd: 'new motd' });
    expect(next.maxPlayers).toBe(100);
    expect(next.motd).toBe('new motd');
    expect(next.bind).toBe(cur.bind);
    expect(next.backends).toEqual(cur.backends);
  });

  it('空补丁是恒等', () => {
    const cur = parseProxyConfig('velocity', renderVelocityToml(SPEC));
    expect(applyProxyConfigPatch(cur, {})).toEqual(cur);
  });

  it('type 不可被补丁改掉（换类型即换格式）', () => {
    const cur = parseProxyConfig('velocity', renderVelocityToml(SPEC));
    const patched = applyProxyConfigPatch(cur, {
      type: 'bungeecord',
    } as unknown as Parameters<typeof applyProxyConfigPatch>[1]);
    expect(patched.type).toBe('velocity');
  });
});
