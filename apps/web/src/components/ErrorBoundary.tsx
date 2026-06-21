import React from "react";

export class ErrorBoundary extends React.Component<{children: React.ReactNode, fallback?: React.ReactNode}, {hasError: boolean, error: any}> {
  constructor(props: any) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: any) {
    return { hasError: true, error };
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return <div className="p-10 text-red-500 bg-red-50 rounded-xl m-10 z-50 relative">
        <h1 className="text-xl font-bold mb-4">React Error Crash!</h1>
        <pre className="whitespace-pre-wrap font-mono text-sm">{this.state.error?.toString()}</pre>
        <pre className="whitespace-pre-wrap font-mono text-xs mt-4 text-gray-600">{this.state.error?.stack}</pre>
      </div>;
    }
    return this.props.children;
  }
}
