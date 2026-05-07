"use client";

/**
 * One-off preview route for Tier A+ Sprint 1-3 visual preview.
 * Renders the 3 new dashboard panels (cascade, storm, anomaly) with
 * mock data so you can see what the contractor will see in production
 * once migrations apply + cron runs.
 *
 * NOT shipped to production — this file lives on feat/predictive-tier-a-plus
 * for staging review only. Delete before merging to main.
 */

import { CascadePredictionPanel } from "@/components/dashboard/CascadePrediction";
import { StormImpactPanel } from "@/components/dashboard/StormImpact";
import { PermitAnomalyPanel } from "@/components/dashboard/PermitAnomaly";
import { AGENT_DISCLAIMER } from "@/lib/agents/orchestrator";

export default function TierAPlusPreview() {
  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl space-y-6 px-6 py-12">
        <header>
          <h1 className="font-heading text-3xl font-normal tracking-tight text-foreground">
            Tier A+ Preview
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            What contractors will see in <code className="rounded bg-muted px-1.5 py-0.5 text-xs">LeadDetailDrawer</code>{" "}
            once migrations apply + the weekly cron has run.
          </p>
        </header>

        <section className="space-y-3">
          <h2 className="font-heading text-lg font-normal text-foreground">
            F2 — Cascade prediction
          </h2>
          <p className="text-xs text-muted-foreground">
            Predicts follow-on jobs based on historical permit-cascade pairs at
            similar properties.
          </p>
          <CascadePredictionPanel
            predictions={[
              {
                predicted_trade: "hvac",
                prob_90d: 0.78,
                prob_180d: 0.85,
                prob_365d: 0.91,
                sample_size: 247,
                confidence_label: "medium",
              },
              {
                predicted_trade: "plumbing",
                prob_90d: 0.42,
                prob_180d: 0.61,
                prob_365d: 0.74,
                sample_size: 188,
                confidence_label: "medium",
              },
              {
                predicted_trade: "solar",
                prob_90d: 0.21,
                prob_180d: 0.34,
                prob_365d: 0.51,
                sample_size: 94,
                confidence_label: "medium",
              },
            ]}
          />
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-lg font-normal text-foreground">
            F2.1 — Storm-impact prediction
          </h2>
          <p className="text-xs text-muted-foreground">
            NOAA storm events at the lead&apos;s ZIP in the last 60 days +
            historical post-storm repair-permit-pull rate.
          </p>
          <StormImpactPanel
            storm={{
              storm_event_count_60d: 4,
              last_storm_date: "2026-04-25",
              max_magnitude: 2.25,
              primary_event_type: "Hail",
              repair_likelihood_60d: 0.45,
              repair_likelihood_90d: 0.58,
              sample_size: 312,
              confidence_label: "high",
            }}
          />
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-lg font-normal text-foreground">
            F2.5 — Permit-aging anomaly
          </h2>
          <p className="text-xs text-muted-foreground">
            Flags permits where the applied → issued gap is unusually long for
            the issuing jurisdiction (suggests stuck application).
          </p>
          <PermitAnomalyPanel
            anomaly={{
              jurisdiction_key: "hartford|ct",
              applied_to_issued_gap_days: 142,
              jurisdiction_p95_gap_days: 58,
              anomaly_score: 2.45,
              is_stuck: true,
            }}
          />
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-lg font-normal text-foreground">
            A1 — Lead summary agent (LLM-generated; mock output)
          </h2>
          <p className="text-xs text-muted-foreground">
            Read-only Claude Haiku summary. Renders 2-3 sentences in the
            drawer when contractor opens a lead. ~$0.001/call.
          </p>
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-heading text-sm font-medium text-foreground">
                Why pursue this lead
              </h3>
              <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
                AI draft
              </span>
            </div>
            <p className="text-sm leading-relaxed text-foreground">
              This is a recent roofing permit at a 1985 home with a $42k declared
              value. Cascade history suggests HVAC work is likely within 90 days
              (78% confidence, n=247), and 4 hail events in the ZIP over the last
              60 days raise the post-storm repair likelihood to 45%. The permit&apos;s
              applied-to-issued gap of 142 days is 2.4× the local p95, suggesting
              a stuck application worth a friendly check-in.
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {AGENT_DISCLAIMER}
            </p>
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="font-heading text-lg font-normal text-foreground">
            A2 — Weekly briefing agent (LLM-generated; mock output)
          </h2>
          <p className="text-xs text-muted-foreground">
            Read-only Claude Sonnet briefing rendered as a dashboard banner once
            per week. ~$0.04/call × 1/contractor/week.
          </p>
          <div className="rounded-xl border border-warm/30 bg-warm/5 p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-heading text-sm font-medium text-foreground">
                Your week ahead
              </h3>
              <span className="rounded bg-warm/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-warm">
                AI briefing
              </span>
            </div>
            <p className="text-sm leading-relaxed text-foreground">
              Focus on the 5 storm-impacted ZIPs in your territory this week:
              hail events from Apr 25 are correlated with elevated repair-permit
              activity. Prioritize the 3 hot leads (score ≥ 75) and the 2
              cascade hotspots in 06112 + 06095. Note a stuck permit in
              Hartford that&apos;s 142 days past its application date — a polite
              outreach could unlock the job.
            </p>
            <p className="mt-2 text-[10px] text-muted-foreground">
              {AGENT_DISCLAIMER}
            </p>
          </div>
        </section>

        <footer className="mt-12 border-t border-border pt-6 text-xs text-muted-foreground">
          <p>
            Branch: <code className="rounded bg-muted px-1.5 py-0.5">feat/predictive-tier-a-plus</code> · Sprints 1-3
            committed locally · Not yet pushed to production
          </p>
          <p className="mt-1">
            All panels hide themselves when their underlying data is missing
            (graceful degrade). The 3 cache tables (cascade_predictions,
            storm_predictions, permit_anomalies) are populated by{" "}
            <code className="rounded bg-muted px-1.5 py-0.5">/api/cron/predictive-refresh</code> on
            a weekly schedule once migrations 00062-00065 land.
          </p>
        </footer>
      </div>
    </div>
  );
}
