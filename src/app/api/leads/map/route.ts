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
    const tradeFilter = searchParams.get("trade");
    const statusFilter = searchParams.get("status");
    const daysBack = parseInt(searchParams.get("days") ?? "90", 10);
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

    if (userZips.length === 0) {
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
      if (tradeFilter) pageQuery = pageQuery.eq("trade", tradeFilter);
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
        },
      });
    }

    /* ── Also fetch raw permits in territory (not yet scored) ─────────── */
    const includePermits = searchParams.get("include_permits") === "1";

    if (includePermits) {
      let permitQuery = supabase
        .from("permits")
        .select("id, address, city, state, zip, permit_type, estimated_value, description, latitude, longitude, created_at, source_type")
        .in("zip", userZips)
        .is("scored_at", null)
        .limit(10000);
      if (!allTime) {
        permitQuery = permitQuery.gte("created_at", sinceDate.toISOString());
      }

      if (tradeFilter) {
        permitQuery = permitQuery.ilike("description", `%${tradeFilter}%`);
      }

      const { data: rawPermits } = await permitQuery;

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

    const collection: GeoJSON.FeatureCollection = {
      type: "FeatureCollection",
      features,
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
