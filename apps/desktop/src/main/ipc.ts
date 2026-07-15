import { ipcMain, dialog, app } from 'electron';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import JSZip from 'jszip';
import { z } from 'zod';
import { Orchestrator, ModGenerator, runGradleBuild, detectJavaVersion, MockProvider, VercelAiProvider, BuildFixer, Filesystem, ModrinthApiClient, CurseForgeApiClient } from '@mc-creator/core';
import * as nodeFs from 'fs';
import { loadModelConfig, saveModelConfig, type ModelConfigFull } from './model-config.js';
import { loadCurseForgeConfig, saveCurseForgeConfig } from './curseforge-config.js';
import { loadProjects, saveProject, deleteProject, getProject } from './project-store.js';
import {
  IPC,
  EXPORT_ZIP,
  PREPARE_BUILD_DIR,
  EXPORT_PROJECT,
  IMPORT_PROJECT,
  GenerateSpecRequest,
  GenerateFilesRequest,
  BuildRequest,
  SaveModelConfigRequest,
  ModelConfigResponse,
  ChatRequest,
  ChatStreamRequest,
  ExportZipRequest,
  PrepareBuildDirRequest,
  ExportProjectRequest,
  ProjectSchema,
  LOAD_MODEL_CONFIG,
  SAVE_MODEL_CONFIG,
  CHAT,
  CHAT_STREAM,
  CHAT_STREAM_CHUNK,
  BUILD_WITH_FIX,
  BuildWithFixRequest,
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
  type GenerateSpecRes,
  type GenerateFilesRes,
  type BuildRes,
  type ExportZipRes,
  type PrepareBuildDirRes,
  type ExportProjectRes,
  type ImportProjectRes,
  type Project,
  type ModrinthSearchRes,
  type ModrinthVersionsRes,
  type CurseForgeSearchRes,
  type CurseForgeFilesRes,
} from '../shared/ipc-channels.js';

/**
 * 注册 IPC 处理器（规格 §4 端到端数据流）。
 * 主进程调 core 引擎，结果经 zod 校验后返回渲染进程。
 */
export function registerIpcHandlers(getOrchestrator: () => Orchestrator): void {
  ipcMain.handle(IPC.GENERATE_SPEC, async (_e, raw: unknown): Promise<GenerateSpecRes> => {
    const req = GenerateSpecRequest.parse(raw);
    const orchestrator = getOrchestrator();
    // P16：按 generatorType 调用对应 prompt + schema 校验
    const spec = await orchestrator.generateSpecByType(req.description, req.generatorType);
    return { spec: spec as Record<string, unknown>, raw: JSON.stringify(spec, null, 2) };
  });

  ipcMain.handle(IPC.GENERATE_FILES, async (_e, raw: unknown): Promise<GenerateFilesRes> => {
    const req = GenerateFilesRequest.parse(raw);
    let gen;
    switch (req.generatorType) {
      case 'datapack': {
        const { DatapackGenerator } = await import('@mc-creator/core');
        gen = new DatapackGenerator();
        break;
      }
      case 'modpack': {
        const { ModpackGenerator } = await import('@mc-creator/core');
        gen = new ModpackGenerator();
        break;
      }
      case 'server': {
        const { ServerGenerator } = await import('@mc-creator/core');
        gen = new ServerGenerator();
        break;
      }
      case 'texture': {
        const { TextureGenerator } = await import('@mc-creator/core');
        gen = new TextureGenerator();
        break;
      }
      case 'skin': {
        const { SkinGenerator } = await import('@mc-creator/core');
        gen = new SkinGenerator();
        break;
      }
      case 'resource_pack': {
        const { ResourcePackGenerator } = await import('@mc-creator/core');
        gen = new ResourcePackGenerator();
        break;
      }
      default:
        gen = new ModGenerator();
    }
    // modId 可能从 spec 顶层或单独字段取
    const modId = req.modId || (req.spec as { modId?: string }).modId || 'mc_creator';
    const result = await gen.generate({
      loader: req.loader,
      mcVersion: req.mcVersion,
      modId,
      spec: req.spec as any,
      projectPath: '',
    });
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

    const provider = new VercelAiProvider(config);
    try {
      for await (const chunk of provider.stream(req.message, {
        system: '你是 Minecraft mod 专家助手，帮助用户设计 mod。简洁回答。',
      })) {
        e.sender.send(CHAT_STREAM_CHUNK, { delta: chunk.delta, done: chunk.done });
      }
    } catch (err) {
      e.sender.send(CHAT_STREAM_CHUNK, { delta: `错误：${(err as Error).message}`, done: true });
    }
  });

  // 带修复循环的构建
  ipcMain.handle(BUILD_WITH_FIX, async (_e, raw: unknown) => {
    const req = BuildWithFixRequest.parse(raw);
    const config = loadModelConfig();

    const realFs = new Filesystem(nodeFs as any);
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

  // 流式构建（P20）：spawn gradlew，逐行推送 stdout/stderr
  ipcMain.handle(BUILD_STREAM, async (e, raw: unknown) => {
    const req = BuildStreamRequest.parse(raw);
    const cwd = req.projectPath;
    // Windows 用 gradlew.bat，Unix 用 ./gradlew
    const cmd = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    const child = spawn(cmd, ['build'], { cwd, shell: true });

    child.stdout?.on('data', (data) => {
      e.sender.send(BUILD_STREAM_CHUNK, { type: 'stdout', text: data.toString(), done: false });
    });
    child.stderr?.on('data', (data) => {
      e.sender.send(BUILD_STREAM_CHUNK, { type: 'stderr', text: data.toString(), done: false });
    });
    child.on('close', (code) => {
      e.sender.send(BUILD_STREAM_CHUNK, {
        type: 'exit',
        text: `进程退出，code=${code}`,
        done: true,
        exitCode: code,
      });
    });
    child.on('error', (err) => {
      e.sender.send(BUILD_STREAM_CHUNK, {
        type: 'stderr',
        text: `进程启动失败：${err.message}`,
        done: true,
        exitCode: -1,
      });
    });
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

  // 准备构建目录（P22-4）：把内存中的 files 写入临时目录，返回绝对路径供后续 BUILD/BUILD_STREAM/BUILD_WITH_FIX 使用
  ipcMain.handle(PREPARE_BUILD_DIR, async (_e, raw: unknown): Promise<PrepareBuildDirRes> => {
    const req = PrepareBuildDirRequest.parse(raw);
    const projectPath = join(app.getPath('temp'), `mc-creator-build-${Date.now()}`);
    await mkdir(projectPath, { recursive: true });
    for (const f of req.files) {
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
  return new Orchestrator(new MockProvider(JSON.stringify({
    modId: 'demo',
    version: '1.0.0',
    name: 'Demo Mod',
    description: 'A demo mod',
    items: [{ id: 'demo_item', name: 'Demo Item', maxStackSize: 64 }],
    blocks: [],
  })));
}
