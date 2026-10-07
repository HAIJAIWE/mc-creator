/**
 * 导入网关测试（§6.2 / §6.3）。
 *
 * 判据锚在**官方参考原文**（实抓，见 import-gateway.ts 头部链接）而不是本仓的
 * 既有宽松判定。两条回归点：
 *
 * 1. `header.uuid` 判定被**收严**了。本仓 kernel-bedrock 原来用
 *    `^[0-9a-fA-F-]{32,36}$`，那会放过 `----------------`；官方只认
 *    `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`。
 * 2. `format_version` 1 是 **skin pack**（官方原文），不是「所有包都行」。
 */
import { describe, expect, it } from 'vitest';
import {
  IMPORT_FORMATS,
  checkEngineCompatibility,
  importFormatOf,
  inspectPackage,
  isAddonPair,
  isCanonicalUuid,
  normalizeUuid,
  packKindOf,
  parseManifest,
} from './import-gateway.js';

/** 官方参考里的 Behavior Pack 示例（逐字）。 */
const OFFICIAL_BP = JSON.stringify({
  format_version: 2,
  header: {
    description: 'Example vanilla behavior pack',
    name: 'Vanilla Behavior Pack',
    uuid: 'ee649bcf-256c-4013-9068-6a802b89d756',
    version: [1, 0, 0],
    min_engine_version: [1, 20, 0],
  },
  modules: [
    {
      description: 'Example behavior pack module',
      type: 'data',
      uuid: 'fa6e90c8-c925-460f-8155-c8a60b753caa',
      version: [1, 0, 0],
    },
    {
      description: 'Example client scripts module',
      type: 'client_data',
      uuid: 'c05a992e-482a-455f-898c-58bbb4975e47',
      version: [1, 0, 0],
    },
  ],
  dependencies: [
    { uuid: '66c6e9a8-3093-462a-9c36-dbb052165822', version: [1, 0, 0] },
    { module_name: '@minecraft/server', version: '1.9.0' },
  ],
  metadata: {
    authors: ['exampleAuthor'],
    license: 'MIT',
    url: 'http://www.contoso.com',
    generated_with: { example_tool: ['1.0.0', '1.1.0'] },
  },
});

/** 官方参考里的 Resource Pack 示例（逐字）。 */
const OFFICIAL_RP = JSON.stringify({
  format_version: 2,
  header: {
    description: 'Example vanilla resource pack',
    name: 'Vanilla Resource Pack',
    uuid: '66c6e9a8-3093-462a-9c36-dbb052165822',
    pack_scope: 'world',
    version: [1, 0, 0],
    min_engine_version: [1, 20, 0],
  },
  modules: [
    {
      description: 'Example vanilla resource pack',
      type: 'resources',
      uuid: '743f6949-53be-44b6-b326-398005028819',
      version: [1, 0, 0],
    },
  ],
});

describe('格式识别（§6.2 四种）', () => {
  it('恰支持 .mcpack/.mcaddon/.mcworld/.mctemplate', () => {
    expect([...IMPORT_FORMATS]).toEqual(['.mcpack', '.mcaddon', '.mcworld', '.mctemplate']);
  });

  it('按扩展名判，大小写不敏感', () => {
    expect(importFormatOf('a/b/Pack.MCPACK')).toBe('.mcpack');
    expect(importFormatOf('x.mcaddon')).toBe('.mcaddon');
    expect(importFormatOf('w.mcworld')).toBe('.mcworld');
    expect(importFormatOf('t.mctemplate')).toBe('.mctemplate');
  });

  it('不认的扩展名返回 undefined（不猜）', () => {
    expect(importFormatOf('a.zip')).toBeUndefined();
    expect(importFormatOf('a.mrpack')).toBeUndefined();
    expect(importFormatOf('manifest.json')).toBeUndefined();
    expect(importFormatOf('noext')).toBeUndefined();
  });
});

describe('uuid 判定收严到官方形状', () => {
  it('规范形状通过（含大写十六进制）', () => {
    expect(isCanonicalUuid('ee649bcf-256c-4013-9068-6a802b89d756')).toBe(true);
    expect(isCanonicalUuid('EE649BCF-256C-4013-9068-6A802B89D756')).toBe(true);
  });

  it('回归：旧宽松正则放过的形状现在必须拒', () => {
    // 这些都满足旧的 ^[0-9a-fA-F-]{32,36}$，但官方不认。
    expect(isCanonicalUuid('-'.repeat(36))).toBe(false);
    expect(isCanonicalUuid('a'.repeat(32))).toBe(false);
    expect(isCanonicalUuid('zzzzzzzz-256c-4013-9068-6a802b89d756')).toBe(false);
    expect(isCanonicalUuid('ee649bcf256c40139068 6a802b89d756')).toBe(false);
  });

  it('非字符串 / 空 / null 拒', () => {
    expect(isCanonicalUuid(123)).toBe(false);
    expect(isCanonicalUuid('')).toBe(false);
    expect(isCanonicalUuid(null)).toBe(false);
    expect(isCanonicalUuid(undefined)).toBe(false);
  });

  it('normalizeUuid 统一小写（比较用）', () => {
    expect(normalizeUuid('EE649BCF-256C-4013-9068-6A802B89D756')).toBe(
      'ee649bcf-256c-4013-9068-6a802b89d756',
    );
  });
});

describe('官方示例 manifest 可解析（不是我方生成物）', () => {
  it('官方 Behavior Pack 示例通过全检', () => {
    const r = inspectPackage({ manifestText: OFFICIAL_BP, targetVersion: [1, 21, 0] });
    expect(r.ok, r.ok ? '' : JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('behavior');
    expect(r.manifest.name).toBe('Vanilla Behavior Pack');
    expect(r.manifest.minEngineVersion).toEqual([1, 20, 0]);
    expect(r.manifest.modules).toHaveLength(2);
    // dependencies 两类都被认出来
    expect(r.manifest.dependencies).toContainEqual({
      uuid: '66c6e9a8-3093-462a-9c36-dbb052165822',
      version: [1, 0, 0],
    });
    expect(r.manifest.dependencies).toContainEqual({
      moduleName: '@minecraft/server',
      version: [1, 9, 0],
      versionRaw: '1.9.0',
    });
  });

  it('官方 Resource Pack 示例通过全检，pack_scope 保留', () => {
    const r = inspectPackage({ manifestText: OFFICIAL_RP, targetVersion: [1, 21, 0] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('resource');
    expect(r.manifest.packScope).toBe('world');
  });

  it('client_data（官方枚举表未列但示例用了）被接受', () => {
    const r = parseManifest(OFFICIAL_BP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.modules.map((m) => m.type)).toEqual(['data', 'client_data']);
  });
});

describe('format_version 语义（官方：1=skin pack，2=resource·behavior·world template）', () => {
  it('format_version 1 被识别为 skinpack', () => {
    const skin = JSON.stringify({
      format_version: 1,
      header: {
        description: 'd',
        name: 'n',
        uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        version: [1, 0, 0],
      },
      modules: [
        {
          type: 'resources',
          uuid: '11111111-2222-3333-4444-555555555555',
          version: [1, 0, 0],
        },
      ],
      skins: { default: 'skins.json' },
    });
    const r = inspectPackage({ manifestText: skin });
    expect(r.ok, r.ok ? '' : JSON.stringify(r)).toBe(true);
    if (!r.ok) return;
    expect(r.kind).toBe('skinpack');
  });

  it('format_version 缺失 / 0 / 超范围 → 报错', () => {
    for (const fv of [undefined, 0, 4]) {
      const doc = JSON.parse(OFFICIAL_BP) as Record<string, unknown>;
      if (fv === undefined) delete doc['format_version'];
      else doc['format_version'] = fv;
      const r = parseManifest(JSON.stringify(doc));
      expect(r.ok, `fv=${String(fv)}`).toBe(false);
      if (!r.ok) {
        expect(r.errors.some((e) => e.path === 'format_version')).toBe(true);
      }
    }
  });
});

describe('§6.2 校验一：manifest 完整性', () => {
  function base(over: Record<string, unknown> = {}): string {
    const doc = JSON.parse(OFFICIAL_BP) as Record<string, unknown>;
    Object.assign(doc, over);
    return JSON.stringify(doc);
  }

  it('header.name / header.description 缺失分别报错（官方 name 是必填字段）', () => {
    const doc = JSON.parse(OFFICIAL_BP) as { header: Record<string, unknown> };
    delete doc.header['name'];
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === 'header.name')).toBe(true);

    const doc2 = JSON.parse(OFFICIAL_BP) as { header: Record<string, unknown> };
    delete doc2.header['description'];
    const r2 = parseManifest(JSON.stringify(doc2));
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.errors.some((e) => e.path === 'header.description')).toBe(true);
  });

  it('header 缺失/非对象直接失败', () => {
    expect(parseManifest(base({ header: 'x' })).ok).toBe(false);
    expect(parseManifest(base({ header: [] })).ok).toBe(false);
    const noHeader = JSON.parse(OFFICIAL_BP) as Record<string, unknown>;
    delete noHeader['header'];
    expect(parseManifest(JSON.stringify(noHeader)).ok).toBe(false);
  });

  it('modules 缺失或空数组 → 报错', () => {
    expect(parseManifest(base({ modules: [] })).ok).toBe(false);
    const noMods = JSON.parse(OFFICIAL_BP) as Record<string, unknown>;
    delete noMods['modules'];
    expect(parseManifest(JSON.stringify(noMods)).ok).toBe(false);
  });

  it('modules[].type 非法枚举值报错，且列出官方取值', () => {
    const doc = JSON.parse(OFFICIAL_BP) as { modules: Record<string, unknown>[] };
    doc.modules[0]!['type'] = 'behaviour';
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors.find((x) => x.path === 'modules[0].type');
      expect(e?.message).toContain('resources');
      expect(e?.message).toContain('world_template');
    }
  });

  it('pack_scope 非法值报错（合法值 world/global/any）', () => {
    const doc = JSON.parse(OFFICIAL_RP) as { header: Record<string, unknown> };
    doc.header['pack_scope'] = 'server';
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === 'header.pack_scope')).toBe(true);
  });

  it('dependencies 项缺 uuid 与 module_name 报错', () => {
    const doc = JSON.parse(OFFICIAL_BP) as { dependencies: Record<string, unknown>[] };
    doc.dependencies = [{ version: [1, 0, 0] }];
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.path === 'dependencies[0]')).toBe(true);
  });

  it('capabilities 非法值报错（合法枚举来自官方）', () => {
    const doc = JSON.parse(OFFICIAL_BP) as Record<string, unknown>;
    doc['capabilities'] = ['shaders'];
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      const e = r.errors.find((x) => x.path === 'capabilities[0]');
      expect(e?.message).toContain('raytraced');
      expect(e?.message).toContain('pbr');
    }
  });

  it('capabilities 官方五个值全被接受', () => {
    for (const c of [
      'chemistry',
      'editorExtension',
      'experimental_custom_ui',
      'raytraced',
      'pbr',
    ]) {
      const doc = JSON.parse(OFFICIAL_BP) as Record<string, unknown>;
      doc['capabilities'] = [c];
      expect(parseManifest(JSON.stringify(doc)).ok, c).toBe(true);
    }
  });

  it('JSON 语法坏 / 顶层非对象 → 明确报错', () => {
    const bad = parseManifest('{ not json');
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors[0]?.message).toContain('JSON 解析失败');
    expect(parseManifest('[]').ok).toBe(false);
    expect(parseManifest('"str"').ok).toBe(false);
  });
});

describe('modules[].language 只在 script 且只允许 javascript（官方原文）', () => {
  function withScript(language: unknown): string {
    const doc = JSON.parse(OFFICIAL_BP) as { modules: Record<string, unknown>[] };
    doc.modules[0]!['type'] = 'script';
    if (language === undefined) delete doc.modules[0]!['language'];
    else doc.modules[0]!['language'] = language;
    return JSON.stringify(doc);
  }

  it('script + javascript 通过', () => {
    expect(parseManifest(withScript('javascript')).ok).toBe(true);
  });

  it('script + 其他语言报错并引用官方唯一支持值', () => {
    const r = parseManifest(withScript('typescript'));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain('javascript');
  });

  it('非 script 类型出现 language 报错', () => {
    const doc = JSON.parse(OFFICIAL_RP) as { modules: Record<string, unknown>[] };
    doc.modules[0]!['language'] = 'javascript';
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]?.message).toContain('script');
  });
});

describe('§6.2 校验二：uuid 唯一性', () => {
  it('模块 uuid 互相重复报错', () => {
    const doc = JSON.parse(OFFICIAL_BP) as { modules: Record<string, unknown>[] };
    doc.modules[1]!['uuid'] = doc.modules[0]!['uuid'];
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes('重复'))).toBe(true);
  });

  it('模块 uuid 等于 header.uuid 报错（官方要求不同）', () => {
    const doc = JSON.parse(OFFICIAL_BP) as {
      header: Record<string, unknown>;
      modules: Record<string, unknown>[];
    };
    doc.modules[0]!['uuid'] = doc.header['uuid'];
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.some((e) => e.message.includes('header.uuid'))).toBe(true);
  });

  it('与已装包 uuid 冲突：版本更高才允许覆盖，同级/更低被拒（官方 version 语义）', () => {
    const uuid = 'ee649bcf-256c-4013-9068-6a802b89d756';
    const installed = new Map([[uuid, [1, 0, 0] as [number, number, number]]]);
    // 更高版本 → 通过
    const higher = JSON.parse(OFFICIAL_BP) as { header: Record<string, unknown> };
    higher.header['version'] = [1, 0, 1];
    expect(parseManifest(JSON.stringify(higher), { installed }).ok).toBe(true);
    // 同级 → 拒
    const same = JSON.parse(OFFICIAL_BP) as { header: Record<string, unknown> };
    same.header['version'] = [1, 0, 0];
    const rs = parseManifest(JSON.stringify(same), { installed });
    expect(rs.ok).toBe(false);
    if (!rs.ok) expect(rs.errors[0]?.message).toContain('替换');
    // 更低 → 拒
    const lower = JSON.parse(OFFICIAL_BP) as { header: Record<string, unknown> };
    lower.header['version'] = [0, 9, 9];
    expect(parseManifest(JSON.stringify(lower), { installed }).ok).toBe(false);
  });

  it('大小写不同的同 uuid 仍判为冲突（归一后比较）', () => {
    const installed = new Map([
      ['ee649bcf-256c-4013-9068-6a802b89d756', [2, 0, 0] as [number, number, number]],
    ]);
    const doc = JSON.parse(OFFICIAL_BP) as { header: Record<string, unknown> };
    doc.header['uuid'] = 'EE649BCF-256C-4013-9068-6A802B89D756';
    doc.header['version'] = [1, 0, 0];
    expect(parseManifest(JSON.stringify(doc), { installed }).ok).toBe(false);
  });

  it('未提供 installed 时跳过该校验（不假装校验过）', () => {
    const installed = new Map([
      ['ee649bcf-256c-4013-9068-6a802b89d756', [9, 0, 0] as [number, number, number]],
    ]);
    expect(parseManifest(OFFICIAL_BP, { installed }).ok).toBe(false);
    expect(parseManifest(OFFICIAL_BP).ok).toBe(true);
  });
});

describe('§6.2 校验三：min_engine_version 兼容性', () => {
  it('behavior/resource 包缺 min_engine_version 被拒（官方必填）', () => {
    const doc = JSON.parse(OFFICIAL_BP) as { header: Record<string, unknown> };
    delete doc.header['min_engine_version'];
    const r = inspectPackage({ manifestText: JSON.stringify(doc) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0]).toContain('min_engine_version');
  });

  it('目标版本高于 min → 兼容；低于 → 不兼容且给中文原因', () => {
    const r = inspectPackage({ manifestText: OFFICIAL_BP, targetVersion: [1, 20, 0] });
    expect(r.ok).toBe(true);
    const tooOld = inspectPackage({ manifestText: OFFICIAL_BP, targetVersion: [1, 19, 0] });
    expect(tooOld.ok).toBe(false);
    if (!tooOld.ok) expect(tooOld.errors[0]).toContain('1.19.0');
  });

  it('比较是三元组逐段比，不是字符串比（1.9.0 > 1.21.0? 否）', () => {
    const p = parseManifest(OFFICIAL_BP);
    expect(p.ok).toBe(true);
    if (!p.ok) return;
    // 官方 BP 的 min 是 1.20.0：1.9.0 低于它，1.21.0 高于它
    expect(checkEngineCompatibility(p.manifest, [1, 9, 0]).compatible).toBe(false);
    expect(checkEngineCompatibility(p.manifest, [1, 21, 0]).compatible).toBe(true);
  });

  it('format_version 3 的 semver 字符串版本能被解析（官方：3 起可用字符串）', () => {
    const doc = JSON.parse(OFFICIAL_BP) as Record<string, unknown>;
    doc['format_version'] = 3;
    const header = doc['header'] as Record<string, unknown>;
    header['version'] = '2.1.0';
    header['min_engine_version'] = '1.21.0';
    const r = inspectPackage({ manifestText: JSON.stringify(doc), targetVersion: [1, 21, 0] });
    expect(r.ok, r.ok ? '' : JSON.stringify(r)).toBe(true);
    if (r.ok) expect(r.manifest.version).toEqual([2, 1, 0]);
  });

  it('skin pack 允许省略 min_engine_version（官方只对 resource/behavior 必填）', () => {
    const skin = JSON.stringify({
      format_version: 1,
      header: {
        description: 'd',
        name: 'n',
        uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        version: [1, 0, 0],
      },
      modules: [
        {
          type: 'resources',
          uuid: '11111111-2222-3333-4444-555555555555',
          version: [1, 0, 0],
        },
      ],
    });
    const r = inspectPackage({ manifestText: skin, targetVersion: [1, 9, 0] });
    expect(r.ok, r.ok ? '' : JSON.stringify(r)).toBe(true);
  });
});

describe('包类型归纳与 .mcaddon 成对判定（§6.3「成对」）', () => {
  function oneOf(type: string): string {
    return JSON.stringify({
      format_version: 2,
      header: {
        description: 'd',
        name: 'n',
        uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        version: [1, 0, 0],
        min_engine_version: [1, 20, 0],
      },
      modules: [
        {
          type,
          uuid: '11111111-2222-3333-4444-555555555555',
          version: [1, 0, 0],
        },
      ],
    });
  }

  it('data/script/client_data → behavior；resources → resource；world_template → world_template', () => {
    for (const t of ['data', 'script', 'client_data']) {
      const r = parseManifest(oneOf(t));
      expect(r.ok, t).toBe(true);
      if (r.ok) expect(packKindOf(r.manifest), t).toBe('behavior');
    }
    const rp = parseManifest(oneOf('resources'));
    expect(rp.ok).toBe(true);
    if (rp.ok) expect(packKindOf(rp.manifest)).toBe('resource');
    const wt = parseManifest(oneOf('world_template'));
    expect(wt.ok).toBe(true);
    if (wt.ok) expect(packKindOf(wt.manifest)).toBe('world_template');
  });

  it('behavior + resources 同在 → mixed，isAddonPair 为真（§6.3 成对）', () => {
    const doc = JSON.parse(OFFICIAL_BP) as { modules: Record<string, unknown>[] };
    doc.modules[0]!['type'] = 'data';
    doc.modules[1]!['type'] = 'resources';
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(packKindOf(r.manifest)).toBe('mixed');
      expect(isAddonPair(r.manifest)).toBe(true);
    }
  });

  it('单侧包不是成对', () => {
    const r = parseManifest(oneOf('data'));
    expect(r.ok).toBe(true);
    if (r.ok) expect(isAddonPair(r.manifest)).toBe(false);
  });
});

describe('错误一次性全列（不做部分接受）', () => {
  it('多处错误同返，调用方一次就能呈现', () => {
    const doc = {
      format_version: 9,
      header: { name: '', description: '', uuid: 'nope', version: 'x' },
      modules: [{ type: 'bad', uuid: 'nope2', version: 'y' }],
      capabilities: ['nope3'],
    };
    const r = parseManifest(JSON.stringify(doc));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length).toBeGreaterThanOrEqual(8);
  });
});
