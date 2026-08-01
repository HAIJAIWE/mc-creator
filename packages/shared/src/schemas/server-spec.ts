import { z } from 'zod';

/** 服务端模组条目 */
export const ServerModEntry = z.object({
  id: z.string(), // modId 或文件名
  version: z.string(), // 版本号
  source: z.enum(['modrinth', 'curseforge', 'url']).default('modrinth'),
});

/** OP 玩家条目 */
export const OpEntry = z.object({
  name: z.string(),
  level: z.number().int().min(1).max(4).default(4),
});

/** 白名单玩家 */
export const WhitelistEntry = z.object({
  name: z.string(),
  uuid: z.string().optional(),
});

/** server.properties 单项键值 */
export const ServerProperty = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

/** ServerSpec：服务器配置规格 */
export const ServerSpec = z.object({
  serverName: z.string(),
  // S-9 修复：默认 MC 版本与 types/loader.ts 的 DEFAULT_MC_VERSION ('1.21.11') 对齐
  mcVersion: z.string().default('1.21.11'),
  motd: z.string().default('A Minecraft Server'),
  maxPlayers: z.number().int().min(1).max(999).default(20),
  port: z.number().int().min(1).max(65535).default(25565),
  gamemode: z.enum(['survival', 'creative', 'adventure', 'spectator']).default('survival'),
  difficulty: z.enum(['peaceful', 'easy', 'normal', 'hard']).default('normal'),
  levelName: z.string().default('world'),
  levelSeed: z.string().optional(),
  pvp: z.boolean().default(true),
  onlineMode: z.boolean().default(true),
  whitelist: z.boolean().default(false),
  // S-7 修复：enforceWhitelist 默认值与 whitelist 对齐（vanilla 中 enforce-whitelist
  // 仅在 white-list 开启时生效，此前 false/true 组合产出无效配置）
  enforceWhitelist: z.boolean().default(false),
  viewDistance: z.number().int().min(3).max(32).default(10),
  simulationDistance: z.number().int().min(3).max(32).default(10),
  allowFlight: z.boolean().default(false),
  allowNether: z.boolean().default(true),
  allowEnd: z.boolean().default(true),
  spawnAnimals: z.boolean().default(true),
  spawnNpcs: z.boolean().default(true),
  spawnMonsters: z.boolean().default(true),
  generateStructures: z.boolean().default(true),
  ops: z.array(OpEntry).default([]),
  whitelistEntries: z.array(WhitelistEntry).default([]),
  mods: z.array(ServerModEntry).default([]),
  extraProperties: ServerProperty.default({}),
  eula: z.boolean().default(true),
  startMemory: z.string().default('2G'),
  maxMemory: z.string().default('4G'),
  // P17：部署脚本配置
  deployTarget: z.enum(['none', 'systemd', 'docker', 'both']).default('none'),
  javaPath: z.string().default('java'),
  jarUrl: z.string().default(''),
  jarName: z.string().default('server.jar'),
  backupInterval: z.number().int().min(0).default(0),
  restartOnCrash: z.boolean().default(true),
  maxRamPercent: z.number().int().min(1).max(100).default(80),
  serviceUser: z.string().default('minecraft'),
  serviceDir: z.string().default('/opt/minecraft'),
  // 一键部署：服务端类型与版本（install.sh / install.bat 下载用）
  serverType: z.enum(['vanilla', 'paper', 'fabric']).default('vanilla'),
  serverVersion: z.string().default('1.21.1'),
});

export type ServerModEntry = z.infer<typeof ServerModEntry>;
export type OpEntry = z.infer<typeof OpEntry>;
export type WhitelistEntry = z.infer<typeof WhitelistEntry>;
export type ServerProperty = z.infer<typeof ServerProperty>;
export type ServerSpec = z.infer<typeof ServerSpec>;
