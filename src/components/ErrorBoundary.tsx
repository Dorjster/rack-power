import { Component, type ReactNode } from 'react';

/** Keeps a render error from blanking the app; offers recovery without losing saved data. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="m-6 rounded-lg border border-red-700 bg-red-950/60 p-4 text-sm text-red-100">
        <h1 className="mb-2 text-lg font-bold">Алдаа гарлаа / Something went wrong</h1>
        <p className="mb-2">Сүүлд хадгалсан төсөл IndexedDB-д хадгалагдсан хэвээр. / Your last saved project is still stored locally.</p>
        <pre className="mb-3 max-h-40 overflow-auto rounded bg-black/40 p-2 text-xs">{this.state.error.message}</pre>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Дахин оролдох / Try again
        </button>{' '}
        <button className="btn" onClick={() => location.reload()}>
          Дахин ачаалах / Reload
        </button>
      </div>
    );
  }
}
