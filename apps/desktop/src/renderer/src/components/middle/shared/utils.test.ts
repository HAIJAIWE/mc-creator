// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { findDuplicates, downloadBlob } from './utils.js';

describe('shared/utils', () => {
  describe('findDuplicates', () => {
    it('空数组返回空结果', () => {
      expect(findDuplicates([], (x) => x)).toEqual([]);
    });

    it('无重复时返回空结果', () => {
      const items = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
      expect(findDuplicates(items, (i) => i.id)).toEqual([]);
    });

    it('检测出所有重复项及次数', () => {
      const items = [
        { id: 'ruby' },
        { id: 'sapphire' },
        { id: 'ruby' },
        { id: 'sapphire' },
        { id: 'sapphire' },
        { id: 'emerald' },
      ];
      const dupes = findDuplicates(items, (i) => i.id);
      expect(dupes).toHaveLength(2);
      // Map 插入顺序保留，ruby 先达到 2 次
      expect(dupes[0]).toEqual({ id: 'ruby', count: 2 });
      expect(dupes[1]).toEqual({ id: 'sapphire', count: 3 });
    });

    it('支持字符串数组直接 keyFn', () => {
      expect(findDuplicates(['a', 'b', 'a', 'c', 'b', 'b'], (x) => x)).toEqual([
        { id: 'a', count: 2 },
        { id: 'b', count: 3 },
      ]);
    });

    it('支持数字 key', () => {
      const items = [{ num: 1 }, { num: 2 }, { num: 1 }];
      const dupes = findDuplicates(items, (i) => String(i.num));
      expect(dupes).toEqual([{ id: '1', count: 2 }]);
    });
  });

  describe('downloadBlob', () => {
    it('触发 a.click() 下载文件', () => {
      // 不 mock document.createElement（Electron 的 electron.d.ts 给 createElement
      // 增加了 'webview': WebviewTag 重载，会让 mockReturnValue 类型推断失败）。
      // 改为 spy HTMLAnchorElement.prototype.click，避免类型冲突。
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);
      const createObjectURLSpy = vi.fn(() => 'blob:test');
      const revokeObjectURLSpy = vi.fn();
      vi.stubGlobal('URL', {
        createObjectURL: createObjectURLSpy,
        revokeObjectURL: revokeObjectURLSpy,
      });

      downloadBlob('hello', 'test.txt');

      expect(createObjectURLSpy).toHaveBeenCalledOnce();
      expect(revokeObjectURLSpy).toHaveBeenCalledWith('blob:test');
      expect(clickSpy).toHaveBeenCalledOnce();

      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('使用默认 text/plain MIME', () => {
      const blobSpy = vi.fn();
      vi.stubGlobal('Blob', function (parts: BlobPart[], options?: BlobPropertyBag) {
        blobSpy(parts, options);
        return { size: 0, type: options?.type ?? '' };
      });
      // jsdom 默认未实现 URL.createObjectURL，需要 stub
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      downloadBlob('content', 'file.txt');

      expect(blobSpy).toHaveBeenCalledWith(['content'], { type: 'text/plain' });

      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    });

    it('支持自定义 MIME', () => {
      const blobSpy = vi.fn();
      vi.stubGlobal('Blob', function (parts: BlobPart[], options?: BlobPropertyBag) {
        blobSpy(parts, options);
        return { size: 0, type: options?.type ?? '' };
      });
      vi.stubGlobal('URL', {
        createObjectURL: vi.fn(() => 'blob:test'),
        revokeObjectURL: vi.fn(),
      });
      const clickSpy = vi
        .spyOn(HTMLAnchorElement.prototype, 'click')
        .mockImplementation(() => undefined);

      downloadBlob('{"a":1}', 'data.json', 'application/json');

      expect(blobSpy).toHaveBeenCalledWith(['{"a":1}'], { type: 'application/json' });

      clickSpy.mockRestore();
      vi.unstubAllGlobals();
    });
  });
});
