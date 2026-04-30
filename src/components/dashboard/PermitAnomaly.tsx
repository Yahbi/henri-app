"use client";

import type { PermitAnomaly } from "@/lib/predictive/anomaly";
import { Clock } from "lucide-react";

/**
 * Tier A+ Sprint 1 — F2.5 permit anomaly badge.
 *
 * Renders a "stuck permit" badge when the permit's applied→issued gap is
 * unusually long for the issuing jurisdiction. Hides itself if not stuck.
 *
 * Tier A+ disclaimer: "Statistical anomaly detection on public permit
 * timestamps. Not a guarantee."
 */

export function PermitAnomalyPanel({
  anomaly,
}: {
  anomaly: PermitAnomaly | null;
}) {
  if (!anomaly || !anomaly.is_stuck) return null;

  const gap = anomaly.applied_to_issued_gap_days;
  const p95 = anomaly.jurisdiction_p95_gap_days;
  if (gap == null || p95 == null) return null;

  return (
    <div className="rounded-xl border border-cool/30 bg-cool/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <Clock className="h-4 w-4 text-cool" aria-hidden="true" />
        <h3 className="font-heading text-sm font-medium text-foreground">
          Stuck permit
        </h3>
      </div>
      <p className="text-sm text-foreground">
        This permit took <strong>{gap} days</strong> from application to issue —{" "}
        unusually long for this jurisdiction (p95: {p95} days).
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        Anomaly score: {anomaly.anomaly_score.toFixed(1)}× the typical local timeline.
        Could indicate a stuck application; opportunity to help unstick.
      </p>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Statistical detection on public permit timestamps. Not a guarantee.
      </p>
    </div>
  );
}
