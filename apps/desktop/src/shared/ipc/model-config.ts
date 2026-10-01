import { z } from 'zod';

// === 模型配置 ===
export const LOAD_MODEL_CONFIG = 'model:loadConfig';
export const SAVE_MODEL_CONFIG = 'model:saveConfig';

// 多套模型配置（profiles）管理 + 连通性测试
export const MODEL_LIST_PROFILES = 'model:listProfiles';
export const MODEL_SAVE_PROFILES = 'model:saveProfiles';
export const MODEL_TEST_CONNECTION = 'model:testConnection';

/** 一套模型配置（id 唯一；apiKey 在主进程加密存储/解密返回） */
export const ModelProfileSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  modelId: z.string().min(1),
  baseURL: z.string().min(1),
  apiKey: z.string(),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

export const ModelProfileListResponse = z.object({
  profiles: z.array(ModelProfileSchema).default([]),
  activeId: z.string().nullable().default(null),
});
export type ModelProfileListRes = z.infer<typeof ModelProfileListResponse>;

export const ModelSaveProfilesRequest = z.object({
  profiles: z.array(ModelProfileSchema),
  activeId: z.string(),
});
export type ModelSaveProfilesReq = z.infer<typeof ModelSaveProfilesRequest>;

export const ModelTestConnectionRequest = z.object({
  baseURL: z.string().min(1),
  modelId: z.string().min(1),
  apiKey: z.string(),
});
export type ModelTestConnectionReq = z.infer<typeof ModelTestConnectionRequest>;

export const ModelTestConnectionResponse = z.object({
  ok: z.boolean(),
  message: z.string(),
});
export type ModelTestConnectionRes = z.infer<typeof ModelTestConnectionResponse>;

export const SaveModelConfigRequest = z.object({
  name: z.string(),
  modelId: z.string().min(1),
  baseURL: z.string().min(1),
  apiKey: z.string(),
});
export const ModelConfigResponse = z.object({
  name: z.string(),
  modelId: z.string(),
  baseURL: z.string(),
  apiKey: z.string(),
});

export type SaveModelConfigReq = z.infer<typeof SaveModelConfigRequest>;
export type ModelConfigRes = z.infer<typeof ModelConfigResponse>;
