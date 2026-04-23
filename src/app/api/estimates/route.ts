import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { sendEstimateEmail } from "@/lib/resend/estimate-email";
import { hasResend } from "@/lib/env";
import { logApiError } from "@/lib/log";

/* ─── GET /api/estimates — list estimates for authenticated contractor ─── */
export async function GET(request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const status = request.nextUrl.searchParams.get("status");

    // Quotes store tiers in three individual JSONB columns (tier_good,
    // tier_better, tier_best), not a single `tiers` column. Treat any quote
    // that has at least one tier populated as an estimate.
    let query = supabase
      .from("quotes")
      .select("*", { count: "exact" })
      .eq("contractor_id", user.id)
      .or("tier_good.not.is.null,tier_better.not.is.null,tier_best.not.is.null")
      .order("created_at", { ascending: false })
      .limit(50);

    if (status) {
      query = query.eq("status", status);
    }

    const { data: estimates, error, count } = await query;

    if (error) {
      logApiError("estimates.fetch", error);
      return NextResponse.json(
        { error: "Failed to fetch estimates" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      estimates: estimates ?? [],
      total: count ?? 0,
    });
  } catch (err) {
    logApiError("estimates.get", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── POST /api/estimates — contractor creates a new estimate ─── */
export async function POST(req: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Verify the user is a contractor */
    const { data: profile } = await supabase
      .from("profiles")
      .select("role")
      .eq("id", user.id)
      .single();

    if (profile?.role !== "contractor") {
      return NextResponse.json(
        { error: "Only contractors can create estimates" },
        { status: 403 }
      );
    }

    const body = await req.json();
    const {
      contact_name,
      contact_email,
      contact_phone,
      trade,
      zip,
      description,
      scope_notes,
      tiers,
      amount,
      status,
    } = body as {
      contact_name?: string;
      contact_email?: string;
      contact_phone?: string;
      trade: string;
      zip: string;
      description?: string;
      scope_notes?: string;
      tiers: Record<string, unknown>;
      amount: number;
      status: "draft" | "sent";
    };

    if (!trade || !zip || !tiers || amount == null) {
      return NextResponse.json(
        { error: "trade, zip, tiers, and amount are required" },
        { status: 400 }
      );
    }

    if (status && status !== "draft" && status !== "sent") {
      return NextResponse.json(
        { error: "Status must be 'draft' or 'sent'" },
        { status: 400 }
      );
    }

    const estimateStatus = status ?? "draft";

    /* Send estimate email via Resend when status is "sent" and email provided */
    let emailSent = false;
    if (estimateStatus === "sent" && contact_email && hasResend()) {
      const result = await sendEstimateEmail({
        contactName: contact_name ?? "Homeowner",
        contactEmail: contact_email,
        trade: trade ?? "General",
        zip: zip ?? "",
        description: description ?? undefined,
        amount: amount ?? 0,
        scopeNotes: scope_notes ?? undefined,
        estimateId: "pending", // Will update after insert
      });
      emailSent = result.success;
    }

    const { data: estimate, error: insertErr } = await supabase
      .from("quotes")
      .insert({
        contractor_id: user.id,
        homeowner_id: null,
        intake_id: null,
        trade,
        zip,
        description: description ?? null,
        scope_notes: scope_notes ?? null,
        tiers,
        amount,
        contact_name: contact_name ?? null,
        contact_email: contact_email ?? null,
        contact_phone: contact_phone ?? null,
        status: estimateStatus,
      })
      .select()
      .single();

    if (insertErr) {
      logApiError("estimates.insert", insertErr);
      return NextResponse.json(
        { error: "Failed to create estimate" },
        { status: 500 }
      );
    }

    return NextResponse.json({ estimate }, { status: 201 });
  } catch (err) {
    logApiError("estimates.post", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
