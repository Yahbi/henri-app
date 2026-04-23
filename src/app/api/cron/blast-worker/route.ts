import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logApiError } from "@/lib/log";

/**
 * Blast campaign worker.
 *
 * Picks up queued blast_campaigns rows and fans them out to
 * target_lead_ids via SMS (Twilio) or email (Resend). Writes one
 * blast_events row per recipient with delivery status. Marks the
 * campaign `status='sent'` when done.
 *
 * Gated by CRON_SECRET like the other crons. Schedule every 5 min
 * (cron pattern `asterisk-slash-5 asterisk asterisk asterisk asterisk`
 * in vercel.json — kept out of the JSDoc literally so it doesn't
 * terminate the comment).
 *
 * Uses the admin client so RLS doesn't block cross-user writes —
 * authentication comes from the bearer token.
 */
export const runtime = "nodejs";
export const maxDuration = 300;

interface BlastCampaign {
  id: string;
  contractor_id: string;
  channel: "sms" | "email";
  subject: string | null;
  body: string;
  target_lead_ids: string[] | null;
  status: string;
}

interface Lead {
  id: string;
  phone: string | null;
  email: string | null;
  owner_first: string | null;
  address: string | null;
}

export async function GET(request: NextRequest) {
  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const t0 = Date.now();

  // Scan for queued campaigns — IDs only, then claim atomically below.
  const { data: queued, error: scanError } = await supabase
    .from("blast_campaigns")
    .select("id")
    .eq("status", "queued")
    .order("created_at", { ascending: true })
    .limit(5);

  if (scanError) {
    if (scanError.code === "42P01") {
      return NextResponse.json(
        { skipped: true, reason: "blast_campaigns table not migrated" },
        { status: 200 },
      );
    }
    logApiError("cron.blast-worker.scan", scanError);
    return NextResponse.json({ error: scanError.message }, { status: 500 });
  }

  const results: Array<{ campaign_id: string; sent: number; failed: number }> = [];

  for (const { id: campaignId } of (queued ?? []) as { id: string }[]) {
    // Atomically claim the campaign: only succeeds if still 'queued'.
    // Two overlapping cron runs will race on this UPDATE; only one wins per row.
    const { data: claimed, error: claimError } = await supabase
      .from("blast_campaigns")
      .update({ status: "processing" })
      .eq("id", campaignId)
      .eq("status", "queued")
      .select("id, contractor_id, channel, subject, body, target_lead_ids, status")
      .maybeSingle();

    if (claimError || !claimed) continue; // another worker claimed it

    const c = claimed as BlastCampaign;
    const leadIds = c.target_lead_ids ?? [];
    if (leadIds.length === 0) {
      await supabase.from("blast_campaigns").update({ status: "sent" }).eq("id", campaignId);
      results.push({ campaign_id: campaignId, sent: 0, failed: 0 });
      continue;
    }

    // Fetch the target leads in one shot (capped at 1000 — the PostgREST
    // limit; larger campaigns will need an extra pagination loop).
    const { data: leads } = await supabase
      .from("leads")
      .select("id, phone, email, owner_first, address")
      .in("id", leadIds.slice(0, 1000));
    const leadsArr = (leads ?? []) as Lead[];

    let sent = 0;
    let failed = 0;
    for (const lead of leadsArr) {
      const ok = await deliverOne(c, lead);
      if (ok) sent++;
      else failed++;
      await supabase.from("blast_events").insert({
        campaign_id: c.id,
        lead_id: lead.id,
        delivered: ok,
        sent_at: new Date().toISOString(),
      }).throwOnError().then(
        () => {},
        () => {/* events table may not exist yet */ },
      );
      if (Date.now() - t0 > 260_000) break;
    }

    await supabase
      .from("blast_campaigns")
      .update({
        status: "sent",
        sent_count: sent,
        failed_count: failed,
        sent_at: new Date().toISOString(),
      })
      .eq("id", campaignId);
    results.push({ campaign_id: campaignId, sent, failed });

    if (Date.now() - t0 > 280_000) break;
  }

  return NextResponse.json({
    ok: true,
    elapsedMs: Date.now() - t0,
    campaigns_processed: results.length,
    results,
  });
}

async function deliverOne(c: BlastCampaign, lead: Lead): Promise<boolean> {
  const firstName = lead.owner_first?.trim() || "there";
  const personalized = c.body.replace(/\{first_name\}/gi, firstName);

  if (c.channel === "sms") {
    if (!lead.phone) return false;
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    if (!sid || !token || !from) return false;
    try {
      const auth = Buffer.from(`${sid}:${token}`).toString("base64");
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
        {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            From: from,
            To: String(lead.phone),
            Body: personalized,
          }).toString(),
        },
      );
      return res.ok;
    } catch {
      return false;
    }
  }

  // email
  if (!lead.email) return false;
  const resendKey = process.env.RESEND_API_KEY;
  const fromAddr = process.env.RESEND_FROM_EMAIL ?? "henri@henri.app";
  if (!resendKey) return false;
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
        subject: c.subject ?? "A quick note from your contractor",
        text: personalized,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
