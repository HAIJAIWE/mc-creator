import { app } from 'electron';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import type { AiModelConfig } from '@mc-creator/core';

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
      return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
    }
  } catch {
    // 文件损坏，用默认
  }
  return { ...DEFAULT_CONFIG };
}

export function saveModelConfig(config: ModelConfigFull): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(configPath(), JSON.stringify(config, null, 2), 'utf-8');
}
