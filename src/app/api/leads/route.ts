import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { requireContractor } from "@/lib/auth/requireContractor";
import { fetchAllTerritoryZips } from "@/lib/territories/fetch-all";

export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const { user } = gate;

    const { searchParams } = new URL(request.url);
    const urgency = searchParams.get("urgency");
    const trade = searchParams.get("trade");
    const zip = searchParams.get("zip");
    const parsedPage = parseInt(searchParams.get("page") ?? "1", 10);
    const parsedLimit = parseInt(searchParams.get("limit") ?? "20", 10);
    const page = Math.max(
      1,
      Math.min(Number.isFinite(parsedPage) ? parsedPage : 1, 10000)
    );
    const limit = Math.max(
      1,
      Math.min(Number.isFinite(parsedLimit) ? parsedLimit : 20, 100)
    );
    const offset = (page - 1) * limit;

    // Get user's territories to scope leads (paginated — PostgREST caps
    // unbounded selects at 1000 rows; founder has 5,601 claimed ZIPs).
    const userZips = await fetchAllTerritoryZips(supabase, user.id);

    if (userZips.length === 0) {
      return NextResponse.json({ leads: [], total: 0 });
    }

    // Build query: leads joined with permits.
    // Previously included `.in("permits.zip", userZips)` as a belt-and-
    // suspenders filter, but that IN clause with 5,601 ZIPs (founder
    // god-mode) blew past Postgres/PostgREST URL limits and returned 500.
    // It was also redundant: the scorer only inserts leads whose permit
    // falls in the contractor's territory set, and `contractor_id=user.id`
    // below scopes reads to that same ownership. Dropping the extra IN.
    let query = supabase
      .from("leads")
      .select(
        `
        id,
        score,
        urgency,
        status,
        created_at,
        permits (
          id,
          address,
          city,
          state,
          zip,
          permit_type,
          estimated_value,
          applied_date,
          issued_date,
          description,
          latitude,
          longitude
        )
      `,
        // Estimated count — exact count scans the full row set and
        // times out on god-mode owner's 131k+ leads. pg_class stats are
        // close enough for pagination + the "X of Y" UI hint.
        { count: "estimated" }
      )
      .eq("contractor_id", user.id)
      .order("score", { ascending: false })
      .range(offset, offset + limit - 1);

    // Apply filters
    if (urgency) {
      query = query.eq("urgency", urgency);
    }

    if (trade) {
      query = query.eq("permits.permit_type", trade);
    }

    if (zip) {
      query = query.eq("permits.zip", zip);
    }

    const { data: leads, error, count } = await query;

    if (error) {
      throw new Error(error.message);
    }

    // Flatten the permit data into lead objects
    const flatLeads = (leads ?? []).map((lead: Record<string, unknown>) => {
      const permit = lead.permits as Record<string, unknown> | null;
      return {
        id: lead.id,
        address: permit?.address ?? "",
        city: permit?.city ?? "",
        state: permit?.state ?? "",
        zip: permit?.zip ?? "",
        permit_type: permit?.permit_type ?? "",
        value: permit?.estimated_value ?? 0,
        date: permit?.issued_date ?? permit?.applied_date ?? lead.created_at,
        score: lead.score ?? 0,
        urgency: lead.urgency ?? "cold",
        status: lead.status ?? "new",
      };
    });

    return NextResponse.json(
      { leads: flatLeads, total: count ?? 0 },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (err) {
    console.error("leads.get failed", {
      message: err instanceof Error ? err.message : "unknown",
    });
    return NextResponse.json(
      { error: "Failed to fetch leads" },
      { status: 500 }
    );
  }
}
