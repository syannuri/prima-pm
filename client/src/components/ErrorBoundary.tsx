import { Component, type ErrorInfo, type ReactNode } from 'react';

// Global crash guard — turns an unexpected render error from a BLANK white screen into a readable
// message with a reload, and logs the error (so it's diagnosable instead of silent).
export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // eslint-disable-next-line no-console
    console.error('App crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-100 p-6 text-center dark:bg-slate-950">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-xl dark:border-slate-700 dark:bg-slate-900">
          <div className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-red-50 text-red-600 ring-1 ring-red-100 dark:bg-red-900/20 dark:text-red-300">
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 9v4M12 17h.01M10.3 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.7 3.86a2 2 0 0 0-3.42 0z" /></svg>
          </div>
          <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">The app hit an unexpected error. Reloading usually fixes it.</p>
          <pre className="mt-4 max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-left text-xs text-red-600 dark:bg-slate-800 dark:text-red-300">{error.message}</pre>
          <button onClick={() => window.location.assign('/')} className="mt-5 w-full rounded-xl bg-blue-600 py-2.5 font-medium text-white transition hover:bg-blue-700">Reload</button>
        </div>
      </div>
    );
  }
}
