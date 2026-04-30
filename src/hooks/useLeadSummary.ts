/**
 * Tier A+ Sprint 3 — A1 lead-summary hook.
 *
 * On-demand fetch: the panel calls this hook when the contractor opens a
 * lead. It POSTs to /api/agents/lead-summary, which builds the prompt
 * server-side from contractor-scoped data, runs the A1 agent
 * (Claude Haiku, ~$0.001/call), and returns the 2-3 sentence narrative.
 *
 * The mutation is gated by a manual trigger (regenerate button) AND an
 * automatic fire on lead-open via `useEffect`. We never auto-spam: a stale
 * cached summary is preferred over an LLM re-call that costs money.
 *
 * Tier A+ compliance:
 *   • Read-only — agent NEVER takes action
 *   • Contractor-scoped — RLS on the server
 *   • Disclaimer rendered in the panel
 *   • Graceful-degrade — returns null on error, panel hides itself
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

export interface LeadSummaryResult {
  ok: boolean;
  output: string | null;
  /** USD cost reported by the agent orchestrator. */
  costUsd?: number;
  /** Error code when ok=false (one of 'budget' | 'kill_switch' | 'llm_error' | 'validation' | 'http'). */
  errorCode?: string;
}

async function postLeadSummary(leadId: string): Promise<LeadSummaryResult> {
  const res = await fetch("/api/agents/lead-summary", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ lead_id: leadId }),
  });

  if (!res.ok) {
    return { ok: false, output: null, errorCode: `http_${res.status}` };
  }

  const json = (await res.json().catch(() => ({}))) as Partial<LeadSummaryResult>;
  return {
    ok: !!json.ok,
    output: json.output ?? null,
    costUsd: json.costUsd,
    errorCode: json.errorCode,
  };
}

/**
 * Read-only query that returns the cached lead summary if one exists.
 * The mutation below populates the cache on first generate; this hook
 * lets the panel render whatever is in the cache without re-calling.
 */
export function useLeadSummary(leadId: string | null | undefined) {
  return useQuery({
    queryKey: ["lead-summary", leadId],
    queryFn: async (): Promise<LeadSummaryResult | null> => null,
    enabled: false, // Caller decides when to populate via the mutation
    staleTime: Infinity, // Once generated, never re-fetch automatically
  });
}

/**
 * Mutation that calls the A1 agent. Use the returned `.mutate()` to fire
 * a regenerate. The result is cached under the same key so both hooks
 * read from the same source of truth.
 */
export function useGenerateLeadSummary() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: postLeadSummary,
    onSuccess: (result, leadId) => {
      qc.setQueryData(["lead-summary", leadId], result);
    },
  });
}
