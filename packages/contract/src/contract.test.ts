import { describe, expect, it } from 'vitest';
import {
  CONTENT_FAMILIES,
  LEGACY_GENERATOR_TO_KIND,
  MCP_TOOL_PERMISSIONS,
  VALIDATION_CRITERIA,
  capabilitiesFor,
} from './index.js';
import type { ContentKind } from './contract.js';

const EXPECTED_34: ContentKind[] = [
  'game-version',
  'java-runtime',
  'account',
  'cape',
  'instance',
  'world',
  'world-template',
  'modpack',
  'mod',
  'resourcepack',
  'shader',
  'datapack',
  'addon',
  'skinpack',
  'texturepack',
  'skin',
  'soundpack',
  'languagepack',
  'font',
  'structure',
  'server',
  'server-config',
  'server-plugin',
  'proxy',
  'proxy-plugin',
  'proxy-config',
  'server-backup',
  'server-task',
  'mod-project',
  'plugin-project',
  'build-artifact',
  'dev-toolchain',
  'mapping-set',
  'test-harness',
];

describe('contract §3 薄契约', () => {
  it('ContentKind 共 34 类（v3.1 更正值）', () => {
    expect(EXPECTED_34).toHaveLength(34);
    // ProxyPlugin 必须存在（§24 修订 #1/#9）
    expect(EXPECTED_34).toContain('proxy-plugin');
  });

  it('CONTENT_FAMILIES 覆盖全部 34 类且无遗漏', () => {
    const flat = Object.values(CONTENT_FAMILIES).flat();
    expect(new Set(flat).size).toBe(34);
    for (const k of EXPECTED_34) expect(flat).toContain(k);
  });

  it('四内核 capabilities() 互不相同（§2.2 禁止为对称而抽象）', () => {
    const java = capabilitiesFor('java')
      .filter((c) => c.supported)
      .map((c) => c.kind);
    const bedrock = capabilitiesFor('bedrock')
      .filter((c) => c.supported)
      .map((c) => c.kind);
    const server = capabilitiesFor('server')
      .filter((c) => c.supported)
      .map((c) => c.kind);
    const devkit = capabilitiesFor('devkit')
      .filter((c) => c.supported)
      .map((c) => c.kind);
    // java 必装，其余可选（§2.2）
    expect(java).toContain('instance');
    expect(bedrock).toContain('addon');
    expect(server).toContain('server-plugin');
    expect(server).toContain('proxy-plugin');
    expect(devkit).toContain('build-artifact');
    // Bedrock 不做通用文件管理：不支持 server-plugin
    expect(bedrock).not.toContain('server-plugin');
  });

  it('现有 14 生成器全部映射到 ContentKind（改造保留依据）', () => {
    // 13 → 14：2026-10 补上 SkinPackGenerator 后在 LEGACY_GENERATOR_TO_KIND
    // 登记了第 14 个条目 `skinpack`。这条断言的作用是「新增生成器必须在此登记」，
    // 所以数量是**字面量**（改它等于显式声明「我又加了一个」）。
    expect(Object.keys(LEGACY_GENERATOR_TO_KIND)).toHaveLength(14);
    for (const kind of Object.values(LEGACY_GENERATOR_TO_KIND)) {
      expect(EXPECTED_34).toContain(kind);
    }
    // skinpack 映射到自己的 kind，不能并进 'addon' ——
    // 皮肤包的 manifest 模块类型是 skin_pack，与 add-on 的 resources/data 不同。
    expect(LEGACY_GENERATOR_TO_KIND.skinpack).toBe('skinpack');
  });

  it('MCP 工具权限分级 R/W/X 完整（§10.6）', () => {
    expect(MCP_TOOL_PERMISSIONS['read_logs']).toBe('R');
    expect(MCP_TOOL_PERMISSIONS['install_mod']).toBe('W');
    expect(MCP_TOOL_PERMISSIONS['build_project']).toBe('X');
    expect(MCP_TOOL_PERMISSIONS['generate_content']).toBe('X');
  });

  it('验证判据覆盖 5 类产物（§10.3）', () => {
    expect(Object.keys(VALIDATION_CRITERIA)).toEqual(
      expect.arrayContaining(['datapack', 'addon', 'server-plugin', 'server-mod', 'client-mod']),
    );
  });
});
