import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp, rateLimitResponse } from "@/lib/utils/rate-limit";
import { logger } from "@/lib/logger";
import { isZip5, sanitizeFilterText } from "@/lib/validation/params";

/* ─── Response contract ───────────────────────────────────────────────────
 * This interface is the ONLY declaration of the search payload. The browser
 * side (`src/hooks/useContractorSearch.ts`) imports it type-only instead of
 * re-declaring it, because the re-declared copy had silently drifted: it
 * named the fields `total_reviews` / `total_jobs_won` / `verified`, while
 * this route returns `review_count` / `jobs_completed` / `license_verified`
 * (that last one was `badge_licensed` until the licence block below
 * replaced it).
 * Every read on the homeowner card therefore resolved to `undefined`, so
 * every contractor rendered 0 reviews, 0 jobs and an unverified badge no
 * matter what their profile held.
 *
 * `PROFILE_COLUMNS` below is keyed off this interface, so changing the
 * SELECT without changing the contract (or the reverse) is a typecheck
 * failure rather than another silent `undefined`. */
export interface ContractorSearchResult {
  id: string;
  company_name: string | null;
  full_name: string | null;
  trade: string | null;
  avg_rating: number | null;
  review_count: number | null;
  jobs_completed: number | null;
  response_time_h: number | null;
  specialties: string[] | null;
  years_experience: number | null;
  /* Licence trust block — derived from `contractor_licenses`, NOT from
   * `profiles.badge_licensed`.
   *
   * `badge_licensed` / `badge_insured` / `badge_background` have no writer
   * anywhere in src/ and migration 00117 hard-locks them against every
   * non-service-role session, so they are `false` for every contractor that
   * exists. Shipping them to a homeowner would assert a check Henri never
   * ran. The real signal is /api/onboarding/verify-license, which sets
   * `contractor_licenses.verified` only on a live match against
   * `state_license_rosters`.
   *
   * There is deliberately no `insured` or `background_checked` field:
   * Henri collects neither, so no honest value exists to send. */
  license_verified: boolean;
  license_state: string | null;
  /** When the roster cross-check last ran, ISO-8601. Null when unrecorded. */
  license_verified_at: string | null;
}

/** The part of the contract that is read verbatim off `profiles`. */
type ProfileColumn = keyof Omit<
  ContractorSearchResult,
  "license_verified" | "license_state" | "license_verified_at"
>;

/* `Record<ProfileColumn, true>` is exhaustive in both directions: a missing
 * key fails to satisfy the Record, an extra key trips excess-property
 * checking. That is what keeps the SELECT and the contract in lockstep. */
const PROFILE_COLUMNS: Record<ProfileColumn, true> = {
  id: true,
  company_name: true,
  full_name: true,
  trade: true,
  avg_rating: true,
  review_count: true,
  jobs_completed: true,
  response_time_h: true,
  specialties: true,
  years_experience: true,
};

const PROFILE_SELECT = Object.keys(PROFILE_COLUMNS).join(", ");

type ProfileRow = Pick<ContractorSearchResult, ProfileColumn>;

interface VerifiedLicense {
  state: string | null;
  verified_at: string | null;
}

/**
 * Most-recently-checked verified licence per contractor.
 *
 * Degrades to an empty map on error: an unbadged card is honest, a 500 on
 * the whole contractor search is not.
 */
async function fetchVerifiedLicenses(
  supabase: ReturnType<typeof createAdminClient>,
  contractorIds: string[]
): Promise<Map<string, VerifiedLicense>> {
  const byContractor = new Map<string, VerifiedLicense>();
  if (contractorIds.length === 0) return byContractor;

  /* Date-only compare: `expiry_date` is a DATE column. */
  const today = new Date().toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("contractor_licenses")
    .select("contractor_id, license_state, last_checked_at, expiry_date")
    .in("contractor_id", contractorIds)
    .eq("verified", true)
    /* An expired licence is not a licence. A NULL expiry means the roster
     * doesn't publish one — absent is not expired, so it stays eligible. */
    .or(`expiry_date.is.null,expiry_date.gte.${today}`)
    .order("last_checked_at", { ascending: false, nullsFirst: false });

  if (error) {
    logger.warn("Contractor licence lookup failed; licence badges suppressed", {
      error: error.message,
    });
    return byContractor;
  }

  /* A contractor can hold several rows (multi-state). Ordered newest-first
   * above, so the first row we see per contractor is the freshest check. */
  for (const row of data ?? []) {
    const id = row.contractor_id as string;
    if (byContractor.has(id)) continue;
    byContractor.set(id, {
      state: (row.license_state as string | null) ?? null,
      verified_at: (row.last_checked_at as string | null) ?? null,
    });
  }

  return byContractor;
}

/* ─── GET /api/contractors/search — public contractor search for homeowners ─── */
export async function GET(request: NextRequest) {
  // Rate limit: 30 requests per minute per IP
  const ip = getClientIp(request);
  const rl = checkRateLimit(`contractor-search:${ip}`, { maxRequests: 30 });
  if (!rl.allowed) return rateLimitResponse(rl);

  try {
    const { searchParams } = new URL(request.url);
    const zip = searchParams.get("zip");
    /* `trade` lands in a PostgREST ilike filter — strip the characters that
     * carry meaning there (`,` `(` `)` `%` `_`) so a crafted value can't
     * widen or restructure the filter. */
    const trade = sanitizeFilterText(searchParams.get("trade"), 40);
    const sort = searchParams.get("sort") ?? "rating";

    if (!isZip5(zip)) {
      return NextResponse.json(
        { error: "zip must be a 5-digit US ZIP code" },
        { status: 400 }
      );
    }

    const supabase = createAdminClient();

    /* Find active contractor IDs in this ZIP */
    const { data: territories, error: tErr } = await supabase
      .from("territories")
      .select("contractor_id")
      .eq("zip", zip)
      .eq("status", "active")
      .limit(200);

    if (tErr) {
      logger.error("Territory lookup error", { error: tErr instanceof Error ? tErr.message : String(tErr) });
      return NextResponse.json(
        { error: "Failed to search contractors" },
        { status: 500 }
      );
    }

    const contractorIds = (territories ?? []).map((t) => t.contractor_id);

    if (contractorIds.length === 0) {
      return NextResponse.json({ contractors: [], total: 0 });
    }

    /* Build profile query */
    let query = supabase
      .from("profiles")
      .select(PROFILE_SELECT, { count: "exact" })
      .in("id", contractorIds)
      .eq("role", "contractor")
      .eq("onboarding_completed", true);

    /* Apply trade filter */
    if (trade) {
      query = query.ilike("trade", `%${trade}%`);
    }

    /* Sort by the specified field */
    const sortMap: Record<string, { column: string; ascending: boolean }> = {
      rating: { column: "avg_rating", ascending: false },
      response_time: { column: "response_time_h", ascending: true },
      jobs: { column: "jobs_completed", ascending: false },
    };

    const sortConfig = sortMap[sort] ?? sortMap.rating;
    query = query.order(sortConfig.column, {
      ascending: sortConfig.ascending,
      nullsFirst: false,
    });

    query = query.limit(20);

    const { data: contractors, error, count } = await query;

    if (error) {
      logger.error("Contractor search error", { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: "Failed to search contractors" },
        { status: 500 }
      );
    }

    const profiles = (contractors ?? []) as unknown as ProfileRow[];
    const licenses = await fetchVerifiedLicenses(
      supabase,
      profiles.map((p) => p.id)
    );

    const results: ContractorSearchResult[] = profiles.map((profile) => {
      const license = licenses.get(profile.id);
      return {
        ...profile,
        license_verified: license !== undefined,
        license_state: license?.state ?? null,
        license_verified_at: license?.verified_at ?? null,
      };
    });

    return NextResponse.json({
      contractors: results,
      total: count ?? 0,
    });
  } catch (err) {
    logger.error("Contractor search error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
