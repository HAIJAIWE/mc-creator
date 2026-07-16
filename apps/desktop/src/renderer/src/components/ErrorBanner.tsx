import { McIcon } from '../assets/mc-ui/McIcon';


interface Props {
  message: string;
  onClose?: () => void;
}

export function ErrorBanner({ message, onClose }: Props) {
  return (
    <div className="flex items-center gap-2 rounded-mc-lg border border-mc-redstone bg-mc-redstone/15 px-3 py-2 text-sm text-mc-redstone animate-mc-panel-in">
      <McIcon scope="pixel" name="square-alert" size={16} className="flex-shrink-0" />
      <span className="flex-1">{message}</span>
      {onClose && (
        <button onClick={onClose} className="text-mc-redstone hover:text-mc-text"><McIcon scope="pixel" name="close" size={16} /></button>
      )}
    </div>
  );
}
