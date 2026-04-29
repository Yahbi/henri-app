"use client";

import React from "react";
import { AlertTriangle } from "lucide-react";
import { logger } from "@/lib/logger";

/**
 * Per-tab error boundary primitive (P0-6 from launch plan).
 *
 * `app/error.tsx` and `app/global-error.tsx` catch ROUTE-level errors —
 * they only fire if a server component throws or a client component throws
 * during initial render. They do NOT catch errors thrown later (e.g., in
 * `useQuery` retry callbacks, `useEffect` cleanup, or downstream component
 * crashes after the panel has hydrated).
 *
 * This boundary fills that gap. Each top-level dashboard tab wraps its
 * content in `<ErrorBoundary tab="leads">…</ErrorBoundary>` so a single
 * component crash collapses to a graceful "this section hit an error" card
 * instead of blanking the entire route.
 *
 * React 19 still uses class components for error boundaries — `useError`
 * is reserved for future hooks support. Until that lands, this is the
 * canonical pattern (also matches React docs).
 */

interface ErrorBoundaryProps {
  /** Short label for telemetry + the fallback header. e.g. "Leads", "Pipeline". */
  tab: string;
  /** Optional fallback override. Defaults to the branded card below. */
  fallback?: React.ReactNode;
  /** Optional onError side-effect (Sentry capture etc.). */
  onError?: (err: Error, info: React.ErrorInfo) => void;
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    // Structured log for Sentry / log aggregator. The logger.error sink
    // is auto-wired in instrumentation.ts when SENTRY_DSN is set.
    logger.error("ErrorBoundary caught", {
      tab: this.props.tab,
      message: error.message,
      stack: error.stack,
      component_stack: info.componentStack,
    });
    this.props.onError?.(error, info);
  }

  reset = (): void => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <div className="flex h-full min-h-[200px] flex-col items-center justify-center bg-card p-6 text-center">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h2 className="font-heading text-base font-normal text-foreground">
            {this.props.tab} hit an error
          </h2>
          <p className="mt-1 max-w-xs text-xs text-muted-foreground">
            One of the components in this section crashed. The rest of the
            dashboard is still working — try retrying this section or
            navigating away and back.
          </p>
          <button
            type="button"
            onClick={this.reset}
            className="mt-4 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 transition-colors"
          >
            Retry section
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
