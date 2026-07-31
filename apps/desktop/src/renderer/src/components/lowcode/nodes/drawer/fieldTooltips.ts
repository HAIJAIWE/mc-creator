/**
 * 字段 MC 领域解释文本
 *
 * key 格式 `${kind}.${fieldKey}`，其中 fieldKey 与 fieldSchemas.ts 中 FieldSchema.key
 * 一致（即真实数据字段名，如 itemId / displayName / maxDamage）。
 *
 * getTooltip 先查 `${kind}.${fieldKey}`，未命中则 fallback 到 `common.${fieldKey}`，
 * 避免为 label/note/disabled 等通用字段在每个 kind 下重复定义。
 */
export const FIELD_TOOLTIPS: Record<string, string> = {
  // === 通用字段（BaseNodeData，所有 kind 共享） ===
  'common.label': '节点显示名（仅用于画布展示，不影响编译产物）',
  'common.note': '节点备注，仅文档用途，不影响编译',
  'common.disabled': '是否禁用（编译时跳过该节点）',

  // === item ===
  'item.itemId':
    '资源 ID，格式 modid:path。modid 是你的 mod 标识（如 mymod），path 是物品标识（如 iron_sword）。最终游戏内为 mymod:iron_sword',
  'item.displayName': '游戏中显示的名称（支持中文，如「红宝石剑」）',
  'item.category':
    '物品分类，决定行为模式：sword/pickaxe/axe 等工具武器、food 食物、material 材料、misc 杂项',
  'item.rarity': '稀有度，影响物品名颜色：common=白、uncommon=黄、rare=青、epic=金',
  'item.maxStackSize': '最大堆叠数量（1-64），工具/武器通常为 1，材料/食物通常为 64',
  'item.maxDamage': '最大耐久度，0 表示不可损坏。工具/武器通常 >0（如铁剑 250，钻石镐 1561）',
  'item.glow': '是否发光（附魔光辉效果，像附魔书一样发出紫色光晕）',
  'item.texturePath': '贴图路径（相对 resources/ 目录），如 assets/mymod/items/iron_sword.png',

  // === block ===
  'block.blockId': '方块 ID，格式同物品（小写+下划线），如 ruby_block',
  'block.displayName': '游戏中显示的方块名称',
  'block.hardness':
    '硬度，决定挖掘时间。硬度越高挖掘越慢，-1 表示不可破坏（如基岩），铁块 5，石头 1.5',
  'block.blastResistance': '爆炸抗性，抵抗 TNT/苦力怕爆炸的能力。石头 6，黑曜石 1200',
  'block.luminance': '发光等级（0-15），15 为最亮（类似荧石），0 为不发光',
  'block.transparent': '是否透明（如玻璃、树叶），影响渲染和光照穿透',
  'block.solid': '是否固体（可碰撞），非固体如水、空气',
  'block.modelType':
    '方块模型类型：cube_all=六面同贴图，cube_column=柱状（上下/侧面不同），cross=十字（植物），custom=自定义',
  'block.isBlockEntity': '是否为方块实体（如箱子、熔炉），可存储额外 NBT 数据，机器节点必须为 true',
  'block.texturePathTop': '顶面贴图路径',
  'block.texturePathSide': '侧面贴图路径',
  'block.texturePathBottom': '底面贴图路径',

  // === entity ===
  'entity.entityId': '实体 ID，格式同物品（小写+下划线），如 ruby_golem',
  'entity.displayName': '游戏中显示的生物名称',
  'entity.maxHealth': '最大生命值，玩家默认 20（10 颗心），僵尸 20，末影龙 200',
  'entity.attackDamage': '攻击伤害（每次攻击扣除的目标生命值）',
  'entity.movementSpeed': '移动速度，玩家默认 0.3，僵尸 0.23，猎犬 0.35',
  'entity.classification':
    '阵营：animal=动物（被动），monster=怪物（敌对），water_creature=水生，ambient=环境生物，misc=其他',
  'entity.modelType': '模型骨架：pig/zombie/skeleton/creeper/cow 或 custom（自定义）',
  'entity.spawnWeight': '生成权重（0=不自然生成，越大越常见）',
  'entity.spawnBiomes': '可生成的生物群系列表（如 plains、forest），空表示所有群系',
  'entity.texturePath': '生物贴图路径',

  // === recipe ===
  'recipe.recipeId': '配方 ID，格式同物品，如 ruby_sword_recipe',
  'recipe.recipeType':
    '配方类型：crafting_shaped=有序合成，crafting_shapeless=无序合成，smelting=熔炉烧炼，blasting=高炉，smoking=烟熏炉，stonecutting=切石机',
  'recipe.outputCount': '产出数量（一次合成/烧炼产出的物品数）',
  'recipe.cookTime': '烧炼时间（tick），200 tick = 10 秒。熔炉默认 200，高炉 100，烟熏炉 100',
  'recipe.experience': '烧炼经验值（取出产物时玩家获得的经验）',
  'recipe.pattern':
    '有序合成模式（仅 crafting_shaped 用），如 ["AAA","ABA","AAA"]，每行最多 3 字符，空格表示空槽',

  // === machine ===
  'machine.machineId': '机器 ID，格式同物品，如 ruby_furnace',
  'machine.displayName': '游戏中显示的机器名称',
  'machine.energyCapacity': '能源容量（FE 单位，Forge Energy 标准），决定可存储的最大能量',
  'machine.maxEnergyTransfer': '最大能源传输速率（FE/tick），决定每 tick 可输入/输出的能量上限',
  'machine.inputSlots': '输入槽数量（0-9），如熔炉 1 个输入槽',
  'machine.outputSlots': '输出槽数量（0-9），如熔炉 1 个输出槽',
  'machine.defaultProcessTime': '默认加工时间（tick），200 tick = 10 秒',
  'machine.defaultEnergyPerTick': '默认每 tick 能源消耗（FE/tick），加工时每 tick 扣除的能量',
  'machine.guiWidth': 'GUI 宽度（像素），默认 176（标准 Minecraft GUI 宽度）',
  'machine.guiHeight': 'GUI 高度（像素），默认 166（标准 Minecraft GUI 高度）',

  // === multiblock ===
  'multiblock.structureId': '多方块结构 ID，格式同物品，如 industrial_furnace',
  'multiblock.displayName': '多方块结构显示名',
  'multiblock.width': '结构宽度（1-16，X 轴方向方块数）',
  'multiblock.height': '结构高度（1-16，Y 轴方向方块数）',
  'multiblock.depth': '结构深度（1-16，Z 轴方向方块数）',
  'multiblock.hollow': '是否空心结构（true=外壳，false=实心）',
  'multiblock.controllerOffset': '主控制器位置（相对结构原点的坐标），通常是结构中心',

  // === event ===
  'event.eventType':
    '事件触发器类型：player_right_click_block=右键方块，entity_death=实体死亡，player_join=玩家加入，tick=每 tick 等',
  'event.eventArgs': '事件参数（JSON 字符串），由具体事件类型决定字段，如 {"hand":"main_hand"}',

  // === condition ===
  'condition.conditionType':
    '条件判断类型：has_item=持有物品，health_below=生命值低于，is_day=白天，biome_is=在特定群系 等',
  'condition.conditionArgs':
    '条件参数（JSON 字符串），如 {"item":"minecraft:stick","hand":"main_hand"}',
  'condition.invert': '是否取反（true=条件为假时走真分支，false=正常逻辑）',

  // === action ===
  'action.actionType':
    '动作类型：spawn_entity=生成实体，give_item=给予物品，teleport=传送，damage=造成伤害，play_sound=播放声音 等',
  'action.actionArgs':
    '动作参数（JSON 字符串），如 {"entity":"minecraft:lightning_bolt","offset":{"x":0,"y":1,"z":0}}',

  // === code ===
  'code.language': '代码语言：java（推荐，功能完整）/javascript/kotlin',
  'code.code': '内嵌代码内容（L2 混合模式核心），可用 input 参数引用输入端口数据，return 返回输出',
  'code.inputSignature': '输入端口类型签名（JSON，如 {"in":"item_stack"}），定义输入端口的数据类型',
  'code.outputSignature':
    '输出端口类型签名（JSON，如 {"out":"item_stack"}），定义输出端口的数据类型',
  'code.methodName': '生成的 Java 方法名（合法标识符，如 process / onTick）',

  // === comment ===
  'comment.text': '备注文本（仅文档用途，不参与编译）',
  'comment.color': '备注背景色：yellow/green/blue/pink/gray',

  // === procedure ===
  'procedure.procedureName':
    '过程名（Java 标识符），编译为方法名 procedure_<name>(Object event)。字母/下划线开头，仅含字母/数字/下划线',
  'procedure.displayName': 'UI 显示名（可选，默认同过程名），仅用于画布展示，不影响编译产物',
};

/** 获取字段 tooltip，先查 `${kind}.${fieldKey}`，未命中 fallback 到 `common.${fieldKey}`，仍无则返回 undefined */
export function getTooltip(kind: string, fieldKey: string): string | undefined {
  return FIELD_TOOLTIPS[`${kind}.${fieldKey}`] ?? FIELD_TOOLTIPS[`common.${fieldKey}`];
}
