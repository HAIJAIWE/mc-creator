import { ipcMain } from 'electron';
import { Orchestrator, ModGenerator, runGradleBuild, detectJavaVersion, MockProvider } from '@mc-creator/core';
import {
  IPC,
  GenerateSpecRequest,
  GenerateFilesRequest,
  BuildRequest,
  type GenerateSpecRes,
  type GenerateFilesRes,
  type BuildRes,
} from '../shared/ipc-channels.js';

/**
 * 注册 IPC 处理器（规格 §4 端到端数据流）。
 * 主进程调 core 引擎，结果经 zod 校验后返回渲染进程。
 */
export function registerIpcHandlers(getOrchestrator: () => Orchestrator): void {
  ipcMain.handle(IPC.GENERATE_SPEC, async (_e, raw: unknown): Promise<GenerateSpecRes> => {
    const req = GenerateSpecRequest.parse(raw);
    const orchestrator = getOrchestrator();
    const spec = await orchestrator.generateModSpec(req.description);
    return { spec, raw: JSON.stringify(spec, null, 2) };
  });

  ipcMain.handle(IPC.GENERATE_FILES, async (_e, raw: unknown): Promise<GenerateFilesRes> => {
    const req = GenerateFilesRequest.parse(raw);
    const gen = new ModGenerator();
    const result = await gen.generate({
      loader: req.loader,
      mcVersion: req.mcVersion,
      modId: req.spec.modId,
      spec: req.spec,
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
}

/** 默认编排器工厂（用 MockProvider，后续接真实模型） */
export function createDefaultOrchestrator(): Orchestrator {
  return new Orchestrator(new MockProvider(JSON.stringify({
    modId: 'demo',
    version: '1.0.0',
    name: 'Demo Mod',
    description: 'A demo mod',
    items: [{ id: 'demo_item', name: 'Demo Item', maxStackSize: 64 }],
    blocks: [],
  })));
}
