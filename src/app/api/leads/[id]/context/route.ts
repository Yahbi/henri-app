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

interface ContextResponse {
  derived: DerivedEnrichments;
  adjacent_count_90d: number;
  storm: StormProximity | null;
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
          "permit_type, permit_description, trade, permit_filed_date",
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

    const body: ContextResponse = {
      derived,
      adjacent_count_90d,
      storm,
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
