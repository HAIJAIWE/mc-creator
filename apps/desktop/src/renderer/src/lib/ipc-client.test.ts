// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GenerateFilesRes } from '../../../shared/ipc-channels.js';

describe('ipcClient 预览模式', () => {
  beforeEach(() => {
    (window as unknown as { __MC_PREVIEW__?: boolean }).__MC_PREVIEW__ = true;
    // 预览下不应访问 mcApi（用会抛错的桩验证分支绕过）
    (window as unknown as { mcApi?: unknown }).mcApi = undefined;
    vi.resetModules();
  });

  it('generateFiles 在预览下真实生成文件（不依赖 mcApi）', async () => {
    const { ipcClient } = await import('./ipc-client.js');
    const res: GenerateFilesRes = await ipcClient.generateFiles({
      loader: 'fabric',
      mcVersion: '1.21.11',
      generatorType: 'behavior_item',
      spec: { packId: 'demo', packName: 'Demo' },
    });
    const paths = res.files.map((f) => f.path);
    expect(paths).toContain('manifest.json');
    expect(paths).toContain('texts/zh_CN.lang');
  });

  it('generateFiles 预览下非法 spec 抛中文字段级错误', async () => {
    const { ipcClient } = await import('./ipc-client.js');
    await expect(
      ipcClient.generateFiles({
        loader: 'fabric',
        mcVersion: '1.21.11',
        generatorType: 'behavior_item',
        spec: { packId: 'bad id!', packName: 'X' },
      }),
    ).rejects.toThrow(/behavior_item Spec 校验失败.*packId/);
  });

  it('generateFiles 预览下未知类型返回 warnings', async () => {
    const { ipcClient } = await import('./ipc-client.js');
    const res = await ipcClient.generateFiles({
      loader: 'fabric',
      mcVersion: '1.21.11',
      generatorType: 'not_a_type' as never,
      spec: {},
    });
    expect(res.files).toEqual([]);
    expect(res.warnings[0]).toContain('不支持的生成器类型');
  });
});
