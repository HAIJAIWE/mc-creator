import { ipcMain, dialog, app } from 'electron';
import { writeFile, mkdir, readFile, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join, basename } from 'node:path';
import { homedir } from 'node:os';
import JSZip from 'jszip';
import { z } from 'zod';
import { IPty, spawn as ptySpawn } from 'node-pty';
import { LauncherService } from './launcher-service.js';
import {
  Orchestrator,
  runGradleBuild,
  detectJavaVersion,
  MockProvider,
  VercelAiProvider,
  BuildFixer,
  Filesystem,
  ModrinthApiClient,
  CurseForgeApiClient,
  createDefaultRegistry,
  ModGenerator,
  type BuildCacheSnapshot,
  type SpecType,
} from '@mc-creator/core';
import * as nodeFs from 'fs';
import type { ModSpec } from '@mc-creator/shared';
import { assertWithin, parseGitStatus } from './ipc-utils.js';
import { loadModelConfig, saveModelConfig, type ModelConfigFull } from './model-config.js';
import { loadCurseForgeConfig, saveCurseForgeConfig } from './curseforge-config.js';
import { loadProjects, saveProject, deleteProject, getProject } from './project-store.js';
import { buildChatSystemMessage } from './chat-system-message.js';
import {
  IPC,
  EXPORT_ZIP,
  SAVE_FILE,
  SAVE_ALL_FILES,
  PREPARE_BUILD_DIR,
  EXPORT_PROJECT,
  IMPORT_PROJECT,
  EXPORT_SPEC,
  IMPORT_SPEC,
  ExportSpecRequest,
  ImportSpecResponse,
  SpecSnapshotSchema,
  LAUNCHER_LIST_VERSIONS,
  LAUNCHER_DOWNLOAD,
  LAUNCHER_LAUNCH,
  LauncherListVersionsResponse,
  LauncherDownloadRequest,
  LauncherDownloadResponse,
  LauncherLaunchRequest,
  LauncherLaunchResponse,
  GenerateSpecRequest,
  GenerateFilesRequest,
  BuildRequest,
  SaveModelConfigRequest,
  ModelConfigResponse,
  ChatRequest,
  ChatStreamRequest,
  ExportZipRequest,
  SaveFileRequest,
  SaveAllFilesRequest,
  PrepareBuildDirRequest,
  ExportProjectRequest,
  ProjectSchema,
  LOAD_MODEL_CONFIG,
  SAVE_MODEL_CONFIG,
  CHAT,
  CHAT_STREAM,
  CHAT_STREAM_CHUNK,
  EXPLAIN_CODE,
  EXPLAIN_CODE_CHUNK,
  COMPARE_MODELS,
  COMPARE_MODELS_CHUNK,
  CompareModelsRequest,
  ExplainCodeRequest,
  BUILD_WITH_FIX,
  BuildWithFixRequest,
  AI_FIX_SUGGEST,
  AI_FIX_SUGGEST_CHUNK,
  AiFixSuggestRequest,
  BUILD_STREAM,
  BUILD_STREAM_CHUNK,
  BuildStreamRequest,
  LIST_PROJECTS,
  GET_PROJECT,
  SAVE_PROJECT,
  DELETE_PROJECT,
  MODRINTH_SEARCH,
  MODRINTH_VERSIONS,
  ModrinthSearchRequest,
  ModrinthVersionsRequest,
  CURSEFORGE_SEARCH,
  CURSEFORGE_FILES,
  LOAD_CURSEFORGE_CONFIG,
  SAVE_CURSEFORGE_CONFIG,
  CurseForgeSearchRequest,
  CurseForgeFilesRequest,
  CurseForgeConfigSchema,
  GIT_CHOOSE_REPO,
  GIT_STATUS,
  GIT_LOG,
  GIT_COMMIT,
  GIT_PULL,
  GIT_PUSH,
  GIT_BRANCH_LIST,
  GIT_BRANCH_CREATE,
  GIT_BRANCH_SWITCH,
  GIT_ADD,
  GIT_RESET,
  GIT_DIFF,
  TERMINAL_SPAWN,
  TERMINAL_DATA,
  TERMINAL_EXIT,
  TERMINAL_WRITE,
  TERMINAL_RESIZE,
  TERMINAL_KILL,
  GitStatusRequest,
  GitLogRequest,
  GitCommitRequest,
  GitPullRequest,
  GitPushRequest,
  type GitChooseRepoRes,
  type GitStatusRes,
  type GitLogRes,
  type GitCommitRes,
  type GitSyncRes,
  type GenerateSpecRes,
  type GenerateFilesRes,
  type BuildRes,
  type ExportZipRes,
  type SaveFileRes,
  type SaveAllFilesRes,
  type PrepareBuildDirRes,
  type ExportProjectRes,
  type ImportProjectRes,
  type Project,
  type ModrinthSearchRes,
  type ModrinthVersionsRes,
  type CurseForgeSearchRes,
  type CurseForgeFilesRes,
  LOCATE_MC,
  MC_CHOOSE_DIR,
  INSTALL_MOD,
  LAUNCH_MC,
  InstallModRequest,
  LaunchMcRequest,
  type LocateMcRes,
  type McChooseDirRes,
  type InstallModRes,
  type LaunchMcRes,
  IMPORT_RESOURCE_FILES,
  ImportResourceFilesRequest,
  type ImportResourceFilesRes,
  NODE_GRAPH_SAVE,
  NODE_GRAPH_LOAD,
  NODE_GRAPH_SHOW_SAVE_DIALOG,
  NODE_GRAPH_SHOW_OPEN_DIALOG,
  NodeGraphSaveRequest,
  NodeGraphLoadRequest,
  NodeGraphShowSaveDialogRequest,
} from '../shared/ipc-channels.js';

/**
 * 注册 IPC 处理器（规格 §4 端到端数据流）。
 * 主进程调 core 引擎，结果经 zod 校验后返回渲染进程。
 */
export function registerIpcHandlers(getOrchestrator: () => Orchestrator): void {
  // 生成器注册表（P1：替代 switch/case，新增生成器只需在 createDefaultRegistry 注册）
  const generatorRegistry = createDefaultRegistry();

  // P1-4：增量构建缓存快照（跨请求保持，按 modId::loader::category 隔离）。
  // 首次构建为 undefined → 全量生成；后续构建传入上次快照 → 类别级增量。
  let modBuildCacheSnapshot: BuildCacheSnapshot | undefined;

  ipcMain.handle(IPC.GENERATE_SPEC, async (_e, raw: unknown): Promise<GenerateSpecRes> => {
    const req = GenerateSpecRequest.parse(raw);
    const orchestrator = getOrchestrator();
    // P16：按 generatorType 调用对应 prompt + schema 校验
    const spec = await orchestrator.generateSpecByType(req.description, req.generatorType);
    return { spec: spec as Record<string, unknown>, raw: JSON.stringify(spec, null, 2) };
  });

  ipcMain.handle(IPC.GENERATE_FILES, async (_e, raw: unknown): Promise<GenerateFilesRes> => {
    const req = GenerateFilesRequest.parse(raw);
    const gen = generatorRegistry.get(req.generatorType);
    if (!gen) {
      return { files: [], warnings: [`不支持的生成器类型：${req.generatorType}`] };
    }
    // modId 可能从 spec 顶层或单独字段取
    const modId = req.modId || (req.spec as { modId?: string }).modId || 'mc_creator';
    const genCtx = {
      loader: req.loader,
      mcVersion: req.mcVersion,
      modId,
      spec: req.spec as unknown as ModSpec,
      projectPath: '',
    };

    // P1-4：ModGenerator 走增量构建（类别级缓存），其他生成器走全量 generate
    if (gen instanceof ModGenerator) {
      const incResult = await gen.generateWithCache(genCtx, modBuildCacheSnapshot);
      // 更新缓存快照，供下次构建复用
      modBuildCacheSnapshot = incResult.cacheSnapshot;
      return {
        files: incResult.files,
        warnings: incResult.warnings,
        buildStats: incResult.stats,
      };
    }

    const result = await gen.generate(genCtx);
    return { files: result.files, warnings: result.warnings };
  });

  ipcMain.handle(IPC.BUILD, async (_e, raw: unknown): Promise<BuildRes> => {
    const req = BuildRequest.parse(raw);
    const java = await detectJavaVersion();
    if (java === null) {
      return { success: false, jarPath: null, log: '未检测到 Java，请安装 JDK 21+' };
    }
    const result = await runGradleBuild(req.projectPath);
    return { success: result.success, jarPath: result.jarPath, log: result.log };
  });

  // 模型配置
  ipcMain.handle(LOAD_MODEL_CONFIG, async () => {
    const config = loadModelConfig();
    return ModelConfigResponse.parse(config);
  });

  ipcMain.handle(SAVE_MODEL_CONFIG, async (_e, raw: unknown) => {
    const req = SaveModelConfigRequest.parse(raw);
    saveModelConfig(req as ModelConfigFull);
    return { ok: true };
  });

  // AI 聊天
  let chatProvider: VercelAiProvider | null = null;

  ipcMain.handle(CHAT, async (_e, raw: unknown) => {
    const req = ChatRequest.parse(raw);
    const config = loadModelConfig();
    if (!config.apiKey) {
      return { reply: '请先在设置中配置 API Key。' };
    }
    if (!chatProvider || chatProvider.id !== config.modelId) {
      chatProvider = new VercelAiProvider(config);
    }
    const reply = await chatProvider.complete(req.message, {
      system: '你是 Minecraft mod 专家助手，帮助用户设计 mod。',
    });
    return { reply };
  });

  // 流式 AI 聊天
  ipcMain.handle(CHAT_STREAM, async (e, raw: unknown) => {
    const req = ChatStreamRequest.parse(raw);
    const config = loadModelConfig();
    if (!config.apiKey) {
      e.sender.send(CHAT_STREAM_CHUNK, { delta: '请先在设置中配置 API Key。', done: true });
      return;
    }

    // P12 chat 模式工具调用增强：根据 context 构建增强 system message
    const systemMessage = buildChatSystemMessage(req.context);

    const provider = new VercelAiProvider(config);
    try {
      for await (const chunk of provider.stream(req.message, {
        system: systemMessage,
      })) {
        e.sender.send(CHAT_STREAM_CHUNK, { delta: chunk.delta, done: chunk.done });
      }
    } catch (err) {
      e.sender.send(CHAT_STREAM_CHUNK, { delta: `错误：${(err as Error).message}`, done: true });
    }
  });

  // 流式 AI 解释代码
  ipcMain.handle(EXPLAIN_CODE, async (e, raw: unknown) => {
    const req = ExplainCodeRequest.parse(raw);
    const config = loadModelConfig();
    if (!config.apiKey) {
      e.sender.send(EXPLAIN_CODE_CHUNK, { delta: '请先在设置中配置 API Key。', done: true });
      return;
    }

    const provider = new VercelAiProvider(config);
    const prompt = `请解释以下 Minecraft 项目文件代码：${req.fileName}

代码内容：
\`\`\`
${req.code}
\`\`\`

请从以下几个方面解释：
1. 文件作用（在项目中的角色）
2. 关键代码逻辑（逐段说明）
3. Minecraft 模组开发相关知识点（如 loader API、事件、注册等）
4. 可能的改进建议或注意事项

用中文回答，使用 Markdown 格式，简洁清晰。`;

    try {
      for await (const chunk of provider.stream(prompt, {
        system: '你是 Minecraft 模组开发专家，擅长解释代码并教学。回答使用中文。',
      })) {
        e.sender.send(EXPLAIN_CODE_CHUNK, { delta: chunk.delta, done: chunk.done });
      }
    } catch (err) {
      e.sender.send(EXPLAIN_CODE_CHUNK, { delta: `错误：${(err as Error).message}`, done: true });
    }
  });

  // 多模型对比
  ipcMain.handle(COMPARE_MODELS, async (e, raw: unknown) => {
    const req = CompareModelsRequest.parse(raw);

    // 并行为每个模型生成 Spec
    const promises = req.models.map(async (modelConfig) => {
      const provider = new VercelAiProvider(modelConfig);
      const orchestrator = new Orchestrator(provider);
      try {
        const spec = await orchestrator.generateSpecByType(
          req.description,
          req.generatorType as SpecType,
        );
        e.sender.send(COMPARE_MODELS_CHUNK, {
          modelName: modelConfig.name,
          delta: JSON.stringify(spec, null, 2),
          done: true,
        });
      } catch (err) {
        e.sender.send(COMPARE_MODELS_CHUNK, {
          modelName: modelConfig.name,
          delta: `错误：${(err as Error).message}`,
          done: true,
        });
      }
    });

    await Promise.all(promises);
  });

  // 带修复循环的构建
  ipcMain.handle(BUILD_WITH_FIX, async (_e, raw: unknown) => {
    const req = BuildWithFixRequest.parse(raw);
    const config = loadModelConfig();

    // P3 类型：node fs 与 memfs IFs 接口存在结构差异（memfs 自身扩展方法），
    // 通过 unknown 中转，运行时 Filesystem 只调用两者都有的标准方法
    type FsLike = ConstructorParameters<typeof Filesystem>[0];
    const realFs = new Filesystem(nodeFs as unknown as FsLike);
    let fixer: BuildFixer;
    if (config.apiKey) {
      const { VercelAiProvider } = await import('@mc-creator/core');
      fixer = new BuildFixer(realFs, new VercelAiProvider(config));
    } else {
      fixer = new BuildFixer(realFs, new MockProvider(''));
    }

    const result = await fixer.buildWithFix(req.projectPath);
    return {
      success: result.success,
      attempts: result.attempts,
      jarPath: result.finalResult.jarPath,
      log: result.finalResult.log,
      fixLog: result.fixLog,
    };
  });

  // AI 修复建议（流式）
  ipcMain.handle(AI_FIX_SUGGEST, async (e, raw: unknown) => {
    const req = AiFixSuggestRequest.parse(raw);
    const config = loadModelConfig();
    if (!config.apiKey) {
      e.sender.send(AI_FIX_SUGGEST_CHUNK, { delta: '请先在设置中配置 API Key。', done: true });
      return;
    }

    const provider = new VercelAiProvider(config);

    // 截断文件内容避免 prompt 过长（每个文件最多 2000 字符，取前 5 个）
    const filesPreview = req.files
      .slice(0, 5)
      .map((f) => ({ path: f.path, content: f.content.slice(0, 2000) }));

    const filesSection =
      filesPreview.length > 0
        ? `\n\n项目文件预览：\n\`\`\`\n${filesPreview.map((f) => `--- ${f.path} ---\n${f.content}`).join('\n\n')}\n\`\`\``
        : '';

    const prompt = `请分析以下 Minecraft 模组构建错误日志，给出修复建议。

构建错误日志：
\`\`\`
${req.buildLog}
\`\`\`${filesSection}

请从以下几个方面分析：
1. **错误原因**：分析日志中的错误信息，找出根本原因（如缺少依赖、语法错误、配置错误、API 不兼容等）
2. **修复方案**：给出具体的修复步骤
3. **修复代码**：如果可能，给出修复后的代码片段（用 diff 或 code block 格式标注修改处）

用中文回答，使用 Markdown 格式。`;

    try {
      for await (const chunk of provider.stream(prompt, {
        system:
          '你是 Minecraft 模组开发专家，擅长诊断构建错误并提供修复方案。回答使用中文，简洁清晰，重点突出。',
      })) {
        e.sender.send(AI_FIX_SUGGEST_CHUNK, { delta: chunk.delta, done: chunk.done });
      }
    } catch (err) {
      e.sender.send(AI_FIX_SUGGEST_CHUNK, { delta: `错误：${(err as Error).message}`, done: true });
    }
  });

  // 流式构建（P20）：spawn gradlew，逐行推送 stdout/stderr
  const activeBuildProcesses = new Set<ReturnType<typeof spawn>>();
  ipcMain.handle(BUILD_STREAM, async (e, raw: unknown) => {
    const req = BuildStreamRequest.parse(raw);
    const cwd = req.projectPath;
    // Windows 用 gradlew.bat，Unix 用 ./gradlew；避免 shell:true 降低命令注入风险
    const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    const child = spawn(cmd, ['build'], { cwd });
    activeBuildProcesses.add(child);

    child.stdout?.on('data', (data) => {
      e.sender.send(BUILD_STREAM_CHUNK, { type: 'stdout', text: data.toString(), done: false });
    });
    child.stderr?.on('data', (data) => {
      e.sender.send(BUILD_STREAM_CHUNK, { type: 'stderr', text: data.toString(), done: false });
    });
    child.on('close', (code) => {
      activeBuildProcesses.delete(child);
      e.sender.send(BUILD_STREAM_CHUNK, {
        type: 'exit',
        text: `进程退出，code=${code}`,
        done: true,
        exitCode: code,
      });
    });
    child.on('error', (err) => {
      activeBuildProcesses.delete(child);
      e.sender.send(BUILD_STREAM_CHUNK, {
        type: 'stderr',
        text: `进程启动失败：${err.message}`,
        done: true,
        exitCode: -1,
      });
    });
  });

  // 应用退出时清理所有活跃的构建子进程（PTY 清理在 ptySessions 定义后追加）
  app.on('before-quit', () => {
    for (const child of activeBuildProcesses) {
      try {
        child.kill();
      } catch {
        /* 进程可能已退出 */
      }
    }
    activeBuildProcesses.clear();
  });

  // 导出 zip
  ipcMain.handle(EXPORT_ZIP, async (_e, raw: unknown): Promise<ExportZipRes> => {
    const req = ExportZipRequest.parse(raw);
    const result = await dialog.showSaveDialog({
      defaultPath: req.defaultName,
      filters: [{ name: 'ZIP', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, savedPath: null };
    }
    const zip = new JSZip();
    for (const f of req.files) {
      if (f.path.endsWith('.png')) {
        // PNG 的 content 是 base64 字符串，写入 zip 时需 decode 为二进制
        zip.file(f.path, Buffer.from(f.content, 'base64'));
      } else {
        zip.file(f.path, f.content);
      }
    }
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(result.filePath, buf);
    return { ok: true, canceled: false, savedPath: result.filePath };
  });

  // 单文件保存到磁盘
  ipcMain.handle(SAVE_FILE, async (_e, raw: unknown): Promise<SaveFileRes> => {
    const req = SaveFileRequest.parse(raw);
    const defaultName = req.defaultName || req.path.split('/').pop() || 'file.txt';
    const result = await dialog.showSaveDialog({
      defaultPath: defaultName,
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, savedPath: null };
    }
    // PNG 走 base64 解码写入，其他文件按 utf-8 文本写入
    if (req.path.endsWith('.png')) {
      await writeFile(result.filePath, Buffer.from(req.content, 'base64'));
    } else {
      await writeFile(result.filePath, req.content, 'utf-8');
    }
    return { ok: true, canceled: false, savedPath: result.filePath };
  });

  // 协作编辑：导出 Spec 快照文件（.mc-spec.json）
  ipcMain.handle(EXPORT_SPEC, async (_e, raw: unknown) => {
    const req = ExportSpecRequest.parse(raw);
    const result = await dialog.showSaveDialog({
      defaultPath: `${req.generatorType}-spec.mc-spec.json`,
      filters: [{ name: 'MC Spec 快照', extensions: ['mc-spec.json', 'json'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, savedPath: null };
    }
    const snapshot = {
      meta: {
        exportedAt: new Date().toISOString(),
        exporter: '',
        description: req.description,
        generatorType: req.generatorType,
      },
      spec: req.spec,
    };
    await writeFile(result.filePath, JSON.stringify(snapshot, null, 2), 'utf-8');
    return { ok: true, canceled: false, savedPath: result.filePath };
  });

  // 协作编辑：导入 Spec 快照文件
  ipcMain.handle(IMPORT_SPEC, async (): Promise<z.infer<typeof ImportSpecResponse>> => {
    const result = await dialog.showOpenDialog({
      filters: [{ name: 'MC Spec 快照', extensions: ['mc-spec.json', 'json'] }],
      properties: ['openFile'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { snapshot: null, canceled: true };
    }
    try {
      const content = await readFile(result.filePaths[0], 'utf-8');
      const parsed = SpecSnapshotSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        return {
          snapshot: null,
          canceled: false,
          error: `Spec 快照格式无效：${parsed.error.issues.map((i) => i.path.join('.') || i.message).join('; ')}`,
        };
      }
      return { snapshot: parsed.data, canceled: false };
    } catch (e) {
      return { snapshot: null, canceled: false, error: `读取失败：${(e as Error).message}` };
    }
  });

  // ===== 游戏启动器（下载客户端 + 离线启动）=====

  const launcherDir = join(app.getPath('userData'), 'mc-launcher');
  const launcher = new LauncherService(launcherDir);

  // 版本清单
  ipcMain.handle(
    LAUNCHER_LIST_VERSIONS,
    async (): Promise<z.infer<typeof LauncherListVersionsResponse>> => {
      try {
        const versions = await launcher.listVersions();
        return {
          versions: versions.map((v) => ({ id: v.id, type: v.type, releaseTime: v.releaseTime })),
        };
      } catch (e) {
        return { versions: [], error: (e as Error).message };
      }
    },
  );

  // 下载客户端（jar + assets + libraries 顺序执行）
  ipcMain.handle(
    LAUNCHER_DOWNLOAD,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherDownloadResponse>> => {
      try {
        const req = LauncherDownloadRequest.parse(raw);
        const detail = await launcher.resolveVersion(req.version);
        await launcher.downloadClient(detail);
        await launcher.downloadAssets(detail);
        await launcher.downloadLibraries(detail);
        return { ok: true };
      } catch (e) {
        return { ok: false, error: (e as Error).message };
      }
    },
  );

  // 启动游戏（离线模式）
  ipcMain.handle(
    LAUNCHER_LAUNCH,
    async (_e, raw: unknown): Promise<z.infer<typeof LauncherLaunchResponse>> => {
      try {
        const req = LauncherLaunchRequest.parse(raw);
        const detail = await launcher.resolveVersion(req.version);
        const result = await launcher.launchGame(detail, {
          username: req.username,
          memory: req.memory,
          gameDir: req.gameDir,
        });
        return { pid: result.pid };
      } catch (e) {
        return { pid: 0, error: (e as Error).message };
      }
    },
  );

  // 保存全部文件到磁盘（选择目录后按相对路径写入）
  ipcMain.handle(SAVE_ALL_FILES, async (_e, raw: unknown): Promise<SaveAllFilesRes> => {
    const req = SaveAllFilesRequest.parse(raw);
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true, savedDir: null, count: 0 };
    }
    const baseDir = result.filePaths[0];
    let count = 0;
    for (const f of req.files) {
      // 安全：禁止 ../.. 逃逸出 baseDir
      assertWithin(baseDir, f.path);
      const abs = join(baseDir, f.path);
      await mkdir(dirname(abs), { recursive: true });
      if (f.path.endsWith('.png')) {
        await writeFile(abs, Buffer.from(f.content, 'base64'));
      } else {
        await writeFile(abs, f.content, 'utf-8');
      }
      count++;
    }
    return { ok: true, canceled: false, savedDir: baseDir, count };
  });

  // 资源文件导入：弹出文件选择对话框，读取文件并 base64 编码返回
  ipcMain.handle(
    IMPORT_RESOURCE_FILES,
    async (_e, raw: unknown): Promise<ImportResourceFilesRes> => {
      const req = ImportResourceFilesRequest.parse(raw);
      const filters = [{ name: req.title, extensions: req.extensions }];
      const result = await dialog.showOpenDialog({
        title: req.title,
        properties: req.multiSelect ? ['openFile', 'multiSelections'] : ['openFile'],
        filters,
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true, files: [] };
      }
      const files: ImportResourceFilesRes['files'] = [];
      for (const filePath of result.filePaths) {
        try {
          const buf = await readFile(filePath);
          const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
          files.push({
            sourcePath: filePath,
            fileName: basename(filePath),
            ext,
            base64: buf.toString('base64'),
            size: buf.length,
          });
        } catch (err) {
          // 单文件读取失败不阻断整体导入，跳过
          console.warn(`导入资源文件失败: ${filePath}`, err);
        }
      }
      return { ok: true, canceled: false, files };
    },
  );

  // 准备构建目录（P22-4）：把内存中的 files 写入临时目录，返回绝对路径供后续 BUILD/BUILD_STREAM/BUILD_WITH_FIX 使用
  ipcMain.handle(PREPARE_BUILD_DIR, async (_e, raw: unknown): Promise<PrepareBuildDirRes> => {
    const req = PrepareBuildDirRequest.parse(raw);
    const projectPath = join(app.getPath('temp'), `mc-creator-build-${Date.now()}`);
    await mkdir(projectPath, { recursive: true });
    for (const f of req.files) {
      // P0 安全：校验 f.path 解析后仍位于 projectPath 内，防止 ../.. 逃逸写入任意文件
      assertWithin(projectPath, f.path);
      const abs = join(projectPath, f.path);
      await mkdir(dirname(abs), { recursive: true });
      if (f.path.endsWith('.png')) {
        // PNG 的 content 是 base64 字符串，写入时 decode 为二进制
        await writeFile(abs, Buffer.from(f.content, 'base64'));
      } else {
        await writeFile(abs, f.content, 'utf-8');
      }
    }
    return { projectPath };
  });

  // 项目管理
  ipcMain.handle(LIST_PROJECTS, async () => {
    return loadProjects();
  });

  ipcMain.handle(GET_PROJECT, async (_e, raw: unknown): Promise<Project | null> => {
    const { id } = z.object({ id: z.string() }).parse(raw);
    return getProject(id);
  });

  ipcMain.handle(SAVE_PROJECT, async (_e, raw: unknown) => {
    const project = ProjectSchema.parse(raw);
    saveProject(project);
    return { ok: true };
  });

  ipcMain.handle(DELETE_PROJECT, async (_e, raw: unknown) => {
    const { id } = z.object({ id: z.string() }).parse(raw);
    deleteProject(id);
    return { ok: true };
  });

  // === 项目导出（P28）：把整个 Project 序列化为 project.json 打包成 zip ===
  ipcMain.handle(EXPORT_PROJECT, async (_e, raw: unknown): Promise<ExportProjectRes> => {
    const req = ExportProjectRequest.parse(raw);
    const project = req.project;
    const result = await dialog.showSaveDialog({
      defaultPath: `${project.name}.mcproject.zip`,
      filters: [{ name: 'MC Project', extensions: ['zip'] }],
    });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, savedPath: null };
    }
    const zip = new JSZip();
    zip.file('project.json', JSON.stringify(project, null, 2));
    const buf = await zip.generateAsync({ type: 'nodebuffer' });
    await writeFile(result.filePath, buf);
    return { ok: true, canceled: false, savedPath: result.filePath };
  });

  // === 项目导入（P28）：解压 zip → 解析 project.json → 校验 → 生成新 id 保存 ===
  ipcMain.handle(IMPORT_PROJECT, async (): Promise<ImportProjectRes> => {
    try {
      const openResult = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'MC Project', extensions: ['zip'] }],
      });
      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { project: null, error: null };
      }
      const buf = await readFile(openResult.filePaths[0]);
      const zip = await JSZip.loadAsync(buf);
      const projectFile = zip.file('project.json');
      if (!projectFile) {
        return { project: null, error: 'zip 内未找到 project.json' };
      }
      const jsonStr = await projectFile.async('string');
      const parsed = ProjectSchema.parse(JSON.parse(jsonStr));
      // 生成新 id + 更新时间戳，避免覆盖原项目
      const now = new Date().toISOString();
      const newProject: Project = {
        ...parsed,
        id: randomUUID(),
        createdAt: now,
        updatedAt: now,
      };
      saveProject(newProject);
      return { project: newProject, error: null };
    } catch (e) {
      return { project: null, error: (e as Error).message };
    }
  });

  // === Modrinth 搜索（P25）：主进程转发 API 调用，避免渲染进程 CORS ===
  const modrinthClient = new ModrinthApiClient();

  ipcMain.handle(MODRINTH_SEARCH, async (_e, raw: unknown): Promise<ModrinthSearchRes> => {
    const req = ModrinthSearchRequest.parse(raw);
    const hits = await modrinthClient.search(req.query, {
      loader: req.loader,
      mcVersion: req.mcVersion,
      limit: req.limit,
    });
    return { hits };
  });

  ipcMain.handle(MODRINTH_VERSIONS, async (_e, raw: unknown): Promise<ModrinthVersionsRes> => {
    const req = ModrinthVersionsRequest.parse(raw);
    const versions = await modrinthClient.getVersions(req.projectId, {
      loader: req.loader,
      mcVersion: req.mcVersion,
    });
    return { versions };
  });

  // === CurseForge 搜索（P29：与 P25 Modrinth 共同构成资源市场，需 API key） ===
  // 每次调用从 config 读 apiKey → new CurseForgeApiClient；apiKey 为空时 client 内部抛错透传给渲染进程
  ipcMain.handle(LOAD_CURSEFORGE_CONFIG, async () => {
    return loadCurseForgeConfig();
  });

  ipcMain.handle(SAVE_CURSEFORGE_CONFIG, async (_e, raw: unknown) => {
    const req = CurseForgeConfigSchema.parse(raw);
    saveCurseForgeConfig(req);
    return { ok: true };
  });

  ipcMain.handle(CURSEFORGE_SEARCH, async (_e, raw: unknown): Promise<CurseForgeSearchRes> => {
    const req = CurseForgeSearchRequest.parse(raw);
    const { apiKey } = loadCurseForgeConfig();
    const client = new CurseForgeApiClient(apiKey);
    const hits = await client.search(req.query, {
      loader: req.loader,
      mcVersion: req.mcVersion,
      limit: req.limit,
    });
    return { hits };
  });

  ipcMain.handle(CURSEFORGE_FILES, async (_e, raw: unknown): Promise<CurseForgeFilesRes> => {
    const req = CurseForgeFilesRequest.parse(raw);
    const { apiKey } = loadCurseForgeConfig();
    const client = new CurseForgeApiClient(apiKey);
    const files = await client.getFiles(req.modId, {
      loader: req.loader,
      mcVersion: req.mcVersion,
    });
    return { files };
  });

  // === 源代码管理（Git 桥接）：主进程跑 git，渲染进程只展示 ===
  const runGit = (args: string[], cwd: string) =>
    new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      const child = spawn('git', args, { cwd });
      let stdout = '';
      let stderr = '';
      child.stdout?.on('data', (d) => (stdout += d.toString()));
      child.stderr?.on('data', (d) => (stderr += d.toString()));
      child.on('error', (err) => {
        stderr += err.message;
        resolve({ code: -1, stdout, stderr });
      });
      child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
    });

  // parseGitStatus 已提取到模块级（见文件顶部），便于单测

  ipcMain.handle(GIT_CHOOSE_REPO, async (): Promise<GitChooseRepoRes> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle(GIT_STATUS, async (_e, raw: unknown): Promise<GitStatusRes> => {
    const { repoPath } = GitStatusRequest.parse(raw);
    const { code, stdout, stderr } = await runGit(['status', '--porcelain', '-b'], repoPath);
    if (code !== 0) {
      return {
        ok: false,
        branch: null,
        upstream: null,
        ahead: 0,
        behind: 0,
        clean: true,
        files: [],
        error: stderr || '无法读取仓库状态（可能不是 git 仓库或 git 未安装）',
      };
    }
    return { ok: true, ...parseGitStatus(stdout), error: null };
  });

  ipcMain.handle(GIT_LOG, async (_e, raw: unknown): Promise<GitLogRes> => {
    const { repoPath, limit } = GitLogRequest.parse(raw);
    const { code, stdout, stderr } = await runGit(
      ['log', `-n${limit}`, '--pretty=format:%H%x1f%h%x1f%s%x1f%an%x1f%ad', '--date=short'],
      repoPath,
    );
    if (code !== 0) {
      return { ok: false, commits: [], error: stderr || '无法读取提交历史' };
    }
    const commits = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [hash, shortHash, message, author, date] = line.split('\x1f');
        return { hash, shortHash, message, author, date };
      });
    return { ok: true, commits, error: null };
  });

  ipcMain.handle(GIT_COMMIT, async (_e, raw: unknown): Promise<GitCommitRes> => {
    const { repoPath, message, all } = GitCommitRequest.parse(raw);
    if (all) {
      const add = await runGit(['add', '-A'], repoPath);
      if (add.code !== 0) return { ok: false, error: add.stderr || 'git add 失败' };
    }
    const { code, stderr } = await runGit(['commit', '-m', message], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '提交失败（可能无改动）' };
    const head = await runGit(['rev-parse', 'HEAD'], repoPath);
    return { ok: true, hash: head.code === 0 ? head.stdout.trim() : null, error: null };
  });

  ipcMain.handle(GIT_PULL, async (_e, raw: unknown): Promise<GitSyncRes> => {
    const { repoPath } = GitPullRequest.parse(raw);
    const { code, stdout, stderr } = await runGit(['pull'], repoPath);
    return { ok: code === 0, stdout, error: code === 0 ? null : stderr || '拉取失败' };
  });

  ipcMain.handle(GIT_PUSH, async (_e, raw: unknown): Promise<GitSyncRes> => {
    const { repoPath } = GitPushRequest.parse(raw);
    const { code, stdout, stderr } = await runGit(['push'], repoPath);
    return {
      ok: code === 0,
      stdout,
      error: code === 0 ? null : stderr || '推送失败（可能无 upstream 或需先拉取）',
    };
  });

  // === Git 增强：分支管理 + 暂存区 + Diff ===
  ipcMain.handle(GIT_BRANCH_LIST, async (_e, raw: unknown) => {
    const { repoPath } = z.object({ repoPath: z.string().min(1) }).parse(raw);
    const { code, stdout, stderr } = await runGit(
      ['branch', '--list', '--format=%(refname:short)%00%(HEAD)'],
      repoPath,
    );
    if (code !== 0) return { ok: false, branches: [], error: stderr || '获取分支列表失败' };
    const branches = stdout
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [name, head] = line.split('\0');
        return { name, current: head === '*' };
      });
    return { ok: true, branches, error: null };
  });

  ipcMain.handle(GIT_BRANCH_CREATE, async (_e, raw: unknown) => {
    const { repoPath, name } = z
      .object({ repoPath: z.string().min(1), name: z.string().min(1) })
      .parse(raw);
    const { code, stderr } = await runGit(['checkout', '-b', name], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '创建分支失败' };
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_BRANCH_SWITCH, async (_e, raw: unknown) => {
    const { repoPath, name } = z
      .object({ repoPath: z.string().min(1), name: z.string().min(1) })
      .parse(raw);
    const { code, stderr } = await runGit(['checkout', name], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '切换分支失败' };
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_ADD, async (_e, raw: unknown) => {
    const { repoPath, paths } = z
      .object({ repoPath: z.string().min(1), paths: z.array(z.string()) })
      .parse(raw);
    // 拒绝以 - 开头的路径（防止被 git 解释为选项，构成命令注入）
    const dangerous = paths.filter((p) => p.startsWith('-'));
    if (dangerous.length > 0) return { ok: false, error: `非法路径: ${dangerous.join(', ')}` };
    // -- 告诉 git 后续参数均为路径，不会被解释为选项
    const { code, stderr } = await runGit(['add', '--', ...paths], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '暂存失败' };
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_RESET, async (_e, raw: unknown) => {
    const { repoPath, paths } = z
      .object({ repoPath: z.string().min(1), paths: z.array(z.string()) })
      .parse(raw);
    const { code, stderr } = await runGit(['reset', 'HEAD', '--', ...paths], repoPath);
    if (code !== 0) return { ok: false, error: stderr || '取消暂存失败' };
    return { ok: true, error: null };
  });

  ipcMain.handle(GIT_DIFF, async (_e, raw: unknown) => {
    const { repoPath, path, staged } = z
      .object({
        repoPath: z.string().min(1),
        path: z.string().min(1),
        staged: z.boolean().optional(),
      })
      .parse(raw);
    const args = staged ? ['diff', '--cached', '--', path] : ['diff', '--', path];
    const { code, stdout, stderr } = await runGit(args, repoPath);
    if (code !== 0) return { ok: false, diff: '', error: stderr || '获取差异失败' };
    return { ok: true, diff: stdout, error: null };
  });

  // === 终端（PTY 桥接）：渲染进程 ↔ 主进程 PTY ↔ 真实 shell ===
  const ptySessions = new Map<number, IPty>();

  ipcMain.handle(TERMINAL_SPAWN, async (e, raw: unknown) => {
    const req = z
      .object({
        shell: z.string().optional(),
        cwd: z.string().optional(),
        cols: z.number().default(80),
        rows: z.number().default(24),
      })
      .parse(raw);

    const shell = req.shell || (process.platform === 'win32' ? 'powershell.exe' : 'bash');
    const cwd = req.cwd || app.getPath('home');
    const ptyProcess = ptySpawn(shell, [], {
      name: 'xterm-256color',
      cols: req.cols,
      rows: req.rows,
      cwd,
      env: process.env as Record<string, string>,
    });

    const pid = ptyProcess.pid;
    ptySessions.set(pid, ptyProcess);

    // PTY 输出 → 渲染进程
    ptyProcess.onData((data: string) => {
      e.sender.send(TERMINAL_DATA, { pid, data });
    });

    ptyProcess.onExit(({ exitCode }: { exitCode: number }) => {
      e.sender.send(TERMINAL_EXIT, { pid, exitCode });
      ptySessions.delete(pid);
    });

    return { pid };
  });

  ipcMain.handle(TERMINAL_WRITE, async (_e, raw: unknown) => {
    const { pid, data } = z.object({ pid: z.number(), data: z.string() }).parse(raw);
    const pty = ptySessions.get(pid);
    if (pty) pty.write(data);
  });

  ipcMain.handle(TERMINAL_RESIZE, async (_e, raw: unknown) => {
    const { pid, cols, rows } = z
      .object({ pid: z.number(), cols: z.number(), rows: z.number() })
      .parse(raw);
    const pty = ptySessions.get(pid);
    if (pty) pty.resize(cols, rows);
  });

  ipcMain.handle(TERMINAL_KILL, async (_e, raw: unknown) => {
    const { pid } = z.object({ pid: z.number() }).parse(raw);
    const pty = ptySessions.get(pid);
    if (pty) {
      pty.kill();
      ptySessions.delete(pid);
    }
  });

  // PTY 会话退出清理：应用关闭时 kill 所有活跃 PTY
  app.on('before-quit', () => {
    for (const [pid, pty] of ptySessions) {
      try {
        pty.kill();
      } catch {
        /* PTY 可能已退出 */
      }
      ptySessions.delete(pid);
    }
  });

  // === Minecraft 启动器（A 切片：离线账号，无需微软 OAuth）===
  type LauncherKind = 'official' | 'pcl2' | 'hmcl';
  const detectMinecraft = (): {
    mcDir: string | null;
    modsDir: string | null;
    launcherExe: string | null;
    launcher: LauncherKind | null;
  } => {
    const appData = app.getPath('appData');
    let mcDir: string | null = null;
    const defaultMc = join(appData, '.minecraft');
    if (nodeFs.existsSync(defaultMc)) mcDir = defaultMc;
    // launcher_profiles.json 可能覆盖 gameDir
    if (mcDir) {
      const profPath = join(mcDir, 'launcher_profiles.json');
      if (nodeFs.existsSync(profPath)) {
        try {
          const prof = JSON.parse(nodeFs.readFileSync(profPath, 'utf-8'));
          if (typeof prof.gameDir === 'string') mcDir = prof.gameDir;
        } catch {
          /* 忽略损坏的 JSON */
        }
      }
    }
    const modsDir = mcDir ? join(mcDir, 'mods') : null;

    const home = homedir();
    const pf = process.env.ProgramFiles;
    const pf86 = process.env['ProgramFiles(x86)'];
    // 用户常见放置便携启动器（PCL2/HMCL 为绿色 exe，无固定安装路径）的目录
    const scanDirs = [home, join(home, 'Desktop'), join(home, 'Downloads'), 'D:\\', 'C:\\'].filter(
      (d) => nodeFs.existsSync(d),
    );

    const candidates: { kind: LauncherKind; paths: string[] }[] = [
      {
        kind: 'official',
        paths: [
          pf86 && join(pf86, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
          pf && join(pf, 'Minecraft Launcher', 'MinecraftLauncher.exe'),
          'C:\\Program Files (x86)\\Minecraft Launcher\\MinecraftLauncher.exe',
          'C:\\Program Files\\Minecraft Launcher\\MinecraftLauncher.exe',
        ].filter(Boolean) as string[],
      },
      { kind: 'pcl2', paths: scanDirs.map((d) => join(d, 'PCL2.exe')) },
      {
        kind: 'hmcl',
        paths: scanDirs.flatMap((d) => {
          try {
            return nodeFs
              .readdirSync(d)
              .filter((f) => /^HMCL.*\.exe$/i.test(f))
              .map((f) => join(d, f));
          } catch {
            return [];
          }
        }),
      },
    ];

    for (const group of candidates) {
      for (const p of group.paths) {
        if (nodeFs.existsSync(p)) return { mcDir, modsDir, launcherExe: p, launcher: group.kind };
      }
    }
    return { mcDir, modsDir, launcherExe: null, launcher: null };
  };

  ipcMain.handle(LOCATE_MC, (): LocateMcRes => {
    const { mcDir, modsDir, launcherExe, launcher } = detectMinecraft();
    return {
      found: !!mcDir,
      mcDir,
      modsDir,
      launcherExe,
      launcher,
      error: mcDir ? null : '未检测到 .minecraft 目录，请手动选择',
    };
  });

  ipcMain.handle(MC_CHOOSE_DIR, async (): Promise<McChooseDirRes> => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return { path: null };
    return { path: result.filePaths[0] };
  });

  ipcMain.handle(INSTALL_MOD, async (_e, raw: unknown): Promise<InstallModRes> => {
    const { jarPath, mcDir: mcDirOpt } = InstallModRequest.parse(raw);
    const mcDir = mcDirOpt ?? detectMinecraft().mcDir;
    if (!mcDir) return { ok: false, modsDir: null, error: '未找到 .minecraft 目录，请先手动选择' };
    const modsDir = join(mcDir, 'mods');
    await mkdir(modsDir, { recursive: true });
    const dest = join(modsDir, basename(jarPath));
    await copyFile(jarPath, dest);
    return { ok: true, modsDir, error: null };
  });

  ipcMain.handle(LAUNCH_MC, async (_e, raw: unknown): Promise<LaunchMcRes> => {
    const { mcDir: _mcDirOpt } = LaunchMcRequest.parse(raw);
    const { launcherExe, launcher } = detectMinecraft();
    if (!launcherExe) {
      return {
        ok: false,
        method: null,
        launcher: null,
        error:
          '未找到任何启动器（官方 / PCL2 / HMCL）。请安装其一，或点「手动选择 .minecraft」后用自己的启动器打开游戏。',
      };
    }
    // 离线账号：直接拉起检测到的启动器，由其离线档案进入游戏，无需微软 token
    spawn(launcherExe, [], { detached: true, stdio: 'ignore' }).unref();
    return { ok: true, method: 'launcher', launcher, error: null };
  });

  // === 节点图持久化（保存/加载到磁盘 + 文件对话框）===
  // 渲染层通过 window.api.nodeGraph.* 调用，主进程只做 fs 读写与 dialog 弹框。
  // 最近列表由渲染层用 localStorage 维护，主进程不参与（便于无 Electron 环境测试）。

  /**
   * 将已序列化的节点图 JSON 字符串写入指定路径。
   * 不弹对话框（调用方需先调 showSaveDialog 取得路径）。
   * 写入失败时返回 { ok: false, error }，不抛错。
   */
  ipcMain.handle(
    NODE_GRAPH_SAVE,
    async (_e, raw: unknown): Promise<{ ok: true } | { ok: false; error: string }> => {
      const req = NodeGraphSaveRequest.parse(raw);
      try {
        // 确保父目录存在（用户可能选了不存在的新路径）
        await mkdir(dirname(req.filePath), { recursive: true });
        await writeFile(req.filePath, req.json, 'utf-8');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: `写入文件失败：${(err as Error).message}` };
      }
    },
  );

  /**
   * 读取指定路径的节点图 JSON 字符串。
   * 不弹对话框（调用方需先调 showOpenDialog 取得路径）。
   * 读取失败时返回 { ok: false, error }，不抛错。
   */
  ipcMain.handle(
    NODE_GRAPH_LOAD,
    async (
      _e,
      raw: unknown,
    ): Promise<{ ok: true; json: string } | { ok: false; error: string }> => {
      const req = NodeGraphLoadRequest.parse(raw);
      try {
        const json = await readFile(req.filePath, 'utf-8');
        return { ok: true, json };
      } catch (err) {
        return { ok: false, error: `读取文件失败：${(err as Error).message}` };
      }
    },
  );

  /**
   * 弹出保存对话框，让用户选择 .json 路径。
   * 默认文件名由调用方传入（一般是 `${modId}-node-graph.json`）。
   * 用户取消时返回 { ok: false }，不抛错。
   */
  ipcMain.handle(
    NODE_GRAPH_SHOW_SAVE_DIALOG,
    async (_e, raw: unknown): Promise<{ ok: true; filePath: string } | { ok: false }> => {
      const req = NodeGraphShowSaveDialogRequest.parse(raw);
      const result = await dialog.showSaveDialog({
        defaultPath: req.defaultName,
        filters: [{ name: 'Node Graph JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) {
        return { ok: false };
      }
      return { ok: true, filePath: result.filePath };
    },
  );

  /**
   * 弹出打开对话框，让用户选择 .json 文件。
   * 用户取消时返回 { ok: false }，不抛错。
   */
  ipcMain.handle(
    NODE_GRAPH_SHOW_OPEN_DIALOG,
    async (): Promise<{ ok: true; filePath: string } | { ok: false }> => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Node Graph JSON', extensions: ['json'] }],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false };
      }
      return { ok: true, filePath: result.filePaths[0] };
    },
  );
}

/** 默认编排器工厂（优先用配置的真实模型，否则 fallback Mock） */
export function createDefaultOrchestrator(): Orchestrator {
  try {
    const config = loadModelConfig();
    if (config.apiKey) {
      return new Orchestrator(new VercelAiProvider(config));
    }
  } catch {
    // 配置读取失败，fallback
  }
  return new Orchestrator(
    new MockProvider(
      JSON.stringify({
        modId: 'demo',
        version: '1.0.0',
        name: 'Demo Mod',
        description: 'A demo mod',
        items: [{ id: 'demo_item', name: 'Demo Item', maxStackSize: 64 }],
        blocks: [],
      }),
    ),
  );
}
