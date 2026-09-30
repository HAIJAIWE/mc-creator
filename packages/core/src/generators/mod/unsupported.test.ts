import { describe, it, expect } from 'vitest';
import {
  UNSUPPORTED_REASONS,
  formatUnsupportedComment,
  collectUnimplemented,
  unimplementedWarning,
} from './unsupported.js';
import { ModGenerator } from './mod-generator.js';
import { ModSpec } from '@mc-creator/shared';
import type { GeneratorContext } from '@mc-creator/shared';

describe('unsupported（Task 1.1 显性占位）', () => {
  it('原因表固定 5 条（禁止自由文本 TODO）', () => {
    expect(Object.keys(UNSUPPORTED_REASONS)).toEqual([
      'UNKNOWN_CONDITION',
      'UNKNOWN_ACTION',
      'UNKNOWN_EVENT',
      'CUSTOM_EMPTY',
      'CUSTOM_EVENT',
    ]);
  });

  it('占位注释统一格式且为 Java 行注释', () => {
    const c = formatUnsupportedComment('action', 'weird_action', 'UNKNOWN_ACTION');
    expect(c.startsWith('// MC-Creator: unsupported(action=weird_action): ')).toBe(true);
    expect(c).toContain('docs/unsupported.md#unknown-action');
  });

  it('常规 spec 收集为空（11 条件/13 动作/13 事件全覆盖）', () => {
    const out = collectUnimplemented(
      {
        conditions: [{ conditionId: 'c1', conditionType: 'has_item', args: {} }],
        actions: [{ actionId: 'a1', actionType: 'give_item', args: {} }],
        eventHandlers: [{ handlerId: 'h1', eventType: 'player_join' }],
      },
      'fabric',
    );
    expect(out).toEqual([]);
  });

  it('未知类型 + 空 custom + custom 事件被登记', () => {
    const out = collectUnimplemented(
      {
        conditions: [
          { conditionId: 'c1', conditionType: 'no_such_cond', args: {} },
          { conditionId: 'c2', conditionType: 'custom', customCode: '   ' },
        ],
        actions: [{ actionId: 'a1', actionType: 'no_such_action', args: {} }],
        eventHandlers: [{ handlerId: 'h1', eventType: 'custom' }],
      },
      'neoforge',
    );
    expect(out.map((o) => `${o.kind}=${o.type}`).sort()).toEqual([
      'action=no_such_action',
      'condition=custom',
      'condition=no_such_cond',
      'event=custom',
    ]);
    // custom 事件原因携带 loader
    expect(out.find((o) => o.kind === 'event')!.reason).toContain('neoforge');
  });

  it('warning 文案含 id 与原因', () => {
    expect(unimplementedWarning({ kind: 'event', type: 'custom', id: 'h1', reason: 'R' })).toBe(
      '未实现event=custom（id=h1）：R',
    );
  });
});

describe('ModGenerator unimplemented 透传', () => {
  const gen = new ModGenerator();

  function ctxWith(specPatch: Record<string, unknown>): GeneratorContext {
    const spec = ModSpec.parse({
      modId: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'demo',
      items: [],
      blocks: [],
      ...specPatch,
    });
    return { loader: 'fabric', mcVersion: '1.21.1', modId: 'demo', spec, projectPath: '/proj' };
  }

  it('无占位时 unimplemented 为空数组', async () => {
    const result = await gen.generate(ctxWith({}));
    expect(result.unimplemented ?? []).toEqual([]);
  });

  it('custom 事件登记条目 + warnings 同步', async () => {
    const result = await gen.generate(
      ctxWith({
        eventHandlers: [{ handlerId: 'h1', eventType: 'custom', eventArgs: {} }],
      }),
    );
    expect(result.unimplemented!.length).toBe(1);
    expect(result.unimplemented![0]).toMatchObject({ kind: 'event', type: 'custom', id: 'h1' });
    expect(result.warnings.some((w) => w.includes('未实现event=custom'))).toBe(true);
  });

  it('generateWithCache 同样透传 unimplemented', async () => {
    const result = await gen.generateWithCache(
      ctxWith({
        actions: [{ actionId: 'a9', actionType: 'custom', args: {}, customCode: '' }],
      }),
    );
    expect(result.unimplemented!.length).toBe(1);
    expect(result.unimplemented![0]).toMatchObject({ kind: 'action', type: 'custom' });
  });

  it('未知动作类型产物用显性注释（无裸 TODO）', async () => {
    // 防御路径：未知枚举值过不了 ModSpec.parse/IPC 校验，只能 direct 调用到达生成器；
    // 此处绕过 parse，验证生成器回退注释为显性格式而非裸 TODO
    const spec = {
      modId: 'demo',
      version: '1.0.0',
      name: 'Demo',
      description: 'demo',
      items: [],
      blocks: [],
      actions: [{ actionId: 'a1', actionType: 'no_such_action', args: {} }],
    } as unknown as ModSpec;
    const result = await gen.generate({
      loader: 'fabric',
      mcVersion: '1.21.1',
      modId: 'demo',
      spec,
      projectPath: '/proj',
    });
    const events = result.files.find((f) => f.path.endsWith('ModEvents.java'));
    expect(events!.content).toContain('MC-Creator: unsupported(action=no_such_action)');
    expect(events!.content).not.toContain('// TODO: 实现 no_such_action');
  });
});
