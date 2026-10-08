/**
 * Fabric installer 元数据解析测试。
 *
 * `REAL_MAVEN_METADATA` 是 **2026-10 从 maven.fabricmc.net 实抓的原文**（2516 字节 /
 * 80 行），不是手抄的样例 —— 手抄就等于「按想象造格式」，与 MEMORY §7.9 同一类错误。
 * 注入方式是把实测字节直接写成 TS 模板字面量。
 */
import { describe, expect, it } from 'vitest';
import {
  FABRIC_INSTALLER_ARTIFACT_ID,
  FABRIC_INSTALLER_METADATA_PATH,
  FABRIC_MAVEN_BASE,
  FabricMetadataError,
  fabricInstallerJarUrl,
  parseMavenMetadataLatest,
  parseMavenMetadataRelease,
  parseMavenMetadataVersions,
  resolveFabricInstallerRelease,
  type FabricFetchLike,
} from './fabric-installer.js';

const REAL_MAVEN_METADATA = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>net.fabricmc</groupId>
  <artifactId>fabric-installer</artifactId>
  <versioning>
    <latest>1.1.2</latest>
    <release>1.1.2</release>
    <versions>
      <version>0.2.0.7</version>
      <version>0.2.1.8</version>
      <version>0.2.1.9</version>
      <version>0.2.2.10</version>
      <version>0.2.2.11</version>
      <version>0.2.3.12</version>
      <version>0.2.4.14</version>
      <version>0.3.0.15</version>
      <version>0.3.0.16</version>
      <version>0.3.0.17</version>
      <version>0.4.0.18</version>
      <version>0.4.0.19</version>
      <version>0.4.0.20</version>
      <version>0.4.0.21</version>
      <version>0.4.1.22</version>
      <version>0.4.2.23</version>
      <version>0.4.2.24</version>
      <version>0.4.2.25</version>
      <version>0.4.2.26</version>
      <version>0.4.2.27</version>
      <version>0.4.2.28</version>
      <version>0.5.0.29</version>
      <version>0.5.0.30</version>
      <version>0.5.0.31</version>
      <version>0.5.0.32</version>
      <version>0.5.0.33</version>
      <version>0.5.0.34</version>
      <version>0.5.0.35</version>
      <version>0.5.1.36</version>
      <version>0.5.1.37</version>
      <version>0.5.2.38</version>
      <version>0.5.2.39</version>
      <version>0.5.2.40</version>
      <version>0.6.0.41</version>
      <version>0.6.0.42</version>
      <version>0.6.0.43</version>
      <version>0.6.1.44</version>
      <version>0.6.1.45</version>
      <version>0.6.1.46</version>
      <version>0.6.1.47</version>
      <version>0.6.1.48</version>
      <version>0.6.1.49</version>
      <version>0.6.1.50</version>
      <version>0.6.1.51</version>
      <version>0.7.1</version>
      <version>0.7.2</version>
      <version>0.7.3</version>
      <version>0.7.4</version>
      <version>0.8.0</version>
      <version>0.8.1</version>
      <version>0.8.2</version>
      <version>0.8.3</version>
      <version>0.9.0</version>
      <version>0.9.1</version>
      <version>0.10.0</version>
      <version>0.10.1</version>
      <version>0.10.2</version>
      <version>0.11.0</version>
      <version>0.11.1</version>
      <version>0.11.2</version>
      <version>1.0.0</version>
      <version>1.0.1</version>
      <version>1.0.2</version>
      <version>1.0.3</version>
      <version>1.1.0</version>
      <version>1.1.1</version>
      <version>1.1.2</version>
    </versions>
    <lastUpdated>20260717180312</lastUpdated>
  </versioning>
</metadata>
`;

describe('坐标常量（实测值）', () => {
  it('maven 根与坐标被字面量钉死', () => {
    expect(FABRIC_MAVEN_BASE).toBe('https://maven.fabricmc.net/net/fabricmc');
    expect(FABRIC_INSTALLER_ARTIFACT_ID).toBe('fabric-installer');
    expect(FABRIC_INSTALLER_METADATA_PATH).toBe('/fabric-installer/maven-metadata.xml');
  });
});

describe('artifact 校验：防止读到别的 artifact 的 metadata', () => {
  it('坐标不符时报错，并说明后果', () => {
    // fabric-loader 的 metadata 形状完全相同，只有坐标不同。
    // 不校验就会给出**错误的版本号** -> 拼出 404 的下载 URL（与原 bug 同型）。
    const wrong = REAL_MAVEN_METADATA.replace(
      '<artifactId>fabric-installer</artifactId>',
      '<artifactId>fabric-loader</artifactId>',
    );
    expect(() => parseMavenMetadataRelease(wrong)).toThrow(FabricMetadataError);
    expect(() => parseMavenMetadataRelease(wrong)).toThrow(/net\.fabricmc:fabric-loader/);
    const wrongGroup = REAL_MAVEN_METADATA.replace(
      '<groupId>net.fabricmc</groupId>',
      '<groupId>com.example</groupId>',
    );
    expect(() => parseMavenMetadataVersions(wrongGroup)).toThrow(/坐标/);
  });

  it('坐标缺失时报错（而不是当作 installer 放行）', () => {
    const noArtifact = REAL_MAVEN_METADATA.replace(/<artifactId>[^<]*<\/artifactId>/, '');
    expect(() => parseMavenMetadataRelease(noArtifact)).toThrow(FabricMetadataError);
  });
});

describe('<release> 解析（不用 <latest> 兜底）', () => {
  it('从实测 XML 解析出 release 与 latest', () => {
    expect(parseMavenMetadataRelease(REAL_MAVEN_METADATA)).toBe('1.1.2');
    expect(parseMavenMetadataLatest(REAL_MAVEN_METADATA)).toBe('1.1.2');
  });

  it('两者分叉时必须分别取到各自的值（实测样本里恰好相同，所以要造分叉样本）', () => {
    // 这条是**关键**：样本里 release === latest === '1.1.2'，
    // 若实现把两者混为一谈，用实测样本测**永远测不出来**。
    const forked = REAL_MAVEN_METADATA.replace(
      '<latest>1.1.2</latest>',
      '<latest>9.9.9-SNAPSHOT</latest>',
    );
    expect(parseMavenMetadataLatest(forked)).toBe('9.9.9-SNAPSHOT');
    expect(parseMavenMetadataRelease(forked)).toBe('1.1.2');
  });

  it('缺少 <release> 时报错，不静默回退到 <latest>', () => {
    const noRelease = REAL_MAVEN_METADATA.replace(/<release>[^<]*<\/release>/, '');
    expect(() => parseMavenMetadataRelease(noRelease)).toThrow(FabricMetadataError);
    expect(() => parseMavenMetadataRelease(noRelease)).toThrow(/不静默回退/);
    // 而 latest 仍然可取 —— 说明确实是「不读 release」而非整体解析失败
    expect(parseMavenMetadataLatest(noRelease)).toBe('1.1.2');
  });

  it('<release/> 空元素报错，且文案要能区分「缺失」与「为空」', () => {
    const empty = REAL_MAVEN_METADATA.replace(/<release>[^<]*<\/release>/, '<release/>');
    expect(() => parseMavenMetadataRelease(empty)).toThrow(/空元素/);
  });

  it('标签内含空白时要 trim（XML 允许排版换行）', () => {
    const padded = REAL_MAVEN_METADATA.replace(
      '<release>1.1.2</release>',
      '<release>\n      1.1.2\n    </release>',
    );
    expect(parseMavenMetadataRelease(padded)).toBe('1.1.2');
  });

  it('空输入 / 非 metadata 内容报错', () => {
    expect(() => parseMavenMetadataRelease('')).toThrow(FabricMetadataError);
    expect(() => parseMavenMetadataRelease('   ')).toThrow(/为空/);
    expect(() => parseMavenMetadataVersions('<html>404</html>')).toThrow(/坐标/);
  });
});

describe('versions 列表解析', () => {
  it('从实测 XML 解析出 67 个版本，首尾正确', () => {
    const vs = parseMavenMetadataVersions(REAL_MAVEN_METADATA);
    expect(vs.length).toBe(67);
    expect(vs[0]).toBe('0.2.0.7');
    expect(vs[vs.length - 1]).toBe('1.1.2');
  });

  it('不能把 <latest>/<release> 误当成某个版本条目', () => {
    const vs = parseMavenMetadataVersions(REAL_MAVEN_METADATA);
    expect(vs).not.toContain('latest');
    expect(vs).not.toContain('release');
    expect(vs).not.toContain('');
  });

  it('缺 </versioning> 或无 version 条目时报错', () => {
    const noClose = REAL_MAVEN_METADATA.replace('</versioning>', '');
    expect(() => parseMavenMetadataVersions(noClose)).toThrow(/versioning/);
    const emptied = REAL_MAVEN_METADATA.replace(
      /<versions>[\s\S]*?<\/versions>/,
      '<versions></versions>',
    );
    expect(() => parseMavenMetadataVersions(emptied)).toThrow(/没有任何 <version>/);
  });
});

describe('下载 URL 构造：显式拒绝 latest（实测 404 的那个）', () => {
  it('具体版本号构造出实测可用的 URL 形状', () => {
    expect(fabricInstallerJarUrl('1.1.2')).toBe(
      'https://maven.fabricmc.net/net/fabricmc/fabric-installer/1.1.2/fabric-installer-1.1.2.jar',
    );
  });

  it("传 'latest' 必须报错，并写明实测 404", () => {
    expect(() => fabricInstallerJarUrl('latest')).toThrow(FabricMetadataError);
    expect(() => fabricInstallerJarUrl('latest')).toThrow(/404/);
    expect(() => fabricInstallerJarUrl('LATEST')).toThrow(/404/);
    expect(() => fabricInstallerJarUrl('  latest  ')).toThrow(/404/);
  });

  it('空版本号报错', () => {
    expect(() => fabricInstallerJarUrl('')).toThrow(/为空/);
    expect(() => fabricInstallerJarUrl('   ')).toThrow(/为空/);
  });

  it('版本号含路径穿越/URL 注入字符时报错', () => {
    for (const bad of ['../evil', '1.1.2/../../x', 'a b', 'a?x=1', 'a#f', '-1.1', 'a/b']) {
      expect(() => fabricInstallerJarUrl(bad), bad).toThrow(/非法字符/);
    }
  });

  it('解析出的版本号总能构造出 URL（两个函数必须自洽）', () => {
    const v = parseMavenMetadataRelease(REAL_MAVEN_METADATA);
    expect(() => fabricInstallerJarUrl(v)).not.toThrow();
  });
});

describe('resolveFabricInstallerRelease', () => {
  it('打的是 maven-metadata.xml 而不是 jar，返回具体版本号与 URL', async () => {
    const seen: string[] = [];
    const spy: FabricFetchLike = async (url) => {
      seen.push(url);
      return { ok: true, status: 200, text: async () => REAL_MAVEN_METADATA };
    };
    const r = await resolveFabricInstallerRelease(spy);
    expect(seen[0]).toBe(
      'https://maven.fabricmc.net/net/fabricmc/fabric-installer/maven-metadata.xml',
    );
    expect(r.version).toBe('1.1.2');
    expect(r.url).toBe(fabricInstallerJarUrl('1.1.2'));
  });

  it('HTTP 失败时报错并带状态码', async () => {
    const bad: FabricFetchLike = async () => ({ ok: false, status: 503, text: async () => '' });
    await expect(resolveFabricInstallerRelease(bad)).rejects.toThrow(FabricMetadataError);
    try {
      await resolveFabricInstallerRelease(bad);
    } catch (e) {
      expect((e as Error).message).toContain('503');
    }
  });

  it('返回 HTML（404 页）时报错而不是解析出垃圾版本号', async () => {
    const html: FabricFetchLike = async () => ({
      ok: true,
      status: 200,
      text: async () => '<html><body>Not Found</body></html>',
    });
    await expect(resolveFabricInstallerRelease(html)).rejects.toThrow(FabricMetadataError);
  });

  it('绝不能发出指向 latest 目录的请求', async () => {
    const urls: string[] = [];
    const spy: FabricFetchLike = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, text: async () => REAL_MAVEN_METADATA };
    };
    const r = await resolveFabricInstallerRelease(spy);
    for (const u of urls) expect(u).not.toMatch(/\/latest\//);
    expect(r.url).not.toMatch(/\/latest\//);
  });
});

describe('真网络冒烟（上游此刻的真实形态）', () => {
  const netFetch: FabricFetchLike = async (url) => {
    const res = await globalThis.fetch(url);
    return { ok: res.ok, status: res.status, text: () => res.text() };
  };

  it('maven-metadata.xml 真能取到并解析出版本号', async () => {
    let r: Awaited<ReturnType<typeof resolveFabricInstallerRelease>>;
    try {
      r = await resolveFabricInstallerRelease(netFetch);
    } catch (e) {
      throw new Error(`真网络取 fabric metadata 失败：${(e as Error).message}`);
    }
    expect(r.version).toMatch(/^\d+\.\d+/);
    expect(r.url).toContain('/fabric-installer/' + r.version + '/');
  });

  it('仓库里曾用的 latest 路径实测仍是 404（死链的直接依据）', async () => {
    const res = await globalThis.fetch(
      'https://maven.fabricmc.net/net/fabricmc/fabric-installer/latest/fabric-installer.jar',
    );
    expect(res.status).toBe(404);
  });

  it('按解析出的版本号真能取到 jar（HEAD 200）', async () => {
    const r = await resolveFabricInstallerRelease(netFetch);
    const res = await globalThis.fetch(r.url, { method: 'HEAD' });
    expect(res.status).toBe(200);
  });
});
