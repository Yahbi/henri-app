/* ── Map Leads API ───────────────────────────────────────────────────────────
 * GET /api/leads/map
 *
 * Returns the authenticated contractor's leads as a GeoJSON
 * FeatureCollection optimised for MapLibre display.
 *
 * Query params:
 *   ?trade=hvac        — filter by trade
 *   ?status=new        — filter by lead status
 *   ?days=30           — only leads created in the last N days (default 90)
 *   ?include_permits=1 — also include raw permits (not yet scored) in territory
 * ────────────────────────────────────────────────────────────────────────── */

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { hasSupabase } from "@/lib/env";
import { isGodModeEmail, GOD_MODE_MAP_LIMIT } from "@/lib/auth/god-mode";
import { fetchAllTerritoryZips } from "@/lib/territories/fetch-all";
import { requireContractor } from "@/lib/auth/requireContractor";
import {
  resolveTradeGate,
  tradeTagsFor,
  GENERIC_TRADE_BUCKETS,
} from "@/lib/auth/trade-gating";

/**
 * Trade values are interpolated raw into a PostgREST `or=` expression below
 * (supabase-js does not escape inside `.or()`), and `?trade=` is caller
 * supplied. Anything outside this character class is rejected and we fall
 * back to the parameterised `.eq()` path.
 */
const SAFE_TRADE = /^[a-z0-9_]{1,40}$/i;

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  // Real-data only. If Supabase isn't configured, return 503 — never fall back
  // to Socrata public data, which used to silently swap user leads for generic
  // LA/Chicago/NYC permits.
  if (!hasSupabase()) {
    return NextResponse.json(
      { error: "Database not configured" },
      { status: 503 },
    );
  }

  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    /* ── Parse query params ────────────────────────────────────────────── */
    const { searchParams } = new URL(request.url);
    const requestedTrade = searchParams.get("trade");
    const statusFilter = searchParams.get("status");
    const daysBack = parseInt(searchParams.get("days") ?? "90", 10);

    /* ── Module 19 (2026-05-09) — trade-gating per plan tier.
     *  founder/starter/pro → leads matching profile.trade
     *  enterprise          → all trades (the "GC tier")
     *  god-mode            → all trades (bypass)
     *  When the requested ?trade= is more restrictive than the gate
     *  (e.g. founder profile.trade=plumbing and ?trade=plumbing) we use
     *  the requested value. When it's broader ("all" or another trade)
     *  we silently snap it back to the gate to enforce the plan limit. */
    const tradeGate = await resolveTradeGate(supabase, user);
    // Effective filter: respect the gate, but allow the UI to narrow further
    // to a single trade when the contractor sees all trades. Founder-tier
    // contractors who try to ?trade=hvac when their gate says plumbing still
    // get the gate's plumbing filter.
    const gatedTrade: string | null = tradeGate.seesAllTrades
      ? null
      : tradeGate.tradeFilter;
    const narrowedTrade: string | null = tradeGate.seesAllTrades
      ? (requestedTrade && requestedTrade !== "all" ? requestedTrade : null)
      : null;
    const tradeFilter: string | null = gatedTrade ?? narrowedTrade;

    /* ── 2026-08-05 correctness fix — the gate was `.eq("trade", X)` ────────
     * `leads.trade` is 57% the literal string "other" (156,457 of 274,783),
     * and 90% of the table is one of other / residential / commercial /
     * general — buckets that mean "the ingest could not classify this
     * permit". Every genuinely trade-specific value is tiny: hvac 776,
     * plumbing 233, roofing 843. So exact-string equality showed a paying
     * hvac contractor 776 rows out of 274,783 — a near-empty map — while
     * the permits that actually were theirs sat unclassified in the "other"
     * pile and were silently dropped.
     *
     * The gate now matches on the richer taxonomy that IS populated:
     * `leads.trade_tags` (derived from the permit description by
     * deriveTradeTags(); 62,239 leads tagged, of which 16,922 carry
     * trade='other'), OR'd with the original trade equality, OR'd with an
     * always-include for the four generic buckets. A lead nobody could
     * classify is never hidden from the one contractor who could work it.
     *
     * `trade_tags.cs.{tag}` (contains) is used rather than a single
     * `ov.{a,b}` overlap because PostgREST splits an `or=` expression on
     * commas and a comma inside `{}` is not reliably protected. One `cs`
     * term per tag is comma-free and still hits leads_trade_tags_gin.
     *
     * Applied with the generic always-include only for the involuntary PLAN
     * gate. A voluntary `?trade=` narrowing (contractor already sees all
     * trades and chose to focus) keeps trade + tags but not the generic
     * buckets, otherwise the UI filter would return the whole table. */
    const tradeOr: string | null =
      tradeFilter && SAFE_TRADE.test(tradeFilter)
        ? [
            `trade.eq.${tradeFilter}`,
            ...tradeTagsFor(tradeFilter)
              .filter((t) => SAFE_TRADE.test(t))
              .map((t) => `trade_tags.cs.{${t}}`),
            ...(gatedTrade
              ? [`trade.in.(${GENERIC_TRADE_BUCKETS.join(",")})`]
              : []),
          ].join(",")
        : null;
    // Plan-gated default.
    //   god-mode (dev/owner allowlist): no cap — paginate until Supabase
    //     returns an empty page or a statement timeout aborts a later page
    //     (handled further down as a partial result).
    //   subscriber: 2,000 for fast first-paint; raises with plan tier.
    // Any caller can override with `?limit=` (hard ceiling = 500,000).
    const godMode = isGodModeEmail(user.email);
    const defaultLimit = godMode ? GOD_MODE_MAP_LIMIT : 2000;
    const limitParam = parseInt(
      searchParams.get("limit") ?? String(defaultLimit),
      10,
    );
    const leadsLimit = Math.max(
      100,
      Math.min(
        Number.isFinite(limitParam) ? limitParam : defaultLimit,
        500_000,
      ),
    );
    // days >= 3650 (10y) is treated as "all time"
    const allTime = daysBack >= 3650;

    /* ── Resolve contractor's territory ZIPs ─────────────────────────────
     * Uses fetchAllTerritoryZips to paginate around PostgREST's 1000-row
     * default cap. Founder has 5,601 claimed ZIPs; prior unbounded select
     * silently truncated and dropped ~80% of downstream leads from the map. */
    const userZips = await fetchAllTerritoryZips(supabase, user.id);

    // 2026-05-09 — guard relaxed for god-mode. The early-return blanked the
    // map for any contractor (including the founder allowlist) whose
    // territories table was empty. God-mode already bypasses the
    // contractor_id filter below; gating it on territories was over-strict
    // and made the new intent-classification UI un-demoable. Subscribers
    // still hit the early-return so the map respects their claimed scope.
    if (userZips.length === 0 && !godMode) {
      return NextResponse.json(emptyCollection(), {
        headers: { "Cache-Control": "private, max-age=60" },
      });
    }

    /* ── Build query: leads + joined permit data ───────────────────────── */
    const sinceDate = new Date();
    sinceDate.setDate(sinceDate.getDate() - daysBack);

    // Supabase PostgREST caps single responses at 1000 rows regardless of
    // .limit(). Paginate with .range() until we've pulled `leadsLimit` rows or
    // exhausted the result set.
    const PAGE = 1000;
    type LeadsRow = {
      id: string;
      score: number | null;
      urgency: string | null;
      status: string | null;
      trade: string | null;
      created_at: string;
      owner_name: string | null;
      owner_first: string | null;
      owner_last: string | null;
      phone: string | null;
      email: string | null;
      cascade_flag: boolean | null;
      cascade_count: number | null;
      pipeline_value: number | null;
      score_freshness: number | null;
      score_value: number | null;
      score_contact: number | null;
      score_demand: number | null;
      // Enrichment columns populated by /api/cron/enrich
      year_built: number | null;
      home_sqft: string | null;
      lot_sqft: string | null;
      assessed_value: number | null;
      property_value: number | null;
      owner_since: string | null;
      owner_occupied: boolean | null;
      mailing_address: string | null;
      latitude: number | null;
      longitude: number | null;
      // Module 1 (2026-05-09) — intent classification.
      opportunity_stage: string | null;
      reason_codes: string[] | null;
      trade_tags: string[] | null;
      permits: unknown;
    };
    const leads: LeadsRow[] = [];
    for (let offset = 0; offset < leadsLimit; offset += PAGE) {
      const to = Math.min(offset + PAGE - 1, leadsLimit - 1);
      let pageQuery = supabase
        .from("leads")
        .select(
          `
          id, score, urgency, status, trade, created_at,
          owner_name, owner_first, owner_last,
          phone, email,
          cascade_flag, cascade_count, pipeline_value,
          score_freshness, score_value, score_contact, score_demand,
          year_built, home_sqft, lot_sqft,
          assessed_value, property_value, owner_since, owner_occupied,
          mailing_address,
          opportunity_stage, reason_codes, trade_tags,
          latitude, longitude,
          permits!inner (
            address, city, state, zip,
            permit_type, estimated_value, description,
            applied_date, issued_date,
            applicant_name, contractor_name,
            latitude, longitude
          )
        `,
        )
        .range(offset, to);
      // Subscription tiers cap by contractor_id; god-mode (founder/dev
      // allowlist) sees every lead in the account regardless of tier.
      if (!godMode) {
        pageQuery = pageQuery.eq("contractor_id", user.id);
      }
      // Score-ordered scans on (contractor_id, score DESC) across 131k rows
      // trigger Postgres statement timeouts on later pages under scorer
      // write load. When the caller wants a large slice (anything ≥ 5000),
      // skip ORDER BY so the planner uses (contractor_id, latitude)
      // indexes and streams every page. The map doesn't care about score
      // order for rendering — pin radius already encodes score via the
      // `circle-radius` interpolate in dashboard/map/page.tsx.
      if (leadsLimit < 5000) {
        pageQuery = pageQuery.order("score", { ascending: false });
      }
      if (!allTime) {
        pageQuery = pageQuery.gte("created_at", sinceDate.toISOString());
      }
      // Trade gate — see the tradeOr comment above. `.or()` when we could
      // build a safe expression, otherwise the original parameterised `.eq()`
      // (an unexpected trade string must never reach a raw PostgREST filter).
      if (tradeOr) pageQuery = pageQuery.or(tradeOr);
      else if (tradeFilter) pageQuery = pageQuery.eq("trade", tradeFilter);
      if (statusFilter) pageQuery = pageQuery.eq("status", statusFilter);

      const { data: pageRows, error: pageErr } = await pageQuery;
      if (pageErr) {
        // Partial-result tolerance: large ?limit= requests can hit the
        // Supabase statement timeout on a later page. Return what we have
        // rather than 500'ing the entire response and blanking the map.
        logger.warn("leads/map: page failed; returning rows collected so far", {
          offset,
          error: pageErr.message,
          collected: leads.length,
        });
        break;
      }
      if (!pageRows || pageRows.length === 0) break;
      leads.push(...(pageRows as LeadsRow[]));
      if (pageRows.length < PAGE) break; // last page
    }

    /* ── Wedge contract rule 3 — never silently drop rows ───────────────
     * Whatever survives of the trade gate has to be countable, so the UI can
     * render the mandatory "N filtered out, widen to see" counter. Two exact
     * head-counts over the same universe (same contractor, window and status)
     * differing only in the trade predicate; the difference is the honest
     * number of leads the gate is hiding.
     *
     * Skipped for god-mode: the gate never applies there, and an exact count
     * over all 274,783 leads would risk the 8s statement timeout. Null (not
     * zero) when the count can't be obtained — an unknown count must not be
     * reported as "nothing hidden". */
    let filteredOut: number | null = null;
    if (tradeFilter && !godMode) {
      const countBase = () => {
        let q = supabase
          .from("leads")
          // Same `permits!inner` shape as the feature query so both counts
          // describe the same universe as the map itself.
          .select("id, permits!inner(id)", { count: "exact", head: true })
          .eq("contractor_id", user.id);
        if (!allTime) q = q.gte("created_at", sinceDate.toISOString());
        if (statusFilter) q = q.eq("status", statusFilter);
        return q;
      };
      let matchedQuery = countBase();
      if (tradeOr) matchedQuery = matchedQuery.or(tradeOr);
      else matchedQuery = matchedQuery.eq("trade", tradeFilter);
      const [totalRes, matchedRes] = await Promise.all([
        countBase(),
        matchedQuery,
      ]);
      if (
        !totalRes.error &&
        !matchedRes.error &&
        typeof totalRes.count === "number" &&
        typeof matchedRes.count === "number"
      ) {
        filteredOut = Math.max(0, totalRes.count - matchedRes.count);
      } else {
        logger.warn("leads/map: trade-gate filtered-out count unavailable", {
          error: totalRes.error?.message ?? matchedRes.error?.message ?? null,
        });
      }
    }

    /* ── Build GeoJSON ─────────────────────────────────────────────────── */
    const features: GeoJSON.Feature[] = [];

    for (const row of leads ?? []) {
      // Supabase inner join returns an array or single object depending on relationship
      const rawPermit = row.permits;
      const permit = (
        Array.isArray(rawPermit) ? rawPermit[0] : rawPermit
      ) as Record<string, unknown> | null;
      if (!permit) continue;

      const lat = Number(permit.latitude);
      const lng = Number(permit.longitude);

      // (Previously had a PostGIS-geography fallback at this point. The
      // `permits.location` column was empty across 1.4M rows so the
      // fallback never fired; the column + the PostGIS extension were
      // both dropped in migration 00080 to clear the
      // `rls_disabled_in_public` advisor finding on spatial_ref_sys.)

      // Skip leads without valid coordinates
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
      // Reject sentinel (0, 0) — which falls in the Gulf of Guinea off
      // West Africa and clusters thousands of pins there. Upstream
      // ingesters occasionally default bad coords to 0,0 instead of
      // null; treat anything within a tiny box around null island as
      // invalid. Also rejects (0, anything) and (anything, 0) which are
      // always data-quality artifacts in a US-focused app.
      if (Math.abs(lat) < 0.5 && Math.abs(lng) < 0.5) continue;
      if (lat === 0 || lng === 0) continue;

      // Territory scoping: leads are scoped to the contractor via
      // `contractor_id = user.id` above. A second ZIP-level filter is
      // redundant (and actively wrong) — a contractor keeps leads they
      // earned even after releasing the territory, so filtering against
      // *current* territory ZIPs wipes legacy leads. This mirrors the
      // dropped `.in("permits.zip", userZips)` in /api/leads; same
      // rationale documented there. Debug (2026-04-22): the filter was
      // dropping 98% of god-mode leads because founder's assigned
      // leads span Hartford CT / Louisville KY but current territories
      // are NY-heavy — zero ZIP overlap, blank map.
      const zip = String(permit.zip ?? "");

      features.push({
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [lng, lat],
        },
        properties: {
          id: row.id,
          address: permit.address ?? "",
          city: permit.city ?? "",
          state: permit.state ?? "",
          zip,
          trade: row.trade ?? "other",
          status: row.status ?? "new",
          score: row.score ?? 0,
          urgency: row.urgency ?? "cold",
          permit_type: permit.permit_type ?? "",
          permit_value: permit.estimated_value ?? 0,
          description: permit.description ?? "",
          created_at: row.created_at,
          // Owner — prefer the denormalized leads.owner_name when set, fall
          // back to the joined permit.applicant_name so the popup renders
          // owner info for either data shape.
          owner_name:
            row.owner_name ??
            (permit.applicant_name as string | null) ??
            null,
          owner_first: row.owner_first ?? null,
          owner_last: row.owner_last ?? null,
          applicant_name: (permit.applicant_name as string | null) ?? null,
          contractor_name: (permit.contractor_name as string | null) ?? null,
          phone: row.phone ?? null,
          email: row.email ?? null,
          // Multi-permit intelligence (populated from address_permit_history)
          cascade_flag: !!row.cascade_flag,
          cascade_count: row.cascade_count ?? 0,
          pipeline_value: row.pipeline_value ?? null,
          // Scoring breakdown
          score_freshness: row.score_freshness ?? 0,
          score_value: row.score_value ?? 0,
          score_contact: row.score_contact ?? 0,
          score_demand: row.score_demand ?? 0,
          // Permit dates
          applied_date: (permit.applied_date as string | null) ?? null,
          issued_date: (permit.issued_date as string | null) ?? null,
          // Property enrichment (populated by cron/enrich from free
          // public parcel endpoints — Hartford CT, LA, DC, NYC, etc).
          year_built: row.year_built ?? null,
          home_sqft: row.home_sqft ?? null,
          lot_sqft: row.lot_sqft ?? null,
          assessed_value: row.assessed_value ?? null,
          property_value: row.property_value ?? null,
          owner_since: row.owner_since ?? null,
          owner_occupied: row.owner_occupied ?? null,
          mailing_address: row.mailing_address ?? null,
          // Module 1 (2026-05-09) — intent classification surfaces.
          // Powers the stage-color recolor toggle, the 5 preset filters,
          // and the popup chip.
          opportunity_stage: row.opportunity_stage ?? null,
          reason_codes: row.reason_codes ?? [],
          trade_tags: row.trade_tags ?? [],
        },
      });
    }

    /* ── Also fetch raw permits in territory (not yet scored) ─────────── */
    const includePermits = searchParams.get("include_permits") === "1";
    let rawPermitsShown = 0;
    let rawPermitsTruncated = false;

    if (includePermits) {
      /* PostgREST caps a single response at 1,000 rows regardless of
       * `.limit()` — that is precisely why the leads half above paginates at
       * PAGE = 1000. This overlay asked for 10,000 and silently received at
       * most 1,000, with no ORDER BY, so the surviving rows were
       * planner-arbitrary and the map drew them as if that were the whole
       * picture.
       *
       * Deliberately NOT paginated: this is a supplementary unscored-permit
       * backdrop, not the contractor's lead set, and nine extra round trips
       * would land on the same Postgres that already times out the scored
       * half. Instead the limit now states the truth, the ORDER BY makes the
       * survivors the NEWEST (which is what the "Show new permits" checkbox
       * promises) rather than arbitrary, and `_meta.rawPermitsTruncated`
       * lets the map say so instead of over-claiming density. */
      const RAW_PERMIT_CAP = 1000;
      let permitQuery = supabase
        .from("permits")
        .select("id, address, city, state, zip, permit_type, estimated_value, description, latitude, longitude, created_at, source_type")
        .in("zip", userZips)
        .is("scored_at", null)
        .order("created_at", { ascending: false })
        .limit(RAW_PERMIT_CAP);
      if (!allTime) {
        permitQuery = permitQuery.gte("created_at", sinceDate.toISOString());
      }

      if (tradeFilter) {
        permitQuery = permitQuery.ilike("description", `%${tradeFilter}%`);
      }

      const { data: rawPermits, error: rawPermitsErr } = await permitQuery;
      if (rawPermitsErr) {
        // Previously discarded entirely, so a statement timeout here looked
        // identical to "this territory has no unscored permits".
        logger.warn("leads/map: raw permit overlay unavailable", {
          error: rawPermitsErr.message,
        });
      }
      rawPermitsShown = rawPermits?.length ?? 0;
      // Exactly at the cap means Postgres had more to give.
      rawPermitsTruncated = rawPermitsShown >= RAW_PERMIT_CAP;

      for (const permit of rawPermits ?? []) {
        const lat = Number(permit.latitude);
        const lng = Number(permit.longitude);
        // Same note as above — the geography fallback was retired in
        // migration 00080 (column was empty across 1.4M rows).

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;

        features.push({
          type: "Feature",
          geometry: { type: "Point", coordinates: [lng, lat] },
          properties: {
            id: `permit-${permit.id}`,
            address: permit.address ?? "",
            city: permit.city ?? "",
            state: permit.state ?? "",
            zip: permit.zip ?? "",
            trade: "other",
            status: "unscored",
            score: 0,
            urgency: "cold",
            permit_type: permit.permit_type ?? "",
            permit_value: permit.estimated_value ?? 0,
            description: permit.description ?? "",
            created_at: permit.created_at,
            is_raw_permit: true,
          },
        });
      }
    }

    /* Module 19 — surface trade-gating decision in the response so the UI
     * can render an "Upgrade to GC tier to see all trades" banner. The
     * extra `_meta` field is non-standard GeoJSON but ignored by every
     * MapLibre source we use. */
    const collection: GeoJSON.FeatureCollection & { _meta?: unknown } = {
      type: "FeatureCollection",
      features,
      _meta: {
        seesAllTrades: tradeGate.seesAllTrades,
        gatedTrade: tradeGate.tradeFilter,
        plan: tradeGate.plan,
        profileTrade: tradeGate.profileTrade,
        // 2026-08-05 — added so the UI can honour wedge rule 3. `tradeTags`
        // is the trade_tags taxonomy the gate also matches on; `filteredOut`
        // is the exact number of the contractor's leads the gate is hiding
        // (null = not counted, which is NOT the same as zero).
        gatedTradeTags: tradeGate.tradeTags,
        tradeFilterApplied: tradeFilter,
        filteredOut,
        // Raw unscored-permit overlay. `rawPermitsTruncated` means the
        // response hit the per-request ceiling and the map is showing a
        // sample, not the full density — the UI must say so rather than let
        // the pin count read as the truth.
        rawPermitsIncluded: includePermits,
        rawPermitsShown,
        rawPermitsTruncated,
      },
    };

    return NextResponse.json(collection, {
      headers: { "Cache-Control": "private, max-age=60" },
    });
  } catch (err) {
    logger.error("Error fetching map leads", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Failed to fetch map data" },
      { status: 500 },
    );
  }
}

function emptyCollection(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}
