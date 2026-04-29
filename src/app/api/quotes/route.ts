import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { QuoteRequestBodySchema, parseBody } from "@/lib/schemas/api";
import { logger } from "@/lib/logger";

/* ─── GET /api/quotes — list quotes for authenticated user ─── */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Determine user role */
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    const role = profile?.role ?? "homeowner";
    const limit = Number(request.nextUrl.searchParams.get("limit")) || 20;
    const status = request.nextUrl.searchParams.get("status");

    /* Contractors see quotes sent to them; homeowners see quotes they requested */
    const filterColumn =
      role === "contractor" ? "contractor_id" : "homeowner_id";

    let query = supabase
      .from("quotes")
      .select("*", { count: "exact" })
      .eq(filterColumn, user.id)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (status) {
      query = query.eq("status", status);
    }

    const { data: quotes, error, count } = await query;

    if (error) {
      logger.error("Quotes fetch error", { error: error instanceof Error ? error.message : String(error) });
      return NextResponse.json(
        { error: "Failed to fetch quotes" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      quotes: quotes ?? [],
      total: count ?? 0,
    });
  } catch (err) {
    logger.error("Quotes GET error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── POST /api/quotes — homeowner requests a quote from a contractor ─── */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const raw = await req.json();
    const parsed = parseBody(QuoteRequestBodySchema, raw);
    if (parsed.response) return parsed.response;
    const {
      contractor_id,
      trade,
      zip,
      description,
      scope_notes,
      contact_name,
      contact_email,
      contact_phone,
    } = parsed.data;

    /* Verify the contractor exists and is active */
    const { data: contractor, error: cErr } = await supabase
      .from("profiles")
      .select("id, company_name, full_name")
      .eq("id", contractor_id)
      .eq("role", "contractor")
      .eq("onboarding_completed", true)
      .single();

    if (cErr || !contractor) {
      return NextResponse.json(
        { error: "Contractor not found" },
        { status: 404 }
      );
    }

    /* Create or find an existing homeowner intake */
    const { data: existingIntake } = await supabase
      .from("homeowner_intakes")
      .select("id")
      .eq("contact_email", contact_email ?? user.email)
      .eq("zip", zip)
      .eq("trade", trade)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    let intakeId = existingIntake?.id ?? null;

    if (!intakeId) {
      const { data: newIntake, error: intakeErr } = await supabase
        .from("homeowner_intakes")
        .insert({
          zip,
          trade,
          description,
          contact_name: contact_name ?? null,
          contact_email: contact_email ?? user.email ?? null,
          contact_phone: contact_phone ?? null,
          matched_contractor_id: contractor_id,
          status: "matched",
        })
        .select("id")
        .single();

      if (intakeErr) {
        logger.error("Intake insert error", { error: intakeErr instanceof Error ? intakeErr.message : String(intakeErr) });
      } else {
        intakeId = newIntake?.id ?? null;
      }
    }

    /* Create the quote record */
    const { data: quote, error: quoteErr } = await supabase
      .from("quotes")
      .insert({
        homeowner_id: user.id,
        contractor_id,
        intake_id: intakeId,
        trade,
        zip,
        description,
        scope_notes: scope_notes ?? null,
        contact_name: contact_name ?? null,
        contact_email: contact_email ?? user.email ?? null,
        contact_phone: contact_phone ?? null,
        status: "requested",
      })
      .select()
      .single();

    if (quoteErr) {
      logger.error("Quote insert error", { error: quoteErr instanceof Error ? quoteErr.message : String(quoteErr) });
      return NextResponse.json(
        { error: "Failed to create quote request" },
        { status: 500 }
      );
    }

    /* Notify the contractor in-app */
    await supabase.from("notifications").insert({
      user_id: contractor_id,
      type: "quote_request",
      title: "New quote request",
      body: `A homeowner in ZIP ${zip} is requesting a quote for ${trade} work.`,
      read: false,
      metadata: { quote_id: quote.id },
    });

    return NextResponse.json(
      { success: true, quote },
      { status: 201 }
    );
  } catch (err) {
    logger.error("Quotes POST error", { error: err instanceof Error ? err.message : String(err) });
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
