import { describe, it, expect } from 'vitest';
import {
  MCIM_ORIGIN,
  MIRROR_CURSEFORGE_API,
  MIRROR_MODRINTH_API,
  OFFICIAL_CURSEFORGE_API,
  OFFICIAL_MODRINTH_API,
  apiBases,
  isOfficialCurseForgeBase,
  mirrorUrlOf,
  swapBase,
  urlsWithMirror,
  type SourcePreference,
} from './mirror.js';

const MIRROR_FIRST: SourcePreference = { preferOfficial: false };
const OFFICIAL_FIRST: SourcePreference = { preferOfficial: true };

describe('mirrorUrlOf · 官方地址 → 国内镜像地址', () => {
  /**
   * 输入全是**实测真的取过**的地址（2026-10）：
   * 左边这些响应体/字节数已经跟右边对过，映射表就是照它们写的。
   */
  it.each([
    [
      'https://api.modrinth.com/v2/search?query=sodium',
      `${MCIM_ORIGIN}/modrinth/v2/search?query=sodium`,
    ],
    [
      'https://staging-api.modrinth.com/v2/search?query=sodium',
      `${MCIM_ORIGIN}/modrinth/v2/search?query=sodium`,
    ],
    [
      'https://cdn.modrinth.com/data/AANobbMI/versions/ygf8cVZg/sodium-fabric-0.5.11%2Bmc1.20.1.jar',
      `${MCIM_ORIGIN}/data/AANobbMI/versions/ygf8cVZg/sodium-fabric-0.5.11%2Bmc1.20.1.jar`,
    ],
    [
      'https://api.curseforge.com/v1/mods/238222/files?pageSize=3',
      `${MCIM_ORIGIN}/curseforge/v1/mods/238222/files?pageSize=3`,
    ],
    [
      'https://edge.forgecdn.net/files/9206/523/jei-26.3-neoforge-31.13.0.71.jar',
      `${MCIM_ORIGIN}/files/9206/523/jei-26.3-neoforge-31.13.0.71.jar`,
    ],
    ['https://mediafilez.forgecdn.net/files/9206/523/x.jar', `${MCIM_ORIGIN}/files/9206/523/x.jar`],
    ['https://media.forgecdn.net/files/9206/523/x.jar', `${MCIM_ORIGIN}/files/9206/523/x.jar`],
  ])('%s', (official, mirrored) => {
    expect(mirrorUrlOf(official)).toBe(mirrored);
  });

  /**
   * 只认**开头**那一段前缀。
   *
   * PCL 是 `Replace(...)` 全串替换（`ModDownload.vb` L1307-1316），
   * 遇到「URL 里恰好含有官方域名」时会把不是主机的那一段也改掉。
   * 换前缀是**换主机**，不是替换字符串。
   */
  it('只换开头的前缀，不替换字符串中间出现的域名', () => {
    const tricky = 'https://example.com/redirect?to=https://cdn.modrinth.com/data/x/a.jar';
    expect(mirrorUrlOf(tricky)).toBeNull();
  });

  it('不是 Modrinth / CurseForge 的地址返回 null（Mojang、MC百科、皮肤站都不该被换）', () => {
    expect(mirrorUrlOf('https://piston-data.mojang.com/client.jar')).toBeNull();
    expect(mirrorUrlOf('https://www.mcmod.cn/class/1.html')).toBeNull();
    expect(mirrorUrlOf('https://littleskin.cn/api/yggdrasil')).toBeNull();
  });
});

describe('urlsWithMirror · 候选顺序由偏好决定', () => {
  const official = 'https://cdn.modrinth.com/data/A/versions/B/a.jar';
  const mirrored = `${MCIM_ORIGIN}/data/A/versions/B/a.jar`;

  it('镜像优先 → 镜像在前，官方仍在列表里兜底', () => {
    expect(urlsWithMirror(official, MIRROR_FIRST)).toEqual([mirrored, official]);
  });

  it('官方优先 → 官方在前，镜像兜底', () => {
    expect(urlsWithMirror(official, OFFICIAL_FIRST)).toEqual([official, mirrored]);
  });

  it('没有镜像的地址两种偏好都是原样一个候选', () => {
    const mojang = 'https://piston-data.mojang.com/v1/objects/x/client.jar';
    expect(urlsWithMirror(mojang, MIRROR_FIRST)).toEqual([mojang]);
    expect(urlsWithMirror(mojang, OFFICIAL_FIRST)).toEqual([mojang]);
  });
});

describe('apiBases · 客户端要的根地址候选', () => {
  it('Modrinth：镜像优先 → 镜像根在前', () => {
    expect(apiBases('modrinth', MIRROR_FIRST)).toEqual([
      MIRROR_MODRINTH_API,
      OFFICIAL_MODRINTH_API,
    ]);
    expect(MIRROR_MODRINTH_API).toBe(`${MCIM_ORIGIN}/modrinth/v2`);
  });

  it('CurseForge：官方优先 → 官方根在前', () => {
    expect(apiBases('curseforge', OFFICIAL_FIRST)).toEqual([
      OFFICIAL_CURSEFORGE_API,
      MIRROR_CURSEFORGE_API,
    ]);
    expect(MIRROR_CURSEFORGE_API).toBe(`${MCIM_ORIGIN}/curseforge/v1`);
  });
});

describe('swapBase / isOfficialCurseForgeBase', () => {
  it('换根：拼好的完整 URL 换前缀即可复用', () => {
    const url = `${OFFICIAL_MODRINTH_API}/search?query=sodium`;
    expect(swapBase(url, OFFICIAL_MODRINTH_API, MIRROR_MODRINTH_API)).toBe(
      `${MIRROR_MODRINTH_API}/search?query=sodium`,
    );
  });

  it('换不了（不是这个前缀）返回 null；from 与 to 相同原样返回', () => {
    expect(
      swapBase('https://other.example/x', OFFICIAL_MODRINTH_API, MIRROR_MODRINTH_API),
    ).toBeNull();
    expect(swapBase('https://ab', 'https://ab', 'https://ab')).toBe('https://ab');
  });

  it('官方 CurseForge 根要用 key，镜像根不用', () => {
    expect(isOfficialCurseForgeBase(OFFICIAL_CURSEFORGE_API)).toBe(true);
    expect(isOfficialCurseForgeBase(MIRROR_CURSEFORGE_API)).toBe(false);
  });
});

/**
 * 真网络冒烟：**官方的数据 = 镜像的数据**，且镜像上那份文件真的能下。
 *
 * 这条不打桩 —— 映射表错了（多了/少了路径段、换错主机）单靠断言字符串是
 * 看不出来的，只有真取一次才算验过。与其他真网络测试一样，它依赖外网。
 */
describe('真网络冒烟 · MCIM 镜像与官方同源', () => {
  it('镜像的搜索结果与官方一致，且镜像上的 CDN 文件可下载（Range 取前 1KB）', async (ctx) => {
    const q = '/search?query=sodium&limit=1';
    const [officialRes, mirrorRes] = await Promise.all([
      fetch(`${OFFICIAL_MODRINTH_API}${q}`),
      fetch(`${MIRROR_MODRINTH_API}${q}`),
    ]);
    expect(officialRes.status).toBe(200);
    // 实测 2026-10-20：MCIM 整站 503（官方 API 仍 200）。这不是映射表错了，
    // 是第三方镜像不可用；真网络冒烟如实跳过，不把外部故障算成代码回归。
    if (mirrorRes.status >= 500) {
      console.warn(`[真网络冒烟] MCIM 镜像暂不可用（HTTP ${mirrorRes.status}），本次跳过`);
      ctx.skip();
    }
    expect(mirrorRes.status).toBe(200);

    const official = (await officialRes.json()) as { hits: Array<{ project_id: string }> };
    const mirror = (await mirrorRes.json()) as { hits: Array<{ project_id: string }> };
    expect(official.hits[0]!.project_id).toBeTruthy();
    // 同一个词搜出来的第一条必须是同一个项目，否则镜像给的不是同一份数据
    expect(mirror.hits[0]!.project_id).toBe(official.hits[0]!.project_id);

    // 版本里的文件直链（官方给的）→ 过一遍映射表 → 镜像上真的取得到
    const versionsRes = await fetch(`${MIRROR_MODRINTH_API}/project/sodium/version?limit=1`);
    expect(versionsRes.status).toBe(200);
    const versions = (await versionsRes.json()) as Array<{
      files: Array<{ url: string }>;
    }>;
    const officialFile = versions[0]!.files[0]!.url;
    const mirroredFile = mirrorUrlOf(officialFile);
    expect(mirroredFile).not.toBeNull();

    const ranges = await Promise.all([
      fetch(officialFile, { headers: { Range: 'bytes=0-1023' } }),
      fetch(mirroredFile as string, { headers: { Range: 'bytes=0-1023' } }),
    ]);
    // 206 = 支持 Range（我们下载就是这么取片的）
    expect(ranges[0].status).toBe(206);
    expect(ranges[1].status).toBe(206);
    const [a, b] = await Promise.all([ranges[0].arrayBuffer(), ranges[1].arrayBuffer()]);
    // 同一段字节：镜像没有偷换内容
    expect(new Uint8Array(b)).toEqual(new Uint8Array(a));
  }, 30_000);
});
