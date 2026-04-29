import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { Resend } from "resend";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 300;

/* -------------------------------------------------------------------------- */
/*  Weekly Performance Digest Cron                                            */
/*  Sends a branded weekly performance report to each active contractor       */
/*  with KPIs, territory insights, and smart action items.                    */
/* -------------------------------------------------------------------------- */

const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "digest@meethenri.com";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://meethenri.com";

/* ── Types ── */

interface WeeklyMetrics {
  leadsReceived: number;
  leadsReceivedPrev: number;
  contactRate: number;
  contactRatePrev: number;
  avgResponseTimeH: number;
  avgResponseTimeHPrev: number;
  quotesSent: number;
  quotesSentPrev: number;
  jobsWon: number;
  jobsWonPrev: number;
  jobsWonRevenue: number;
  pipelineValue: number;
  engagementScore: number | null;
  tier: string | null;
  reviewAvg: number | null;
  reviewsThisWeek: number;
}

interface TerritoryInsights {
  hottestZip: string | null;
  hottestZipLeads: number;
  topTrade: string | null;
  topTradeLeads: number;
  competitorCount: number;
}

interface ActionItem {
  priority: "high" | "medium" | "low";
  text: string;
}

/* ── Trend helpers ── */

function trend(current: number, previous: number): "up" | "down" | "flat" {
  if (current > previous) return "up";
  if (current < previous) return "down";
  return "flat";
}

function trendHtml(
  current: number,
  previous: number,
  /** For metrics where lower is better (like response time) */
  invertColor = false
): string {
  const dir = trend(current, previous);
  if (dir === "flat") {
    return `<span style="color:#666666;font-size:13px;"> &mdash;</span>`;
  }
  const arrow = dir === "up" ? "&uarr;" : "&darr;";
  const isGood = invertColor ? dir === "down" : dir === "up";
  const color = isGood ? "#22c55e" : "#ef4444";
  const diff = Math.abs(current - previous);
  return `<span style="color:${color};font-size:13px;"> ${arrow} ${diff}</span>`;
}

function trendPercentHtml(current: number, previous: number): string {
  const dir = trend(current, previous);
  if (dir === "flat") {
    return `<span style="color:#666666;font-size:13px;"> &mdash;</span>`;
  }
  const arrow = dir === "up" ? "&uarr;" : "&darr;";
  const isGood = dir === "up";
  const color = isGood ? "#22c55e" : "#ef4444";
  const diff = Math.abs(Math.round(current - previous));
  return `<span style="color:${color};font-size:13px;"> ${arrow} ${diff}%</span>`;
}

/* ── Date helpers ── */

function formatDateRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: "long", day: "numeric" };
  const startStr = start.toLocaleDateString("en-US", opts);
  const endStr = end.toLocaleDateString("en-US", { ...opts, year: "numeric" });
  return `${startStr} - ${endStr}`;
}

/* ── Action item generator ── */

function generateActionItems(
  metrics: WeeklyMetrics,
  insights: TerritoryInsights,
  uncontactedLeads: number,
  licenseExpiryDays: number | null
): ActionItem[] {
  const items: ActionItem[] = [];

  if (uncontactedLeads > 0) {
    items.push({
      priority: "high",
      text: `You have ${uncontactedLeads} lead${uncontactedLeads === 1 ? "" : "s"} waiting for contact`,
    });
  }

  if (metrics.avgResponseTimeH > 2) {
    items.push({
      priority: "high",
      text: `Your response time is ${metrics.avgResponseTimeH.toFixed(1)}h -- top contractors respond in under 1h`,
    });
  }

  if (metrics.reviewsThisWeek > 0) {
    items.push({
      priority: "medium",
      text: `${metrics.reviewsThisWeek} review${metrics.reviewsThisWeek === 1 ? "" : "s"} came in this week -- responding boosts your ranking`,
    });
  }

  if (licenseExpiryDays !== null && licenseExpiryDays <= 30) {
    items.push({
      priority: "high",
      text: `License expires in ${licenseExpiryDays} day${licenseExpiryDays === 1 ? "" : "s"} -- renew to keep leads flowing`,
    });
  }

  if (
    insights.hottestZip &&
    insights.hottestZipLeads >= 3 &&
    metrics.leadsReceived > metrics.leadsReceivedPrev
  ) {
    items.push({
      priority: "medium",
      text: `ZIP ${insights.hottestZip} is heating up with ${insights.hottestZipLeads} new leads -- consider adding more ZIPs`,
    });
  }

  if (metrics.contactRate < 50 && metrics.leadsReceived > 0) {
    items.push({
      priority: "high",
      text: `Your contact rate is ${Math.round(metrics.contactRate)}% -- reaching out within 24h doubles your close rate`,
    });
  }

  if (metrics.quotesSent === 0 && metrics.leadsReceived > 0) {
    items.push({
      priority: "medium",
      text: "No quotes sent this week -- converting leads to quotes keeps your pipeline healthy",
    });
  }

  if (
    metrics.engagementScore !== null &&
    metrics.engagementScore < 50
  ) {
    items.push({
      priority: "low",
      text: "Your engagement score is below average -- log in, act on leads, and send outreach to improve it",
    });
  }

  return items.slice(0, 5);
}

/* ── Email template ── */

function buildWeeklyDigestHtml(data: {
  name: string;
  dateRange: string;
  metrics: WeeklyMetrics;
  insights: TerritoryInsights;
  actionItems: ActionItem[];
}): string {
  const { name, dateRange, metrics, insights, actionItems } = data;

  const tierLabel =
    metrics.tier
      ? metrics.tier.charAt(0).toUpperCase() + metrics.tier.slice(1)
      : "N/A";

  const tierColors: Record<string, string> = {
    platinum: "#E5E4E2",
    gold: "#FFD700",
    silver: "#C0C0C0",
    bronze: "#CD7F32",
  };
  const tierColor = metrics.tier ? tierColors[metrics.tier] ?? "#999999" : "#999999";

  const priorityLabels: Record<string, { label: string; color: string }> = {
    high: { label: "HIGH", color: "#ef4444" },
    medium: { label: "MED", color: "#f59e0b" },
    low: { label: "LOW", color: "#6b7280" },
  };

  const actionItemsHtml = actionItems.length > 0
    ? actionItems
        .map((item, i) => {
          const p = priorityLabels[item.priority];
          return `
            <tr>
              <td style="padding:10px 16px;border-bottom:1px solid #2a2a2a;vertical-align:top;">
                <table cellpadding="0" cellspacing="0" border="0" width="100%">
                  <tr>
                    <td style="width:28px;vertical-align:top;padding-top:2px;">
                      <span style="display:inline-block;width:22px;height:22px;line-height:22px;text-align:center;border-radius:50%;background:#D4886A;color:#ffffff;font-size:12px;font-weight:600;">${i + 1}</span>
                    </td>
                    <td style="padding-left:10px;">
                      <span style="display:inline-block;padding:2px 6px;border-radius:3px;font-size:10px;font-weight:600;letter-spacing:0.5px;color:#ffffff;background:${p.color};margin-bottom:4px;">${p.label}</span>
                      <p style="margin:4px 0 0;font-size:14px;color:#dddddd;line-height:1.4;">${item.text}</p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>`;
        })
        .join("")
    : `<tr><td style="padding:16px;color:#666666;font-size:14px;">No action items this week. Keep up the great work.</td></tr>`;

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Henri. Weekly Performance Report</title>
</head>
<body style="margin:0;padding:0;font-family:Arial,'Helvetica Neue',Helvetica,sans-serif;background-color:#111111;color:#ffffff;">
  <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#111111;">
    <tr>
      <td align="center" style="padding:24px 16px;">
        <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">

          <!-- Header -->
          <tr>
            <td style="padding:32px 32px 24px;background:#1a1a1a;border-radius:12px 12px 0 0;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td>
                    <h1 style="margin:0;font-size:28px;font-weight:400;color:#D4886A;letter-spacing:-0.5px;">Henri.</h1>
                  </td>
                  <td align="right" style="vertical-align:bottom;">
                    <span style="font-size:12px;color:#666666;text-transform:uppercase;letter-spacing:1px;">Weekly Report</span>
                  </td>
                </tr>
              </table>
              <hr style="border:none;border-top:1px solid #2a2a2a;margin:16px 0;" />
              <h2 style="margin:0 0 4px;font-size:20px;font-weight:400;color:#ffffff;">Your Weekly Performance Report</h2>
              <p style="margin:0;font-size:14px;color:#999999;">${dateRange}</p>
            </td>
          </tr>

          <!-- Greeting -->
          <tr>
            <td style="padding:24px 32px 8px;background:#1a1a1a;">
              <p style="margin:0;font-size:16px;color:#dddddd;">Hi ${name},</p>
              <p style="margin:8px 0 0;font-size:14px;color:#999999;">Here is how your business performed this week.</p>
            </td>
          </tr>

          <!-- KPI Grid -->
          <tr>
            <td style="padding:16px 24px;background:#1a1a1a;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0">
                <!-- Row 1 -->
                <tr>
                  <td width="33%" style="padding:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                      <tr>
                        <td style="padding:16px;">
                          <p style="margin:0;font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Leads Received</p>
                          <p style="margin:8px 0 0;font-size:24px;font-weight:600;color:#ffffff;">
                            ${metrics.leadsReceived}${trendHtml(metrics.leadsReceived, metrics.leadsReceivedPrev)}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="33%" style="padding:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                      <tr>
                        <td style="padding:16px;">
                          <p style="margin:0;font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Contact Rate</p>
                          <p style="margin:8px 0 0;font-size:24px;font-weight:600;color:#ffffff;">
                            ${Math.round(metrics.contactRate)}%${trendPercentHtml(metrics.contactRate, metrics.contactRatePrev)}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="33%" style="padding:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                      <tr>
                        <td style="padding:16px;">
                          <p style="margin:0;font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Avg Response</p>
                          <p style="margin:8px 0 0;font-size:24px;font-weight:600;color:#ffffff;">
                            ${metrics.avgResponseTimeH.toFixed(1)}h${trendHtml(metrics.avgResponseTimeH, metrics.avgResponseTimeHPrev, true)}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <!-- Row 2 -->
                <tr>
                  <td width="33%" style="padding:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                      <tr>
                        <td style="padding:16px;">
                          <p style="margin:0;font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Quotes Sent</p>
                          <p style="margin:8px 0 0;font-size:24px;font-weight:600;color:#ffffff;">
                            ${metrics.quotesSent}${trendHtml(metrics.quotesSent, metrics.quotesSentPrev)}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="33%" style="padding:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                      <tr>
                        <td style="padding:16px;">
                          <p style="margin:0;font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Jobs Won</p>
                          <p style="margin:8px 0 0;font-size:24px;font-weight:600;color:#ffffff;">
                            ${metrics.jobsWon}${trendHtml(metrics.jobsWon, metrics.jobsWonPrev)}
                          </p>
                          <p style="margin:4px 0 0;font-size:12px;color:#999999;">${formatRevenue(metrics.jobsWonRevenue)} revenue</p>
                        </td>
                      </tr>
                    </table>
                  </td>
                  <td width="33%" style="padding:8px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                      <tr>
                        <td style="padding:16px;">
                          <p style="margin:0;font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Pipeline</p>
                          <p style="margin:8px 0 0;font-size:24px;font-weight:600;color:#ffffff;">
                            ${formatRevenue(metrics.pipelineValue)}
                          </p>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Engagement & Tier Bar -->
          <tr>
            <td style="padding:0 32px 16px;background:#1a1a1a;">
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                <tr>
                  <td style="padding:16px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td>
                          <span style="font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Engagement Score</span><br />
                          <span style="font-size:20px;font-weight:600;color:#ffffff;">${metrics.engagementScore ?? "N/A"}<span style="font-size:14px;color:#999999;">/100</span></span>
                        </td>
                        <td align="center">
                          <span style="font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Tier</span><br />
                          <span style="display:inline-block;padding:4px 12px;border-radius:4px;font-size:14px;font-weight:600;color:#111111;background:${tierColor};">${tierLabel}</span>
                        </td>
                        <td align="right">
                          <span style="font-size:11px;color:#999999;text-transform:uppercase;letter-spacing:0.5px;">Reviews</span><br />
                          <span style="font-size:20px;font-weight:600;color:#ffffff;">${metrics.reviewAvg !== null ? metrics.reviewAvg.toFixed(1) : "N/A"}</span>
                          <span style="font-size:12px;color:#999999;"> avg${metrics.reviewsThisWeek > 0 ? ` (+${metrics.reviewsThisWeek} new)` : ""}</span>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Territory Insights -->
          <tr>
            <td style="padding:8px 32px 16px;background:#1a1a1a;">
              <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#D4886A;text-transform:uppercase;letter-spacing:0.5px;">Territory Insights</h3>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#999999;">Hottest ZIP</td>
                        <td align="right" style="font-size:14px;font-weight:600;color:#ffffff;">${insights.hottestZip ?? "N/A"}${insights.hottestZip ? ` <span style="font-size:12px;color:#999999;">(${insights.hottestZipLeads} leads)</span>` : ""}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;border-bottom:1px solid #2a2a2a;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#999999;">Top Trade</td>
                        <td align="right" style="font-size:14px;font-weight:600;color:#ffffff;">${insights.topTrade ?? "N/A"}${insights.topTrade ? ` <span style="font-size:12px;color:#999999;">(${insights.topTradeLeads} leads)</span>` : ""}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
                <tr>
                  <td style="padding:14px 20px;">
                    <table width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td style="font-size:13px;color:#999999;">Competitors in Your ZIPs</td>
                        <td align="right" style="font-size:14px;font-weight:600;color:#ffffff;">${insights.competitorCount}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Action Items -->
          <tr>
            <td style="padding:8px 32px 24px;background:#1a1a1a;">
              <h3 style="margin:0 0 12px;font-size:15px;font-weight:600;color:#D4886A;text-transform:uppercase;letter-spacing:0.5px;">This Week's Action Items</h3>
              <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#222222;border-radius:8px;border:1px solid #2a2a2a;">
                ${actionItemsHtml}
              </table>
            </td>
          </tr>

          <!-- CTA -->
          <tr>
            <td align="center" style="padding:0 32px 32px;background:#1a1a1a;">
              <a href="${APP_URL}/dashboard"
                 style="display:inline-block;background:#D4886A;color:#ffffff;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:600;letter-spacing:0.3px;">
                Open Dashboard
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:24px 32px;background:#151515;border-radius:0 0 12px 12px;">
              <p style="margin:0;font-size:12px;color:#666666;text-align:center;line-height:1.6;">
                You're receiving this because you're subscribed to Henri weekly performance reports.<br />
                <a href="${APP_URL}/dashboard/settings" style="color:#D4886A;text-decoration:underline;">Manage preferences</a>
              </p>
              <p style="margin:12px 0 0;font-size:11px;color:#444444;text-align:center;">
                Henri. -- Construction Permit Intelligence
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

/* ── Revenue formatter ── */

function formatRevenue(amount: number): string {
  if (amount === 0) return "$0";
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${amount.toLocaleString()}`;
}

/* ── Main handler ── */

async function handler(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!process.env.RESEND_API_KEY) {
    return NextResponse.json({ skipped: true, reason: "Resend not configured" });
  }

  const supabase = createAdminClient();
  const resend = new Resend(process.env.RESEND_API_KEY);

  let sent = 0;
  let skipped = 0;
  let errors = 0;

  try {
    /* Fetch all onboarded contractors with an active plan */
    const { data: contractors, error: cError } = await supabase
      .from("profiles")
      .select("id, email, full_name, plan, notification_prefs")
      .eq("role", "contractor")
      .eq("onboarding_completed", true)
      .not("plan", "is", null);

    if (cError) {
      logger.error("Failed to fetch contractors", { error: String(cError) });
      return NextResponse.json(
        { error: "Failed to fetch contractors" },
        { status: 500 }
      );
    }

    /* Date boundaries */
    const now = new Date();
    const thisWeekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const prevWeekStart = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
    const thisWeekISO = thisWeekStart.toISOString();
    const prevWeekISO = prevWeekStart.toISOString();

    for (const contractor of contractors ?? []) {
      try {
        /* ---- Check notification preferences ---- */
        const prefs = contractor.notification_prefs as Record<string, boolean> | null;
        if (prefs && prefs.weekly_digest === false) {
          skipped++;
          continue;
        }

        if (!contractor.email) {
          skipped++;
          continue;
        }

        /* ================================================================ */
        /*  METRICS: This week vs. last week                               */
        /* ================================================================ */

        /* ---- Leads this week ---- */
        const { data: leadsThisWeek } = await supabase
          .from("leads")
          .select("id, status, contacted_at, created_at, zip, trade, pipeline_value, won_at")
          .eq("contractor_id", contractor.id)
          .gte("created_at", thisWeekISO);

        /* ---- Leads last week ---- */
        const { data: leadsPrevWeek } = await supabase
          .from("leads")
          .select("id, status, contacted_at, created_at, zip, trade, pipeline_value, won_at")
          .eq("contractor_id", contractor.id)
          .gte("created_at", prevWeekISO)
          .lt("created_at", thisWeekISO);

        const tw = leadsThisWeek ?? [];
        const pw = leadsPrevWeek ?? [];

        /* Leads received */
        const leadsReceived = tw.length;
        const leadsReceivedPrev = pw.length;

        /* Contact rate: % contacted within 24h */
        const contactedWithin24h = (leads: typeof tw) =>
          leads.filter((l) => {
            if (!l.contacted_at) return false;
            const diff =
              new Date(l.contacted_at).getTime() -
              new Date(l.created_at).getTime();
            return diff <= 24 * 60 * 60 * 1000;
          }).length;

        const contactRate =
          tw.length > 0
            ? (contactedWithin24h(tw) / tw.length) * 100
            : 0;
        const contactRatePrev =
          pw.length > 0
            ? (contactedWithin24h(pw) / pw.length) * 100
            : 0;

        /* Average response time (hours) */
        const avgResponseTime = (leads: typeof tw): number => {
          const contacted = leads.filter((l) => l.contacted_at);
          if (contacted.length === 0) return 0;
          const totalH = contacted.reduce((sum, l) => {
            const diff =
              new Date(l.contacted_at!).getTime() -
              new Date(l.created_at).getTime();
            return sum + diff / (1000 * 60 * 60);
          }, 0);
          return totalH / contacted.length;
        };

        const avgResponseTimeH = avgResponseTime(tw);
        const avgResponseTimeHPrev = avgResponseTime(pw);

        /* ---- Quotes this week / last week ---- */
        const { count: quotesSent } = await supabase
          .from("quotes")
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", contractor.id)
          .gte("created_at", thisWeekISO);

        const { count: quotesSentPrev } = await supabase
          .from("quotes")
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", contractor.id)
          .gte("created_at", prevWeekISO)
          .lt("created_at", thisWeekISO);

        /* Jobs won */
        const wonThisWeek = tw.filter((l) => l.status === "won");
        const wonPrevWeek = pw.filter((l) => l.status === "won");
        const jobsWon = wonThisWeek.length;
        const jobsWonPrev = wonPrevWeek.length;
        const jobsWonRevenue = wonThisWeek.reduce(
          (sum, l) => sum + (l.pipeline_value ?? 0),
          0
        );

        /* Pipeline value: sum of active quotes (not won/lost) */
        const activeStatuses = ["contacted", "quoted", "proposal"];
        const { data: activePipeline } = await supabase
          .from("leads")
          .select("pipeline_value")
          .eq("contractor_id", contractor.id)
          .in("status", activeStatuses);

        const pipelineValue = (activePipeline ?? []).reduce(
          (sum, l) => sum + (l.pipeline_value ?? 0),
          0
        );

        /* ---- Engagement score & tier ---- */
        const { data: engScore } = await supabase
          .from("engagement_scores")
          .select("total_score, tier")
          .eq("contractor_id", contractor.id)
          .single();

        const engagementScore = engScore?.total_score ?? null;
        const tier = engScore?.tier ?? null;

        /* ---- Reviews ---- */
        const { data: allReviews } = await supabase
          .from("reviews")
          .select("rating, created_at")
          .eq("contractor_id", contractor.id)
          .eq("status", "published");

        const reviews = allReviews ?? [];
        const reviewAvg =
          reviews.length > 0
            ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
            : null;
        const reviewsThisWeek = reviews.filter(
          (r) => new Date(r.created_at) >= thisWeekStart
        ).length;

        /* ================================================================ */
        /*  TERRITORY INSIGHTS                                              */
        /* ================================================================ */

        /* Hottest ZIP */
        const zipCounts = new Map<string, number>();
        for (const l of tw) {
          if (l.zip) {
            zipCounts.set(l.zip, (zipCounts.get(l.zip) ?? 0) + 1);
          }
        }
        let hottestZip: string | null = null;
        let hottestZipLeads = 0;
        for (const [zip, count] of zipCounts) {
          if (count > hottestZipLeads) {
            hottestZip = zip;
            hottestZipLeads = count;
          }
        }

        /* Top trade */
        const tradeCounts = new Map<string, number>();
        for (const l of tw) {
          if (l.trade) {
            tradeCounts.set(l.trade, (tradeCounts.get(l.trade) ?? 0) + 1);
          }
        }
        let topTrade: string | null = null;
        let topTradeLeads = 0;
        for (const [trade, count] of tradeCounts) {
          if (count > topTradeLeads) {
            topTrade = trade;
            topTradeLeads = count;
          }
        }

        /* Competitor count in contractor's ZIPs */
        const { data: contractorTerritories } = await supabase
          .from("territories")
          .select("zip")
          .eq("contractor_id", contractor.id)
          .eq("status", "active");

        let competitorCount = 0;
        const contractorZips = (contractorTerritories ?? []).map((t) => t.zip);
        if (contractorZips.length > 0) {
          const { count: competitors } = await supabase
            .from("territories")
            .select("contractor_id", { count: "exact", head: true })
            .in("zip", contractorZips)
            .eq("status", "active")
            .neq("contractor_id", contractor.id);

          competitorCount = competitors ?? 0;
        }

        /* ================================================================ */
        /*  ACTION ITEMS                                                    */
        /* ================================================================ */

        /* Count uncontacted leads */
        const { count: uncontactedCount } = await supabase
          .from("leads")
          .select("id", { count: "exact", head: true })
          .eq("contractor_id", contractor.id)
          .eq("status", "new")
          .is("contacted_at", null);

        /* Nearest license expiry */
        const { data: nextExpiry } = await supabase
          .from("contractor_licenses")
          .select("expiry_date")
          .eq("contractor_id", contractor.id)
          .gte("expiry_date", now.toISOString())
          .order("expiry_date", { ascending: true })
          .limit(1);

        let licenseExpiryDays: number | null = null;
        if (nextExpiry && nextExpiry.length > 0 && nextExpiry[0].expiry_date) {
          const expiryDate = new Date(nextExpiry[0].expiry_date);
          licenseExpiryDays = Math.ceil(
            (expiryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
          );
        }

        const metrics: WeeklyMetrics = {
          leadsReceived,
          leadsReceivedPrev,
          contactRate,
          contactRatePrev,
          avgResponseTimeH,
          avgResponseTimeHPrev,
          quotesSent: quotesSent ?? 0,
          quotesSentPrev: quotesSentPrev ?? 0,
          jobsWon,
          jobsWonPrev,
          jobsWonRevenue,
          pipelineValue,
          engagementScore,
          tier,
          reviewAvg,
          reviewsThisWeek,
        };

        const insights: TerritoryInsights = {
          hottestZip,
          hottestZipLeads,
          topTrade,
          topTradeLeads,
          competitorCount,
        };

        const actionItems = generateActionItems(
          metrics,
          insights,
          uncontactedCount ?? 0,
          licenseExpiryDays
        );

        /* ================================================================ */
        /*  BUILD & SEND EMAIL                                              */
        /* ================================================================ */

        const dateRange = formatDateRange(thisWeekStart, now);

        const html = buildWeeklyDigestHtml({
          name: contractor.full_name ?? "there",
          dateRange,
          metrics,
          insights,
          actionItems,
        });

        const subjectDate = now.toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
        });

        const { error: emailError } = await resend.emails.send({
          from: FROM_EMAIL,
          to: contractor.email,
          subject: `[Henri] Weekly Performance Report - ${subjectDate}`,
          html,
        });

        if (emailError) {
          logger.error("Weekly digest email failed", { contractorId: contractor.id, error: String(emailError) });
          errors++;
        } else {
          sent++;
        }
      } catch (err) {
        logger.error("Weekly digest processing failed for contractor", { contractorId: contractor.id, error: String(err) });
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
    logger.error("Weekly digest cron error", { error: String(error) });
    return NextResponse.json({ error: "Cron job failed" }, { status: 500 });
  }
}

export const GET = handler;
export const POST = handler;
