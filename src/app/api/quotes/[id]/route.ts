import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/* ─── GET /api/quotes/[id] — single quote detail ─── */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Fetch the quote — user must be either the homeowner or the contractor */
    const { data: quote, error } = await supabase
      .from("quotes")
      .select("id, contractor_id, homeowner_id, trade, zip, description, amount, status, tier_good, tier_better, tier_best, selected_tier, message, financing_available, viewed_at, sent_at, accepted_at, declined_at, decline_reason, scope_notes, created_at, updated_at")
      .eq("id", id)
      .single();

    if (error || !quote) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    if (quote.homeowner_id !== user.id && quote.contractor_id !== user.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    /* Update viewed_at when the homeowner first views the quote */
    if (
      quote.homeowner_id === user.id &&
      !quote.viewed_at &&
      quote.status === "sent"
    ) {
      await supabase
        .from("quotes")
        .update({ viewed_at: new Date().toISOString() })
        .eq("id", id);

      quote.viewed_at = new Date().toISOString();
    }

    return NextResponse.json({ quote });
  } catch (err) {
    console.error("Quote GET error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ─── PATCH /api/quotes/[id] — update quote ─── */
/*
 * Contractor can: set tier_good/tier_better/tier_best, status='sent',
 *   message, financing_available
 * Homeowner can: set status='accepted'|'declined', selected_tier,
 *   decline_reason
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    /* Fetch the existing quote */
    const { data: existing, error: fetchErr } = await supabase
      .from("quotes")
      .select("id, contractor_id, homeowner_id, status")
      .eq("id", id)
      .single();

    if (fetchErr || !existing) {
      return NextResponse.json({ error: "Quote not found" }, { status: 404 });
    }

    const isContractor = existing.contractor_id === user.id;
    const isHomeowner = existing.homeowner_id === user.id;

    if (!isContractor && !isHomeowner) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const body = await req.json();
    const updates: Record<string, unknown> = {};

    if (isContractor) {
      /* Contractor-allowed fields */
      const contractorFields = [
        "tier_good",
        "tier_better",
        "tier_best",
        "status",
        "message",
        "financing_available",
      ];

      for (const key of contractorFields) {
        if (key in body) {
          /* Only allow contractors to set status to 'sent' */
          if (key === "status" && body[key] !== "sent") {
            return NextResponse.json(
              { error: "Contractors can only set status to 'sent'" },
              { status: 400 }
            );
          }
          updates[key] = body[key];
        }
      }

      if (updates.status === "sent") {
        updates.sent_at = new Date().toISOString();
      }
    }

    if (isHomeowner) {
      /* Homeowner-allowed fields */
      const homeownerFields = [
        "status",
        "selected_tier",
        "decline_reason",
      ];

      for (const key of homeownerFields) {
        if (key in body) {
          /* Only allow homeowners to set status to 'accepted' or 'declined' */
          if (
            key === "status" &&
            body[key] !== "accepted" &&
            body[key] !== "declined"
          ) {
            return NextResponse.json(
              {
                error:
                  "Homeowners can only set status to 'accepted' or 'declined'",
              },
              { status: 400 }
            );
          }
          updates[key] = body[key];
        }
      }

      if (updates.status === "accepted") {
        updates.accepted_at = new Date().toISOString();
      }
      if (updates.status === "declined") {
        updates.declined_at = new Date().toISOString();
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    updates.updated_at = new Date().toISOString();

    const { data: updated, error: updateErr } = await supabase
      .from("quotes")
      .update(updates)
      .eq("id", id)
      .select()
      .single();

    if (updateErr) {
      console.error("Quote update error:", updateErr);
      return NextResponse.json(
        { error: "Failed to update quote" },
        { status: 500 }
      );
    }

    /* Notify the other party on status change */
    if (updates.status) {
      const notifyUserId = isContractor
        ? existing.homeowner_id
        : existing.contractor_id;

      const statusLabels: Record<string, string> = {
        sent: "You received a new quote",
        accepted: "Your quote was accepted",
        declined: "Your quote was declined",
      };

      const title = statusLabels[updates.status as string] ?? "Quote updated";

      await supabase.from("notifications").insert({
        user_id: notifyUserId,
        type: "quote_update",
        title,
        body: `Quote #${id.slice(0, 8)} status changed to ${updates.status}.`,
        read: false,
        metadata: { quote_id: id, status: updates.status },
      });
    }

    return NextResponse.json({ quote: updated });
  } catch (err) {
    console.error("Quote PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
