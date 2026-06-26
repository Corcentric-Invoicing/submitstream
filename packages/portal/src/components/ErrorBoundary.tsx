import { Component, type ReactNode, type ErrorInfo } from 'react';
import { Button } from '@/components/ui/button';
import { SubmitStreamLogo } from '@/components/ui/submitstream-logo';
import { AlertTriangle, RefreshCw } from 'lucide-react';

/**
 * App-level error boundary. Wraps every route so a thrown render error
 * surfaces with brand chrome instead of React's default crash dialog
 * or a blank screen. Includes a Retry (resets boundary) and a
 * "Go to invoices" escape hatch + collapsible error details.
 */

interface Props {
  children: ReactNode;
  /** Page name shown in the error copy ("on the Customers page", etc). */
  scope?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
  componentStack: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null, componentStack: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, componentStack: null };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary]', error, info.componentStack);
    this.setState({ componentStack: info.componentStack ?? null });
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, componentStack: null });
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-canvas px-4">
        <div className="max-w-lg w-full bg-white border border-line rounded-card shadow-2 p-7">
          <div className="flex items-start gap-3 mb-5">
            <span
              aria-hidden
              className="h-9 w-9 inline-flex items-center justify-center rounded-control bg-danger-soft text-danger shrink-0"
            >
              <AlertTriangle size={18} />
            </span>
            <div className="min-w-0">
              <SubmitStreamLogo size="sm" />
              <h1 className="mt-3 text-xl font-bold tracking-tight text-ink">
                Something went wrong
                {this.props.scope ? ` on the ${this.props.scope} page` : ''}.
              </h1>
              <p className="text-sm text-zinc-500 mt-1.5 leading-relaxed">
                The page hit an unexpected error. Your data is safe — nothing
                was changed. Try again, or jump back to the invoice queue.
              </p>
            </div>
          </div>

          <div className="flex gap-2 mb-5">
            <Button variant="primary" size="md" onClick={this.handleReset}>
              <RefreshCw size={13} aria-hidden />
              Try again
            </Button>
            <Button
              variant="secondary"
              size="md"
              onClick={() => {
                window.location.href = '/invoices';
              }}
            >
              Go to invoices
            </Button>
          </div>

          {this.state.error && (
            <details className="mt-2 group">
              <summary className="cursor-pointer text-xs text-zinc-500 hover:text-ink select-none">
                Technical details
              </summary>
              <div className="mt-3 bg-paper border border-line rounded-control p-3 text-[11px] font-mono text-zinc-700 max-h-64 overflow-auto leading-relaxed">
                <div className="font-semibold text-danger mb-2">
                  {this.state.error.name}: {this.state.error.message}
                </div>
                {this.state.componentStack && (
                  <pre className="whitespace-pre-wrap text-zinc-500">
                    {this.state.componentStack.trim()}
                  </pre>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    );
  }
}
