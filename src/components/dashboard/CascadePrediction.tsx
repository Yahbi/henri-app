"use client";

import type { CascadePrediction } from "@/lib/predictive/cascade";

/**
 * Tier A+ Sprint 1 — F2 cascade prediction panel.
 *
 * Renders predicted follow-on jobs in the LeadDetailDrawer. Hides itself
 * entirely if there are no predictions or all predictions are below the
 * 20% probability floor (avoids low-signal noise).
 *
 * Tier A+ disclaimer: "Statistical model on permit cascade history.
 * Not a guarantee."
 */

const MIN_DISPLAY_PROBABILITY = 0.2;
const MAX_PREDICTIONS_SHOWN = 3;

export function CascadePredictionPanel({
  predictions,
}: {
  predictions: CascadePrediction[];
}) {
  if (!predictions || predictions.length === 0) return null;
  // Filter out very-low-probability predictions to avoid noise
  const visible = predictions
    .filter((p) => p.prob_90d >= MIN_DISPLAY_PROBABILITY)
    .slice(0, MAX_PREDICTIONS_SHOWN);
  if (visible.length === 0) return null;

  return (
    <div className="rounded-xl border border-border bg-card/50 p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="font-heading text-sm font-medium text-foreground">
          Predicted follow-on jobs
        </h3>
        <span className="text-[10px] text-muted-foreground">
          Statistical · not a guarantee
        </span>
      </div>
      <div className="space-y-2">
        {visible.map((p) => (
          <div
            key={p.predicted_trade}
            className="flex items-center justify-between rounded-lg bg-bg-subtle px-3 py-2"
          >
            <div className="flex flex-col gap-0.5">
              <span className="text-sm font-medium capitalize text-foreground">
                {p.predicted_trade}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {Math.round(p.prob_90d * 100)}% within 90d ·{" "}
                {Math.round(p.prob_180d * 100)}% within 180d ·{" "}
                <span className="capitalize">{p.confidence_label}</span> confidence
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">
              n={p.sample_size}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
