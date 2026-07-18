import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { AiModelConfig } from '@mc-creator/core';
import { encryptSecret, decryptSecret } from './secret-storage.js';

/** 模型配置持久化（用 JSON 文件存 app.getPath('userData')） */
const CONFIG_FILE = 'model-config.json';

function configPath(): string {
  return join(app.getPath('userData'), CONFIG_FILE);
}

export interface ModelConfigFull extends AiModelConfig {
  /** 用户自定义名称，如 'DeepSeek' */
  name: string;
}

const DEFAULT_CONFIG: ModelConfigFull = {
  name: 'OpenAI',
  modelId: 'gpt-4o-mini',
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
};

export function loadModelConfig(): ModelConfigFull {
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

export function saveModelConfig(config: ModelConfigFull): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  // 仅在持久化时加密 apiKey，内存中保持明文供运行时使用
  const persisted = { ...config, apiKey: encryptSecret(config.apiKey) };
  writeFileSync(configPath(), JSON.stringify(persisted, null, 2), 'utf-8');
}
