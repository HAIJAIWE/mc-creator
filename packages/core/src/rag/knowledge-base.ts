/**
 * 本地知识库：Minecraft Wiki 常用配方、Fabric/NeoForge API 示例、内置生成器模板。
 *
 * 每条 content 刻意混写中英关键词（中文查询 + 英文字段名都能命中 TF-IDF）。
 * 外链 url 只填确认存在的门户/长青页面，不确定的条目留空（UI 上展开看片段）。
 */
import type { RagDocument } from './types.js';

export const KNOWLEDGE_BASE: RagDocument[] = [
  // ============ 数据包配方（Minecraft Wiki） ============
  {
    id: 'recipe-shaped',
    title: '有形合成配方 crafting_shaped',
    content: `有形合成配方 shaped recipe：data/<命名空间>/recipe/<id>.json，type 为 "minecraft:crafting_shaped"。
字段：pattern（字符串数组，如 ["III","III","III"]，形状必须对齐）、key（字符→材料映射，如 {"I": {"item": "minecraft:iron_ingot"}}）、result（{"id": "minecraft:iron_block", "count": 1}）、category（equipment/building_blocks/redstone/misc）。
示例：3x3 铁块合成 —— pattern 三行 "III"，key I 对应 iron_ingot，result 为 iron_block。`,
    source: 'Minecraft Wiki · Recipe',
    url: 'https://minecraft.wiki/w/Recipe',
    generatorTypes: ['datapack'],
    tags: ['配方', '合成', '有形', 'shaped', 'crafting', 'pattern', 'key', '工作台'],
  },
  {
    id: 'recipe-shapeless',
    title: '无序合成配方 crafting_shapeless',
    content: `无序合成配方 shapeless recipe：type 为 "minecraft:crafting_shapeless"，不需要 pattern，材料顺序任意。
字段：ingredients（数组，每项 {"item": "minecraft:xxx"} 或标签 {"tag": "minecraft:xxx"}）、result、category。
示例：纸张合成 —— ingredients 放 3 个 sugar_cane，result 为 paper。多个相同材料要重复列出。`,
    source: 'Minecraft Wiki · Recipe',
    url: 'https://minecraft.wiki/w/Recipe',
    generatorTypes: ['datapack'],
    tags: ['配方', '合成', '无序', 'shapeless', 'ingredients', '工作台'],
  },
  {
    id: 'recipe-smelting',
    title: '熔炼/烧炼配方 smelting blasting smoking campfire',
    content: `熔炼类配方 furnace recipe：type 为 "minecraft:smelting"（熔炉 200 ticks），"minecraft:blasting"（高炉 100 ticks，仅矿石/金属），"minecraft:smoking"（烟熏炉 100 ticks，仅食物），"minecraft:campfire_cooking"（营火 600 ticks）。
字段：ingredient（{"item": "..."}）、result（物品 id 字符串）、experience（经验，如 0.7）、cookingtime（刻）、group（分组，可选）。
示例：生铁烧成铁锭 —— ingredient 为 raw_iron，result 为 "minecraft:iron_ingot"。`,
    source: 'Minecraft Wiki · Recipe',
    url: 'https://minecraft.wiki/w/Recipe',
    generatorTypes: ['datapack'],
    tags: ['配方', '熔炼', '烧炼', '熔炉', '高炉', '烟熏', '营火', 'smelting', 'cookingtime', '食物'],
  },
  {
    id: 'recipe-stone-smithing',
    title: '切石机与锻造台配方 stonecutting smithing',
    content: `切石机配方 stonecutting：type 为 "minecraft:stonecutting"，字段 ingredient（{"item": "..."}）、result（物品 id）、count。
锻造台升级 smithing_transform：字段 template（{"item": "minecraft:netherite_upgrade_smithing_template"}）、base（基础装备）、addition（升级材料）、result。锻造台只认这三个槽位。
盔甲纹饰锻造 smithing_trim：字段 template（纹饰模板）、base（盔甲）、addition（纹饰材料），无 result（纹饰直接附着）。`,
    source: 'Minecraft Wiki · Recipe',
    url: 'https://minecraft.wiki/w/Recipe',
    generatorTypes: ['datapack'],
    tags: ['配方', '切石机', '锻造', '下界合金', '纹饰', 'stonecutting', 'smithing', 'template'],
  },
  // ============ 酿造/附魔/效果 ============
  {
    id: 'brewing-datapack',
    title: '酿造台配方 brewing（数据包）',
    content: `酿造台 brewing（数据包内用自定义配方描述）：字段 inputPotion（输入药水，如 "minecraft:awkward" 粗制药水）、ingredientItem（材料，如 "minecraft:blaze_powder" 烈焰粉）、outputPotion（输出药水）。
注意：原版酿造台逻辑硬编码在游戏内，数据包只能描述“材料+输入→输出”的对应关系供生成器产出文档/提示，不能真正新增酿造反应；真新增需要 Mod。`,
    source: 'Minecraft Wiki · Brewing',
    url: 'https://minecraft.wiki/w/Brewing',
    generatorTypes: ['datapack'],
    tags: ['酿造', '药水', 'brewing', 'potion', '烈焰粉', '疣'],
  },
  {
    id: 'enchantment-121',
    title: '自定义附魔 enchantment（1.21+ 数据驱动）',
    content: `1.21+ 自定义附魔 data/<命名空间>/enchantment/<id>.json 字段：description（文本）、supported_items（可附魔标签，如 "#minecraft:enchantable/sword"）、weight（权重 1-1023，越大越常见）、anvil_cost、min_cost/max_cost（{base, per_level_above_first}）、max_level（1-255）、slots（any/mainhand/offhand/hand/feet/legs/chest/head/armor/body）、is_curse、is_treasure。
常用标签：#minecraft:enchantable/sword | /bow | /crossbow | /mining | /fishing | /armor | /mace。`,
    source: 'Minecraft Wiki · Enchanting',
    url: 'https://minecraft.wiki/w/Enchanting',
    generatorTypes: ['datapack', 'enchantment'],
    tags: ['附魔', 'enchantment', 'enchantable', 'weight', 'slots', 'max_level', '剑'],
  },
  {
    id: 'effect-121',
    title: '自定义状态效果 effect（1.21+）',
    content: `1.21+ 自定义效果 data/<命名空间>/effect/<id>.json 字段：description（显示名）、color（0xRRGGBB 十进制整数，如红色 0xFF0000=16711680）、instant（true=立即生效如治疗/伤害，false=持续）、beneficial（true=有益显示蓝色图标，false=有害红色图标）。`,
    source: 'Minecraft Wiki · 状态效果',
    generatorTypes: ['datapack'],
    tags: ['效果', '药水效果', 'effect', 'color', 'instant', 'beneficial', '正面', '负面'],
  },
  {
    id: 'damage-type',
    title: '自定义伤害类型 damage_type（1.19.4+）',
    content: `自定义伤害类型 data/<命名空间>/damage_type/<id>.json 字段：message_id（死亡消息类型 default/player/player_attack/fall/intentional_game_design）、scaling（难度缩放 never/when_caused_by_living_non_player/always）、exhaustion（饥饿消耗数值）。
配合自定义生物/武器使用，Mod 内用 DamageSource 引用。`,
    source: 'Minecraft Wiki · 伤害类型',
    generatorTypes: ['datapack'],
    tags: ['伤害', 'damage', '死亡消息', 'scaling', 'exhaustion'],
  },
  // ============ 世界生成 ============
  {
    id: 'dimension-biome',
    title: '维度与生物群系 worldgen（dimension/biome）',
    content: `维度类型 dimension_type 字段：fixedTime（固定时间，可选）、hasSkyLight/hasCeiling、coordinateScale（坐标缩放，下界 8）、bedWorks/respawnAnchorWorks、minY/height/logicalHeight、infiniburn、effects（天空类型）、ambientLight、piglinSafe。
生物群系 biome 字段：precipitation（none/rain/snow）、temperature、temperatureModifier、downfall、skyColor/waterColor/waterFogColor/fogColor/grassColor/foliageColor、surfaceBuilder。
维度 dimension：dimensionType + generatorType（noise/flat/debug/void）+ biomeSource + noiseSettings/flatLayers。数据包 pack_format 1.21.x 用 48。`,
    source: 'Minecraft Wiki · 世界生成',
    url: 'https://minecraft.wiki/',
    generatorTypes: ['datapack'],
    tags: ['维度', '生物群系', '世界生成', 'dimension', 'biome', '下界', '末地', '群系', '温度', '降水'],
  },
  {
    id: 'structure-worldgen',
    title: '自定义结构 structure（worldgen）',
    content: `自定义结构 data/<命名空间>/worldgen/structure/<id>.json 字段：placementType（jigsaw 拼图/random_spread 随机散布/concentric_rings 同心环）、templatePool（结构模板池）、maxDistance/size、startHeight、biomes（可生成群系，如 "#minecraft:is_overworld"）、step（地形适应 none/beard/beard_thin/encapsulate）。
jigsaw 结构还需配套 template_pool 与 processor_list。`,
    source: 'Minecraft Wiki · 结构',
    url: 'https://minecraft.wiki/',
    generatorTypes: ['datapack'],
    tags: ['结构', '遗迹', 'structure', 'jigsaw', '拼图', '群系', '生成'],
  },
  {
    id: 'trim-pattern-material',
    title: '盔甲纹饰 trim（1.20+）',
    content: `盔甲纹饰 1.20+：trim_pattern（templateItem 模板物品、description、decal 是否贴花）与 trim_material（materialItem 纹饰材料、color 十六进制 "#RRGGBB"、description）。
数据路径 data/<命名空间>/trim_pattern 与 trim_material。锻造配方用 smithing_trim 类型引用。`,
    source: 'Minecraft Wiki · 盔甲纹饰',
    url: 'https://minecraft.wiki/',
    generatorTypes: ['datapack'],
    tags: ['纹饰', '盔甲', 'trim', '锻造', '装饰'],
  },
  // ============ 战利品/函数/进度/标签 ============
  {
    id: 'loot-table',
    title: '战利品表 loot_table',
    content: `战利品表 loot table：字段 type（如 "minecraft:entity" 实体、"minecraft:block" 方块、"minecraft:chest" 箱子）、pools（数组，每池 rolls 掷骰次数、entries 条目 [{type: "minecraft:item", name: "minecraft:diamond", weight 权重, count 数量/functions}]）。
示例：自定义生物掉落 —— type entity，pools rolls 1，entries 放自定义物品 id，weight 越大越容易掉。`,
    source: 'Minecraft Wiki · Loot table',
    generatorTypes: ['datapack'],
    tags: ['战利品', '掉落', 'loot', 'pools', 'entries', 'weight', '生物掉落', '开箱'],
  },
  {
    id: 'function-predicate-advancement',
    title: '函数/谓词/进度 function predicate advancement',
    content: `函数 function：data/<命名空间>/function/<path>.mcfunction，纯命令列表（commands 数组），如 ["say hello", "give @p minecraft:diamond 1"]。
谓词 predicate：condition JSON（如 {"condition": "minecraft:entity_scores", ...}），供进度/战利品复用判定。
进度 advancement：字段 display（icon/title/description 背景）、criteria（触发器 trigger + conditions，如 "minecraft:inventory_changed" 获得物品）、rewards（奖励配方/经验/战利品）。`,
    source: 'Minecraft Wiki · 函数与进度',
    url: 'https://minecraft.wiki/',
    generatorTypes: ['datapack'],
    tags: ['函数', '命令', 'function', 'mcfunction', '进度', '成就', 'advancement', '谓词', 'predicate', '触发器'],
  },
  {
    id: 'tags-labels',
    title: '标签 tags（物品/方块/可附魔）',
    content: `标签 tags：data/<命名空间>/tags/item|block/<path>.json，字段 values（条目 id 数组，支持 "#命名空间:其他标签" 嵌套）、replace（true=覆盖原版同名标签，false=追加）。
附魔可用标签（supported_items）：#minecraft:enchantable/sword|bow|crossbow|trident|mining|fishing|armor|mace。
挖掘标签：#minecraft:mineable/pickaxe|axe|shovel|hoe；需求等级：#minecraft:needs_stone_tool|needs_iron_tool|needs_diamond_tool。`,
    source: 'Minecraft Wiki · 标签',
    url: 'https://minecraft.wiki/',
    generatorTypes: ['datapack', 'mod'],
    tags: ['标签', 'tag', 'values', 'replace', 'enchantable', 'mineable', '挖掘', '镐'],
  },
  // ============ Fabric API 示例 ============
  {
    id: 'fabric-item-register',
    title: 'Fabric 物品注册示例（Java）',
    content: `Fabric 1.20+ 注册自定义物品：
public static final Item RUBY = Registry.register(Registries.ITEM, new Identifier("my_mod", "ruby"), new Item(new Item.Settings()));
在 ModInitializer.onInitialize() 中调用注册方法；语言文件 assets/my_mod/lang/zh_cn.json 加 "item.my_mod.ruby": "红宝石"。
模型文件 models/item/ruby.json parent 用 "minecraft:item/generated"，textures.layer0 指纹理路径。`,
    source: 'Fabric 文档',
    url: 'https://docs.fabricmc.net/',
    generatorTypes: ['mod'],
    tags: ['Fabric', '物品', '注册', 'Registry', 'Identifier', 'Item', '红宝石', 'mod'],
  },
  {
    id: 'fabric-block-event',
    title: 'Fabric 方块与事件示例（Java）',
    content: `Fabric 注册方块：Registry.register(Registries.BLOCK, id, new Block(FabricBlockSettings.create().strength(3.0f, 3.0f).requiresTool()))，对应 BlockItem 一起注册到物品栏。
事件示例：UseBlockCallback.EVENT.register((player, world, hand, hitResult) -> ActionResult.PASS) 监听右键方块；ServerTickEvents.END_SERVER_TICK 注册每 tick 逻辑。注意只在服务端 world.isClient 为 false 时改世界。`,
    source: 'Fabric 文档',
    url: 'https://docs.fabricmc.net/',
    generatorTypes: ['mod'],
    tags: ['Fabric', '方块', 'Block', '事件', 'event', 'tick', '右键', '矿石'],
  },
  // ============ NeoForge 示例 ============
  {
    id: 'neoforge-item-register',
    title: 'NeoForge 物品注册示例（DeferredRegister）',
    content: `NeoForge 注册物品（DeferredRegister 延迟注册）：
public static final DeferredRegister.Items ITEMS = DeferredRegister.createItems("my_mod");
public static final DeferredItem<Item> RUBY = ITEMS.register("ruby", () -> new Item(new Item.Properties()));
在 Mod 构造器中 ITEMS.register(modEventBus)。创造模式物品栏用 BuildCreativeModeTabContentsEvent 加入。`,
    source: 'NeoForge 文档',
    url: 'https://docs.neoforged.net/',
    generatorTypes: ['mod'],
    tags: ['NeoForge', 'Forge', '物品', '注册', 'DeferredRegister', 'mod', '物品栏'],
  },
  {
    id: 'neoforge-event',
    title: 'NeoForge 事件示例 @SubscribeEvent',
    content: `NeoForge 事件：@SubscribeEvent public static void onPlayerLoggedIn(PlayerLoggedInEvent event) {...}，类上加 @EventBusSubscriber(modid = "my_mod") 自动订阅。
常见事件：LivingDeathEvent（生物死亡掉落）、PlayerInteractEvent.RightClickBlock（右键）、ServerTickEvent（定时逻辑）。NeoForge 与 Fabric 事件总线不同，代码不可混用。`,
    source: 'NeoForge 文档',
    url: 'https://docs.neoforged.net/',
    generatorTypes: ['mod'],
    tags: ['NeoForge', 'Forge', '事件', 'event', 'SubscribeEvent', '监听', '掉落', '右键'],
  },
  // ============ KubeJS / CraftTweaker ============
  {
    id: 'kubejs-recipe-event',
    title: 'KubeJS 配方与事件示例（JavaScript）',
    content: `KubeJS 有序合成：ServerEvents.recipes(e => { e.shaped(Item.of('minecraft:diamond_block', 1), ['III','III','III'], { I: 'minecraft:iron_ingot' }) })。
无序：e.shapeless('minecraft:paper', ['minecraft:sugar_cane', 'minecraft:sugar_cane'])。
事件：PlayerEvents.loggedIn(e => { e.player.tell('欢迎') })；右键方块 BlockEvents.rightClicked。handler 是 JS 代码字符串，会被嵌入事件回调。`,
    source: 'KubeJS · GitHub',
    url: 'https://github.com/KubeJS-Mod/KubeJS',
    generatorTypes: ['kubejs'],
    tags: ['KubeJS', '配方', 'shaped', 'shapeless', '事件', '脚本', 'js', '合成'],
  },
  {
    id: 'crafttweaker-recipe',
    title: 'CraftTweaker 配方示例（ZenScript）',
    content: `CraftTweaker 用 ZenScript（不是 JavaScript）：craftingTable.addShaped("my_recipe", <item:minecraft:diamond>, [[<item:minecraft:iron_ingot>]]) 注意物品用 <modid:name> 尖括号形式。
无序：craftingTable.addShapeless。事件 handler 也是 ZenScript 字符串。不要写 registry 相关（注册表语法复杂，生成器暂不支持）。`,
    source: 'CraftTweaker 内置知识',
    generatorTypes: ['crafttweaker'],
    tags: ['CraftTweaker', '配方', 'ZenScript', 'zs', 'craftingTable', 'addShaped', '合成'],
  },
  // ============ 内置生成器模板 ============
  {
    id: 'template-new-ore',
    title: '内置模板 new_ore（新矿石一键套件）',
    content: `apply_content_template(template="new_ore") 一键生成：矿石方块 + 矿锭 + 矿粒 + 存储方块 + 镐/斧/锹/锄/剑 + 头盔/胸甲/护腿/靴子 + 全套配方（合成+熔炼）+ 物品/方块标签 + en_us/zh_cn 语言文件。
参数：mod_id（如 my_mod）、material_name（英文如 ruby）、material_name_zh（中文如 红宝石）。做“红宝石套装/铜套装”类需求时优先用此模板，一次调用胜过逐个生成。`,
    source: '内置模板：new_ore',
    generatorTypes: ['datapack', 'mod'],
    tags: ['模板', '矿石', 'template', 'ore', '套装', '工具', '盔甲', '红宝石', '一键生成'],
  },
  {
    id: 'template-new-food',
    title: '内置模板 new_food（新食物）',
    content: `apply_content_template(template="new_food") 生成：生食 + 熟食 + 烟熏炉/营火配方 + 语言文件。
extra_params：{"hunger": 4, "saturation": 0.3}（饱食度/饱和度）。注意 smoking 熔炼 100 ticks，campfire_cooking 600 ticks。`,
    source: '内置模板：new_food',
    generatorTypes: ['datapack'],
    tags: ['模板', '食物', 'template', 'food', 'hunger', 'saturation', '饱食度', '吃'],
  },
  {
    id: 'template-new-dimension',
    title: '内置模板 new_dimension（新维度）',
    content: `apply_content_template(template="new_dimension") 生成：维度类型 dimension_type + 生物群系 biome + 维度 dimension + 语言文件。
extra_params：{"fixedTime": null, "hasSkyLight": true, "hasCeiling": false, "coordinateScale": 1.0}。做“虚空世界/永昼维度”时调 fixedTime 与 hasSkyLight。`,
    source: '内置模板：new_dimension',
    generatorTypes: ['datapack'],
    tags: ['模板', '维度', 'template', 'dimension', '世界', '虚空', '永昼'],
  },
  {
    id: 'template-new-enchant-effect',
    title: '内置模板 new_enchantment / new_effect',
    content: `new_enchantment 生成自定义附魔：extra_params {"maxLevel": 5, "weight": 2, "supportedItems": "#minecraft:enchantable/sword", "slots": ["any"]}。
new_effect 生成状态效果：extra_params {"color": 16711680, "instant": false, "beneficial": true}（color 为 0xRRGGBB 十进制）。
附魔问“锋利/时运”类需求时先确认 supportedItems 标签与 slots。`,
    source: '内置模板：new_enchantment/new_effect',
    generatorTypes: ['datapack', 'enchantment'],
    tags: ['模板', '附魔', '效果', 'template', 'enchantment', '锋利', '时运', '增益'],
  },
  {
    id: 'template-new-structure-biome',
    title: '内置模板 new_structure / new_biome',
    content: `new_structure 生成自定义结构：extra_params {"placementType": "jigsaw", "templatePool": "minecraft:empty", "maxDistance": 7, "size": 7, "biomes": "#minecraft:is_overworld"}（jigsaw/random_spread/concentric_rings 三选一）。
new_biome 生成生物群系：extra_params {"precipitation": "snow", "temperature": 0.0, "downfall": 0.4, "skyColor": 7907327, "waterColor": 4159204, "fogColor": 12638463}。`,
    source: '内置模板：new_structure/new_biome',
    generatorTypes: ['datapack'],
    tags: ['模板', '结构', '生物群系', 'template', 'structure', 'biome', '遗迹', '雪原', '群系'],
  },
  // ============ 资源包 / 基岩行为包 ============
  {
    id: 'resource-pack-basics',
    title: '资源包基础 resource_pack（pack_format 34）',
    content: `资源包 ResourcePackSpec：packName、packDescription、packFormat（1.21.x 用 34）、namespace。
可覆盖：fonts（字体 char/texture/width/height/advance）、sounds（event/volume/pitch/stream）、textureOverrides（path/color #RRGGBB/width/height）、models（path/json/autoCubeAll）、langEnUs/langZhCn 语言覆盖。改物品贴图用 models + textureOverrides。`,
    source: 'Minecraft Wiki · 资源包',
    url: 'https://minecraft.wiki/',
    generatorTypes: ['resource_pack'],
    tags: ['资源包', '贴图', '模型', '音效', '字体', 'resource', 'pack_format', '材质'],
  },
  {
    id: 'behavior-pack-basics',
    title: '基岩行为包基础 behavior_pack',
    content: `基岩版行为包 BehaviorPackSpec：packId（小写下划线）、packName、packFormat（默认 2）、mcVersion（如 [1,21,0]）、header（uuid/version/min_engine_version）、dependencies、entities（identifier 用 namespace:id，components 如 minecraft:health/minecraft:attack_damage）、recipes（shaped_crafting/shapeless_crafting/furnace）、lootTables。
自定义物品用 behavior_item 生成器（含 16x16 纹理），自定义怪物用 behavior_entity（含 goals AI 目标与 drops 掉落）。`,
    source: '基岩版内置知识',
    generatorTypes: ['behavior_pack', 'behavior_item', 'behavior_entity'],
    tags: ['基岩', '行为包', 'behavior', '实体', '怪物', 'AI', '掉落', 'manifest', '手机版'],
  },
];
