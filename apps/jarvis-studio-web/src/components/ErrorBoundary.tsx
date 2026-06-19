import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Studio UI render error', { error, componentStack: info.componentStack });
  }

  render() {
    if (!this.state.error) return this.props.children;
    return <main className="workspace error-boundary">
      <div className="panel error-boundary-panel">
        <AlertTriangle size={28} />
        <span className="eyebrow">UI ERROR BOUNDARY</span>
        <h1>页面渲染失败</h1>
        <p>{this.state.error.message}</p>
        <button onClick={() => this.setState({ error: undefined })}>重新进入当前页面</button>
      </div>
    </main>;
  }
}
