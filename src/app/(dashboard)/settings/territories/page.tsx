"use client";

import { useState, useEffect, useCallback } from "react";
import { useUser } from "@/hooks/useUser";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";
import { MapPin, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

interface Territory {
  id: string;
  zip: string;
  claimed_at: string;
  pending_swap?: boolean;
}

import { PLAN_ZIP_LIMITS } from "@/lib/plans/constants";

export default function TerritoriesPage() {
  const { user, profile, loading: userLoading } = useUser();
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);
  // A failed query must never render as "you own nothing" — territory
  // exclusivity is the paid product, so a false empty here reads as
  // "Henri lost my territories". Previously the `error` from the
  // Supabase call was dropped entirely and an RLS denial / timeout /
  // network failure fell straight through to the empty state.
  const [loadError, setLoadError] = useState<string | null>(null);

  const maxZips = PLAN_ZIP_LIMITS[profile?.plan ?? "starter"] ?? 5;

  const loadTerritories = useCallback(async () => {
    if (!user) {
      // Auth resolved with no user: stop the skeleton rather than
      // spinning forever.
      if (!userLoading) setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    const supabase = createClient();
    // Paginate — PostgREST silently caps unbounded selects at 1000 rows
    // and the founder has 5,601 claimed ZIPs. Client-side version of
    // fetchAllTerritories so we don't ship the lib/territories helper
    // (which uses the server SupabaseClient type) to the browser bundle.
    const PAGE = 1000;
    const rows: Territory[] = [];
    for (let offset = 0; offset < 60_000; offset += PAGE) {
      const { data, error } = await supabase
        .from("territories")
        .select("id, zip, claimed_at")
        .eq("contractor_id", user.id)
        .order("claimed_at", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) {
        // Surface it — a mid-pagination failure previously truncated the
        // list silently and looked like a complete result.
        setLoadError(error.message || "Couldn't load your territories.");
        setLoading(false);
        return;
      }
      if (!data || data.length === 0) break;
      rows.push(...(data as Territory[]));
      if (data.length < PAGE) break;
    }
    setTerritories(rows);
    setLoading(false);
  }, [user, userLoading]);

  // Fetch territories on mount; setState happens after IO inside loadTerritories
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadTerritories(); }, [loadTerritories]);

  function formatDate(dateStr: string) {
    return new Date(dateStr).toLocaleDateString("en-US", {
      month: "short", day: "numeric", year: "numeric",
    });
  }

  return (
    <div className="p-8 max-w-2xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-heading font-normal text-2xl text-foreground">Territories</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your exclusive ZIP code territories
          </p>
        </div>
        {/* Gate the CTA and the counter on a successful load — offering
            "Add ZIP" against an unknown current count sends a contractor
            at their cap into a raw `tier_cap_exceeded` error. */}
        {!loadError && !loading && territories.length < maxZips && (
          <Link
            href="/onboarding/territory"
            className="px-4 py-2 bg-cta text-cta-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            Add ZIP
          </Link>
        )}
      </div>

      {/* Plan info */}
      <div className="bg-primary-04 border border-primary/20 rounded-xl px-4 py-3 flex items-center justify-between">
        <div>
          <p className="text-xs font-semibold text-primary uppercase tracking-wider">
            {profile?.plan ?? "Starter"} plan
          </p>
          <p className="text-sm text-foreground mt-0.5">
            {loadError
              ? `— of ${maxZips} ZIP codes claimed`
              : `${territories.length} of ${maxZips} ZIP codes claimed`}
          </p>
        </div>
        <Link
          href="/settings/billing"
          className="text-xs text-primary hover:underline"
        >
          Upgrade plan &rarr;
        </Link>
      </div>

      {/* Territory list */}
      {loading ? (
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="border border-border rounded-xl p-4 flex items-center gap-3">
              <Skeleton className="w-10 h-10 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="h-3 w-32" />
              </div>
            </div>
          ))}
        </div>
      ) : loadError ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 p-5 text-sm"
        >
          <p className="font-semibold text-destructive">
            Couldn&apos;t load your territories
          </p>
          <p className="mt-1 text-muted-foreground">
            This is <strong className="text-foreground">not</strong> your real
            territory list — any ZIPs you hold are still yours. {loadError}
          </p>
          <button
            type="button"
            onClick={() => void loadTerritories()}
            className="mt-3 rounded-lg bg-cta px-4 py-2 text-sm font-medium text-cta-foreground transition-opacity hover:opacity-90"
          >
            Retry
          </button>
        </div>
      ) : territories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-xl text-center">
          <MapPin className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-semibold text-foreground">No territories claimed</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add your first ZIP to start receiving leads.
          </p>
          <Link
            href="/onboarding/territory"
            className="mt-4 px-4 py-2 bg-cta text-cta-foreground text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
          >
            Claim your first ZIP
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {territories.map((t) => (
            <div key={t.id} className="border border-border rounded-xl p-4 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-primary-08 flex items-center justify-center shrink-0">
                <MapPin className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-semibold text-foreground">ZIP {t.zip}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Claimed {formatDate(t.claimed_at)}
                </p>
              </div>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Territory changes apply at your next billing cycle">
                <Clock className="h-3.5 w-3.5" />
                <span>Active</span>
              </div>
            </div>
          ))}

          <p className="text-xs text-muted-foreground pt-1">
            Territory changes take effect at the start of your next billing cycle, if the ZIP is available.
          </p>
        </div>
      )}
    </div>
  );
}
