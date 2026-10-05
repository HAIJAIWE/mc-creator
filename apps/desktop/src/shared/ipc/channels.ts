/** IPC 通道名常量 */
export const IPC = {
  GENERATE_SPEC: 'mod:generateSpec',
  GENERATE_FILES: 'mod:generateFiles',
  BUILD: 'mod:build',
  // === 项目感知文件操作 ===
  FILE_PROJECT_LIST_DIR: 'file:project:listDir',
  FILE_PROJECT_READ_TEXT: 'file:project:readText',
  FILE_PROJECT_WRITE_TEXT: 'file:project:writeText',
  FILE_PROJECT_GET_FILE_META: 'file:project:getFileMeta',
  FILE_PROJECT_WRITE_TEXT_WITH_META: 'file:project:writeTextWithMeta',
  FILE_PROJECT_MAKE_DIR: 'file:project:makeDir',
  FILE_PROJECT_DELETE_ITEM: 'file:project:deleteItem',
  FILE_PROJECT_GET_WORKSPACE: 'file:project:getWorkspace',
  FILE_PROJECT_GET_OUTPUT_DIR: 'file:project:getOutputDir',
  FILE_PROJECT_GET_BUILD_CACHE_DIR: 'file:project:getBuildCacheDir',
  FILE_PROJECT_GET_TEMP_DIR: 'file:project:getTempDir',
  FILE_PROJECT_GET_RESOURCE_PACKS_DIR: 'file:project:getResourcePacksDir',
  FILE_PROJECT_GET_MODS_DIR: 'file:project:getModsDir',
  FILE_PROJECT_GET_EXPORTS_DIR: 'file:project:getExportsDir',
  FILE_PROJECT_ENSURE_DIRS: 'file:project:ensureDirs',
  // === 目录树（批量预取）===
  FILE_PROJECT_LIST_TREE: 'file:project:listTree',
  // === 大文件流式传输 ===
  FILE_PROJECT_WRITE_STREAM: 'file:project:writeStream',
  FILE_PROJECT_READ_STREAM: 'file:project:readStream',
  FILE_PROJECT_WRITE_STREAM_CHUNK: 'file:project:writeStreamChunk',
  FILE_PROJECT_READ_STREAM_CHUNK: 'file:project:readStreamChunk',
} as const;

// === 项目监听 ===
export const PROJECT_WATCH = 'project:watch';
export const PROJECT_CHANGED = 'project:changed';

export interface ProjectChangedPayload {
  type: 'created' | 'updated' | 'deleted';
  projectId: string;
}

// === 进程托管（外壳层只读查询，§7.1 / §7.4 / §10.2）===
// 只列只读通道：列被托管进程 / 读状态 / 读日志尾部 / 控制台流式日志。
// 刻意不提供「直接启动/停止」通道：那必须先经内核确认闸门弹窗（§10.6）。
export const PROCESS_LIST = 'process:list';
export const PROCESS_STATUS = 'process:status';
export const PROCESS_LOGS = 'process:logs';
export const PROCESS_LOG_EVENT = 'process:logEvent';
// 状态变更事件（**通知**，非命令）：自动重启有 1s 起退避，轮询会丢掉崩溃瞬间的
// 告警时机。渲染层只消费 —— 点火权仍在主进程 confirm 闸门（§10.6）。
export const PROCESS_STATE_EVENT = 'process:stateEvent';

// === 内核（外壳 ↔ 内核，§4.2 / §10）===
// 通道名风格沿用 `project:*` / `launcher:*` 的「域:动作」驼峰写法。
//
// 只有下列**只读（R 类）**通道会进 preload 的 contextBridge 白名单。
// `kernel:execute`（W/X 类写实例 / 执行进程）**刻意不进白名单**：内核的确认闸门
// 与错误呈现还没在 UI 上验证完，先只在主进程侧可达。依据见 ./kernel.ts 的注释。
export const KERNEL_LIST_KINDS = 'kernel:listKinds';
export const KERNEL_READ = 'kernel:read';
export const KERNEL_EXECUTE = 'kernel:execute';
