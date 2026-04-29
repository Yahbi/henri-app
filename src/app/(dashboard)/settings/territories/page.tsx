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
  const { user, profile } = useUser();
  const [territories, setTerritories] = useState<Territory[]>([]);
  const [loading, setLoading] = useState(true);

  const maxZips = PLAN_ZIP_LIMITS[profile?.plan ?? "starter"] ?? 5;

  const loadTerritories = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();
    // Paginate — PostgREST silently caps unbounded selects at 1000 rows
    // and the founder has 5,601 claimed ZIPs. Client-side version of
    // fetchAllTerritories so we don't ship the lib/territories helper
    // (which uses the server SupabaseClient type) to the browser bundle.
    const PAGE = 1000;
    const rows: Territory[] = [];
    for (let offset = 0; offset < 60_000; offset += PAGE) {
      const { data } = await supabase
        .from("territories")
        .select("id, zip, claimed_at")
        .eq("contractor_id", user.id)
        .order("claimed_at", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (!data || data.length === 0) break;
      rows.push(...(data as Territory[]));
      if (data.length < PAGE) break;
    }
    setTerritories(rows);
    setLoading(false);
  }, [user]);

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
        {territories.length < maxZips && (
          <Link
            href="/onboarding/territory"
            className="px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
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
            {territories.length} of {maxZips} ZIP codes claimed
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
      ) : territories.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 border border-dashed border-border rounded-xl text-center">
          <MapPin className="h-8 w-8 text-muted-foreground mb-3" />
          <p className="text-sm font-semibold text-foreground">No territories claimed</p>
          <p className="text-xs text-muted-foreground mt-1">
            Add your first ZIP to start receiving leads.
          </p>
          <Link
            href="/onboarding/territory"
            className="mt-4 px-4 py-2 bg-primary text-white text-sm font-medium rounded-lg hover:opacity-90 transition-opacity"
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
