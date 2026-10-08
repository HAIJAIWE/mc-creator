## 3. 薄契约（唯一强制统一的类型）

```ts
// packages/contract —— 只有类型，无实现

export type Edition = 'java' | 'bedrock' | 'server' | 'devkit';

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

export interface EditionCapability {
  kind: ContentKind;
  supported: boolean;
  note?: string; // 语义差异说明（如"对应物为 Add-on"）
}

export interface KernelContract {
  readonly edition: Edition;
  capabilities(): EditionCapability[];
  status(): StatusSnapshot; // 统一状态快照，供 UI 与智能体消费
  dispatch(task: TaskSpec): TaskHandle; // 所有长任务统一入口
}

export interface TaskSpec {
  id: string;
  kind: string; // install_modpack / generate_content / ...
  payload: unknown;
}

export interface TaskHandle {
  readonly id: string;
  progress: AsyncIterable<ProgressEvent>;
  cancel(): void;
  result(): Promise<TaskResult>;
}

export interface TaskResult {
  ok: boolean;
  artifacts?: ArtifactRef[]; // 产物（含哈希）
  error?: ClassifiedError;
}

export interface ArtifactRef {
  path: string;
  sha256: string;
  kind: ContentKind;
}

export interface KernelRegistry {
  available(): KernelContract[];
  get(edition: Edition): KernelContract;
}
```

**关键：契约里没有内容操作的统一业务接口。** Mod、Add-on、Skin 等各自归属内核，
不强行统一。跨内核的「统一」只发生在 UI 呈现层和 MCP 工具层。

---
