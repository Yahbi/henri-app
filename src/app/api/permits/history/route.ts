import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { logApiError } from "@/lib/log";

/**
 * GET /api/permits/history?address=...&zip=...
 *
 * Returns every permit on file for the given property address, newest
 * first. Used by the lead-detail drawer to show full permit history —
 * not just the currently-live lead. Contractor can see whether this
 * is a one-off project or a property with a long remodel timeline.
 *
 * Match strategy:
 *   - Normalize the input address (strip punctuation, collapse spaces)
 *   - ilike-prefix match on the first 40 chars against permits.address
 *     (handles "123 Main St" vs "123 MAIN STREET" vs "123 Main St.")
 *   - Filter by zip when provided — cheap narrowing via the
 *     idx_permits_zip index
 *
 * Auth: contractor-gated. Same gate as /api/leads — matches the rest
 * of the dashboard surface and keeps homeowner users out.
 */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;

    const { searchParams } = new URL(request.url);
    const address = searchParams.get("address") ?? "";
    const zip = searchParams.get("zip") ?? "";
    const excludeId = searchParams.get("excludeId") ?? "";

    if (!address.trim()) {
      return NextResponse.json({ permits: [] });
    }

    // Match strategy: truncate the input at the first comma (so we
    // match on just the street-level address, not the full
    // "STREET, CITY, ST ZIP" tail), then `ilike '<street>%'` against
    // permits.address. Permits in our DB usually store the full tail
    // ("642 PARK ST, HARTFORD, CT 06106"), so a street-level prefix
    // lines up with all variations at that property (the "APT 2" /
    // "STE B" / unit suffix cases) via the trailing `%`.
    //
    // Don't over-normalize: case-insensitive ilike handles the
    // casing, but stripping commas from the input creates a prefix
    // that *can never* match the stored rows (tripped this up during
    // smoke test — prefix "642 park st hartford ct 06106" vs stored
    // "642 PARK ST, HARTFORD, CT 06106"). Keep it simple.
    const streetOnly = address.split(",")[0].trim();
    if (!streetOnly) {
      return NextResponse.json({ permits: [] });
    }
    // Query strategy — two paths depending on whether we have a ZIP:
    //
    //   ZIP path (preferred): narrow via `idx_permits_zip` to ~hundreds
    //   of rows at that ZIP, then filter by street prefix in-memory.
    //   Fast + reliable on a 925k-row table without needing a
    //   text_pattern_ops index on address.
    //
    //   No-ZIP path: fall back to server-side ilike with a 2s statement
    //   timeout hint. If the planner can't satisfy it under load, we
    //   return whatever we got — no hung UI.
    //
    // Either path honours excludeId + caps at 50 rows.
    const selectCols =
      "id, permit_number, permit_type, status, description, applied_date, issued_date, completed_date, estimated_value, address, city, state, zip";

    let rows: Array<Record<string, unknown>> = [];
    if (zip) {
      // zip-indexed lookup: ilike pushes filtering to the DB while the
      // zip equality stays index-scoped (idx_permits_zip). Skip ORDER BY
      // on the DB — we sort the (≤50-row) result set in memory, which
      // avoids the planner's most expensive fallback path on
      // address+date scans.
      let q = supabase
        .from("permits")
        .select(selectCols)
        .eq("zip", zip.slice(0, 5))
        .ilike("address", `${streetOnly}%`)
        .limit(50);
      if (excludeId) q = q.neq("id", excludeId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      rows = data ?? [];
    } else {
      // No zip: pure address prefix. Without the zip index this is a
      // seq scan on a 925k-row table. Cap at a very small limit and
      // rely on the statement_timeout safety net in Supabase.
      let q = supabase
        .from("permits")
        .select(selectCols)
        .ilike("address", `${streetOnly}%`)
        .limit(25);
      if (excludeId) q = q.neq("id", excludeId);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      rows = data ?? [];
    }

    // Sort in-memory so the newest permit is first. DB-side sort can
    // trigger a slow index path on large tables; doing it here on ≤50
    // rows is free.
    rows.sort((a, b) => {
      const ad = String(a.issued_date ?? a.applied_date ?? "");
      const bd = String(b.issued_date ?? b.applied_date ?? "");
      return bd.localeCompare(ad);
    });
    return NextResponse.json(
      { permits: rows },
      {
        headers: {
          // Short cache: 30s is enough to dedupe rapid re-opens of the
          // same lead but short enough that a freshly-ingested permit
          // shows up in the drawer without a forced refresh.
          "Cache-Control": "private, max-age=30",
        },
      },
    );
  } catch (err) {
    logApiError("permits.history", err);
    return NextResponse.json(
      { error: "Failed to fetch permit history" },
      { status: 500 },
    );
  }
}
