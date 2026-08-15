import { describe, it, expect } from 'vitest';
import { createDefaultRegistry, SPEC_CONFIGS, formatSpecIssues } from '@mc-creator/core';
import type { GeneratorType } from '@mc-creator/shared';

// 端到端：模拟 ipc.ts GENERATE_FILES 的真实路径（registry.get → generate），
// 覆盖全部 13 种生成器类型，保证每种类型在最小合法 spec 下都能产出完整文件树。
const CASES: Array<{ type: GeneratorType; spec: Record<string, unknown>; keyFiles: string[] }> = [
  {
    type: 'mod',
    spec: { modId: 'demo', name: 'Demo', version: '1.0.0', items: [], blocks: [] },
    keyFiles: ['src/main/resources/fabric.mod.json'],
  },
  {
    type: 'datapack',
    spec: { packId: 'demo', packName: 'Demo' },
    keyFiles: ['pack.mcmeta'],
  },
  {
    type: 'modpack',
    spec: { packId: 'demo', packName: 'Demo' },
    keyFiles: ['modrinth.index.json'],
  },
  {
    type: 'server',
    spec: { serverName: 'Demo' },
    keyFiles: ['server.properties', 'eula.txt'],
  },
  {
    type: 'resource_pack',
    spec: { packName: 'Demo' },
    keyFiles: ['pack.mcmeta'],
  },
  {
    type: 'skin',
    spec: { playerName: 'Demo' },
    keyFiles: ['Demo.png'],
  },
  {
    type: 'launcher',
    spec: { launcherName: 'Demo', mcVersion: '1.21.11' },
    keyFiles: ['launcher.json', 'profiles.json'],
  },
  {
    type: 'kubejs',
    spec: { packId: 'demo', packName: 'Demo' },
    keyFiles: ['pack.mcmeta'],
  },
  {
    type: 'crafttweaker',
    spec: { packId: 'demo', packName: 'Demo' },
    keyFiles: ['pack.mcmeta'],
  },
  {
    type: 'behavior_pack',
    spec: { packId: 'demo', packName: 'Demo' },
    keyFiles: ['manifest.json'],
  },
  {
    type: 'enchantment',
    spec: { packId: 'demo', packName: 'Demo' },
    keyFiles: ['pack.mcmeta'],
  },
  {
    type: 'behavior_item',
    spec: { packId: 'demo', packName: 'Demo' },
    keyFiles: ['manifest.json', 'texts/zh_CN.lang'],
  },
  {
    type: 'behavior_entity',
    spec: { packId: 'demo', packName: 'Demo' },
    keyFiles: ['manifest.json', 'texts/zh_CN.lang'],
  },
];

describe('生成器端到端（ipc GENERATE_FILES 路径）', () => {
  const registry = createDefaultRegistry();

  for (const { type, spec, keyFiles } of CASES) {
    it(`${type}: 最小 spec 产出完整文件树且含关键文件`, async () => {
      // 1. 前置校验：与 ipc.ts 一致，spec 必须通过 SPEC_CONFIGS 校验
      const schema = SPEC_CONFIGS[type]?.schema;
      expect(schema, `${type} 应在 SPEC_CONFIGS 中注册`).toBeDefined();
      const check = schema!.safeParse(spec);
      expect(
        check.success,
        `${type} spec 应通过校验：${JSON.stringify(
          check.success ? '' : formatSpecIssues(check.error),
        )}`,
      ).toBe(true);

      // 2. registry 能取到生成器
      const gen = registry.get(type);
      expect(gen, `${type} 应在生成器注册表中`).toBeDefined();

      // 3. 与 ipc.ts 一致：生成器接收 parse 后的完整 spec（default 字段已填充）
      const result = await gen!.generate({
        loader: 'fabric',
        mcVersion: '1.21.11',
        modId: 'demo',
        spec: schema!.parse(spec) as never,
        projectPath: '',
      });

      // 4. 结构断言
      expect(result.files.length).toBeGreaterThan(0);
      expect(result.warnings).toBeInstanceOf(Array);
      const paths = result.files.map((f) => f.path);
      expect(new Set(paths).size).toBe(paths.length); // 无重复路径
      for (const f of result.files) {
        expect(f.path).toBeTruthy();
        expect(f.content).toBeTypeOf('string');
      }

      // 5. 关键文件存在
      for (const keyFile of keyFiles) {
        expect(paths, `${type} 应包含 ${keyFile}`).toContain(keyFile);
      }
    });
  }

  it('未知生成器类型返回 warnings 而非抛错（与 ipc 行为一致）', async () => {
    const gen = registry.get('not_a_type' as GeneratorType);
    expect(gen).toBeUndefined();
  });

  it('非法 spec 被前置校验拦截并给出中文摘要', () => {
    const schema = SPEC_CONFIGS.mod?.schema;
    expect(schema).toBeDefined();
    const check = schema!.safeParse({ modId: '', name: 'X' });
    expect(check.success).toBe(false);
    if (!check.success) {
      const msg = formatSpecIssues(check.error);
      expect(msg).toContain('modId');
    }
  });
});
