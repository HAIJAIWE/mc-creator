/**
 * 「按链接导入皮肤」的共用逻辑测试。
 *
 * ## 为什么值得单测
 *
 * 这条链上**每一步都会静默失败**，而且失败现象离原因很远：
 *
 * - 不 strip `@宽x高` → 下到缩略图 → 报「尺寸不对」（用户：图明明是好的）
 * - 不识别页面链接 → 把 HTML 当图片解 → 报「解不了这张图片」（用户：？）
 * - 不在渲染层转 PNG → WebP 过不了 PNG magic → 报「不是有效的皮肤 PNG」
 *   （用户：这链接在浏览器里能打开啊）
 *
 * 三个错误信息全都不指向真正的原因，所以必须把顺序钉住：
 * **规范化 → 转 PNG → 落库**。
 *
 * `loadSkinPngAsBase64` 依赖 `fetch`/`createImageBitmap`/canvas，jsdom 里没有，
 * 所以这里只测**可控的那一半**（规范化 + 分流 + 错误透传），转换本身那条
 * 留给真实环境与 `link.test.ts` 的 URL 形状断言兜着。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('./skin-image-loader.js', () => ({
  loadSkinPngAsBase64: vi.fn(),
  SkinConvertError: class SkinConvertError extends Error {},
}));

import { importSkinFromUrl, describeSkinLink } from './skin-url-import.js';
import { loadSkinPngAsBase64, SkinConvertError } from './skin-image-loader.js';
import { normalizeSkinLink } from '@mc-creator/core/skin/link';

const mockConvert = vi.mocked(loadSkinPngAsBase64);

const MCMOD_IMG = 'https://i.mcmod.cn/editor/upload/20250609/1749458645_39335_iqBC.png';

function deps() {
  return { addByUrl: vi.fn(async () => ({ entry: { id: 's1', name: 'x' } })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConvert.mockResolvedValue('BASE64PNGDATA');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('importSkinFromUrl', () => {
  it('正常路径：先规范化，再转 PNG，最后带规范化后的 url 落库', async () => {
    const add = vi.fn(async () => ({ entry: { id: 's1', name: 'x' } }));
    const r = await importSkinFromUrl(MCMOD_IMG, { addByUrl: add });
    expect(r.ok).toBe(true);
    // 传给主进程的是**规范化后**的 url（去掉了可能的缩放后缀、升了 https）
    expect(add).toHaveBeenCalledWith({ url: MCMOD_IMG, pngBase64: 'BASE64PNGDATA' });
    expect(r.entryId).toBe('s1');
  });

  it('缩放后缀链接：传给主进程的是去掉后缀的原图', async () => {
    const add = vi.fn(async () => ({ entry: { id: 's1', name: 'x' } }));
    await importSkinFromUrl(`${MCMOD_IMG}@480x300.png`, { addByUrl: add });
    expect(add).toHaveBeenCalledWith({ url: MCMOD_IMG, pngBase64: 'BASE64PNGDATA' });
  });

  /** 这是「MC百科 链接全报不是 PNG」的直接原因，必须钉住。 */
  it('转 PNG 这一步真的做了（MC百科 图是 WebP，不转就过不了 magic 校验）', async () => {
    await importSkinFromUrl(MCMOD_IMG, deps());
    expect(mockConvert).toHaveBeenCalledWith(MCMOD_IMG);
  });

  it('MC百科 页面链接被拦下，并告诉用户去复制图片地址', async () => {
    const add = vi.fn(async () => ({ entry: { id: 's1', name: 'x' } }));
    const r = await importSkinFromUrl('https://www.mcmod.cn/post/5223.html', { addByUrl: add });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/页面.*不是图片|复制图片地址/);
    // 没转、没落库
    expect(mockConvert).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
  });

  it('不是 URL 就拒', async () => {
    const r = await importSkinFromUrl('Steve', deps());
    expect(r.ok).toBe(false);
    expect(mockConvert).not.toHaveBeenCalled();
  });

  it('转换失败时把渲染层的中文错误原样透出（别只说「导入失败」）', async () => {
    mockConvert.mockRejectedValue(
      new SkinConvertError('当前浏览器解不了这张图片（格式不受支持或文件损坏）'),
    );
    const r = await importSkinFromUrl(MCMOD_IMG, deps());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('解不了这张图片');
  });

  it('转换抛的是普通 Error 也接得住', async () => {
    mockConvert.mockRejectedValue(new Error('boom'));
    const r = await importSkinFromUrl(MCMOD_IMG, deps());
    expect(r.ok).toBe(false);
    expect(r.error).toContain('boom');
  });

  it('IPC 返回 error 时如实带出', async () => {
    const r = await importSkinFromUrl(MCMOD_IMG, {
      addByUrl: async () => ({ error: '皮肤文件缺失' }),
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('皮肤文件缺失');
  });

  it('IPC 抛异常也接得住', async () => {
    const r = await importSkinFromUrl(MCMOD_IMG, {
      addByUrl: async () => {
        throw new Error('IPC 炸了');
      },
    });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('IPC 炸了');
  });

  it('成功但 entry 为空时也算 ok（entryId 为 undefined，不给选择器乱指）', async () => {
    const r = await importSkinFromUrl(MCMOD_IMG, { addByUrl: async () => ({ entry: null }) });
    expect(r.ok).toBe(true);
    expect(r.entryId).toBeUndefined();
  });

  it('http 升到 https 后再转（渲染进程 CSP 不放行 http）', async () => {
    await importSkinFromUrl('http://i.mcmod.cn/a/b.png', deps());
    expect(mockConvert).toHaveBeenCalledWith('https://i.mcmod.cn/a/b.png');
  });
});

describe('describeSkinLink', () => {
  it('页面链接给出可操作提示（告诉用户怎么拿直链）', () => {
    const hint = describeSkinLink(normalizeSkinLink('https://www.mcmod.cn/class/883.html'));
    expect(hint).toMatch(/页面/);
    expect(hint).toMatch(/复制图片地址/);
  });

  it('直链没有提示', () => {
    expect(describeSkinLink(normalizeSkinLink(MCMOD_IMG))).toBeNull();
    expect(
      describeSkinLink(normalizeSkinLink('https://textures.minecraft.net/texture/x')),
    ).toBeNull();
  });

  it('非法输入也有提示', () => {
    expect(describeSkinLink(normalizeSkinLink('abc'))).toMatch(/不是有效的图片链接/);
  });
});
