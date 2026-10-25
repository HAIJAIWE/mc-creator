/**
 * 皮肤链接规范化 / 识别 测试。
 *
 * ## 这些测试钉的都是**实测过**的 URL 形状
 *
 * 不是想象的：
 * - `i.mcmod.cn` 的图实测是 **WebP**（content-type: image/webp），
 *   所以「按链接导入」不转换就 100% 报「不是有效的皮肤 PNG」。
 * - `@宽x高.扩展名` 缩放后缀是实测抓 MC百科 页面拿到的真实形状
 *   （`…_sbCO.jpg@480x300.jpg`）。
 * - `access-control-allow-origin: *`，所以渲染层能自己拉下来转 PNG。
 */
import { describe, it, expect } from 'vitest';

import { normalizeSkinLink, extractMcmodImageUrls, isMcmodPageUrl, parseHttpUrl } from './link.js';

/** 实测从 mcmod.cn 页面抓到的真实 URL。 */
const MCMOD_COVER = 'https://i.mcmod.cn/class/cover/20190524/1558673139_18255_sbCO.jpg';
const MCMOD_COVER_THUMB = `${MCMOD_COVER}@480x300.jpg`;
const MCMOD_EDITOR_IMG = 'https://i.mcmod.cn/editor/upload/20250609/1749459531_39335_gIcw.webp';

describe('normalizeSkinLink', () => {
  it('MC百科缩略图去掉 @宽x高 后缀（否则下到的是缩放图，尺寸校验必拒）', () => {
    const r = normalizeSkinLink(MCMOD_COVER_THUMB);
    expect(r.url).toBe(MCMOD_COVER);
    expect(r.normalized).toBe(true);
  });

  it('各种缩放尺寸都能去', () => {
    for (const suffix of ['@64x64.png', '@128x128.webp', '@480x300.jpg', '@1200x900.jpeg']) {
      const r = normalizeSkinLink(`${MCMOD_COVER}${suffix}`);
      expect(r.url, suffix).toBe(MCMOD_COVER);
    }
  });

  it('没有缩放后缀的原图不动', () => {
    const r = normalizeSkinLink(MCMOD_COVER);
    expect(r.url).toBe(MCMOD_COVER);
    expect(r.normalized).toBe(false);
  });

  it('MC百科图床识别为 mcmod-image', () => {
    expect(normalizeSkinLink(MCMOD_EDITOR_IMG).kind).toBe('mcmod-image');
  });

  it('MC百科站点域名识别为 page（不是图片，fetch 会拿到 HTML）', () => {
    expect(normalizeSkinLink('https://www.mcmod.cn/class/883.html').kind).toBe('mcmod-page');
    expect(normalizeSkinLink('https://www.mcmod.cn/post/5223.html').kind).toBe('mcmod-page');
    expect(normalizeSkinLink('https://mcmod.cn/class/1.html').kind).toBe('mcmod-page');
    expect(normalizeSkinLink('https://bbs.mcmod.cn/forum.php').kind).toBe('mcmod-page');
  });

  it('MC百科页面链接不给出 url（不能拿它当图片 fetch）', () => {
    const r = normalizeSkinLink('https://www.mcmod.cn/class/883.html');
    expect(r.url).toBeNull();
  });

  it('Mojang texture 直链当 direct', () => {
    const r = normalizeSkinLink('https://textures.minecraft.net/texture/708b8d30');
    expect(r.kind).toBe('direct');
    expect(r.url).toBe('https://textures.minecraft.net/texture/708b8d30');
  });

  it('http 升 https（渲染进程 CSP 不放行 http 的图片）', () => {
    const r = normalizeSkinLink('http://i.mcmod.cn/a/b.png');
    expect(r.url).toBe('https://i.mcmod.cn/a/b.png');
  });

  it('空格 trim 掉（复制粘贴常带）', () => {
    expect(normalizeSkinLink(`  ${MCMOD_COVER}  `).url).toBe(MCMOD_COVER);
  });

  it('不是 URL 就是 invalid', () => {
    expect(normalizeSkinLink('').kind).toBe('invalid');
    expect(normalizeSkinLink('不是链接').kind).toBe('invalid');
    expect(normalizeSkinLink('Steve').kind).toBe('invalid');
  });

  it('非 http(s) 协议拒掉（javascript: / file: 之类）', () => {
    expect(normalizeSkinLink('javascript:alert(1)').kind).toBe('invalid');
    expect(normalizeSkinLink('file:///C:/x.png').kind).toBe('invalid');
  });

  it('保留 query（有些图床靠 ?token= 鉴权）', () => {
    const r = normalizeSkinLink('https://i.mcmod.cn/a/b.png?sig=abc');
    expect(r.url).toBe('https://i.mcmod.cn/a/b.png?sig=abc');
  });

  it('带缩放后缀又有 query 时也去得掉', () => {
    const r = normalizeSkinLink(`${MCMOD_COVER}@64x64.png?x=1`);
    expect(r.url).toBe(MCMOD_COVER + '?x=1');
  });

  it('不会误伤正常 URL 里的 @（比如 user@host 形状的路径）', () => {
    const u = 'https://example.invalid/user@host/skin.png';
    expect(normalizeSkinLink(u).url).toBe(u);
  });
});

describe('extractMcmodImageUrls', () => {
  it('从页面 HTML 里挑出图床图，并去掉缩放后缀', () => {
    const html = `
      <img src="${MCMOD_COVER_THUMB}">
      <img src="${MCMOD_EDITOR_IMG}">
      <img src="https://www.mcmod.cn/static/logo.png">
      <img src="https://i.mcmod.cn/x/y.png@64x64.png">
    `;
    const out = extractMcmodImageUrls(html);
    expect(out).toContain(MCMOD_COVER);
    expect(out).toContain(MCMOD_EDITOR_IMG);
    expect(out).toContain('https://i.mcmod.cn/x/y.png');
    // 站内静态图（logo 等）不是用户上传内容，排除
    expect(out.some((u) => u.includes('/static/'))).toBe(false);
  });

  it('去重', () => {
    const html = `<img src="${MCMOD_COVER}"><img src="${MCMOD_COVER_THUMB}">`;
    expect(extractMcmodImageUrls(html)).toEqual([MCMOD_COVER]);
  });

  it('没有图就返回空数组', () => {
    expect(extractMcmodImageUrls('<p>什么都没有</p>')).toEqual([]);
  });
});

describe('辅助', () => {
  it('isMcmodPageUrl', () => {
    expect(isMcmodPageUrl('https://www.mcmod.cn/post/1.html')).toBe(true);
    expect(isMcmodPageUrl('https://i.mcmod.cn/a.png')).toBe(false);
    expect(isMcmodPageUrl('https://example.invalid/')).toBe(false);
  });

  it('parseHttpUrl 拒非法输入', () => {
    expect(parseHttpUrl('')).toBeNull();
    expect(parseHttpUrl('abc')).toBeNull();
    expect(parseHttpUrl('ftp://x')).toBeNull();
    expect(parseHttpUrl('https://a.b')?.hostname).toBe('a.b');
  });
});
