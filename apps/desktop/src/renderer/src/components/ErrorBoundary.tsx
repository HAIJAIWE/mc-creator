import { Component, type ReactNode, type ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  /** 自定义回退 UI，不传则使用默认 */
  fallback?: ReactNode;
  /** 区域名称（用于错误日志） */
  name?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * React Error Boundary：捕获子组件渲染异常，显示错误回退 UI 而非白屏。
 * 用于包裹工作台各区域（侧面板、中间编辑区、右侧智能体面板）。
 *
 * 注意：Error Boundary 只捕获渲染生命周期和构造函数中的错误，
 * 不捕获事件处理器、异步代码、服务端渲染中的错误。
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(
      `[ErrorBoundary${this.props.name ? `:${this.props.name}` : ''}]`,
      error,
      info.componentStack,
    );
  }

  handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  render(): ReactNode {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;

      return (
        <div className="flex h-full flex-col items-center justify-center gap-3 bg-mc-bg p-6">
          <AlertTriangle className="h-8 w-8 text-mc-redstone" />
          <div className="text-sm font-medium text-mc-text">
            {this.props.name ? `${this.props.name} 出错` : '渲染出错'}
          </div>
          <div className="max-w-sm text-center text-xs text-mc-dim">
            {this.state.error?.message || '未知错误'}
          </div>
          <button onClick={this.handleRetry} className="mc-btn-ghost flex items-center gap-1">
            <RefreshCw className="h-3 w-3" />
            重试
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
