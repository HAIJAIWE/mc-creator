/**
 * IPC 聚合入口（Phase 3.1：God file 拆分）。
 *
 * 各域处理器已搬运至 ./ipc/ 目录（纯搬运，零行为变更）：
 * generate / build / project / market / git / terminal / launcher / node-graph。
 * 通道名保持不变，前端零改动。
 */
import { Orchestrator, MockProvider, VercelAiProvider } from '@mc-creator/core';
import { loadModelConfig } from './model-config.js';
import { registerGenerateHandlers, registerSandboxedMustacheHandler } from './ipc/generate.js';
import { registerBuildHandlers } from './ipc/build.js';
import { registerProjectHandlers } from './ipc/project.js';
import { registerMarketHandlers } from './ipc/market.js';
import { registerModpackHandlers } from './ipc/modpack.js';
import { registerGitHandlers } from './ipc/git.js';
import { registerTerminalHandlers } from './ipc/terminal.js';
import { registerLauncherHandlers } from './ipc/launcher.js';
import { registerNodeGraphHandlers } from './ipc/node-graph.js';
import { registerFileManagerHandlers } from './ipc/file-manager.js';
import { registerRagHandlers } from './ipc/rag.js';
import { registerProcessSupervisorHandlers } from './ipc/process-supervisor.js';
import { registerKernelHandlers } from './ipc/kernel.js';

/**
 * 注册 IPC 处理器（规格 §4 端到端数据流）。
 * 主进程调 core 引擎，结果经 zod 校验后返回渲染进程。
 */
export function registerIpcHandlers(getOrchestrator: () => Orchestrator): void {
  registerGenerateHandlers(getOrchestrator);
  registerBuildHandlers();
  registerProjectHandlers();
  registerMarketHandlers();
  registerModpackHandlers();
  registerGitHandlers();
  registerTerminalHandlers();
  registerLauncherHandlers();
  registerNodeGraphHandlers();
  registerFileManagerHandlers();
  registerRagHandlers();
  // 进程托管只读通道（§7.1/§10.2）。刻意不含 start/stop：那必须经确认闸门（§10.6）。
  registerProcessSupervisorHandlers();
  // 内核通道（§4.2 / §10.2）。只读 kind 进 preload 白名单；W/X 的 kernel:execute
  // 已接线但刻意不进白名单（门控 UI 未验证，见 ipc/kernel.ts 头注释）。
  registerKernelHandlers();
}

// 原模块级注册时序保持：import 本模块时即注册沙箱 Mustache 渲染通道（此前在旧 ipc.ts 尾部模块级注册）。
registerSandboxedMustacheHandler();

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
