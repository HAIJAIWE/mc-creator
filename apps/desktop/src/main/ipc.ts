import { ipcMain, dialog } from 'electron';
import { writeFile } from 'node:fs/promises';
import JSZip from 'jszip';
import { z } from 'zod';
import { Orchestrator, ModGenerator, runGradleBuild, detectJavaVersion, MockProvider, VercelAiProvider, BuildFixer, Filesystem } from '@mc-creator/core';
import * as nodeFs from 'fs';
import { loadModelConfig, saveModelConfig, type ModelConfigFull } from './model-config.js';
import { loadProjects, saveProject, deleteProject, getProject } from './project-store.js';
import {
  IPC,
  EXPORT_ZIP,
  GenerateSpecRequest,
  GenerateFilesRequest,
  BuildRequest,
  SaveModelConfigRequest,
  ModelConfigResponse,
  ChatRequest,
  ChatStreamRequest,
  ExportZipRequest,
  LOAD_MODEL_CONFIG,
  SAVE_MODEL_CONFIG,
  CHAT,
  CHAT_STREAM,
  CHAT_STREAM_CHUNK,
  BUILD_WITH_FIX,
  BuildWithFixRequest,
  LIST_PROJECTS,
  GET_PROJECT,
  SAVE_PROJECT,
  DELETE_PROJECT,
  ProjectSchema,
  type GenerateSpecRes,
  type GenerateFilesRes,
  type BuildRes,
  type ExportZipRes,
  type Project,
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
