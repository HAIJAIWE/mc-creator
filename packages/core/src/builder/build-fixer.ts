import type { ModelProvider } from '../model-provider/types.js';
import { runGradleBuild, type BuildResult } from './gradle.js';
import { parseGradleErrors, type BuildError } from './log-parser.js';
import type { Filesystem } from '../filesystem/index.js';

const MAX_FIX_ATTEMPTS = 3;

/** 修复循环结果 */
export interface FixResult {
  success: boolean;
  attempts: number;
  finalResult: BuildResult;
  fixLog: string[];
}

/**
 * 构建修复循环（规格 §5）。
 * 流程：build → 失败 → parseGradleErrors → AI 修复源码 → 重新 build（最多 3 次）。
 */
export class BuildFixer {
  constructor(
    private fs: Filesystem,
    private provider: ModelProvider,
  ) {}

  async buildWithFix(
    projectPath: string,
    onProgress?: (msg: string) => void,
  ): Promise<FixResult> {
    const fixLog: string[] = [];

    for (let attempt = 0; attempt <= MAX_FIX_ATTEMPTS; attempt++) {
      onProgress?.(attempt === 0 ? '开始构建…' : `第 ${attempt} 次修复后重新构建…`);
      const result = await runGradleBuild(projectPath);

      if (result.success) {
        return { success: true, attempts: attempt, finalResult: result, fixLog };
      }

      if (attempt === MAX_FIX_ATTEMPTS) {
        fixLog.push(`已尝试 ${MAX_FIX_ATTEMPTS} 次修复仍失败，请手动检查。`);
        return { success: false, attempts: attempt, finalResult: result, fixLog };
      }

      const errors = parseGradleErrors(result.log);
      if (errors.length === 0) {
        fixLog.push('无法解析编译错误，请手动检查日志。');
        return { success: false, attempts: attempt, finalResult: result, fixLog };
      }

      onProgress?.(`检测到 ${errors.length} 个错误，AI 修复中…`);
      const fixed = await this.applyFixes(projectPath, errors);
      fixLog.push(fixed);
    }

    throw new Error('构建修复循环异常退出');
  }

  private async applyFixes(projectPath: string, errors: BuildError[]): Promise<string> {
    const descriptions = errors.map((e) => `${e.file}:${e.line} — ${e.message}`).join('\n');
    const prompt = `你是 Java 代码修复专家。以下 Minecraft mod 编译出错，请给出修复后的完整代码。

错误：
${descriptions}

要求：只输出修复后的完整文件内容，不要解释。如果涉及多个文件，用 === FILE: 路径 === 分隔。`;

    const raw = await this.provider.complete(prompt);

    const blocks = raw.split(/=== FILE:\s*(.+?)\s*===/);
    let fixedCount = 0;

    for (let i = 1; i < blocks.length; i += 2) {
      const filePath = blocks[i].trim();
      const content = blocks[i + 1]?.trim() ?? '';
      const fullPath = `${projectPath}/${filePath}`;
      try {
        await this.fs.writeFile(fullPath, content);
        fixedCount++;
      } catch {
        // 跳过无法写入的文件
      }
    }

    return fixedCount > 0
      ? `AI 修复了 ${fixedCount} 个文件`
      : 'AI 返回的修复内容无法匹配文件，请手动检查';
  }
}
