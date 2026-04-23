import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* ─── GET /api/financing — financing stats & recent deals for contractor ─── */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Verify contractor role */
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "contractor") {
      return NextResponse.json(
        { error: "Contractor access only" },
        { status: 403 }
      );
    }

    /* Fetch all quotes for this contractor.
     * Quotes store amount in one of three JSONB tier columns (tier_good,
     * tier_better, tier_best) keyed `{ label, total, line_items[] }`, with
     * `selected_tier` pointing at which one the homeowner picked. We compute
     * an effective `amount` below from selected_tier → tier_better → tier_good. */
    const { data: quotes, error: quotesError } = await supabase
      .from("quotes")
      .select(
        "id, contractor_id, homeowner_id, trade, zip, description, monthly_payment, financing_available, selected_tier, tier_good, tier_better, tier_best, status, created_at",
      )
      .eq("contractor_id", user.id)
      .order("created_at", { ascending: false });

    if (quotesError) {
      console.error("Financing quotes fetch error:", quotesError);
      return NextResponse.json(
        { error: "Failed to fetch financing data" },
        { status: 500 }
      );
    }

    /** Pull the effective dollar amount out of the quote's tier JSON. */
    function amountOf(q: Record<string, unknown>): number {
      const tier = q.selected_tier as "good" | "better" | "best" | null;
      const source =
        (tier === "good" ? q.tier_good
          : tier === "better" ? q.tier_better
          : tier === "best" ? q.tier_best
          : q.tier_better ?? q.tier_best ?? q.tier_good) as
          | { total?: number | string }
          | null
          | undefined;
      const raw = source?.total;
      const n = typeof raw === "number" ? raw : Number(raw);
      return Number.isFinite(n) ? n : 0;
    }

    // Preserve dynamic keys from the raw Supabase row (id, homeowner_id,
    // trade, status, created_at, etc.) so downstream filters and the
    // deals-projection can read them without TS narrowing the shape to
    // `{ amount: number }` only.
    type Quote = Record<string, unknown> & { amount: number };
    const allQuotes: Quote[] = (quotes ?? []).map((q: Record<string, unknown>) => ({
      ...q,
      amount: amountOf(q),
    }));

    /* Compute stats */
    const total_quotes = allQuotes.length;
    const quotesWithAmount = allQuotes.filter((q) => q.amount > 0);
    const acceptedAboveThreshold = allQuotes.filter(
      (q) => q.status === "accepted" && q.amount > 1000,
    );
    const declinedQuotes = allQuotes.filter((q) => q.status === "declined");

    const quotes_with_financing = acceptedAboveThreshold.length;

    const avg_ticket_size =
      quotesWithAmount.length > 0
        ? Math.round(
            quotesWithAmount.reduce((sum, q) => sum + q.amount, 0) /
              quotesWithAmount.length,
          )
        : 0;

    const avg_financed_ticket =
      acceptedAboveThreshold.length > 0
        ? Math.round(
            acceptedAboveThreshold.reduce((sum, q) => sum + q.amount, 0) /
              acceptedAboveThreshold.length,
          )
        : 0;

    const acceptedCount = acceptedAboveThreshold.length;
    const declinedCount = declinedQuotes.length;
    const approval_rate =
      acceptedCount + declinedCount > 0
        ? Math.round((acceptedCount / (acceptedCount + declinedCount)) * 100)
        : 0;

    /* Recent 20 quotes as deals */
    const deals = allQuotes.slice(0, 20).map((q) => ({
      id: q.id,
      homeowner_id: q.homeowner_id,
      trade: q.trade,
      zip: q.zip,
      description: q.description,
      amount: q.amount,
      status: q.status,
      created_at: q.created_at,
    }));

    return NextResponse.json({
      stats: {
        total_quotes,
        quotes_with_financing,
        avg_ticket_size,
        avg_financed_ticket,
        approval_rate,
      },
      deals,
    });
  } catch (err) {
    console.error("Financing GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── POST /api/financing — attach financing details to a quote ─── */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Verify contractor role */
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "contractor") {
      return NextResponse.json(
        { error: "Contractor access only" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const { quote_id, financing_partner, monthly_payment, term_months, apr } =
      body as {
        quote_id?: string;
        financing_partner?: "greensky" | "mosaic" | "service_finance";
        monthly_payment?: number;
        term_months?: number;
        apr?: number;
      };

    if (!quote_id || !financing_partner) {
      return NextResponse.json(
        { error: "quote_id and financing_partner are required" },
        { status: 400 }
      );
    }

    const validPartners = ["greensky", "mosaic", "service_finance"];
    if (!validPartners.includes(financing_partner)) {
      return NextResponse.json(
        { error: "Invalid financing_partner. Must be greensky, mosaic, or service_finance" },
        { status: 400 }
      );
    }

    /* Verify the quote belongs to this contractor */
    const { data: existingQuote, error: quoteErr } = await supabase
      .from("quotes")
      .select("id, scope_notes")
      .eq("id", quote_id)
      .eq("contractor_id", user.id)
      .single();

    if (quoteErr || !existingQuote) {
      return NextResponse.json(
        { error: "Quote not found" },
        { status: 404 }
      );
    }

    /* Build financing JSON to append to scope_notes */
    const financingDetails = JSON.stringify({
      financing_partner,
      monthly_payment: monthly_payment ?? null,
      term_months: term_months ?? null,
      apr: apr ?? null,
      attached_at: new Date().toISOString(),
    });

    const existingNotes = (existingQuote.scope_notes as string) ?? "";
    const updatedNotes = existingNotes
      ? `${existingNotes}\n---FINANCING---\n${financingDetails}`
      : `---FINANCING---\n${financingDetails}`;

    const { error: updateErr } = await supabase
      .from("quotes")
      .update({ scope_notes: updatedNotes })
      .eq("id", quote_id);

    if (updateErr) {
      console.error("Financing update error:", updateErr);
      return NextResponse.json(
        { error: "Failed to save financing details" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "Financing details saved",
    });
  } catch (err) {
    console.error("Financing POST error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
