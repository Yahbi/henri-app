import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Resend } from "resend";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/* -------------------------------------------------------------------------- */
/*  Daily Digest Cron                                                         */
/*  Sends a daily summary email to each contractor with new leads,            */
/*  pipeline status, license/insurance alerts, and engagement updates.        */
/* -------------------------------------------------------------------------- */

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "digest@meethenri.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com";

function buildDigestHtml(data: {
  name: string;
  newLeadsCount: number;
  topLeads: Array<{ permit_type: string | null; address: string; score: number }>;
  pipeline: Record<string, number>;
  expiringLicenses: Array<{ license_number: string; expiry_date: string }>;
  engagementScore: number | null;
  engagementChange: number | null;
}): string {
  const topLeadsHtml = data.topLeads
    .map(
      (l) =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b;">${l.permit_type ?? "Permit"}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b;">${l.address}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #e2e8f0;font-size:14px;color:#1e293b;font-weight:600;">${l.score}/100</td>
        </tr>`
    )
    .join("");

  const pipelineRows = Object.entries(data.pipeline)
    .map(
      ([status, count]) =>
        `<tr>
          <td style="padding:4px 12px;font-size:14px;color:#64748b;text-transform:capitalize;">${status}</td>
          <td style="padding:4px 12px;font-size:14px;color:#1e293b;font-weight:600;">${count}</td>
        </tr>`
    )
    .join("");

  const licenseWarnings =
    data.expiringLicenses.length > 0
      ? `<div style="background:#fef3cd;border-left:4px solid #f59e0b;padding:12px 16px;margin:16px 0;border-radius:4px;">
          <strong style="color:#92400e;">License Alert</strong>
          ${data.expiringLicenses
            .map(
              (l) =>
                `<p style="margin:4px 0;font-size:14px;color:#92400e;">License #${l.license_number} expires ${l.expiry_date}</p>`
            )
            .join("")}
        </div>`
      : "";

  const engagementHtml =
    data.engagementScore !== null
      ? `<p style="font-size:14px;color:#64748b;margin:8px 0;">
          Engagement Score: <strong style="color:#1e293b;">${data.engagementScore}/100</strong>
          ${data.engagementChange !== null && data.engagementChange !== 0 ? ` (${data.engagementChange > 0 ? "+" : ""}${data.engagementChange} from yesterday)` : ""}
        </p>`
      : "";

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
</head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background-color:#f9fafb;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;margin-top:20px;">
    <tr>
      <td style="background:#1e293b;padding:24px 32px;">
        <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:400;">Henri.</h1>
        <p style="color:#94a3b8;margin:4px 0 0;font-size:13px;">Your Daily Lead Digest</p>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <p style="font-size:16px;color:#1e293b;margin:0 0 16px;">Hi ${data.name},</p>
        <p style="font-size:14px;color:#64748b;margin:0 0 24px;">Here is your daily summary.</p>

        <!-- New Leads -->
        <h2 style="font-size:16px;color:#1e293b;margin:0 0 12px;font-weight:600;">New Leads (${data.newLeadsCount})</h2>
        ${
          data.topLeads.length > 0
            ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
                <tr style="background:#f1f5f9;">
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Type</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Address</th>
                  <th style="padding:8px 12px;text-align:left;font-size:12px;color:#64748b;font-weight:600;">Score</th>
                </tr>
                ${topLeadsHtml}
              </table>`
            : `<p style="font-size:14px;color:#94a3b8;margin:0 0 24px;">No new leads in the last 24 hours.</p>`
        }

        <!-- Pipeline -->
        <h2 style="font-size:16px;color:#1e293b;margin:0 0 12px;font-weight:600;">Pipeline Overview</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
          ${pipelineRows}
        </table>

        ${licenseWarnings}

        ${engagementHtml}

        <a href="${APP_URL}/dashboard"
           style="display:inline-block;background:#D4886A;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;margin-top:16px;">
          Open Dashboard
        </a>
      </td>
    </tr>
    <tr>
      <td style="background:#f1f5f9;padding:16px 32px;text-align:center;">
        <p style="color:#94a3b8;font-size:12px;margin:0;">
          Henri - Construction Permit Intelligence
        </p>
      </td>
    </tr>
  </table>
</body>
</html>`.trim();
}

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: true, reason: "Resend not configured" });
  }

  const supabase = createAdminClient();
  const resend = new Resend(process.env.RESEND_API_KEY);

  let sent = 0;
  let skipped = 0;

  try {
    /* Fetch all onboarded contractors */
    const { data: contractors, error: cError } = await supabase
      .from("profiles")
      .select("id, email, full_name, notification_prefs")
      .eq("role", "contractor")
      .eq("onboarding_completed", true);

    if (cError) {
      logger.error("Failed to fetch contractors", { error: String(cError) });
      return NextResponse.json(
        { error: "Failed to fetch contractors" },
        { status: 500 }
      );
    }

    const twentyFourHoursAgo = new Date(
      Date.now() - 24 * 60 * 60 * 1000
    ).toISOString();

    for (const contractor of contractors ?? []) {
      try {
        /* ---- Check notification preferences ---- */
        const prefs = contractor.notification_prefs as Record<
          string,
          boolean
        > | null;
        if (prefs && prefs.digest === false) {
          skipped++;
          continue;
        }

        if (!contractor.email) {
          skipped++;
          continue;
        }

        /* ---- New leads in last 24h ---- */
        const { data: newLeads, count: newLeadsCount } = await supabase
          .from("leads")
          .select("id, permit_type, address, score", {
            count: "exact",
          })
          .eq("contractor_id", contractor.id)
          .gte("created_at", twentyFourHoursAgo)
          .order("score", { ascending: false })
          .limit(3);

        /* ---- Pipeline status counts ---- */
        const { data: pipelineData } = await supabase
          .from("leads")
          .select("status")
          .eq("contractor_id", contractor.id)
          .not("status", "eq", "archived");

        const pipeline: Record<string, number> = {};
        for (const lead of pipelineData ?? []) {
          pipeline[lead.status] = (pipeline[lead.status] ?? 0) + 1;
        }

        /* ---- Expiring licenses (within 30 days) ---- */
        const thirtyDaysFromNow = new Date(
          Date.now() + 30 * 24 * 60 * 60 * 1000
        ).toISOString();

        const { data: expiringLicenses } = await supabase
          .from("contractor_licenses")
          .select("license_number, expiry_date")
          .eq("contractor_id", contractor.id)
          .lte("expiry_date", thirtyDaysFromNow)
          .gte("expiry_date", new Date().toISOString());

        /* ---- Engagement score change ---- */
        const { data: engScore } = await supabase
          .from("engagement_scores")
          .select("total_score, previous_score")
          .eq("contractor_id", contractor.id)
          .single();

        const engagementScore = engScore?.total_score ?? null;
        const engagementChange =
          engScore?.total_score != null && engScore?.previous_score != null
            ? engScore.total_score - engScore.previous_score
            : null;

        /* ---- Skip if no activity ---- */
        const hasNewLeads = (newLeadsCount ?? 0) > 0;
        const hasExpiringLicenses =
          (expiringLicenses ?? []).length > 0;
        const hasEngagementChange =
          engagementChange !== null && engagementChange !== 0;

        if (!hasNewLeads && !hasExpiringLicenses && !hasEngagementChange) {
          skipped++;
          continue;
        }

        /* ---- Build and send digest email ---- */
        const html = buildDigestHtml({
          name: contractor.full_name ?? "there",
          newLeadsCount: newLeadsCount ?? 0,
          topLeads: (newLeads ?? []).map((l) => ({
            permit_type: l.permit_type,
            address: l.address,
            score: l.score,
          })),
          pipeline,
          expiringLicenses: (expiringLicenses ?? []).map((l) => ({
            license_number: l.license_number,
            expiry_date: l.expiry_date,
          })),
          engagementScore,
          engagementChange,
        });

        const { error: emailError } = await resend.emails.send({
          from: FROM_EMAIL,
          to: contractor.email,
          subject: `[Henri] Your Daily Lead Digest - ${new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" })}`,
          html,
        });

        if (emailError) {
          logger.error("Digest email failed", { contractorId: contractor.id, error: String(emailError) });
          skipped++;
        } else {
          sent++;
        }
      } catch (err) {
        logger.error("Digest processing failed for contractor", { contractorId: contractor.id, error: String(err) });
        skipped++;
      }
    }

    return NextResponse.json({
      success: true,
      sent,
      skipped,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error("Digest cron error", { error: String(error) });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
