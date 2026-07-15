import { describe, it, expect } from 'vitest';
import {
  GenerateSpecRequest,
  GenerateFilesRequest,
  BuildRequest,
  PrepareBuildDirRequest,
  ExportProjectRequest,
  ExportProjectResponse,
  ImportProjectResponse,
} from './ipc-channels.js';

/** 构造一个最小有效 Project（ProjectSchema 已有完整字段） */
const validProject = {
  id: 'p1',
  name: 'demo',
  generatorType: 'mod' as const,
  loader: 'fabric' as const,
  mcVersion: '1.21',
  description: 'd',
  spec: {},
  files: [],
  createdAt: '2024-01-01T00:00:00.000Z',
  updatedAt: '2024-01-01T00:00:00.000Z',
};

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

  // === P28 项目导入/导出 schema ===
  it('ExportProjectRequest 接受有效 Project', () => {
    expect(ExportProjectRequest.safeParse({ project: validProject }).success).toBe(true);
    // project 缺字段时拒绝
    expect(
      ExportProjectRequest.safeParse({ project: { ...validProject, id: undefined } }).success,
    ).toBe(false);
    // 缺 project 字段时拒绝
    expect(ExportProjectRequest.safeParse({}).success).toBe(false);
  });

  it('ExportProjectResponse 校验 ok/canceled/savedPath', () => {
    expect(
      ExportProjectResponse.safeParse({ ok: true, canceled: false, savedPath: '/x/a.zip' }).success,
    ).toBe(true);
    expect(
      ExportProjectResponse.safeParse({ ok: false, canceled: true, savedPath: null }).success,
    ).toBe(true);
    // 缺 savedPath 时拒绝
    expect(
      ExportProjectResponse.safeParse({ ok: true, canceled: false }).success,
    ).toBe(false);
  });

  it('ImportProjectResponse 校验 project 可空', () => {
    // 导入成功：project 非空
    expect(
      ImportProjectResponse.safeParse({ project: validProject, error: null }).success,
    ).toBe(true);
    // 用户取消或失败：project 为 null
    expect(
      ImportProjectResponse.safeParse({ project: null, error: null }).success,
    ).toBe(true);
    expect(
      ImportProjectResponse.safeParse({ project: null, error: 'zip 损坏' }).success,
    ).toBe(true);
    // 缺 project 字段时拒绝
    expect(ImportProjectResponse.safeParse({ error: null }).success).toBe(false);
  });
});
