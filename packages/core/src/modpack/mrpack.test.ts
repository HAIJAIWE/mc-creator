import { describe, it, expect } from 'vitest';
import {
  buildMrpackPlan,
  validateModrinthIndex,
  loaderToMrpackKey,
  describeMrpackFormat,
  encodeCdnPathSegment,
  validateDownloadUri,
  MODRINTH_CDN_BASE,
} from './mrpack.js';
import type { ModpackSpec } from '@mc-creator/shared';

function spec(partial: Partial<ModpackSpec> = {}): ModpackSpec {
  return {
    packId: 'test_pack',
    packName: 'Test Pack',
    packVersion: '1.0.0',
    author: '',
    description: '',
    format: 'modrinth',
    mcVersion: '1.21.1',
    loader: 'fabric',
    loaderVersion: '0.16.9',
    mods: [],
    credits: '',
    overrides: [],
    serverOverrides: [],
    launchMessage: '',
    ...partial,
  };
}

describe('loaderToMrpackKey', () => {
  it('fabric/quilt 用 -loader 后缀', () => {
    expect(loaderToMrpackKey('fabric')).toBe('fabric-loader');
    expect(loaderToMrpackKey('quilt')).toBe('quilt-loader');
    expect(loaderToMrpackKey('neoforge')).toBe('neoforge');
  });
});

describe('downloads 直链：优先用 Modrinth 自己给的 url（实测回归案例）', () => {
  // 实测（2026-10）：fabric-api 版本 0.29.5+1.17（version_id = ct7BsEJ1）
  //   - API 给的 files[0].url 版本段是 **版本号** 0.29.5%2B1.17   → HEAD 200
  //   - 用 versionId 拼出来的同路径                                → HEAD 404
  // 同批 72 个样本里其余 71 个的 url 版本段都是 version_id（拼法可用）。
  // 即 Modrinth 自己的 url 在版本段上**不统一**，无法从 projectId/versionId 推断。
  // 结论：直链必须原样采用，不得自行拼装。
  const REAL_FILE = {
    projectId: 'P7dR8mSH',
    versionId: 'ct7BsEJ1',
    fileName: 'fabric-api-0.29.5%2B1.17.jar',
    downloadUrl:
      'https://cdn.modrinth.com/data/P7dR8mSH/versions/0.29.5%2B1.17/fabric-api-0.29.5%2B1.17.jar',
  };

  it('有直链时原样采用，不重新拼装（version_id 拼法在这个案例上 404）', () => {
    const plan = buildMrpackPlan(
      spec({
        mods: [
          {
            name: 'Fabric API',
            projectId: REAL_FILE.projectId,
            versionId: REAL_FILE.versionId,
            fileName: REAL_FILE.fileName,
            downloadUrl: REAL_FILE.downloadUrl,
          } as never,
        ],
      }),
    );
    const files = plan.indexJson.files as Array<{ downloads: string[] }>;
    expect(files[0]?.downloads).toEqual([REAL_FILE.downloadUrl]);
    // 绝不能退化成 version_id 拼法（那个地址实测 404）
    expect(files[0]?.downloads[0]).not.toContain(`/versions/${REAL_FILE.versionId}/`);
    expect(plan.warnings.filter((w) => w.includes('缺少直链'))).toHaveLength(0);
  });

  it('缺直链时才退化拼接，且告警里点明「可能 404」而不是含糊说「可能失败」', () => {
    const plan = buildMrpackPlan(
      spec({
        mods: [
          {
            name: 'Fabric API',
            projectId: REAL_FILE.projectId,
            versionId: REAL_FILE.versionId,
            fileName: REAL_FILE.fileName,
          } as never,
        ],
      }),
    );
    const files = plan.indexJson.files as Array<{ downloads: string[] }>;
    expect(files[0]?.downloads[0]).toBe(
      `${MODRINTH_CDN_BASE}/${REAL_FILE.projectId}/versions/${REAL_FILE.versionId}/${REAL_FILE.fileName}`,
    );
    const warn = plan.warnings.find((w) => w.includes('缺少直链'));
    expect(warn).toBeDefined();
    expect(warn).toContain('404');
  });
});

describe('encodeCdnPathSegment：编码非法字符，但绝不二次编码 %xx', () => {
  it('空格等 RFC 3986 非法字符被编码（官方规范明确禁止未编码空格）', () => {
    expect(encodeCdnPathSegment('Some Mod 1.0.jar')).toBe('Some%20Mod%201.0.jar');
    expect(encodeCdnPathSegment('a<b>c.jar')).toBe('a%3Cb%3Ec.jar');
    expect(encodeCdnPathSegment('a"b.jar')).toBe('a%22b.jar');
  });

  it('已带 %2B 的 filename 原样保留（encodeURIComponent 会双重编码成 %252B）', () => {
    // 这正是真实案例里的文件名。若这里变成 %252B，CDN 就会 404。
    const real = 'fabric-api-0.29.5%2B1.17.jar';
    expect(encodeCdnPathSegment(real)).toBe(real);
    expect(encodeCdnPathSegment(real)).not.toContain('%252B');
  });

  it('正常文件名与路径分隔符不受影响', () => {
    expect(encodeCdnPathSegment('sodium-fabric-0.6.jar')).toBe('sodium-fabric-0.6.jar');
    // path 分隔符必须保留原样，否则会改变目录结构
    expect(encodeCdnPathSegment('a/b.jar')).toBe('a/b.jar');
  });
});

describe('validateDownloadUri：把官方规范那条 MUST 变成可执行判据', () => {
  it('合法的 https CDN 链接通过', () => {
    expect(validateDownloadUri('https://cdn.modrinth.com/data/AABB/versions/IIJ/a.jar')).toEqual(
      [],
    );
  });

  it('非 https 被拒（规范要求 HTTPS URLs）', () => {
    const errs = validateDownloadUri('http://cdn.modrinth.com/data/AABB/versions/IIJ/a.jar');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('https');
  });

  it('未编码空格被拒（这条 MUST 此前完全没有判据）', () => {
    const errs = validateDownloadUri('https://cdn.modrinth.com/data/AABB/versions/IIJ/a b.jar');
    expect(errs).toHaveLength(1);
    expect(errs[0]).toContain('RFC 3986');
  });

  it('路径穿越被拒', () => {
    expect(validateDownloadUri('https://cdn.modrinth.com/../../etc/passwd')).toHaveLength(1);
  });

  it('非字符串 / 空串被拒', () => {
    expect(validateDownloadUri(123)).toHaveLength(1);
    expect(validateDownloadUri('')).toHaveLength(1);
    expect(validateDownloadUri(undefined)).toHaveLength(1);
    expect(validateDownloadUri(null)).toHaveLength(1);
  });

  it('已正确编码的 %20 / %2B 通过（不能误伤合法编码）', () => {
    expect(
      validateDownloadUri('https://cdn.modrinth.com/data/AABB/versions/IIJ/a%20b.jar'),
    ).toEqual([]);
    expect(
      validateDownloadUri(
        'https://cdn.modrinth.com/data/AABB/versions/IIJ/fabric-api-0.29.5%2B1.17.jar',
      ),
    ).toEqual([]);
  });
});

describe('validateModrinthIndex 现在会查 downloads 内容', () => {
  const base = {
    formatVersion: 1,
    game: 'minecraft',
    versionId: '1.0',
    name: 'P',
    files: [
      {
        path: 'mods/a.jar',
        hashes: { sha512: '0'.repeat(128) },
        downloads: ['https://cdn.modrinth.com/data/AABB/versions/IIJ/a.jar'],
      },
    ],
    dependencies: { minecraft: '1.21.1' },
  };

  it('合法包通过', () => {
    expect(validateModrinthIndex(structuredClone(base)).ok).toBe(true);
  });

  it('downloads 里混入非 https 会被抓出来', () => {
    const bad = structuredClone(base);
    (bad.files[0] as { downloads: string[] }).downloads = ['http://evil.example/a.jar'];
    const r = validateModrinthIndex(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('https');
  });

  it('downloads 里混入未编码空格会被抓出来', () => {
    const bad = structuredClone(base);
    (bad.files[0] as { downloads: string[] }).downloads = [
      'https://cdn.modrinth.com/data/AABB/versions/IIJ/a b.jar',
    ];
    const r = validateModrinthIndex(bad);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toContain('RFC 3986');
  });

  it('downloads 元素不是字符串也被抓出来（此前只看是不是数组）', () => {
    const bad = structuredClone(base);
    (bad.files[0] as { downloads: unknown[] }).downloads = [42];
    expect(validateModrinthIndex(bad).ok).toBe(false);
  });
});

describe('真网络冒烟：Modrinth CDN 版本段的不统一（上游真实行为）', () => {
  const UA = 'mc-creator/0.0.0 (https://github.com/mc-creator)';
  // 真网络往返没有确定耗时上限：单次请求给 15s 硬超时（与 verify-loader-versions.test.ts 一致），
  // 用例整体给 30s，避免慢网下被 vitest 默认 5s testTimeout 误判为失败。
  const NET_TIMEOUT = 30_000;
  const getJson = async <T>(u: string): Promise<T> => {
    const r = await fetch(u, {
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15_000),
    });
    return (await r.json()) as T;
  };
  const head = async (u: string) => {
    const r = await fetch(u, {
      method: 'HEAD',
      headers: { 'User-Agent': UA },
      signal: AbortSignal.timeout(15_000),
    });
    return r.status;
  };

  it(
    'API 给的直链 HEAD 200',
    async () => {
      const vs = await getJson<
        Array<{
          id: string;
          project_id: string;
          version_number: string;
          files: Array<{ filename: string; url: string }>;
        }>
      >('https://api.modrinth.com/v2/project/fabric-api/version');
      const v = vs.find((x) => x.version_number.includes('0.29.5') && x.files.length);
      expect(v, '找不到 fabric-api 0.29.5 版本样本').toBeDefined();
      expect(await head(v!.files[0]!.url)).toBe(200);
    },
    NET_TIMEOUT,
  );

  it(
    '同一文件按 versionId 拼出的路径确实拿不到（这就是不能自行拼装的依据）',
    async () => {
      // 必须**按版本号定位**这一个文件，不能取列表第一个：
      // fabric-api 较新的版本 url 版本段都是 versionId（拼法可用），
      // 只有 0.29.5+1.17 这类用版本号段 —— 取「第一个」会拿到可用样本，断言就失去意义。
      const vs = await getJson<
        Array<{
          id: string;
          project_id: string;
          version_number: string;
          files: Array<{ filename: string; url: string }>;
        }>
      >('https://api.modrinth.com/v2/project/fabric-api/version');
      const v = vs.find((x) => x.version_number.includes('0.29.5') && x.files.length);
      expect(v, '找不到 fabric-api 0.29.5 版本样本').toBeDefined();
      const f = v!.files[0]!;
      const naive = `${MODRINTH_CDN_BASE}/${v!.project_id}/versions/${v!.id}/${f.filename}`;
      if (naive === f.url) {
        // 上游若哪天把这个文件的 url 版本段统一成 versionId，依据就变了 ——
        // 明示出来要求复核，而不是让断言悄悄变成「反正都 200」
        throw new Error(
          `上游已把 ${f.filename} 的 url 版本段统一成 versionId，` +
            `「必须用直链而不能拼装」的依据已变化，请重新核对 mrpack.ts 的退化拼接是否还需要。`,
        );
      }
      // 上游对这条拼出来的路径，2026-10 前后从 404 变成了 400（HEAD 仍然准）——
      // 这里只关心「拿不到文件」，不把具体状态码写死：4xx 都说明不能自己拼路径。
      const naiveStatus = await head(naive);
      expect(
        naiveStatus,
        `拼出来的路径返回了 ${naiveStatus}，说明它其实可用，拼接依据已变化`,
      ).not.toBe(200);
      expect(naiveStatus).toBeGreaterThanOrEqual(400);
      expect(await head(f.url)).toBe(200);
    },
    NET_TIMEOUT,
  );

  it(
    '上游给的直链本身一定通过我们的 RFC 3986 校验（不能误伤合法地址）',
    async () => {
      const vs = await getJson<Array<{ files: Array<{ url: string }> }>>(
        'https://api.modrinth.com/v2/project/sodium/version',
      );
      for (const v of vs.slice(0, 5)) {
        for (const f of v.files) {
          expect(validateDownloadUri(f.url), f.url).toEqual([]);
        }
      }
    },
    NET_TIMEOUT,
  );
});

describe('buildMrpackPlan', () => {
  it('生成规范 dependencies（含 fabric-loader + 兼容 fabric 键）', () => {
    const plan = buildMrpackPlan(spec());
    const deps = plan.indexJson.dependencies as Record<string, string>;
    expect(deps.minecraft).toBe('1.21.1');
    expect(deps['fabric-loader']).toBe('0.16.9');
    expect(deps['fabric']).toBe('0.16.9');
  });
  it('文件含 path/hashes/env/downloads/fileSize', () => {
    const plan = buildMrpackPlan(
      spec({
        mods: [
          {
            name: 'Sodium',
            projectId: 'Aqlfj9dU',
            versionId: 'ver-1',
            fileName: 'sodium.jar',
            fileSize: 123,
            downloadUrl: 'https://example.com/sodium.jar',
            sha512: 'a'.repeat(128),
            sha1: 'b'.repeat(40),
            envClient: 'required',
            envServer: 'unsupported',
          },
        ],
      }),
    );
    const files = plan.indexJson.files as Array<Record<string, unknown>>;
    expect(files).toHaveLength(1);
    expect(files[0]?.path).toBe('mods/sodium.jar');
    expect(files[0]?.hashes).toEqual({ sha512: 'a'.repeat(128), sha1: 'b'.repeat(40) });
    expect(files[0]?.env).toEqual({ client: 'required', server: 'unsupported' });
  });
  it('缺哈希/直链时占位并告警', () => {
    const plan = buildMrpackPlan(
      spec({ mods: [{ name: 'X', projectId: 'p', versionId: 'v', fileName: 'x.jar' }] }),
    );
    expect(plan.warnings.length).toBeGreaterThan(0);
    const files = plan.indexJson.files as Array<{ hashes: Record<string, string> }>;
    expect(files[0]?.hashes.sha512).toHaveLength(128);
  });
  it('产物可通过 validateModrinthIndex', () => {
    const plan = buildMrpackPlan(
      spec({
        mods: [
          {
            name: 'X',
            projectId: 'p',
            versionId: 'v',
            fileName: 'x.jar',
            downloadUrl: 'https://x/y.jar',
          },
        ],
      }),
    );
    expect(validateModrinthIndex(plan.indexJson).ok).toBe(true);
  });
});

describe('describeMrpackFormat', () => {
  it('说明含关键结构', () => {
    const doc = describeMrpackFormat();
    expect(doc).toContain('modrinth.index.json');
    expect(doc).toContain('overrides/');
    expect(doc).toContain('file:project:writeStream');
  });
});
