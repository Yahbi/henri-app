"use client";

import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

interface DashboardErrorFallbackProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export function DashboardErrorFallback({ error, reset }: DashboardErrorFallbackProps) {
  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        {/* role="alert" so screen readers announce the swap-in — the
         * boundary previously replaced the tab contents silently. */}
        <CardContent role="alert" className="p-6 text-center space-y-4">
          <AlertTriangle className="h-10 w-10 text-destructive mx-auto" aria-hidden="true" />
          <h3 className="text-lg font-semibold text-foreground">
            Something went wrong
          </h3>
          <p className="text-sm text-muted-foreground">
            This tab hit an error and couldn&apos;t finish loading. The rest of
            the dashboard still works.
          </p>
          <Button variant="primary" onClick={reset}>
            Try Again
          </Button>
          {/* Raw error text is developer-facing (often Postgres/Supabase
           * internals) — keep it available for support without putting it
           * in front of the contractor as the headline explanation. */}
          <details className="text-left">
            <summary className="cursor-pointer text-[11px] text-muted-foreground">
              Technical details
            </summary>
            <p className="mt-1 break-words font-mono text-[10px] text-muted-foreground">
              {error.message || "No error message provided."}
              {error.digest ? ` · ref ${error.digest}` : ""}
            </p>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}
