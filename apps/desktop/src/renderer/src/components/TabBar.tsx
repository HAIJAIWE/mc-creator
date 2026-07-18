import { shallow } from 'zustand/shallow';
import { useModStore } from '../store/mod-store.js';
import { McIcon } from '../assets/mc-ui/McIcon';

function getFileIcon(path: string) {
  const name = path.endsWith('.json')
    ? 'file-text'
    : path.endsWith('.java') ||
        path.endsWith('.gradle') ||
        path.endsWith('.toml') ||
        path.endsWith('.properties')
      ? 'terminal'
      : path.endsWith('.png')
        ? 'image'
        : 'file';
  return <McIcon scope="pixel" name={name} size={14} style={{ opacity: 0.85 }} />;
}

export function TabBar() {
  // P3 性能：shallow 选择器避免 buildLog 流式更新触发重渲染
  const { files, selectedFile, selectFile, closeFile } = useModStore(
    (s) => ({
      files: s.files,
      selectedFile: s.selectedFile,
      selectFile: s.selectFile,
      closeFile: s.closeFile,
    }),
    shallow,
  );

  if (files.length === 0) return null;

  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-mc-border bg-mc-surface px-1 py-1">
      {files.map((file) => {
        const isSelected = selectedFile === file.path;
        const fileName = file.path.split('/').pop() || file.path;

        return (
          <button
            key={file.path}
            onClick={() => selectFile(file.path)}
            className={`flex items-center gap-1.5 rounded-mc border-b-2 px-2 py-1 text-xs transition-colors ${
              isSelected
                ? 'border-mc-accent bg-mc-surface-2 text-mc-text'
                : 'border-transparent text-mc-dim hover:bg-mc-surface-2/60 hover:text-mc-text'
            }`}
          >
            {getFileIcon(file.path)}
            <span className="max-w-32 truncate">{fileName}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeFile(file.path);
              }}
              className="rounded-mc p-0.5 text-mc-mute transition-colors hover:bg-mc-surface-3 hover:text-mc-text"
            >
              <McIcon scope="pixel" name="close" size={12} />
            </button>
          </button>
        );
      })}
    </div>
  );
}
