"use client";

import type { StormPrediction } from "@/lib/predictive/storm-impact";
import { CloudLightning } from "lucide-react";

/**
 * Tier A+ Sprint 1 — F2.1 storm-impact panel.
 *
 * Renders recent NOAA storm activity at the lead's ZIP and the predicted
 * repair likelihood. Hides itself entirely when no storms in the 60-day
 * window (storm.storm_event_count_60d === 0 or null).
 *
 * Tier A+ disclaimer: "Based on NOAA storm event data. Not a guarantee."
 */

export function StormImpactPanel({
  storm,
}: {
  storm: StormPrediction | null;
}) {
  if (!storm || storm.storm_event_count_60d === 0) return null;

  return (
    <div className="rounded-xl border border-warm/30 bg-warm/5 p-4">
      <div className="mb-2 flex items-center gap-2">
        <CloudLightning className="h-4 w-4 text-warm" aria-hidden="true" />
        <h3 className="font-heading text-sm font-medium text-foreground">
          Storm activity in this ZIP (last 60 days)
        </h3>
      </div>
      <div className="space-y-1 text-sm">
        <p className="text-foreground">
          <strong>{storm.storm_event_count_60d}</strong>{" "}
          {storm.primary_event_type ? (
            <>
              {storm.primary_event_type.toLowerCase()} event
              {storm.storm_event_count_60d === 1 ? "" : "s"}
            </>
          ) : (
            <>storm event{storm.storm_event_count_60d === 1 ? "" : "s"}</>
          )}
          {storm.last_storm_date && (
            <>
              {" "}
              · most recent {new Date(storm.last_storm_date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </>
          )}
        </p>
        {storm.repair_likelihood_60d > 0.1 && (
          <p className="text-xs text-muted-foreground">
            Predicted repair-permit likelihood:{" "}
            <span className="font-medium text-foreground">
              {Math.round(storm.repair_likelihood_60d * 100)}% within 60d
            </span>{" "}
            ·{" "}
            <span className="capitalize">{storm.confidence_label}</span> confidence
          </p>
        )}
      </div>
      <p className="mt-2 text-[10px] text-muted-foreground">
        Source: NOAA storm events. Statistical estimate, not a guarantee.
      </p>
    </div>
  );
}
