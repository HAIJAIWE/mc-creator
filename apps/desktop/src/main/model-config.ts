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

/** 一套模型配置（profiles 里的元素，id 唯一） */
export interface ModelProfile {
  id: string;
  name: string;
  modelId: string;
  baseURL: string;
  apiKey: string;
}

const DEFAULT_CONFIG: ModelConfigFull = {
  name: 'OpenAI',
  modelId: 'gpt-4o-mini',
  baseURL: 'https://api.openai.com/v1',
  apiKey: '',
};

/** 旧版单配置迁移后的固定 profile id */
const LEGACY_PROFILE_ID = 'default';

interface ProfilesFile {
  profiles: ModelProfile[];
  activeId: string | null;
}

function emptyProfiles(): ProfilesFile {
  return { profiles: [], activeId: null };
}

/**
 * 读取全部模型配置（多套并存）。
 * 兼容旧单配置格式：无 profiles 字段时视为单配置，迁移为一个名为 default 的 profile。
 */
export function loadModelProfiles(): ProfilesFile {
  try {
    if (existsSync(configPath())) {
      const raw = readFileSync(configPath(), 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.profiles)) {
        return {
          profiles: parsed.profiles.map((p: ModelProfile) => ({
            ...p,
            apiKey: decryptSecret(p.apiKey ?? ''),
          })),
          activeId: typeof parsed.activeId === 'string' ? parsed.activeId : null,
        };
      }
      // 旧单配置 → 迁移
      const single: ModelConfigFull = {
        ...DEFAULT_CONFIG,
        ...parsed,
        apiKey: decryptSecret((parsed as { apiKey?: string })?.apiKey ?? ''),
      };
      return {
        profiles: [{ id: LEGACY_PROFILE_ID, ...single }],
        activeId: LEGACY_PROFILE_ID,
      };
    }
  } catch {
    // 文件损坏，用空
  }
  return emptyProfiles();
}

/** 保存全部模型配置（每个 apiKey 加密落盘） */
export function saveModelProfiles(profiles: ModelProfile[], activeId: string): void {
  const dir = app.getPath('userData');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const persisted: ProfilesFile = {
    profiles: profiles.map((p) => ({ ...p, apiKey: encryptSecret(p.apiKey) })),
    activeId,
  };
  writeFileSync(configPath(), JSON.stringify(persisted, null, 2), 'utf-8');
}

/** 当前生效配置（activeId 指向的 profile，无则第一个，无则默认） */
export function loadModelConfig(): ModelConfigFull {
  const { profiles, activeId } = loadModelProfiles();
  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  if (!active) return { ...DEFAULT_CONFIG };
  return {
    name: active.name,
    modelId: active.modelId,
    baseURL: active.baseURL,
    apiKey: active.apiKey,
  };
}

/** 兼容旧调用：把单配置写入（更新 active profile，无则创建 default） */
export function saveModelConfig(config: ModelConfigFull): void {
  const { profiles, activeId } = loadModelProfiles();
  const id = profiles.some((p) => p.id === activeId)
    ? (activeId ?? LEGACY_PROFILE_ID)
    : LEGACY_PROFILE_ID;
  const next: ModelProfile = { id, ...config };
  const idx = profiles.findIndex((p) => p.id === id);
  if (idx >= 0) profiles[idx] = next;
  else profiles.push(next);
  saveModelProfiles(profiles, id);
}

/**
 * 连通性测试：向 OpenAI 兼容接口发一个最小 chat 请求。
 * 返回 { ok, message }，message 携带可用模型名或错误信息。
 */
export async function testModelConnection(
  baseURL: string,
  modelId: string,
  apiKey: string,
): Promise<{ ok: boolean; message: string }> {
  const endpoint = `${baseURL.replace(/\/+$/, '')}/chat/completions`;
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 1,
      }),
      // node18+ / Electron 均支持
      signal: AbortSignal.timeout(15_000),
    });
    if (res.ok) {
      const data = (await res.json()) as { model?: string };
      return { ok: true, message: `连接成功（${data?.model ?? modelId}）` };
    }
    let detail = '';
    try {
      const d = (await res.json()) as { error?: { message?: string } };
      detail = d?.error?.message ? `：${d.error.message}` : '';
    } catch {
      // 非 JSON 错误体，忽略
    }
    return { ok: false, message: `HTTP ${res.status}${detail}` };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
