/**
 * 生成器接口转接（§18 阶段 8）。
 *
 * Generator 接口定义处为 @mc-creator/shared（schemas/generator.ts，自 core
 * generators/types.ts 迁入，见 datapack 会话的 shared 统一），本包不自建
 * 接口、不依赖 core，仅做类型重导出以保持 `../types.js` 相对导入策略与
 * core 现状一致（新包禁依赖 core，故禁止改成 ../../core/... 深路径）。
 */
export type { Generator } from '@mc-creator/shared';
export type { GeneratorContext, GenerationResult } from '@mc-creator/shared';
export type { Loader, McVersion } from '@mc-creator/shared';
