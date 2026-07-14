import type { SpecTemplate } from './types.js';

/**
 * Server 生成器模板。
 *
 * 覆盖常见服务器配置场景：小型生存服、中型小游戏服、创造服。
 */
export const SERVER_TEMPLATES: SpecTemplate[] = [
  {
    id: 'server-survival-20',
    title: '20人生存服',
    icon: '🏕️',
    description:
      '配置一个 20 人生存服，MC 版本 1.21.1，难度 normal，' +
      '端口 25565，最大玩家 20，开启 PVP，开启白名单强制验证，' +
      '视距 10，模拟距离 8，生成怪物/动物/NPC，生成结构，' +
      '允许下界和末地，禁止飞行。初始内存 2G，最大内存 4G。' +
      'serverName 显示为「Friendly Survival」，MOTD「欢迎来到友谊生存服！」，' +
      'OP 玩家：Admin(等级 4)、Moderator(等级 2)，' +
      '白名单 3 个：Player1、Player2、Player3。EULA 已同意。',
  },
  {
    id: 'server-minigames-100',
    title: '100人小游戏服',
    icon: '🎮',
    description:
      '配置一个 100 人小游戏服，MC 版本 1.21.1，难度 easy（适合小游戏），' +
      '端口 25566，最大玩家 100，关闭 PVP（由小游戏控制），' +
      '关闭在线模式（支持离线账号），视距 6（性能优先），模拟距离 4，' +
      '关闭怪物/动物生成，关闭结构生成，允许飞行（小游戏需要）。' +
      '初始内存 4G，最大内存 16G，开启崩溃重启，最大 RAM 占用 80%。' +
      'serverName「MiniGames Hub」，MOTD「§e§l小游戏大厅 §r§7| §a100 人在线」。',
  },
  {
    id: 'server-creative',
    title: '创造服',
    icon: '🎨',
    description:
      '配置一个创造服，MC 版本 1.21.1，游戏模式 creative，' +
      '端口 25567，最大玩家 50，难度 peaceful，' +
      '关闭 PVP，开启在线模式，视距 16（欣赏建筑），' +
      '模拟距离 16，关闭怪物/动物/NPC 生成，允许飞行，' +
      '生成结构。初始内存 4G，最大内存 8G。' +
      'serverName「Creative Build」，MOTD「§b✦ 创造建筑服 ✦ §7| §a自由建造」。',
  },
];
