import { Resend } from "resend";
import type { LeadData } from "@/types/leads";

function getResend() {
  return new Resend(process.env.RESEND_API_KEY!);
}

// Must match a verified domain in Resend — see .env.example. Fallback
// is used only for local dev / tests; production must set this via env
// so email isn't sent from an unverified domain (Resend silently
// suppresses such sends and the contractor never gets their lead email).
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL ?? "henri@henri.app";

/** Escape HTML special characters to prevent injection via permit data */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function buildLeadEmailHtml(leadData: LeadData): string {
  const value = leadData.estimatedValue
    ? `$${leadData.estimatedValue.toLocaleString()}`
    : "N/A";

  const urgencyColor =
    leadData.urgency === "hot"
      ? "#ef4444"
      : leadData.urgency === "warm"
        ? "#f59e0b"
        : "#6b7280";

  const urgencyLabel = leadData.urgency.toUpperCase();

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
      <td style="background:#D4886A;padding:24px 32px;">
        <h1 style="color:#ffffff;margin:0;font-size:20px;font-weight:500;letter-spacing:-0.02em;">Henri.</h1>
      </td>
    </tr>
    <tr>
      <td style="padding:32px;">
        <div style="display:inline-block;background:${urgencyColor};color:#fff;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;margin-bottom:16px;">
          ${urgencyLabel} LEAD
        </div>
        <h2 style="color:#1e293b;margin:16px 0 8px;">New ${leadData.permitType} Permit</h2>
        <table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:14px;width:120px;">Location</td>
            <td style="padding:8px 0;color:#1e293b;font-size:14px;">${leadData.address ?? "N/A"}, ${leadData.city}, ${leadData.state}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:14px;">Est. Value</td>
            <td style="padding:8px 0;color:#1e293b;font-size:14px;font-weight:600;">${value}</td>
          </tr>
          <tr>
            <td style="padding:8px 0;color:#64748b;font-size:14px;">Lead Score</td>
            <td style="padding:8px 0;color:#1e293b;font-size:14px;font-weight:600;">${leadData.score}/100</td>
          </tr>
          ${
            leadData.description
              ? `<tr>
            <td style="padding:8px 0;color:#64748b;font-size:14px;vertical-align:top;">Description</td>
            <td style="padding:8px 0;color:#1e293b;font-size:14px;">${escapeHtml(leadData.description.slice(0, 500))}</td>
          </tr>`
              : ""
          }
        </table>
        <a href="${process.env.NEXT_PUBLIC_APP_URL}/dashboard/leads"
           style="display:inline-block;background:#D4886A;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-size:14px;font-weight:600;margin-top:16px;">
          View Lead Details
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

export async function sendLeadEmail(
  to: string,
  leadData: LeadData
): Promise<{ success: boolean; emailId: string | null }> {
  try {
    const urgencyLabel = leadData.urgency.toUpperCase();
    const subject = `[Henri] ${urgencyLabel} Lead: ${leadData.permitType} permit in ${leadData.city}, ${leadData.state}`;

    const resend = getResend();
    const { data, error } = await resend.emails.send({
      from: FROM_EMAIL,
      to,
      subject,
      html: buildLeadEmailHtml(leadData),
    });

    if (error) {
      console.error("Resend email error:", error);
      return { success: false, emailId: null };
    }

    return { success: true, emailId: data?.id ?? null };
  } catch (error) {
    console.error("Resend email error:", error);
    return { success: false, emailId: null };
  }
}
