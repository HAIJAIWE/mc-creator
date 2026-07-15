import { describe, it, expect } from 'vitest';
import {
  GenerateSpecRequest,
  GenerateFilesRequest,
  BuildRequest,
  PrepareBuildDirRequest,
  ExportProjectRequest,
  ExportProjectResponse,
  ImportProjectResponse,
  CurseForgeSearchRequest,
  CurseForgeSearchResponse,
  CurseForgeFilesRequest,
  CurseForgeFilesResponse,
  CurseForgeConfigSchema,
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

  // === P29 CurseForge schema ===
  it('CurseForgeSearchRequest/Response 校验', () => {
    // Request：query 必填，loader/mcVersion/limit 可选
    expect(CurseForgeSearchRequest.safeParse({ query: 'sodium' }).success).toBe(true);
    expect(
      CurseForgeSearchRequest.safeParse({
        query: 'sodium',
        loader: 'fabric',
        mcVersion: '1.21.1',
        limit: 5,
      }).success,
    ).toBe(true);
    // query 缺失拒绝
    expect(CurseForgeSearchRequest.safeParse({ loader: 'fabric' }).success).toBe(false);
    // limit 默认 20
    const withDefault = CurseForgeSearchRequest.safeParse({ query: 'x' });
    expect(withDefault.success).toBe(true);
    if (withDefault.success) expect(withDefault.data.limit).toBe(20);

    // Response：hits 数组
    expect(
      CurseForgeSearchResponse.safeParse({ hits: [] }).success,
    ).toBe(true);
    expect(
      CurseForgeSearchResponse.safeParse({
        hits: [
          {
            id: 1,
            name: 'JEI',
            summary: 's',
            logoUrl: null,
            downloadCount: 10,
            categories: ['Utility'],
          },
        ],
      }).success,
    ).toBe(true);
    // hits 缺失拒绝
    expect(CurseForgeSearchResponse.safeParse({}).success).toBe(false);
  });

  it('CurseForgeFilesRequest/Response 校验', () => {
    // Request：modId 必填
    expect(CurseForgeFilesRequest.safeParse({ modId: 123 }).success).toBe(true);
    expect(
      CurseForgeFilesRequest.safeParse({ modId: 123, loader: 'fabric', mcVersion: '1.21.1' })
        .success,
    ).toBe(true);
    // modId 缺失或非数字拒绝
    expect(CurseForgeFilesRequest.safeParse({}).success).toBe(false);
    expect(CurseForgeFilesRequest.safeParse({ modId: 'abc' }).success).toBe(false);

    // Response：files 数组
    expect(CurseForgeFilesResponse.safeParse({ files: [] }).success).toBe(true);
    expect(
      CurseForgeFilesResponse.safeParse({
        files: [
          {
            id: 1,
            displayName: 'v1',
            fileName: 'a.jar',
            fileLength: 1024,
            downloadUrl: 'https://example.com/a.jar',
            gameVersions: ['1.21.1'],
            modLoaderNames: ['Fabric'],
          },
        ],
      }).success,
    ).toBe(true);
    // files 缺失拒绝
    expect(CurseForgeFilesResponse.safeParse({}).success).toBe(false);
  });

  it('CurseForgeConfigSchema 校验 apiKey 字符串', () => {
    expect(CurseForgeConfigSchema.safeParse({ apiKey: 'xxx-yyy' }).success).toBe(true);
    expect(CurseForgeConfigSchema.safeParse({ apiKey: '' }).success).toBe(true);
    // apiKey 缺失拒绝
    expect(CurseForgeConfigSchema.safeParse({}).success).toBe(false);
    // apiKey 非字符串拒绝
    expect(CurseForgeConfigSchema.safeParse({ apiKey: 123 }).success).toBe(false);
  });
});
