/**
 * probe.ts 的行为测试（§6.1 环境探测）。
 *
 * 全部 fs 走注入的 mock，**绝不真碰** `C:\Users\...`。
 * 变异测试目标：把「EACCES 与 ENOENT 区分开」的逻辑去掉（两者都当不存在），
 * probe.test.ts 里 `EACCES → degraded:true 且 reason !== 'not-installed'` 必须变红。
 */

import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_GDK_APPDATA_ROOTS,
  DEFAULT_UWP_PACKAGE_NAMES,
  ENV_OVERRIDE_KEYS,
  probeContentDirs,
  type CandidateOutcome,
  type ProbeFsOps,
  type ProbeResult,
} from './probe.js';

/* -------------------------------------------------------------------------- */
/* mock fs                                                                     */
/* -------------------------------------------------------------------------- */

/** mock 目录状态。 */
type FakeDir =
  /** 目录存在且可列目录。 */
  | 'ok'
  /** stat 抛 EACCES：存在但读不了（UWP 受保护目录典型表现）。 */
  | 'stat-eacces'
  /** stat 抛 EPERM。 */
  | 'stat-eperm'
  /** stat 抛 ENOENT：不存在。 */
  | 'missing'
  /** stat 抛 ENOTDIR。 */
  | 'not-a-dir'
  /** stat 抛未知 errno（ELOOP）。 */
  | 'stat-unknown'
  /** stat 成功但 isDirectory() 为 false。 */
  | 'is-file'
  /** stat 成功（目录），readdir 抛 EACCES。 */
  | 'readdir-eacces'
  /** stat 成功（目录），readdir 抛 EIO（非权限类）。 */
  | 'readdir-eio';

function errnoError(code: string, path: string): Error {
  return Object.assign(new Error(`${code}: mock probe failed, '${path}'`), { code });
}

/** 由「路径 → 状态」映射构造只读 mock fs。 */
function makeFs(map: Record<string, FakeDir>): ProbeFsOps {
  return {
    statSync(path: string) {
      const state = map[path] ?? 'missing';
      switch (state) {
        case 'stat-eacces':
          throw errnoError('EACCES', path);
        case 'stat-eperm':
          throw errnoError('EPERM', path);
        case 'not-a-dir':
          throw errnoError('ENOTDIR', path);
        case 'stat-unknown':
          throw errnoError('ELOOP', path);
        case 'is-file':
          return { isDirectory: () => false };
        case 'missing':
          throw errnoError('ENOENT', path);
        default:
          return { isDirectory: () => true };
      }
    },
    readdirSync(path: string) {
      const state = map[path] ?? 'missing';
      if (state === 'readdir-eacces') throw errnoError('EACCES', path);
      if (state === 'readdir-eio') throw errnoError('EIO', path);
      if (state !== 'ok') throw errnoError('ENOENT', path);
      return [] as string[];
    },
  };
}

/* -------------------------------------------------------------------------- */
/* 固定环境                                                                    */
/* -------------------------------------------------------------------------- */

const LOCAL = 'C:\\Users\\tester\\AppData\\Local';
const ROAMING = 'C:\\Users\\tester\\AppData\\Roaming';

const uwpPath = (pkg: string): string =>
  join(LOCAL, 'Packages', pkg, 'LocalState', 'games', 'com.mojang');
const gdkPath = (root: string): string =>
  join(ROAMING, root, 'users', 'shared', 'games', 'com.mojang');

const OLD_UWP = uwpPath('Microsoft.MinecraftUWP_8wekyb3d8bbwe');
const EDU_UWP = uwpPath('Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe');
const GDK_STABLE = gdkPath('Minecraft Bedrock');
const GDK_PREVIEW = gdkPath('Minecraft Bedrock Preview');

/** 有 LOCALAPPDATA + APPDATA，但两处都空的典型环境。 */
const FULL_ENV = { LOCALAPPDATA: LOCAL, APPDATA: ROAMING };

function probe(
  map: Record<string, FakeDir>,
  options: {
    env?: Record<string, string | undefined>;
    uwpPackageNames?: readonly string[];
    gdkAppDataRoots?: readonly string[];
    extraCandidates?: readonly string[];
  } = {},
): ProbeResult {
  return probeContentDirs({
    ...(options.env === undefined ? {} : { env: options.env }),
    fs: makeFs(map),
    ...(options.uwpPackageNames === undefined ? {} : { uwpPackageNames: options.uwpPackageNames }),
    ...(options.gdkAppDataRoots === undefined ? {} : { gdkAppDataRoots: options.gdkAppDataRoots }),
    ...(options.extraCandidates === undefined ? {} : { extraCandidates: options.extraCandidates }),
  });
}

function outcomeFor(result: ProbeResult, path: string): CandidateOutcome {
  const hit = result.tried.find((t) => t.path === path);
  if (hit === undefined)
    throw new Error(`候选未被探测：${path}\n实际：${JSON.stringify(result.tried)}`);
  return hit;
}

/* -------------------------------------------------------------------------- */
/* 不变式                                                                      */
/* -------------------------------------------------------------------------- */

/** 所有非 ok 结论都必须自洽：degraded ⟺ reason !== found ⟺ userHint !== null。 */
function assertInvariants(r: ProbeResult): void {
  expect(r.degraded).toBe(r.reason !== 'found');
  expect(r.userHint !== null).toBe(r.degraded);
  // found ⟺ 有路径可报（存在但读不了也算 found：不能报「未安装」）
  expect(r.contentDir !== null).toBe(r.found);
  expect(r.source !== null).toBe(r.found);
  // 只有真的可读才算可用
  expect(r.readable).toBe(r.reason === 'found');
  // 探测不到任何路径时也必须给出候选清单，且每个 tried 项都在候选清单内。
  for (const t of r.tried) expect(r.candidates).toContain(t.path);
}

describe('probeContentDirs · 结果不变式', () => {
  it('命中 / 未命中 / 受保护 三种结论都满足 degraded⟺reason⟺userHint 不变式', () => {
    const cases = [
      probe({ [OLD_UWP]: 'ok' }, { env: FULL_ENV }),
      probe({ [OLD_UWP]: 'stat-eacces' }, { env: FULL_ENV }),
      probe({}, { env: FULL_ENV }),
      probe({}, { env: {} }),
    ];
    for (const r of cases) assertInvariants(r);
  });

  it('降级结论里的 userHint 一律指向「生成合法包 + 引导用户双击导入」', () => {
    const degraded = [
      probe({ [OLD_UWP]: 'stat-eacces' }, { env: FULL_ENV }),
      probe({ [OLD_UWP]: 'readdir-eacces' }, { env: FULL_ENV }),
      probe({}, { env: FULL_ENV }),
      probe({}, { env: {} }),
    ];
    for (const r of degraded) {
      expect(r.userHint).toContain('双击');
      expect(r.userHint).toContain('.mcpack');
    }
  });
});

/* -------------------------------------------------------------------------- */
/* ① 旧 GDK 包名命中                                                          */
/* -------------------------------------------------------------------------- */

describe('probeContentDirs · 旧 UWP 包名命中', () => {
  it('命中 Microsoft.MinecraftUWP_8wekyb3d8bbwe 下的 com.mojang', () => {
    const r = probe({ [OLD_UWP]: 'ok' }, { env: FULL_ENV });
    assertInvariants(r);
    expect(r).toMatchObject({
      found: true,
      readable: true,
      contentDir: OLD_UWP,
      source: 'uwp-localstate',
      degraded: false,
      reason: 'found',
      userHint: null,
    });
  });

  it('命中的是候选序列中的第一个存在项，且把命中路径标为 ok', () => {
    const r = probe({ [OLD_UWP]: 'ok', [EDU_UWP]: 'ok', [GDK_STABLE]: 'ok' }, { env: FULL_ENV });
    expect(r.contentDir).toBe(OLD_UWP);
    expect(r.candidates.indexOf(OLD_UWP)).toBeLessThan(r.candidates.indexOf(EDU_UWP));
    expect(outcomeFor(r, OLD_UWP).status).toBe('ok');
    // 命中即返回，后面的候选没被试过
    expect(r.tried).toHaveLength(1);
  });

  it('教育版包族名也是默认候选之一（§6.1「名称探测 + 多路径回退」）', () => {
    expect(DEFAULT_UWP_PACKAGE_NAMES).toContain('Microsoft.MinecraftUWP_8wekyb3d8bbwe');
    expect(DEFAULT_UWP_PACKAGE_NAMES).toContain(
      'Microsoft.MinecraftEducationEdition_8wekyb3d8bbwe',
    );
    const r = probe({ [EDU_UWP]: 'ok' }, { env: FULL_ENV });
    expect(r).toMatchObject({ found: true, contentDir: EDU_UWP, source: 'uwp-localstate' });
  });
});

/* -------------------------------------------------------------------------- */
/* ② 新版 GDK 命中（Roaming 内容根 + 可配置包名）                              */
/* -------------------------------------------------------------------------- */

describe('probeContentDirs · 新版 GDK 命中', () => {
  it('旧 UWP 路径不存在时，回退到 %APPDATA%\\Minecraft Bedrock\\...', () => {
    const r = probe({ [GDK_STABLE]: 'ok' }, { env: FULL_ENV });
    assertInvariants(r);
    expect(r).toMatchObject({
      found: true,
      readable: true,
      contentDir: GDK_STABLE,
      source: 'gdk-appdata',
      degraded: false,
      reason: 'found',
    });
    // 旧 UWP 路径确实先试过且确实不存在（钉住「硬编码单个 UWP 名会漏判」）
    expect(outcomeFor(r, OLD_UWP).status).toBe('missing');
    expect(outcomeFor(r, OLD_UWP).errno).toBe('ENOENT');
  });

  it('预览版 GDK 内容根也在默认候选里', () => {
    expect(DEFAULT_GDK_APPDATA_ROOTS).toContain('Minecraft Bedrock');
    const r = probe({ [GDK_PREVIEW]: 'ok' }, { env: FULL_ENV });
    expect(r).toMatchObject({ found: true, contentDir: GDK_PREVIEW, source: 'gdk-appdata' });
  });

  it('拼写待核实的新版 GDK 包名：走 extraCandidates 注入即可命中（不硬编码）', () => {
    // 设计文档 §6.1 称新版 GDK 包名为「Minecraft for Windows」（含空格），
    // 但官方 GDK 迁移文档未证实 → probe.ts 不硬编码、默认不启用，仅做可配置项。
    const injected = uwpPath('Minecraft for Windows');
    const withIt = probe({ [injected]: 'ok' }, { env: FULL_ENV, extraCandidates: [injected] });
    expect(withIt).toMatchObject({
      found: true,
      contentDir: injected,
      source: 'extra',
      degraded: false,
    });
    // 默认（不注入）时不应凭空出现在候选里
    const withoutIt = probe({ [injected]: 'ok' }, { env: FULL_ENV });
    expect(withoutIt.candidates).not.toContain(injected);
    expect(withoutIt.found).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */
/* ③ 环境变量覆盖优先于一切                                                    */
/* -------------------------------------------------------------------------- */

describe('probeContentDirs · 环境变量覆盖优先', () => {
  it('COM_MOJANG_DIR 优先于一切默认候选', () => {
    const override = 'D:\\somewhere\\games\\com.mojang';
    const r = probe(
      { [override]: 'ok', [OLD_UWP]: 'ok', [GDK_STABLE]: 'ok' },
      {
        env: { ...FULL_ENV, COM_MOJANG_DIR: override },
      },
    );
    expect(r).toMatchObject({ found: true, contentDir: override, source: 'env-override' });
    expect(r.candidates[0]).toBe(override);
    expect(r.tried).toHaveLength(1);
  });

  it('BEDROCK_COM_MOJANG_DIR 是第二顺位（现状优先级：COM_MOJANG_DIR → BEDROCK_COM_MOJANG_DIR）', () => {
    expect(ENV_OVERRIDE_KEYS).toEqual(['COM_MOJANG_DIR', 'BEDROCK_COM_MOJANG_DIR']);
    const override = 'D:\\fallback\\com.mojang';
    const r = probe(
      { [override]: 'ok', [OLD_UWP]: 'ok' },
      {
        env: { ...FULL_ENV, BEDROCK_COM_MOJANG_DIR: override },
      },
    );
    expect(r).toMatchObject({ found: true, contentDir: override, source: 'env-override' });
  });

  it('两个变量都设置时 COM_MOJANG_DIR 先被试；前者不存在才回退到后者', () => {
    const primary = 'D:\\primary\\com.mojang';
    const secondary = 'D:\\secondary\\com.mojang';
    const env = { ...FULL_ENV, COM_MOJANG_DIR: primary, BEDROCK_COM_MOJANG_DIR: secondary };
    expect(probe({ [secondary]: 'ok', [OLD_UWP]: 'ok' }, { env }).contentDir).toBe(secondary);
    expect(probe({ [primary]: 'ok', [secondary]: 'ok' }, { env }).contentDir).toBe(primary);
  });

  it('覆盖路径不存在时继续回退到默认候选（覆盖不是「一票否决」）', () => {
    const override = 'D:\\does\\not\\exist\\com.mojang';
    const r = probe(
      { [override]: 'missing', [OLD_UWP]: 'ok' },
      {
        env: { ...FULL_ENV, COM_MOJANG_DIR: override },
      },
    );
    expect(r).toMatchObject({ found: true, contentDir: OLD_UWP, source: 'uwp-localstate' });
    expect(outcomeFor(r, override).status).toBe('missing');
  });
});

/* -------------------------------------------------------------------------- */
/* ④ 目录不存在                                                               */
/* -------------------------------------------------------------------------- */

describe('probeContentDirs · 目录不存在', () => {
  it('全部候选 ENOENT → found:false + reason:not-installed + 列出已试候选', () => {
    const r = probe({}, { env: FULL_ENV });
    assertInvariants(r);
    expect(r).toMatchObject({ found: false, readable: false, contentDir: null, source: null });
    expect(r.reason).toBe('not-installed');
    expect(r.degraded).toBe(true);
    // 列出候选（含旧 UWP 两个包名 + 两个 GDK 根），供排障
    expect(r.candidates).toContain(OLD_UWP);
    expect(r.candidates).toContain(EDU_UWP);
    expect(r.candidates).toContain(GDK_STABLE);
    expect(r.candidates).toContain(GDK_PREVIEW);
    expect(r.tried).toHaveLength(r.candidates.length);
    expect(r.tried.every((t) => t.status === 'missing' && t.errno === 'ENOENT')).toBe(true);
  });

  it('路径存在但其实是文件 → 跳过继续找，不误判为命中', () => {
    const r = probe({ [OLD_UWP]: 'is-file', [GDK_STABLE]: 'ok' }, { env: FULL_ENV });
    expect(outcomeFor(r, OLD_UWP).status).toBe('not-a-directory');
    expect(r).toMatchObject({ found: true, contentDir: GDK_STABLE });
  });

  it('ENOTDIR（路径中某段是文件）同样不算命中', () => {
    const r = probe({ [OLD_UWP]: 'not-a-dir', [GDK_STABLE]: 'ok' }, { env: FULL_ENV });
    expect(outcomeFor(r, OLD_UWP).status).toBe('not-a-directory');
    expect(r.contentDir).toBe(GDK_STABLE);
  });

  it('未知 errno → reason:probe-error（与「未安装」「无权限」都不同）', () => {
    const r = probe({ [OLD_UWP]: 'stat-unknown', [EDU_UWP]: 'ok' }, { env: FULL_ENV });
    // 首个存在项未知 errno 不命中，继续回退到教育版
    expect(outcomeFor(r, OLD_UWP).status).toBe('error');
    expect(outcomeFor(r, OLD_UWP).errno).toBe('ELOOP');
    expect(r).toMatchObject({ found: true, contentDir: EDU_UWP });
  });

  it('全部候选都遇到未知 errno → reason:probe-error 而非 not-installed', () => {
    const r = probe(
      { [OLD_UWP]: 'stat-unknown', [EDU_UWP]: 'stat-unknown' },
      {
        env: FULL_ENV,
        gdkAppDataRoots: [],
      },
    );
    expect(r.reason).toBe('probe-error');
    assertInvariants(r);
  });
});

/* -------------------------------------------------------------------------- */
/* ⑤ 目录存在但 EACCES —— 必须与「不存在」明确不同（钉住核心约束）            */
/* -------------------------------------------------------------------------- */

describe('probeContentDirs · 目录存在但读不了（§6.1 降级）', () => {
  it('stat 抛 EACCES → degraded:true 且 reason 与 not-installed 明确不同', () => {
    const denied = probe({ [OLD_UWP]: 'stat-eacces' }, { env: FULL_ENV });
    const missing = probe({}, { env: FULL_ENV });

    // —— 核心断言：两者结论不可混淆 ——
    expect(denied.reason).not.toBe(missing.reason);
    expect(denied.reason).toBe('permission-denied');
    expect(missing.reason).toBe('not-installed');
    // 存在但读不了：路径确实存在，不能报「未安装」
    expect(denied.found).toBe(true);
    expect(denied.readable).toBe(false);
    expect(denied.contentDir).toBe(OLD_UWP);
    expect(denied.source).toBe('uwp-localstate');
    // 必须降级并给出可执行指引（§6.1 第 4 条）
    expect(denied.degraded).toBe(true);
    expect(denied.userHint).toContain('双击');
    expect(denied.userHint).toContain('.mcpack');
    // errno 保留下来供排障
    expect(outcomeFor(denied, OLD_UWP)).toMatchObject({
      status: 'permission-denied',
      errno: 'EACCES',
    });
  });

  it('stat 抛 EPERM 同样归为 permission-denied（Windows 上 EACCES/EPERM 都会出现）', () => {
    const r = probe({ [OLD_UWP]: 'stat-eperm' }, { env: FULL_ENV });
    expect(r).toMatchObject({
      found: true,
      readable: false,
      reason: 'permission-denied',
      degraded: true,
    });
    expect(outcomeFor(r, OLD_UWP).errno).toBe('EPERM');
  });

  it('stat 通过但 readdir 抛 EACCES → 同样是 permission-denied，不是 found', () => {
    const r = probe({ [OLD_UWP]: 'readdir-eacces' }, { env: FULL_ENV });
    expect(r).toMatchObject({
      found: true,
      readable: false,
      contentDir: OLD_UWP,
      reason: 'permission-denied',
      degraded: true,
    });
  });

  it('目录存在但 readdir 抛非权限 errno → reason:unreadable（第三种结论，同样降级）', () => {
    const r = probe({ [OLD_UWP]: 'readdir-eio' }, { env: FULL_ENV });
    expect(r).toMatchObject({ found: true, readable: false, reason: 'unreadable', degraded: true });
    expect(r.userHint).toContain('双击');
  });

  it('首个候选「存在但被拒」即判定，不再回退到恰好可读的其它路径（否则降级信号被掩盖）', () => {
    const r = probe(
      { [OLD_UWP]: 'stat-eacces', [EDU_UWP]: 'ok', [GDK_STABLE]: 'ok' },
      { env: FULL_ENV },
    );
    expect(r).toMatchObject({ reason: 'permission-denied', contentDir: OLD_UWP });
    expect(r.tried).toHaveLength(1);
  });

  it('三种「读不了/找不到」结论两两互不相同', () => {
    const denied = probe({ [OLD_UWP]: 'stat-eacces' }, { env: FULL_ENV }).reason;
    const unreadable = probe({ [OLD_UWP]: 'readdir-eio' }, { env: FULL_ENV }).reason;
    const missing = probe({}, { env: FULL_ENV }).reason;
    expect(new Set([denied, unreadable, missing]).size).toBe(3);
  });
});

/* -------------------------------------------------------------------------- */
/* ⑥ 用户自定义候选包名生效                                                     */
/* -------------------------------------------------------------------------- */

describe('probeContentDirs · 自定义候选包名', () => {
  it('uwpPackageNames 覆盖后的自定义包名可命中', () => {
    const custom = uwpPath('Contoso.MinecraftCustom_zzzzzzzz');
    const r = probe(
      { [custom]: 'ok' },
      { env: FULL_ENV, uwpPackageNames: ['Contoso.MinecraftCustom_zzzzzzzz'] },
    );
    expect(r).toMatchObject({ found: true, contentDir: custom, source: 'uwp-localstate' });
    // 覆盖后默认包名不应再被尝试（不散落硬编码）
    expect(r.candidates).not.toContain(OLD_UWP);
  });

  it('自定义包名命中时，仍排在环境变量覆盖之后', () => {
    const override = 'D:\\override\\com.mojang';
    const custom = uwpPath('Contoso.MinecraftCustom_zzzzzzzz');
    const r = probe(
      { [override]: 'ok', [custom]: 'ok' },
      {
        env: { ...FULL_ENV, COM_MOJANG_DIR: override },
        uwpPackageNames: ['Contoso.MinecraftCustom_zzzzzzzz'],
      },
    );
    expect(r.contentDir).toBe(override);
  });

  it('自定义 GDK 内容根可命中（新增 GDK 包名只需加一行/加一项）', () => {
    const custom = gdkPath('Minecraft Bedrock Canary');
    const r = probe(
      { [custom]: 'ok' },
      { env: FULL_ENV, gdkAppDataRoots: ['Minecraft Bedrock Canary'] },
    );
    expect(r).toMatchObject({ found: true, contentDir: custom, source: 'gdk-appdata' });
    expect(r.candidates).not.toContain(GDK_STABLE);
  });

  it('extraCandidates 支持任意字面量路径（含空格），且排在最后', () => {
    const literal = 'E:\\Games\\Minecraft for Windows\\games\\com.mojang';
    const r = probe(
      { [literal]: 'ok', [OLD_UWP]: 'ok' },
      { env: FULL_ENV, extraCandidates: [literal] },
    );
    expect(r).toMatchObject({ found: true, contentDir: OLD_UWP, source: 'uwp-localstate' });
    const only = probe({ [literal]: 'ok' }, { env: {}, extraCandidates: [literal] });
    expect(only).toMatchObject({ found: true, contentDir: literal, source: 'extra' });
    expect(only.candidates).toEqual([literal]);
  });

  it('重复候选会去重（环境变量恰好等于默认路径时不多试一次）', () => {
    const r = probe({ [OLD_UWP]: 'ok' }, { env: { ...FULL_ENV, COM_MOJANG_DIR: OLD_UWP } });
    expect(r.candidates.filter((p) => p === OLD_UWP)).toHaveLength(1);
    expect(r.tried).toHaveLength(1);
  });

  it('空白候选被忽略，不产生路径探测噪声', () => {
    const r = probe(
      { [GDK_STABLE]: 'ok' },
      { env: { ...FULL_ENV, COM_MOJANG_DIR: '   ' }, extraCandidates: [''] },
    );
    expect(r.candidates).not.toContain('');
    expect(r.candidates).not.toContain('   ');
    expect(r.contentDir).toBe(GDK_STABLE);
  });
});

/* -------------------------------------------------------------------------- */
/* ⑦ 环境变量缺失不崩溃                                                        */
/* -------------------------------------------------------------------------- */

describe('probeContentDirs · 环境缺失不崩溃', () => {
  it('无 LOCALAPPDATA / APPDATA → 不抛异常，返回 no-environment + 空候选', () => {
    const r = probe({}, { env: {} });
    assertInvariants(r);
    expect(r).toMatchObject({
      found: false,
      readable: false,
      contentDir: null,
      source: null,
      degraded: true,
      reason: 'no-environment',
    });
    expect(r.candidates).toEqual([]);
    expect(r.tried).toEqual([]);
    expect(r.userHint).toContain('双击');
  });

  it('有 APPDATA 但无 LOCALAPPDATA 时，仍能回退到新版 GDK 路径', () => {
    const r = probe({ [GDK_STABLE]: 'ok' }, { env: { APPDATA: ROAMING } });
    expect(r).toMatchObject({ found: true, contentDir: GDK_STABLE, source: 'gdk-appdata' });
  });

  it('有 LOCALAPPDATA 但无 APPDATA 时，只能命中旧 UWP 路径', () => {
    const r = probe({ [OLD_UWP]: 'ok' }, { env: { LOCALAPPDATA: LOCAL } });
    expect(r).toMatchObject({ found: true, contentDir: OLD_UWP });
    expect(r.candidates).not.toContain(GDK_STABLE);
  });

  it('完全不传 options 时走 process.env 且不抛异常（真实机器上探测绝不允许崩）', () => {
    expect(() => probeContentDirs()).not.toThrow();
    const r = probeContentDirs();
    assertInvariants(r);
    if (!r.found) expect(r.userHint).toContain('双击');
  });

  it('env 值不是字符串（undefined/null 混入）也不崩', () => {
    const r = probe(
      { [GDK_STABLE]: 'ok' },
      {
        env: { LOCALAPPDATA: undefined, APPDATA: ROAMING, COM_MOJANG_DIR: undefined },
      },
    );
    expect(r).toMatchObject({ found: true, contentDir: GDK_STABLE });
  });
});

/* -------------------------------------------------------------------------- */
/* 只读保证                                                                    */
/* -------------------------------------------------------------------------- */

describe('probeContentDirs · 只读保证（§6.1 不得依赖直接读写）', () => {
  it('fs 抽象上不存在任何写入方法，探测过程无法写入受保护目录', () => {
    const calls: string[] = [];
    const watched: ProbeFsOps = {
      statSync: (p) => {
        calls.push(`stat:${p}`);
        return { isDirectory: () => true };
      },
      readdirSync: (p) => {
        calls.push(`readdir:${p}`);
        return [];
      },
    };
    const r = probeContentDirs({ env: FULL_ENV, fs: watched });
    expect(r.found).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    // 只出现 stat / readdir，没有任何写类调用名
    expect(calls.every((c) => c.startsWith('stat:') || c.startsWith('readdir:'))).toBe(true);
    for (const forbidden of ['write', 'mkdir', 'unlink', 'rename', 'copy', 'chmod', 'open']) {
      expect(calls.some((c) => c.toLowerCase().includes(forbidden))).toBe(false);
    }
  });
});
