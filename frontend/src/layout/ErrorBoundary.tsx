import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";

interface Props { children: ReactNode; }
interface State { hasError: boolean; message?: string; }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center p-6">
          <div className="glass rounded-2xl p-8 max-w-md text-center">
            <div className="h-12 w-12 rounded-2xl bg-signal-rose/10 text-signal-rose flex items-center justify-center mx-auto mb-4">
              <AlertTriangle size={22} />
            </div>
            <h2 className="font-display text-lg font-semibold text-slate-50 mb-2">Something went wrong</h2>
            <p className="text-sm text-slate-400 mb-4">
              The interface hit an unexpected error. Reloading usually fixes this.
            </p>
            <button
              onClick={() => window.location.reload()}
              className="bg-ping-gradient text-white px-4 py-2 rounded-xl text-sm font-medium"
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
