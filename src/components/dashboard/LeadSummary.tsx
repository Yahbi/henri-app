"use client";

/**
 * Tier A+ Sprint 3 — A1 lead-summary panel.
 *
 * Renders the LLM-generated 2-3 sentence "why pursue this lead" narrative
 * inside the LeadDetailDrawer. Hides itself entirely when:
 *   • No leadId yet
 *   • The mutation hasn't run AND no cached output exists
 *   • The agent returned an error AND we have nothing to show
 *
 * Auto-fires the generate mutation on mount when no cached output exists,
 * so the panel populates the first time a contractor opens a lead. A
 * "Regenerate" button lets the contractor re-trigger the agent if the
 * underlying predictions have changed.
 *
 * Tier A+ compliance:
 *   • Disclaimer rendered every time the panel renders
 *   • "AI draft" tag visually distinguishes LLM content
 *   • Read-only — no contractor input flows back to the LLM
 *   • Generate is opt-in via mount + button (not auto-spammed)
 */

import { useEffect, useRef } from "react";
import { Sparkles, RefreshCw } from "lucide-react";
import {
  useGenerateLeadSummary,
  useLeadSummary,
  type LeadSummaryResult,
} from "@/hooks/useLeadSummary";
import { AGENT_DISCLAIMER } from "@/lib/agents/orchestrator";

export function LeadSummaryPanel({ leadId }: { leadId: string | null }) {
  const cached = useLeadSummary(leadId);
  const generate = useGenerateLeadSummary();
  const fired = useRef<string | null>(null);

  /* Auto-fire on first mount per leadId. The ref guards against React 19
   * StrictMode double-fires + the parent re-rendering with the same lead. */
  useEffect(() => {
    if (!leadId) return;
    if (fired.current === leadId) return;
    if (cached.data?.output) return; // Cache populated → don't re-call
    fired.current = leadId;
    generate.mutate(leadId);
  }, [leadId, cached.data, generate]);

  if (!leadId) return null;

  const result: LeadSummaryResult | null | undefined =
    cached.data ?? generate.data;
  const isLoading = generate.isPending && !result?.output;
  const hasOutput = !!result?.output;

  // A generate that failed (mutation rejected, or the agent replied
  // ok:false) used to unmount the panel silently — the skeleton simply
  // vanished and the contractor was never told anything went wrong.
  const failed =
    !isLoading && !hasOutput && (generate.isError || result?.ok === false);

  // Hide entirely only when there is genuinely nothing to report.
  if (!isLoading && !hasOutput && !failed) return null;

  const onRegenerate = () => {
    if (!leadId) return;
    fired.current = leadId; // Avoid double-fire from the effect
    generate.mutate(leadId);
  };

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
          <h3 className="font-heading text-sm font-medium text-foreground">
            Why pursue this lead
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="rounded bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-primary">
            AI draft
          </span>
          {/* Regenerate must be available on the FAILURE path too — it was
              gated on hasOutput, i.e. hidden in exactly the case where it
              is needed. */}
          {!generate.isPending && (
            <button
              type="button"
              onClick={onRegenerate}
              aria-label="Regenerate lead summary"
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            >
              <RefreshCw className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-1.5" aria-busy="true">
          <div className="h-3 rounded bg-muted/40 animate-pulse" />
          <div className="h-3 rounded bg-muted/40 animate-pulse w-11/12" />
          <div className="h-3 rounded bg-muted/40 animate-pulse w-9/12" />
        </div>
      ) : failed ? (
        <div role="alert" className="space-y-1.5">
          <p className="text-sm leading-relaxed text-muted-foreground">
            Couldn&apos;t generate a summary for this lead
            {result?.errorCode ? ` (${result.errorCode})` : ""}.
          </p>
          <button
            type="button"
            onClick={onRegenerate}
            className="text-xs font-medium text-primary underline underline-offset-2 hover:opacity-80"
          >
            Try again
          </button>
        </div>
      ) : (
        <p className="text-sm leading-relaxed text-foreground">{result?.output}</p>
      )}

      <p className="mt-2 text-[10px] text-muted-foreground">{AGENT_DISCLAIMER}</p>
    </div>
  );
}
