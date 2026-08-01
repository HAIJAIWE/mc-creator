import { describe, it, expect } from 'vitest';
import { FabricAdapter } from './fabric-adapter.js';
import { ModSpec as ModSpecSchema } from '@mc-creator/shared';
import type { GeneratorContext, ModSpec } from '@mc-creator/shared';

const SPEC: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
});

const CTX: GeneratorContext = {
  loader: 'fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC,
  projectPath: '/proj',
};

describe('FabricAdapter 元数据与构建脚本', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('生成 fabric.mod.json', () => {
    const fmj = files.find((f) => f.path === 'src/main/resources/fabric.mod.json');
    expect(fmj).toBeDefined();
    const json = JSON.parse(fmj!.content);
    expect(json.id).toBe('ruby_tools');
    expect(json.name).toBe('Ruby Tools');
    expect(json.entrypoints.main[0]).toBe('com.example.ruby_tools.RubyToolsMod');
  });

  it('生成 build.gradle 含 fabric-loom 与 officialMojangMappings', () => {
    const bg = files.find((f) => f.path === 'build.gradle');
    expect(bg).toBeDefined();
    expect(bg!.content).toContain('fabric-loom');
    expect(bg!.content).toContain('officialMojangMappings');
  });

  it('生成 settings.gradle 与 gradle.properties', () => {
    expect(paths).toContain('settings.gradle');
    const gp = files.find((f) => f.path === 'gradle.properties');
    expect(gp).toBeDefined();
    expect(gp!.content).toContain('minecraft_version=1.21.11');
    expect(gp!.content).toContain('maven_group=com.example.ruby_tools');
  });
});

describe('FabricAdapter Java 入口与注册代码', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);

  it('生成 ModInitializer 主类', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('package com.example.ruby_tools;');
    expect(main!.content).toContain('implements ModInitializer');
    expect(main!.content).toContain('onInitialize()');
    expect(main!.content).toContain('ModItems.initialize()');
    expect(main!.content).toContain('ModBlocks.initialize()');
  });

  it('生成 ModItems（Registry.register + 每个物品）', () => {
    const items = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModItems.java',
    );
    expect(items).toBeDefined();
    expect(items!.content).toContain('Registry.register');
    expect(items!.content).toContain('RUBY');
    expect(items!.content).toContain('"ruby"');
  });

  it('生成 ModBlocks（Registry.register + 每个方块）', () => {
    const blocks = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModBlocks.java',
    );
    expect(blocks).toBeDefined();
    expect(blocks!.content).toContain('Registry.register');
    expect(blocks!.content).toContain('RUBY_BLOCK');
    expect(blocks!.content).toContain('"ruby_block"');
  });
});

describe('FabricAdapter 资源文件', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);

  it('生成 en_us.json 含物品与方块翻译键', () => {
    const lang = files.find(
      (f) => f.path === 'src/main/resources/assets/ruby_tools/lang/en_us.json',
    );
    expect(lang).toBeDefined();
    const json = JSON.parse(lang!.content);
    expect(json['item.ruby_tools.ruby']).toBe('Ruby');
    expect(json['block.ruby_tools.ruby_block']).toBe('Ruby Block');
  });

  it('生成物品模型 JSON', () => {
    const model = files.find(
      (f) => f.path === 'src/main/resources/assets/ruby_tools/models/item/ruby.json',
    );
    expect(model).toBeDefined();
    const json = JSON.parse(model!.content);
    expect(json.parent).toBe('minecraft:item/generated');
  });
});

// === P1.4 新增字段消费测试 ===

const SPEC_P14: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  customCode: [
    {
      snippetId: 'code_1',
      language: 'java',
      code: 'return 42;',
      inputSignature: { in_0: 'integer' },
      outputSignature: { out_0: 'integer' },
      methodName: 'calculateAnswer',
    },
  ],
  multiblocks: [
    {
      structureId: 'altar_1',
      displayName: 'Altar',
      width: 3,
      height: 3,
      depth: 3,
      hollow: true,
      controllerOffset: { x: 1, y: 1, z: 1 },
    },
  ],
  eventHandlers: [
    {
      handlerId: 'evt_1',
      eventType: 'player_right_click_block',
      eventArgs: { hand: 'main_hand' },
      // P1.5：通过 conditionIds/actionIds 引用顶层 conditions/actions
      conditionIds: ['cond_1'],
      actionIds: ['act_1'],
    },
  ],
  conditions: [
    {
      conditionId: 'cond_1',
      conditionType: 'has_item',
      args: { item: 'minecraft:stick' },
      invert: false,
    },
  ],
  actions: [
    {
      actionId: 'act_1',
      actionType: 'give_item',
      args: { item: 'minecraft:diamond', count: 1 },
    },
  ],
});

const CTX_P14: GeneratorContext = {
  loader: 'fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P14,
  projectPath: '/proj',
};

describe('FabricAdapter P1.4 字段消费（spec 非空时生成新文件）', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX_P14);
  const paths = files.map((f) => f.path);

  it('生成 ModCustomCode.java（customCode 非空时）', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModCustomCode.java');
    const code = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModCustomCode.java',
    );
    expect(code).toBeDefined();
    expect(code!.content).toContain('public class ModCustomCode');
    expect(code!.content).toContain('snippetId: code_1');
    // PortType integer → int，方法签名应包含 int 返回类型与 int 参数
    expect(code!.content).toContain('public static int calculateAnswer(int in_0)');
    // 原样嵌入用户代码
    expect(code!.content).toContain('return 42;');
    // 包含 initialize 占位方法
    expect(code!.content).toContain('public static void initialize()');
  });

  it('生成 ModMultiblocks.java（multiblocks 非空时）', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModMultiblocks.java');
    const mb = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModMultiblocks.java',
    );
    expect(mb).toBeDefined();
    expect(mb!.content).toContain('public class ModMultiblocks');
    expect(mb!.content).toContain('结构: altar_1 (Altar)');
    expect(mb!.content).toContain('尺寸: 3x3x3, 空心: true');
    expect(mb!.content).toContain('控制器偏移: (1, 1, 1)');
    expect(mb!.content).toContain('public static final String ALTAR_1_ID = "altar_1";');
    expect(mb!.content).toContain('public static void initialize()');
  });

  it('生成 ModEvents.java（eventHandlers 非空时）', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    expect(events!.content).toContain('public class ModEvents');
    // 事件处理器方法（handle_<handlerId>）
    expect(events!.content).toContain('事件处理器: evt_1');
    expect(events!.content).toContain('eventType: player_right_click_block');
    expect(events!.content).toContain('private static void handle_evt_1(EventContext ctx)');
    // 条件检查方法（check_<conditionId>）
    expect(events!.content).toContain('条件: cond_1');
    expect(events!.content).toContain('has_item');
    expect(events!.content).toContain('private static boolean check_cond_1(EventContext ctx)');
    // 动作执行方法（execute_<actionId>）
    expect(events!.content).toContain('动作: act_1');
    expect(events!.content).toContain('give_item');
    expect(events!.content).toContain('private static void execute_act_1(EventContext ctx)');
    // 真实 if/else 逻辑（非纯注释占位）
    expect(events!.content).toContain('if (check_cond_1(ctx))');
    expect(events!.content).toContain('execute_act_1(ctx);');
    // P1-7：has_item 条件生成真实检查逻辑（countItem），give_item 动作生成真实执行逻辑（place）
    expect(events!.content).toContain('countItem(');
    expect(events!.content).toContain('getInventory().place(');
    expect(events!.content).not.toContain('// TODO: 实现 has_item 检查逻辑');
    expect(events!.content).not.toContain('// TODO: 实现 give_item 执行逻辑');
    // initialize 方法（含 Fabric API 注册调用）
    expect(events!.content).toContain('public static void initialize()');
    // player_right_click_block 映射到 UseBlockCallback（Fabric API 1.21 真实事件）
    expect(events!.content).toContain(
      'net.fabricmc.fabric.api.event.player.UseBlockCallback.EVENT.register',
    );
    expect(events!.content).not.toContain('TODO: 注册 player_right_click_block 事件');
  });

  it('player_left_click / item_use / item_pickup 映射到真实 Fabric API', () => {
    const SPEC_EVENTS: ModSpec = ModSpecSchema.parse({
      modId: 'ruby_tools',
      version: '1.0.0',
      name: 'Ruby Tools',
      description: 'Event mapping test',
      items: [],
      blocks: [],
      license: 'MIT',
      authors: [],
      eventHandlers: [
        { handlerId: 'evt_a', eventType: 'player_left_click', eventArgs: {} },
        { handlerId: 'evt_b', eventType: 'item_use', eventArgs: {} },
        { handlerId: 'evt_c', eventType: 'item_pickup', eventArgs: {} },
      ],
      conditions: [],
      actions: [],
    });
    const files = adapter.translate({ ...CTX_P14, spec: SPEC_EVENTS });
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    expect(events!.content).toContain(
      'net.fabricmc.fabric.api.event.player.AttackBlockCallback.EVENT.register',
    );
    expect(events!.content).toContain(
      'net.fabricmc.fabric.api.event.player.UseItemCallback.EVENT.register',
    );
    expect(events!.content).toContain(
      'net.fabricmc.fabric.api.event.player.PlayerPickupItemCallback.EVENT.register',
    );
    expect(events!.content).not.toContain('TODO: 注册 player_left_click 事件');
    expect(events!.content).not.toContain('TODO: 注册 item_use 事件');
    expect(events!.content).not.toContain('TODO: 注册 item_pickup 事件');
  });

  it('事件参数绑定：回调多参数绑定为 EventContext 字段', () => {
    const SPEC_BIND: ModSpec = ModSpecSchema.parse({
      modId: 'ruby_tools',
      version: '1.0.0',
      name: 'Ruby Tools',
      description: 'Event binding test',
      items: [],
      blocks: [],
      license: 'MIT',
      authors: [],
      eventHandlers: [
        { handlerId: 'evt_break', eventType: 'block_break', eventArgs: {} },
        { handlerId: 'evt_click', eventType: 'player_right_click_block', eventArgs: {} },
        { handlerId: 'evt_use', eventType: 'item_use', eventArgs: {} },
        { handlerId: 'evt_pickup', eventType: 'item_pickup', eventArgs: {} },
        { handlerId: 'evt_tick', eventType: 'tick', eventArgs: {} },
      ],
      conditions: [],
      actions: [],
    });
    const files = adapter.translate({ ...CTX_P14, spec: SPEC_BIND });
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    // EventContext 内部类定义
    expect(events!.content).toContain('private static class EventContext');
    expect(events!.content).toContain('net.minecraft.server.level.ServerPlayer player = null;');
    // 调用签名统一为 EventContext ctx
    expect(events!.content).toContain('handle_evt_break(EventContext ctx)');
    expect(events!.content).toContain('handle_evt_tick(EventContext ctx)');
    // 各回调绑定字段（不再只传 player）
    expect(events!.content).toContain('ctx.pos = pos;');
    expect(events!.content).toContain('ctx.state = state;');
    expect(events!.content).toContain('ctx.pos = hitResult.getBlockPos();');
    expect(events!.content).toContain('ctx.stack = player.getItemInHand(hand);');
    expect(events!.content).toContain('ctx.stack = itemEntity.getItem();');
    expect(events!.content).toContain('ctx.target = itemEntity;');
    expect(events!.content).toContain('ctx.level = server.overworld();');
  });

  it('entity_death / entity_hurt 注册到 ServerLivingEntityEvents 并绑定 target', () => {
    const SPEC_DEATH: ModSpec = ModSpecSchema.parse({
      modId: 'ruby_tools',
      version: '1.0.0',
      name: 'Ruby Tools',
      description: 'Living event test',
      items: [],
      blocks: [],
      license: 'MIT',
      authors: [],
      eventHandlers: [
        { handlerId: 'evt_death', eventType: 'entity_death', eventArgs: {} },
        { handlerId: 'evt_hurt', eventType: 'entity_hurt', eventArgs: {} },
      ],
      conditions: [],
      actions: [],
    });
    const files = adapter.translate({ ...CTX_P14, spec: SPEC_DEATH });
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    expect(events!.content).toContain(
      'net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DEATH.register',
    );
    expect(events!.content).toContain(
      'net.fabricmc.fabric.api.entity.event.v1.ServerLivingEntityEvents.AFTER_DAMAGE.register',
    );
    expect(events!.content).toContain('ctx.target = entity;');
    expect(events!.content).toContain(
      'ctx.level = (net.minecraft.server.level.ServerLevel) entity.level();',
    );
    expect(events!.content).not.toContain('TODO: 注册 entity_death 事件');
    expect(events!.content).not.toContain('TODO: 注册 entity_hurt 事件');
  });

  it('block_place 生成 Mixin 类 + mixins.json + fabric.mod.json mixins 字段', () => {
    const SPEC_PLACE: ModSpec = ModSpecSchema.parse({
      modId: 'ruby_tools',
      version: '1.0.0',
      name: 'Ruby Tools',
      description: 'Block place test',
      items: [],
      blocks: [],
      license: 'MIT',
      authors: [],
      eventHandlers: [{ handlerId: 'evt_place', eventType: 'block_place', eventArgs: {} }],
      conditions: [],
      actions: [],
    });
    const files = adapter.translate({ ...CTX_P14, spec: SPEC_PLACE });
    // Mixin 类
    const mixin = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/mixin/ModBlockPlaceMixin.java',
    );
    expect(mixin).toBeDefined();
    expect(mixin!.content).toContain('@Mixin(BlockItem.class)');
    expect(mixin!.content).toContain('@Inject(method = "place", at = @At("RETURN"))');
    expect(mixin!.content).toContain('ModEvents.notifyBlockPlaced(level, pos, state, sp)');
    // mixins.json
    const mixinsJson = files.find((f) => f.path === 'src/main/resources/ruby_tools.mixins.json');
    expect(mixinsJson).toBeDefined();
    const parsed = JSON.parse(mixinsJson!.content);
    expect(parsed.package).toBe('com.example.ruby_tools.mixin');
    expect(parsed.mixins).toEqual(['ModBlockPlaceMixin']);
    // fabric.mod.json 声明 mixins 字段
    const modJson = files.find((f) => f.path === 'src/main/resources/fabric.mod.json');
    expect(modJson).toBeDefined();
    expect(JSON.parse(modJson!.content).mixins).toEqual(['ruby_tools.mixins.json']);
    // ModEvents 含通知入口（public，供 Mixin 调用）
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    expect(events!.content).toContain('public static void notifyBlockPlaced(');
    expect(events!.content).toContain('handle_evt_place(ctx);');
  });

  it('无 block_place handler 时不生成 Mixin 文件与 mixins 字段', () => {
    const files = adapter.translate(CTX_P14);
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain(
      'src/main/java/com/example/ruby_tools/mixin/ModBlockPlaceMixin.java',
    );
    expect(paths).not.toContain('src/main/resources/ruby_tools.mixins.json');
    const modJson = files.find((f) => f.path === 'src/main/resources/fabric.mod.json');
    expect(modJson).toBeDefined();
    expect(JSON.parse(modJson!.content).mixins).toBeUndefined();
  });

  it('mainClass 的 onInitialize 调用新的 initialize 方法', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('ModCustomCode.initialize()');
    expect(main!.content).toContain('ModMultiblocks.initialize()');
    expect(main!.content).toContain('ModEvents.initialize()');
  });
});

// === P1-3 过程系统测试（对标 MCreator procedure） ===

const SPEC_P13_PROC: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Procedure test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  eventHandlers: [
    {
      handlerId: 'evt_1',
      eventType: 'player_join',
      eventArgs: {},
      conditionIds: [],
      actionIds: [],
      // event 调用 grantReward 过程
      procedureCallIds: ['proc_1'],
    },
  ],
  conditions: [
    {
      conditionId: 'cond_1',
      conditionType: 'is_day',
      args: {},
      invert: false,
    },
  ],
  actions: [
    {
      actionId: 'act_1',
      actionType: 'give_item',
      args: { item: 'minecraft:diamond' },
    },
  ],
  procedures: [
    {
      procedureId: 'proc_1',
      procedureName: 'grantReward',
      displayName: '发放奖励',
      conditionIds: ['cond_1'],
      actionIds: ['act_1'],
      procedureCallIds: [],
    },
    {
      procedureId: 'proc_2',
      procedureName: 'logEvent',
      displayName: '记录事件',
      conditionIds: [],
      actionIds: [],
      // proc_2 嵌套调用 proc_1
      procedureCallIds: ['proc_1'],
    },
  ],
});

const CTX_P13_PROC: GeneratorContext = {
  loader: 'fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P13_PROC,
  projectPath: '/proj',
};

describe('FabricAdapter P1-3 过程系统（procedure 编译为 Java 方法）', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX_P13_PROC);
  const events = files.find(
    (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
  );

  it('生成 ModEvents.java（procedures 非空时）', () => {
    expect(events).toBeDefined();
    expect(events!.content).toContain('public class ModEvents');
  });

  it('过程编译为独立 Java 方法 procedure_<name>', () => {
    // grantReward 过程 → procedure_grantReward 方法
    expect(events!.content).toContain(
      'private static void procedure_grantReward(EventContext ctx)',
    );
    // logEvent 过程 → procedure_logEvent 方法
    expect(events!.content).toContain('private static void procedure_logEvent(EventContext ctx)');
  });

  it('过程方法体含条件检查与动作执行调用', () => {
    // grantReward 过程体：check_cond_1 → execute_act_1
    expect(events!.content).toContain('if (check_cond_1(ctx))');
    expect(events!.content).toContain('execute_act_1(ctx);');
  });

  it('事件处理器调用过程方法（procedureCallIds 解析为方法调用）', () => {
    // handle_evt_1 内调用 procedure_grantReward(event)
    expect(events!.content).toContain('procedure_grantReward(ctx);');
  });

  it('过程嵌套调用（procedure 调用 procedure）', () => {
    // logEvent 过程内调用 grantReward
    // 验证 procedure_logEvent 方法体内含 procedure_grantReward(ctx);
    const content = events!.content;
    const logMethodIdx = content.indexOf(
      'private static void procedure_logEvent(EventContext ctx)',
    );
    const grantMethodIdx = content.indexOf(
      'private static void procedure_grantReward(EventContext ctx)',
    );
    expect(logMethodIdx).toBeGreaterThan(-1);
    expect(grantMethodIdx).toBeGreaterThan(-1);
    // logEvent 方法体应在 grantReward 方法定义之前（procedureMethods 按数组顺序）
    // 且 logEvent 方法体内应包含对 grantReward 的调用
    const logMethodBody = content.slice(
      logMethodIdx,
      logMethodIdx < grantMethodIdx ? grantMethodIdx : content.length,
    );
    expect(logMethodBody).toContain('procedure_grantReward(ctx);');
  });

  it('过程方法有复用注释（可被 event/procedure 调用）', () => {
    expect(events!.content).toContain('可被 event/procedure 调用，复用此方法');
  });
});

// === P40 过程输入参数测试（procedure inputs + procedureCallArgs） ===

const SPEC_P40_PROC: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Procedure inputs test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  eventHandlers: [
    {
      handlerId: 'evt_1',
      eventType: 'player_join',
      eventArgs: {},
      conditionIds: [],
      actionIds: [],
      procedureCallIds: ['proc_1', 'proc_2'],
      // P40：proc_1 传 2 个参数（amount=5、item 缺省），proc_2 不传
      procedureCallArgs: { proc_1: ['5', ''] },
    },
  ],
  conditions: [],
  actions: [
    {
      actionId: 'act_1',
      actionType: 'give_item',
      args: { item: 'minecraft:diamond' },
    },
  ],
  procedures: [
    {
      procedureId: 'proc_1',
      procedureName: 'grantReward',
      displayName: '发放奖励',
      inputs: [
        { name: 'amount', type: 'int' },
        { name: 'item', type: 'string' },
      ],
      conditionIds: [],
      actionIds: ['act_1'],
      procedureCallIds: [],
    },
    {
      procedureId: 'proc_2',
      procedureName: 'nestedCall',
      displayName: '嵌套调用',
      conditionIds: [],
      actionIds: [],
      // 嵌套调用 proc_1 并传参
      procedureCallIds: ['proc_1'],
      procedureCallArgs: { proc_1: ['count', 'item'] },
    },
  ],
});

const CTX_P40_PROC: GeneratorContext = {
  loader: 'fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P40_PROC,
  projectPath: '/proj',
};

describe('FabricAdapter P40 过程输入参数', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX_P40_PROC);
  const events = files.find(
    (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
  );

  it('过程方法签名携带输入参数（ctx + 各 input 的类型化形参）', () => {
    expect(events!.content).toContain(
      'private static void procedure_grantReward(EventContext ctx, int amount, String item)',
    );
  });

  it('过程方法签名带 inputs 注释', () => {
    expect(events!.content).toContain('// inputs: ');
    expect(events!.content).toContain('"name":"amount","type":"int"');
  });

  it('事件处理器按 procedureCallArgs 传参（item 缺省回退 ""）', () => {
    expect(events!.content).toContain('procedure_grantReward(ctx, 5, "");');
  });

  it('无 inputs 的过程仍为旧签名 (EventContext ctx)', () => {
    expect(events!.content).toContain('private static void procedure_nestedCall(EventContext ctx)');
  });

  it('嵌套过程调用传参（变量表达式原样透传）', () => {
    // nestedCall 方法体内调用 grantReward(ctx, count, item);
    const content = events!.content;
    const nestedIdx = content.indexOf('private static void procedure_nestedCall(EventContext ctx)');
    expect(nestedIdx).toBeGreaterThan(-1);
    const body = content.slice(nestedIdx, content.indexOf('// === ', nestedIdx));
    expect(body).toContain('procedure_grantReward(ctx, count, item);');
  });
});

describe('FabricAdapter P1.4 字段为空时不生成新文件', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX);
  const paths = files.map((f) => f.path);

  it('不生成 ModCustomCode.java / ModMultiblocks.java / ModEvents.java', () => {
    expect(paths).not.toContain('src/main/java/com/example/ruby_tools/ModCustomCode.java');
    expect(paths).not.toContain('src/main/java/com/example/ruby_tools/ModMultiblocks.java');
    expect(paths).not.toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
  });

  it('mainClass 不调用新的 initialize 方法', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).not.toContain('ModCustomCode.initialize()');
    expect(main!.content).not.toContain('ModMultiblocks.initialize()');
    expect(main!.content).not.toContain('ModEvents.initialize()');
  });
});

// === P1.3 新增字段消费测试（recipes/entities/machines） ===

const SPEC_P13: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  recipes: [
    {
      recipeId: 'ruby_sword_recipe',
      recipeType: 'crafting_shaped',
      inputs: [
        { item: 'minecraft:iron_ingot', count: 1, slot: 'A' },
        { item: 'minecraft:stick', count: 1, slot: 'B' },
      ],
      output: 'minecraft:ruby_sword',
      outputCount: 1,
      cookTime: 200,
      experience: 0,
      pattern: ['AB', 'BA'],
    },
    {
      recipeId: 'ruby_smelt',
      recipeType: 'smelting',
      inputs: [{ item: 'minecraft:iron_ore', count: 1, slot: '' }],
      output: 'minecraft:ruby',
      outputCount: 1,
      cookTime: 400,
      experience: 0.5,
      pattern: [],
    },
  ],
  entities: [
    {
      entityId: 'ruby_golem',
      displayName: 'Ruby Golem',
      maxHealth: 100,
      attackDamage: 15,
      movementSpeed: 0.25,
      classification: 'animal',
      modelType: 'pig',
      spawnWeight: 10,
      spawnBiomes: ['plains', 'forest'],
    },
  ],
  machines: [
    {
      machineId: 'ruby_furnace',
      displayName: 'Ruby Furnace',
      energyCapacity: 20000,
      maxEnergyTransfer: 200,
      inputSlots: 1,
      outputSlots: 1,
      defaultProcessTime: 100,
      defaultEnergyPerTick: 20,
      guiWidth: 176,
      guiHeight: 166,
    },
  ],
});

const CTX_P13: GeneratorContext = {
  loader: 'fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P13,
  projectPath: '/proj',
};

describe('FabricAdapter P1.3 字段消费（recipes/entities/machines 非空时生成新文件）', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate(CTX_P13);
  const paths = files.map((f) => f.path);

  it('生成 ModRecipes.java / ModEntities.java / ModMachines.java', () => {
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModRecipes.java');
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModEntities.java');
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModMachines.java');
  });

  it('ModRecipes.java 含 recipeId（配方通过 datapack JSON 加载）', () => {
    const recipes = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModRecipes.java',
    );
    expect(recipes).toBeDefined();
    expect(recipes!.content).toContain('RUBY_SWORD_RECIPE_ID');
    expect(recipes!.content).toContain('ruby_sword_recipe');
    expect(recipes!.content).toContain('ruby_smelt');
  });

  it('ModEntities.java 含 Registry.register 与 entityId', () => {
    const entities = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEntities.java',
    );
    expect(entities).toBeDefined();
    expect(entities!.content).toContain('Registry.register');
    expect(entities!.content).toContain('ruby_golem');
    expect(entities!.content).toContain('Ruby Golem');
  });

  it('ModMachines.java 含 Registry.register 与 machineId', () => {
    const machines = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModMachines.java',
    );
    expect(machines).toBeDefined();
    expect(machines!.content).toContain('Registry.register');
    expect(machines!.content).toContain('ruby_furnace');
    expect(machines!.content).toContain('Ruby Furnace');
  });

  it('Task 2: ModMachines 含能源/槽位/加工逻辑（非空壳）', () => {
    const machines = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModMachines.java',
    );
    // BlockEntity 能源存储
    expect(machines!.content).toContain('ENERGY_CAPACITY');
    expect(machines!.content).toContain('receiveEnergy');
    expect(machines!.content).toContain('extractEnergy');
    // 加工逻辑
    expect(machines!.content).toContain('tickServer');
    expect(machines!.content).toContain('PROCESS_TIME');
    // Menu 槽位
    expect(machines!.content).toContain('quickMoveStack');
    expect(machines!.content).toContain('addSlot');
    // 无遗留 TODO 占位
    expect(machines!.content).not.toContain('// TODO');
  });

  it('mainClass 的 onInitialize 调用 P1.3 模块的 initialize', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main).toBeDefined();
    expect(main!.content).toContain('ModRecipes.initialize()');
    expect(main!.content).toContain('ModEntities.initialize()');
    expect(main!.content).toContain('ModMachines.initialize()');
  });
});

// === P1.5 真实事件处理逻辑测试（conditionIds/actionIds/invert/事件注册） ===

const SPEC_P15_INVERT: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Adds ruby tools',
  items: [
    {
      id: 'ruby',
      name: 'Ruby',
      maxStackSize: 64,
      rarity: 'common',
      maxDamage: 0,
      fuelTick: 0,
      lore: '',
    },
  ],
  blocks: [
    {
      id: 'ruby_block',
      name: 'Ruby Block',
      material: 'metal',
      hardness: 5.0,
      miningLevel: 0,
      lightLevel: 0,
      resistance: 6.0,
      soundType: 'stone',
      dropSelf: true,
      dropItem: '',
    },
  ],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  eventHandlers: [
    {
      handlerId: 'evt_inv',
      eventType: 'tick',
      eventArgs: {},
      // P1.5：引用 invert=true 的 condition
      conditionIds: ['cond_inv'],
      actionIds: ['act_inv'],
    },
  ],
  conditions: [
    {
      conditionId: 'cond_inv',
      conditionType: 'is_night',
      args: {},
      invert: true,
    },
  ],
  actions: [
    {
      actionId: 'act_inv',
      actionType: 'summon_lightning',
      args: { count: 1 },
    },
  ],
});

const CTX_P15_INVERT: GeneratorContext = {
  loader: 'fabric',
  mcVersion: '1.21.11',
  modId: 'ruby_tools',
  spec: SPEC_P15_INVERT,
  projectPath: '/proj',
};

describe('FabricAdapter P1.5 真实事件处理逻辑生成', () => {
  it('invert=true 的 condition 生成 if (!check_<id>) 语句', () => {
    const adapter = new FabricAdapter();
    const files = adapter.translate(CTX_P15_INVERT);
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    // invert: true → if (!check_cond_inv(ctx))
    expect(events!.content).toContain('if (!check_cond_inv(ctx))');
    expect(events!.content).toContain('execute_act_inv(ctx);');
    // 同时验证正向 if 不存在（避免误判）
    expect(events!.content).not.toContain('if (check_cond_inv(ctx))');
  });

  it('eventType=tick 注册到 ServerTickEvents.END_SERVER_TICK 并调用 handle_<handlerId>', () => {
    const adapter = new FabricAdapter();
    const files = adapter.translate(CTX_P15_INVERT);
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    expect(events!.content).toContain(
      'net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents.END_SERVER_TICK.register',
    );
    expect(events!.content).toContain('handle_evt_inv(ctx)');
  });

  it('eventHandlers/conditions/actions 全为空时不生成 ModEvents.java', () => {
    // CTX 是基础 spec，无 P1.4 字段（eventHandlers/conditions/actions 均默认 []）
    const adapter = new FabricAdapter();
    const files = adapter.translate(CTX);
    const paths = files.map((f) => f.path);
    expect(paths).not.toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
  });

  it('仅 conditions 非空（无 eventHandlers）时仍生成 ModEvents.java', () => {
    // 边界：conditions 非空但 eventHandlers 为空 → 仍生成（按现有 translate 逻辑）
    const specOnlyConditions = ModSpecSchema.parse({
      ...SPEC,
      conditions: [
        {
          conditionId: 'solo_cond',
          conditionType: 'is_day',
          args: {},
          invert: false,
        },
      ],
    });
    const adapter = new FabricAdapter();
    const files = adapter.translate({ ...CTX, spec: specOnlyConditions });
    const paths = files.map((f) => f.path);
    expect(paths).toContain('src/main/java/com/example/ruby_tools/ModEvents.java');
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    // 即使无 handler，check_<conditionId> 方法仍生成
    expect(events!.content).toContain('private static boolean check_solo_cond(EventContext ctx)');
  });

  it('位置/状态类条件与动作生成真实逻辑（EventContext 字段读取）', () => {
    const specCtxLogic = ModSpecSchema.parse({
      ...SPEC,
      conditions: [
        {
          conditionId: 'c_dist',
          conditionType: 'distance_less',
          args: { x: 100, y: 64, z: 0, distance: 10 },
          invert: false,
        },
        {
          conditionId: 'c_biome',
          conditionType: 'biome_is',
          args: { biome: 'minecraft:plains' },
          invert: false,
        },
        {
          conditionId: 'c_block',
          conditionType: 'block_is',
          args: { block: 'minecraft:stone' },
          invert: false,
        },
      ],
      actions: [
        {
          actionId: 'a_set',
          actionType: 'set_block',
          args: { block: 'minecraft:stone' },
        },
        {
          actionId: 'a_remove',
          actionType: 'remove_block',
          args: {},
        },
        {
          actionId: 'a_spawn',
          actionType: 'spawn_entity',
          args: { entity: 'minecraft:zombie' },
        },
        {
          actionId: 'a_sound',
          actionType: 'play_sound',
          args: { sound: 'block.note_block.pling', volume: 1, pitch: 1 },
        },
      ],
    });
    const adapter = new FabricAdapter();
    const files = adapter.translate({ ...CTX, spec: specCtxLogic });
    const events = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModEvents.java',
    );
    expect(events).toBeDefined();
    // 位置条件：从 ctx.pos 计算距离（不再是「无法提供位置上下文」TODO）
    expect(events!.content).toContain('double dx = ctx.pos.getX() - 100.0;');
    expect(events!.content).toContain('Math.sqrt(dx * dx + dy * dy + dz * dz) < 10.0');
    expect(events!.content).not.toContain('需要位置上下文');
    // 生物群系/方块条件：ctx.level.getBiome / ctx.state.is
    expect(events!.content).toContain('ctx.level.getBiome(ctx.pos).is(');
    expect(events!.content).toContain(
      'ctx.state.is(net.minecraft.core.registries.BuiltInRegistries.BLOCK.get',
    );
    // 方块操作动作：ctx.level.setBlock
    expect(events!.content).toContain('ctx.level.setBlock(ctx.pos,');
    expect(events!.content).toContain('Blocks.AIR.defaultBlockState(), 3)');
    // 实体生成/音效：ctx.level + ctx.pos
    expect(events!.content).toContain('ctx.level.addFreshEntity(');
    expect(events!.content).toContain('ctx.level.playSound(null, ctx.pos,');
    // 所有逻辑不再依赖 event instanceof 转型
    expect(events!.content).not.toContain('event instanceof');
  });
});

// === Task D: 流体 ===

const SPEC_P40_FLUID: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Fluid test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  fluids: [
    {
      fluidId: 'ruby_juice',
      displayName: 'Ruby Juice',
      color: 0xff0000,
      temperature: 300,
      viscosity: 1000,
      density: 1000,
      luminous: false,
    },
  ],
});

describe('FabricAdapter Task D 流体', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate({
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_FLUID,
    projectPath: '/proj',
  });

  it('生成 ModFluids.java 并注册流体', () => {
    const fluids = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModFluids.java',
    );
    expect(fluids).toBeDefined();
    expect(fluids!.content).toContain('public class ModFluids');
    expect(fluids!.content).toContain(
      'public static net.minecraft.world.level.material.Fluid RUBY_JUICE;',
    );
    expect(fluids!.content).toContain('BuiltInRegistries.FLUID');
    expect(fluids!.content).toContain('new SimpleFluid()');
  });

  it('mainClass 调用 ModFluids.initialize()', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModFluids.initialize();');
  });

  it('无 fluids 时不生成 ModFluids.java', () => {
    const files2 = new FabricAdapter().translate(CTX);
    expect(files2.map((f) => f.path)).not.toContain(
      'src/main/java/com/example/ruby_tools/ModFluids.java',
    );
  });
});

// === 版本切换（26.1 → Java 25）===

describe('FabricAdapter 版本切换', () => {
  it('1.21.x 生成 Java 21 构建配置', () => {
    const files21 = new FabricAdapter().translate({
      loader: 'fabric',
      mcVersion: '1.21.1',
      modId: 'ruby_tools',
      spec: SPEC_P40_FLUID,
      projectPath: '/proj',
    });
    const bg = files21.find((f) => f.path === 'build.gradle');
    expect(bg!.content).toContain('JavaVersion.VERSION_21');
    const gp = files21.find((f) => f.path === 'gradle.properties');
    expect(gp!.content).toContain('minecraft_version=1.21.1');
  });

  it('26.1 生成 Java 25 构建配置（版本感知）', () => {
    const files26 = new FabricAdapter().translate({
      loader: 'fabric',
      mcVersion: '26.1',
      modId: 'ruby_tools',
      spec: SPEC_P40_FLUID,
      projectPath: '/proj',
    });
    const bg = files26.find((f) => f.path === 'build.gradle');
    expect(bg!.content).toContain('JavaVersion.VERSION_25');
    const gp = files26.find((f) => f.path === 'gradle.properties');
    expect(gp!.content).toContain('minecraft_version=26.1');
  });

  it('26.1 使用真实 Fabric/NeoForge 版本号（2026 在线核验）', () => {
    const files26 = new FabricAdapter().translate({
      loader: 'fabric',
      mcVersion: '26.1',
      modId: 'ruby_tools',
      spec: SPEC_P40_FLUID,
      projectPath: '/proj',
    });
    const gp = files26.find((f) => f.path === 'gradle.properties');
    expect(gp!.content).toContain('loader_version=0.19.3');
    expect(gp!.content).toContain('fabric_version=0.155.2+26.1.2');
    // 26.2 也在版本列表
    const files262 = new FabricAdapter().translate({
      loader: 'fabric',
      mcVersion: '26.2',
      modId: 'ruby_tools',
      spec: SPEC_P40_FLUID,
      projectPath: '/proj',
    });
    const gp262 = files262.find((f) => f.path === 'gradle.properties');
    expect(gp262!.content).toContain('minecraft_version=26.2');
  });
});

// === Mod 侧世界生成（生物群系 + 维度）===

const SPEC_P40_WORLDGEN: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Worldgen test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  biomes: [
    {
      biomeId: 'ruby_plains',
      displayName: 'Ruby Plains',
      precipitation: 'rain',
      temperature: 0.8,
      temperatureModifier: 'none',
      downfall: 0.4,
      skyColor: 0x78a7ff,
      waterColor: 0x3f76e4,
      waterFogColor: 0x050533,
      fogColor: 0xc0d8ff,
      surfaceBuilder: 'minecraft:grass',
      category: 'plains',
      spawnWeight: 10,
      spawnDimensions: ['minecraft:overworld'],
    },
  ],
  dimensions: [
    {
      dimensionId: 'ruby_dim',
      displayName: 'Ruby Dimension',
      baseType: 'overworld',
      fixedTime: 1000,
      hasSkyLight: true,
      hasCeiling: false,
      ultrawarm: false,
      natural: true,
      coordinateScale: 1.0,
      minY: -64,
      height: 384,
      logicalHeight: 384,
      ambientLight: 0,
      piglinSafe: false,
      bedWorks: true,
      respawnAnchorWorks: false,
      effects: 'overworld',
    },
  ],
});

describe('FabricAdapter Mod 侧世界生成', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate({
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_WORLDGEN,
    projectPath: '/proj',
  });

  it('生成 ModBiomes.java 注册生物群系', () => {
    const biomes = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModBiomes.java',
    );
    expect(biomes).toBeDefined();
    expect(biomes!.content).toContain('public class ModBiomes');
    expect(biomes!.content).toContain('BuiltInRegistries.BIOME');
    expect(biomes!.content).toContain('ruby_plains');
    expect(biomes!.content).toContain('Precipitation.RAIN');
    expect(biomes!.content).toContain('0x78a7ff');
  });

  it('生成 ModDimensions.java 注册维度类型', () => {
    const dims = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModDimensions.java',
    );
    expect(dims).toBeDefined();
    expect(dims!.content).toContain('public class ModDimensions');
    expect(dims!.content).toContain('BuiltInRegistries.DIMENSION_TYPE');
    expect(dims!.content).toContain('ruby_dim');
    expect(dims!.content).toContain('OptionalLong.of(1000L)');
  });

  it('mainClass 调用 ModBiomes/ModDimensions initialize', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModBiomes.initialize();');
    expect(main!.content).toContain('ModDimensions.initialize();');
  });
});

// === Task 3: GUI 界面 ===

const SPEC_P40_GUI: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'GUI test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  guis: [
    {
      guiId: 'ruby_furnace_gui',
      displayName: 'Ruby Furnace GUI',
      width: 176,
      height: 166,
      slots: [
        { slotId: 'in_0', slotType: 'input', x: 0, y: 0 },
        { slotId: 'out_0', slotType: 'output', x: 80, y: 0 },
        { slotId: 'fuel_0', slotType: 'fuel', x: 0, y: 40 },
      ],
      showEnergyBar: true,
      showProgressBar: false,
    },
  ],
});

describe('FabricAdapter Task 3 GUI', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate({
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_GUI,
    projectPath: '/proj',
  });

  it('生成 ModGuis.java 含 Menu 槽位布局', () => {
    const guis = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModGuis.java');
    expect(guis).toBeDefined();
    expect(guis!.content).toContain('public class ModGuis');
    expect(guis!.content).toContain('RubyFurnaceGuiMenu');
    expect(guis!.content).toContain('addSlot');
    expect(guis!.content).toContain('ruby_furnace_gui');
  });

  it('ModGuis 含 Screen 渲染与能源条', () => {
    const guis = files.find((f) => f.path === 'src/main/java/com/example/ruby_tools/ModGuis.java');
    expect(guis!.content).toContain('AbstractContainerScreen');
    expect(guis!.content).toContain('renderBg');
    expect(guis!.content).toContain('energy_bar.png');
  });

  it('mainClass 调用 ModGuis.initialize()', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModGuis.initialize();');
  });
});

// === Task 4: Mod 侧结构 ===

const SPEC_P40_STRUCTURE: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Structure test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  structures: [
    {
      structureId: 'ruby_tower',
      displayName: 'Ruby Tower',
      startPool: 'ruby_tools:tower/start_pool',
      size: 7,
      maxDistance: 80,
      biomes: '#minecraft:is_overworld',
      terrainAdaptation: 'beard_thin',
      spacing: 48,
      separation: 16,
      salt: 12345,
    },
  ],
});

describe('FabricAdapter Task 4 Mod 侧结构', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate({
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_STRUCTURE,
    projectPath: '/proj',
  });

  it('生成 ModStructures.java 注册结构与结构集', () => {
    const structures = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/ModStructures.java',
    );
    expect(structures).toBeDefined();
    expect(structures!.content).toContain('public class ModStructures');
    expect(structures!.content).toContain('BuiltInRegistries.STRUCTURE');
    expect(structures!.content).toContain('BuiltInRegistries.STRUCTURE_SET');
    expect(structures!.content).toContain('ruby_tower');
    expect(structures!.content).toContain('JigsawStructure');
    expect(structures!.content).toContain('TerrainAdjustment.BEARD_THIN');
    expect(structures!.content).toContain('RandomSpreadStructurePlacement');
  });

  it('mainClass 调用 ModStructures.initialize()', () => {
    const main = files.find(
      (f) => f.path === 'src/main/java/com/example/ruby_tools/RubyToolsMod.java',
    );
    expect(main!.content).toContain('ModStructures.initialize();');
  });
});

// === T2/T5/T6: custom 代码 + 配方映射 + 自定义模型 ===

const SPEC_P40_POLISH: ModSpec = ModSpecSchema.parse({
  modId: 'ruby_tools',
  version: '1.0.0',
  name: 'Ruby Tools',
  description: 'Polish test',
  items: [],
  blocks: [],
  license: 'MIT',
  authors: [],
  credits: '',
  dependencies: [],
  website: '',
  conditions: [
    {
      conditionId: 'cond_custom',
      conditionType: 'custom',
      args: {},
      invert: false,
      customCode: 'return ctx.player != null && ctx.player.getHealth() < 5.0f;',
    },
  ],
  actions: [
    {
      actionId: 'act_custom',
      actionType: 'custom',
      args: {},
      customCode:
        'ctx.player.sendSystemMessage(net.minecraft.network.chat.Component.literal("hi"));',
    },
  ],
  machines: [
    {
      machineId: 'smelter',
      displayName: 'Smelter',
      energyCapacity: 10000,
      maxEnergyTransfer: 100,
      inputSlots: 1,
      outputSlots: 1,
      defaultProcessTime: 200,
      defaultEnergyPerTick: 10,
      guiWidth: 176,
      guiHeight: 166,
      recipeMap: { 'minecraft:iron_ore': 'minecraft:iron_ingot' },
    },
  ],
  entities: [
    {
      entityId: 'custom_mob',
      displayName: 'Custom Mob',
      maxHealth: 20,
      attackDamage: 2,
      movementSpeed: 0.3,
      classification: 'misc',
      modelType: 'custom',
      spawnWeight: 0,
      spawnBiomes: [],
    },
  ],
});

describe('FabricAdapter T2/T5/T6', () => {
  const adapter = new FabricAdapter();
  const files = adapter.translate({
    loader: 'fabric',
    mcVersion: '1.21.11',
    modId: 'ruby_tools',
    spec: SPEC_P40_POLISH,
    projectPath: '/proj',
  });

  it('T2: custom 条件代码嵌入 check_ 方法（替代 TODO）', () => {
    const events = files.find((f) => f.path.endsWith('ModEvents.java'));
    expect(events!.content).toContain(
      'return ctx.player != null && ctx.player.getHealth() < 5.0f;',
    );
    expect(events!.content).not.toContain('TODO: 实现 custom 检查逻辑');
  });

  it('T2: custom 动作代码嵌入 execute_ 方法', () => {
    const events = files.find((f) => f.path.endsWith('ModEvents.java'));
    expect(events!.content).toContain('Component.literal("hi")');
  });

  it('T5: 配方映射生成 recipeOutput switch', () => {
    const machines = files.find((f) => f.path.endsWith('ModMachines.java'));
    expect(machines!.content).toContain('recipeOutput');
    expect(machines!.content).toContain('case "minecraft:iron_ore"');
    expect(machines!.content).toContain('return "minecraft:iron_ingot"');
  });

  it('T6: custom 模型实体生成模型 JSON 骨架', () => {
    const model = files.find(
      (f) => f.path === 'src/main/resources/assets/ruby_tools/models/entity/custom_mob.json',
    );
    expect(model).toBeDefined();
    const parsed = JSON.parse(model!.content);
    expect(parsed.format_version).toBe('1.12.0');
    expect(parsed.geometry.bones).toHaveLength(1);
  });
});
