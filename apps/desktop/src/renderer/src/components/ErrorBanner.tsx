interface Props {
  message: string;
  onClose?: () => void;
}

export function ErrorBanner({ message, onClose }: Props) {
  return (
    <div className="flex items-center gap-2 rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-300">
      <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.28 7.22a.75.75 0 00-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 101.06 1.06L10 11.06l1.72 1.72a.75.75 0 101.06-1.06L11.06 10l1.72-1.72a.75.75 0 00-1.06-1.06L10 8.94 8.28 7.22z" clipRule="evenodd" />
      </svg>
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="text-red-400 hover:text-red-200">✕</button>
      )}
    </div>
  );
}
