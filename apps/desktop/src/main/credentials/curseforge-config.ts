import { app } from 'electron';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { writeFileAtomic } from '@mc-creator/shell';
import { encryptSecret, decryptSecret } from './secret-storage.js';

/**
 * CurseForge 配置持久化（独立于 AI 模型配置，存 curseforge-config.json）。
 * API key 由用户去 https://console.curseforge.com/ 免费申请。
 */
const CONFIG_FILE = 'curseforge-config.json';

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE);
}

export interface CurseForgeConfig {
  apiKey: string;
}

const DEFAULT_CONFIG: CurseForgeConfig = { apiKey: '' };

export function loadCurseForgeConfig(): CurseForgeConfig {
  try {
    if (existsSync(configPath())) {
      const raw = readFileSync(configPath(), 'utf-8');
      const parsed = JSON.parse(raw);
      return { ...DEFAULT_CONFIG, ...parsed, apiKey: decryptSecret(parsed.apiKey ?? '') };
    }
  } catch {
    // 文件损坏，用默认
  }
  return { ...DEFAULT_CONFIG };
}

export async function saveCurseForgeConfig(config: CurseForgeConfig): Promise<void> {
  const persisted = { ...config, apiKey: encryptSecret(config.apiKey) };
  await writeFileAtomic(configPath(), JSON.stringify(persisted, null, 2));
}
