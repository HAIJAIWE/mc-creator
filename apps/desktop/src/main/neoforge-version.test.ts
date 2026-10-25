// @vitest-environment node
/**
 * NeoForge 版本解析的回归用例。
 *
 * 元数据片段是**真实抓取**的（2026-10-22，`maven.neoforged.net`），
 * 不是编出来的 —— 这套编号规则有三种形状，凭空编的用例会把 bug 一起编进去。
 *
 * 关键一条：MC `1.21.1` 的 NeoForge 是 `21.1.264`（**没有**开头的 `1.`），
 * MC `26.3` 的是 `26.3.0.95`（比 MC 版本多两段）。旧实现的正则对这两种
 * 都匹配不到 —— 也就是说「装 NeoForge」在任何版本上都是坏的。
 */
import { describe, it, expect } from 'vitest';

import {
  compareVersionSegments,
  isNeoForgeVersionString,
  neoforgeInstallerUrl,
  neoforgeVersionPrefixes,
  parseMavenVersions,
  pickNeoForgeVersion,
} from './neoforge-version.js';

describe('neoforge-version · MC 版本 → NeoForge 构建号', () => {
  describe('parseMavenVersions', () => {
    it('从真实 maven-metadata 里取出全部版本号', () => {
      const meta = `<?xml version="1.0" encoding="UTF-8"?>
<metadata>
  <groupId>net.neoforged</groupId>
  <artifactId>neoforge</artifactId>
  <versioning>
    <latest>26.3.0.95</latest>
    <release>26.3.0.95</release>
    <versions>
      <version>21.1.264</version>
      <version>26.3.0.94</version>
      <version>26.3.0.95</version>
    </versions>
  </versioning>
</metadata>`;
      expect(parseMavenVersions(meta)).toEqual(['21.1.264', '26.3.0.94', '26.3.0.95']);
    });

    it('元数据为空时返回空数组（不抛）', () => {
      expect(parseMavenVersions('')).toEqual([]);
      expect(parseMavenVersions('<metadata/>')).toEqual([]);
    });
  });

  describe('neoforgeVersionPrefixes · 编号规则的两种形状', () => {
    it('MC 1.x：去掉开头的 "1."（1.21.1 → 21.1）', () => {
      expect(neoforgeVersionPrefixes('1.21.1')).toEqual(['21.1']);
      expect(neoforgeVersionPrefixes('1.20.4')).toEqual(['20.4']);
      expect(neoforgeVersionPrefixes('1.21.8')).toEqual(['21.8']);
    });

    it('MC 1.x 只有两段时补 ".0"（1.21 → 21.0）', () => {
      expect(neoforgeVersionPrefixes('1.21')).toEqual(['21.0']);
      expect(neoforgeVersionPrefixes('1.20')).toEqual(['20.0']);
    });

    it('MC 26.x：沿用 MC 版本号做前缀', () => {
      expect(neoforgeVersionPrefixes('26.3')).toEqual(['26.3']);
      expect(neoforgeVersionPrefixes('26.1')).toEqual(['26.1']);
    });

    it('快照号与空串没有对应前缀', () => {
      expect(neoforgeVersionPrefixes('26.4-snapshot-5')).toEqual([]);
      expect(neoforgeVersionPrefixes('')).toEqual([]);
    });
  });

  describe('pickNeoForgeVersion', () => {
    /** 真实元数据里的版本号（截取，够覆盖三种形状）。 */
    const versions = [
      '21.0.1-beta',
      '21.1.262',
      '21.1.263',
      '21.1.264',
      '21.11.48',
      '20.4.253',
      '26.1.2.120',
      '26.1.2.121',
      '26.1.2.122',
      '26.2.0.93',
      '26.3.0.75-beta',
      '26.3.0.76',
      '26.3.0.94',
      '26.3.0.95',
    ];

    it('MC 1.21.1 → 21.1.264（旧正则在这里 0 命中）', () => {
      expect(pickNeoForgeVersion('1.21.1', versions)).toBe('21.1.264');
    });

    it('MC 26.3 → 26.3.0.95（旧正则在这里 0 命中）', () => {
      expect(pickNeoForgeVersion('26.3', versions)).toBe('26.3.0.95');
    });

    it('MC 26.1 → 26.1.2.122（同一 MC 版本的多个修订取最高）', () => {
      expect(pickNeoForgeVersion('26.1', versions)).toBe('26.1.2.122');
    });

    it('MC 1.21 → 21.0 的预发布（没有稳定版时退而求其次）', () => {
      expect(pickNeoForgeVersion('1.21', versions)).toBe('21.0.1-beta');
    });

    it('MC 26.2 → 26.2.0.93（不串到别的 26.x）', () => {
      expect(pickNeoForgeVersion('26.2', versions)).toBe('26.2.0.93');
    });

    it('没有对应版本时返回 null（调用方据此报错，而不是瞎装一个）', () => {
      expect(pickNeoForgeVersion('1.16.5', versions)).toBeNull();
      expect(pickNeoForgeVersion('26.4-snapshot-5', versions)).toBeNull();
      expect(pickNeoForgeVersion('1.21.1', [])).toBeNull();
    });

    it('构建号按数字比：0.95 比 0.9 新（字符串比会反过来）', () => {
      expect(compareVersionSegments('26.3.0.95', '26.3.0.9')).toBeGreaterThan(0);
      expect(pickNeoForgeVersion('26.3', ['26.3.0.9', '26.3.0.95'])).toBe('26.3.0.95');
    });

    it('有稳定版时不选 -beta 预发布', () => {
      expect(pickNeoForgeVersion('26.3', ['26.3.0.75-beta', '26.3.0.76'])).toBe('26.3.0.76');
    });
  });

  describe('isNeoForgeVersionString', () => {
    it('接受 3~5 段纯数字版本号', () => {
      expect(isNeoForgeVersionString('21.1.209')).toBe(true);
      expect(isNeoForgeVersionString('26.3.0.95')).toBe(true);
    });

    it('拒绝带后缀/非数字/段数异常的', () => {
      expect(isNeoForgeVersionString('21.1.209-beta')).toBe(false);
      expect(isNeoForgeVersionString('latest')).toBe(false);
      // 两段是 MC 版本号，不是 NeoForge 版本号
      expect(isNeoForgeVersionString('21.1')).toBe(false);
    });
  });

  describe('neoforgeInstallerUrl', () => {
    it('按 maven 布局拼出 installer 地址', () => {
      expect(neoforgeInstallerUrl('26.3.0.95')).toBe(
        'https://maven.neoforged.net/releases/net/neoforged/neoforge/26.3.0.95/neoforge-26.3.0.95-installer.jar',
      );
    });
  });
});
