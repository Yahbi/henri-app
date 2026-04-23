import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";

/**
 * POST /api/financing/request
 * Body: { lead_id: string, partner: string, partner_url?: string }
 *
 * Logs a homeowner-facing financing request. Records an entry in
 * `financing_requests` table so the contractor can see which leads
 * have been referred to which partners, and (when an email integration
 * is configured) fires a notification email to the homeowner with the
 * partner's intake-form URL.
 *
 * This is a "collect intent" endpoint — the contractor is essentially
 * saying "send this homeowner to X partner's financing flow." Real
 * financing partnerships can layer on top later (API handshakes,
 * approval callbacks, etc.).
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      lead_id?: string;
      partner?: string;
      partner_url?: string;
    };
    const leadId = (body.lead_id ?? "").trim();
    const partner = (body.partner ?? "").trim();
    if (!leadId || !partner) {
      return NextResponse.json(
        { error: "lead_id and partner required" },
        { status: 400 },
      );
    }

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Verify the lead belongs to this contractor before logging anything.
    const { data: lead } = await supabase
      .from("leads")
      .select("id, email, owner_name, address")
      .eq("id", leadId)
      .eq("contractor_id", user.id)
      .single();
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Log the request. If the table doesn't exist yet, surface 501 so
    // the UI can explain the migration is pending rather than 500ing.
    const { error } = await supabase.from("financing_requests").insert({
      contractor_id: user.id,
      lead_id: leadId,
      partner,
      partner_url: body.partner_url ?? null,
      homeowner_email: lead.email,
      status: "sent_intent",
      created_at: new Date().toISOString(),
    });
    if (error) {
      if (error.code === "42P01") {
        return NextResponse.json(
          {
            error: "financing_requests table not yet migrated",
            hint: "Run migration 00027_financing_requests.sql",
          },
          { status: 501 },
        );
      }
      throw error;
    }

    // Email the homeowner the partner URL if we have their email.
    // Uses the Resend API when RESEND_API_KEY is configured; silent no-op
    // otherwise (logged request still counts as contractor intent).
    const resendKey = process.env.RESEND_API_KEY;
    const fromAddr = process.env.RESEND_FROM_EMAIL ?? "henri@henri.app";
    let emailed = false;
    if (resendKey && lead.email && body.partner_url) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [lead.email],
            subject: `Financing options from ${partner}`,
            html: `<p>Hi,</p><p>Following up on our discussion, here's the link to apply for financing through ${partner}:</p><p><a href="${body.partner_url}">${body.partner_url}</a></p><p>Let us know if you have any questions.</p>`,
          }),
        });
        emailed = res.ok;
      } catch {
        emailed = false;
      }
    }

    return NextResponse.json({ ok: true, emailed });
  } catch (error) {
    logApiError("financing.request", error);
    return NextResponse.json(
      { error: "Failed to log financing request" },
      { status: 500 },
    );
  }
}
