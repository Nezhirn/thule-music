import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** What shows in place of the children that failed; `retry` renders them again. */
  fallback(retry: () => void): ReactNode;
  /** A new value renders the children again (another page was opened). */
  resetKey?: unknown;
  children: ReactNode;
}

interface State {
  failed: boolean;
  resetKey: unknown;
}

/** Keeps a rendering error in its part of the app: the rest (the player) goes on. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State): Partial<State> | null {
    return props.resetKey === state.resetKey ? null : { failed: false, resetKey: props.resetKey };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error(error, info.componentStack);
  }

  render() {
    if (this.state.failed) return this.props.fallback(() => this.setState({ failed: false }));
    return this.props.children;
  }
}
