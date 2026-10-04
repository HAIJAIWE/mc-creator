/**
 * MC 全链路 AI 工作台 · 薄契约
 * 设计文档 §3 / §9 / §12（v3.1）
 *
 * 唯一强制统一的类型。只有类型，无实现。
 * 外壳永不 import 内核具体实现，只依赖本包接口（§2.2）。
 * 跨内核不统一业务接口，只统一：UI 呈现层 + MCP 工具签名 + 本包契约类型（§2.2）。
 */

/** 四内核版本。devkit 是构建沙箱与工具链内核（§8）。 */
export type Edition = 'java' | 'bedrock' | 'server' | 'devkit';

/**
 * 34 类内容对象（§3 / §9 按家族组织）。
 * 计数 v3.1 已更正：32 → 34（新增 ProxyPlugin，见 §24）。
 */
export type ContentKind =
  | 'game-version'
  | 'java-runtime'
  | 'account'
  | 'cape'
  | 'instance'
  | 'world'
  | 'world-template'
  | 'modpack'
  | 'mod'
  | 'resourcepack'
  | 'shader'
  | 'datapack'
  | 'addon'
  | 'skinpack'
  | 'texturepack'
  | 'skin'
  | 'soundpack'
  | 'languagepack'
  | 'font'
  | 'structure'
  | 'server'
  | 'server-config'
  | 'server-plugin'
  | 'proxy'
  | 'proxy-plugin'
  | 'proxy-config'
  | 'server-backup'
  | 'server-task'
  | 'mod-project'
  | 'plugin-project'
  | 'build-artifact'
  | 'dev-toolchain'
  | 'mapping-set'
  | 'test-harness';

/** §9 家族分组（仅文档性注释，运行时以 ContentKind 为准）。 */
export const CONTENT_FAMILIES = {
  version_runtime: ['game-version', 'java-runtime'],
  identity: ['account', 'cape'],
  instance_env: ['instance', 'world', 'world-template'],
  java_content: ['modpack', 'mod', 'resourcepack', 'shader', 'datapack'],
  bedrock_content: ['addon', 'skinpack', 'texturepack'],
  common_content: ['skin', 'soundpack', 'languagepack', 'font', 'structure'],
  server: [
    'server',
    'server-config',
    'server-plugin',
    'proxy',
    'proxy-plugin',
    'proxy-config',
    'server-backup',
    'server-task',
  ],
  dev: ['mod-project', 'plugin-project', 'build-artifact', 'dev-toolchain', 'mapping-set', 'test-harness'],
} as const satisfies Record<string, readonly ContentKind[]>;

export interface EditionCapability {
  kind: ContentKind;
  supported: boolean;
  /** 语义差异说明（如"对应物为 Add-on"）（§3）。 */
  note?: string;
}

export interface TaskSpec {
  id: string;
  /** install_modpack / generate_content / ...（§3）。 */
  kind: string;
  payload: unknown;
}

export interface ProgressEvent {
  taskId: string;
  /** 0..1，未知进度可省略。 */
  progress?: number;
  stage?: string;
  message?: string;
}

export interface ClassifiedError {
  /** 网络 / 校验 / 版本 / 磁盘 / 权限 / 未知（§14）。 */
  category: 'network' | 'validation' | 'version' | 'disk' | 'permission' | 'unknown';
  message: string;
  code?: string;
  retryable?: boolean;
}

export interface ArtifactRef {
  path: string;
  /** §0.5 硬约束：生成产物哈希必须记录并对外可见。统一 sha256。 */
  sha256: string;
  kind: ContentKind;
}

export interface TaskResult {
  ok: boolean;
  artifacts?: ArtifactRef[];
  error?: ClassifiedError;
  /**
   * 只读查询的数据透传（§10.2 读现状类是闭环必需）：
   * 如实例名列表、日志尾行、配置文本、探测到的目标路径、
   * get_capabilities 的能力表。执行确认语义不变（ok/error）。
   */
  data?: unknown;
}

export interface TaskHandle {
  readonly id: string;
  progress: AsyncIterable<ProgressEvent>;
  cancel(): void;
  result(): Promise<TaskResult>;
}

export interface StatusSnapshot {
  edition: Edition;
  healthy: boolean;
  message?: string;
  updatedAt: string;
}

export interface KernelContract {
  readonly edition: Edition;
  capabilities(): EditionCapability[];
  /** 统一状态快照，供 UI 与智能体消费（§3）。 */
  status(): StatusSnapshot;
  /** 所有长任务统一入口（§3）。 */
  dispatch(task: TaskSpec): TaskHandle;
}

export interface KernelRegistry {
  available(): KernelContract[];
  get(edition: Edition): KernelContract;
}
