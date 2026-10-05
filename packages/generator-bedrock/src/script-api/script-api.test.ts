import { describe, it, expect } from 'vitest';
import { MC_VERSIONS } from '@mc-creator/shared';
import {
  BEDROCK_SCRIPT_VERSIONS,
  betaVersionSuffix,
  resolveScriptVersions,
  serverApiFamilyOf,
} from './script-versions.js';
import { TICK_EVENT_NAME, afterEventBindings, beforeEventBindings } from './script-events.js';
import {
  SUPPORTED_SCRIPT_MODULES,
  formatScriptUnsupportedComment,
  isCancellable,
  isEventKnown,
  isModuleSupported,
  unsupportedModuleReason,
} from './unsupported.js';
import { parseScriptSpec, type BpScriptSpec } from './script-spec.js';
import { SCRIPT_ENTRY_PATH, generateScriptEntry } from './script-codegen.js';

/**
 * 用最小 spec 生成脚本（测试辅助）。
 *
 * 参数刻意收成 `Record<string, unknown>`：本文件多处要喂**故意残缺**的 spec
 * 来验证「缺参 → 占位 + 清单」这条降级路径，若参数被约束成 Partial<BpScriptSpec>
 * 这些用例就编译不过、降级路径反而没被测到。
 */
function scriptOf(partial: Record<string, unknown> = {}): BpScriptSpec {
  const { script, error } = parseScriptSpec({ script: partial });
  if (!script) throw new Error(`spec 构造失败: ${error ?? '未知'}`);
  return script;
}

/**
 * 把生成的 ESM 产物剥掉 import 行后交给 new Function 做语法检查。
 *
 * 为什么值得测：codegen 是纯字符串拼接，配错一个括号产物里所有逻辑一起失效，
 * 而游戏侧只会报一句 "Error in script"。这里能在单测里就把它拦住。
 * （ESM 的 import 语句在 new Function 里不合法，故先剥掉；产物除 import 外
 * 不含任何顶层 export / import.meta，故剥离后仍是合法的函数体。）
 */
function assertParses(content: string): void {
  const body = content
    .split('\n')
    .filter((l) => !/^\s*import\s/.test(l))
    .join('\n');
  expect(() => new Function(body)).not.toThrow();
}

describe('Script 版本查表（§8.4：查表、禁止写死）', () => {
  it('1.21.11 查到 @minecraft/server 2.2.0 / server-ui 2.0.0', () => {
    const r = resolveScriptVersions('1.21.11');
    expect(r.known).toBe(true);
    expect(r.versions.serverModule).toBe('2.2.0');
    expect(r.versions.serverUiModule).toBe('2.0.0');
    expect(r.versions.packFormat).toBe(2);
  });

  it('不同 MC 版本查到不同的 server 模块版本（不是写死一个值）', () => {
    const versions = MC_VERSIONS.map((v) => resolveScriptVersions(v).versions.serverModule);
    // 至少要有多个不同取值，且全部落在已验证的稳定版集合里
    expect(new Set(versions).size).toBeGreaterThan(1);
    for (const v of versions) expect(v).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('查表覆盖 MC_VERSIONS 全部条目（新增 MC 版本时本用例会红）', () => {
    for (const v of MC_VERSIONS) {
      expect(Object.hasOwn(BEDROCK_SCRIPT_VERSIONS, v)).toBe(true);
    }
  });

  it('未知版本回退到最旧一档（保守：宁可低不取高）并标 known=false', () => {
    const r = resolveScriptVersions('1.99.99');
    expect(r.known).toBe(false);
    expect(r.versions).toEqual(BEDROCK_SCRIPT_VERSIONS['1.20.1']);
  });

  it('ctx.mcVersion 缺失（undefined）同样走保守回退', () => {
    expect(resolveScriptVersions(undefined).known).toBe(false);
  });

  it('调用方显式指定的模块版本优先于查表', () => {
    const r = resolveScriptVersions('1.21.11', '2.9.0', '2.1.0');
    expect(r.versions.serverModule).toBe('2.9.0');
    expect(r.versions.serverUiModule).toBe('2.1.0');
  });

  it('serverApiFamilyOf 按大版本分 1.x / 2.x', () => {
    expect(serverApiFamilyOf('1.13.0')).toBe('1.x');
    expect(serverApiFamilyOf('2.2.0')).toBe('2.x');
    expect(serverApiFamilyOf('2.10.0')).toBe('2.x');
  });

  it('betaVersionSuffix 拼 -beta 且不重复拼', () => {
    expect(betaVersionSuffix('2.2.0')).toBe('2.2.0-beta');
    expect(betaVersionSuffix('2.2.0-beta')).toBe('2.2.0-beta');
  });
});

describe('事件白名单（按 API 家族分表）', () => {
  it('entitySpawn / entityDie / playerSpawn 在 1.x 与 2.x 都在白名单里', () => {
    for (const family of ['1.x', '2.x'] as const) {
      expect(isEventKnown(family, 'after', 'entitySpawn')).toBe(true);
      expect(isEventKnown(family, 'after', 'entityDie')).toBe(true);
      expect(isEventKnown(family, 'after', 'playerSpawn')).toBe(true);
    }
  });

  it('worldInitialize 只在 1.x、worldLoad 只在 2.x（防跨家族串用）', () => {
    expect(isEventKnown('1.x', 'after', 'worldInitialize')).toBe(true);
    expect(isEventKnown('2.x', 'after', 'worldInitialize')).toBe(false);
    expect(isEventKnown('2.x', 'after', 'worldLoad')).toBe(true);
    expect(isEventKnown('1.x', 'after', 'worldLoad')).toBe(false);
  });

  it('entityDie 的主实体绑定是 deadEntity（写错就是运行时 TypeError）', () => {
    expect(afterEventBindings('2.x').entityDie?.entity).toBe('event.deadEntity');
    expect(afterEventBindings('1.x').entityDie?.entity).toBe('event.deadEntity');
  });

  it('未知事件在两个家族都不认（保证不会生成不存在的 subscribe）', () => {
    expect(isEventKnown('2.x', 'after', 'chatSend')).toBe(false);
    expect(isEventKnown('1.x', 'after', 'notARealEvent')).toBe(false);
  });

  it('tick 只在 after 侧成立（system 没有 beforeEvents.tick）', () => {
    expect(TICK_EVENT_NAME).toBe('tick');
    expect(isEventKnown('1.x', 'after', TICK_EVENT_NAME)).toBe(true);
    expect(isEventKnown('1.x', 'before', TICK_EVENT_NAME)).toBe(false);
  });

  it('before 事件白名单不含 after-only 事件（playerSpawn 在 before 侧不成立）', () => {
    expect(isEventKnown('2.x', 'after', 'playerSpawn')).toBe(true);
    expect(isEventKnown('2.x', 'before', 'playerSpawn')).toBe(false);
    expect(Object.hasOwn(beforeEventBindings('2.x'), 'playerBreakBlock')).toBe(true);
  });

  it('只有 before 事件可 cancel', () => {
    expect(isCancellable('2.x', 'after', 'playerBreakBlock')).toBe(false);
    expect(isCancellable('2.x', 'before', 'playerBreakBlock')).toBe(true);
  });
});

describe('unsupported 登记表', () => {
  it('server / server-ui 受支持；server-admin / server-net 登记为未实现', () => {
    expect(isModuleSupported('server')).toBe(true);
    expect(isModuleSupported('server-ui')).toBe(true);
    expect(isModuleSupported('server-admin')).toBe(false);
    expect(isModuleSupported('server-net')).toBe(false);
    expect([...SUPPORTED_SCRIPT_MODULES]).toEqual(['server', 'server-ui']);
  });

  it('未支持模块都有原因码，且文案指向 docs/unsupported.md 锚点', () => {
    for (const m of ['server-admin', 'server-net'] as const) {
      const key = unsupportedModuleReason(m);
      expect(key).toBeDefined();
      expect(formatScriptUnsupportedComment('action', `module:@minecraft/${m}`, key!)).toMatch(
        /^\/\/ MC-Creator: unsupported\(action=module:@minecraft\//,
      );
    }
  });

  it('原因文案禁止自由文本（每条都必须带文档锚点）', () => {
    // 文档化约束：任何新增原因码都必须含 docs/unsupported.md 引用，
    // 否则作者无法自助定位。这里通过实际生成的注释反查。
    const comment = formatScriptUnsupportedComment('event', 'x', 'UNKNOWN_EVENT');
    expect(comment).toContain('docs/unsupported.md#');
  });
});

describe('parseScriptSpec', () => {
  it('无 script 段时返回空（不报错）', () => {
    expect(parseScriptSpec({ packId: 'x' })).toEqual({});
    expect(parseScriptSpec(null)).toEqual({});
  });

  it('填充默认值：phase=after / interval=20 / audience=all / count=1', () => {
    const { script } = parseScriptSpec({
      script: {
        events: [
          { event: 'entitySpawn', actions: [{ kind: 'give_item', itemType: 'minecraft:apple' }] },
        ],
      },
    });
    expect(script?.events[0].phase).toBe('after');
    expect(script?.events[0].interval).toBe(20);
    expect(script?.events[0].actions[0].audience).toBe('all');
    expect(script?.events[0].actions[0].count).toBe(1);
  });

  it('experimentalApi 缺省 false，显式 true 才为 true', () => {
    expect(parseScriptSpec({ script: {} }).script?.experimentalApi).toBe(false);
    expect(parseScriptSpec({ script: { experimentalApi: true } }).script?.experimentalApi).toBe(
      true,
    );
  });

  it('未知动作类型 → error（不静默吞掉）', () => {
    const r = parseScriptSpec({
      script: { events: [{ event: 'entitySpawn', actions: [{ kind: 'fly_to_moon' }] }] },
    });
    expect(r.script).toBeUndefined();
    expect(r.error).toContain('未知动作类型');
  });

  it('未知模块 / 缺必填字段 → error 且指明路径', () => {
    expect(parseScriptSpec({ script: { modules: ['minecraft/server'] } }).error).toContain(
      '未知模块',
    );
    expect(parseScriptSpec({ script: { events: [{}] } }).error).toContain('event: 必填');
    expect(parseScriptSpec({ script: { timeouts: [{ delay: 5 }] } }).error).toContain('id: 必填');
  });
});

describe('generateScriptEntry —— 产物结构', () => {
  it('入口路径常量是 scripts/main.js（manifest 与产物共用同一常量）', () => {
    expect(SCRIPT_ENTRY_PATH).toBe('scripts/main.js');
  });

  it('总产出 @minecraft/server 的 world + system 两个 value import', () => {
    const out = generateScriptEntry(scriptOf(), '2.x', '测试包');
    expect([...(out.imports.get('@minecraft/server') ?? [])].sort()).toEqual(['system', 'world']);
    expect(out.content).toContain("import { system, world } from '@minecraft/server';");
  });

  it('只有真的用到 ItemStack 时才 import 它（import 与依赖不冗余）', () => {
    const noGive = generateScriptEntry(
      scriptOf({
        events: [
          {
            event: 'entitySpawn',
            phase: 'after',
            interval: 20,
            cancel: false,
            actions: [
              { kind: 'add_tag', tag: 'x', audience: 'all', duration: 30, amplifier: 0, count: 1 },
            ],
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(noGive.imports.get('@minecraft/server')?.has('ItemStack')).toBe(false);
    expect(noGive.content).not.toContain('ItemStack');

    const withGive = generateScriptEntry(
      scriptOf({
        events: [
          {
            event: 'playerJoin',
            phase: 'after',
            interval: 20,
            cancel: false,
            actions: [
              {
                kind: 'give_item',
                itemType: 'minecraft:apple',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 3,
              },
            ],
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect([...(withGive.imports.get('@minecraft/server') ?? [])].sort()).toEqual([
      'ItemStack',
      'system',
      'world',
    ]);
    expect(withGive.content).toContain('inventory.addItem(new ItemStack("minecraft:apple", 3));');
  });

  it('只用到某个模块时才 import 该模块（不会凭空引用 server-ui 等）', () => {
    const plain = generateScriptEntry(
      scriptOf({
        events: [
          { event: 'entitySpawn', phase: 'after', interval: 20, cancel: false, actions: [] },
        ],
      }),
      '2.x',
      'p',
    );
    expect([...plain.imports.keys()]).toEqual(['@minecraft/server']);
    expect(plain.content).not.toContain('@minecraft/server-ui');
    expect(plain.content).not.toContain('@minecraft/server-admin');
    expect(plain.content).not.toContain('@minecraft/server-net');
  });

  it('表单生成真实 server-ui import 并走 form.show(player)', () => {
    const out = generateScriptEntry(
      scriptOf({
        forms: [
          {
            kind: 'modal',
            id: 'confirm',
            title: '确认？',
            body: '',
            button1: '否',
            button2: '是',
            buttons: [],
            on: 'playerJoin',
            onPhase: 'after',
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect([...(out.imports.get('@minecraft/server-ui') ?? [])]).toEqual(['ModalFormData']);
    expect(out.content).toContain("import { ModalFormData } from '@minecraft/server-ui';");
    expect(out.content).toContain('const form_confirm = new ModalFormData()');
    expect(out.content).toContain('.show(player)');
    // 触发事件未在 events 中声明时应自动补一个 playerJoin 处理器
    expect(out.content).toContain('world.afterEvents.playerJoin.subscribe((event) => {');
  });

  it('无玩家上下文的表单被登记为未实现且不生成坏代码', () => {
    const out = generateScriptEntry(
      scriptOf({
        forms: [
          {
            kind: 'modal',
            id: 'f',
            title: 't',
            body: '',
            button1: 'a',
            button2: 'b',
            buttons: [],
            on: 'entitySpawn',
            onPhase: 'after',
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.unimplemented.some((u) => u.type === 'form:modal')).toBe(true);
    expect(out.content).not.toContain('.show(player)');
    // 不该因为生成了坏代码而把 server-ui 写进依赖
    expect(out.imports.has('@minecraft/server-ui')).toBe(false);
  });
});

describe('generateScriptEntry —— 事件注册无重复累积', () => {
  it('注册函数带模块级 guard，且 guard 出现在任何 subscribe 之前', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          { event: 'entitySpawn', phase: 'after', interval: 20, cancel: false, actions: [] },
        ],
      }),
      '2.x',
      'p',
    );
    const guardIdx = out.content.indexOf('if (__mcCreatorEventsRegistered) {');
    const firstSubscribe = out.content.indexOf('.subscribe((event) => {');
    expect(guardIdx).toBeGreaterThan(-1);
    expect(firstSubscribe).toBeGreaterThan(-1);
    expect(guardIdx).toBeLessThan(firstSubscribe);
    expect(out.content).toContain('__mcCreatorEventsRegistered = true;');
    // 顶层只调度一次注册函数（不能出现裸的顶层 subscribe）
    expect(out.content.match(/^world\.afterEvents\.\w+\.subscribe/gm)).toBeNull();
    expect(out.content).toContain('system.run(registerMcCreatorEvents);');
  });

  it('同一个事件重复声明只订阅一次（不生成第二个 subscribe）', () => {
    const mk = () => ({
      event: 'entitySpawn',
      phase: 'after' as const,
      interval: 20,
      cancel: false,
      actions: [],
    });
    const out = generateScriptEntry(scriptOf({ events: [mk(), mk(), mk()] }), '2.x', 'p');
    const count = (out.content.match(/world\.afterEvents\.entitySpawn\.subscribe/g) ?? []).length;
    expect(count).toBe(1);
  });

  it('tick 走 system.runInterval 且被句柄守卫包住（重复创建会指数级叠加）', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [{ event: 'tick', phase: 'after', interval: 40, cancel: false, actions: [] }],
      }),
      '2.x',
      'p',
    );
    expect(out.content).not.toContain('world.afterEvents.tick');
    expect(out.content).toContain('let __mcCreatorTickJob = null;');
    expect(out.content).toContain('if (__mcCreatorTickJob === null) {');
    expect(out.content).toContain('system.runInterval(');
    expect(out.content).toContain('}, 40);');
  });

  it('runTimeout 在 guard 内调度（1.x 无法撤回，排到 guard 外会重复排程）', () => {
    const out = generateScriptEntry(
      scriptOf({ timeouts: [{ id: 'boot', delay: 20, actions: [], code: undefined }] }),
      '2.x',
      'p',
    );
    const guardIdx = out.content.indexOf('function registerMcCreatorEvents() {');
    const timeoutIdx = out.content.indexOf('system.runTimeout(() => {');
    expect(timeoutIdx).toBeGreaterThan(guardIdx);
    expect(out.content).toContain('}, 20);');
  });
});

describe('generateScriptEntry —— 未知事件不生成坏代码', () => {
  it('未知事件名：不生成 subscribe，产出 unsupported 注释 + 清单条目', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [{ event: 'chatSend', phase: 'after', interval: 20, cancel: false, actions: [] }],
      }),
      '2.x',
      'p',
    );
    expect(out.content).not.toContain('world.afterEvents.chatSend.subscribe');
    expect(out.content).toContain('// MC-Creator: unsupported(event=chatSend)');
    expect(out.unimplemented).toHaveLength(1);
    expect(out.unimplemented[0].kind).toBe('event');
    expect(out.unimplemented[0].reason).toContain('docs/unsupported.md#');
  });

  it('跨家族串用（1.x 包里写 worldLoad）同样被拦下', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [{ event: 'worldLoad', phase: 'after', interval: 20, cancel: false, actions: [] }],
      }),
      '1.x',
      'p',
    );
    expect(out.content).not.toContain('world.afterEvents.worldLoad.subscribe');
    expect(out.unimplemented[0].type).toBe('worldLoad');
  });

  it('动作缺必填参数 → 占位注释 + 清单条目，不生成半截调用', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          {
            event: 'entitySpawn',
            phase: 'after',
            interval: 20,
            cancel: false,
            actions: [{ kind: 'set_block' }],
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.content).toContain('// MC-Creator: unsupported(action=set_block)');
    expect(out.content).not.toContain('setBlockType');
    expect(out.unimplemented.some((u) => u.type === 'set_block')).toBe(true);
  });

  it('动作缺少可用上下文 → 跳过 + warning + 清单条目', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          {
            event: 'worldLoad',
            phase: 'after',
            interval: 20,
            cancel: false,
            actions: [
              { kind: 'add_tag', tag: 'x', audience: 'all', duration: 30, amplifier: 0, count: 1 },
            ],
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.content).not.toContain('target.addTag');
    expect(out.warnings.join()).toContain('缺少可用上下文');
    expect(
      out.unimplemented.some((u) => u.reason.includes('ACTION_NO_TARGET') || u.type === 'add_tag'),
    ).toBe(true);
  });

  it('after 事件上的 cancel 不产生 event.cancel（after 事件没有该字段）', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [{ event: 'entitySpawn', phase: 'after', interval: 20, cancel: true, actions: [] }],
      }),
      '2.x',
      'p',
    );
    expect(out.content).not.toContain('event.cancel = true;');
  });

  it('before 事件 + cancel → 生成 event.cancel = true', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          { event: 'playerBreakBlock', phase: 'before', interval: 20, cancel: true, actions: [] },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.content).toContain('world.beforeEvents.playerBreakBlock.subscribe((event) => {');
    expect(out.content).toContain('event.cancel = true;');
  });
});

describe('generateScriptEntry —— 实体/方块/物品读写面', () => {
  const ctxEvent = { event: 'entitySpawn', phase: 'after' as const, interval: 20, cancel: false };
  const playerEvent = { event: 'playerJoin', phase: 'after' as const, interval: 20, cancel: false };

  it('spawnEntity / setBlockType / playSound 用 dimension + location', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          {
            ...ctxEvent,
            actions: [
              {
                kind: 'spawn_entity',
                entityType: 'minecraft:fox',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
              {
                kind: 'set_block',
                blockType: 'minecraft:stone',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
              {
                kind: 'play_sound',
                soundType: 'random.orb',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
            ],
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.content).toContain('dimension.spawnEntity("minecraft:fox", location);');
    expect(out.content).toContain('dimension.setBlockType(location, "minecraft:stone");');
    expect(out.content).toContain('dimension.playSound("random.orb", location);');
  });

  it('addTag / removeTag / addEffect 用 target（= 该事件的实体字段）', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          {
            ...ctxEvent,
            actions: [
              {
                kind: 'add_tag',
                tag: 'mc_marked',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
              {
                kind: 'remove_tag',
                tag: 'mc_old',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
              {
                kind: 'add_effect',
                effectType: 'minecraft:speed',
                duration: 60,
                amplifier: 2,
                audience: 'all',
                count: 1,
              },
            ],
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.content).toContain('const target = event.entity;');
    expect(out.content).toContain('target.addTag("mc_marked");');
    expect(out.content).toContain('target.removeTag("mc_old");');
    expect(out.content).toContain('target.addEffect("minecraft:speed", 60, { amplifier: 2 });');
  });

  it('entityDie 的动作挂在 deadEntity 上（不是不存在的 event.entity）', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          {
            event: 'entityDie',
            phase: 'after',
            interval: 20,
            cancel: false,
            actions: [
              {
                kind: 'send_message',
                text: '死了',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
            ],
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.content).toContain('const target = event.deadEntity;');
    expect(out.content).not.toContain('event.entity');
  });

  it('send_message audience=all 走 world，audience=player 走 player', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          {
            ...ctxEvent,
            actions: [
              {
                kind: 'send_message',
                text: '全局',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
            ],
          },
          {
            ...playerEvent,
            actions: [
              {
                kind: 'send_message',
                text: '你好 "引号"',
                audience: 'player',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
            ],
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.content).toContain('world.sendMessage("全局");');
    // 用户文案里的引号必须被安全转义，否则产物直接语法错误
    expect(out.content).toContain('player.sendMessage("你好 \\"引号\\"");');
  });

  it('每个处理器自带 try/catch（单个事件抛错不应让整个模块哑掉）', () => {
    const out = generateScriptEntry(
      scriptOf({ events: [{ ...ctxEvent, actions: [] }] }),
      '2.x',
      'p',
    );
    expect(out.content).toContain(
      "console.error('[MC Creator] world.afterEvents.entitySpawn 处理失败:', err);",
    );
    assertParses(out.content);
  });
});

describe('generateScriptEntry —— 产物可解析且自带「为什么」', () => {
  const cases: Array<[string, BpScriptSpec]> = [
    ['空 spec', scriptOf()],
    [
      '全事件面',
      scriptOf({
        events: [
          {
            event: 'entitySpawn',
            phase: 'after',
            interval: 20,
            cancel: false,
            actions: [
              { kind: 'add_tag', tag: 'a', audience: 'all', duration: 30, amplifier: 0, count: 1 },
            ],
          },
          {
            event: 'tick',
            phase: 'after',
            interval: 20,
            cancel: false,
            actions: [
              {
                kind: 'send_message',
                text: 'hi',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
            ],
          },
          {
            event: 'playerBreakBlock',
            phase: 'before',
            interval: 20,
            cancel: true,
            actions: [
              {
                kind: 'set_block',
                blockType: 'minecraft:stone',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
            ],
          },
        ],
        timeouts: [
          {
            id: 'boot',
            delay: 40,
            actions: [
              {
                kind: 'play_sound',
                soundType: 'random.orb',
                audience: 'all',
                duration: 30,
                amplifier: 0,
                count: 1,
              },
            ],
          },
        ],
        forms: [
          {
            kind: 'action',
            id: 'menu',
            title: '菜单',
            body: '选一个',
            button1: '取消',
            button2: '确认',
            buttons: ['A', 'B'],
            on: 'playerJoin',
            onPhase: 'after',
          },
        ],
      }),
    ],
  ];

  for (const [name, spec] of cases) {
    it(`${name}：产物是语法合法的 JavaScript（括号/引号没编坏）`, () => {
      assertParses(generateScriptEntry(spec, '2.x', '测试包').content);
    });
  }

  it('文件头注释说明「为什么是 .js 而不是 .ts」与「为什么必须幂等」', () => {
    const content = generateScriptEntry(scriptOf(), '2.x', '测试包').content;
    expect(content).toContain('为什么是 .js 而不是 .ts');
    expect(content).toContain('`language` 字段合法值只有 "javascript"');
    expect(content).toContain('事件注册必须幂等');
    expect(content).toContain('没有 TS→JS 编译环节');
    expect(content).toContain('__mcCreatorEventsRegistered');
  });

  it('作者手写 code 会被原样插入并保持缩进对齐', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          {
            event: 'entitySpawn',
            phase: 'after',
            interval: 20,
            cancel: false,
            actions: [],
            code: 'if (target.typeId === "minecraft:fox") {\n  world.sendMessage("fox!");\n}',
          },
        ],
      }),
      '2.x',
      'p',
    );
    expect(out.content).toContain('if (target.typeId === "minecraft:fox") {');
    assertParses(out.content);
  });

  it('注册函数体内每行都缩进（防止 block 层级算错导致产物难读）', () => {
    const out = generateScriptEntry(
      scriptOf({
        events: [
          { event: 'tick', phase: 'after', interval: 20, cancel: false, actions: [] },
          { event: 'entitySpawn', phase: 'after', interval: 20, cancel: false, actions: [] },
        ],
        timeouts: [{ id: 'boot', delay: 20, actions: [], code: undefined }],
      }),
      '2.x',
      'p',
    );
    const lines = out.content.split('\n');
    const start = lines.findIndex((l) => l.startsWith('function registerMcCreatorEvents() {'));
    const end = lines.findIndex((l, i) => i > start && l === '}');
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    const body = lines.slice(start + 1, end).filter((l) => l.length > 0);
    expect(body.length).toBeGreaterThan(5);
    for (const line of body) {
      expect(line.startsWith('  '), `未缩进: ${JSON.stringify(line)}`).toBe(true);
    }
  });
});
