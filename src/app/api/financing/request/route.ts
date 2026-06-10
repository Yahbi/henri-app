import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { FinancingRequestBodySchema, parseBody } from "@/lib/schemas/api";
import { requireContractor } from "@/lib/auth/requireContractor";

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
    // Auth before parse (2026-06-10): anonymous probes must not receive
    // schema-shaped validation errors.
    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const raw = await req.json().catch(() => null);
    const parsed = parseBody(FinancingRequestBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { lead_id: leadId, partner, partner_url: partnerUrl } = parsed.data;

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
      partner_url: partnerUrl ?? null,
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
    const fromAddr = process.env.RESEND_FROM_EMAIL ?? "henri@meethenri.com";
    let emailed = false;
    if (resendKey && lead.email && partnerUrl) {
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
            html: `<p>Hi,</p><p>Following up on our discussion, here's the link to apply for financing through ${escapePartnerName(partner)}:</p><p><a href="${escapeAttr(partnerUrl)}">${escapeAttr(partnerUrl)}</a></p><p>Let us know if you have any questions.</p>`,
            /* 2026-04-30 canonical email policy: route homeowner replies
             * about financing to support@meethenri.com — the monitored
             * inbox — instead of bouncing off henri@ unmonitored. */
            reply_to: ["support@meethenri.com"],
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

/* ─── HTML escapers ───
 * Audit S3 fix (2026-04-27): the partner name and partner_url were
 * previously interpolated raw into outbound HTML email — a contractor
 * could craft a partner string like `</a><script>...` and pwn the
 * homeowner's mail client. The Zod schema already enforces http(s)
 * on partner_url, but we still escape both to be safe.
 */
function escapePartnerName(v: string): string {
  return String(v).replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;",
  );
}

function escapeAttr(v: string): string {
  // For href values: encode the entire URL so JS-injection chars are
  // neutralized. Combined with the http(s) check in the schema this
  // stops javascript: / data: URI routes.
  return encodeURI(String(v)).replace(/"/g, "%22");
}
