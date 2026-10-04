/**
 * §12 数据模型（概要）。所有表带 edition 字段或显式区域归属；
 * 所有写入走版本化迁移脚本。
 *
 * 注意（§24 遗留）：World / Message / 产物关联表、对象级去重、
 * 多实例资源仲裁、RCON 口令策略在本版仍未建模，此处以 [待核实] 标注，
 * 实现前须核对官方文档（§21）。
 */

import type { ContentKind, Edition } from './contract.js';

export interface Instance {
  id: string;
  edition: Edition;
  name: string;
  versionId: string;
  loader?: string;
  javaPath?: string;
  dir: string;
  createdAt: string;
}

export interface Account {
  id: string;
  /** 正版 / 离线 / 第三方（§5.8：离线仅本地开发，第三方默认关闭）。 */
  type: 'microsoft' | 'offline' | 'third-party';
  uuid: string;
  name: string;
  /** OS 级加密（safeStorage），禁止明文落盘（§13.2）。 */
  encryptedToken: string;
  skinModel?: 'classic' | 'slim';
  capeRef?: string;
}

export interface ContentRef {
  kind: ContentKind;
  source: 'modrinth' | 'curseforge' | 'local' | 'generated';
  projectId: string;
  versionId: string;
  /** 下载物必须校验哈希（§13.3）。 */
  hash: string;
  files: string[];
}

export interface ModpackRef {
  source: 'modrinth' | 'curseforge' | 'local';
  projectId: string;
  versionId: string;
  files: Array<{ path: string; hash: string }>;
  overrides: string[];
}

export interface Server {
  id: string;
  edition: Edition;
  /** paper / purpur / folia / spigot / forge / neoforge / fabric / bds / velocity / ...（§7.2）。 */
  runtime: string;
  versionId: string;
  dir: string;
  port: number;
  props: Record<string, string>;
  plugins: string[];
  state: 'stopped' | 'running' | 'starting' | 'stopping' | 'crashed';
}

export interface ServerConfig {
  serverId: string;
  files: Record<string, string>;
  lastApplied: string;
}

export interface PluginProject {
  id: string;
  name: string;
  target: 'paper' | 'folia' | 'spigot';
  /** 如 '26.1.2'（§7.3）。运行时拉取，禁止写死（§0.5）。 */
  apiVersion: string;
  /** Folia 硬开关：不声明则无法在 Folia 运行（§7.3）。 */
  foliaSupported: boolean;
  files: string[];
}

export interface ProxyPlugin {
  id: string;
  name: string;
  target: 'velocity' | 'bungeecord' | 'waterfall';
  apiVersion: string;
  files: string[];
}

export interface SchemaVersion {
  version: number;
  appliedAt: string;
  checksum: string;
}

export interface BuildArtifact {
  id: string;
  projectId: string;
  jarPath: string;
  sha256: string;
  targetMatrix: string[];
}

export interface TaskRecord {
  id: string;
  kind: string;
  state: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled';
  progress?: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}

export interface Setting {
  key: string;
  value: string;
  scope: 'global' | 'edition' | 'instance';
}

export interface Conversation {
  id: string;
  instanceId?: string;
  edition?: Edition;
  messages: Array<{ role: string; content: string }>;
  tokenUsage?: { input: number; output: number };
}

/** [待核实] §24 遗留：World 实体尚未在 §12 建模，先占位，后续按官方存档格式补齐。 */
export interface World {
  id: string;
  edition: Edition;
  name: string;
  dir: string;
}
