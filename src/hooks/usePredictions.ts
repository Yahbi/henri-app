/**
 * Tier A+ Sprint 1 — single hook reading 3 prediction caches per lead.
 *
 * Returns null/empty when no predictions exist (cron hasn't run yet for
 * this lead, or sample size too low). Components handle null and render
 * nothing — never blank shells.
 *
 * RLS-protected: contractor sees only their own leads' predictions.
 * Hook is contractor-scope-safe by virtue of Supabase RLS.
 */
import { useQuery } from "@tanstack/react-query";
import { createClient } from "@/lib/supabase/client";
import { getCascadePredictionsForLead, type CascadePrediction } from "@/lib/predictive/cascade";
import { getStormPredictionForLead, type StormPrediction } from "@/lib/predictive/storm-impact";
import { getAnomalyForPermit, type PermitAnomaly } from "@/lib/predictive/anomaly";

export interface LeadPredictions {
  cascade: CascadePrediction[];
  storm: StormPrediction | null;
  anomaly: PermitAnomaly | null;
}

export function usePredictions(
  leadId: string | null | undefined,
  permitId: string | null | undefined,
) {
  return useQuery({
    queryKey: ["predictions", leadId, permitId],
    queryFn: async (): Promise<LeadPredictions> => {
      if (!leadId) return { cascade: [], storm: null, anomaly: null };
      const supabase = createClient();

      const [cascade, storm, anomaly] = await Promise.all([
        getCascadePredictionsForLead(supabase, leadId),
        getStormPredictionForLead(supabase, leadId),
        permitId ? getAnomalyForPermit(supabase, permitId) : Promise.resolve(null),
      ]);

      return { cascade, storm, anomaly };
    },
    enabled: !!leadId,
    staleTime: 5 * 60 * 1000, // 5 min — predictions only change on weekly cron
    refetchOnWindowFocus: false,
  });
}
