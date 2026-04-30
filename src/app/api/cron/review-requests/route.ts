import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/* -------------------------------------------------------------------------- */
/*  Review Requests Cron                                                      */
/*  Runs daily. Finds "won" leads 7-14 days old and sends review requests.   */
/* -------------------------------------------------------------------------- */

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  try {
    /* ── Date window: won 7-14 days ago ── */
    const now = new Date();
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    /* ── Find qualifying leads ── */
    const { data: wonLeads, error: leadsErr } = await supabase
      .from("leads")
      .select(
        "id, contractor_id, owner_name, owner_first, email, email2, phone, phone2, trade, zip"
      )
      .eq("status", "won")
      .gte("won_at", fourteenDaysAgo.toISOString())
      .lte("won_at", sevenDaysAgo.toISOString());

    if (leadsErr) {
      logger.error("Failed to query won leads", { error: String(leadsErr) });
      return NextResponse.json(
        { error: "Failed to query leads" },
        { status: 500 }
      );
    }

    if (!wonLeads || wonLeads.length === 0) {
      return NextResponse.json({
        success: true,
        sent: 0,
        skipped: 0,
        errors: 0,
        message: "No qualifying leads found",
      });
    }

    /* ── Check which leads already have a review request ── */
    const leadIds = wonLeads.map((l) => l.id);
    const { data: existingRequests } = await supabase
      .from("review_requests")
      .select("lead_id")
      .in("lead_id", leadIds);

    const alreadyRequested = new Set(
      (existingRequests ?? []).map((r) => r.lead_id)
    );

    /* ── Process each lead ── */
    for (const lead of wonLeads) {
      try {
        /* Skip if already requested */
        if (alreadyRequested.has(lead.id)) {
          skipped++;
          continue;
        }

        const customerEmail = lead.email || lead.email2;
        const customerPhone = lead.phone || lead.phone2;
        const customerName =
          lead.owner_first || lead.owner_name || "Homeowner";

        /* Skip if no contact info */
        if (!customerEmail && !customerPhone) {
          skipped++;
          continue;
        }

        /* Fetch contractor profile for branding */
        const { data: profile } = await supabase
          .from("profiles")
          .select("company_name, full_name")
          .eq("id", lead.contractor_id)
          .single();

        if (!profile) {
          skipped++;
          continue;
        }

        const senderName =
          profile.company_name ?? profile.full_name ?? "Your contractor";

        /* Generate token and create request */
        const token = crypto.randomUUID();
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + 30);

        const { data: reviewRequest, error: insertErr } = await supabase
          .from("review_requests")
          .insert({
            contractor_id: lead.contractor_id,
            lead_id: lead.id,
            customer_name: customerName,
            customer_email: customerEmail ?? null,
            customer_phone: customerPhone ?? null,
            channel: customerEmail ? "email" : "sms",
            token,
            status: "pending",
            expires_at: expiresAt.toISOString(),
          })
          .select()
          .single();

        if (insertErr || !reviewRequest) {
          logger.error("Review request insert error", { error: String(insertErr) });
          errors++;
          continue;
        }

        const appUrl =
          process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com";
        const reviewLink = `${appUrl}/review/${token}`;

        let emailSent = false;
        let smsSent = false;

        /* ── Send email via Resend ── */
        if (customerEmail) {
          try {
            const resendKey = process.env.RESEND_API_KEY;
            if (resendKey) {
              const response = await fetch("https://api.resend.com/emails", {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${resendKey}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  /* 2026-04-30 canonical email policy: customer-facing
                   * sends use support@meethenri.com so replies land in
                   * the monitored inbox. Pre-04-30 used noreply@ which
                   * dropped customer responses on the floor. */
                  from: "Henri <support@meethenri.com>",
                  to: [customerEmail],
                  reply_to: ["support@meethenri.com"],
                  subject: `How was your experience with ${senderName}?`,
                  html: buildReviewEmailHtml({
                    customerName,
                    senderName,
                    reviewLink,
                  }),
                }),
              });
              emailSent = response.ok;
            }
          } catch (emailErr) {
            logger.error("Email send failed for lead", { leadId: lead.id, error: String(emailErr) });
          }
        }

        /* ── Send SMS via Twilio (in addition to email if phone available) ── */
        if (customerPhone) {
          try {
            const twilioSid = process.env.TWILIO_ACCOUNT_SID;
            const twilioToken = process.env.TWILIO_AUTH_TOKEN;
            const twilioFrom = process.env.TWILIO_PHONE_NUMBER;

            if (twilioSid && twilioToken && twilioFrom) {
              const smsBody = `Hi ${customerName}, ${senderName} would love to hear about your recent experience. Leave a quick review: ${reviewLink}`;

              const response = await fetch(
                `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
                {
                  method: "POST",
                  headers: {
                    Authorization:
                      "Basic " +
                      Buffer.from(`${twilioSid}:${twilioToken}`).toString(
                        "base64"
                      ),
                    "Content-Type": "application/x-www-form-urlencoded",
                  },
                  body: new URLSearchParams({
                    To: customerPhone,
                    From: twilioFrom,
                    Body: smsBody,
                  }).toString(),
                }
              );
              smsSent = response.ok;
            }
          } catch (smsErr) {
            logger.error("SMS send failed for lead", { leadId: lead.id, error: String(smsErr) });
          }
        }

        /* ── Update status ── */
        if (emailSent || smsSent) {
          await supabase
            .from("review_requests")
            .update({ status: "sent", sent_at: new Date().toISOString() })
            .eq("id", reviewRequest.id);
          sent++;
        } else {
          errors++;
        }
      } catch (leadErr) {
        logger.error("Error processing lead", { leadId: lead.id, error: String(leadErr) });
        errors++;
      }
    }

    return NextResponse.json({
      success: true,
      sent,
      skipped,
      errors,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Review requests cron error", { error: String(error) });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;

/* ── Branded review request email template ── */
function buildReviewEmailHtml({
  customerName,
  senderName,
  reviewLink,
}: {
  customerName: string;
  senderName: string;
  reviewLink: string;
}): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /></head>
<body style="margin: 0; padding: 0; background-color: #f7f5f3; font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7f5f3; padding: 40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="background-color: #ffffff; border-radius: 12px; overflow: hidden;">
          <!-- Header -->
          <tr>
            <td style="background-color: #D4886A; padding: 24px 32px; text-align: center;">
              <span style="font-family: Georgia, serif; font-size: 24px; font-weight: 400; color: #ffffff; letter-spacing: -0.02em;">Henri.</span>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 40px 32px;">
              <h1 style="margin: 0 0 8px; font-family: Georgia, serif; font-size: 24px; font-weight: 400; color: #1a1a1a; line-height: 1.3;">
                Hi ${customerName}, how was your experience?
              </h1>
              <p style="margin: 0 0 24px; font-size: 15px; color: #555555; line-height: 1.6;">
                ${senderName} would love to hear about your recent project. Your feedback helps other homeowners find quality contractors and helps ${senderName} continue to improve.
              </p>
              <p style="margin: 0 0 32px; font-size: 15px; color: #555555; line-height: 1.6;">
                It only takes a minute.
              </p>

              <!-- CTA Button -->
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="background-color: #D4886A; border-radius: 8px;">
                    <a href="${reviewLink}"
                       style="display: inline-block; padding: 14px 32px; font-size: 15px; font-weight: 600; color: #ffffff; text-decoration: none;">
                      Leave a Review
                    </a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding: 24px 32px; border-top: 1px solid #eee;">
              <p style="margin: 0; font-size: 12px; color: #999999; line-height: 1.5;">
                This link expires in 30 days. If you didn't work with ${senderName}, you can safely ignore this email.
              </p>
              <p style="margin: 8px 0 0; font-size: 12px; color: #bbbbbb;">
                Sent via Henri
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}
