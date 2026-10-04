/**
 * 渲染进程生成文件的统一入口。
 *
 * 走主进程 IPC（GENERATE_FILES）：core 的生成器（如 mod 生成器的贴图产出）依赖
 * pngjs 这类 Node-only 包，在渲染进程里跑不通，也没必要为此在渲染层背一整套 Node
 * polyfill。web-preview（无 Electron 主进程）时的本地回退逻辑在 ipc-client 内。
 */

import type { GeneratorType } from '@mc-creator/shared';
import { GENERATOR_TYPES } from '../../../shared/ipc-channels.js';
import { ipcClient } from './ipc-client.js';

export interface GenerateFilesOutcome {
  files: { path: string; content: string }[];
  warnings: string[];
  /** 未实现清单（Task 1.1，仅 mod 生成器在有占位时返回） */
  unimplemented?: Array<{ kind: string; type: string; id: string; reason: string }>;
  /** 校验并填充默认值后的完整 spec */
  spec: unknown;
}

/**
 * 校验 spec 并调用对应生成器。失败时抛出带中文描述的 Error。
 */
export async function generateFilesForType(
  generatorType: string,
  spec: unknown,
  opts: { loader: string; mcVersion: string },
): Promise<GenerateFilesOutcome> {
  // 类型前置校验：未知类型直接给出可用列表（与改动前渲染层本地生成的行为一致），
  // 避免无意义的 IPC 往返，也避免把"未知类型"当成生成成功返回
  if (!(GENERATOR_TYPES as readonly string[]).includes(generatorType)) {
    throw new Error(`未知生成器类型 "${generatorType}"。可用类型：${GENERATOR_TYPES.join(', ')}`);
  }

  const res = await ipcClient.generateFiles({
    loader: opts.loader,
    mcVersion: opts.mcVersion,
    spec,
    generatorType: generatorType as GeneratorType,
  });

  return {
    files: res.files,
    warnings: res.warnings,
    // 主进程返回校验后的完整 spec；回退到入参，保证 web-preview 等场景也有值
    spec: res.spec ?? spec,
    ...(res.unimplemented !== undefined ? { unimplemented: res.unimplemented } : {}),
  };
}
