import { memo } from 'react';
import type { EditorProps } from './types.js';

/**
 * 多行代码编辑器（textarea）。
 *
 * 用于 codeLock 的 `lockedCode` 字段——当用户锁定节点代码后，
 * 在抽屉里直接编辑被锁定的代码片段。
 *
 * 设计取舍：
 * - 不引入 Monaco（重）：textarea 足够编辑短代码片段
 * - 用等宽字体 + MC 风格边框，与项目其他编辑器视觉一致
 * - 支持 placeholder、language 提示（只显示在标签下方，不强制语法高亮）
 */
function CodeEditorComponent({ value, onChange, schema }: EditorProps<string>) {
  const placeholder =
    schema.placeholder ??
    '// 在此输入要锁定的代码\n// 锁定后编译器将直接使用此代码，跳过常规代码生成';
  const language = schema.language ?? 'java';

  return (
    <div className="space-y-0.5">
      <div className="text-[10px] text-mc-dim">{language}</div>
      <textarea
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={6}
        spellCheck={false}
        aria-label={schema.label}
        className="w-full resize-y border border-t-black border-l-black border-b-white border-r-white bg-mc-bg px-2 py-1 font-mono text-[11px] text-mc-text outline-none focus:border-mc-accent"
      />
    </div>
  );
}

export const CodeEditor = memo(CodeEditorComponent);
