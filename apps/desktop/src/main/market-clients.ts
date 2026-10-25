/**
 * 市场客户端（Modrinth / CurseForge）的**唯一**构造入口。
 *
 * ## 为什么要收成一个文件
 *
 * 根地址候选（官方 / 国内镜像 MCIM）由下载源偏好决定。散在各处
 * `new ModrinthApiClient()` 的话，总有一天会有一处漏掉 —— 那一处就会悄悄
 * 只连官方（或只连镜像），而症状只是「某个页面特别慢」，没人能定位。
 *
 * 每个调用点现取现用（构造很便宜，偏好从内存缓存读）：设置页一改，下一个
 * 请求就是新顺序，不需要重启。
 */
import {
  CurseForgeApiClient,
  ModrinthApiClient,
  OFFICIAL_CURSEFORGE_API,
  apiBases,
  type SourcePreference,
} from '@mc-creator/core';
import { loadCurseForgeConfig } from './credentials/curseforge-config.js';
import { launcherDataDir } from './launcher-dir.js';
import { sourcePreferenceStore } from './download-sources.js';

/** 当前下载源偏好（内存缓存，不读盘）。 */
export function currentSourcePreference(): SourcePreference {
  return sourcePreferenceStore(launcherDataDir()).read();
}

/** Modrinth 客户端（根地址按下载源偏好排序）。 */
export function createModrinthClient(): ModrinthApiClient {
  return new ModrinthApiClient(apiBases('modrinth', currentSourcePreference()));
}

/**
 * CurseForge 客户端。
 *
 * key 缺省取用户配置。注意 key **只会在官方根上使用**（见 `CurseForgeApiClient`
 * 的说明）：走到镜像时那个请求是镜像自己的 key，我们不会把用户的凭证发出去。
 * 也就是说 —— **没配 key 也能查 CurseForge**（走镜像），这正是 PCL 的现状。
 */
export function createCurseForgeClient(
  apiKey: string = loadCurseForgeConfig().apiKey,
): CurseForgeApiClient {
  return new CurseForgeApiClient(apiKey, apiBases('curseforge', currentSourcePreference()));
}

/**
 * **只连官方根**的客户端，用于“测试这把 key 有没有效”。
 *
 * 不能复用 `createCurseForgeClient()`：镜像优先时请求走镜像、带的是镜像的
 * key，用户填的那把压根没被验证。测试通道必须绕开下载源偏好。
 */
export function createOfficialCurseForgeClient(apiKey: string): CurseForgeApiClient {
  return new CurseForgeApiClient(apiKey, [OFFICIAL_CURSEFORGE_API]);
}
