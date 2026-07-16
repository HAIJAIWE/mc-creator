import { z } from 'zod';

/** LauncherSpec：启动器配置规格（P23-3 新增） */
export const LauncherSpec = z.object({
  launcherName: z.string(),
  launcherType: z.enum(['official', 'pcl2', 'hmcl']).default('official'),
  profileName: z.string().default('default'),
  mcVersion: z.string(),
  loader: z.enum(['fabric', 'neoforge', 'quilt', 'legacy_fabric', 'vanilla']).default('vanilla'),
  javaPath: z.string().default(''),
  jvmArgs: z.string().default('-Xmx2G -Xms1G'),
  memoryMin: z.number().int().min(512).default(1024),
  memoryMax: z.number().int().min(1024).default(2048),
  accountType: z.enum(['offline', 'microsoft']).default('offline'),
  username: z.string().default('Player'),
  uuid: z.string().default(''),
  serverAutorun: z.string().default(''),
  fullscreen: z.boolean().default(false),
  resolutionWidth: z.number().int().default(854),
  resolutionHeight: z.number().int().default(480),
});

export type LauncherSpec = z.infer<typeof LauncherSpec>;
