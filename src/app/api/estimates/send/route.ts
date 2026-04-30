import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { logApiError } from "@/lib/log";
import { EstimateSendBodySchema, parseBody } from "@/lib/schemas/api";
import { requireContractor } from "@/lib/auth/requireContractor";

/**
 * POST /api/estimates/send
 * Body: { estimate_id: string, to_email?: string, message?: string }
 *
 * Sends an estimate to the homeowner. Uses Resend for the email (free
 * tier is 100 emails/day, 3k/mo). The estimate body is rendered inline
 * as plain HTML — a full PDF generator exists at src/lib/pdf.ts for
 * proposal docs but isn't wired yet; that's a follow-up.
 *
 * On success, the estimate row is updated:
 *   - status: 'sent'
 *   - delivered_at: now()
 *   - delivered_to_email: recipient
 *
 * Also appends a `[out] sent estimate $total to recipient` line to the
 * lead's notes so the activity shows in /dashboard/messages.
 */
export async function POST(req: NextRequest) {
  try {
    const raw = await req.json();
    const parsed = parseBody(EstimateSendBodySchema, raw);
    if (parsed.response) return parsed.response;
    const { estimate_id: estimateId, to_email: toEmail, message } = parsed.data;

    const supabase = await createClient();
    const gate = await requireContractor(supabase);
    if (gate.response) return gate.response;
    const user = gate.user;

    const { data: estimate, error: estErr } = await supabase
      .from("estimates")
      .select("*, leads (email, owner_name, address, notes)")
      .eq("id", estimateId)
      .eq("contractor_id", user.id)
      .single();
    if (estErr || !estimate) {
      return NextResponse.json(
        { error: "Estimate not found" },
        { status: 404 },
      );
    }

    const lead = estimate.leads as {
      email?: string | null;
      owner_name?: string | null;
      address?: string | null;
      notes?: string | null;
    } | null;
    const recipient = (toEmail ?? lead?.email ?? "").trim();
    if (!recipient) {
      return NextResponse.json(
        { error: "No recipient email. Provide `to_email` or set the lead's email." },
        { status: 400 },
      );
    }

    // Company context for the email signature.
    const { data: profile } = await supabase
      .from("profiles")
      .select("company_name, full_name, phone, email")
      .eq("id", user.id)
      .single();

    const amount = Number(estimate.amount ?? 0);
    const addr = lead?.address ?? "your property";
    const customerName = lead?.owner_name ?? "there";
    const companyName = profile?.company_name ?? profile?.full_name ?? "Your contractor";

    const html = [
      `<p>Hi ${escapeHtml(customerName)},</p>`,
      message ? `<p>${escapeHtml(message)}</p>` : "",
      `<p>Here's the estimate for the work at <strong>${escapeHtml(addr)}</strong>:</p>`,
      `<p style="font-size:24px;font-weight:600;color:#D4886A">$${amount.toLocaleString()}</p>`,
      estimate.description
        ? `<p><em>Scope:</em> ${escapeHtml(String(estimate.description))}</p>`
        : "",
      `<p>Let me know if you have any questions — happy to walk through it.</p>`,
      `<p>— ${escapeHtml(companyName)}${profile?.phone ? `<br/>${escapeHtml(profile.phone)}` : ""}${profile?.email ? `<br/>${escapeHtml(profile.email)}` : ""}</p>`,
    ].join("\n");

    // Email via Resend if configured; stubbed no-op otherwise.
    const resendKey = process.env.RESEND_API_KEY;
    const fromAddr = process.env.RESEND_FROM_EMAIL ?? "henri@meethenri.com";
    let emailSent = false;
    let providerError: string | null = null;
    if (resendKey) {
      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${resendKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: fromAddr,
            to: [recipient],
            subject: `Your estimate from ${companyName}`,
            html,
            reply_to: profile?.email ? [profile.email] : undefined,
          }),
        });
        emailSent = res.ok;
        if (!res.ok) providerError = await res.text().catch(() => "send failed");
      } catch (e) {
        providerError = (e as Error).message;
      }
    } else {
      providerError = "RESEND_API_KEY not configured";
    }

    // Mark the estimate delivered regardless of email success — the
    // contractor can still copy/paste the link or resend later.
    const now = new Date().toISOString();
    await supabase
      .from("estimates")
      .update({
        status: emailSent ? "sent" : estimate.status ?? "draft",
        delivered_at: emailSent ? now : null,
        delivered_to_email: recipient,
      })
      .eq("id", estimateId);

    // Append a line to the lead notes for the activity log.
    if (estimate.lead_id) {
      const existingNotes = lead?.notes ?? "";
      const entry = `[out ${now.slice(0, 10)}] Sent estimate $${amount.toLocaleString()} to ${recipient}`;
      const joined = existingNotes ? `${existingNotes}\n${entry}` : entry;
      await supabase
        .from("leads")
        .update({ notes: joined })
        .eq("id", estimate.lead_id);
    }

    return NextResponse.json({
      ok: emailSent,
      recipient,
      provider_configured: !!resendKey,
      provider_error: providerError,
    });
  } catch (error) {
    logApiError("estimates.send", error);
    return NextResponse.json(
      { error: "Failed to send estimate" },
      { status: 500 },
    );
  }
}

function escapeHtml(v: unknown): string {
  return String(v ?? "").replace(/[&<>"']/g, (c) =>
    c === "&" ? "&amp;" :
    c === "<" ? "&lt;" :
    c === ">" ? "&gt;" :
    c === '"' ? "&quot;" : "&#39;",
  );
}
