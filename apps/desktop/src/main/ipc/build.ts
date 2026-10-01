/* Phase 3.1 拆分：由 ../ipc.ts 纯搬运，零行为变更。通道名与逻辑保持原样。*/
import { ipcMain, app } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import * as nodeFs from 'fs';
import {
  runGradleBuild,
  detectJavaVersion,
  MockProvider,
  VercelAiProvider,
  BuildFixer,
  Filesystem,
} from '@mc-creator/core';
import type { McVersion } from '@mc-creator/shared';
import { javaVersionFor } from '@mc-creator/shared';
import { assertWithin } from '../ipc-utils.js';
import { loadModelConfig } from '../model-config.js';
import {
  IPC,
  BuildRequest,
  BUILD_WITH_FIX,
  BuildWithFixRequest,
  AI_FIX_SUGGEST,
  AI_FIX_SUGGEST_CHUNK,
  AiFixSuggestRequest,
  BUILD_STREAM,
  BUILD_STREAM_CHUNK,
  BuildStreamRequest,
  BUILD_ABORT,
  BUILD_CHECK_JAVA,
  BuildCheckJavaRequest,
  PREPARE_BUILD_DIR,
  PrepareBuildDirRequest,
  type BuildRes,
  type BuildAbortRes,
  type BuildCheckJavaRes,
  type PrepareBuildDirRes,
} from '../../shared/ipc-channels.js';

export function registerBuildHandlers(): void {
  ipcMain.handle(IPC.BUILD, async (_e, raw: unknown): Promise<BuildRes> => {
    const req = BuildRequest.parse(raw);
    const java = await detectJavaVersion();
    // 按所选 MC 版本提示所需 JDK（1.20.x→17、1.21.x→21、26.x→25；未传版本时按 21 提示）
    const need = req.mcVersion ? javaVersionFor('fabric', req.mcVersion as McVersion) : 21;
    if (java === null) {
      return {
        success: false,
        jarPath: null,
        log: `未检测到 Java，构建 MC ${req.mcVersion ?? '（未指定）'} 需要 JDK ${need}+。请安装对应 JDK 或配置 JAVA_HOME`,
      };
    }
    if (java < need) {
      return {
        success: false,
        jarPath: null,
        log:
          `本机 JDK 为 ${java}，构建 MC ${req.mcVersion} 需要 JDK ${need}+。` +
          `请安装 JDK ${need} 或配置 JAVA_HOME（若 build.gradle 已配置 Gradle toolchain 自动下载，可忽略此提示）`,
      };
    }
    const result = await runGradleBuild(req.projectPath);
    return { success: result.success, jarPath: result.jarPath, log: result.log };
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
      e.sender.send(AI_FIX_SUGGEST_CHUNK, {
        delta: '请先在设置中配置 API Key。',
        done: true,
        requestId: req.requestId,
      });
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
        e.sender.send(AI_FIX_SUGGEST_CHUNK, {
          delta: chunk.delta,
          done: chunk.done,
          requestId: req.requestId,
        });
      }
    } catch (err) {
      e.sender.send(AI_FIX_SUGGEST_CHUNK, {
        delta: `错误：${(err as Error).message}`,
        done: true,
        requestId: req.requestId,
      });
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
      e.sender.send(BUILD_STREAM_CHUNK, {
        type: 'stdout',
        text: data.toString(),
        done: false,
        requestId: req.requestId,
      });
    });
    child.stderr?.on('data', (data) => {
      e.sender.send(BUILD_STREAM_CHUNK, {
        type: 'stderr',
        text: data.toString(),
        done: false,
        requestId: req.requestId,
      });
    });
    child.on('close', (code) => {
      activeBuildProcesses.delete(child);
      e.sender.send(BUILD_STREAM_CHUNK, {
        type: 'exit',
        text: `进程退出，code=${code}`,
        done: true,
        exitCode: code,
        requestId: req.requestId,
      });
    });
    child.on('error', (err) => {
      activeBuildProcesses.delete(child);
      e.sender.send(BUILD_STREAM_CHUNK, {
        type: 'stderr',
        text: `进程启动失败：${err.message}`,
        done: true,
        exitCode: -1,
        requestId: req.requestId,
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
    return { projectPath, estimatedSteps: req.files.length };
  });

  // 构建取消（Phase 3.2）：kill 所有活跃的流式构建子进程，保留已生成文件。
  // 占位实现：仅覆盖主进程直接 spawn 的 gradle 子进程；BuildFixer 内部重试进程由其自行收尾。
  ipcMain.handle(BUILD_ABORT, async (): Promise<BuildAbortRes> => {
    let killed = 0;
    for (const child of activeBuildProcesses) {
      try {
        child.kill();
        killed++;
      } catch {
        /* 进程可能已退出 */
      }
    }
    activeBuildProcesses.clear();
    return { ok: true, killed };
  });

  // JDK 预检（Phase 3.2）：与 BUILD 共用同一判定逻辑，供渲染进程点“编译”前拦截。
  ipcMain.handle(BUILD_CHECK_JAVA, async (_e, raw: unknown): Promise<BuildCheckJavaRes> => {
    const { mcVersion } = BuildCheckJavaRequest.parse(raw);
    const java = await detectJavaVersion();
    const need = mcVersion ? javaVersionFor('fabric', mcVersion as McVersion) : 21;
    const downloadUrl = 'https://adoptium.net/temurin/releases/';
    if (java === null) {
      return {
        java,
        need,
        ok: false,
        message: `未检测到 Java，构建 MC ${mcVersion ?? '（未指定）'} 需要 JDK ${need}+。请安装对应 JDK 或配置 JAVA_HOME`,
        downloadUrl,
      };
    }
    if (java < need) {
      return {
        java,
        need,
        ok: false,
        message:
          `本机 JDK 为 ${java}，构建 MC ${mcVersion} 需要 JDK ${need}+。` +
          `请安装 JDK ${need} 或配置 JAVA_HOME（若 build.gradle 已配置 Gradle toolchain 自动下载，可忽略此提示）`,
        downloadUrl,
      };
    }
    return {
      java,
      need,
      ok: true,
      message: `本机 JDK ${java} 满足要求（需 JDK ${need}+）`,
      downloadUrl,
    };
  });
}
