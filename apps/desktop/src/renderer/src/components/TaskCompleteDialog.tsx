interface TaskCompleteDialogProps {
  show: boolean;
  onContinue: () => void;
  onStop: () => void;
}

export function TaskCompleteDialog({ show, onContinue, onStop }: TaskCompleteDialogProps) {
  if (!show) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="w-80 rounded-mc-lg border border-mc-border-strong bg-mc-surface p-6 text-mc-text shadow-mc-pop animate-mc-dialog-in">
        <div className="text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-mc-lg bg-mc-accent/20">
            <svg
              className="h-6 w-6 text-mc-accent"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <h3 className="mb-2 font-display text-lg font-semibold text-mc-text">任务已完成</h3>
          <p className="mb-6 text-sm text-mc-mute">布局配置器已创建完成！</p>
          <div className="flex gap-3">
            <button onClick={onStop} className="mc-btn-ghost flex-1">
              停下对话
            </button>
            <button onClick={onContinue} className="mc-btn-primary flex-1">
              继续交流
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
