// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { GenerateFilesRes, GenerateSpecRes } from '../../../shared/ipc-channels.js';

describe('ipcClient 预览模式', () => {
  beforeEach(() => {
    (window as unknown as { __MC_PREVIEW__?: boolean }).__MC_PREVIEW__ = true;
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

  it('generateSpec 预览下按关键词生成 mod spec', async () => {
    const { ipcClient } = await import('./ipc-client.js');
    const res: GenerateSpecRes = await ipcClient.generateSpec('加一个红宝石剑', 'mod');
    expect(res.ok).toBe(true);
    expect(res.spec).toBeDefined();
    const spec = res.spec as { modId: string; items: unknown[] };
    expect(spec.modId).toBe('ruby');
    expect(spec.items.length).toBeGreaterThan(0);
  });

  it('generateSpec 预览下按关键词生成 behavior_entity spec', async () => {
    const { ipcClient } = await import('./ipc-client.js');
    const res: GenerateSpecRes = await ipcClient.generateSpec(
      '加一个友好的老虎实体',
      'behavior_entity',
    );
    expect(res.ok).toBe(true);
    const spec = res.spec as { entities: { hostile: boolean }[] };
    expect(spec.entities[0].hostile).toBe(false);
  });

  it('generateSpec 预览下未知类型返回错误', async () => {
    const { ipcClient } = await import('./ipc-client.js');
    const res: GenerateSpecRes = await ipcClient.generateSpec('test', 'not_a_type' as never);
    expect(res.ok).toBe(false);
    expect(res.error).toContain('未知生成器类型');
  });
});
