"use client";

import { DashboardErrorFallback } from "@/components/dashboard/DashboardErrorFallback";

export default function PageError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <DashboardErrorFallback error={error} reset={reset} />;
}

