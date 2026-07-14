import { describe, it, expect } from 'vitest';
import { GenerateSpecRequest, GenerateFilesRequest, BuildRequest, PrepareBuildDirRequest } from './ipc-channels.js';

describe('IPC schema 校验', () => {
  it('GenerateSpecRequest 校验描述非空', () => {
    expect(GenerateSpecRequest.safeParse({ description: '做一个 mod' }).success).toBe(true);
    expect(GenerateSpecRequest.safeParse({ description: '' }).success).toBe(false);
  });

  it('GenerateFilesRequest 校验 loader 枚举', () => {
    const valid = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      spec: { modId: 'demo', version: '1.0.0', name: 'Demo', description: '', items: [], blocks: [] },
    };
    expect(GenerateFilesRequest.safeParse(valid).success).toBe(true);
    expect(GenerateFilesRequest.safeParse({ ...valid, loader: 'forge' }).success).toBe(false);
  });

  it('GenerateFilesRequest 默认 generatorType 为 mod', () => {
    const valid = {
      loader: 'fabric',
      mcVersion: '1.21.11',
      spec: { modId: 'demo', version: '1.0.0', name: 'Demo', description: '', items: [], blocks: [] },
    };
    const result = GenerateFilesRequest.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.generatorType).toBe('mod');
    }
  });

  it('BuildRequest 校验路径非空', () => {
    expect(BuildRequest.safeParse({ projectPath: '/proj' }).success).toBe(true);
    expect(BuildRequest.safeParse({ projectPath: '' }).success).toBe(false);
  });

  it('PrepareBuildDirRequest 校验 files 非空数组', () => {
    expect(PrepareBuildDirRequest.safeParse({ files: [{ path: 'a.txt', content: 'hi' }] }).success).toBe(true);
    expect(PrepareBuildDirRequest.safeParse({ files: [] }).success).toBe(true);
    expect(PrepareBuildDirRequest.safeParse({ files: [{ path: 'a.txt' }] }).success).toBe(false);
    expect(PrepareBuildDirRequest.safeParse({}).success).toBe(false);
  });
});
