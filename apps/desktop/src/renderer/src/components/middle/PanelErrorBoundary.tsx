import { Component, type ReactNode } from 'react';
import { AlertCircle, RotateCcw } from 'lucide-react';

interface PanelErrorBoundaryProps {
  children: ReactNode;
  /** 出错区域名称，用于提示文案 */
  label?: string;
}

interface PanelErrorBoundaryState {
  error: Error | null;
}

/**
 * 面板级错误边界：3D 视图 / 像素编辑器崩溃时只降级当前面板，
 * 不牵连整个 MiddlePanel。支持一键重试（重置状态）。
 */
export class PanelErrorBoundary extends Component<PanelErrorBoundaryProps, PanelErrorBoundaryState> {
  state: PanelErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PanelErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(`[PanelErrorBoundary:${this.props.label ?? 'panel'}]`, error);
  }

  private handleRetry = (): void => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full min-h-40 flex-col items-center justify-center gap-2 rounded-mc border border-red-900/50 bg-red-950/20 p-4 text-center">
        <AlertCircle className="h-5 w-5 text-red-400" />
        <div className="text-[12px] text-mc-text">
          {this.props.label ?? '面板'}加载失败
        </div>
        <div className="max-w-full truncate text-[10px] text-mc-mute" title={error.message}>
          {error.message}
        </div>
        <button
          onClick={this.handleRetry}
          className="flex items-center gap-1 rounded-mc border border-mc-border bg-mc-surface-2 px-2.5 py-1 text-[11px] text-mc-text hover:border-mc-accent"
        >
          <RotateCcw className="h-3 w-3" /> 重试
        </button>
      </div>
    );
  }
}
