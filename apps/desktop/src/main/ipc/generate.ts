import { app, ipcMain } from 'electron';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import {
  Orchestrator,
  VercelAiProvider,
  createDefaultRegistry,
  ModGenerator,
  SPEC_CONFIGS,
  formatSpecIssues,
  searchKnowledge,
  formatRagSection,
  type SpecType,
} from '@mc-creator/core';
import type { ModSpec, UnimplementedItem } from '@mc-creator/shared';
import {
  loadModelConfig,
  saveModelConfig,
  loadModelProfiles,
  saveModelProfiles,
  testModelConnection,
  type ModelConfigFull,
  type ModelProfile,
} from '../credentials/model-config.js';
import { buildChatSystemMessage, type ChatStreamContext } from '../chat-system-message.js';
import { loadBuildCacheSnapshot, saveBuildCacheSnapshot } from '../build-cache-store.js';
import {
  IPC,
  GenerateSpecRequest,
  GenerateFilesRequest,
  LOAD_MODEL_CONFIG,
  SAVE_MODEL_CONFIG,
  MODEL_LIST_PROFILES,
  MODEL_SAVE_PROFILES,
  MODEL_TEST_CONNECTION,
  ModelConfigResponse,
  SaveModelConfigRequest,
  ModelProfileListResponse,
  ModelSaveProfilesRequest,
  ModelTestConnectionRequest,
  ModelTestConnectionResponse,
  CHAT,
  CHAT_STREAM,
  CHAT_STREAM_CHUNK,
  EXPLAIN_CODE,
  EXPLAIN_CODE_CHUNK,
  COMPARE_MODELS,
  COMPARE_MODELS_CHUNK,
  CompareModelsRequest,
  ExplainCodeRequest,
  ChatRequest,
  ChatStreamRequest,
  SANDBOXED_MUSTACHE_RENDER,
  SandboxedMustacheRenderRequest,
  SandboxedMustacheRenderResponse,
  type GenerateSpecRes,
  type GenerateFilesRes,
} from '../../shared/ipc-channels.js';
import { FileManager } from '../file-manager.js';
import { renderMustacheHardened } from './sandboxed-mustache.js';

/** RAG 检索条数（需求：topK=5） */
const RAG_TOP_K = 5;

/**
 * 从 GenerateFiles 的 spec 中抽取检索 query（spec 无 description 字段时用）。
 * 收集顶层 id/name/描述类字符串 + 数组元素的 id/name（截断防 token 爆炸）。
 */
function describeSpecForRag(spec: unknown, generatorType: string): string {
  const parts: string[] = [generatorType];
  const pushStr = (v: unknown) => {
    if (typeof v === 'string' && v.trim()) parts.push(v.trim().slice(0, 120));
  };
  if (spec !== null && typeof spec === 'object') {
    const obj = spec as Record<string, unknown>;
    for (const key of [
      'modId',
      'packId',
      'packName',
      'name',
      'description',
      'serverName',
      'launcherName',
      'playerName',
    ]) {
      pushStr(obj[key]);
    }
    for (const value of Object.values(obj)) {
      if (Array.isArray(value)) {
        for (const item of value.slice(0, 8)) {
          if (item !== null && typeof item === 'object') {
            const entry = item as Record<string, unknown>;
            pushStr(entry.id);
            pushStr(entry.name);
            pushStr(entry.type);
          }
        }
      }
    }
  }
  return parts.join(' ').slice(0, 500);
}

/** RAG 检索永不抛错：失败返回空命中，保证不影响主流程 */
function safeRagSearch(
  query: string,
  generatorType?: string,
): {
  hits: Array<{ title: string; snippet: string; source: string; url?: string; score: number }>;
  cached: boolean;
} {
  try {
    return searchKnowledge(query, { topK: RAG_TOP_K, generatorType });
  } catch {
    return { hits: [], cached: false };
  }
}

export function registerGenerateHandlers(getOrchestrator: () => Orchestrator): void {
  // 生成器注册表（P1：替代 switch/case，新增生成器只需在 createDefaultRegistry 注册）
  const generatorRegistry = createDefaultRegistry();

  // 增量构建缓存根目录：按项目 id 分文件存放，跨会话复用。
  const buildCacheDir = () => join(app.getPath('userData'), 'build-cache');

  ipcMain.handle(IPC.GENERATE_SPEC, async (_e, raw: unknown): Promise<GenerateSpecRes> => {
    const req = GenerateSpecRequest.parse(raw);
    const orchestrator = getOrchestrator();
    // RAG：按 description 关键词检索（topK=5，可按 generatorType 过滤），片段注入 LLM prompt
    const rag = safeRagSearch(req.description, req.generatorType);
    const ragSection = formatRagSection(rag.hits);
    // P16：按 generatorType 调用对应 prompt + schema 校验
    const spec = await orchestrator.generateSpecByType(
      req.description,
      req.generatorType,
      ragSection || undefined,
    );
    const res: GenerateSpecRes = {
      ok: true,
      spec: spec as Record<string, unknown>,
      raw: JSON.stringify(spec, null, 2),
    };
    if (rag.hits.length > 0) res.ragSources = rag.hits;
    return res;
  });

  ipcMain.handle(IPC.GENERATE_FILES, async (_e, raw: unknown): Promise<GenerateFilesRes> => {
    let req = GenerateFilesRequest.parse(raw);
    const gen = generatorRegistry.get(req.generatorType);
    if (!gen) {
      return { files: [], warnings: [`不支持的生成器类型：${req.generatorType}`] };
    }
    // 前置校验：spec 不合法时给出中文字段级错误，避免生成器内部抛英文 zod 原始消息
    const schema = SPEC_CONFIGS[req.generatorType]?.schema;
    if (schema) {
      const check = schema.safeParse(req.spec);
      if (!check.success) {
        throw new Error(`${req.generatorType} Spec 校验失败：${formatSpecIssues(check.error)}`);
      }
      // 校验通过后用 parse 后的完整 spec（default 字段已填充），避免生成器拿到缺省字段
      req = { ...req, spec: check.data as z.infer<typeof GenerateFilesRequest>['spec'] };
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
    let result: {
      files: Array<{ path: string; content: string }>;
      warnings: string[];
      unimplemented?: UnimplementedItem[];
      buildStats?: {
        total: number;
        cached: number;
        regenerated: number;
        filesTotal: number;
        filesUnchanged: number;
      };
    };
    if (gen instanceof ModGenerator) {
      const cacheDir = buildCacheDir();
      // 按项目读回上次快照：命中 → 类别级增量；读不到（首次/损坏）→ 全量生成
      const prevSnapshot = await loadBuildCacheSnapshot(cacheDir, req.projectId);
      const incResult = await gen.generateWithCache(genCtx, prevSnapshot);
      // 落盘供下次（含下次启动）复用；写失败不影响本次构建结果
      await saveBuildCacheSnapshot(cacheDir, req.projectId, incResult.cacheSnapshot);
      result = {
        files: incResult.files,
        warnings: incResult.warnings,
        unimplemented: incResult.unimplemented ?? [],
        buildStats: incResult.stats,
      };
    } else {
      const genResult = await gen.generate(genCtx);
      result = {
        files: genResult.files,
        warnings: genResult.warnings,
        unimplemented: genResult.unimplemented ?? [],
      };
    }

    // 检测大文件（> 10MB），分离为流式传输元数据
    const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
    const CHUNK_SIZE = 1024 * 1024; // 1MB
    const normalFiles: Array<{ path: string; content: string }> = [];
    const largeFiles: Array<{ path: string; size: number; chunks: number; hash: string }> = [];

    // 如果有 projectId，将大文件写入项目工作区以便流式下载
    const fm = FileManager.getInstance();
    const projectWorkspace = req.projectId ? fm.getProjectWorkspace(req.projectId) : null;

    for (const file of result.files) {
      const buffer = Buffer.from(file.content, 'utf8');
      if (buffer.length > LARGE_FILE_THRESHOLD) {
        // 计算 MD5
        const hash = createHash('md5').update(buffer).digest('hex');
        const chunks = Math.ceil(buffer.length / CHUNK_SIZE);
        largeFiles.push({
          path: file.path,
          size: buffer.length,
          chunks,
          hash,
        });

        // 将大文件写入项目工作区（如果有 projectId）
        if (projectWorkspace) {
          const fullPath = resolve(projectWorkspace, file.path);
          await fm.writeBinary(fullPath, buffer);
        }
        // 大文件不包含在普通 files 中，渲染侧需流式下载
      } else {
        normalFiles.push(file);
      }
    }

    const response: GenerateFilesRes = {
      files: normalFiles,
      warnings: result.warnings,
      spec: req.spec,
    };

    // RAG：按 spec 内容自动检索（确定性生成器不用 LLM，但来源供 UI 展示；同时预热 LRU）
    const filesRag = safeRagSearch(
      describeSpecForRag(req.spec, req.generatorType),
      req.generatorType,
    );
    if (filesRag.hits.length > 0) response.ragSources = filesRag.hits;

    if (result.buildStats) {
      response.buildStats = result.buildStats;
    }
    if (result.unimplemented && result.unimplemented.length > 0) {
      response.unimplemented = result.unimplemented;
    }
    if (largeFiles.length > 0) {
      response.largeFiles = largeFiles;
    }

    return response;
  });

  // 模型配置
  ipcMain.handle(LOAD_MODEL_CONFIG, async () => {
    const config = loadModelConfig();
    return ModelConfigResponse.parse(config);
  });

  ipcMain.handle(SAVE_MODEL_CONFIG, async (_e, raw: unknown) => {
    const req = SaveModelConfigRequest.parse(raw);
    await saveModelConfig(req as ModelConfigFull);
    return { ok: true };
  });

  // 多套模型配置：列表 / 保存 / 连通性测试
  ipcMain.handle(MODEL_LIST_PROFILES, async () => {
    const { profiles, activeId } = loadModelProfiles();
    return ModelProfileListResponse.parse({ profiles, activeId });
  });

  ipcMain.handle(MODEL_SAVE_PROFILES, async (_e, raw: unknown) => {
    const req = ModelSaveProfilesRequest.parse(raw);
    await saveModelProfiles(req.profiles as ModelProfile[], req.activeId);
    return { ok: true };
  });

  ipcMain.handle(MODEL_TEST_CONNECTION, async (_e, raw: unknown) => {
    const req = ModelTestConnectionRequest.parse(raw);
    const result = await testModelConnection(req.baseURL, req.modelId, req.apiKey);
    return ModelTestConnectionResponse.parse(result);
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
      e.sender.send(CHAT_STREAM_CHUNK, {
        delta: '请先在设置中配置 API Key。',
        done: true,
        requestId: req.requestId,
      });
      return;
    }

    // P12 chat 模式工具调用增强：根据 context 构建增强 system message
    // RAG：按 description（无则回退 message 全文）关键词检索，片段拼入 system message
    const ragQuery = req.context?.description || req.message;
    const chatRag = safeRagSearch(ragQuery, req.context?.generatorType);
    const systemMessage = buildChatSystemMessage(
      req.context
        ? ({
            generatorType: req.context.generatorType,
            description: req.context.description,
            specSummary: req.context.specSummary,
          } satisfies ChatStreamContext)
        : undefined,
      chatRag.hits,
    );

    const provider = new VercelAiProvider(config);
    try {
      for await (const chunk of provider.stream(req.message, {
        system: systemMessage,
      })) {
        e.sender.send(CHAT_STREAM_CHUNK, {
          delta: chunk.delta,
          done: chunk.done,
          requestId: req.requestId,
        });
      }
    } catch (err) {
      e.sender.send(CHAT_STREAM_CHUNK, {
        delta: `错误：${(err as Error).message}`,
        done: true,
        requestId: req.requestId,
      });
    }
  });

  // 流式 AI 解释代码
  ipcMain.handle(EXPLAIN_CODE, async (e, raw: unknown) => {
    const req = ExplainCodeRequest.parse(raw);
    const config = loadModelConfig();
    if (!config.apiKey) {
      e.sender.send(EXPLAIN_CODE_CHUNK, {
        delta: '请先在设置中配置 API Key。',
        done: true,
        requestId: req.requestId,
      });
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
        e.sender.send(EXPLAIN_CODE_CHUNK, {
          delta: chunk.delta,
          done: chunk.done,
          requestId: req.requestId,
        });
      }
    } catch (err) {
      e.sender.send(EXPLAIN_CODE_CHUNK, {
        delta: `错误：${(err as Error).message}`,
        done: true,
        requestId: req.requestId,
      });
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
          requestId: req.requestId,
        });
      } catch (err) {
        e.sender.send(COMPARE_MODELS_CHUNK, {
          modelName: modelConfig.name,
          delta: `错误：${(err as Error).message}`,
          done: true,
          requestId: req.requestId,
        });
      }
    });

    await Promise.all(promises);
  });
}

/**
 * 注册沙箱化 Mustache 渲染通道。
 *
 * 渲染实现在 `sandboxed-mustache.ts`（**唯一一份**）。此前这里是两份同构实现：
 * 一个 `renderMustachePure` 闭包 + 一份抄进 isolated-vm 沙箱脚本字符串的同样逻辑。
 * 重复实现本身就是最需要消除的结构性缺陷 —— 任何安全修复都要做两遍，漏一处
 * 就是漏洞。现在收敛为一份 + 严格输入校验。
 *
 * 关于 isolated-vm：已删除，理由见 sandboxed-mustache.ts 顶部注释
 * （沙箱里跑的是我们自己的渲染器而非用户代码；且它在 Electron 44 上实测
 * 必然 require 失败，因此从来没真正生效过）。
 */
export function registerSandboxedMustacheHandler(): void {
  // === 沙箱化 Mustache 渲染（P0 安全：防止自定义节点模板注入）===
  ipcMain.handle(
    SANDBOXED_MUSTACHE_RENDER,
    async (_e, raw: unknown): Promise<SandboxedMustacheRenderResponse> => {
      const req = SandboxedMustacheRenderRequest.parse(raw);
      const outcome = renderMustacheHardened(req.template, req.fields);
      if (outcome.ok) {
        return { ok: true, result: outcome.result };
      }
      // 结构化错误：code 便于调用方/programmatic 判断，message 供日志展示
      return { ok: false, error: `[${outcome.code}] ${outcome.error}` };
    },
  );
}
