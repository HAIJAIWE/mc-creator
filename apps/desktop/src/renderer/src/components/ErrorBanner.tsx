import { AlertCircle, X } from 'lucide-react';

interface Props {
  message: string;
  onClose?: () => void;
}

export function ErrorBanner({ message, onClose }: Props) {
  return (
    <div className="flex items-center gap-2 rounded border border-red-800 bg-red-950/60 px-3 py-2 text-sm text-red-300">
      <AlertCircle className="h-4 w-4 flex-shrink-0 text-red-400" />
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="text-red-400 hover:text-red-200"><X className="h-4 w-4" /></button>
      )}
    </div>
  );
}
