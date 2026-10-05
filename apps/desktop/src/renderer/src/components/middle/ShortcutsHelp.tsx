interface ShortcutGroup {
  title: string;
  items: Array<{ keys: string; desc: string }>;
}

const SKIN_GROUPS: ShortcutGroup[] = [
  {
    title: '绘图工具',
    items: [
      { keys: 'P', desc: '画笔' },
      { keys: 'E', desc: '橡皮' },
      { keys: 'F', desc: '填充' },
      { keys: 'I', desc: '取色' },
      { keys: 'L', desc: '直线' },
      { keys: 'R', desc: '矩形' },
    ],
  },
  {
    title: '编辑',
    items: [
      { keys: 'Ctrl/⌘ + Z', desc: '撤销' },
      { keys: 'Ctrl/⌘ + Y / Shift + Z', desc: '重做' },
      { keys: 'M', desc: '镜像模式循环（关→全局→智能）' },
      { keys: 'G', desc: '像素网格开关' },
    ],
  },
  {
    title: '视图',
    items: [
      { keys: '滚轮', desc: '以鼠标为中心缩放' },
      { keys: '空格 + 拖拽', desc: '平移画布' },
      { keys: '双指捏合', desc: '触摸缩放' },
      { keys: '双指拖拽', desc: '触摸平移' },
    ],
  },
  {
    title: '面板',
    items: [
      { keys: 'Shift + P', desc: '姿势面板' },
      { keys: 'Shift + F', desc: '滤镜面板' },
      { keys: 'Shift + L', desc: '图层面板' },
      { keys: '?', desc: '打开本帮助' },
    ],
  },
];

const CAPE_GROUPS: ShortcutGroup[] = [
  {
    title: '绘图工具',
    items: [
      { keys: 'P', desc: '画笔' },
      { keys: 'E', desc: '橡皮' },
      { keys: 'F', desc: '填充' },
      { keys: 'I', desc: '取色' },
    ],
  },
  {
    title: '编辑',
    items: [
      { keys: 'Ctrl/⌘ + Z', desc: '撤销' },
      { keys: 'Ctrl/⌘ + Y / Shift + Z', desc: '重做' },
      { keys: 'M', desc: '水平镜像开关' },
      { keys: 'G', desc: '像素网格开关' },
    ],
  },
  {
    title: '视图',
    items: [
      { keys: '滚轮', desc: '缩放' },
      { keys: '双指捏合', desc: '触摸缩放' },
      { keys: '双指拖拽', desc: '触摸平移' },
      { keys: '?', desc: '打开本帮助' },
    ],
  },
];

export function ShortcutsHelp({
  open,
  onClose,
  variant = 'skin',
}: {
  open: boolean;
  onClose: () => void;
  variant?: 'skin' | 'cape';
}) {
  if (!open) return null;
  const groups = variant === 'skin' ? SKIN_GROUPS : CAPE_GROUPS;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="快捷键一览"
    >
      <div
        className="max-h-[80vh] w-[420px] overflow-y-auto rounded-mc border border-mc-border bg-mc-surface-2 p-4"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        tabIndex={0}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-medium text-mc-text">快捷键一览</h3>
          <button
            onClick={onClose}
            className="rounded-mc border border-mc-border bg-mc-surface-3 px-2 py-0.5 text-[11px] text-mc-dim hover:text-mc-text"
          >
            关闭 (Esc)
          </button>
        </div>
        <div className="space-y-3">
          {groups.map((g) => (
            <div key={g.title}>
              <div className="mb-1 text-[10px] font-bold uppercase tracking-wider text-mc-mute">
                {g.title}
              </div>
              <div className="space-y-1">
                {g.items.map((it) => (
                  <div
                    key={it.keys + it.desc}
                    className="flex items-center justify-between gap-2 text-[11px]"
                  >
                    <span className="text-mc-dim">{it.desc}</span>
                    <kbd className="rounded border border-mc-border bg-mc-surface-3 px-1.5 py-0.5 font-mono text-[10px] text-mc-text">
                      {it.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
