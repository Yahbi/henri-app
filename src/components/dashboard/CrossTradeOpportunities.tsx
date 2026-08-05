"use client";

import { Sparkles, ArrowRight } from "lucide-react";
import { useState } from "react";
import type { CrossTradeSuggestion } from "@/lib/predictive/rules";

/**
 * Lead-drawer surface for the predictive cross-trade rules engine
 * (Phase 1.2). Reads the `cross_trade_suggestions` jsonb column on
 * `leads` (migration 00045) and renders each suggestion with:
 *
 *   - The target trade
 *   - The reason the rule fired
 *   - A "Forward" button that creates a new leads row (same permit,
 *     different trade) for routing to a contractor in that trade
 *
 * Renders nothing when:
 *   - The column is null (migration 00045 not applied, or
 *     WRITE_CROSS_TRADE_SUGGESTIONS=0)
 *   - No rules fired for this lead
 *
 * The forward action is the user's vision realized: "If a permit is
 * created for a pool, send it to the landscaper". It is opt-in: the
 * Forward button renders ONLY when the caller supplies `onForward`.
 * Until 2026-08-04 the button rendered unconditionally and flipped to
 * "Forwarded" even though no caller passed a handler and
 * /api/leads/forward was never built — i.e. it told the contractor a
 * lead had been routed when nothing had happened. The exclusivity lock
 * is per-(lead_id, trade) so the same permit can hold a roofing lock
 * for contractor A AND a landscaping lock for contractor B
 * simultaneously — no conflict.
 */
interface CrossTradeOpportunitiesProps {
  suggestions: CrossTradeSuggestion[] | null | undefined;
  leadId: string;
  /** Optional callback for the forward action. When omitted the Forward
   *  button is not rendered at all — a button that reports success
   *  without doing anything is worse than no button. */
  onForward?: (suggestion: CrossTradeSuggestion) => void | Promise<void>;
}

export function CrossTradeOpportunities({
  suggestions,
  leadId,
  onForward,
}: CrossTradeOpportunitiesProps) {
  const [forwarding, setForwarding] = useState<string | null>(null);
  const [forwarded, setForwarded] = useState<Set<string>>(new Set());
  const [forwardError, setForwardError] = useState<string | null>(null);

  if (!suggestions || suggestions.length === 0) return null;

  const handleForward = async (s: CrossTradeSuggestion) => {
    if (!onForward || forwarded.has(s.rule)) return;
    setForwarding(s.rule);
    setForwardError(null);
    try {
      await onForward(s);
      // Only claim "Forwarded" once the handler actually resolved.
      setForwarded((prev) => new Set(prev).add(s.rule));
    } catch {
      setForwardError(s.rule);
    } finally {
      setForwarding(null);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-primary shrink-0" />
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
          Cross-trade opportunities
        </span>
        <span className="text-[10px] text-muted-foreground">
          ({suggestions.length})
        </span>
      </div>

      <div className="space-y-1.5">
        {suggestions.map((s) => {
          const isForwarding = forwarding === s.rule;
          const isForwarded = forwarded.has(s.rule);
          return (
            <div
              key={s.rule}
              className="rounded-lg border border-border bg-bg-subtle px-3 py-2 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-xs font-semibold text-foreground capitalize">
                      {s.trade}
                    </span>
                    <span className="text-[10px] text-muted-foreground">
                      {Math.round(s.confidence * 100)}% confidence
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    {s.reason}
                  </p>
                </div>
                {onForward && (
                  <button
                    type="button"
                    disabled={isForwarding || isForwarded}
                    onClick={() => handleForward(s)}
                    data-lead-id={leadId}
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-primary/30 bg-primary/10 px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {isForwarded ? "Forwarded" : isForwarding ? "..." : "Forward"}
                    {!isForwarded && !isForwarding && (
                      <ArrowRight className="h-2.5 w-2.5" />
                    )}
                  </button>
                )}
              </div>
              {forwardError === s.rule && (
                <p role="alert" className="text-[10px] text-destructive">
                  Couldn&apos;t forward that suggestion — try again.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
