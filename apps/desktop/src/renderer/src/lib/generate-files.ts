/**
 * 浏览器端生成器调用的统一入口。
 *
 * 结构与主进程 GENERATE_FILES 一致：按 generatorType 取 schema 校验 spec → 通过
 * createDefaultRegistry 取生成器 → 生成文件。供 ipc-client（web-preview）与
 * agent-tools 共用，避免两处重复的"校验 + 生成"逻辑。
 *
 * 通过 `@mc-creator/core/browser.js` 只导入浏览器安全模块，避免把 Node-only
 * 的 builder 模块拖进浏览器 bundle。
 */

export interface GenerateFilesOutcome {
  files: { path: string; content: string }[];
  warnings: string[];
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
  const { createDefaultRegistry, SPEC_CONFIGS } = await import('@mc-creator/core/browser.js');

  const config = SPEC_CONFIGS[generatorType as keyof typeof SPEC_CONFIGS];
  if (!config) {
    throw new Error(
      `未知生成器类型 "${generatorType}"。可用类型：${Object.keys(SPEC_CONFIGS).join(', ')}`,
    );
  }

  // 与主进程 GENERATE_FILES 一致：校验通过后使用 parse 后的完整 spec（default 字段已填充）
  const parsed = config.schema.safeParse(spec);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .slice(0, 5)
      .map((i) => `  ${i.path.join('.') || '(根)'}: ${i.message}`)
      .join('\n');
    const more = parsed.error.issues.length > 5 ? `\n  ...等 ${parsed.error.issues.length} 处` : '';
    throw new Error(`${generatorType} Spec 校验失败:\n${issues}${more}`);
  }

  const gen = createDefaultRegistry().get(generatorType as never);
  if (!gen) throw new Error(`生成器 "${generatorType}" 未注册`);

  const data = parsed.data as Record<string, unknown>;
  const modId = (data.modId as string) || (data.packId as string) || 'mc_creator';

  const result = await gen.generate({
    loader: opts.loader,
    mcVersion: opts.mcVersion,
    modId,
    spec: parsed.data,
    projectPath: '',
  } as never);

  return { files: result.files, warnings: result.warnings, spec: parsed.data };
}
