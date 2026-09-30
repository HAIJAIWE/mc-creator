// ===== MC 命令模板库（供调用方快速注入命令补全）=====

export interface McCommandTemplate {
  prefix: string;
  label: string;
  description: string;
  syntax: string;
  example: string;
}

/** MC 命令模板：常用命令补全 */
export const MC_COMMAND_TEMPLATES: McCommandTemplate[] = [
  // ===== 玩家类 =====
  {
    prefix: '/give',
    label: '/give <玩家> <物品> [数量]',
    description: '给予玩家物品',
    syntax: '/give <target> <item> [count] [components]',
    example: '/give @p minecraft:diamond 64',
  },
  {
    prefix: '/clear',
    label: '/clear [玩家] [物品]',
    description: '清除玩家物品',
    syntax: '/clear [target] [item] [maxCount]',
    example: '/clear @p minecraft:dirt',
  },
  {
    prefix: '/tp',
    label: '/tp <目标> <目的地>',
    description: '传送实体',
    syntax: '/tp <target> <destination|location> [rotation]',
    example: '/tp @p 100 70 200',
  },
  {
    prefix: '/gamemode',
    label: '/gamemode <模式> [玩家]',
    description: '切换游戏模式',
    syntax: '/gamemode <survival|creative|adventure|spectator> [target]',
    example: '/gamemode creative @p',
  },
  {
    prefix: '/effect',
    label: '/effect give <玩家> <效果>',
    description: '给予状态效果',
    syntax: '/effect give <target> <effect> [seconds] [amplifier] [hideParticles]',
    example: '/effect give @p minecraft:speed 30 1 true',
  },
  {
    prefix: '/enchant',
    label: '/enchant <玩家> <附魔> [等级]',
    description: '附魔手持物品',
    syntax: '/enchant <target> <enchantment> [level]',
    example: '/enchant @p minecraft:sharpness 5',
  },
  {
    prefix: '/xp',
    label: '/xp <数量> [玩家]',
    description: '给予经验值',
    syntax: '/xp <amount> [target] [add|set]',
    example: '/xp 100 @p',
  },
  {
    prefix: '/kill',
    label: '/kill [目标]',
    description: '杀死实体',
    syntax: '/kill [target]',
    example: '/kill @e[type=zombie]',
  },
  // ===== 实体/世界类 =====
  {
    prefix: '/summon',
    label: '/summon <实体> [位置]',
    description: '召唤实体',
    syntax: '/summon <entity> [pos] [nbt]',
    example: '/summon minecraft:zombie ~ ~ ~ {IsBaby:1b}',
  },
  {
    prefix: '/setblock',
    label: '/setblock <位置> <方块>',
    description: '放置方块',
    syntax: '/setblock <pos> <block> [mode]',
    example: '/setblock 10 65 10 minecraft:stone',
  },
  {
    prefix: '/fill',
    label: '/fill <起> <止> <方块>',
    description: '填充区域',
    syntax: '/fill <from> <to> <block> [mode]',
    example: '/fill 0 60 0 10 70 10 minecraft:air',
  },
  {
    prefix: '/clone',
    label: '/clone <起> <止> <目标>',
    description: '复制区域',
    syntax: '/clone <begin> <end> <destination> [mode]',
    example: '/clone 0 0 0 5 5 5 100 100 100',
  },
  {
    prefix: '/weather',
    label: '/weather <类型> [时长]',
    description: '设置天气',
    syntax: '/weather <clear|rain|thunder> [duration]',
    example: '/weather thunder 600',
  },
  {
    prefix: '/time',
    label: '/time set <时间>',
    description: '设置时间',
    syntax: '/time set <day|night|noon|midnight|value>',
    example: '/time set day',
  },
  {
    prefix: '/difficulty',
    label: '/difficulty <难度>',
    description: '设置难度',
    syntax: '/difficulty <peaceful|easy|normal|hard>',
    example: '/difficulty hard',
  },
  // ===== 服务器/管理类 =====
  {
    prefix: '/op',
    label: '/op <玩家>',
    description: '授予 OP 权限',
    syntax: '/op <player>',
    example: '/op Steve',
  },
  {
    prefix: '/deop',
    label: '/deop <玩家>',
    description: '撤销 OP 权限',
    syntax: '/deop <player>',
    example: '/deop Steve',
  },
  {
    prefix: '/whitelist',
    label: '/whitelist <add|remove> <玩家>',
    description: '白名单管理',
    syntax: '/whitelist <add|remove|on|off|list> [player]',
    example: '/whitelist add Steve',
  },
  {
    prefix: '/ban',
    label: '/ban <玩家> [原因]',
    description: '封禁玩家',
    syntax: '/ban <player> [reason]',
    example: '/ban Steve "破坏规则"',
  },
  {
    prefix: '/kick',
    label: '/kick <玩家> [原因]',
    description: '踢出玩家',
    syntax: '/kick <player> [reason]',
    example: '/kick Steve "暂时下线"',
  },
  {
    prefix: '/stop',
    label: '/stop',
    description: '关闭服务器',
    syntax: '/stop',
    example: '/stop',
  },
  {
    prefix: '/save-all',
    label: '/save-all',
    description: '保存世界',
    syntax: '/save-all [flush]',
    example: '/save-all',
  },
  // ===== 数据包/进度类 =====
  {
    prefix: '/reload',
    label: '/reload',
    description: '重载数据包',
    syntax: '/reload',
    example: '/reload',
  },
  {
    prefix: '/datapack',
    label: '/datapack list|enable|disable',
    description: '数据包管理',
    syntax: '/datapack <list|enable|disable> [name]',
    example: '/datapack list',
  },
  {
    prefix: '/advancement',
    label: '/advancement <grant|revoke>',
    description: '授予/撤销进度',
    syntax: '/advancement <grant|revoke> <target> <everything|from|only> [advancement]',
    example: '/advancement grant @p only minecraft:story/mine_diamond',
  },
  {
    prefix: '/function',
    label: '/function <函数>',
    description: '执行函数',
    syntax: '/function <id>',
    example: '/function my_pack:give_items',
  },
  // ===== 选择器提示 =====
  {
    prefix: '@p',
    label: '@p — 最近玩家',
    description: '目标选择器：最近玩家',
    syntax: '@p[distance=..10]',
    example: '/give @p minecraft:bread 5',
  },
  {
    prefix: '@a',
    label: '@a — 所有玩家',
    description: '目标选择器：所有玩家',
    syntax: '@a[limit=5]',
    example: '/effect give @a minecraft:jump_boost 30 1',
  },
  {
    prefix: '@e',
    label: '@e — 所有实体',
    description: '目标选择器：所有实体',
    syntax: '@e[type=zombie]',
    example: '/kill @e[type=item]',
  },
  {
    prefix: '@s',
    label: '@s — 自己',
    description: '目标选择器：执行者自己',
    syntax: '@s',
    example: '/effect give @s minecraft:night_vision 600',
  },
];
