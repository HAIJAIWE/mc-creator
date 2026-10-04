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
