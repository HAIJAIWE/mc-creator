/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { app, ipcMain } from 'electron';
import { join } from 'node:path';
import { z } from 'zod';
import {
  Orchestrator,
  VercelAiProvider,
  createDefaultRegistry,
  ModGenerator,
  SPEC_CONFIGS,
  formatSpecIssues,
  type SpecType,
} from '@mc-creator/core';
import type { ModSpec } from '@mc-creator/shared';
import {
  loadModelConfig,
  saveModelConfig,
  loadModelProfiles,
  saveModelProfiles,
  testModelConnection,
  type ModelConfigFull,
  type ModelProfile,
} from '../model-config.js';
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

export function registerGenerateHandlers(getOrchestrator: () => Orchestrator): void {
  // 生成器注册表（P1：替代 switch/case，新增生成器只需在 createDefaultRegistry 注册）
  const generatorRegistry = createDefaultRegistry();

  // 增量构建缓存根目录：按项目 id 分文件存放，跨会话复用。
  const buildCacheDir = () => join(app.getPath('userData'), 'build-cache');

  ipcMain.handle(IPC.GENERATE_SPEC, async (_e, raw: unknown): Promise<GenerateSpecRes> => {
    const req = GenerateSpecRequest.parse(raw);
    const orchestrator = getOrchestrator();
    // P16：按 generatorType 调用对应 prompt + schema 校验
    const spec = await orchestrator.generateSpecByType(req.description, req.generatorType);
    return { ok: true, spec: spec as Record<string, unknown>, raw: JSON.stringify(spec, null, 2) };
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
    if (gen instanceof ModGenerator) {
      const cacheDir = buildCacheDir();
      // 按项目读回上次快照：命中 → 类别级增量；读不到（首次/损坏）→ 全量生成
      const prevSnapshot = await loadBuildCacheSnapshot(cacheDir, req.projectId);
      const incResult = await gen.generateWithCache(genCtx, prevSnapshot);
      // 落盘供下次（含下次启动）复用；写失败不影响本次构建结果
      await saveBuildCacheSnapshot(cacheDir, req.projectId, incResult.cacheSnapshot);
      return {
        files: incResult.files,
        warnings: incResult.warnings,
        buildStats: incResult.stats,
        unimplemented: incResult.unimplemented ?? [],
      };
    }

    const result = await gen.generate(genCtx);
    return {
      files: result.files,
      warnings: result.warnings,
      unimplemented: result.unimplemented ?? [],
    };
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

  // 多套模型配置：列表 / 保存 / 连通性测试
  ipcMain.handle(MODEL_LIST_PROFILES, async () => {
    const { profiles, activeId } = loadModelProfiles();
    return ModelProfileListResponse.parse({ profiles, activeId });
  });

  ipcMain.handle(MODEL_SAVE_PROFILES, async (_e, raw: unknown) => {
    const req = ModelSaveProfilesRequest.parse(raw);
    saveModelProfiles(req.profiles as ModelProfile[], req.activeId);
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
      e.sender.send(CHAT_STREAM_CHUNK, { delta: '请先在设置中配置 API Key。', done: true });
      return;
    }

    // P12 chat 模式工具调用增强：根据 context 构建增强 system message
    const systemMessage = buildChatSystemMessage(
      req.context
        ? ({
            generatorType: req.context.generatorType,
            description: req.context.description,
            specSummary: req.context.specSummary,
          } satisfies ChatStreamContext)
        : undefined,
    );

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
}

/** Pure JS Mustache 渲染器（isolated-vm 不可用时的回退实现） */
function renderMustachePure(template: string, fields: Record<string, unknown>): string {
  const TOKEN_PATTERN = /\{\{[^{}]+\}\}/g;

  function tokenize(tpl: string) {
    const tokens = [];
    let lastIndex = 0;
    const re = new RegExp(TOKEN_PATTERN);
    let match;
    while ((match = re.exec(tpl)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: 'text', value: tpl.slice(lastIndex, match.index) });
      }
      const raw = match[0];
      const tag = raw.slice(2, -2).trim();
      if (tag.startsWith('#if ')) {
        tokens.push({ type: 'if', key: tag.slice(4).trim(), raw });
      } else if (tag.startsWith('#each ')) {
        tokens.push({ type: 'each', key: tag.slice(6).trim(), raw });
      } else if (tag === 'else') {
        tokens.push({ type: 'else', raw });
      } else if (tag === '/if') {
        tokens.push({ type: 'endif', raw });
      } else if (tag === '/each') {
        tokens.push({ type: 'endeach', raw });
      } else if (tag === 'this') {
        tokens.push({ type: 'this', raw });
      } else if (tag.startsWith('this.')) {
        tokens.push({ type: 'thisField', key: tag.slice(5).trim(), raw });
      } else if (tag.startsWith('field:')) {
        tokens.push({ type: 'field', key: tag.slice(6).trim(), raw });
      } else {
        tokens.push({ type: 'unknown', raw });
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < tpl.length) {
      tokens.push({ type: 'text', value: tpl.slice(lastIndex) });
    }
    return tokens;
  }

  function isTruthy(v: unknown): boolean {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return Boolean(v);
  }

  function renderValue(v: unknown): string {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      try {
        return JSON.stringify(v);
      } catch {
        return String(v);
      }
    }
    return String(v);
  }

  function escapeJavaStringLiteral(s: string): string {
    if (typeof s !== 'string') return String(s);
    return s
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r')
      .replace(/\t/g, '\\t');
  }

  interface Token {
    type: string;
    value?: string;
    key?: string;
    raw?: string;
  }
  function findBlockEnd(tokens: Token[], startIdx: number, blockType: string) {
    const closeType = blockType === 'if' ? 'endif' : 'endeach';
    let depth = 1;
    let elseIdx = -1;
    for (let j = startIdx + 1; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === blockType) depth++;
      else if (t.type === closeType) {
        depth--;
        if (depth === 0) return { closeIndex: j, elseIndex: elseIdx };
      } else if (t.type === 'else' && blockType === 'if' && depth === 1 && elseIdx === -1) {
        elseIdx = j;
      }
    }
    return { closeIndex: -1, elseIndex: -1 };
  }

  function renderTokens(
    tokens: Token[],
    fields: Record<string, unknown>,
    currentThis: unknown,
  ): string {
    let result = '';
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      switch (tok.type) {
        case 'text':
          result += tok.value;
          i++;
          break;
        case 'field':
          if (tok.key === undefined || !(tok.key in fields)) {
            result += tok.raw;
          } else {
            result += escapeJavaStringLiteral(renderValue(fields[tok.key]));
          }
          i++;
          break;
        case 'this':
          result += escapeJavaStringLiteral(renderValue(currentThis));
          i++;
          break;
        case 'thisField': {
          const obj =
            currentThis !== null && typeof currentThis === 'object'
              ? (currentThis as Record<string, unknown>)
              : null;
          if (tok.key !== undefined && obj && tok.key in obj) {
            result += escapeJavaStringLiteral(renderValue(obj[tok.key]));
          } else {
            result += tok.raw;
          }
          i++;
          break;
        }
        case 'if':
        case 'each': {
          const { closeIndex, elseIndex } = findBlockEnd(tokens, i, tok.type);
          if (closeIndex === -1) {
            result += tok.raw;
            i++;
            break;
          }
          const bodyTokens =
            elseIndex === -1 ? tokens.slice(i + 1, closeIndex) : tokens.slice(i + 1, elseIndex);
          const elseTokens = elseIndex === -1 ? [] : tokens.slice(elseIndex + 1, closeIndex);

          if (tok.type === 'if') {
            const thisObj =
              currentThis !== null && typeof currentThis === 'object'
                ? (currentThis as Record<string, unknown>)
                : null;
            let condVal: unknown;
            if (tok.key !== undefined && thisObj && tok.key in thisObj) condVal = thisObj[tok.key];
            else if (tok.key !== undefined && tok.key in fields) condVal = fields[tok.key];
            else condVal = undefined;
            if (isTruthy(condVal)) result += renderTokens(bodyTokens, fields, currentThis);
            else result += renderTokens(elseTokens, fields, currentThis);
          } else {
            const thisObj =
              currentThis !== null && typeof currentThis === 'object'
                ? (currentThis as Record<string, unknown>)
                : null;
            const arr =
              tok.key !== undefined && thisObj && tok.key in thisObj
                ? thisObj[tok.key]
                : tok.key !== undefined && tok.key in fields
                  ? fields[tok.key]
                  : undefined;
            let items = [];
            if (Array.isArray(arr)) items = arr;
            else if (arr !== null && arr !== undefined) items = [arr];
            for (const item of items) result += renderTokens(bodyTokens, fields, item);
          }
          i = closeIndex + 1;
          break;
        }
        case 'else':
        case 'endif':
        case 'endeach':
        case 'unknown':
          result += tok.raw;
          i++;
          break;
      }
    }
    return result;
  }

  const tokens = tokenize(template);
  return renderTokens(tokens, fields, undefined);
}

/** isolated-vm 可用性检测 */
interface IsolatedVmIsolate {
  new (options: { memoryLimit: number }): {
    createContext: (
      options: Record<string, unknown>,
    ) => Promise<{ global: { set: (key: string, value: unknown) => Promise<void> } }>;
    compileScript: (source: string) => Promise<{
      run: (
        context: { global: { set: (key: string, value: unknown) => Promise<void> } },
        options: { timeout: number },
      ) => Promise<unknown>;
    }>;
  };
}
interface IsolatedVmExternalCopy {
  new (value: unknown): { copyInto: (options: Record<string, unknown>) => unknown };
}

let isolatedVmAvailable = false;
let Isolate: IsolatedVmIsolate | undefined;
let ExternalCopy: IsolatedVmExternalCopy | undefined;
try {
  // 主进程打包为 CJS，不支持顶层 await：同步 require 做可选依赖探测即可
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require('isolated-vm') as {
    Isolate: unknown;
    ExternalCopy: unknown;
  };
  // isolated-vm 的类型与我们的接口不完全兼容，使用类型断言
  Isolate = mod.Isolate as unknown as IsolatedVmIsolate;
  ExternalCopy = mod.ExternalCopy as unknown as IsolatedVmExternalCopy;
  isolatedVmAvailable = true;
} catch {
  isolatedVmAvailable = false;
}

export function registerSandboxedMustacheHandler(): void {
  // === 沙箱化 Mustache 渲染（P0 安全：防止自定义节点模板注入）===
  ipcMain.handle(
    SANDBOXED_MUSTACHE_RENDER,
    async (_e, raw: unknown): Promise<SandboxedMustacheRenderResponse> => {
      const req = SandboxedMustacheRenderRequest.parse(raw);
      const { template, fields } = req;

      // 基础校验
      if (typeof template !== 'string' || template.length > 50000) {
        return { ok: false, error: '模板长度超限（最大 50KB）' };
      }
      if (typeof fields !== 'object' || fields === null) {
        return { ok: false, error: 'fields 必须为对象' };
      }
      if (Object.keys(fields).length > 100) {
        return { ok: false, error: 'fields 字段数超限（最大 100 个）' };
      }

      // 优先尝试 isolated-vm 沙箱渲染
      if (isolatedVmAvailable && Isolate && ExternalCopy) {
        try {
          const isolate = new Isolate({ memoryLimit: 64 }); // 64MB 内存限制
          const context = await isolate.createContext({});
          const jail = context.global;

          // 注入安全的全局对象
          await jail.set('template', new ExternalCopy(template).copyInto({}));
          await jail.set('fields', new ExternalCopy(fields).copyInto({}));

          // 注入安全的工具函数
          await jail.set('escapeJavaStringLiteral', (s: string) => {
            if (typeof s !== 'string') return String(s);
            return s
              .replace(/\\/g, '\\\\')
              .replace(/"/g, '\\"')
              .replace(/\n/g, '\\n')
              .replace(/\r/g, '\\r')
              .replace(/\t/g, '\\t');
          });

          // 在沙箱中运行渲染逻辑
          const script = await isolate.compileScript(`
(function() {
  const TOKEN_PATTERN = /\\{\\{[^{}]+\\}\\}/g;

  function tokenize(template) {
    const tokens = [];
    let lastIndex = 0;
    const re = new RegExp(TOKEN_PATTERN);
    let match;
    while ((match = re.exec(template)) !== null) {
      if (match.index > lastIndex) {
        tokens.push({ type: 'text', value: template.slice(lastIndex, match.index) });
      }
      const raw = match[0];
      const tag = raw.slice(2, -2).trim();
      if (tag.startsWith('#if ')) {
        tokens.push({ type: 'if', key: tag.slice(4).trim(), raw });
      } else if (tag.startsWith('#each ')) {
        tokens.push({ type: 'each', key: tag.slice(6).trim(), raw });
      } else if (tag === 'else') {
        tokens.push({ type: 'else', raw });
      } else if (tag === '/if') {
        tokens.push({ type: 'endif', raw });
      } else if (tag === '/each') {
        tokens.push({ type: 'endeach', raw });
      } else if (tag === 'this') {
        tokens.push({ type: 'this', raw });
      } else if (tag.startsWith('this.')) {
        tokens.push({ type: 'thisField', key: tag.slice(5).trim(), raw });
      } else if (tag.startsWith('field:')) {
        tokens.push({ type: 'field', key: tag.slice(6).trim(), raw });
      } else {
        tokens.push({ type: 'unknown', raw });
      }
      lastIndex = re.lastIndex;
    }
    if (lastIndex < template.length) {
      tokens.push({ type: 'text', value: template.slice(lastIndex) });
    }
    return tokens;
  }

  function isTruthy(v) {
    if (v === null || v === undefined) return false;
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v !== 0;
    if (typeof v === 'string') return v.length > 0;
    if (Array.isArray(v)) return v.length > 0;
    if (typeof v === 'object') return Object.keys(v).length > 0;
    return Boolean(v);
  }

  function renderValue(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch { return String(v); }
    }
    return String(v);
  }

  function findBlockEnd(tokens, startIdx, blockType) {
    const closeType = blockType === 'if' ? 'endif' : 'endeach';
    let depth = 1;
    let elseIdx = -1;
    for (let j = startIdx + 1; j < tokens.length; j++) {
      const t = tokens[j];
      if (t.type === blockType) depth++;
      else if (t.type === closeType) {
        depth--;
        if (depth === 0) return { closeIndex: j, elseIndex: elseIdx };
      } else if (t.type === 'else' && blockType === 'if' && depth === 1 && elseIdx === -1) {
        elseIdx = j;
      }
    }
    return { closeIndex: -1, elseIndex: -1 };
  }

  function renderTokens(tokens, fields, currentThis) {
    let result = '';
    let i = 0;
    while (i < tokens.length) {
      const tok = tokens[i];
      switch (tok.type) {
        case 'text':
          result += tok.value;
          i++;
          break;
        case 'field':
          if (!(tok.key in fields)) {
            result += tok.raw;
          } else {
            result += escapeJavaStringLiteral(renderValue(fields[tok.key]));
          }
          i++;
          break;
        case 'this':
          result += escapeJavaStringLiteral(renderValue(currentThis));
          i++;
          break;
        case 'thisField':
          const obj = currentThis !== null && typeof currentThis === 'object' ? (currentThis as Record<string, unknown>) : null;
          if (obj && tok.key in obj) {
            result += escapeJavaStringLiteral(renderValue(obj[tok.key]));
          } else {
            result += tok.raw;
          }
          i++;
          break;
        case 'if':
        case 'each': {
          const { closeIndex, elseIndex } = findBlockEnd(tokens, i, tok.type);
          if (closeIndex === -1) {
            result += tok.raw;
            i++;
            break;
          }
          const bodyTokens = elseIndex === -1 ? tokens.slice(i + 1, closeIndex) : tokens.slice(i + 1, elseIndex);
          const elseTokens = elseIndex === -1 ? [] : tokens.slice(elseIndex + 1, closeIndex);

          if (tok.type === 'if') {
            const thisObj = currentThis !== null && typeof currentThis === 'object' ? (currentThis as Record<string, unknown>) : null;
            let condVal: unknown;
            if (thisObj && tok.key in thisObj) condVal = thisObj[tok.key];
            else if (tok.key in fields) condVal = fields[tok.key];
            else condVal = undefined;
            if (isTruthy(condVal)) result += renderTokens(bodyTokens, fields, currentThis);
            else result += renderTokens(elseTokens, fields, currentThis);
          } else {
            const thisObj = currentThis !== null && typeof currentThis === 'object' ? (currentThis as Record<string, unknown>) : null;
            const arr = thisObj && tok.key in thisObj ? thisObj[tok.key] : tok.key in fields ? fields[tok.key] : undefined;
            let items = [];
            if (Array.isArray(arr)) items = arr;
            else if (arr !== null && arr !== undefined) items = [arr];
            for (const item of items) result += renderTokens(bodyTokens, fields, item);
          }
          i = closeIndex + 1;
          break;
        }
        case 'else':
        case 'endif':
        case 'endeach':
        case 'unknown':
          result += tok.raw;
          i++;
          break;
      }
    }
    return result;
  }

  const tokens = tokenize(template);
  return renderTokens(tokens, fields, undefined);
})()
`);

          const result = await script.run(context, { timeout: 1000 }); // 1秒超时
          return { ok: true, result: result as string };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          // 沙箱失败时回退到纯 JS 渲染
          console.warn('[sandboxed-mustache] isolated-vm 渲染失败，回退到纯 JS:', msg);
        }
      }

      // 回退：纯 JS Mustache 渲染（无沙箱隔离，但通过校验规避注入风险）
      try {
        const result = renderMustachePure(template, fields);
        return { ok: true, result };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: '纯 JS 渲染失败：' + msg };
      }
    },
  );
}
