import Editor from '@monaco-editor/react';
import { useModStore } from '../store/mod-store.js';

export function CodePreview() {
  const { files, selectedFile } = useModStore();
  const file = files.find((f) => f.path === selectedFile);

  if (!file) {
    return <div className="flex-1 flex items-center justify-center text-sm text-zinc-600">选择文件预览代码</div>;
  }

  const lang = file.path.endsWith('.java') ? 'java'
    : file.path.endsWith('.json') ? 'json'
    : file.path.endsWith('.gradle') ? 'groovy'
    : file.path.endsWith('.toml') ? 'ini'
    : 'plaintext';

  return (
    <div className="flex-1 overflow-hidden">
      <Editor
        height="100%"
        path={file.path}
        language={lang}
        value={file.content}
        theme="vs-dark"
        options={{ readOnly: true, fontSize: 13, minimap: { enabled: false } }}
      />
    </div>
  );
}
