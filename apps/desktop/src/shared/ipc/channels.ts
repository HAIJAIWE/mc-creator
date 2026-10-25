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

// === 进程托管（外壳层，§7.1 / §7.4 / §10.2）===
// 查询通道只读：列被托管进程 / 读状态 / 读日志尾部 / 控制台流式日志。
// 有副作用的启动/停止都必须先经主进程原生确认闸门（§10.6）。
export const PROCESS_LIST = 'process:list';
/**
 * 启动服务端（X 类，§10.6：主进程弹原生确认框后才真正 spawn）。
 *
 * 只传 serverId，不传 cmd —— 见 `ProcessLaunchRequest` 的注释。
 */
export const PROCESS_LAUNCH = 'process:launch';
/**
 * 停止服务端（X 类，§10.6：主进程弹原生确认框后才发送 stop）。
 *
 * 只传 serverId，不传 PID/信号/命令 —— 目标进程由 supervisor 按 id 解析。
 */
export const PROCESS_STOP = 'process:stop';
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

// === UI 确认（X1：主进程侧 UI 确认，为开放 kernel:execute 做准备，本任务不开白名单）===
// main→renderer 是 send（主进程主动推请求），renderer→main 是 invoke（渲染层应答）。
// 本任务只定通道名、不接线（接线是 X2 的事），且刻意不进 preload 白名单 ——
// 白名单开的是「renderer 主动调 main」的读通道，而这里是「main 主动问 renderer」：
// 渲染层只有应答权、没有发起权（XSS 伪造的"同意"必须先有主进程的请求 id 才有效）。
export const KERNEL_CONFIRM_REQUEST = 'kernel:confirm-request';
export const KERNEL_CONFIRM_RESPONSE = 'kernel:confirm-response';
