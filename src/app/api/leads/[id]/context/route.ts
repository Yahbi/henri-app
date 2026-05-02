import { type NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";
import {
  deriveAll,
  type DerivationContext,
  type DerivedEnrichments,
} from "@/lib/enrichment/derived";
import type { Lead } from "@/types/lead";
import type {
  AddressPermitHistory,
  HistoryPermit,
} from "@/lib/predictive/rules";

/**
 * GET /api/leads/[id]/context
 *
 * Phase 0 of free-tier data expansion: surface dormant property
 * context that's already derivable from data Henri has on hand.
 * Returns three layers, each independently nullable so the drawer
 * renders whatever is available without waiting on the others:
 *
 *   1. derived — roof age, HVAC age, pool/solar presence, panel age
 *      computed from this lead + permit history at the same address.
 *      Pure functions in `src/lib/enrichment/derived/index.ts`. No
 *      vendor calls, no I/O cost.
 *
 *   2. adjacent_count_90d — number of OTHER permits filed in the
 *      same ZIP within 90 days before this permit was filed. Drives
 *      "neighborhood reno wave" outreach. Read from view
 *      `v_permit_adjacent_count` (migration 00055).
 *
 *   3. storm — most recent storm event in same ZIP within 60 days
 *      before the permit was filed. Read from view
 *      `v_permit_storm_proximity` (migration 00055). Drives
 *      insurance-claim outreach for roofing / siding / windows.
 *
 * Auth: contractor-gated, same pattern as `/api/permits/history`.
 *
 * Graceful-degrade: if migration 00055 hasn't been applied yet, the
 * view queries fail silently and the response still ships with
 * derived layer populated. Never crashes; never blocks the drawer.
 *
 * Cache: 30s edge-cache. Permit history + storm proximity are stable
 * on the day-to-day; new permits in the same ZIP refresh on the next
 * read after the cache expires. Same TTL as `/api/permits/history`.
 */

interface StormProximity {
  type: string;
  date: string;
  days_between: number;
  magnitude: number | null;
}

/* Wave 1.5 sidecar surfaces — populated from migration 00069 tables
 * (NOAA SWDI + CourtListener) loaded by the Wave 1 / 2.B crons. Each
 * is independently nullable so the drawer renders whatever is
 * available without waiting on the others. */

export interface SwdiNearby {
  /** "hail" | "wind" | "tornado" — which signature kind */
  kind: "hail" | "wind" | "tornado";
  event_time: string;
  /** Distance to the lead in miles, rounded to 1 decimal. */
  miles_away: number;
  /** Hail-only — hail size in millimetres. */
  max_size_mm?: number | null;
  /** Wind-only — peak wind in mph. */
  max_wind_mph?: number | null;
  /** Hail/wind — probability (SEVPROB or PROB). */
  probability?: number | null;
}

export interface RecentLien {
  case_name: string | null;
  date_filed: string | null;
  court: string | null;
  docket_number: string | null;
  /** courtlistener.com path. Render as link in the UI. */
  absolute_url: string | null;
  snippet: string | null;
}

/* Wave 2.A/2.B canonical-data-layer surfaces. All independently
 * nullable so the drawer renders whatever is available without
 * waiting on the others. */

export interface NriRisk {
  /** Composite NRI score 0-100 for the matching county. */
  risk_score: number;
  /** "Very Low".."Very High" qualitative tier from FEMA. */
  risk_rating: string | null;
  /** "AL/Autauga" style human-readable origin so the UI can show
   *  which county the score came from when the city/county aren't
   *  the same word. */
  matched_on: string;
}

export interface NfipHistory {
  /** Total claim count in the lead's ZIP since 1978. */
  claim_count: number;
  /** Most-recent year-of-loss in the ZIP, when known. */
  latest_year: number | null;
  /** Top-3 most common cause-of-damage codes, e.g. ["1","9","13"]. */
  top_causes: string[];
}

export interface RecentDisaster {
  fema_id: string;
  disaster_number: number | null;
  declaration_type: string | null;
  declaration_date: string | null;
  incident_type: string | null;
  declaration_title: string | null;
}

interface ContextResponse {
  derived: DerivedEnrichments;
  adjacent_count_90d: number;
  storm: StormProximity | null;
  /** Up to 5 SWDI signatures within 25mi in the last 30 days, newest
   *  first. Empty when SWDI tables are empty or no matches. */
  swdi_nearby: SwdiNearby[];
  /** Up to 5 mechanic-lien dockets in the same zip in the last 90
   *  days, newest first. Empty when CourtListener table empty or no
   *  matches. */
  recent_liens: RecentLien[];
  /** Wave 2.A — FEMA NRI risk score for the lead's county, or null. */
  nri_risk: NriRisk | null;
  /** Wave 2.B — NFIP flood-claim history in the lead's ZIP. */
  nfip_history: NfipHistory | null;
  /** Wave 2.B — up to 5 most-recent FEMA disaster declarations
   *  affecting the lead's state (last 3 years). */
  recent_disasters: RecentDisaster[];
}

/** Approx miles between two lat/lng pairs via haversine. */
function haversineMi(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  // 3958.8 = mean Earth radius in miles
  return 3958.8 * c;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    /* 1. Fetch the lead. RLS already scopes to contractor_id, so we
     *    don't need to add an additional WHERE here. The contractor
     *    gate above already verified role; this just confirms the
     *    requested lead is in the contractor's view. */
    const { data: leadRow, error: leadErr } = await supabase
      .from("leads")
      .select(
        "id, permit_id, address, city, state, zip, year_built, owner_occupied, " +
          "permit_type, permit_description, trade, permit_filed_date, " +
          "latitude, longitude",
      )
      .eq("id", id)
      .maybeSingle();
    if (leadErr || !leadRow) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    /* 2. Fetch permit history at this address (newest first, capped at
     *    50 rows). This drives the derived calculations — roof age
     *    needs the latest roof permit, HVAC age the latest HVAC,
     *    etc. Mirrors the address-prefix strategy already proven in
     *    `/api/permits/history`.
     *
     *    The `leadRow` type from Supabase's narrow select doesn't fully
     *    overlap with the `Lead` interface (we only fetched ~12 of its
     *    40+ fields), so we cast via `unknown` to satisfy the
     *    DerivationContext contract. The derived functions only read
     *    `address`, `zip`, `year_built`, `permit_description`, and
     *    `trade` — all explicitly in our select. */
    const lead = leadRow as unknown as Lead;
    let history: AddressPermitHistory | null = null;
    const street = (lead.address ?? "").split(",")[0].trim();
    if (street && lead.zip) {
      const { data: histRows } = await supabase
        .from("permits")
        .select(
          "permit_number, permit_type, applied_date, issued_date, " +
            "estimated_value, status, trade, description",
        )
        .eq("zip", String(lead.zip).slice(0, 5))
        .ilike("address", `${street}%`)
        .limit(50);
      // Cast to Record<string, unknown>[] — Supabase's typed-select
      // generic returns `GenericStringError` when the column list isn't
      // backed by generated DB types. Same pattern as
      // `/api/permits/history` (line 71). The bracket-access below
      // narrows each field with typeof checks so we never trust raw
      // values.
      const rows = (histRows ?? []) as unknown as Array<
        Record<string, unknown>
      >;
      if (rows.length > 0) {
        const sorted = [...rows].sort((a, b) => {
          const ad = String(a["issued_date"] ?? a["applied_date"] ?? "");
          const bd = String(b["issued_date"] ?? b["applied_date"] ?? "");
          return bd.localeCompare(ad);
        });
        const trades = Array.from(
          new Set(
            sorted
              .map((p) =>
                typeof p["trade"] === "string" ? (p["trade"] as string) : null,
              )
              .filter((t): t is string => t !== null && t.length > 0),
          ),
        );
        const firstAppliedDate = sorted[sorted.length - 1]?.["applied_date"];
        const lastAppliedDate = sorted[0]?.["applied_date"];
        history = {
          address_norm: street.toLowerCase(),
          address: lead.address ?? street,
          city: lead.city ?? null,
          state: lead.state ?? null,
          zip: lead.zip ?? null,
          permit_count: sorted.length,
          total_value: null,
          first_permit_date:
            typeof firstAppliedDate === "string" ? firstAppliedDate : null,
          last_permit_date:
            typeof lastAppliedDate === "string" ? lastAppliedDate : null,
          trades,
          permits: sorted.map(
            (p): HistoryPermit => ({
              permit_number:
                typeof p["permit_number"] === "string"
                  ? (p["permit_number"] as string)
                  : undefined,
              permit_type:
                typeof p["permit_type"] === "string"
                  ? (p["permit_type"] as string)
                  : undefined,
              applied_date:
                typeof p["applied_date"] === "string"
                  ? (p["applied_date"] as string)
                  : undefined,
              issued_date:
                typeof p["issued_date"] === "string"
                  ? (p["issued_date"] as string)
                  : undefined,
              value:
                typeof p["estimated_value"] === "number"
                  ? (p["estimated_value"] as number)
                  : undefined,
              status:
                typeof p["status"] === "string"
                  ? (p["status"] as string)
                  : undefined,
              trade:
                typeof p["trade"] === "string"
                  ? (p["trade"] as string)
                  : undefined,
              description:
                typeof p["description"] === "string"
                  ? (p["description"] as string)
                  : undefined,
            }),
          ),
        };
      }
    }

    /* 3. Pure derivations — no I/O. Returns the bundled
     *    DerivedEnrichments with nullable roof/hvac and always-defined
     *    pool/solar/panel results. */
    const ctx: DerivationContext = { lead, history };
    const derived = deriveAll(ctx);

    /* 4. View queries. Both views (migration 00055) are graceful-
     *    degrade — if not yet applied, we silently fall back to
     *    "no signal" rather than 500 the whole drawer. */
    let adjacent_count_90d = 0;
    let storm: StormProximity | null = null;

    if (lead.permit_id) {
      const { data: adjRow, error: adjErr } = await supabase
        .from("v_permit_adjacent_count")
        .select("adjacent_count_90d")
        .eq("permit_id", lead.permit_id)
        .maybeSingle();
      if (!adjErr && adjRow && typeof adjRow.adjacent_count_90d === "number") {
        adjacent_count_90d = adjRow.adjacent_count_90d;
      }
      // adjErr falls through silently; common cause is migration 00055 not
      // applied yet (relation does not exist 42P01).

      const { data: stormRow, error: stormErr } = await supabase
        .from("v_permit_storm_proximity")
        .select("storm_type, storm_date, days_between, storm_magnitude")
        .eq("permit_id", lead.permit_id)
        .maybeSingle();
      if (
        !stormErr &&
        stormRow &&
        typeof stormRow.storm_type === "string" &&
        typeof stormRow.storm_date === "string" &&
        typeof stormRow.days_between === "number"
      ) {
        storm = {
          type: stormRow.storm_type,
          date: stormRow.storm_date,
          days_between: stormRow.days_between,
          magnitude:
            typeof stormRow.storm_magnitude === "number"
              ? stormRow.storm_magnitude
              : null,
        };
      }
    }

    /* 5. Wave 1.5 surfaces — SWDI signatures within 25mi/30d and
     *    CourtListener mechanic-liens in the same zip within 90d.
     *    Both tables (migration 00069) graceful-degrade — when empty
     *    or not yet applied, the surfaces just render as empty arrays
     *    and the drawer skips those panels.
     *
     *    Strategy:
     *      - For SWDI we need lat/lng to compute distance. When the
     *        lead has neither, skip the SWDI lookup entirely.
     *      - We use a coarse bbox prefilter (lat ±0.5° / lng ±0.6°
     *        ≈ 35 mi) to avoid haversine-ing the entire SWDI table,
     *        then refine with the haversine in JS.
     *      - For liens, ZIP-prefix matching on snippet/case_name is
     *        too noisy — instead we trust the recent-90d window
     *        across the lead's state. Refinement to ZIP-of-record
     *        is a follow-up once we have geocoded liens. */
    const swdiNearby: SwdiNearby[] = [];
    const recentLiens: RecentLien[] = [];

    // Same generic-string-error workaround as `lead` cast above —
    // narrow read against the un-typed Supabase row.
    const leadRowAny = leadRow as unknown as Record<string, unknown>;
    const lat = typeof leadRowAny.latitude === "number" ? leadRowAny.latitude : null;
    const lng = typeof leadRowAny.longitude === "number" ? leadRowAny.longitude : null;

    if (lat != null && lng != null) {
      const sinceIso = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const bboxLat = 0.5;
      const bboxLng = 0.6;
      // Pull a small bbox slice from each SWDI table in parallel.
      const [hailRes, windRes, tornadoRes] = await Promise.all([
        supabase
          .from("weather_swdi_hail")
          .select("event_time, lat, lng, max_size_mm, probability")
          .gte("event_time", sinceIso)
          .gte("lat", lat - bboxLat).lte("lat", lat + bboxLat)
          .gte("lng", lng - bboxLng).lte("lng", lng + bboxLng)
          .order("event_time", { ascending: false })
          .limit(50),
        supabase
          .from("weather_swdi_wind")
          .select("event_time, lat, lng, max_wind_mph")
          .gte("event_time", sinceIso)
          .gte("lat", lat - bboxLat).lte("lat", lat + bboxLat)
          .gte("lng", lng - bboxLng).lte("lng", lng + bboxLng)
          .order("event_time", { ascending: false })
          .limit(50),
        supabase
          .from("weather_swdi_tornado")
          .select("event_time, lat, lng")
          .gte("event_time", sinceIso)
          .gte("lat", lat - bboxLat).lte("lat", lat + bboxLat)
          .gte("lng", lng - bboxLng).lte("lng", lng + bboxLng)
          .order("event_time", { ascending: false })
          .limit(50),
      ]);

      const candidates: SwdiNearby[] = [];
      for (const row of hailRes.data ?? []) {
        if (typeof row.lat !== "number" || typeof row.lng !== "number") continue;
        const mi = haversineMi(lat, lng, row.lat, row.lng);
        if (mi > 25) continue;
        candidates.push({
          kind: "hail",
          event_time: String(row.event_time),
          miles_away: Math.round(mi * 10) / 10,
          max_size_mm: typeof row.max_size_mm === "number" ? row.max_size_mm : null,
          probability: typeof row.probability === "number" ? row.probability : null,
        });
      }
      for (const row of windRes.data ?? []) {
        if (typeof row.lat !== "number" || typeof row.lng !== "number") continue;
        const mi = haversineMi(lat, lng, row.lat, row.lng);
        if (mi > 25) continue;
        candidates.push({
          kind: "wind",
          event_time: String(row.event_time),
          miles_away: Math.round(mi * 10) / 10,
          max_wind_mph: typeof row.max_wind_mph === "number" ? row.max_wind_mph : null,
        });
      }
      for (const row of tornadoRes.data ?? []) {
        if (typeof row.lat !== "number" || typeof row.lng !== "number") continue;
        const mi = haversineMi(lat, lng, row.lat, row.lng);
        if (mi > 25) continue;
        candidates.push({
          kind: "tornado",
          event_time: String(row.event_time),
          miles_away: Math.round(mi * 10) / 10,
        });
      }
      // Newest first, cap at 5.
      candidates.sort((a, b) => b.event_time.localeCompare(a.event_time));
      swdiNearby.push(...candidates.slice(0, 5));
    }

    /* Lien lookup — anchored on the lead's state (CourtListener ships
     * `court` slug e.g. "calsup", "txjp", which carries state info).
     * Reasonable proxy until we add geocoded courts. Limit to 5
     * newest within last 90 days. */
    {
      const sinceIso = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      const stateAbbrev =
        typeof leadRowAny.state === "string"
          ? (leadRowAny.state as string).toLowerCase()
          : null;
      let q = supabase
        .from("liens_courtlistener")
        .select("case_name, date_filed, court, docket_number, absolute_url, snippet")
        .gte("date_filed", sinceIso)
        .order("date_filed", { ascending: false })
        .limit(5);
      if (stateAbbrev) {
        // Court slugs starting with the state abbreviation are the
        // dominant pattern (calsup, txctapp, ...). Prefix match is
        // cheap and captures most.
        q = q.ilike("court", `${stateAbbrev}%`);
      }
      const { data: lienRows } = await q;
      for (const row of lienRows ?? []) {
        recentLiens.push({
          case_name: typeof row.case_name === "string" ? row.case_name : null,
          date_filed: typeof row.date_filed === "string" ? row.date_filed : null,
          court: typeof row.court === "string" ? row.court : null,
          docket_number: typeof row.docket_number === "string" ? row.docket_number : null,
          absolute_url: typeof row.absolute_url === "string" ? row.absolute_url : null,
          snippet: typeof row.snippet === "string" ? row.snippet : null,
        });
      }
    }

    /* Wave 2.A — NRI risk for the lead's county. NRI is keyed by
     * (state_abbrv, county_name); we don't have the lead's county
     * directly, so we match on city as a heuristic — many cities
     * share their county name. Best-effort, returns null on no
     * match.
     */
    let nriRisk: NriRisk | null = null;
    if (lead.state && lead.city) {
      const { data: nri } = await supabase
        .from("risk_nri_county")
        .select("risk_score, risk_rating, county_name, state_abbrv")
        .ilike("state_abbrv", lead.state)
        .ilike("county_name", lead.city)
        .limit(1)
        .maybeSingle();
      if (nri && typeof nri.risk_score === "number") {
        nriRisk = {
          risk_score: nri.risk_score,
          risk_rating: typeof nri.risk_rating === "string" ? nri.risk_rating : null,
          matched_on: `${nri.state_abbrv}/${nri.county_name}`,
        };
      }
    }

    /* Wave 2.B — NFIP flood-claim history in the lead's ZIP. */
    let nfipHistory: NfipHistory | null = null;
    if (lead.zip) {
      const z = String(lead.zip).slice(0, 5);
      const { data: claims, count } = await supabase
        .from("claims_nfip")
        .select("year_of_loss, cause_of_damage", { count: "exact" })
        .eq("reported_zip_code", z)
        .order("date_of_loss", { ascending: false, nullsFirst: false })
        .limit(200);
      if (claims && (count ?? 0) > 0) {
        const causeCounts = new Map<string, number>();
        let latestYear: number | null = null;
        for (const c of claims) {
          if (typeof c.year_of_loss === "number") {
            if (latestYear == null || c.year_of_loss > latestYear) {
              latestYear = c.year_of_loss;
            }
          }
          if (typeof c.cause_of_damage === "string" && c.cause_of_damage.trim()) {
            const k = c.cause_of_damage.trim();
            causeCounts.set(k, (causeCounts.get(k) ?? 0) + 1);
          }
        }
        const topCauses = [...causeCounts.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 3)
          .map(([k]) => k);
        nfipHistory = {
          claim_count: count ?? 0,
          latest_year: latestYear,
          top_causes: topCauses,
        };
      }
    }

    /* Wave 2.B — recent FEMA disaster declarations in the lead's
     * state, last 3 years, top 5 by declaration_date desc. */
    const recentDisasters: RecentDisaster[] = [];
    if (lead.state) {
      const since = new Date(Date.now() - 365 * 3 * 86_400_000).toISOString();
      const { data: dis } = await supabase
        .from("claims_disasters_fema")
        .select(
          "fema_id, disaster_number, declaration_type, declaration_date, incident_type, declaration_title",
        )
        .eq("state", lead.state)
        .gte("declaration_date", since)
        .order("declaration_date", { ascending: false, nullsFirst: false })
        .limit(5);
      for (const d of dis ?? []) {
        recentDisasters.push({
          fema_id: typeof d.fema_id === "string" ? d.fema_id : "",
          disaster_number: typeof d.disaster_number === "number" ? d.disaster_number : null,
          declaration_type: typeof d.declaration_type === "string" ? d.declaration_type : null,
          declaration_date: typeof d.declaration_date === "string" ? d.declaration_date : null,
          incident_type: typeof d.incident_type === "string" ? d.incident_type : null,
          declaration_title: typeof d.declaration_title === "string" ? d.declaration_title : null,
        });
      }
    }

    const body: ContextResponse = {
      derived,
      adjacent_count_90d,
      storm,
      swdi_nearby: swdiNearby,
      recent_liens: recentLiens,
      nri_risk: nriRisk,
      nfip_history: nfipHistory,
      recent_disasters: recentDisasters,
    };

    return NextResponse.json(body, {
      headers: {
        "Cache-Control": "private, max-age=30",
      },
    });
  } catch (err) {
    logApiError("leads.context", err);
    return NextResponse.json(
      { error: "Failed to fetch lead context" },
      { status: 500 },
    );
  }
}
